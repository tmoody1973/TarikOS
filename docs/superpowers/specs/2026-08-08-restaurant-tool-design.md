# Restaurant tool — `find_table` and `book_table`

Design approved 2026-08-08. Linear: MOO-523.

Zola finds a table and gets it booked. This spec covers **layer A only** — search,
availability, and booking. Two further layers were scoped and deliberately deferred;
see *Decomposition*.

## The problem

"Anything Thursday around 7 for four?" should not require knowing which platform a
restaurant lives on, and should not end with a browser and twenty tabs.

## Decomposition

Three products were requested. They share exactly one thing — knowing what is actually
available — and nothing else.

```
        A book        B recommend        C watch
           \              |               /
            \             |              /
             ── find_table: search + availability ──
```

- **A — book** (this spec). Find a table, get it reserved.
- **B — recommend.** Taste: menus, reviews, calendar, what the second brain knows he
  likes. Deferred.
- **C — watch.** Poll for a slot that does not exist yet and interrupt him when it
  appears. Deferred — but note its hard part is already solved: `call_tarik` shipped
  2026-08-08, so proactive interruption has a channel.

Agreed order: A, then C, then B. Each gets its own spec and plan.

## The two platforms are not symmetric

This asymmetry drives every decision below.

| | Resy | OpenTable |
|---|---|---|
| Integration | **Official MCP server**, Resy / American Express | None. Community servers only |
| Endpoint | `https://apigw.americanexpress.com/dining/v1/mcp` | — |
| Auth | **OAuth**, browser authorization, cached | — |
| How we read it | Call the official server | **Firecrawl scrape + our own parser** |
| Booking | **Completes, returns a confirmation** | Link handoff (v2: Firecrawl Interact) |
| Breaks when the site changes | No | Yes |
| Milwaukee coverage | Some | **Most** (per Tarik) |

Resy is the cheap half that can finish the job. OpenTable is the expensive half that
carries the coverage. Both are in v1 — an earlier draft cut Resy for scope, which had
it exactly backwards.

## Architecture

```
voice ─→ /api/tools/find_table
           ├─ Resy       official MCP over OAuth      → availability
           └─ OpenTable  Firecrawl scrape            → availability + ratings
                └─ src/lib/openTable.ts  markdown → Restaurant[]
           merge · rank · top 3 spoken · full list to a dashboard card

      ─→ /api/tools/book_table
           ├─ Resy       books for real → confirmation number
           └─ OpenTable  returns the booking URL, pushed as a card
```

Both tools are **webhook routes**, not raw MCP surfaces handed to the agent. This is
the governance rule already set for Granola (MOO-504) and Plane (MOO-506): a raw MCP
surface bypasses the `/control` registry — no kill switch, no health dot, no toggle,
no Phoenix tool span. It matters more here than there, because this tool spends money
and makes commitments to real venues.

### Why Firecrawl for OpenTable

Verified 2026-08-08 against the live site, not assumed:

- **HTTP 200** through OpenTable's bot protection, no login
- **49,324 characters, 30 restaurants** in real Milwaukee-metro neighborhoods —
  Milwaukee, Wauwatosa, Mequon, Brookfield, Cedarburg, Greendale, Pewaukee
- Per restaurant: name, rating, review count, price band, cuisine, neighborhood,
  "Booked N times today", **live time slots**, and the booking URL

**The URL that works is the city page, not the search endpoint:**

```
https://www.opentable.com/milwaukee-restaurants?covers=4&dateTime=2026-08-13T19%3A00
```

The `/s?...&metroId=26` search endpoint was tried first and is wrong: **`metroId=26` is
Madison**, not Milwaukee. It returned 13 restaurants in Sheboygan, Green Lake, Oshkosh
and Sun Prairie and **not one in Milwaukee**. `?term=Milwaukee` and explicit
`latitude`/`longitude` both returned zero. Do not reach for `/s?` — it looks like the
right endpoint and is not.

The city page's markdown shape (captured verbatim in the fixture):

```
[**Fleming's Steakhouse - Brookfield** \\
\\
4.6 \\
\\
1,380 reviews \\
\\
Steakhouse$$$$Brookfield \\
\\
Booked 21 times today](https://www.opentable.com/flemings-steakhouse-brookfield)

  - 9:30 PM+1,000 pts
  - 9:45 PM+1,000 pts
```

Three parser edge cases live in that shape, all present in the fixture:

1. **Cuisine, price and neighborhood are concatenated with no separator** —
   `Steakhouse$$$$Brookfield`. Split on the `$` run.
2. **Slots carry a loyalty suffix** — `9:30 PM+1,000 pts`. Strip it.
3. **One entry's neighborhood bleeds into a URL** —
   `Pewaukee](https://www.opentable.com/r/point-burger-bar-pewaukee-waukesha)`. The
   neighborhood capture must stop at `]`.

Firecrawl is **already paid for and already integrated** (`src/lib/reader.ts`), so this
adds no vendor, no credential, and no per-booking fee. It is also the component that
solved the Cloudflare 403 on bot-walled pages earlier the same day (MOO-502).

Alternatives were tested or ruled out, recorded so they are not re-litigated:

- **`@striderlabs/mcp-opentable`** — probed live. Returned `{"success": true,
  "restaurants": []}`, crashed on cleanup, and could not complete four queries in eight
  minutes. Silently wrong and far too slow for a phone call. **Dead.**
- **Apify `clearpath/opentable-booker`** — works and is maintained, but a new vendor, a
  session it holds for 14 days that can see saved cards, and **$3.99 per booking**.
  Superseded by Firecrawl Interact, which is already paid for.
- **Browserbase** — an LLM driving a browser. Slow and non-deterministic; wrong tool for
  a data fetch. Also note `BROWSERBASE_CONTEXT_ID` is unset, so the logged-in tier is
  currently inert.
- **Building our own MCP server** — rejected on shape. Zola's tools are webhook routes;
  the route is the client. An MCP server between our route and our own code is a
  protocol talking to itself. Shared logic belongs in `src/lib/`.

## Components

**`src/lib/openTable.ts`** — pure, no network, no Convex imports. Same pattern as
`telosLib` / `workflowLib`.

- `searchUrl({ date, time, partySize })` → the Milwaukee city-page URL
  (`/milwaukee-restaurants?covers=<n>&dateTime=<ISO>`)
- `parseSearch(markdown)` → `Restaurant[]`
- `rankTables(restaurants, wantedTime)` → sorted
- `Restaurant = { name, rating, reviewCount, price, cuisine, neighborhood, slots[], url }`

**`src/lib/resy.ts`** — MCP client wrapper plus token handling.

**Route cases** in `src/app/api/tools/[tool]/route.ts`: `find_table`, `book_table`.

**`scripts/provision-agent.ts`** — two `TOOLS` entries. This changes the tool count, so
`TOOL_COUNT` in `src/components/landing/Landing.tsx` moves too; the `landingClaims`
tripwire enforces it and has caught that drift twice already.

## Ranking

Closest to the requested time first, tie-broken by rating weighted by review count, so
`4.8 (1,995)` beats `4.9 (7)`.

One pure function. It is the seam where layer B's taste plugs in later, and it is
tunable the moment real use disagrees with it.

## The stray-neighborhood problem

Largely solved by using the city page, but not entirely. The 30 results are
Milwaukee-metro — Milwaukee, Wauwatosa, Mequon, Brookfield, Cedarburg, Greendale,
Pewaukee — with a small number of Madison and Sun Prairie strays mixed in.

A tool that confidently offers a table 80 miles away is worse than one that says it is
confused. `parseSearch` exposes `neighborhood`; results are filtered to a
Milwaukee-metro allowlist, and anything outside it is dropped rather than ranked low.

This was originally written as a radius problem against `metroId=26` and was wrong on
the facts — that endpoint returned **zero** Milwaukee restaurants, not "half." Corrected
after checking the fixture instead of trusting the first successful-looking response.
The lesson is recorded because it is the same failure mode as the striderlabs probe:
a 200 and plausible-looking data is not evidence the requirement was met.

## Error handling

Every failure is spoken, never silent. The failure mode to design against is the one
already seen tonight: `success: true` with an empty result.

| Case | Zola says |
|---|---|
| Firecrawl fails or non-200 | Can't reach OpenTable right now |
| Zero results | Nothing available then — offers to widen time or party size |
| Parse yields zero from non-empty markdown | **Treated as an error, not "no tables"** — the page shape changed |
| Resy OAuth expired | Names it and asks him to re-authorize |
| Booking fails | Reports the reason; never claims a table it did not get |

That third row is the load-bearing one.

## Testing

`parseSearch` is TDD'd against **`tests/fixtures/opentable-milwaukee.md`** — a real
49,324 character Firecrawl response for Milwaukee captured 2026-08-08, not a
hand-written fixture. A
hand-written fixture is how `tool.is_error` shipped structurally incapable of being
`true`.

Tripwires, each **mutation-tested** — a guard nobody has watched fail is theater, and
the guard on `call_tarik` was exactly that until it was watched:

- No booking path executes without explicit confirmation
- No cancellation path executes without confirmation naming the reservation
- Parser returning zero from non-empty input raises, never returns an empty list
- No card or payment data passes through the tool

## Guardrails

Booking commits to a third party and can trigger a card hold. Cancelling affects a real
business.

- **Propose, then confirm.** Zola names restaurant, date, time and party size and waits
  for a clear yes. Never books from an ambiguous instruction. Same shape as the
  `zolaDrafts` no-send guard.
- **Cancellation needs elevated confirmation** naming the specific reservation.
- **No card data through the tool.** Resy OAuth holds payment on their side; it stays
  there.

## Out of scope for v1

Hands-free OpenTable booking (v2, Firecrawl Interact with a persisted profile — note
that profile would hold OpenTable cookies on Firecrawl's infrastructure, a real trust
decision to make deliberately). Bright Data enrichment. Calendar awareness. Slot
watching. Recommendations. Cities other than Milwaukee.

## Open questions carried into the plan

1. The Milwaukee-metro allowlist — which neighborhoods count. Observed in the fixture:
   Milwaukee, Wauwatosa, Mequon, Brookfield, Cedarburg, Greendale, Pewaukee. Confirm
   with Tarik whether Brookfield and Mequon are "out for dinner" or too far.
2. Does Resy have enough Milwaukee coverage to be worth calling on every search, or
   should it be queried only on an explicit ask and when travelling?
3. OpenTable Partner API — free to apply, 3–4 weeks, OAuth, real booking. Probably a
   rejection for a single-user assistant, but it is the front door and would replace the
   scraper. Worth filing in parallel; the same "paperwork is the long pole" lesson as
   10DLC.
