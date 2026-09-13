"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { CompanyLogo } from "./CompanyLogo";
import { StatusBadge } from "./StatusBadge";
import { MAX_TOOLS } from "@/lib/limits";
import type { Suggestion } from "@/lib/signals";
import type { CompanyStatus } from "@/lib/types";

export interface SearchHit {
  id: string;
  name: string;
  slug: string;
  domain: string;
  logoUrl: string | null;
  status: CompanyStatus;
  networkEligible: boolean;
}

interface TypedDomain {
  domain: string;
  website: string;
  networkEligible: boolean;
}

interface SelectedTool {
  key: string;
  existingCompanyId?: string;
  name: string;
  domain: string;
  website?: string;
  logoUrl?: string | null;
  status?: CompanyStatus;
  countsAsCredit: boolean;
  recommend: boolean;
}

export interface StackFormState {
  error?: string;
}

type StackAction = (
  state: StackFormState,
  formData: FormData,
) => Promise<StackFormState>;

function titleFromDomain(domain: string): string {
  const label = domain.split(".")[0] ?? domain;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * The one required interaction in the product, so it has to be quick: type,
 * pick, done. A tool that isn't in the network yet is added from the same
 * input — the person crediting it never fills in someone else's profile.
 *
 * In "tools" mode the counter is the point: three independent vendors is what
 * a claim costs, and incumbents visibly don't count towards it.
 */
export function StackEditor({
  action,
  companyName,
  submitLabel,
  mode = "tools",
  existingCredits = 0,
  requiredCredits = 0,
  suggestionsFor,
  max = MAX_TOOLS,
}: {
  action: StackAction;
  companyName: string;
  submitLabel: string;
  mode?: "tools" | "customers";
  existingCredits?: number;
  /** 0 means no gate — used for the "anything missing?" editor. */
  requiredCredits?: number;
  /**
   * Company slug to fetch one-click prefill for. Loaded after mount on
   * purpose: reading a vendor's website takes seconds, and the editor must be
   * usable immediately rather than waiting for it.
   */
  suggestionsFor?: string;
  max?: number;
}) {
  const [state, formAction] = useActionState<StackFormState, FormData>(action, {});
  const [selected, setSelected] = useState<SelectedTool[]>([]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [typed, setTyped] = useState<TypedDomain | null>(null);
  const [searching, setSearching] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const requiresCredits = requiredCredits > 0;
  const full = selected.length >= max;
  // Both halves of the unlock page render an editor, so the input needs an id
  // of its own for its label to point at the right field.
  const inputId = `tool-search-${mode}`;

  const chosenIds = useMemo(
    () => selected.map((tool) => tool.existingCompanyId).filter(Boolean),
    [selected],
  );
  const chosenDomains = useMemo(
    () => new Set(selected.map((tool) => tool.domain)),
    [selected],
  );

  const credits =
    existingCredits + selected.filter((tool) => tool.countsAsCredit).length;
  const creditsShort = Math.max(0, requiredCredits - credits);

  useEffect(() => {
    if (!suggestionsFor) return;

    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(
          `/api/suggestions?slug=${encodeURIComponent(suggestionsFor)}&kind=${mode}`,
          { signal: controller.signal },
        );
        if (!response.ok) return;
        const data = (await response.json()) as { suggestions?: Suggestion[] };
        setSuggestions(data.suggestions ?? []);
      } catch {
        // No suggestions is a fine outcome; the editor works without them.
      }
    })();

    return () => controller.abort();
  }, [suggestionsFor, mode]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2 || full) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ q: trimmed });
        if (chosenIds.length) params.set("exclude", chosenIds.join(","));
        const response = await fetch(`/api/search?${params}`, {
          signal: controller.signal,
        });
        const data = (await response.json()) as {
          results?: SearchHit[];
          typed?: TypedDomain | null;
        };
        setHits(data.results ?? []);
        setTyped(data.typed ?? null);
        setActive(0);
      } catch {
        // An aborted or failed lookup just means no suggestions.
      } finally {
        setSearching(false);
      }
    }, 140);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, chosenIds, full]);

  // Suggestions only exist while there is a real query; below that the list is
  // closed, so stale results can never be picked.
  const queryIsLive = query.trim().length >= 2 && !full;
  const showCreateRow =
    !!typed &&
    !chosenDomains.has(typed.domain) &&
    !hits.some((hit) => hit.domain === typed.domain);

  const options: (
    | { kind: "hit"; hit: SearchHit }
    | { kind: "new"; typed: TypedDomain }
  )[] = queryIsLive
    ? [
        ...hits
          .filter((hit) => !chosenDomains.has(hit.domain))
          .map((hit) => ({ kind: "hit" as const, hit })),
        ...(showCreateRow && typed
          ? [{ kind: "new" as const, typed }]
          : []),
      ]
    : [];

  function add(tool: Omit<SelectedTool, "key" | "recommend">) {
    if (full || chosenDomains.has(tool.domain)) return;
    setSelected((current) => [
      ...current,
      { ...tool, key: `${tool.domain}-${current.length}`, recommend: false },
    ]);
    setQuery("");
    setHits([]);
    setTyped(null);
    setOpen(false);
    inputRef.current?.focus();
  }

  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    if (option.kind === "hit") {
      add({
        existingCompanyId: option.hit.id,
        name: option.hit.name,
        domain: option.hit.domain,
        logoUrl: option.hit.logoUrl,
        status: option.hit.status,
        countsAsCredit: option.hit.networkEligible,
      });
    } else {
      add({
        name: titleFromDomain(option.typed.domain),
        domain: option.typed.domain,
        website: option.typed.website,
        countsAsCredit: option.typed.networkEligible,
      });
    }
  }

  const payload = selected.map((tool) => ({
    existingCompanyId: tool.existingCompanyId,
    name: tool.name,
    website: tool.website,
    recommend: tool.recommend,
  }));

  const blocked =
    selected.length === 0 || (requiresCredits && creditsShort > 0);

  // Suggestions already added drop off the chip row.
  const openSuggestions = suggestions.filter(
    (suggestion) => !chosenDomains.has(suggestion.domain),
  );

  return (
    <form action={formAction} className="mt-8">
      <input type="hidden" name="tools" value={JSON.stringify(payload)} />

      <div className="relative">
        <label className="label" htmlFor={inputId}>
          {mode === "tools"
            ? "Search the network, or paste a URL"
            : "Search for the company, or paste its URL"}
        </label>
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          autoComplete="off"
          className="field"
          placeholder={
            full
              ? `${max} at a time is the most`
              : mode === "tools"
                ? "e.g. Tally, or tally.so"
                : "e.g. Acme, or acme.dev"
          }
          value={query}
          disabled={full}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((index) => Math.min(index + 1, options.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(active);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        />

        {open && queryIsLive && (
          <div className="card absolute z-20 mt-1.5 w-full overflow-hidden p-1 shadow-[0_8px_24px_-12px_rgba(20,19,15,0.35)]">
            {options.length === 0 && (
              <p className="px-3 py-3 text-sm text-ink-3">
                {searching
                  ? "Looking…"
                  : "Not in the network yet — paste the URL to add it."}
              </p>
            )}
            {options.map((option, index) => (
              <button
                key={option.kind === "hit" ? option.hit.id : option.typed.domain}
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(index)}
                className={`flex w-full items-center gap-3 rounded px-2.5 py-2 text-left ${
                  active === index ? "bg-paper" : ""
                }`}
              >
                {option.kind === "hit" ? (
                  <>
                    <CompanyLogo
                      name={option.hit.name}
                      logoUrl={option.hit.logoUrl}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {option.hit.name}
                      </span>
                      <span className="mono block truncate text-ink-3">
                        {option.hit.domain}
                        {requiresCredits && !option.hit.networkEligible
                          ? " · doesn’t count"
                          : ""}
                      </span>
                    </span>
                    <StatusBadge status={option.hit.status} />
                  </>
                ) : (
                  <>
                    <span
                      aria-hidden
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-dashed border-line-strong text-ink-3"
                    >
                      +
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        Add {titleFromDomain(option.typed.domain)}
                      </span>
                      <span className="mono block truncate text-ink-3">
                        {option.typed.domain} ·{" "}
                        {requiresCredits && !option.typed.networkEligible
                          ? "large tool, doesn’t count"
                          : "new profile"}
                      </span>
                    </span>
                  </>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {requiresCredits && (
        <CreditMeter credits={credits} required={requiredCredits} />
      )}

      {openSuggestions.length > 0 && (
        <div className="mt-5">
          <p className="label">
            {mode === "tools"
              ? `Found on ${companyName}'s own site — do these power you?`
              : `Found on ${companyName}'s own site — do these use your product?`}
          </p>
          <div className="flex flex-wrap gap-2">
            {openSuggestions.map((suggestion) => (
              <button
                key={suggestion.domain}
                type="button"
                title={suggestion.reason}
                onClick={() =>
                  add({
                    name: suggestion.name,
                    domain: suggestion.domain,
                    website: suggestion.website,
                    countsAsCredit:
                      mode === "customers" || suggestion.networkEligible,
                  })
                }
                className="card card-hover flex items-center gap-2 px-2.5 py-1.5 text-sm"
              >
                <span aria-hidden className="text-ink-3">
                  +
                </span>
                <span className="font-medium">{suggestion.name}</span>
                <span className="mono text-ink-3">{suggestion.domain}</span>
              </button>
            ))}
          </div>
          <p className="mono mt-2 text-ink-3">
            Read from their public site. Add the ones that are right, ignore the
            rest.
          </p>
        </div>
      )}

      {selected.length > 0 && (
        <ul className="mt-5 divide-y divide-line border-y border-line">
          {selected.map((tool, index) => (
            <li
              key={tool.key}
              className="flex flex-wrap items-center gap-3 py-3"
            >
              <CompanyLogo name={tool.name} logoUrl={tool.logoUrl} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium tracking-tight">
                  {tool.name}
                </span>
                <span className="mono block truncate text-ink-3">
                  {tool.domain}
                  {requiresCredits && !tool.countsAsCredit
                    ? " · stack item, doesn’t count"
                    : tool.existingCompanyId
                      ? ""
                      : " · new profile"}
                </span>
              </span>

              {mode === "tools" && (
                <span className="flex overflow-hidden rounded-md border border-line-strong">
                  <button
                    type="button"
                    aria-pressed={!tool.recommend}
                    onClick={() =>
                      setSelected((current) =>
                        current.map((item, i) =>
                          i === index ? { ...item, recommend: false } : item,
                        ),
                      )
                    }
                    className={`mono px-2.5 py-1.5 ${
                      tool.recommend ? "text-ink-3" : "bg-ink text-paper"
                    }`}
                  >
                    Just using it
                  </button>
                  <button
                    type="button"
                    aria-pressed={tool.recommend}
                    onClick={() =>
                      setSelected((current) =>
                        current.map((item, i) =>
                          i === index ? { ...item, recommend: true } : item,
                        ),
                      )
                    }
                    className={`mono border-l border-line-strong px-2.5 py-1.5 ${
                      tool.recommend
                        ? "bg-accent text-white"
                        : "text-ink-3 hover:text-accent-ink"
                    }`}
                  >
                    <span aria-hidden>♥ </span>Recommend
                  </button>
                </span>
              )}

              <button
                type="button"
                onClick={() =>
                  setSelected((current) => current.filter((_, i) => i !== index))
                }
                aria-label={`Remove ${tool.name}`}
                className="mono px-1.5 text-ink-3 hover:text-accent"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {state.error && (
        <p className="mt-4 border-l-2 border-accent pl-3 text-sm text-accent-ink">
          {state.error}
        </p>
      )}

      <div className="mt-7 flex flex-wrap items-center gap-4">
        <SubmitButton disabled={blocked} label={submitLabel} />
        <p className="text-sm text-ink-3">
          {requiresCredits && creditsShort > 0
            ? `${creditsShort} more to unlock this half.`
            : mode === "customers"
              ? "Shown as your word until they confirm it."
              : "Saved to your profile."}
        </p>
      </div>
    </form>
  );
}

/** `0/2` — half the claim price, always visible. */
function CreditMeter({
  credits,
  required,
}: {
  credits: number;
  required: number;
}) {
  const done = credits >= required;
  return (
    <div className="mt-3 flex items-center gap-2.5">
      <span className="flex gap-1.5" aria-hidden>
        {Array.from({ length: required }, (_, index) => (
          <span
            key={index}
            className={`h-1.5 w-8 rounded-full ${
              index < credits ? "bg-accent" : "bg-line-strong"
            }`}
          />
        ))}
      </span>
      <span className="mono text-ink-3">
        <span className={done ? "text-accent-ink" : "text-ink"}>
          {Math.min(credits, required)}/{required}
        </span>
        {done ? " ✓" : ""}
      </span>
    </div>
  );
}

function SubmitButton({
  disabled,
  label,
}: {
  disabled: boolean;
  label: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="btn btn-primary"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}
