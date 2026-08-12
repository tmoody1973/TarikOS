"use client";

import { useEffect, useState } from "react";
import {
  Authenticated,
  AuthLoading,
  useAction,
  useMutation,
  useQuery,
} from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Zone, ZoneEmpty } from "@/components/hud/Zone";
import { FeedsPanel } from "./FeedsPanel";
import { spokenTime } from "../../../convex/remindersLib";

// Control Panel page (MOO-483): tool registry toggles + workflows section
// (enabled toggle, last run, last error, Run now).
export default function ControlPage() {
  return (
    <>
      <Authenticated>
        <ControlInner />
      </Authenticated>
      <AuthLoading>
        <div className="flex flex-1 items-center justify-center">
          <p className="pulse-soft font-[family-name:var(--font-mono-hud)] text-xs tracking-[0.3em] text-steel">
            ZOLA · AUTHENTICATING…
          </p>
        </div>
      </AuthLoading>
    </>
  );
}

function Toggle({
  enabled,
  onClick,
  label,
}: {
  enabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`flex h-5 w-10 shrink-0 items-center rounded-full border px-0.5 transition ${
        enabled
          ? "justify-end border-cyan-hud/60 bg-cyan-hud/20"
          : "justify-start border-panel-edge bg-black/40"
      }`}
    >
      <span
        className={`h-3.5 w-3.5 rounded-full ${enabled ? "bg-cyan-hud" : "bg-steel"}`}
      />
    </button>
  );
}

function lastRun(ts: number | undefined): string {
  if (!ts) return "never run";
  return new Date(ts).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ControlInner() {
  const tools = useQuery(api.dashboard.toolRegistry);
  const workflows = useQuery(api.dashboard.workflowRegistry);
  const setToolEnabled = useMutation(api.dashboard.setToolEnabled);
  const setWorkflowEnabled = useMutation(api.dashboard.setWorkflowEnabled);
  const runNow = useAction(api.workflowRunner.runNow);
  const [running, setRunning] = useState<string | null>(null);

  async function handleRunNow(name: string) {
    setRunning(name);
    try {
      await runNow({ name });
    } finally {
      setTimeout(() => setRunning(null), 1500);
    }
  }

  return (
    <div className="grid flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
      <Zone title="Tools" accent="bg-salmon">
        {tools === undefined ? (
          <ZoneEmpty>syncing…</ZoneEmpty>
        ) : (
          <ul className="space-y-1.5 overflow-y-auto">
            {tools.map((tool) => (
              <li
                key={tool._id}
                className="rounded-md border border-panel-edge bg-black/30 px-3 py-2"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      tool.health === "ok"
                        ? "bg-cyan-hud"
                        : tool.health === "error"
                          ? "bg-salmon"
                          : "bg-steel"
                    }`}
                  />
                  <span className="text-sm text-foreground/90">
                    {tool.name}
                  </span>
                  <div className="ml-auto">
                    <Toggle
                      enabled={tool.enabled}
                      label={`Toggle ${tool.name}`}
                      onClick={() =>
                        setToolEnabled({
                          toolId: tool._id,
                          enabled: !tool.enabled,
                        })
                      }
                    />
                  </div>
                </div>
                {tool.health === "error" && tool.lastError && (
                  <p className="mt-1 pl-5 text-[11px] text-salmon/80 [overflow-wrap:anywhere]">
                    {tool.lastError}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Zone>

      <Zone title="Workflows" accent="bg-lavender">
        {workflows === undefined ? (
          <ZoneEmpty>syncing…</ZoneEmpty>
        ) : workflows.length === 0 ? (
          <ZoneEmpty>No workflows seeded.</ZoneEmpty>
        ) : (
          <ul className="space-y-1.5 overflow-y-auto">
            {workflows.map((wf) => (
              <li
                key={wf._id}
                className="rounded-md border border-panel-edge bg-black/30 px-3 py-2"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      wf.lastError
                        ? "bg-salmon"
                        : wf.lastRunAt
                          ? "bg-cyan-hud"
                          : "bg-steel"
                    }`}
                  />
                  <div className="min-w-0">
                    <span className="block text-sm text-foreground/90">
                      {wf.name}
                    </span>
                    <span className="block text-[10px] uppercase tracking-wider text-steel">
                      {wf.trigger.type === "cron"
                        ? `cron ${wf.trigger.schedule} UTC`
                        : "voice-triggered"}{" "}
                      · last run {lastRun(wf.lastRunAt)}
                    </span>
                  </div>
                  <button
                    onClick={() => handleRunNow(wf.name)}
                    disabled={!wf.enabled || running === wf.name}
                    className="lcars-cap-right ml-auto shrink-0 bg-lavender px-3 py-1 font-[family-name:var(--font-display)] text-xs text-black transition hover:opacity-80 disabled:opacity-40"
                  >
                    {running === wf.name ? "QUEUED…" : "RUN NOW"}
                  </button>
                  <Toggle
                    enabled={wf.enabled}
                    label={`Toggle ${wf.name}`}
                    onClick={() =>
                      setWorkflowEnabled({
                        workflowId: wf._id,
                        enabled: !wf.enabled,
                      })
                    }
                  />
                </div>
                {wf.lastError && (
                  <p className="mt-1 pl-5 text-[11px] text-salmon/80 [overflow-wrap:anywhere]">
                    {wf.lastError}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Zone>

      <FeedsPanel />
      <MutedMailPanel />
      <DefaultProjectPanel />
      <RemindersPanel />
    </div>
  );
}

/**
 * Where a quick todo goes when Tarik does not name a project.
 *
 * A setting rather than a constant, for the reason the mail mutes are one: the
 * next time his todos belong somewhere else it should cost him a click.
 *
 * The list comes from Plane live — this is the only place in the app that
 * enumerates projects for a choice, and a stale list here would offer a project
 * that no longer exists.
 */
function DefaultProjectPanel() {
  const current = useQuery(api.planeSettings.get, {});
  const set = useMutation(api.planeSettings.set);
  const [projects, setProjects] = useState<{ id: string; name: string }[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/plane/board");
      if (!res.ok) {
        const detail = (await res.json().catch(() => ({}))) as { error?: string };
        setProblem(detail.error ?? `Plane returned ${res.status}.`);
        return;
      }
      const board = (await res.json()) as { projects: { id: string; name: string }[] };
      setProjects(board.projects);
    })();
  }, []);

  return (
    <Zone title="Default project" accent="bg-hopbush">
      <p className="text-xs text-steel">
        Where a task goes when Zola isn&rsquo;t told which project.
      </p>
      {problem ? <p className="mt-2 text-xs text-salmon">{problem}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {(projects ?? []).map((p) => (
          <button
            key={p.id}
            onClick={() => void set({ projectId: p.id, projectName: p.name })}
            className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.3em] transition-colors focus-visible:outline-2 focus-visible:outline-cyan-hud motion-reduce:transition-none ${
              current?.projectId === p.id
                ? "border-hopbush bg-hopbush/15 text-hopbush"
                : "border-panel-edge text-steel hover:text-foreground"
            }`}
          >
            {p.name}
          </button>
        ))}
        {projects === null && !problem ? (
          <span className="pulse-soft text-[10px] tracking-[0.3em] text-steel">LOADING…</span>
        ) : null}
      </div>
    </Zone>
  );
}

/**
 * Which senders and subjects never reach the inbox panel, the brief, or Zola.
 *
 * Editable here rather than in code because the noise changes: the next
 * pipeline to start mailing Tarik should cost him a line, not a deploy.
 *
 * One rule per line, because that is what a person pastes. The list is applied
 * inside the GMAIL QUERY, so a muted message never spends one of the six slots
 * the inbox asks for — which is the actual problem. Four automated reports had
 * been filling the panel and burning the whole budget.
 */
function MutedMailPanel() {
  const mutes = useQuery(api.mailFilters.list);
  const save = useMutation(api.mailFilters.save);
  const [senders, setSenders] = useState<string | null>(null);
  const [subjects, setSubjects] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Null until edited, so a live update does not overwrite what is being typed.
  const senderText = senders ?? (mutes?.senders ?? []).join("\n");
  const subjectText = subjects ?? (mutes?.subjects ?? []).join("\n");
  const dirty = senders !== null || subjects !== null;

  async function handleSave() {
    await save({
      senders: senderText.split("\n"),
      subjects: subjectText.split("\n"),
    });
    setSenders(null);
    setSubjects(null);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <Zone title="Muted mail" accent="bg-lavender">
      {mutes === undefined ? (
        <ZoneEmpty>syncing…</ZoneEmpty>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-steel">
            Hidden from the inbox panel, the morning brief and Zola. One per line.
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.3em] text-steel">Senders</span>
            <textarea
              value={senderText}
              onChange={(e) => setSenders(e.target.value)}
              rows={4}
              placeholder="noreply@tritondigital.com"
              className="rounded-md border border-panel-edge bg-black/20 px-2.5 py-1.5 font-[family-name:var(--font-mono-hud)] text-xs text-foreground outline-none focus:border-lavender/60"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.3em] text-steel">Subjects</span>
            <textarea
              value={subjectText}
              onChange={(e) => setSubjects(e.target.value)}
              rows={4}
              placeholder={"OK Q1-HOURLY\nOK FUNRAISE"}
              className="rounded-md border border-panel-edge bg-black/20 px-2.5 py-1.5 font-[family-name:var(--font-mono-hud)] text-xs text-foreground outline-none focus:border-lavender/60"
            />
          </label>
          <div className="flex items-center gap-3">
            <button
              onClick={() => void handleSave()}
              disabled={!dirty}
              className="rounded-md border border-panel-edge px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-steel transition-colors hover:border-lavender hover:text-lavender disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-cyan-hud motion-reduce:transition-none"
            >
              Save
            </button>
            {saved ? (
              <span className="hud-glow text-[10px] uppercase tracking-[0.3em] text-cyan-hud">
                Saved
              </span>
            ) : null}
          </div>
        </div>
      )}
    </Zone>
  );
}

/**
 * What Zola has been asked to interrupt him about, and a way to call it off.
 *
 * A reminder set by voice is otherwise invisible until it fires. Something set
 * for next Tuesday that he cannot see, check or cancel is a thing he has to
 * remember about his reminder system, which is the opposite of the point.
 */
function RemindersPanel() {
  const pending = useQuery(api.remindersDb.pendingForOwner, {});
  const cancel = useMutation(api.remindersDb.cancelForOwner);

  return (
    <Zone title="Reminders" accent="bg-cyan-hud">
      {pending === undefined ? (
        <ZoneEmpty>syncing…</ZoneEmpty>
      ) : pending.length === 0 ? (
        <ZoneEmpty>Nothing pending.</ZoneEmpty>
      ) : (
        <ul className="space-y-1.5 overflow-y-auto">
          {pending.map((r) => (
            <li
              key={r._id}
              className="flex items-center gap-3 rounded-md border border-panel-edge bg-black/30 px-3 py-2"
            >
              <div className="min-w-0">
                <span className="block truncate text-sm text-foreground/90">{r.text}</span>
                <span className="block text-[10px] uppercase tracking-wider text-steel">
                  {spokenTime(r.dueAt)} · {r.channel}
                </span>
              </div>
              <button
                onClick={() => void cancel({ id: r._id })}
                className="ml-auto shrink-0 rounded-md border border-panel-edge px-2 py-0.5 text-[10px] uppercase tracking-[0.3em] text-steel transition-colors hover:border-salmon hover:text-salmon focus-visible:outline-2 focus-visible:outline-cyan-hud motion-reduce:transition-none"
              >
                Cancel
              </button>
            </li>
          ))}
        </ul>
      )}
    </Zone>
  );
}
