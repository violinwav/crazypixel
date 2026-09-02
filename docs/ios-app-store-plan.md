# CrazyPixel on the App Store — the real shipping plan

Written 2026-09-02. Companion to [`ios-port-options.md`](./ios-port-options.md), which covers
*how to build* an iOS app. This one covers *how to actually get it listed and downloaded*.

---

## Verdict

Yes, this ships. Capacitor + App Store is a realistic goal, and this codebase is in unusually
good shape for it — better than I assumed before reading the code.

**Cost:** $99/yr (Apple Developer Program) + ~$5–20/mo hosting. Nothing else is mandatory.

**Timeline:** ~4–6 weeks of part-time work to a live listing. Two of those weeks are the
reconnect + server-hardening work, which you'd want anyway.

**Hard requirement:** a Mac with Xcode. There is no way around this for App Store submission.
(Cloud-Mac CI like Xcode Cloud or Codemagic exists, but you'll want a local Xcode for
debugging device-only problems regardless.)

---

## The good news first — three things you already got right

These are the ones that normally sink hobby games at review:

**1. Emotes are a closed list, not free text.**
`packages/shared/src/emotes.ts` is 10 fixed kaomoji, and `GameRoom.handleEmote` validates the
incoming id against that list before broadcasting — a client physically cannot put arbitrary
text on someone else's screen. That means **App Store Guideline 1.2 (user-generated content)
does not apply**. No moderation system, no report-abuse flow, no block-user feature, no
24-hour takedown SLA. That's weeks of work you don't have to do. The comment at the top of
`emotes.ts` already gives the reasoning — that reasoning is now also your review defense.

**2. Local hotseat works with zero network.**
Guideline 4.2 ("minimum functionality") is the #1 rejection reason for anything built in a
WebView. The standard failure is an app that's a blank screen without a connection. Yours
plays a full game offline. **Lead with this in your review notes.**

**3. No accounts, no persistence, no logging.**
`packages/server/src/index.ts` — "no persistence" is literally the first line. The only
`console.log` is a startup message. Nothing is written to disk, nothing about a player
survives the room. This means:
- You can claim **"Data Not Collected"** on the privacy nutrition label. That's the simplest
  possible privacy review.
- Guideline 5.1.1(v) (mandatory account deletion) doesn't apply — there are no accounts.
- No Sign in with Apple requirement — that only triggers on third-party login.

Also worth noting: `BoardOverlay.tsx` renders real `<button>` elements for every legal move,
and every emote carries a spoken `label` for screen readers. VoiceOver-playable is rare for a
board game and is a genuine differentiator in the listing.

---

## The blockers, ranked

### 1. The name. This is the biggest risk and it's legal, not technical.

`README.md` describes the project as *"a pixel-art web clone of **Brändi Dog**"*. That framing
is fine for a GitHub repo. It is **not** fine for an App Store listing.

- **"Brändi Dog" is a trademark of Stiftung Brändi.** Trademark protects the *name* and
  branding regardless of the fact that game rules aren't copyrightable.
- Your README's disclaimer is correct on the law (rules aren't copyrightable, your art and
  copy are original) and it's the right instinct. But a disclaimer does not license the mark.
- Apple's Guideline 5.2 hands the decision to the complainant: if Stiftung Brändi files an
  IP complaint, Apple pulls the app and tells the two of you to sort it out. There is no
  appeal process worth the name.

**What to do:**
- App name stays **CrazyPixel**. It's distinctive and unencumbered — good instinct already.
- **Never** put "Brändi", "Brändi Dog", or "Dog" (as the game's name) in the App Store title,
  subtitle, keywords field, description, or screenshots. Not even as "inspired by."
- Describe it functionally: *"a pixel-art marble-race card game for 2–6 players."*
- Keep the README disclaimer for the repo. Don't reproduce it in the listing — it names the
  mark, which is exactly what you're avoiding.
- The house rules ("split sevens", "blind steal", "wild joker") are your own and are safe to
  market on.

Realistically: a Swiss foundation is unlikely to be watching the App Store. But this is the
one risk that can erase the work after it's live, so treat the naming rule as absolute.

### 2. Display names are your only unvalidated free-text field

`GameRoom.ts:196`:
```ts
this.state.playerNames.push(options.displayName?.trim() || `Player ${seatIndex + 1}`);
```

No length cap, no type guard beyond optional chaining, no filter. A client can join with a
10,000-character name, or a slur, and it renders on five other people's screens. Every other
message in that file is carefully re-derived server-side — this one isn't.

It's a small surface (names are only visible to the 4–6 people who already have your room
code), so it does **not** pull you into full Guideline 1.2 territory. But fix it anyway:

- Hard cap at ~16 characters, server-side, on `onJoin`.
- Reject non-strings explicitly rather than relying on `?.trim()`.
- Strip control characters and zero-width joiners.
- A basic profanity wordlist is optional — worth 20 minutes if you want to preempt the
  question entirely.

**Half a day of work. Do it before submitting.**

### 3. Reconnect after disconnect — still the largest item

Covered in `ios-port-options.md`, restated here because App Store users make it worse than
TestFlight friends do:

iOS suspends the WebView when the app backgrounds or the phone locks. The WebSocket dies.
Per `CLAUDE.md`, a dropped seat currently *"just freezes mid-game"*, and if it's seat 0 that
dropped, **nobody in the room can even start a rematch**.

For a friend group on desktop, that's an annoyance someone works around. For strangers who
downloaded your app, it's a one-star review and an uninstall. Every incoming call, every
notification tap, every "let me check something" produces it.

Needs: `allowReconnection()` in `GameRoom.ts`, a persisted `sessionId` in `localStorage`
(you already have the identity-persistence pattern in `playerIdentity.ts` to copy), a
"reconnecting…" UI state, and a reasonable grace window before the seat is released.

**2–4 days. This is the item that decides whether people keep the app.**

### 4. Rooms die on every deploy

Also from `index.ts`: rooms are in-memory and vanish when the process restarts. With three
friends, you deploy when nobody's playing. With real users, there is no such window — every
push kills every live game mid-turn.

You don't need a database. You need:
- Colyseus graceful shutdown (stop accepting new rooms, let existing ones drain).
- Deploy during low traffic, or accept the drain wait.
- Combined with #3, a redeploy becomes survivable instead of fatal.

### 5. Safe areas, orientation, iPad

- **Safe areas:** zero `env(safe-area-inset-*)` in `theme.css` today. The notch and home
  indicator will overlap the board and hand panel on every modern iPhone. Needs
  `viewport-fit=cover` in `index.html` plus inset padding on the outer chrome.
- **Orientation:** decide and lock it. A 2–6 player board game passed around a phone is
  probably portrait-locked; if you allow rotation, every rotation must survive
  `computeBoardGeometry` cleanly and you have to test it.
- **iPad:** if you don't explicitly restrict to iPhone, Apple reviews it on an iPad and
  rejects layout breakage. Either mark the app iPhone-only in Xcode (simplest, and honest —
  hotseat on a shared iPad is actually a *great* use case you could add later), or test the
  layout at 1024×1366 properly.

### 6. WebView feel

A WebView that scrolls, bounces, and lets you long-press-select text reads as a website, not
a game — and that perception is part of what Guideline 4.2 reviewers react to.

- `Capacitor` config: `ScrollEnabled: false`.
- `-webkit-user-select: none` and `-webkit-touch-callout: none` globally.
- `touch-action` is already set in 4 places in `theme.css` — needs to be comprehensive.
- Verify `navigator.clipboard` (the room-code copy) works in WKWebView, or swap to
  `@capacitor/clipboard`.

---

## Submission checklist

Things App Store Connect will not let you past without:

- [ ] **Apple Developer Program enrollment** — $99/yr. Individual is fine. Allow a few days;
      identity verification can be slow.
- [ ] **Bundle ID** — e.g. `com.yourname.crazypixel`, registered in the developer portal.
- [ ] **App icon** — 1024×1024, no alpha, no rounded corners (Apple rounds it). Your sprite
      pipeline (`generate-sprites.py`) can produce this; keep it in the same palette.
- [ ] **Launch screen** — native, not an HTML splash. It shows before the WebView loads, and
      the gap is visible if you skip it.
- [ ] **Screenshots** — check App Store Connect for the currently required sizes (Apple has
      been reducing these; it's roughly one modern iPhone size, plus iPad if you support it).
      Real gameplay, not mockups.
- [ ] **Privacy policy URL** — mandatory for every app, even one that collects nothing. A
      short static page saying "this app collects no data" is sufficient and honest here.
- [ ] **Support URL** — mandatory. A GitHub Issues link or a one-page site works.
- [ ] **Privacy nutrition label** — "Data Not Collected". Verify this stays true if you ever
      add analytics or crash reporting.
- [ ] **Age rating questionnaire** — answer honestly. Two emotes are ASCII-art firearms
      (`╾━╤デ╦︻`, "Taking aim" / "Returning fire"). That is text art, not depicted violence,
      but read the questions rather than reflexively answering "none."
- [ ] **Export compliance** — `ITSAppUsesNonExemptEncryption = false` in `Info.plist`. You use
      only standard TLS, which is exempt. Setting this in the plist skips a manual prompt on
      every single build upload.
- [ ] **Review notes** — tell them explicitly: *"Tap 'Local game' from the main menu to play
      the full game with no network connection or account. Online play uses a shared room
      code; a second device is not required to evaluate the app."* Reviewers reject what they
      can't figure out how to test.
- [ ] **Test on a real device.** The Simulator does not reproduce WKWebView memory behavior,
      touch latency, or backgrounding.

Not applicable to you (worth knowing so you don't chase them): In-App Purchase (free app, no
monetization), Sign in with Apple (no third-party login), account deletion (no accounts),
Guideline 1.2 UGC machinery (closed emote list), Kids Category rules (don't opt in).

---

## Running it for real users

**Hosting:** Fly.io or Railway, ~$5–20/mo. Single region is fine — turn-based card game, and
a 150ms RTT is invisible when the interaction is "play a card." Needs a real TLS cert so the
client reaches `wss://`, which both platforms give you free.

**Scale:** a single Colyseus process on a small instance handles hundreds of concurrent rooms
for a game this light. `stateJson` re-serializes the whole `GameState` per patch, which is
wasteful but irrelevant at this size. You will run out of users long before you run out of
server.

**Set `VITE_SERVER_URL` at build time.** From a Capacitor app the page origin is
`capacitor://localhost`, so `resolveServerUrl()`'s hostname-derivation tricks in
`network.ts` cannot work — the explicit override stops being a fallback and becomes the only
path. Check that function handles the Capacitor origin without producing a garbage URL.

**Add crash reporting only if you're willing to update the privacy label.** Sentry et al. are
"Data Collected." For v1, the value isn't worth losing the clean "Data Not Collected" claim.

---

## The uncomfortable part: "people actually downloading it"

Getting *listed* is the part with a checklist. Getting *downloaded* doesn't have one.

An unmarketed game on the App Store gets approximately zero organic installs. Not few —
zero. Nobody browses the App Store for board games; there are hundreds of thousands of apps
and search is dominated by titles with marketing budgets. Shipping the app is necessary and
nowhere near sufficient.

What actually moves installs for a game like this:

- **A specific community, not a general audience.** There is a real, identifiable population
  of Brändi Dog players — Swiss, German, and Dutch board-game communities, plus the family
  networks around them. They are currently underserved on mobile. That's your entire market
  and it's a good one. Find where they are (Reddit, BoardGameGeek forums, Facebook groups,
  Swiss board-game clubs) and show up as a player, not an ad. **Careful:** this is exactly
  where you'll be tempted to say "it's a Brändi Dog app" for discoverability. In a forum
  post, describing it accurately is defensible in a way the App Store listing is not — but
  it's also how a trademark holder finds you. Your call; know the tradeoff.
- **The room code is your growth loop.** One person downloads, five friends have to. That is
  by far the strongest thing you have, and it argues for making the join flow ruthlessly
  smooth: a universal link (`crazypixel.app/r/ABCD`) that opens the app straight into the
  room, or offers the App Store if it's not installed. Worth building — it converts a text
  message into an install.
- **Localization.** German first. The target community is German-speaking, and a German
  listing costs one afternoon and meaningfully changes App Store search.
- **Show, don't describe.** Pixel art demos well. A 15-second screen recording of a 7-split
  animation does more than any description. The App Preview video slot is underused by
  small apps.
- **Set expectations honestly.** Realistic first year for a well-made unmarketed niche game
  with an active creator in the right communities: hundreds to low thousands of installs.
  That is a success. Judge it against "my friends and a real community play this regularly,"
  not against a chart position.

One product note: right now you need 2–6 humans simultaneously. No solo mode, no AI opponent,
no async play. That means a lone downloader who finds you through search opens the app, has
nobody to play with, and leaves. **A single AI opponent would change the download-to-retained
ratio more than any marketing tactic** — and your architecture makes it unusually cheap to
build, because `getLegalMoves(state, player, card)` already enumerates every legal move. A
random-legal-move bot is an afternoon. A greedy one that prefers captures and home entries is
a weekend. Consider it before launch, not after.

---

## Suggested sequence

| Phase | Work | Time |
|---|---|---|
| **0** | PWA manifest + icons; play a real game on your phone from the home screen | half a day |
| **1** | Reconnect + graceful shutdown + display-name validation | ~1 week |
| **2** | Safe areas, orientation lock, WebView feel, clipboard | 2–3 days |
| **3** | Apple enrollment (start early — verification lags), bundle ID, icon, launch screen | 2–3 days, mostly waiting |
| **4** | Capacitor setup, device build, TestFlight to friends | 2 days |
| **5** | Screenshots, privacy policy page, listing copy, review notes, submit | 2–3 days |
| **6** | *Optional but recommended before launch:* AI opponent, universal links, German listing | 1–2 weeks |

Phase 0 is the highest-value half-day in the list: it tells you whether the game is actually
fun on a phone before you've spent a franc or filed a single form.

**Start Apple enrollment in parallel with Phase 1** — the payment clears fast, the identity
verification doesn't always, and it's pure dead time you can overlap with real work.
