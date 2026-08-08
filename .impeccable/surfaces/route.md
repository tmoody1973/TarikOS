---
version: 1
slug: "route"
primary_target: "route:/"
related_targets: []
---

# Surface brief: / (signed-out landing)

**Scope:** Public landing page at `/` for signed-out visitors; signed-in users continue to see the HUD. Also the portfolio artifact.
**Mode:** Persuade.

**Audience & job:** Developers (primary) deciding whether to star/fork tmoody1973/TarikOS; employers/collaborators (secondary) reading it as Tarik Moody's portfolio piece.
**Primary action:** VIEW SOURCE → GitHub repo. Secondary: ENGAGE → sign-in (owner), "how it works" scroll.

**Proof on hand:** working prod system; real add-a-tool code pattern (AGENTS.md); guardrail tests (draft-never-send, credential-free browsing); README architecture; real dashboard surfaces to screenshot. No user counts/testimonials — never fabricate.

**Story (true, from Tarik, do not invent beyond):** Started as a question — "what would Jarvis actually look like if you built it today, on a normal web stack, for one person's real life?" The agent is Zola — Xhosa name meaning "be calm / be quiet / peaceful." Dark LCARS-styled dashboard, hit ENGAGE and talk; she answers in real time and everything she learns lands somewhere visible. Open source, MIT.

**Chosen direction (seed 9e2c8098, assigned index 3): The Transmission.** The page is one scripted conversation with Zola. Six beats: What are you? / Where did you come from? / How do you work? / What can you do? / Can I trust you? / Can I have you? Questions type themselves on arrival; answers stream in glowing mono (hud-glow while "live", flat once settled — Glow Means Live enacted), with real system panels as evidence. Animated 3D orb (three.js) is Zola's persistent presence, reacting when she "speaks". World fixed: DESIGN.md Bridge Console tokens exactly.

**Memorable moment:** first viewport — orb in dark space, "ZOLA, WHAT ARE YOU?" types itself, her answer streams in live glow; VIEW SOURCE and ENGAGE caps visible without scrolling.

**Constraints:** motion-reduce shows everything, withholds nothing; skimmers get a legible landing page via question headers + panel density; WCAG 2.2 AA (focus-visible cyan, contrast); zero telemetry; no new palette/type.

**Unresolved:** approved comp path (pending visualize round); repo-stats treatment (live vs static).

## Approved comps (2026-08-08)

Combined: `.impeccable/mocks/landing-transmission-a.png` (hero) + `.impeccable/mocks/landing-transmission-b.png` (body). Sidecars marked approved.

## Fidelity inventory (comp → medium)

| Ingredient | Medium |
|---|---|
| Hero orb (dominant, ~35vh) | existing code component `src/components/hud/Orb.tsx` (live WebGL, amber→cyan; supersedes comp raster) |
| Starfield around orb | accepted omission (orb shader carries its own particle field) |
| Typed question + streaming answer | HTML/CSS + JS typing; reduced-motion renders full text statically |
| Top bar caps: TARIK OS masthead, VIEW SOURCE (primary CTA), ENGAGE | HTML/CSS `.lcars-cap-*` — plain cap form, no physical treatment in comp |
| Conversation-beat rail (ORIGIN/MECHANISM/CAPABILITIES/TRUST/FORK) | HTML/CSS anchor rail reusing NavRail cap grammar; hidden on mobile like the app |
| Evidence: email-draft panel | HTML/CSS; true draft-not-send framing, labeled illustrative |
| Evidence: tool registry | HTML/CSS; REAL tool names from scripts/provision-agent.ts |
| Trust panel: guardrail tests | HTML/CSS; REAL test filenames from tests/ |
| Add-a-tool code block | abridged real route pattern, labeled |
| Type ramp | Antonio display caps + Geist Mono (already loaded; matches comp's condensed caps) |

Compositional commitments: hero = orb dominant centered, question in display caps beneath, narrow centered mono answer column, both caps visible; body = left sticky rail index + per-beat question headline / streaming answer / evidence panel; dense-quiet alternation; FORK close anchors the page. Comp copy ("128K tokens", fake email) is NOT carried — all claims from product truth.

## Finish review outcome (2026-08-08)

Reviewer disposition: rebuild → fix → resolved. Round 1 returned a rebuild directive on the hero orb (flat conic pinwheel where the comp promised a dimensional sphere) plus 7 material fixes; executed as one batch. Round 2 verdict: 8/8 resolved, 1 partial (rail active state), 2 self-inflicted regressions (glow on static registry; header wrapping) + minor halo luminance — all four fixed in round 3.

Notable decisions:
- Registry panel deliberately does NOT glow: it shows real but static content, and glowing static content is a defect under Glow Means Live. Making it genuinely live would mean a public Convex query exposing tool health — a scope/security decision left to Tarik.
- Comp's compose-toolbar icons omitted: they implied an editor the visitor can't use; draft-not-send is carried by the STATUS · DRAFT / NO SEND CONTROL EXISTS row instead.
- SSR defect found during verification and fixed: Convex `<Unauthenticated>` resolves client-side only, so the page shipped empty HTML. Now a server-side `auth()` fork in page.tsx + `signedIn` prop through AppShell; headline and story are in the served HTML, with OG metadata.
- Tool count claim guarded by tests/landingClaims.test.ts (count matches provision-agent.ts, listed names exist, copy never claims Zola sends mail). 86/86 green.

Resolved: repo-stats treatment — static, no live API.
