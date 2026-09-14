#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { join, relative, dirname } from "node:path";
import { readdir } from "node:fs/promises";
import * as XLSX from "xlsx";
import { CONFIG_FILE } from "./config";

const HELP = `
Generate ${CONFIG_FILE} in the current directory.

Usage:
  bun run next-intl-init [csvFolder] [options]

  csvFolder   Optional. Read the header of the first .csv found and pre-fill
              the config: first column = key, remaining columns = languages.

Options:
  -f, --force   Overwrite an existing ${CONFIG_FILE}
  -h, --help    Show this help
`.trim();

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    force: { type: "boolean", short: "f", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

const target = join(process.cwd(), CONFIG_FILE);
if ((await Bun.file(target).exists()) && !values.force) {
  console.error(`${CONFIG_FILE} already exists. Use --force to overwrite.`);
  process.exit(1);
}

let keyName = "Lang Key";
let languages = ["Lang Value"];

// Best-effort locale guess for the `as` field; falls back to the column name.
const LOCALE_GUESS: Record<string, string> = {
  "lang value": "en", english: "en", japanese: "ja", chinese: "zh", thai: "th",
  "brunei malay": "ms", malay: "ms", "myanmar (burmese)": "my", burmese: "my",
  "khmer (cambodian)": "km", khmer: "km", korean: "ko", vietnamese: "vi",
  indonesian: "id", french: "fr", german: "de", spanish: "es",
};
const guessAs = (name: string) => LOCALE_GUESS[name.toLowerCase()] ?? name;

const csvFolder = positionals[0];
if (csvFolder) {
  const csv = (await readdir(csvFolder)).filter((f) => f.toLowerCase().endsWith(".csv")).sort()[0];
  if (!csv) {
    console.error(`No .csv files found in ${csvFolder}`);
    process.exit(1);
  }
  const wb = XLSX.read(await Bun.file(join(csvFolder, csv)).text(), { type: "string" });
  const sheet = wb.Sheets[wb.SheetNames[0]!]!;
  const header = (XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })[0] ?? []).map((h) => String(h).trim());
  if (header.length < 2) {
    console.error(`${csv} needs at least a key column and one language column.`);
    process.exit(1);
  }
  keyName = header[0]!;
  languages = header.slice(1);
  console.log(`Pre-filled from ${csv}`);
}

// Import path is relative so the config keeps working if the repo moves.
let typesPath = relative(dirname(target), join(import.meta.dir, "config")).replaceAll("\\", "/");
if (!typesPath.startsWith(".")) typesPath = `./${typesPath}`;

const content = `import { defineConfig } from "${typesPath}";

export default defineConfig({
  key: {
    name: ${JSON.stringify(keyName)},
    // Find/replace applied to every key. Leave targetText empty to disable.
    targetText: "",
    replaceText: "",
  },
  // CSV columns to export. Each becomes <as>.json.
  language: [
${languages.map((l) => `    { name: ${JSON.stringify(l)}, as: ${JSON.stringify(guessAs(l))} },`).join("\n")}
  ],
});
`;

await Bun.write(target, content);
console.log(`✓ wrote ${CONFIG_FILE}`);
