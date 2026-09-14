/**
 * Just enough CSV for an import pipeline: quoted fields, embedded commas,
 * escaped quotes, CRLF. Not a general parser — it exists so the review file is
 * something a person can open in a spreadsheet and argue with.
 */

export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseRows(text);
  if (rows.length === 0) return [];

  const [header, ...body] = rows;
  return body
    .filter((cells) => cells.some((cell) => cell.trim() !== ""))
    .map((cells) => {
      const record: Record<string, string> = {};
      header.forEach((key, index) => {
        record[key] = cells[index] ?? "";
      });
      return record;
    });
}

function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let cells: string[] = [];
  let value = "";
  let quoted = false;

  // Strip a BOM: a leading ﻿ silently breaks the first column name.
  const input = text.replace(/^﻿/, "");

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(value);
      value = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      cells.push(value);
      rows.push(cells);
      cells = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value !== "" || cells.length > 0) {
    cells.push(value);
    rows.push(cells);
  }

  return rows;
}

export function toCsv(
  columns: string[],
  rows: Record<string, string | number | boolean>[],
): string {
  const lines = [columns.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(row[column] ?? "")).join(","));
  }
  return lines.join("\n") + "\n";
}

function csvCell(value: string | number | boolean): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * A source file that is either CSV or JSON, and JSON that is either an array
 * or an object wrapping one under a plausible key.
 */
export function parseSourceFile(
  text: string,
  filename: string,
): Record<string, string>[] {
  const looksJson =
    /\.json$/i.test(filename) || /^\s*[[{]/.test(text.slice(0, 200));

  if (!looksJson) return parseCsv(text);

  const parsed: unknown = JSON.parse(text);
  const array = Array.isArray(parsed)
    ? parsed
    : findArray(parsed as Record<string, unknown>);

  if (!array) {
    throw new Error(
      "That JSON has no array of records in it (looked at the top level and at data/records/items/tools/results).",
    );
  }

  return array.map((entry) => flatten(entry));
}

function findArray(object: Record<string, unknown>): unknown[] | null {
  for (const key of ["data", "records", "items", "tools", "results", "rows"]) {
    const value = object?.[key];
    if (Array.isArray(value)) return value;
  }
  return null;
}

/**
 * A nested record becomes flat `parent_child` keys, because the field mapper
 * works on flat column names and exports love nesting one level.
 */
function flatten(entry: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof entry !== "object" || entry === null) return out;

  for (const [key, value] of Object.entries(entry)) {
    const name = prefix ? `${prefix}_${key}` : key;
    if (value === null || value === undefined) continue;

    if (Array.isArray(value)) {
      out[name] = value
        .map((item) =>
          typeof item === "object" && item !== null
            ? Object.values(item).join(" ")
            : String(item),
        )
        .join(", ");
    } else if (typeof value === "object") {
      Object.assign(out, flatten(value, name));
    } else {
      out[name] = String(value);
    }
  }

  return out;
}
