/* One destination list. The desktop rail (NavRail) and the mobile spine both
 * render from here — two copies would drift, and a drifted nav is a page you
 * can reach from one device and not the other. */

export type NavLink = { label: string; href: string; color: string };

export const NAV_LINKS: readonly NavLink[] = [
  { label: "HOME", href: "/", color: "bg-amber" },
  { label: "BRIEFS", href: "/briefs", color: "bg-lavender" },
  { label: "BRAIN", href: "/brain", color: "bg-hudblue" },
  { label: "TELOS", href: "/telos", color: "bg-cyan-hud" },
  { label: "HABITS", href: "/habits", color: "bg-sage" },
  { label: "MAIL", href: "/mail", color: "bg-lavender" },
  { label: "STUDIO", href: "/studio", color: "bg-ochre" },
  { label: "DOCS", href: "/documents", color: "bg-lavender" },
  { label: "PEOPLE", href: "/contacts", color: "bg-salmon" },
  { label: "COMMS", href: "/conversations", color: "bg-salmon" },
  { label: "CTRL", href: "/control", color: "bg-steel" },
] as const;

/** HOME matches only the exact root; every other section owns its subtree. */
export function isActiveRoute(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
