# CrazyPixel → iOS: options and reuse analysis

Written 2026-09-02. Based on the actual repo at `main` (commit `5fac188`), not on guesses.

---

## TL;DR

**Capacitor is the answer.** It wraps the existing Vite build in a native iOS shell,
reuses ~100% of the code, and gets you on TestFlight in a couple of days. Everything else
(React Native, native Swift) means rewriting the entire client for zero gameplay benefit.

The real work is **not** the packaging. It's three things the web version currently gets
away with and an iOS app cannot:

1. **Reconnect after disconnect** — not implemented today (`CLAUDE.md` says so explicitly).
   On a phone, the OS suspends the WebView on lock/backgrounding and the WebSocket dies.
   Today that freezes the seat permanently. This is the single biggest blocker.
2. **TLS on the server** — iOS App Transport Security blocks plain `ws://`. Server must be
   `wss://` behind a real cert.
3. **App Store Guideline 4.2** — a thin "website in a box" gets rejected. It needs to feel
   like an app (native splash, icon, no browser chrome, offline-ish behavior, no visible URL).

---

## What the codebase actually looks like

| Package | LOC | Deps | Portability |
|---|---|---|---|
| `shared` | **915** | **zero runtime deps** | Pure TS, no DOM. Runs anywhere JS runs. |
| `client` | **7,640** (5,807 TS/TSX + 1,833 CSS) | Phaser, React, colyseus.js | Web-only rendering. |
| `server` | **483** | Colyseus, Express | Unchanged in every option. Stays a Node server. |

Client breakdown that matters for the port:

- `game/scenes/TableScene.ts` — **877 LOC** of Phaser canvas drawing (board, marbles, cards)
- `GameBoard.tsx` + `BoardOverlay.tsx` — **1,031 LOC** of React DOM sitting on top of the canvas
- `styles/theme.css` — **1,833 LOC**
- ~30 smaller React components (overlays, animations, lobby, emotes) — ~3,000 LOC
- `game/network.ts` — 152 LOC of Colyseus wiring

Browser APIs actually used (all fine in WKWebView):
`getBoundingClientRect` ×13, `requestAnimationFrame` ×8, `document.addEventListener` ×4,
`localStorage` ×5, `window.matchMedia` ×1, `navigator.clipboard` ×1, `ResizeObserver`.

Two pieces of good news already in the code:
- **No `vh` units anywhere.** The classic iOS "100vh is wrong under the URL bar" bug can't
  bite. Layout is flex/percent throughout.
- **`touch-action` is already set** in four places, so mobile browsers are clearly already
  a target.

---

## Option 1 — Capacitor (recommended)

Ionic's Capacitor. Your existing `vite build` output loads inside a `WKWebView` in a real
Xcode project you own and check in.

**Reuse: ~100%.** Zero lines of game code rewritten.

| Pros | Cons |
|---|---|
| Ships this week, not this quarter | Rendering is still Canvas2D in a WebView — not native perf |
| Real Xcode project, real `.ipa`, real App Store listing | Needs Apple Developer Program ($99/yr) + a Mac |
| Native plugins available (haptics, push, StatusBar, safe area) as needed | 4.2 rejection risk if it feels like a bookmark |
| Single codebase — web and iOS stay in lockstep forever | WebView JIT is fine on iOS, but memory limits are real (not an issue at this scale) |
| Android is then a `npx cap add android` away | Adds a native build step to the release process |

**Perf sanity check:** the board is a static tile grid + ≤16 marbles + a hand of cards on a
Canvas2D renderer. That is nothing. It will hold 60fps on any iPhone from the last 8 years.
`Phaser.CANVAS` (deliberate, per `CLAUDE.md`) is if anything *safer* in a WebView than WebGL.

---

## Option 2 — PWA / Add to Home Screen (zero-cost fallback)

No wrapper at all. Add a web app manifest, `apple-mobile-web-app-capable`, icons. User taps
Share → Add to Home Screen and gets a full-screen icon-launched app.

**Reuse: 100%. Effort: half a day.**

| Pros | Cons |
|---|---|
| Almost free | **Not in the App Store.** Discovery is word-of-mouth only |
| No Apple Developer account, no review, ship anytime | Install flow is a multi-step manual ritual users don't know |
| Web Push works on iOS 16.4+ for home-screen PWAs | No native haptics, no Game Center |

Worth doing **regardless** — it's the cheapest way to test whether the game feels right on a
phone before spending money on Apple. And the manifest/icon work is reused by Capacitor
anyway.

---

## Option 3 — React Native / Expo

Rewrite the client in RN. **Phaser does not exist for React Native** — no DOM, no canvas.
The 877-line `TableScene` would be rebuilt in `react-native-skia` or Reanimated, and all
1,833 lines of CSS become RN `StyleSheet` objects (no cascade, no `grid`, no pseudo-elements).

**Reuse: `shared` (915 LOC) fully. `server` fully. Client: ~0–15%** — component *structure*
and some logic (`moveTargets.ts`, `figureTargets.ts`, `animationPlan.ts`, `boardLayout.ts`
— ~530 LOC of pure math) survive; every render path does not.

| Pros | Cons |
|---|---|
| Genuinely native UI chrome and gestures | ~5,300 LOC of client rewritten for identical gameplay |
| Better cold-start and memory than a WebView | Two divergent clients forever, or you kill the web version |
| Bigger native module ecosystem | Violates the repo's own "dependency-light" convention hard |

Only justified if you were abandoning the web build. You aren't.

A **RN shell + WebView for the game board** hybrid exists as an idea. Don't. You get RN's
build complexity *and* the WebView's constraints.

---

## Option 4 — Native Swift (SwiftUI + SpriteKit)

Full rewrite. Engine, board renderer, UI, networking (Colyseus has no Swift SDK — you'd
hand-roll the WebSocket protocol or swap the server transport).

**Reuse: `server` only.** The 915-line `GameEngine` gets reimplemented in Swift, including
`generateSevenSplits` — which per `CLAUDE.md` took real work to get both *correct* (execution
order matters) and *fast* (17s → <100ms). Reimplementing that from scratch, in a second
language, with no shared test suite, is asking for a subtly-different rules engine that
disagrees with the server's authoritative one.

| Pros | Cons |
|---|---|
| Best possible perf and platform integration | 3–5 months, and a permanent rules-divergence risk |
| Game Center, full haptics, widgets | Web version becomes a second product to maintain |

Not worth it for a friend-group card game.

---

## Option 5 — Tauri v2 iOS

Rust-hosted WebView. Real iOS support in v2. But it's *also* a WKWebView, so the rendering
story is identical to Capacitor, with a smaller iOS ecosystem and a Rust toolchain you have
no other use for here. Capacitor strictly dominates for this project.

---

## Reuse summary

| | Capacitor | PWA | React Native | Native Swift |
|---|---|---|---|---|
| `shared` (915 LOC engine) | ✅ 100% | ✅ 100% | ✅ 100% | ❌ rewrite |
| `server` (483 LOC) | ✅ 100% | ✅ 100% | ✅ 100% | ⚠️ reusable, needs new client protocol |
| Phaser board (877 LOC) | ✅ 100% | ✅ 100% | ❌ rewrite in Skia | ❌ rewrite in SpriteKit |
| React overlay (~4,000 LOC) | ✅ 100% | ✅ 100% | ❌ rewrite | ❌ rewrite |
| CSS (1,833 LOC) | ✅ 100% | ✅ 100% | ❌ rewrite as StyleSheet | ❌ rewrite |
| Geometry/targeting math (~530 LOC) | ✅ 100% | ✅ 100% | ✅ ~100% | ⚠️ port |
| Sprites + Departure Mono font | ✅ 100% | ✅ 100% | ✅ (loaded differently) | ✅ |
| **Effort to first TestFlight build** | **1–2 days** | n/a | 6–12 weeks | 3–5 months |
| **Effort to App Store quality** | **1–3 weeks** | half a day | 3–4 months | 4–6 months |

---

## The actual work list for Capacitor

Ordered by whether it blocks shipping.

### Blockers

1. **Reconnect on the server.** `CLAUDE.md`: *"Not implemented: reconnect after a disconnect
   (a dropped seat just freezes mid-game...if it's seat 0 that dropped, nobody can rematch at
   all)"*. On desktop this is an edge case; on a phone it's every single time someone takes a
   call. Needs `allowReconnection()` in `GameRoom.ts`, a persisted `sessionId` in
   `localStorage`, and a "reconnecting…" UI state. **This is the largest single item — call it
   2–4 days.**
2. **`wss://` server.** ATS blocks cleartext. `network.ts` already derives `wss:` from an
   `https:` page and honors `VITE_SERVER_URL`, so this is a hosting/cert task, not a code
   task — but from a Capacitor app the page origin is `capacitor://localhost`, so
   `VITE_SERVER_URL` becomes **mandatory** rather than a fallback. Check `resolveServerUrl()`
   handles that origin sensibly.
3. **Safe areas.** No `env(safe-area-inset-*)` anywhere in `theme.css` today. Notch and home
   indicator will overlap the board and the hand panel. Add `viewport-fit=cover` and inset
   padding on the outer chrome.
4. **App icon + splash + bundle id + Apple Developer account.**

### Should-do before submitting

5. **Turn timer vs. backgrounding.** `TurnTimerBar` + the server's `turnDeadline` will fire
   while the app is suspended. Player comes back to a turn auto-played out from under them.
   At minimum, pause/refresh cleanly on `resume`.
6. **Disable WebView rubber-band scroll and text selection** on the board, or dragging feels
   like a web page rather than a game. (`touch-action` is set in 4 spots — needs to be
   comprehensive, plus `-webkit-user-select: none` and Capacitor's `ScrollEnabled: false`.)
7. **`navigator.clipboard` for the room code** — behaves differently in WKWebView; verify the
   "copy code" path or swap to the Capacitor Clipboard plugin.
8. **Guideline 4.2 hardening.** Native splash, no visible web chrome, sensible offline state.
   A hotseat local game that works with no network is the strongest possible 4.2 defense —
   and you already have it. Lead with that in the review notes.

### Nice-to-have

9. Haptics on marble capture and card play (`@capacitor/haptics`, ~20 lines).
10. Push notification for "it's your turn" — needs APNs + a push component on the server.
    Real work, real value for async play. Post-1.0.
11. Screen-wake-lock during a game.

---

## Recommended sequence

1. **This week:** add the PWA manifest + icons, open the site on your phone from the home
   screen, play a real 4-player game over the room-code flow. Find the touch problems for
   free, before any Apple money changes hands.
2. **Then:** fix reconnect + safe areas + turn-timer-on-resume. These are web fixes that
   improve the web version too, and they're the same fixes iOS needs.
3. **Then:** `npm i @capacitor/core @capacitor/cli && npx cap init && npx cap add ios`, point
   `webDir` at the Vite build, set `VITE_SERVER_URL` to the production `wss://` host, open
   Xcode, run on device.
4. **Then:** icon/splash/TestFlight/submit.

Steps 1–2 are the ones that actually determine whether this is fun on a phone. Step 3 is a
couple of hours of config.

---

## One structural note

The monorepo is already shaped correctly for this. `shared` has **zero runtime dependencies**
and no DOM imports, and the server runs the *unmodified* engine authoritatively. That means
any future native client — should you ever want one — only has to reimplement rendering, not
rules, because the server is already the referee. That's the expensive architectural decision
and it's already been made the right way.
