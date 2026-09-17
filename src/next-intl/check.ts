#!/usr/bin/env bun
import { parseArgs } from "node:util";
import {
  CONFIG_FILE,
  listCsvFiles,
  loadConfig,
  missingColumns,
  readCsv,
  readKey,
  requireCsvFolder,
  VALID_KEY,
} from "./shared";

const HELP = `
Check a CSV folder for duplicate keys and empty language cells before building.

Each empty cell is reported as either "default" (filled from defaultLanguage) or
"empty" (written as an empty string because there is no fallback value).

Usage:
  bun run next-intl-check <csvFolder> [options]

Options:
  -c, --config <file>   Config file (default: ./${CONFIG_FILE})
  -n, --limit <n>       Max keys listed per section (default: 20, 0 = all)
  -S, --summary         Counts only, do not list keys
  -s, --strict          Exit 1 for default-filled cells too, not just empty ones
  -h, --help            Show this help

Exit code 1 when any cell would be written empty (or, with --strict, filled
from defaultLanguage).
`.trim();

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    config: { type: "string", short: "c", default: CONFIG_FILE },
    limit: { type: "string", short: "n", default: "20" },
    summary: { type: "boolean", short: "S", default: false },
    strict: { type: "boolean", short: "s", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help || positionals.length === 0) {
  console.log(HELP);
  process.exit(values.help ? 0 : 1);
}

const limit = Number(values.limit);
if (!Number.isInteger(limit) || limit < 0) {
  console.error(`Invalid --limit "${values.limit}": expected a non-negative integer.`);
  process.exit(1);
}

const csvFolder = await requireCsvFolder(positionals[0]!);
const { config, defaultLanguage } = await loadConfig(values.config!);
const csvFiles = await listCsvFiles(csvFolder);

type Hit = { key: string; file: string };
type Report = {
  /** Cell empty, defaultLanguage has a value for the same row -> that value is used. */
  default: Hit[];
  /** Cell empty and no fallback available -> "" is written. */
  empty: Hit[];
};
const report: Record<string, Report> = Object.fromEntries(
  config.language.map((l) => [l.as, { default: [], empty: [] } as Report]),
);

const occurrences = new Map<string, string[]>(); // key -> files it appears in, in read order
let rows = 0;
let skipped = 0;
let skippedFiles = 0;

for (const file of csvFiles) {
  const { records, header } = await readCsv(csvFolder, file);

  const missingCols = missingColumns(config, header);
  if (missingCols.length) {
    console.warn(`⚠ ${file}: missing column(s) ${missingCols.map((c) => `"${c}"`).join(", ")} — skipped`);
    skippedFiles++;
    continue;
  }

  for (const rec of records) {
    const key = readKey(config, rec);
    if (!key) continue;
    if (!VALID_KEY.test(key)) {
      skipped++;
      continue;
    }

    const where = occurrences.get(key);
    if (where) where.push(file);
    else occurrences.set(key, [file]);

    const fallback = defaultLanguage ? String(rec[defaultLanguage.name] ?? "").trim() : "";
    for (const lang of config.language) {
      if (String(rec[lang.name] ?? "").trim()) continue;
      // The default language's own empty cell can never be filled by itself.
      const filled = fallback && lang.as !== defaultLanguage?.as;
      report[lang.as]![filled ? "default" : "empty"].push({ key, file });
    }
    rows++;
  }
}

/** Print at most `limit` lines, then how many were withheld. */
function printList<T>(items: T[], line: (item: T) => string) {
  if (values.summary) return;
  const shown = limit === 0 ? items : items.slice(0, limit);
  for (const item of shown) console.log(line(item));
  if (shown.length < items.length) console.log(`    … ${items.length - shown.length} more`);
}

const fallbackNote = defaultLanguage
  ? `fallback: ${defaultLanguage.as} ("${defaultLanguage.name}")`
  : `no defaultLanguage — empty cells stay empty`;
console.log(`${occurrences.size} key(s) in ${rows} row(s) from ${csvFiles.length - skippedFiles} csv file(s) — ${fallbackNote}\n`);

// --- Duplicate keys: last occurrence wins at build time, so these silently overwrite.
const duplicates = [...occurrences].filter(([, files]) => files.length > 1);
if (duplicates.length) {
  const keyPad = Math.min(40, Math.max(...duplicates.map(([k]) => k.length)));
  console.log(`✗ ${duplicates.length} duplicate key(s) — the last occurrence wins`);
  printList(duplicates, ([key, files]) => `    ${key.padEnd(keyPad)}  ${files.join(" → ")}`);
  console.log("");
}

// --- Empty cells per language.
const pad = Math.max(...config.language.map((l) => l.as.length));
let totalDefault = 0;
let totalEmpty = 0;
for (const lang of config.language) {
  const { default: filled, empty } = report[lang.as]!;
  totalDefault += filled.length;
  totalEmpty += empty.length;
  const status = empty.length ? "✗" : filled.length ? "!" : "✓";
  const counts = [
    `${rows - filled.length - empty.length}/${rows} filled`,
    filled.length ? `${filled.length} from default` : "",
    empty.length ? `${empty.length} empty` : "",
  ].filter(Boolean).join(", ");
  console.log(`${status} ${lang.as.padEnd(pad)}  ${counts}`);

  const hits = [...empty.map((h) => ["empty  ", h] as const), ...filled.map((h) => ["default", h] as const)];
  printList(hits, ([label, h]) => `    ${label} ${h.key}  (${h.file})`);
}

const notes = [
  duplicates.length ? `${duplicates.length} duplicate key(s)` : "",
  skipped ? `${skipped} non-key row(s) skipped` : "",
  skippedFiles ? `${skippedFiles} csv file(s) skipped` : "",
].filter(Boolean);
console.log(`\n${totalDefault} cell(s) fall back to default, ${totalEmpty} cell(s) empty` + (notes.length ? ` (${notes.join(", ")})` : ""));

process.exit(totalEmpty || (values.strict && totalDefault) ? 1 : 0);
