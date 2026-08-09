---
name: Tarik OS
description: Voice-first personal AI OS — an LCARS bridge console for one person's real life
colors:
  space-black: "#050608"
  ice-signal: "#d8e4f0"
  lcars-amber: "#ff9900"
  lcars-salmon: "#ff7788"
  lcars-lavender: "#cc99cc"
  lcars-blue: "#99ccff"
  lcars-steel: "#6688aa"
  hud-cyan: "#35e0ff"
  panel: "#0b0e14"
  panel-edge: "#1a2233"
typography:
  display:
    fontFamily: "Antonio, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "normal"
  body:
    fontFamily: "Geist Mono, monospace"
    fontSize: "0.875rem"
    lineHeight: 1.7
  label:
    fontFamily: "Geist Mono, monospace"
    fontSize: "10px"
    fontWeight: 400
    letterSpacing: "0.3em"
rounded:
  md: "0.375rem"
  lg: "0.5rem"
  pill: "9999px"
spacing:
  sm: "8px"
  md: "12px"
  lg: "20px"
components:
  nav-cap:
    backgroundColor: "{colors.lcars-amber}"
    textColor: "#000000"
    typography: "{typography.display}"
    padding: "12px"
    height: "48px"
  chip:
    textColor: "{colors.lcars-steel}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.lg}"
    padding: "12px"
  button-quiet:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.lcars-steel}"
    rounded: "{rounded.md}"
    padding: "4px 10px"
---

# Design System: Tarik OS

## Overview

**Creative North Star: "The Bridge Console"**

Tarik OS looks like a starship bridge station wired to one person's actual life. The screen is an instrument, not a document: near-black space, ice-blue monospace telemetry, and LCARS end-caps routing you to each subsystem. The room is dark and calm; the data is what glows. Nothing decorates — every color, glow, and pulse is a reading.

The system is quiet by default and alive by exception. Static information sits flat in bordered panels; anything currently live — a voice session, streaming state, fresh data — earns the cyan HUD glow. Density is embraced (this is an operations surface, not marketing), but hierarchy comes from tracking-spaced micro-labels and channel color, never from size inflation.

**Key Characteristics:**
- Dark, flat, instrument-panel surfaces — depth from borders and tone, not shadows
- LCARS one-sided pill caps as the navigation signature; black display type on colored caps
- Monospace body voice throughout; wide-tracked uppercase micro-labels as wayfinding
- Color is routing and status, never mood
- Glow and pulse are reserved signals for live/waiting states; `motion-reduce` always respected

## Colors

A near-black stage where a small LCARS family does the talking; every hue has a job.

### Primary
- **LCARS Amber** (#ff9900): The identity color. The TARIK OS masthead cap and the HOME channel. Always carries black display type.
- **HUD Cyan** (#35e0ff): The live-signal color — active voice sessions, "SYSTEMS ONLINE," focus rings, the TELOS/VIEW channels. Cyan means something is on.

### Secondary
- **LCARS Lavender** (#cc99cc): Channel color for BRIEFS and MAIL; link color in reader prose.
- **LCARS Salmon** (#ff7788): Channel color for COMMS; hover-state color for destructive/close affordances.
- **LCARS Blue** (#99ccff): Channel color for BRAIN.
- **LCARS Sage** (#99cc99): Channel colour for HABITS. Follows the palette's
  `99`/`cc` construction, so it takes black cap type like its siblings.

### Neutral
- **Space Black** (#050608): The page background — the dark bridge behind every instrument.
- **Panel** (#0b0e14): Raised-surface background for cards, rails, and slide-overs.
- **Panel Edge** (#1a2233): The universal 1px border; it does the work shadows would elsewhere.
- **Ice Signal** (#d8e4f0): Primary text — cool phosphor readout, used at 85% mix for long-form prose.
- **LCARS Steel** (#6688aa): Secondary text, labels, blockquotes, and the CTRL channel — the voice of dormant systems.

### Named Rules
**The Channel Color Rule.** Every surface owns an LCARS hue (amber HOME, lavender BRIEFS/MAIL, blue BRAIN, cyan TELOS/VIEW, salmon COMMS, steel CTRL). Color assignments route and identify; they never express mood, and new surfaces claim a channel color before shipping.

**The Glow Means Live Rule.** `hud-glow` (soft currentColor text-shadow) appears only on data that is live right now — an open session, streaming state, fresh telemetry. Glowing static text is a defect.

## Typography

**Display Font:** Antonio (sans-serif fallback)
**Body Font:** Geist Mono (monospace fallback)

**Character:** A terse ship's-computer pairing — condensed uppercase display type stamped on colored caps, and a single monospace voice for every reading, label, and paragraph. The system never whispers in a humanist sans; it prints.

### Hierarchy
- **Display** (Antonio 400, ~1.25rem, line-height 1): Uppercase only, and almost always black-on-color — nav cap labels, the masthead, reader headings (with 0.05em tracking). Never used for body copy.
- **Body** (Geist Mono, 0.875rem, line-height 1.7): All prose and data. Long-form reads at 85% foreground mix inside `.reader-prose`.
- **Label** (Geist Mono, 10px, uppercase, 0.3em tracking, steel): The signature micro-label — section headers, panel captions, status lines. A 0.2em-tracked 0.75rem variant serves inline metadata.

### Named Rules
**The Two Voices Rule.** Antonio speaks only in caps, on caps and headings; Geist Mono says everything else. No third typeface enters the bridge.

## Layout

A fixed LCARS rail (10rem wide) anchors the left edge above `lg` with stacked end-caps; below it the same destinations render as a 24px edge spine that expands to full caps on tap. Content flows in a flex column beside it with `gap-2` (8px) rhythm. Panels use 12px internal padding (`p-3`), denser headers use 20px/12px (`px-5 py-3`). The briefs reader breaks into broadsheet CSS columns (21rem columns, 2.5rem gap, panel-edge column rules). Density is deliberate: many small instruments beat one large hero. Slide-overs go full-width (max-w-xl from `sm` up).

## Elevation & Depth

**The Flat-At-Rest Rule.** Surfaces are flat, by doctrine. Depth is conveyed by tone (space-black page → panel surface) and the 1px panel-edge border — never by resting shadows. Exactly one layer is allowed shadow: the overlay layer (SlideOver uses `shadow-2xl` over a `black/60` backdrop). Light is information: the only "lighting effects" are the hud-glow on live data and the `pulse-soft` opacity breath (2.4s) on waiting states.

## Shapes

**The One-Sided Pill Rule.** The LCARS end-cap — fully rounded on exactly one side (`9999px 0 0 9999px` or mirrored) — is the system's signature silhouette, used for nav caps and slide-over header ticks. Everything else is quiet geometry: `rounded-md` (6px) for controls and images, `rounded-lg` (8px) for panels, full pills for chips. No sharp-cornered interactive elements; no fully-rounded rectangles outside chips and caps.

## Components

### Navigation (LCARS Rail)
- **Style:** Stacked `lcars-cap-left` bars, 48px tall, each in its channel color with black Antonio uppercase labels, right-aligned.
- **States:** Active page at full opacity; inactive at 50%, hover to 80%. `aria-current="page"` set. The masthead cap (amber, 96px) crowns the rail; a panel-styled status block ("ZOLA / SYSTEMS ONLINE" in glowing cyan) roots it.

### Navigation (mobile spine)
- **Style:** Below `lg`, the rail collapses to a 24px left-edge strip of stacked `lcars-cap-right` segments in channel order. Tapping expands a 10rem sheet of full caps over a `black/60` scrim.
- **States:** Active segment runs full width at full saturation; inactive sit ~82% wide and ~45% desaturated — the same two-channel treatment as the desktop rail, because opacity alone is not a visible difference at AA-legible contrast.
- **Rule:** The spine and the rail render from one destination list (`src/lib/navLinks.ts`). Two lists would let a page exist on desktop and not on mobile.
- **Why 24px and not 12:** the first version was 12px. Measured at 375px that gave a 12px tap target on the primary navigation — under WCAG 2.5.8's 24px minimum — and left 2.16px between the active and inactive widths, so colour was carrying the state alone. Width is a floor, not a taste call.

### Voice dock (three states)
- **Idle:** Below `lg`, a single steel `lcars-cap-left` (~28px). Flat, no glow, no waveform, no matrix — an instrument with no reading does not hold the bottom of the screen.
- **Live:** A bordered panel bar: orb, status micro-label, and the last exchange. The status label glows because a session is live — Glow Means Live, as a state rather than a decoration. The orb is the way into `/talk`.
- **Talk:** The `/talk` route — full orb, the running transcript, mute and disengage.
- **Rule:** Mobile keeps the words, not the telemetry. Waveform and tool matrix are `md` and up; the last exchange is always visible, and below `md` it takes a row of its own rather than the ~12px the single-row layout leaves it.

### Chips
- **Style:** Full-pill, 1px border, `px-2.5 py-0.5`, 10px uppercase wide-tracked mono. Selected state fills with the channel color at low alpha or brightens the border; unselected sits steel-on-transparent.
- **Focus:** `focus-visible:outline-2 outline-cyan-hud` — the universal focus treatment.

### Cards / Panels
- **Corner Style:** `rounded-lg` (8px)
- **Background:** panel (#0b0e14) on space-black
- **Border:** 1px panel-edge — always; borderless floating cards don't exist
- **Shadow:** none (Flat-At-Rest Rule)
- **Header pattern:** 10px uppercase 0.3em-tracked label, often cyan with a bottom panel-edge rule

### Buttons
- **Quiet (default):** `rounded-md`, 1px panel-edge border, steel text, transparent/panel background. Hover shifts border and text toward the action's channel color (e.g. salmon for close/destructive). Transition on all state changes.
- **Cap buttons:** Nav-rail actions reuse the LCARS cap form (e.g. VIEW in cyan at 50% opacity, hover 80%).
- **Focus:** cyan `focus-visible` outline, never `outline: none` without replacement.

### Inputs / Fields
- **Style:** Panel background, panel-edge 1px border, `rounded-md`, mono text; labels use the micro-label style.
- **Focus:** border brightens toward the channel color plus the cyan outline.

### Transmission reveal (public landing)
- **Style:** Content ships complete in the DOM; JS arms a section before it scrolls in and an IntersectionObserver flips it live, revealing whole sentences in sequence. Each line enters with a brief `hud-glow` that settles flat — the Glow Means Live rule as an animation rather than a state.
- **Rules:** Reveal in sentences, never fixed line arrays (they double-wrap on phones). Under `prefers-reduced-motion` everything is simply visible. Static panels alongside it never glow.

### Outlined cap (secondary action)
- **Style:** The LCARS cap silhouette with a 1px channel-colored border and channel-colored label instead of a filled ground. Exists so a secondary action can sit beside a filled primary cap without out-shouting it.
- **Rule:** One filled cap per action group. Filled = primary; outlined = secondary.

### Rail active state
- **Style:** Active nav/index cap runs full width at full saturation; inactive caps sit narrower (~82%) and desaturated (~45%). Two channels, because opacity alone at AA-legible contrast is not a visible difference.

### SlideOver (signature component)
- **Style:** Right-anchored full-height panel (max-w-xl), panel background, left panel-edge border, `shadow-2xl` over black/60 backdrop. Header carries an LCARS cap tick (h-4 w-8, accent-colored) + micro-label. Esc and backdrop close; focus moves to the close button; 300ms slide with `motion-reduce:transition-none`.

## Do's and Don'ts

### Do:
- **Do** give every new surface a channel color from the LCARS family and use it consistently in its nav cap, chips, and accents.
- **Do** use the micro-label (10px uppercase, 0.3em tracking, steel) as the header voice for panels and sections.
- **Do** keep all interactive elements on the `focus-visible:outline-2 outline-cyan-hud` treatment and pair every transition with `motion-reduce`.
- **Do** hand-roll chips and status styling in Tailwind utilities per house style — shared logic goes in `src/lib`, not a component library.
- **Do** render text on colored caps in black Antonio uppercase (exact pattern: `font-[family-name:var(--font-display)] text-black`).

### Don't:
- **Don't** add resting shadows, gradients-as-decoration, or glow on static content — flat at rest, glow means live.
- **Don't** introduce a third typeface, humanist sans body text, or lowercase display type.
- **Don't** use channel colors for mood or emphasis outside their surface (salmon is COMMS/destructive-hover, not a highlight color).
- **Don't** ship borderless floating panels — every raised surface carries the 1px panel-edge border.
- **Don't** bring in a component library for visual primitives; the system is hand-rolled Tailwind on the token set above.
