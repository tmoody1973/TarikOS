# Mobile + PWA — TarikOS on a phone

Design approved 2026-08-09. Supersedes the "desktop only" posture in `DESIGN.md` § Layout.

Make TarikOS responsive and make it feel like an app: installable, thumb-navigable, and
able to hold a voice conversation while you move between pages.

## Where it starts from

Measured, not assumed:

- **`NavRail` is `hidden lg:flex`.** On a phone there is no navigation at all. Eight
  destinations, none reachable.
- `VoiceDock` also hides below `lg`. So does the mail page, the briefs page, and parts
  of the landing page.
- **41 responsive utilities in the entire app** — 20 `lg:`, 12 `sm:`, 9 `md:`.
- No manifest, no service worker, no icons. Nothing PWA exists.

This is not a polish pass. The app is desktop-only and has to become responsive.

## The locked design system governs

`DESIGN.md` is the source of truth ("The Bridge Console"). Hallmark was invoked for this
redesign and correctly deferred to it: no theme selection, no diversification rotation —
a system-managed project's pages must *share* the system, not differ from each other.

Rules that bind every decision below:

- **The Two Voices Rule.** Antonio in caps, on caps and headings. Geist Mono for
  everything else. No third typeface.
- **The One-Sided Pill Rule.** The LCARS end-cap is the signature silhouette.
- **The Flat-At-Rest Rule.** No resting shadows. Depth from tone and the 1px panel-edge.
- **The Glow Means Live Rule.** `hud-glow` only on data that is live right now.
  Glowing static content is a defect.
- **The Channel Color Rule.** Every surface owns an LCARS hue; colour routes, never
  decorates.

The first three mockups drafted for this design broke two of these — body copy in a
humanist sans, and cards with a thick left accent border rather than a bracketing cap.
Both were caught and corrected before the design was approved. Worth recording because
the failure mode is silent: a design reviewed in the wrong typeface reads as a different
product.

## Three moves, in dependency order

### 1. Hoist the voice session above the router

The session lives inside the page today, so navigating tears down the connection. It
moves to a provider mounted above the layout, exposing connection state, speaking state,
and the running transcript to any page that wants them.

**This is the largest piece of work in the redesign** — larger than the PWA and the
responsive pass combined.

Moves 2 and 3 do **not** depend on it; the spine and the responsive pass could ship
first and would be useful on their own. It is listed first because the docked orb cannot
exist without it, and the docked orb is the decision that makes this feel like an app
rather than a website that fits. If the plan needs a smaller first release, this is the
move to defer — talk mode stays a page you leave, and everything else still lands.

### 2. The spine replaces the hidden rail

Below `lg`, the rail becomes a **12px colored spine** pinned to the left edge — seven
stacked channel colours, the same order as the desktop rail. Tap or swipe it and it
expands into full `lcars-cap-left` caps over a scrim.

Above `lg` nothing changes. The desktop rail is untouched.

Chosen over two alternatives, both mocked:

- **Bottom cap-bar** (4 tabs + MORE) — rejected. It permanently demotes three of seven
  destinations, and Tarik uses all of them.
- **Orb radial** (press-and-hold, caps bloom around the thumb) — rejected. Most exciting,
  but it bets the entire navigation on an invisible gesture, and the top of a radial arc
  fights one-handed reach.

The spine wins because it needs no new visual vocabulary: it *is* the existing rail, and
every destination stays one gesture away.

**Active state follows `DESIGN.md` § Rail active state**: the active segment runs full
width at full saturation, inactive segments sit ~82% wide and ~45% desaturated. Opacity
alone is explicitly not enough of a difference at AA-legible contrast.

**Known weak point:** a 12px strip may read as decoration rather than as a control.
Mitigation is a peek animation on first load of a session — the spine widens and settles
once, teaching the affordance without a tooltip. Under `prefers-reduced-motion` the
spine simply renders at its expanded hint width.

### 3. Every page gets a mobile pass

Seven pages, split by difficulty:

- **Hard** — `/briefs` (broadsheet CSS columns today) and `/mail` (list + thread + reader,
  three panes). Both need a real single-column story, not a reflow.
- **Reflow** — `/` (home HUD), `/habits`, `/telos`, `/brain`, `/control`.

`/conversations` (COMMS) keeps its spine entry for parity with the desktop rail but gets
no dedicated mobile layout in v1 — it was the one destination Tarik did not name when
asked which pages he would open on a phone. It must not break; it need not be good.

## Talk mode

A full route. Orb centred and reactive, status line above it (`LISTENING` /
`ZOLA SPEAKING`), transcript below, and any card she pushes lands **inline in the
conversation** rather than somewhere the user has to go find.

The spine stays on screen. Talk mode is a page like any other; you leave it the way you
leave all of them.

### Persistence — the docked orb

Navigating away does **not** end the conversation. The orb shrinks to a corner and
pulses while live; tapping it returns to the full talk screen.

Chosen over a bottom "live bar" with a caption. The bar never overlaps content and
carries more information, and it remains the fallback if the floating orb proves to
cover something that matters in practice. The orb was chosen because it is the app's
signature and the docked state is the thing that makes persistence *felt* rather than
merely true.

The pulsing orb is a legitimate use of `hud-glow` under the Glow Means Live Rule — it
glows precisely because a session is live. It must not glow when idle.

## PWA scope

- **Installable — yes.** `manifest.webmanifest`, icon set, splash, `display: standalone`.
  This is most of the "feels like an app" win for a small fraction of the work.
- **Offline — shell only.** A service worker caches the app shell so it opens instantly
  and then reports that it is reconnecting. **Data is deliberately not cached.** Convex
  is realtime and the brief, mail and calendar are live; stale data on an instrument
  panel is worse than an honest empty state. This follows the Glow Means Live doctrine —
  the screen must never imply currency it does not have.
- **Push notifications — explicitly out of scope**, deferred to their own brainstorm.

  Push is not a styling decision. The habits module was built with **no push channel on
  purpose** — the README states it "cannot nag, by construction." Adding push to the PWA
  would hand that ability to every part of the system, including the one deliberately
  built without it. What may interrupt Tarik deserves its own conversation, not arrival
  as a side effect of adding a manifest.

## Components

| Unit | Responsibility |
|---|---|
| `VoiceSessionProvider` | Owns the ElevenLabs connection above the router; exposes status, transcript, and controls |
| `Spine` | The 12px edge strip; active-state rendering |
| `SpineSheet` | The expanded cap list over a scrim; focus trap, Esc, backdrop close |
| `DockedOrb` | Persistent mini-orb; visible only while a session is live |
| `/talk` route | Full talk screen |
| `src/lib/navLinks.ts` | The single link list consumed by both `NavRail` and `Spine` |

That last one matters: the desktop rail and the mobile spine must not own separate copies
of the destination list, or they will drift.

## Error handling

| Case | Behaviour |
|---|---|
| Session drops mid-conversation | Docked orb stops pulsing and goes steel; talk screen says the line dropped and offers reconnect. Never a silently dead orb. |
| Navigating while connecting | Orb docks in a connecting state; it does not cancel the attempt. |
| Offline, shell served from cache | Explicit "reconnecting" state. Never render stale data as current. |
| Spine opened with no route match | Not possible — the list is the single source in `navLinks.ts`. |

## Testing

- Pure logic (link list, active-route matching) gets `node --test` units as usual.
- **The two things that matter most cannot be unit-tested**: whether the session actually
  survives navigation, and whether the spine is openable one-handed. Both need a real
  device.
- Verify at **320 / 375 / 414 / 768** — real widths, not a desktop window dragged narrow.
- A tripwire that `NavRail` and `Spine` both import from `navLinks.ts`, so a future edit
  cannot reintroduce two lists. Mutation-test it.

## `DESIGN.md` amendment required

`DESIGN.md` § Layout currently reads: *"A fixed LCARS rail (10rem wide, desktop only —
hidden below `lg`)"* and *"Mobile collapses the rail."* Both become false when this ships.

The amendment is part of the work, not a follow-up. In a project where the design system
is the source of truth, shipping a change that contradicts it is how the system stops
being trusted. Add a **Navigation (mobile spine)** entry under § Components, and correct
§ Layout.

## Out of scope

Push notifications (own brainstorm). Offline data caching. A dedicated mobile layout for
`/conversations`. Native app wrappers. Tablet-specific layouts — `768` is verified as a
width, not designed for as a distinct experience.

## Open questions for the plan

1. **Spine gesture** — tap-only, or swipe-from-edge as well? Swipe conflicts with iOS
   back-navigation on the left edge, which may settle it.
2. **Does the docked orb persist across a full page reload**, or only across client-side
   navigation? Reload means reconnecting a live audio session, which may be worse than
   ending it cleanly.
3. **`/mail` on a phone** — list → thread as separate routes with back navigation, or a
   single route with a slide-over? The SlideOver is the system's signature component and
   already goes full-width below `sm`, which argues for reusing it.
