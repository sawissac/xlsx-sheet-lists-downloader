#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { basename, dirname, join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
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
Combine every .csv in a folder into next-intl message files.

Usage:
  bun run next-intl <csvFolder> [options]

Options:
  -o, --out <dir>       Parent output directory (default: parent of csvFolder).
                        Files are written to <dir>/<csvFolder-name>_nextintl/<column>.json
  -c, --config <file>   Config file (default: ./${CONFIG_FILE})
  --no-nested           Keep dotted keys flat: { "auth.password_forget": "…" }
                        instead of { "auth": { "password_forget": "…" } }
  --no-combined-file    One file per CSV per language: <column>/<csv-name>.json
                        instead of merging every CSV into <column>.json
  -h, --help            Show this help
`.trim();

type Messages = { [k: string]: string | Messages };

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  allowNegative: true,
  options: {
    out: { type: "string", short: "o" },
    config: { type: "string", short: "c", default: CONFIG_FILE },
    nested: { type: "boolean", default: true },
    "combined-file": { type: "boolean", default: true },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help || positionals.length === 0) {
  console.log(HELP);
  process.exit(values.help ? 0 : 1);
}

const nested = values.nested!;
const combined = values["combined-file"]!;

const csvFolder = await requireCsvFolder(positionals[0]!);
const { config, defaultLanguage } = await loadConfig(values.config!);
const csvFiles = await listCsvFiles(csvFolder);

// One bundle per output file set: the whole folder when combined, otherwise one per CSV.
// Duplicate keys only overwrite each other inside the same bundle.
type Bundle = {
  messages: Record<string, Messages>;
  seen: Map<string, string>; // key -> file it came from
};
const newBundle = (): Bundle => ({
  messages: Object.fromEntries(config.language.map((l) => [l.as, {}])),
  seen: new Map(),
});
const bundles = new Map<string, Bundle>(); // CSV name without extension ("" when combined) -> bundle
if (combined) bundles.set("", newBundle());
let rows = 0;
let skipped = 0;

// Set nested value for a dotted key ("a.b.c" -> {a:{b:{c:v}}}), which is what next-intl expects.
function setNested(obj: Messages, key: string, value: string, file: string): boolean {
  const parts = key.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    const next = cur[p];
    if (next === undefined) cur = cur[p] = {};
    else if (typeof next === "string") {
      console.warn(`⚠ ${file}: "${key}" conflicts with existing leaf "${parts.slice(0, i + 1).join(".")}" — skipped`);
      return false;
    } else cur = next;
  }
  const last = parts[parts.length - 1]!;
  if (typeof cur[last] === "object") {
    console.warn(`⚠ ${file}: "${key}" conflicts with existing namespace — skipped`);
    return false;
  }
  cur[last] = value;
  return true;
}

for (const file of csvFiles) {
  const { records, header } = await readCsv(csvFolder, file);

  const missingCols = missingColumns(config, header);
  if (missingCols.length) {
    console.warn(`⚠ ${file}: missing column(s) ${missingCols.map((c) => `"${c}"`).join(", ")} — skipped`);
    continue;
  }

  const bundleName = combined ? "" : file.replace(/\.csv$/i, "");
  let bundle = bundles.get(bundleName);
  if (!bundle) bundles.set(bundleName, (bundle = newBundle()));

  for (const rec of records) {
    const key = readKey(config, rec);
    if (!key) continue;
    if (!VALID_KEY.test(key)) {
      skipped++;
      continue;
    }

    const prev = bundle.seen.get(key);
    if (prev) console.warn(`⚠ ${file}: duplicate key "${key}" (first seen in ${prev}) — overwriting`);
    bundle.seen.set(key, file);

    const fallback = defaultLanguage ? String(rec[defaultLanguage.name] ?? "").trim() : "";
    for (const lang of config.language) {
      const value = String(rec[lang.name] ?? "");
      const msgs = bundle.messages[lang.as]!;
      const text = value.trim() ? value : fallback;
      if (nested) setNested(msgs, key, text, file);
      else msgs[key] = text;
    }
    rows++;
  }
}

const outParent = values.out ? resolve(values.out) : dirname(csvFolder);
const outDir = join(outParent, `${basename(csvFolder)}_nextintl`);

const safe = (name: string) => name.replace(/[\\/:*?"<>|]/g, "_").trim();
for (const [name, bundle] of bundles) {
  for (const lang of config.language) {
    const target = combined
      ? join(outDir, `${safe(lang.as)}.json`)
      : join(outDir, safe(lang.as), `${safe(name)}.json`);
    await mkdir(dirname(target), { recursive: true });
    await Bun.write(target, JSON.stringify(bundle.messages[lang.as], null, 2) + "\n");
    console.log(`✓ ${lang.name} -> ${target}`);
  }
}

console.log(
  `\nDone. ${rows} key(s) from ${csvFiles.length} csv file(s) -> ${bundles.size * config.language.length} json file(s) in ${outDir}` +
    (skipped ? ` (${skipped} non-key row(s) skipped)` : ""),
);
