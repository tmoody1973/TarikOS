"use client";

import { useState } from "react";
import {
  Authenticated,
  AuthLoading,
  useAction,
  useMutation,
  useQuery,
} from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Zone, ZoneEmpty } from "@/components/hud/Zone";

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
                  <p className="mt-1 pl-5 text-[11px] text-salmon/80">
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
                  <p className="mt-1 pl-5 text-[11px] text-salmon/80">
                    {wf.lastError}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Zone>
    </div>
  );
}
