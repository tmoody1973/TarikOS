"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Zone, ZoneEmpty } from "@/components/hud/Zone";
import { hostLabel } from "@/lib/hostLabel";

// Feed manager panel (MOO-486): CRUD over the briefFeeds setting. Adds go
// through /api/feeds/discover so only validated feeds ever get saved.

export function FeedsPanel() {
  const data = useQuery(api.feeds.feedGroups);
  const addFeed = useMutation(api.feeds.addFeed);
  const removeFeed = useMutation(api.feeds.removeFeed);
  const moveFeed = useMutation(api.feeds.moveFeed);
  const addGroup = useMutation(api.feeds.addGroup);
  const renameGroup = useMutation(api.feeds.renameGroup);
  const removeGroup = useMutation(api.feeds.removeGroup);

  const [addInput, setAddInput] = useState("");
  const [addTarget, setAddTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [newGroup, setNewGroup] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);

  const targetGroup = addTarget || data?.groups[0]?.label || "";

  async function submitNewGroup() {
    if (!newGroup.trim()) return;
    await addGroup({ label: newGroup });
    setNewGroup("");
  }

  async function handleAdd() {
    const input = addInput.trim();
    const group = targetGroup;
    if (!input || !group) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/feeds/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const json = await res.json();
      if (!json.ok) {
        setNotice(json.error);
        return;
      }
      const outcome = await addFeed({ group, feedUrl: json.feedUrl });
      setNotice(`${json.title} — ${outcome}.`);
      setAddInput("");
    } catch {
      setNotice("Feed discovery failed — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Zone title="Brief feeds" accent="bg-cyan-hud">
      {data === undefined ? (
        <ZoneEmpty>syncing…</ZoneEmpty>
      ) : (
        <div className="flex flex-col gap-3 overflow-y-auto">
          {/* Paste-a-URL add flow */}
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              value={addInput}
              onChange={(e) => setAddInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && handleAdd()}
              placeholder="site or feed URL — e.g. theverge.com"
              className="min-w-48 flex-1 rounded-md border border-panel-edge bg-black/20 px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-cyan-hud/60"
            />
            <select
              value={targetGroup}
              onChange={(e) => setAddTarget(e.target.value)}
              className="rounded-md border border-panel-edge bg-black/40 px-2 py-1.5 text-xs text-foreground outline-none"
            >
              {data.groups.map((g) => (
                <option key={g.label} value={g.label}>
                  {g.label}
                </option>
              ))}
            </select>
            <button
              onClick={handleAdd}
              disabled={busy || !addInput.trim()}
              className="rounded-md border border-cyan-hud/60 bg-cyan-hud/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-foreground transition enabled:hover:bg-cyan-hud/20 disabled:opacity-40"
            >
              {busy ? "Finding…" : "+ Add"}
            </button>
          </div>
          {notice && <p className="text-xs text-steel">{notice}</p>}

          {/* Groups */}
          {data.groups.map((g) => (
            <div key={g.label} className="rounded-md border border-panel-edge bg-black/20 px-3 py-2">
              <div className="flex items-center gap-2">
                {renaming === g.label ? (
                  <input
                    defaultValue={g.label}
                    autoFocus
                    onKeyDown={async (e) => {
                      if (e.key === "Enter") {
                        await renameGroup({ label: g.label, newLabel: e.currentTarget.value });
                        setRenaming(null);
                      }
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    className="rounded border border-cyan-hud/50 bg-black/40 px-1.5 py-0.5 text-xs text-foreground outline-none"
                  />
                ) : (
                  <button
                    onClick={() => setRenaming(g.label)}
                    title="Rename group"
                    className="text-xs font-semibold uppercase tracking-wider text-foreground/85 hover:text-cyan-hud"
                  >
                    {g.label}
                  </button>
                )}
                <span className="text-[10px] text-steel">{g.feeds.length}</span>
                {g.feeds.length === 0 && (
                  <button
                    onClick={() => removeGroup({ label: g.label })}
                    className="ml-auto text-[10px] uppercase tracking-wider text-steel hover:text-salmon"
                  >
                    remove group
                  </button>
                )}
              </div>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {g.feeds.map((url) => {
                  const health = data.health[url];
                  return (
                    <li
                      key={url}
                      className="flex items-center gap-1.5 rounded-full border border-panel-edge px-2 py-0.5"
                    >
                      <span
                        title={
                          health
                            ? health.ok
                              ? "Last fetch OK"
                              : `Last fetch failed: ${health.error ?? "error"}`
                            : "Not fetched yet"
                        }
                        className={`h-1.5 w-1.5 rounded-full ${
                          health ? (health.ok ? "bg-emerald-400" : "bg-salmon") : "bg-steel/50"
                        }`}
                      />
                      <span className="text-xs text-foreground/80" title={url}>
                        {hostLabel(url)}
                      </span>
                      {moving === url ? (
                        <select
                          autoFocus
                          defaultValue=""
                          onBlur={() => setMoving(null)}
                          onChange={async (e) => {
                            if (e.target.value) await moveFeed({ feedUrl: url, toGroup: e.target.value });
                            setMoving(null);
                          }}
                          className="rounded border border-panel-edge bg-black/50 text-[10px] text-foreground outline-none"
                        >
                          <option value="" disabled>
                            move to…
                          </option>
                          {data.groups
                            .filter((o) => o.label !== g.label)
                            .map((o) => (
                              <option key={o.label} value={o.label}>
                                {o.label}
                              </option>
                            ))}
                        </select>
                      ) : (
                        <button
                          onClick={() => setMoving(url)}
                          title="Move to another group"
                          className="text-[10px] text-steel hover:text-cyan-hud"
                        >
                          ⇄
                        </button>
                      )}
                      <button
                        onClick={() => removeFeed({ feedUrl: url })}
                        title="Remove feed"
                        className="text-[10px] text-steel hover:text-salmon"
                      >
                        ✕
                      </button>
                    </li>
                  );
                })}
                {g.feeds.length === 0 && (
                  <li className="text-xs text-steel">empty</li>
                )}
              </ul>
            </div>
          ))}

          {/* New group */}
          <div className="flex items-center gap-1.5">
            <input
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitNewGroup()}
              placeholder="new group name"
              className="rounded-md border border-panel-edge bg-black/20 px-2.5 py-1 text-xs text-foreground outline-none focus:border-cyan-hud/60"
            />
            <button
              onClick={submitNewGroup}
              disabled={!newGroup.trim()}
              className="rounded-md border border-panel-edge px-2.5 py-1 text-[10px] uppercase tracking-wider text-steel transition enabled:hover:border-cyan-hud/50 disabled:opacity-40"
            >
              + Group
            </button>
          </div>
        </div>
      )}
    </Zone>
  );
}
