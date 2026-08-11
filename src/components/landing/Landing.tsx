"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";

const LandingOrb = dynamic(
  () => import("./LandingOrb").then((m) => m.LandingOrb),
  { ssr: false }
);

/* Direction contract (impeccable, MOO-500) — survives the production build. */
const CONTRACT = `
THESIS: The landing page IS a conversation with Zola; it refuses the
hero/feature-grid dev-tool template. Persuasion by demonstration.
OWN-WORLD: Bridge Console (DESIGN.md): space-black, LCARS caps in channel
colors, Antonio caps on caps, Geist Mono everything else, flat-at-rest,
glow means live.
STORY: A developer asks Zola what she is; her answers — with real system
evidence — convince them to open the source. Secondary: this is Tarik
Moody's portfolio artifact.
FIRST VIEWPORT: dominant live shader orb centered; "ZOLA, WHAT ARE YOU?"
in display caps beneath; streaming mono answer; TARIK OS masthead cap
top-left; VIEW SOURCE + ENGAGE caps top-right.
FORM: The Transmission, candidate 3 of 7, seed 9e2c8098.
FINISH: unreviewed and undocumented is unfinished; this build ends with
the finish review, the verdict, and DESIGN.md.
`;

const REPO_URL = "https://github.com/tmoody1973/TarikOS";

// Conversation beats after the hero; rail index mirrors NavRail's grammar.
const BEATS = [
  { id: "origin", label: "ORIGIN", color: "bg-lavender" },
  { id: "mechanism", label: "MECHANISM", color: "bg-hudblue" },
  { id: "capabilities", label: "CAPABILITIES", color: "bg-cyan-hud" },
  { id: "trust", label: "TRUST", color: "bg-salmon" },
  { id: "fork", label: "FORK", color: "bg-steel" },
];

// Real tools from scripts/provision-agent.ts — never invent entries here.
// TOOL_COUNT is the true total defined there; the remainder line derives.
const TOOL_COUNT = 38;
const REGISTRY: [string, string][] = [
  ["get_emails", "mail"],
  ["draft_email", "mail"],
  ["get_calendar", "calendar"],
  ["create_calendar_event", "calendar"],
  ["get_brief", "briefs"],
  ["find_brief", "briefs"],
  ["web_research", "research"],
  ["browse", "browser"],
  ["remember", "memory"],
  ["recall", "memory"],
  ["journal_entry", "journal"],
  ["run_workflow", "workflows"],
];

/* Arms a section for the streaming reveal before it scrolls into view.
 * No JS / reduced motion → content simply stays visible. */
function useLive<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [state, setState] = useState<"idle" | "armed" | "live">("idle");
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = ref.current;
    if (!el) return;
    setState("armed");
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setState("live");
          io.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, state };
}

function Lines({
  lines,
  className,
  startMs = 0,
  stepMs = 260,
  cursor = false,
}: {
  lines: string[];
  className?: string;
  startMs?: number;
  stepMs?: number;
  cursor?: boolean;
}) {
  return (
    <>
      {lines.map((line, i) => (
        <span
          key={i}
          className={`t-line block ${className ?? ""}`}
          style={{ "--d": `${startMs + i * stepMs}ms` } as React.CSSProperties}
        >
          {line}
          {cursor && i === lines.length - 1 && (
            <span
              className="pulse-soft ml-1 inline-block h-4 w-2 translate-y-0.5 bg-cyan-hud"
              aria-hidden
            />
          )}
        </span>
      ))}
    </>
  );
}

function Cap({
  href,
  external,
  color,
  children,
}: {
  href: string;
  external?: boolean;
  color: string;
  children: React.ReactNode;
}) {
  const outlined = color.includes("border");
  const cls = `lcars-cap-right flex h-10 items-center px-5 transition hover:opacity-80 focus-visible:outline-2 focus-visible:outline-cyan-hud ${color}`;
  const label = (
    <span
      className={`font-[family-name:var(--font-display)] text-sm uppercase ${
        outlined ? "" : "text-black"
      }`}
    >
      {children}
    </span>
  );
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {label}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {label}
    </Link>
  );
}

function Question({ children }: { children: string }) {
  return (
    <h2 className="font-[family-name:var(--font-display)] text-3xl uppercase leading-none tracking-wide text-foreground sm:text-4xl">
      <span className="t-line">{children}</span>
    </h2>
  );
}

function Panel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  // No glow here by design: these panels show real but static content, and
  // DESIGN.md's Glow Means Live rule makes a glowing static panel a defect.
  // The page's live treatment belongs to the streaming reveal and the orb.
  return (
    <div className="rounded-lg border border-panel-edge bg-panel p-4">
      <h3 className="mb-3 truncate border-b border-panel-edge pb-2 text-[10px] uppercase tracking-[0.3em] text-cyan-hud">
        {label}
      </h3>
      {children}
    </div>
  );
}

// Which beat the rail highlights: the last section whose top has passed the
// upper third of the viewport.
function useActiveBeat(ids: string[]) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setActive(hit.target.id);
      },
      { rootMargin: "-20% 0px -60% 0px" }
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [ids]);
  return active;
}

const BEAT_IDS = BEATS.map((b) => b.id);

export function Landing() {
  const hero = useLive<HTMLElement>();
  const [orbState, setOrbState] = useState<"talking" | null>(null);
  const activeBeat = useActiveBeat(BEAT_IDS);

  // The orb "speaks" while the hero answer streams in, then settles.
  useEffect(() => {
    if (hero.state !== "live") return;
    setOrbState("talking");
    const t = setTimeout(() => setOrbState(null), 5200);
    return () => clearTimeout(t);
  }, [hero.state]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <script
        type="text/x-impeccable-contract"
        dangerouslySetInnerHTML={{ __html: CONTRACT }}
      />

      {/* Top bar: masthead runs flush to the corner (comp); VIEW SOURCE keeps
          the amber fill as the primary action, ENGAGE steps back to an
          outlined cap so it can't out-shout it. */}
      <header className="flex items-start justify-between gap-3 pb-2 pr-3 sm:pr-5">
        <div className="lcars-cap-right flex h-12 items-center bg-amber px-6">
          <span className="font-[family-name:var(--font-display)] text-lg uppercase text-black">
            Tarik OS
          </span>
        </div>
        <div className="flex items-center gap-2 pt-3 sm:pt-5">
          <Cap href={REPO_URL} external color="bg-amber">
            View Source
          </Cap>
          <Cap href="/sign-in" color="border border-cyan-hud/60 text-cyan-hud">
            Engage
          </Cap>
        </div>
      </header>

      {/* Beat 1 — hero: the orb answers the first question */}
      <section
        ref={hero.ref}
        aria-label="Zola, what are you?"
        className={`t-${hero.state} flex flex-col items-center px-5 pb-8 pt-2`}
      >
        <div className="h-[36vh] min-h-56 w-full max-w-lg">
          <LandingOrb speaking={orbState === "talking"} />
        </div>
        <h1 className="mt-6 text-center font-[family-name:var(--font-display)] text-4xl uppercase leading-none tracking-wide sm:text-6xl">
          <span className="t-line">Zola, what are you?</span>
        </h1>
        {/* Sentences, not fixed lines — they wrap naturally at every width
            and each one reveals as its own beat. */}
        <p className="mt-8 max-w-md font-[family-name:var(--font-mono-hud)] text-sm leading-7">
          <Lines
            startMs={700}
            stepMs={420}
            cursor
            className="mb-3 last:mb-0"
            lines={[
              "I'm the voice inside Tarik OS — a personal AI operating system built for exactly one person.",
              "You open a dark console. You hit ENGAGE. You talk.",
              "I answer in real time, and everything I learn or find lands somewhere you can see it.",
            ]}
          />
        </p>

        {/* Comp's viewport-bottom structure: the next three questions, so the
            hero says what happens if you keep going. */}
        <ul className="mt-12 grid w-full max-w-4xl gap-3 sm:grid-cols-3">
          {[
            ["Probe origin", "#origin", "Why Zola, and why at all"],
            ["Trace mechanism", "#mechanism", "Voice to tool to dashboard"],
            ["Define relationship", "#fork", "Fork it and run your own"],
          ].map(([label, href, sub]) => (
            <li key={href}>
              <a
                href={href}
                className="group flex flex-col gap-1.5 rounded-lg border border-panel-edge bg-panel px-4 py-3 transition hover:border-steel focus-visible:outline-2 focus-visible:outline-cyan-hud"
              >
                <span className="text-[10px] uppercase tracking-[0.3em] text-steel transition group-hover:text-cyan-hud">
                  {label}
                </span>
                <span className="font-[family-name:var(--font-mono-hud)] text-xs text-foreground/70">
                  {sub}
                </span>
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-[10px] uppercase tracking-[0.3em] text-steel">
          Open source · MIT · No telemetry
        </p>
      </section>

      {/* Body: rail-indexed conversation (comp B) */}
      <div className="mx-auto flex max-w-6xl gap-6 px-3 pb-24 sm:px-5">
        {/* Rail: comp b's architecture, not a nav widget — full caps at
            80%/100% so black labels clear AA, active beat tracked by scroll,
            hairline dividing rail from content. */}
        <aside className="hidden w-44 shrink-0 border-r border-panel-edge pr-4 lg:block">
          <nav
            aria-label="Conversation index"
            className="sticky top-5 flex flex-col gap-2"
          >
            {BEATS.map((b) => {
              const active = activeBeat === b.id;
              return (
                <a
                  key={b.id}
                  href={`#${b.id}`}
                  aria-current={active ? "true" : undefined}
                  className={`lcars-cap-left ml-auto flex h-14 items-center justify-end p-3 transition-all focus-visible:outline-2 focus-visible:outline-cyan-hud ${b.color} ${
                    active
                      ? "w-full opacity-100 saturate-100"
                      : "w-[82%] opacity-90 saturate-[.45] hover:w-full hover:saturate-100"
                  }`}
                >
                  <span className="font-[family-name:var(--font-display)] text-base uppercase text-black">
                    {b.label}
                  </span>
                </a>
              );
            })}
          </nav>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col gap-24">
          <Beat id="origin" question="Where did you come from?">
            {(live) => (
              <div className="flex flex-col gap-8 md:flex-row md:items-start">
                <p className="max-w-prose flex-1 font-[family-name:var(--font-mono-hud)] text-sm leading-7">
                  <Lines
                    stepMs={420}
                    className="mb-4 last:mb-0"
                    lines={[
                      "A question. Tarik wondered what Jarvis would actually look like if you built it today — on a normal web stack, for one person's real life.",
                      "He named me Zola. In Xhosa it means “be calm, be quiet, peaceful.” A calm voice at the center of a glowing console.",
                    ]}
                  />
                </p>
                <div className="w-full md:w-72">
                  <Panel label="Designation">
                    <dl className="flex flex-col gap-2 font-[family-name:var(--font-mono-hud)] text-xs leading-6">
                      <Row k="NAME" v="Zola" />
                      <Row k="MEANING" v="be calm · Xhosa" />
                      <Row k="SYSTEM" v="Tarik OS" />
                      <Row k="USERS" v="one, by design" />
                      <Row k="AESTHETIC" v="LCARS bridge console" />
                    </dl>
                  </Panel>
                </div>
              </div>
            )}
          </Beat>

          <Beat id="mechanism" question="How do you work?">
            {() => (
              <div className="flex flex-col gap-8">
                <p className="max-w-prose font-[family-name:var(--font-mono-hud)] text-sm leading-7">
                  <Lines
                    stepMs={420}
                    className="mb-4 last:mb-0"
                    lines={[
                      "You speak. ElevenLabs carries the conversation; Claude does the reasoning.",
                      "Every capability I have is a webhook tool — one POST route, one shared secret. Convex keeps the state and streams it to the dashboard while I talk.",
                    ]}
                  />
                </p>
                <p className="text-[10px] uppercase tracking-[0.3em] text-steel">
                  Voice → Agent → /api/tools/* → Convex → Dashboard
                </p>
                <Panel label="Adding a capability · the whole pattern, abridged">
                  <pre className="overflow-x-auto font-[family-name:var(--font-mono-hud)] text-xs leading-6 text-foreground/85">
                    {`// src/app/api/tools/[tool]/route.ts
case "capture_thought": {
  await convex.mutation(api.thoughts.capture, {
    text: body.text,
  });
  return json({
    ok: true,
    message: "Captured. It's on your dashboard.",
  });
}
// provision the agent once — the tool registers
// itself in the control panel on first use, with
// a health dot and a kill switch.`}
                  </pre>
                </Panel>
              </div>
            )}
          </Beat>

          <Beat id="capabilities" question="What can you do?">
            {() => (
              <div className="flex flex-col gap-8 md:flex-row md:items-start">
                <p className="max-w-prose flex-1 font-[family-name:var(--font-mono-hud)] text-sm leading-7">
                  <Lines
                    stepMs={420}
                    className="mb-4 last:mb-0"
                    lines={[
                      "Read your mail and draft the replies. Work the calendar. Build your morning brief while you sleep.",
                      "Track long-term goals. Keep a journal. Remember what we talked about last month. Drive a real browser and show you the screen.",
                    ]}
                  />
                </p>
                <div className="w-full md:w-80">
                  <Panel label={`Tool registry · ${TOOL_COUNT} tools`}>
                    <ul className="flex flex-col gap-1.5 font-[family-name:var(--font-mono-hud)] text-xs leading-6">
                      {REGISTRY.map(([name, kind]) => (
                        <li
                          key={name}
                          className="flex items-center justify-between gap-3"
                        >
                          <span className="truncate text-foreground/85">
                            {name}
                          </span>
                          <span className="flex items-center gap-2">
                            <span className="uppercase tracking-wider text-steel">
                              {kind}
                            </span>
                            <span
                              className="h-1.5 w-1.5 rounded-full bg-cyan-hud"
                              aria-hidden
                            />
                          </span>
                        </li>
                      ))}
                      <li className="mt-1 uppercase tracking-[0.2em] text-steel">
                        + {TOOL_COUNT - REGISTRY.length} more in the source
                      </li>
                    </ul>
                  </Panel>
                </div>
              </div>
            )}
          </Beat>

          <Beat id="trust" question="Can I trust you?">
            {() => (
              <div className="flex flex-col gap-8">
                <p className="max-w-prose font-[family-name:var(--font-mono-hud)] text-sm leading-7">
                  <Lines
                    stepMs={420}
                    lines={[
                      "My guardrails are structural — enforced by tests, not promises. If a send path ever appears on my tool surface, the build fails.",
                    ]}
                  />
                </p>
                {/* The draft surface itself is the trust proof: the compose
                    window Zola fills, with no send control anywhere on it. */}
                <div className="grid gap-3 lg:grid-cols-[1.35fr_1fr]">
                  <Panel label="Draft written by Zola · illustrative">
                    <div className="flex flex-col gap-3 font-[family-name:var(--font-mono-hud)] text-xs">
                      <dl className="flex flex-col gap-1.5">
                        <Field k="TO" v="the human who asked for it" />
                        <Field k="SUBJ" v="Re: Thursday's run of show" />
                      </dl>
                      <p className="rounded-md border border-panel-edge px-3 py-2.5 leading-6 text-foreground/85">
                        Happy to move it to 2pm — I&apos;ll bring the segment
                        list and the two cuts we flagged.
                      </p>
                      <div className="flex items-center justify-between gap-3 border-t border-panel-edge pt-2.5">
                        <span className="uppercase tracking-[0.2em] text-steel">
                          Status · draft
                        </span>
                        <span className="uppercase tracking-[0.2em] text-salmon">
                          No send control exists
                        </span>
                      </div>
                    </div>
                  </Panel>
                  <Panel label="Enforced by">
                    <ul className="flex flex-col gap-3 font-[family-name:var(--font-mono-hud)] text-xs leading-6">
                      <Guardrail
                        rule="I draft email. Only a human can send it."
                        proof="tests/zolaDrafts.test.ts"
                      />
                      <Guardrail
                        rule="I never type a password, and I browse signed out unless Tarik asks otherwise in that request. No scheduled job can open a browser at all."
                        proof="tests/browserBrief.test.ts"
                      />
                      <Guardrail
                        rule="Calendar writes need a spoken confirmation first."
                        proof="confirm ritual · agent contract"
                      />
                    </ul>
                  </Panel>
                </div>
              </div>
            )}
          </Beat>

          <Beat id="fork" question="Can I have you?">
            {() => (
              <div className="flex flex-col items-start gap-8">
                <p className="max-w-prose font-[family-name:var(--font-mono-hud)] text-sm leading-7">
                  <Lines
                    stepMs={420}
                    className="mb-4 last:mb-0"
                    lines={[
                      "Yes. Tarik OS is open source under MIT.",
                      "One person per fork — your accounts, your keys, your instance. The README walks you through standing me up.",
                    ]}
                  />
                </p>
                <a
                  href={REPO_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="lcars-cap-left lcars-cap-right flex h-14 items-center bg-amber px-10 transition hover:opacity-80 focus-visible:outline-2 focus-visible:outline-cyan-hud"
                >
                  <span className="font-[family-name:var(--font-display)] text-xl uppercase text-black">
                    Fork Tarik OS on GitHub
                  </span>
                </a>
                <p className="font-[family-name:var(--font-mono-hud)] text-xs leading-6 text-steel">
                  Designed and built by{" "}
                  <a
                    href="https://github.com/tmoody1973"
                    target="_blank"
                    rel="noreferrer"
                    className="text-lavender underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-cyan-hud"
                  >
                    Tarik Moody
                  </a>{" "}
                  — and run every day as his actual daily driver.
                </p>
              </div>
            )}
          </Beat>
        </main>
      </div>

      <footer className="border-t border-panel-edge px-5 py-6 text-center">
        <p className="text-[10px] uppercase tracking-[0.3em] text-steel">
          Tarik OS · Open Source · MIT · No telemetry
        </p>
      </footer>
    </div>
  );
}

function Beat({
  id,
  question,
  children,
}: {
  id: string;
  question: string;
  children: (live: boolean) => React.ReactNode;
}) {
  const { ref, state } = useLive<HTMLElement>();
  return (
    <section
      id={id}
      ref={ref}
      aria-label={question}
      className={`t-${state} flex scroll-mt-6 flex-col gap-6`}
    >
      <Question>{question}</Question>
      {children(state === "live")}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="uppercase tracking-[0.2em] text-steel">{k}</dt>
      <dd className="text-right text-foreground/85">{v}</dd>
    </div>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="w-10 shrink-0 uppercase tracking-[0.2em] text-steel">
        {k}
      </dt>
      <dd className="min-w-0 truncate text-foreground/85">{v}</dd>
    </div>
  );
}

function Guardrail({ rule, proof }: { rule: string; proof: string }) {
  return (
    <li className="flex flex-col">
      <span className="text-foreground/85">{rule}</span>
      <span className="uppercase tracking-wider text-steel">{proof}</span>
    </li>
  );
}
