"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// Two mailboxes, one domain, and it must always be obvious which one you are
// looking at.
//
// A tab rather than a thirteenth nav destination, which was Tarik's call and
// the better one: siblings are visible, labelled and mutually exclusive, so
// there is no way to land on hers thinking it was his. That confusion is the
// exact thing the identity split exists to prevent.
//
// Hers reads as not-his at a glance — hopbush against /mail's lavender. The
// classes are written out in full rather than composed from the accent name,
// because Tailwind reads source text and never sees an interpolated class.

const TABS = [
  {
    href: "/mail",
    label: "Tarik",
    on: "border-lavender/70 bg-lavender/15 text-foreground",
    off: "border-panel-edge text-steel hover:border-lavender/40",
  },
  {
    href: "/mail/zola",
    label: "Zola",
    on: "border-hopbush/70 bg-hopbush/15 text-foreground",
    off: "border-panel-edge text-steel hover:border-hopbush/40",
  },
] as const;

export function MailTabs() {
  const pathname = usePathname();
  const [unread, setUnread] = useState<number | null>(null);

  // The badge is the whole reason her inbox is not a second place to remember
  // to look. It costs one request on a page he is already on.
  useEffect(() => {
    let live = true;
    fetch("/api/zola-mail")
      .then((r) => r.json())
      .then((j) => {
        if (live && j.ok) setUnread(j.unread);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  return (
    <nav aria-label="Mailboxes" className="mb-3 flex items-center gap-1.5">
      {TABS.map((tab) => {
        const active =
          tab.href === "/mail" ? pathname === "/mail" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] uppercase tracking-wider transition motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-cyan-hud ${
              active ? tab.on : tab.off
            }`}
          >
            {tab.label}
            {tab.href === "/mail/zola" && unread ? (
              <span
                aria-label={`${unread} unread`}
                className="rounded-full bg-hopbush/80 px-1.5 text-[10px] font-semibold text-black"
              >
                {unread}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
