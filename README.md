# xlsx-sheet-lists-downloader

Split every sheet of an Excel workbook into its own file (xlsx, csv or json).

## Install

```bash
bun install
```

## Usage

```bash
bun run split <workbook.xlsx> [options]
```

| Option | Description |
| --- | --- |
| `-o, --out <dir>` | Output directory (default: `./<workbook-name>/`) |
| `-f, --format <fmt>` | `xlsx` (default), `csv` or `json` |
| `-s, --sheet <name>` | Only export this sheet — repeat for several |
| `-l, --list` | Print sheet names and exit |
| `-h, --help` | Show help |

## Examples

```bash
# one .xlsx per sheet into ./report/
bun run split report.xlsx

# list sheets
bun run split report.xlsx --list

# two sheets as CSV into ./csv/
bun run split report.xlsx -f csv -s Users -s Orders -o csv
```

Sheet names are used as file names; characters not allowed in paths (`\ / : * ? " < > |`) are replaced with `_`.

## next-intl messages from CSV

Turn a folder of CSV files (one column of keys + one column per language) into
[next-intl](https://next-intl.dev) message files.

### 1. Generate the config

```bash
bun run next-intl-init [csvFolder]
```

Writes `next-intl.config.ts`. Pass the CSV folder to pre-fill it from the first
CSV's header (first column → key, the rest → languages, with a best-effort locale code for `as`). `--force` overwrites.

```ts
import { defineConfig } from "./src/next-intl/config";

export default defineConfig({
  key: {
    name: "Lang Key",   // CSV column holding the message key
    targetText: "",     // optional find …
    replaceText: "",    // … and replace applied to every key
  },
  // columns to export; `as` is the output file name (usually a locale code)
  language: [
    { name: "Lang Value", as: "en" },
    { name: "Japanese", as: "ja" },
    { name: "Thai", as: "th" },
  ],
});
```

### 2. Build

```bash
bun run next-intl ./path/to/csvFolder -o ./path/to/output
```

Reads every `.csv` in the folder, merges them, and writes one file per
language entry to `<output>/<csvFolder-name>_nextintl/<as>.json`
(`-o` defaults to the parent of the CSV folder; `-c` picks another config file).

Dotted keys are nested (`a.b.c` → `{ "a": { "b": { "c": … } } }`) as next-intl
expects. Rows whose key is not a dotted identifier (section titles, `—`) are
skipped; duplicate keys and CSVs missing a configured column are warned about.
