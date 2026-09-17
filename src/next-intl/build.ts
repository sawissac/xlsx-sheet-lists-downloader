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
  -h, --help            Show this help
`.trim();

type Messages = { [k: string]: string | Messages };

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    out: { type: "string", short: "o" },
    config: { type: "string", short: "c", default: CONFIG_FILE },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help || positionals.length === 0) {
  console.log(HELP);
  process.exit(values.help ? 0 : 1);
}

const csvFolder = await requireCsvFolder(positionals[0]!);
const { config, defaultLanguage } = await loadConfig(values.config!);
const csvFiles = await listCsvFiles(csvFolder);

const messages: Record<string, Messages> = Object.fromEntries(config.language.map((l) => [l.as, {}]));
const seen = new Map<string, string>(); // key -> file it came from
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

  for (const rec of records) {
    const key = readKey(config, rec);
    if (!key) continue;
    if (!VALID_KEY.test(key)) {
      skipped++;
      continue;
    }

    const prev = seen.get(key);
    if (prev) console.warn(`⚠ ${file}: duplicate key "${key}" (first seen in ${prev}) — overwriting`);
    seen.set(key, file);

    const fallback = defaultLanguage ? String(rec[defaultLanguage.name] ?? "").trim() : "";
    for (const lang of config.language) {
      const value = String(rec[lang.name] ?? "");
      setNested(messages[lang.as]!, key, value.trim() ? value : fallback, file);
    }
    rows++;
  }
}

const outParent = values.out ? resolve(values.out) : dirname(csvFolder);
const outDir = join(outParent, `${basename(csvFolder)}_nextintl`);
await mkdir(outDir, { recursive: true });

const safe = (name: string) => name.replace(/[\\/:*?"<>|]/g, "_").trim();
for (const lang of config.language) {
  const target = join(outDir, `${safe(lang.as)}.json`);
  await Bun.write(target, JSON.stringify(messages[lang.as], null, 2) + "\n");
  console.log(`✓ ${lang.name} -> ${target}`);
}

console.log(`\nDone. ${rows} key(s) from ${csvFiles.length} csv file(s) -> ${outDir}` + (skipped ? ` (${skipped} non-key row(s) skipped)` : ""));
