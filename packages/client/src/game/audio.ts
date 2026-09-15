// Every sound in the game, synthesized at play time from oscillators and noise. No audio
// files, for the same reason there are no image files: the palette and the voice of this thing
// should be readable and tweakable as source, not as binary blobs someone has to re-render.
//
// Deliberately free of game types and React - TableScene (Phaser) and the React layer both
// call into this, and neither should have to route a sound through the other. Mapping a Move
// to a sound is presentation and lives at the call site; this file only knows how to make
// noises.
//
// House style: percussive, dry and physical. Every voice is a struck object - a fast downward
// pitch drop over a sine or triangle body, with a noise transient for the contact - rather than
// a held note or a melody. Nothing rings, nothing echoes, and nothing runs past ~450ms, so no
// sound is ever still sounding by the time the next thing happens.
//
// There is deliberately NO delay/reverb bus. An echo puts a sound in a room, and a room is the
// opposite of tactile: the tail smears one cue into the next and is most of what makes overlapping
// effects read as mush.

const STORAGE_KEY = 'crazypixel:sound';

/**
 * Master level, about -13 dBFS. Low on purpose, and there is no boost option: a screen reader
 * user runs system volume high because speech is their primary output, and a game normalized
 * anywhere near full scale is physically painful on a machine set up that way.
 */
const MASTER_GAIN = 0.22;

/** Silence between two consecutive sounds, so they read as two events rather than one blur. */
const VOICE_GAP = 0.03;

/**
 * How long a sound may be pushed back to wait its turn, by priority. Past this it is dropped
 * instead: a cue that arrives long after the thing it describes is worse than no cue, because
 * the player attaches it to whatever happened next.
 *
 * Chrome gives up almost immediately - nobody misses a click tick. An actionable cue waits as
 * long as it takes, because "it's your turn" arriving late still beats it never arriving, and
 * the longest sound in the catalogue is only 0.42s.
 */
const MAX_DEFER: Record<0 | 1 | 2, number> = { 0: 0.09, 1: 0.2, 2: 0.6 };

/**
 * Keys that do NOT count as a user activation, so resuming on them fails. Escape is excluded
 * by the HTML spec outright; a bare modifier never activates on its own either.
 */
const NON_ACTIVATING_KEYS = new Set(['Escape', 'Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);

export type SoundId =
  | 'cardPlay'
  | 'kill'
  | 'boardEnter'
  | 'swap'
  | 'copy'
  | 'steal'
  | 'joker'
  | 'homeEnter'
  | 'yourTurn'
  | 'timerWarning'
  | 'deal'
  | 'win'
  | 'emote'
  | 'uiClick'
  | 'uiBack';

interface Nodes {
  ctx: AudioContext;
  /** Everything lands here, so one gain flips the whole game silent. */
  master: GainNode;
}

let lastStepAt = 0;
let nodes: Nodes | null = null;
let enabled = loadEnabled();
let primed = false;

function loadEnabled(): boolean {
  try {
    // Absent means never set, and the default is on - only an explicit '0' mutes.
    return window.localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true; // Safari private mode throws on localStorage access rather than no-oping.
  }
}

/**
 * Builds the graph on first use. Constructing an AudioContext before a user gesture leaves it
 * 'suspended' in every current browser, so this is called from primeAudio (a real gesture) and
 * again lazily from play() - by which point a gesture has always happened, since nothing in
 * this game makes a sound that wasn't started by one.
 */
function ensureNodes(): Nodes | null {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null; // No Web Audio: the game is silent, not broken.
  if (nodes) return nodes;

  const ctx = new Ctor();

  const master = ctx.createGain();
  master.gain.value = MASTER_GAIN;

  // Backstop only, for the rare case the scheduler still lets two voices touch. It is not a
  // licence to ignore the gain budget - leaning on it makes every busy moment audibly pump.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.1;

  // Square and saw voices roll off at only -6dB/octave, so even a low blip has real energy past
  // 10kHz - both the harshest band for hyperacusis and the band carrying the consonants of
  // whatever a screen reader is saying over the top of it. Rolling off here keeps the low
  // harmonics that give these their bite and drops the part that only ever hurt.
  const tame = ctx.createBiquadFilter();
  tame.type = 'lowpass';
  tame.frequency.value = 5200;

  master.connect(limiter);
  limiter.connect(tame);
  tame.connect(ctx.destination);

  nodes = { ctx, master };
  return nodes;
}

/**
 * Resumes the context from a real user gesture. Registered on both pointerdown and keydown so a
 * keyboard-only player unlocks audio the same way a tapping one does - a pointer-only unlock
 * would leave the game permanently silent for anyone driving it from the keyboard.
 */
export function primeAudio(): void {
  if (primed) return;
  primed = true;

  // keydown as well as pointerdown, because a player driving the game from the keyboard never
  // produces a pointer event and would otherwise get a permanently silent game with no way to
  // fix it. Not { once: true }: Escape and the bare modifiers don't grant activation, so a
  // one-shot listener burned on Shift would lock audio off for the rest of the session.
  // Capture phase so a stopPropagation anywhere in the tree can't starve it.
  const events = ['pointerdown', 'keydown'] as const;
  const unlock = (event: Event) => {
    if (event instanceof KeyboardEvent && NON_ACTIVATING_KEYS.has(event.key)) return;
    const built = ensureNodes();
    if (!built) return;
    void built.ctx.resume().then(() => {
      if (built.ctx.state !== 'running') return;
      for (const type of events) window.removeEventListener(type, unlock, true);
    }).catch(() => {
      // Stays armed; the next gesture tries again.
    });
  };
  for (const type of events) window.addEventListener(type, unlock, true);

  // A backgrounded tab is still a live game: the turn clock keeps running on setInterval (rAF
  // throttling doesn't touch it - see TurnTimerBar), and online the server keeps sending moves
  // either way. Without this a hidden tab carries on making noise at someone who has no idea
  // which of forty tabs it is coming from.
  //
  // Suspending frees the audio device and freezes anything already scheduled, but it only
  // covers tabs that were visible and then hidden - see the hidden check in play() for the
  // other half.
  document.addEventListener('visibilitychange', () => {
    if (!nodes) return;
    if (document.hidden) void nodes.ctx.suspend();
    else if (enabled) void nodes.ctx.resume();
  });
}

export function isSoundEnabled(): boolean {
  return enabled;
}

const listeners = new Set<(on: boolean) => void>();

/**
 * Keeps every mounted SoundToggle agreeing with the one preference. The lobby's and the board's
 * toggles are never on screen at the same time today, but a stale one would flip the setting
 * back to whatever it last remembered the moment it mounted.
 */
export function subscribeSound(listener: (on: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  for (const listener of listeners) listener(on);
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    // The preference just doesn't persist - not worth failing the toggle over.
  }
  if (!on) return;
  // Switching sound on is itself the gesture, so take it: otherwise the first sound after an
  // unmute is swallowed by a still-suspended context and the toggle looks broken.
  const built = ensureNodes();
  if (built && built.ctx.state === 'suspended') void built.ctx.resume();
}

// --- Voices -----------------------------------------------------------------

interface ToneSpec {
  type: OscillatorType;
  /** Start frequency in Hz. */
  freq: number;
  /** Swept to over the tone's life. Omit for a flat pitch. */
  toFreq?: number;
  dur: number;
  gain: number;
  /** Absolute context time to start at. */
  at: number;
}

function tone(n: Nodes, spec: ToneSpec): void {
  const { ctx } = n;
  const start = spec.at;
  const end = start + spec.dur;

  const gain = ctx.createGain();
  // 4ms, not 0: a gain step is a broadband transient, which is both an audible click and - fast
  // rise plus high-frequency content - the shape of a startle stimulus. Short enough that these
  // still read as struck rather than faded in. Ramping to 0.0001 rather than 0 at the tail is
  // not a rounding quirk either; exponentialRampToValueAtTime rejects a zero target outright.
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(spec.gain, start + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  gain.connect(n.master);

  const osc = ctx.createOscillator();
  osc.type = spec.type;
  osc.frequency.setValueAtTime(spec.freq, start);
  if (spec.toFreq !== undefined) {
    // Exponential, not linear: pitch is perceived logarithmically, and a linear sweep between
    // two octaves spends most of its time sounding like the top one. On these durations the
    // drop is what makes a voice read as a struck object rather than a beep.
    osc.frequency.exponentialRampToValueAtTime(Math.max(spec.toFreq, 1), end);
  }
  osc.connect(gain);
  osc.start(start);
  osc.stop(end + 0.02);
}

interface NoiseSpec {
  dur: number;
  gain: number;
  at: number;
  type?: BiquadFilterType;
  freq: number;
  /** Swept to over the burst's life, for scrapes. */
  toFreq?: number;
  q?: number;
}

/**
 * One-shot filtered white noise. This is the "contact" layer - the bit of every sound that says
 * two things touched, as opposed to the tone underneath it that says what they were.
 */
function noise(n: Nodes, spec: NoiseSpec): void {
  const { ctx } = n;
  const start = spec.at;
  const end = start + spec.dur;

  const frames = Math.max(1, Math.ceil(ctx.sampleRate * spec.dur));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;

  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = spec.type ?? 'bandpass';
  filter.frequency.setValueAtTime(spec.freq, start);
  if (spec.toFreq !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(spec.toFreq, 1), end);
  }
  if (spec.q !== undefined) filter.Q.value = spec.q;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(spec.gain, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(n.master);

  src.start(start);
  src.stop(end + 0.02);
}

/**
 * The building block almost everything here is made of: a struck object. A noise transient for
 * the contact, over a body whose pitch drops fast. `weight` moves it from a light tap (0) to a
 * heavy thud (1) by lowering the body and lengthening the decay.
 */
function knock(n: Nodes, at: number, freq: number, gain: number, weight = 0.5): void {
  const dur = 0.05 + weight * 0.11;
  tone(n, { type: weight > 0.6 ? 'sine' : 'triangle', freq, toFreq: freq * 0.35, dur, gain, at });
  noise(n, { at, dur: 0.018, gain: gain * 0.35, type: 'bandpass', freq: 1800 + (1 - weight) * 1800, q: 0.8 });
}

// --- The catalogue ----------------------------------------------------------
//
// Each entry gets the absolute context time the scheduler assigned it and lays its own layers
// out from there. Entries are distinguishable by SHAPE - one hit vs two, heavy vs light, rising
// vs falling - not by pitch alone, so they stay apart for a player who can't easily tell two
// close pitches apart, and over a phone speaker.
//
// `dur` is what the scheduler reserves, and `priority` is who wins when two want the same
// moment: 2 is actionable (it is your turn, your clock is running out, a marble died), 1 is a
// move that happened, 0 is chrome.

interface Entry {
  dur: number;
  priority: 0 | 1 | 2;
  render: (n: Nodes, at: number) => void;
}

const CATALOGUE: Record<SoundId, Entry> = {
  /** A card leaving your hand. The most-played sound in the game, so the lightest: a flick. */
  cardPlay: {
    dur: 0.09, priority: 1,
    render: (n, at) => {
      noise(n, { at, dur: 0.035, gain: 0.26, type: 'bandpass', freq: 2600, toFreq: 1100, q: 0.9 });
      knock(n, at, 320, 0.3, 0.25);
    },
  },

  /** A capture. The heaviest thing in the game and the only one with real low end - a body hitting the floor. */
  kill: {
    dur: 0.24, priority: 2,
    render: (n, at) => {
      knock(n, at, 190, 0.62, 1);
      noise(n, { at, dur: 0.09, gain: 0.3, type: 'lowpass', freq: 1600, toFreq: 300 });
      // A second, smaller bounce. Two impacts is what stops this reading as a plain beep.
      knock(n, at + 0.1, 130, 0.26, 0.9);
    },
  },

  /** A marble landing on the board out of its base. One firm knock, placed down. */
  boardEnter: {
    dur: 0.15, priority: 1,
    render: (n, at) => {
      knock(n, at, 240, 0.5, 0.7);
      noise(n, { at: at + 0.012, dur: 0.03, gain: 0.16, type: 'highpass', freq: 2200 });
    },
  },

  /**
   * A Jack swap. Two knocks at different pitches, close together - the two marbles trading
   * places. Deliberately not a pitch sweep: a swap is two discrete objects, and two taps say
   * that in a way a glide never does.
   */
  swap: {
    dur: 0.19, priority: 1,
    render: (n, at) => {
      knock(n, at, 420, 0.4, 0.35);
      knock(n, at + 0.075, 280, 0.4, 0.45);
    },
  },

  /**
   * An 8 replaying the last card. The same knock twice, the second quieter and tighter behind
   * the first - the sound is a copy of itself, which is exactly what the card does.
   */
  copy: {
    dur: 0.17, priority: 1,
    render: (n, at) => {
      knock(n, at, 360, 0.42, 0.35);
      knock(n, at + 0.085, 360, 0.2, 0.35);
    },
  },

  /** A blind steal. A short scrape, then the grab. */
  steal: {
    dur: 0.2, priority: 1,
    render: (n, at) => {
      noise(n, { at, dur: 0.085, gain: 0.24, type: 'bandpass', freq: 2800, toFreq: 700, q: 1.4 });
      knock(n, at + 0.08, 200, 0.42, 0.8);
    },
  },

  /** A Joker standing in for another rank. Three micro-ticks rising - a riffle, not a shimmer. */
  joker: {
    dur: 0.16, priority: 1,
    render: (n, at) => {
      for (let i = 0; i < 3; i += 1) knock(n, at + i * 0.045, 380 + i * 130, 0.26, 0.2);
    },
  },

  /** A marble seating into its home slot. Low thunk, then the click of it settling. */
  homeEnter: {
    dur: 0.22, priority: 1,
    render: (n, at) => {
      knock(n, at, 220, 0.5, 0.85);
      noise(n, { at: at + 0.09, dur: 0.025, gain: 0.14, type: 'highpass', freq: 3000 });
    },
  },

  /**
   * Your turn. Deliberately the most restrained cue in the game: it fires every single round,
   * and anything with a melody or a rise to it turns into a nag by the third turn. One soft low
   * thump - felt more than heard, enough to look up at.
   */
  yourTurn: {
    dur: 0.15, priority: 2,
    render: (n, at) => {
      tone(n, { type: 'sine', freq: 150, toFreq: 96, dur: 0.13, gain: 0.3, at });
    },
  },

  /**
   * The turn clock running out. One soft falling tick, quieter than everything except the step.
   * An escalating heartbeat would drive arousal without carrying a bit more information, right
   * in the window where the player is trying to think; the bar already escalates visually.
   */
  timerWarning: {
    dur: 0.14, priority: 2,
    render: (n, at) => {
      tone(n, { type: 'triangle', freq: 560, toFreq: 380, dur: 0.12, gain: 0.2, at });
    },
  },

  /** Dealing a round. Four riffle ticks - card edges, no pitch. */
  deal: {
    dur: 0.2, priority: 0,
    render: (n, at) => {
      for (let i = 0; i < 4; i += 1) {
        noise(n, { at: at + i * 0.045, dur: 0.03, gain: 0.17, type: 'bandpass', freq: 2000 + i * 260, q: 0.9 });
      }
    },
  },

  /** Game over. Three rising knocks - a drum fill, not a jingle. The longest sound at ~0.42s. */
  win: {
    dur: 0.42, priority: 2,
    render: (n, at) => {
      knock(n, at, 220, 0.5, 0.8);
      knock(n, at + 0.11, 300, 0.5, 0.7);
      knock(n, at + 0.22, 400, 0.55, 0.55);
    },
  },

  /** An emote arriving. The quietest thing in the game - it fires on someone else's whim. */
  emote: {
    dur: 0.08, priority: 0,
    render: (n, at) => {
      knock(n, at, 620, 0.16, 0.15);
    },
  },

  uiClick: {
    dur: 0.05, priority: 0,
    render: (n, at) => {
      knock(n, at, 520, 0.22, 0.15);
    },
  },

  uiBack: {
    dur: 0.06, priority: 0,
    render: (n, at) => {
      knock(n, at, 340, 0.22, 0.2);
    },
  },
};

// --- Scheduling -------------------------------------------------------------

/**
 * Checked per sound rather than relying on the visibilitychange listener alone. That listener
 * only fires on a TRANSITION, so a tab that was already in the background when the game started
 * - opened in a background tab, or restored by a session reopen - never got suspended and went
 * on making noise indefinitely, with the turn clock feeding it a move every 20 seconds. Reading
 * document.hidden at the point of use is cheap and can't miss a state nothing announced.
 */
function isHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden;
}

/** Context time the last scheduled voice finishes. */
let busyUntil = 0;

/**
 * Fires one sound, or does nothing at all if sound is off, unsupported, or the context never
 * got its gesture. Never throws and never returns a promise: a caller in the middle of an
 * animation frame or a Phaser tween must not have to care whether audio worked.
 *
 * Sounds are laid end to end rather than allowed to pile up. Two events genuinely can land in
 * the same frame - a 7-split that captures, a card played as an emote arrives - and played on
 * top of each other they stop being two events and become one smear. So a sound that arrives
 * while another is still going waits its turn, unless
 *   - waiting would push it past MAX_DEFER, in which case it is dropped rather than arriving
 *     late enough to be attached to the wrong thing, or
 *   - it matters more than what is currently playing, in which case it goes now regardless.
 *     Missing "it's your turn" to protect a UI click is the wrong trade.
 */
export function play(id: SoundId): void {
  if (!enabled || isHidden()) return;
  const n = ensureNodes();
  if (!n || n.ctx.state !== 'running') return;

  const entry = CATALOGUE[id];
  const now = n.ctx.currentTime;
  // Playback drifts past a scheduled end by a frame or two; without this the reservation from a
  // sound that finished minutes ago would still be in the future after a tab suspend/resume.
  if (busyUntil < now) busyUntil = now;

  // Nothing ever starts on top of something else, whatever its priority. An important sound
  // played over a running one does not read as important, it reads as a glitch - and the two
  // together are the mush this queue exists to prevent. Priority buys patience, not the right
  // to interrupt.
  let at: number;
  if (busyUntil <= now) {
    at = now;
  } else if (busyUntil + VOICE_GAP - now <= MAX_DEFER[entry.priority]) {
    at = busyUntil + VOICE_GAP;
  } else {
    return;
  }

  try {
    entry.render(n, at);
  } catch {
    // A browser refusing to build a node mid-game is not worth taking the turn down over.
    return;
  }
  busyUntil = Math.max(busyUntil, at + entry.dur);
}

/**
 * The tick a marble makes crossing one square.
 *
 * Outside the scheduler on purpose, and the only sound that is: it is texture rather than an
 * event, it runs continuously underneath whatever else is happening, and feeding it through the
 * queue would either starve every real cue for the length of a walk or drop most of the walk.
 * It is quiet and short enough to sit under another voice without muddying it.
 */
export function playStep(index: number): void {
  // TableScene walks a marble one square per WALK_STEP_MS (55ms), which is ~18 ticks a second -
  // below the ~20Hz where clicks fuse into a tone, so they stay individually audible as a
  // rattle. That is the worst band for repetitive transients, and a 13-step King would park one
  // over the whole window in which a screen reader is reading the move out. Gating to 110ms
  // halves it to something that still reads as motion. The gate is global rather than
  // per-marble on purpose: a split 7 walks up to four marbles at once, and four concurrent
  // trains must not multiply the rate.
  if (!enabled || isHidden()) return;
  const n = ensureNodes();
  if (!n || n.ctx.state !== 'running') return;
  const now = n.ctx.currentTime;
  if (now - lastStepAt < 0.11) return;
  lastStepAt = now;
  try {
    // Caps at 12 squares: a 13-step King would otherwise climb out of the range where this
    // still reads as the same sound.
    const rise = Math.min(index, 12) * 18;
    // A bare tick with no noise layer. This is the most frequent sound in the game, so it is
    // also the one whose harmonics have the most chances to land on top of speech.
    tone(n, { type: 'triangle', freq: 420 + rise, toFreq: 240 + rise, dur: 0.028, gain: 0.11, at: now });
  } catch {
    // See play().
  }
}
