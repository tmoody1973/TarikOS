"use client";

import { useMemo, useState } from "react";
import { Authenticated, AuthLoading, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { rankContacts } from "../../../convex/contactsLib";

// Contacts (MOO-499). The screen counterpart to find_contact: the same book
// Zola searches by voice, for when he is at a keyboard instead of talking.
//
// Salmon, the COMMS channel. A contact is a person he communicates with, and
// the Channel Color Rule says a new surface claims a hue rather than borrowing
// one at random — this one joins /conversations rather than inventing a colour.
//
// Layout follows /mail because the shape is the same problem: a long list and
// one detail. Below lg the list yields entirely to the card, which the mobile
// spec requires of list+detail pages — a reflow leaves both halves unusable at
// 375px.

type Contact = {
  key: string;
  name: string;
  phones: string[];
  emails: string[];
  org?: string;
  photo?: string;
  sources: { source: string; sourceId: string }[];
};

export default function ContactsPage() {
  return (
    <>
      <Authenticated>
        <ContactsInner />
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

/** The label Google would show, falling back to something rather than blank. */
function displayName(c: Contact): string {
  return c.name || c.emails[0] || c.phones[0] || "UNNAMED";
}

function ContactsInner() {
  const [includeUnreachable, setIncludeUnreachable] = useState(false);
  const [query, setQuery] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);

  const book = useQuery(api.contacts.book, { includeUnreachable });
  const contacts = useMemo(() => book?.contacts ?? [], [book]);

  // Searched in the browser against the loaded book, using the SAME ranking
  // the voice tool uses. A second implementation here would let the page and
  // Zola disagree about who "Marcus" is.
  const shown = useMemo(
    () => (query.trim() ? rankContacts(contacts, query, 200) : contacts),
    [contacts, query],
  );
  const open = shown.find((c) => c.key === openKey) ?? null;

  return (
    <div className="flex flex-1 flex-col gap-2 lg:flex-row">
      {/* List. Below lg it yields to the card while one is open. */}
      <section
        className={`w-full flex-col lg:flex lg:w-96 lg:shrink-0 ${
          open ? "hidden lg:flex" : "flex"
        }`}
      >
        <div className="flex flex-1 flex-col rounded-lg border border-panel-edge bg-panel">
          <div className="border-b border-panel-edge px-5 py-3">
            <p className="font-[family-name:var(--font-mono-hud)] text-[10px] uppercase tracking-[0.3em] text-salmon">
              CONTACTS
            </p>
            <label className="sr-only" htmlFor="contact-search">
              Search contacts
            </label>
            <input
              id="contact-search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpenKey(null);
              }}
              placeholder="NAME, NUMBER OR EMAIL"
              className="mt-2 w-full rounded-md border border-panel-edge bg-space-black px-3 py-2 font-[family-name:var(--font-mono-hud)] text-sm text-ice placeholder:text-steel focus-visible:border-salmon focus-visible:outline-2 focus-visible:outline-cyan-hud"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="font-[family-name:var(--font-mono-hud)] text-[10px] uppercase tracking-[0.2em] text-steel">
                {book === undefined
                  ? "LOADING…"
                  : `${shown.length} OF ${book.reachable} REACHABLE`}
              </p>
              <button
                type="button"
                onClick={() => setIncludeUnreachable((v) => !v)}
                aria-pressed={includeUnreachable}
                className={`rounded-full border px-2.5 py-0.5 font-[family-name:var(--font-mono-hud)] text-[10px] uppercase tracking-[0.2em] transition-colors focus-visible:outline-2 focus-visible:outline-cyan-hud ${
                  includeUnreachable
                    ? "border-salmon text-salmon"
                    : "border-panel-edge text-steel hover:border-salmon hover:text-salmon"
                }`}
              >
                {/* 4,033 of the book have no phone and no email — addresses
                    Gmail saved from people he emailed once. Off by default. */}
                ALL {book ? book.total : ""}
              </button>
            </div>
          </div>

          {book === undefined ? (
            <p className="pulse-soft p-3 font-[family-name:var(--font-mono-hud)] text-xs tracking-[0.3em] text-steel">
              READING BOOK…
            </p>
          ) : shown.length === 0 ? (
            <p className="p-3 font-[family-name:var(--font-mono-hud)] text-sm text-steel">
              {query.trim()
                ? `Nobody matching "${query.trim()}".`
                : "No contacts synced yet."}
            </p>
          ) : (
            <ul className="flex-1 space-y-1 overflow-y-auto p-2">
              {shown.slice(0, 300).map((c) => (
                <li key={c.key}>
                  <button
                    type="button"
                    onClick={() => setOpenKey(c.key)}
                    aria-current={openKey === c.key ? "true" : undefined}
                    className={`w-full rounded-md border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-cyan-hud ${
                      openKey === c.key
                        ? "border-salmon bg-salmon/10"
                        : "border-transparent hover:border-panel-edge"
                    }`}
                  >
                    <p className="truncate font-[family-name:var(--font-mono-hud)] text-sm text-ice">
                      {displayName(c)}
                    </p>
                    <p className="truncate font-[family-name:var(--font-mono-hud)] text-[10px] uppercase tracking-[0.2em] text-steel">
                      {c.phones[0] ?? c.emails[0] ?? c.org ?? "NO CONTACT DETAILS"}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {shown.length > 300 && (
            <p className="border-t border-panel-edge p-3 font-[family-name:var(--font-mono-hud)] text-[10px] uppercase tracking-[0.2em] text-steel">
              SHOWING 300 · KEEP TYPING TO NARROW
            </p>
          )}
        </div>
      </section>

      <section className={`flex-1 ${open ? "flex" : "hidden lg:flex"}`}>
        {open ? (
          <ContactCard contact={open} onClose={() => setOpenKey(null)} />
        ) : (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-panel-edge bg-panel">
            <p className="font-[family-name:var(--font-mono-hud)] text-[10px] uppercase tracking-[0.3em] text-steel">
              SELECT A CONTACT
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function ContactCard({
  contact,
  onClose,
}: {
  contact: Contact;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(value);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="flex flex-1 flex-col rounded-lg border border-panel-edge bg-panel">
      <div className="flex items-center justify-between gap-3 border-b border-panel-edge px-5 py-3">
        <div className="flex items-center gap-3">
          {/* The LCARS cap tick, the same header signature the SlideOver uses. */}
          <span className="h-4 w-8 shrink-0 rounded-l-full bg-salmon" aria-hidden />
          <p className="font-[family-name:var(--font-mono-hud)] text-[10px] uppercase tracking-[0.3em] text-salmon">
            CONTACT
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-panel-edge px-2.5 py-0.5 font-[family-name:var(--font-mono-hud)] text-[10px] uppercase tracking-[0.2em] text-steel transition-colors hover:border-salmon hover:text-salmon focus-visible:outline-2 focus-visible:outline-cyan-hud lg:hidden"
        >
          BACK
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        <div>
          {/* Names and orgs come from the provider, not from us. A single
              unbroken string here pushed a whole page sideways by 133px on
              /control before the same guard was added there. */}
          <h1 className="font-[family-name:var(--font-mono-hud)] text-lg text-ice [overflow-wrap:anywhere]">
            {displayName(contact)}
          </h1>
          {contact.org && (
            <p className="font-[family-name:var(--font-mono-hud)] text-sm text-steel [overflow-wrap:anywhere]">
              {contact.org}
            </p>
          )}
        </div>

        {contact.phones.length > 0 && (
          <Field label="PHONE">
            {contact.phones.map((p) => (
              <Row key={p} value={p} onCopy={() => copy(p)} copied={copied === p}>
                {/* tel: is the one action that works on every device today.
                    Calling THROUGH Zola is MOO-498 and does not exist yet, so
                    there is no button here pretending it does. */}
                <a
                  href={`tel:${p}`}
                  className="rounded-md border border-panel-edge px-2.5 py-0.5 font-[family-name:var(--font-mono-hud)] text-[10px] uppercase tracking-[0.2em] text-steel transition-colors hover:border-salmon hover:text-salmon focus-visible:outline-2 focus-visible:outline-cyan-hud"
                >
                  CALL
                </a>
              </Row>
            ))}
          </Field>
        )}

        {contact.emails.length > 0 && (
          <Field label="EMAIL">
            {contact.emails.map((e) => (
              <Row key={e} value={e} onCopy={() => copy(e)} copied={copied === e}>
                <a
                  href={`/mail?compose=1&to=${encodeURIComponent(e)}`}
                  className="rounded-md border border-panel-edge px-2.5 py-0.5 font-[family-name:var(--font-mono-hud)] text-[10px] uppercase tracking-[0.2em] text-steel transition-colors hover:border-lavender hover:text-lavender focus-visible:outline-2 focus-visible:outline-cyan-hud"
                >
                  DRAFT
                </a>
              </Row>
            ))}
          </Field>
        )}

        {contact.phones.length === 0 && contact.emails.length === 0 && (
          <p className="font-[family-name:var(--font-mono-hud)] text-sm text-steel">
            No phone or email — Gmail saved this one from an address he wrote to.
          </p>
        )}

        <Field label="SOURCE">
          {contact.sources.map((s) => (
            <p
              key={`${s.source}:${s.sourceId}`}
              className="font-[family-name:var(--font-mono-hud)] text-[10px] uppercase tracking-[0.2em] text-steel"
            >
              {s.source}
            </p>
          ))}
        </Field>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="font-[family-name:var(--font-mono-hud)] text-[10px] uppercase tracking-[0.3em] text-steel">
        {label}
      </p>
      {children}
    </div>
  );
}

function Row({
  value,
  onCopy,
  copied,
  children,
}: {
  value: string;
  onCopy: () => void;
  copied: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-panel-edge px-3 py-2">
      <span className="break-all font-[family-name:var(--font-mono-hud)] text-sm text-ice">
        {value}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onCopy}
          className="rounded-md border border-panel-edge px-2.5 py-0.5 font-[family-name:var(--font-mono-hud)] text-[10px] uppercase tracking-[0.2em] text-steel transition-colors hover:border-salmon hover:text-salmon focus-visible:outline-2 focus-visible:outline-cyan-hud"
        >
          {copied ? "COPIED" : "COPY"}
        </button>
        {children}
      </span>
    </div>
  );
}
