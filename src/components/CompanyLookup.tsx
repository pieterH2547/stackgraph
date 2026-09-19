"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CompanyLogo } from "./CompanyLogo";
import { routes } from "@/lib/routes";
import { withBasePath } from "@/lib/url";

/**
 * The product's one question, as a field.
 *
 * It is a real form first and a typeahead second: submitting without picking
 * anything goes to /search, which works with JavaScript off, and the URL it
 * produces is something you can send to a colleague. The dropdown is the fast
 * path, not the only path.
 *
 * Selecting a company goes straight to its profile, because that is where the
 * answer is. Nothing here creates, claims or writes anything.
 */

interface Hit {
  id: string;
  name: string;
  slug: string;
  domain: string;
  logoUrl: string | null;
  status: string;
  usedBy: number;
  uses: number;
}

export function CompanyLookup({
  defaultValue = "",
  placeholder = "Search a software company…",
  size = "lg",
  autoFocus = false,
}: {
  defaultValue?: string;
  placeholder?: string;
  size?: "lg" | "md";
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const listId = useId();

  const [query, setQuery] = useState(defaultValue);
  /*
   * Results carry the query they answered. Rendering only when that matches
   * what is in the field is what keeps a slow response from painting stale
   * names under a newer query — and it means the effect never has to clear
   * state synchronously to keep the two in step.
   */
  const [answer, setAnswer] = useState<{ query: string; hits: Hit[] }>({
    query: "",
    hits: [],
  });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = query.trim();
  const live = trimmed.length >= 2;

  useEffect(() => {
    if (!live) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          withBasePath(`/api/search?q=${encodeURIComponent(trimmed)}`),
          { signal: controller.signal },
        );
        if (!response.ok) return;
        const data: { results?: Hit[] } = await response.json();
        setAnswer({ query: trimmed, hits: data.results ?? [] });
        setActive(-1);
      } catch {
        // An aborted or failed lookup leaves the form: submitting still works.
      }
    }, 140);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [trimmed, live]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const hits = answer.query === trimmed ? answer.hits : [];
  const visible = open && live && hits.length > 0;

  function go(hit: Hit) {
    setOpen(false);
    router.push(routes.profile(hit.slug));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!visible) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (index + 1) % hits.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index <= 0 ? hits.length - 1 : index - 1));
    } else if (event.key === "Enter" && active >= 0) {
      // Only intercept the submit when something is actually highlighted.
      event.preventDefault();
      go(hits[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  const field =
    size === "lg"
      ? "field !mt-0 flex-1 !py-4 !text-lg"
      : "field !mt-0 flex-1";

  return (
    <div ref={boxRef} className="relative">
      <form action={routes.search()} method="get" className="flex gap-2">
        <label className="sr-only" htmlFor={listId}>
          Search a software company
        </label>
        <input
          ref={inputRef}
          id={listId}
          name="q"
          type="search"
          autoComplete="off"
          role="combobox"
          aria-expanded={visible}
          aria-controls={`${listId}-list`}
          aria-autocomplete="list"
          value={query}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={field}
        />
        <button
          type="submit"
          className={`btn btn-secondary shrink-0 ${size === "lg" ? "!px-6" : ""}`}
        >
          Search
        </button>
      </form>

      {visible && (
        <ul
          id={`${listId}-list`}
          role="listbox"
          className="absolute left-0 right-0 z-20 mt-1.5 max-h-80 overflow-y-auto border border-line-strong bg-paper shadow-lg"
        >
          {hits.map((hit, index) => (
            <li key={hit.id} role="option" aria-selected={index === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => go(hit)}
                className={`flex w-full items-center gap-3 px-3 py-2.5 text-left ${
                  index === active ? "bg-surface" : ""
                }`}
              >
                <CompanyLogo name={hit.name} logoUrl={hit.logoUrl} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium tracking-tight">
                      {hit.name}
                    </span>
                    {hit.status === "CLAIMED" && (
                      <span className="mono shrink-0 text-accent-ink">✓</span>
                    )}
                  </span>
                  <span className="mono block truncate text-ink-3">
                    {hit.domain}
                  </span>
                </span>
                {/* Counts, not a score. Zero is shown as nothing, not as "0". */}
                {(hit.usedBy > 0 || hit.uses > 0) && (
                  <span className="mono shrink-0 text-ink-3">
                    {hit.usedBy > 0 && `${hit.usedBy} used by`}
                    {hit.usedBy > 0 && hit.uses > 0 && " · "}
                    {hit.uses > 0 && `${hit.uses} uses`}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
