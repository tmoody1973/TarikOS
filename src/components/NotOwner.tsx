import { SignOutButton } from "@clerk/nextjs";

// Shown when a valid Clerk session belongs to someone who isn't OWNER_EMAIL.
// One instance serves one person (PRODUCT.md); this is the wall, not an error.
export function NotOwner() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="lcars-cap-left lcars-cap-right h-3 w-24 bg-salmon" />
      <h1 className="font-[family-name:var(--font-display)] text-3xl uppercase leading-none tracking-wide">
        This instance serves one person
      </h1>
      <p className="max-w-sm font-[family-name:var(--font-mono-hud)] text-sm leading-7 text-foreground/85">
        Tarik OS is single-user by design. Your account isn&apos;t the owner of
        this instance — but the whole system is open source, so you can stand up
        your own.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <a
          href="https://github.com/tmoody1973/TarikOS"
          className="lcars-cap-left lcars-cap-right flex h-11 items-center bg-amber px-7 transition hover:opacity-80 focus-visible:outline-2 focus-visible:outline-cyan-hud"
        >
          <span className="font-[family-name:var(--font-display)] text-base uppercase text-black">
            Fork it on GitHub
          </span>
        </a>
        <SignOutButton>
          <button className="rounded-md border border-panel-edge px-4 py-2.5 font-[family-name:var(--font-mono-hud)] text-xs uppercase tracking-[0.2em] text-steel transition hover:border-salmon/50 hover:text-salmon focus-visible:outline-2 focus-visible:outline-cyan-hud">
            Sign out
          </button>
        </SignOutButton>
      </div>
    </main>
  );
}
