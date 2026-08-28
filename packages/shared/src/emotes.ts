/** The fixed emote catalogue - the only chat "messages" this game has. A closed list rather
 * than free text: the room is four-to-six friends who mostly already know each other, and a
 * text field would need moderation, length limits, and an on-screen keyboard covering the
 * hand panel on exactly the device (a phone) this is most played on. */
export interface Emote {
  /** Stable wire id. Clients send this, never the glyphs - the server matches it against
   * this list before broadcasting, so no client can put arbitrary text on another player's
   * screen. Renaming one is a protocol break; add a new id instead. */
  id: string;
  /** The kaomoji itself. Rendered in a system font, not the app's Departure Mono - that face
   * covers only 1 of these 10 (it has no kana, CJK, Mongolian or Samaritan glyphs), and a
   * per-glyph browser fallback would draw half of one kaomoji in each face at mismatched
   * widths and baselines. See .emote__glyph in theme.css. */
  text: string;
  /** Spoken form. Kaomoji read as a stream of character names to a screen reader ("white
   * circle with dot right, low line, ...") - this is what actually gets announced, and what
   * labels the button in the picker. */
  label: string;
}

export const EMOTES: readonly Emote[] = [
  { id: 'wonk', text: '(☉ ‿ ⚆)', label: 'Wonky grin' },
  { id: 'smug', text: '( •͡˘ _•͡˘)', label: 'Smug' },
  { id: 'cry', text: '(╥﹏╥)', label: 'Crying' },
  { id: 'shock', text: '(⚆_⚆)', label: 'Shocked' },
  { id: 'blank', text: '(°_°)', label: 'Blank stare' },
  { id: 'rude', text: '凸(¬‿¬)凸', label: 'Rude' },
  { id: 'shrug', text: '¯\\_(ツ)_/¯', label: 'Shrug' },
  { id: 'hug', text: '⊂(◉‿◉)つ', label: 'Hug' },
  { id: 'aim', text: '╾━╤デ╦︻ (•_- )', label: 'Taking aim' },
  { id: 'fire', text: '( -_•) ᡕᠵデᡁࠣ亠', label: 'Returning fire' },
];

export function emoteById(id: string): Emote | undefined {
  return EMOTES.find((e) => e.id === id);
}
