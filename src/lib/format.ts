export function timeAgo(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return "just now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;

  return `${Math.round(months / 12)}y ago`;
}

/**
 * Counts for the mono metadata style: `USED BY 04`.
 *
 * Zero-padded below ten, and grouped above a thousand — the graph passed three
 * thousand companies and `3010 COMPANIES` is a number you have to stop and
 * parse.
 */
export function padCount(value: number): string {
  if (value < 10) return `0${value}`;
  return value.toLocaleString("en-GB");
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

/** "1 software company says" / "4 software companies say". */
export function companiesSay(count: number): string {
  return count === 1
    ? "1 software company says"
    : `${count} software companies say`;
}

export function companiesCount(count: number): string {
  return count === 1 ? "1 software company" : `${count} software companies`;
}

export function percent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function decimal(value: number, digits = 1): string {
  return value.toFixed(digits);
}
