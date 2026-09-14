#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { basename, extname, join } from "node:path";
import { mkdir } from "node:fs/promises";
import * as XLSX from "xlsx";

const HELP = `
Split every sheet of an Excel workbook into its own file.

Usage:
  bun index.ts <workbook.xlsx> [options]

Options:
  -o, --out <dir>       Output directory (default: ./<workbook-name>)
  -f, --format <fmt>    xlsx | csv | json (default: xlsx)
  -s, --sheet <name>    Only export this sheet (repeatable)
  -l, --list            List sheet names and exit
  -h, --help            Show this help
`.trim();

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    out: { type: "string", short: "o" },
    format: { type: "string", short: "f", default: "xlsx" },
    sheet: { type: "string", short: "s", multiple: true },
    list: { type: "boolean", short: "l", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help || positionals.length === 0) {
  console.log(HELP);
  process.exit(values.help ? 0 : 1);
}

const format = values.format!.toLowerCase();
if (!["xlsx", "csv", "json"].includes(format)) {
  console.error(`Unknown format "${format}". Use xlsx, csv or json.`);
  process.exit(1);
}

const input = positionals[0]!;
const file = Bun.file(input);
if (!(await file.exists())) {
  console.error(`File not found: ${input}`);
  process.exit(1);
}

const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });

if (values.list) {
  workbook.SheetNames.forEach((name, i) => console.log(`${i + 1}. ${name}`));
  process.exit(0);
}

const wanted = values.sheet?.length
  ? workbook.SheetNames.filter((n) => values.sheet!.includes(n))
  : workbook.SheetNames;

const missing = (values.sheet ?? []).filter((n) => !workbook.SheetNames.includes(n));
if (missing.length) {
  console.error(`Sheet(s) not found: ${missing.join(", ")}`);
  process.exit(1);
}

const stem = basename(input, extname(input));
const outDir = values.out ?? join(process.cwd(), stem);
await mkdir(outDir, { recursive: true });

// Sheet names may contain characters illegal in filenames.
const safe = (name: string) => name.replace(/[\\/:*?"<>|]/g, "_").trim() || "sheet";

for (const name of wanted) {
  const sheet = workbook.Sheets[name]!;
  const target = join(outDir, `${safe(name)}.${format}`);

  let data: string | Uint8Array;
  if (format === "xlsx") {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, name);
    data = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
  } else if (format === "csv") {
    data = XLSX.utils.sheet_to_csv(sheet);
  } else {
    data = JSON.stringify(XLSX.utils.sheet_to_json(sheet, { defval: null }), null, 2);
  }

  await Bun.write(target, data);
  console.log(`✓ ${name} -> ${target}`);
}

console.log(`\nDone. ${wanted.length} sheet(s) written to ${outDir}`);
