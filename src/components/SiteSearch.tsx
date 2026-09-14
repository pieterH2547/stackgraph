import { routes } from "@/lib/routes";

/**
 * A plain GET form, on purpose: no client state, no debounce, no JavaScript
 * needed, and the result is a URL somebody can send to a colleague. The
 * typeahead in the stack editor is a different job — that one is picking a
 * tool, this one is answering "who uses this?".
 */
export function SiteSearch({
  defaultValue = "",
  placeholder = "Search a company or a domain",
  autoFocus = false,
}: {
  defaultValue?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <form action={routes.search()} method="get" className="flex gap-2">
      <label className="sr-only" htmlFor="site-search">
        Search companies
      </label>
      <input
        id="site-search"
        name="q"
        type="search"
        defaultValue={defaultValue}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="field !mt-0 flex-1"
      />
      <button type="submit" className="btn btn-secondary shrink-0">
        Search
      </button>
    </form>
  );
}
