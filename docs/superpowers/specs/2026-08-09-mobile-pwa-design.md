# Mobile + PWA — TarikOS on a phone

Design approved 2026-08-09. Revised the same day after two of its measured claims turned
out to be wrong — see *Corrections*. Supersedes the "desktop only" posture in
`DESIGN.md` § Layout.

Make TarikOS responsive and make it feel like an app: installable, thumb-navigable, and
honest about when it has something to say.

## Where it starts from

Verified in the source, not inferred:

- **`NavRail` is `hidden lg:flex`** (`src/components/NavRail.tsx:22`). On a phone there
  is no navigation at all. Eight destinations, none reachable. **This is the real problem.**
- **41 responsive utilities in the entire app** — 20 `lg:`, 12 `sm:`, 9 `md:`.
- `/mail` and `/briefs` both hide structure below `lg`; both are multi-column today.
- No manifest, no service worker, no icons. Nothing PWA exists.
- **`VoiceDock` already renders at every width** (`fixed inset-x-3 bottom-3 z-40
  lg:left-[11.5rem]`) — only its left offset shifts at `lg` to clear the rail.
- **The voice session already survives navigation.** `ConversationProvider` sits in
  `AppShell` above the router; MOO-483 put it there on purpose.

## Corrections

The first draft of this spec claimed two things that were false, and one of them was its
centrepiece. Recorded because both were asserted as measurements.

1. **"Hoist the voice session above the router" was named the largest piece of work in
   the redesign.** It is already done. `AppShell.tsx:35` wraps `VoiceDock` in
   `ConversationProvider` precisely so the WebRTC session outlives route changes.
2. **"`VoiceDock` hides below `lg`" was wrong.** It came from `grep -l "hidden.*lg:"`
   returning the filename, which matched an inner element on line 251
   (`hidden ... md:block`, the latest-exchange text) rather than the component. A
   filename match was read as a fact about a component.

Consequence: the docked-orb-versus-live-bar decision was made without knowing that **a
live bar with an orb, a status line and a caption already ships.** The design below
replaces that decision rather than implementing it.

## The locked design system governs

`DESIGN.md` is the source of truth ("The Bridge Console"). Hallmark deferred to it — a
system-managed project's pages share the system rather than rotating themes.

- **The Two Voices Rule.** Antonio in caps, on caps and headings. Geist Mono for
  everything else. No third typeface.
- **The One-Sided Pill Rule.** The LCARS end-cap is the signature silhouette.
- **The Flat-At-Rest Rule.** No resting shadows. Depth from tone and the 1px panel-edge.
- **The Glow Means Live Rule.** `hud-glow` only on data that is live right now.
  Glowing static content is a defect.
- **The Channel Color Rule.** Every surface owns an LCARS hue; colour routes, never decorates.

Draft mockups broke two of these — body copy in a humanist sans, and cards with a thick
left accent border instead of a bracketing cap. Both corrected before approval. A design
reviewed in the wrong typeface reads as a different product.

## Three moves

### 1. The spine replaces the hidden rail

Below `lg`, the rail becomes a **12px colored spine** pinned to the left edge — seven
stacked channel colours in the desktop rail's order. Tap or swipe and it expands into
full `lcars-cap-left` caps over a scrim. Above `lg`, nothing changes.

Chosen over two alternatives, both mocked:

- **Bottom cap-bar** (4 tabs + MORE) — rejected: permanently demotes three of seven
  destinations, and all seven are used.
- **Orb radial** (press-and-hold, caps bloom around the thumb) — rejected: bets the whole
  navigation on an invisible gesture, and the top of a radial arc fights one-handed reach.

The spine wins because it needs no new visual vocabulary — it *is* the existing rail.

**Active state** follows `DESIGN.md` § Rail active state: active segment at full width and
full saturation, inactive at ~82% width and ~45% saturation. Opacity alone is explicitly
not a sufficient difference at AA-legible contrast.

**Known weak point:** a 12px strip may read as decoration. Mitigation is a one-time peek
animation per session — the spine widens and settles, teaching the affordance without a
tooltip. Under `prefers-reduced-motion` it renders at the expanded hint width instead.

### 2. The voice dock becomes state-shaped

`DESIGN.md` says the system is **"quiet by default and alive by exception"** and that
**"glow means live."** Today's dock contradicts that on a phone: the same ~90px bar
whether she is mid-sentence or has been idle for six hours, on every page.

Three states, below `lg` only:

| State | Form |
|---|---|
| **Idle** | A single steel `lcars-cap-left`, ~26px, bottom-right. Flat, no glow, no waveform, no matrix. An instrument with no reading. Tap to start. |
| **Live** | A bar: orb, status label, and the last thing she said. Cyan glow, because something is live. Tap for the full screen. |
| **Talk** | The `/talk` route. |

**And mobile inverts what it keeps.** Today the phone shows the waveform and tool matrix
and hides the transcript (`VoiceDock.tsx:251`). That is backwards: the waveform and matrix
are desktop telemetry restating what the pulsing orb already says, while the words are the
thing worth the space. Below `md`, drop matrix and waveform; promote the last line.

Desktop is untouched — the full instrument cluster stays above `lg`.

**The bet:** the spine (left edge) and the idle voice cap (bottom-right) are the same
silhouette with the same behaviour — small, flat, tap to expand — so learning one teaches
the other. If it reads as two mysteries rather than one pattern, the fallback is a
permanently visible low bar.

### 3. Every page gets a mobile pass

- **Hard** — `/briefs` (broadsheet CSS columns) and `/mail` (list + thread + reader). Both
  need a real single-column story, not a reflow.
- **Reflow** — `/`, `/habits`, `/telos`, `/brain`, `/control`.

`/conversations` (COMMS) keeps its spine entry for parity with the desktop rail but gets no
dedicated mobile layout in v1 — it was the one destination not named when asked which pages
would be opened on a phone. It must not break; it need not be good.

## Talk mode

A full route. Orb centred and reactive, status line above it (`LISTENING` /
`ZOLA SPEAKING`), transcript below, and any card she pushes lands **inline in the
conversation** rather than somewhere the user has to go find. Disengage renders as a filled
salmon cap; secondary controls are quiet bordered buttons per `DESIGN.md` § Buttons.

The spine stays on screen. Talk is a page, not a mode you are trapped in.

Persistence needs no work — the session already outlives navigation. Leaving `/talk` docks
the bar; it does not end the call.

## PWA scope

- **Installable — yes.** `manifest.webmanifest`, icon set, `display: standalone`.
- **Offline — shell only.** A service worker caches the app shell so it opens instantly and
  then reports it is reconnecting. **Data is deliberately not cached.** Convex is realtime;
  stale data on an instrument panel is worse than an honest empty state, and the Glow Means
  Live doctrine forbids implying currency the screen does not have.
- **Push notifications — out of scope**, deferred to its own brainstorm. The habits module
  was built with no push channel on purpose — the README says it "cannot nag, by
  construction." Adding push to the manifest would hand that ability to the one part of the
  system deliberately built without it. What may interrupt Tarik deserves its own decision,
  not arrival as a side effect.

## Components

| Unit | Responsibility |
|---|---|
| `src/lib/navLinks.ts` | The single destination list consumed by both `NavRail` and `Spine` |
| `Spine` | The 12px edge strip; active-state rendering; peek animation |
| `SpineSheet` | Expanded cap list over a scrim; focus trap, Esc, backdrop close |
| `VoiceDock` (modify) | Gains the three states below `lg`; desktop form unchanged |
| `/talk` route | Full talk screen |
| `manifest.webmanifest` + icons + `sw.js` | Installability and shell caching |

`navLinks.ts` matters: the desktop rail and the mobile spine must not own separate copies
of the destination list, or they will drift.

## Error handling

| Case | Behaviour |
|---|---|
| Session drops mid-conversation | Bar stops glowing and goes steel; `/talk` says the line dropped and offers reconnect. Never a silently dead orb. |
| Connecting | Bar shows a connecting state; navigating does not cancel the attempt. |
| Offline, shell from cache | Explicit "reconnecting" state. Never render stale data as current. |
| Spine route mismatch | Not possible — one list, in `navLinks.ts`. |

## Testing

- Pure logic (destination list, active-route matching) gets `node --test` units.
- A tripwire that `NavRail` and `Spine` both import from `navLinks.ts`, so a future edit
  cannot reintroduce two lists. **Mutation-test it** — a guard nobody has watched fail is
  theater.
- **What cannot be unit-tested:** whether the spine opens one-handed, and whether the
  idle cap reads as a control. Both need a real device.
- Verify at **320 / 375 / 414 / 768** — real widths, not a desktop window dragged narrow.

## `DESIGN.md` amendment required

§ Layout currently reads *"A fixed LCARS rail (10rem wide, desktop only — hidden below
`lg`)"* and *"Mobile collapses the rail."* Both become false.

The amendment is part of the work, not a follow-up. Add a **Navigation (mobile spine)**
entry and a **Voice dock (three states)** entry under § Components, and correct § Layout.
In a project where the design system is the source of truth, shipping a change that
contradicts it is how the system stops being trusted.

## Out of scope

Push notifications (own brainstorm). Offline data caching. A dedicated mobile layout for
`/conversations`. Native wrappers. Tablet-specific layouts — 768 is verified as a width,
not designed for as a distinct experience.

## Open questions for the plan

1. **Spine gesture** — tap-only, or swipe-from-edge as well? Swipe collides with iOS
   back-navigation on the left edge, which may settle it.
2. **`/mail` on a phone** — list → thread as separate routes with back navigation, or one
   route with a slide-over? `SlideOver` is the system's signature component and already
   goes full-width below `sm`, which argues for reusing it.
3. **Does the idle cap appear on `/talk` itself?** Probably not — you are already there.
