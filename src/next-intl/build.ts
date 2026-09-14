#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { basename, dirname, join, resolve } from "node:path";
import { mkdir, readdir, stat } from "node:fs/promises";
import * as XLSX from "xlsx";
import { CONFIG_FILE, type NextIntlConfig } from "./config";

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

const csvFolder = resolve(positionals[0]!);
if (!(await stat(csvFolder).catch(() => null))?.isDirectory()) {
  console.error(`Not a directory: ${csvFolder}`);
  process.exit(1);
}

const configPath = resolve(values.config!);
if (!(await Bun.file(configPath).exists())) {
  console.error(`Config not found: ${configPath}\nRun "bun run next-intl-init" first.`);
  process.exit(1);
}
const config = (await import(configPath)).default as NextIntlConfig;
if (
  !config?.key?.name ||
  !Array.isArray(config.language) ||
  config.language.length === 0 ||
  config.language.some((l) => !l?.name || !l?.as)
) {
  console.error(`Invalid config in ${configPath}: need key.name and a non-empty language[] of { name, as }`);
  process.exit(1);
}
const dupAs = config.language.map((l) => l.as).filter((a, i, arr) => arr.indexOf(a) !== i);
if (dupAs.length) {
  console.error(`Invalid config: duplicate "as" value(s) ${[...new Set(dupAs)].join(", ")}`);
  process.exit(1);
}

const csvFiles = (await readdir(csvFolder)).filter((f) => f.toLowerCase().endsWith(".csv")).sort();
if (csvFiles.length === 0) {
  console.error(`No .csv files in ${csvFolder}`);
  process.exit(1);
}

const messages: Record<string, Messages> = Object.fromEntries(config.language.map((l) => [l.as, {}]));
const seen = new Map<string, string>(); // key -> file it came from
let rows = 0;
let skipped = 0;

// Sheets often contain section-title rows ("Header, Draft State") or "—" placeholders in the key column.
const VALID_KEY = /^[\w-]+(\.[\w-]+)*$/;

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
  const wb = XLSX.read(await Bun.file(join(csvFolder, file)).text(), { type: "string" });
  const sheet = wb.Sheets[wb.SheetNames[0]!]!;
  // Trim header cells: sheets often have stray spaces ("Lang Value ").
  const rawRecords = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  const records = rawRecords.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim(), v])));
  const header = Object.keys(records[0] ?? {});

  const missingCols = [config.key.name, ...config.language.map((l) => l.name)].filter((c) => !header.includes(c));
  if (missingCols.length) {
    console.warn(`⚠ ${file}: missing column(s) ${missingCols.map((c) => `"${c}"`).join(", ")} — skipped`);
    continue;
  }

  for (const rec of records) {
    let key = String(rec[config.key.name] ?? "").trim();
    if (!key) continue;
    if (config.key.targetText) key = key.replaceAll(config.key.targetText, config.key.replaceText);
    if (!VALID_KEY.test(key)) {
      skipped++;
      continue;
    }

    const prev = seen.get(key);
    if (prev) console.warn(`⚠ ${file}: duplicate key "${key}" (first seen in ${prev}) — overwriting`);
    seen.set(key, file);

    for (const lang of config.language) {
      setNested(messages[lang.as]!, key, String(rec[lang.name] ?? ""), file);
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
