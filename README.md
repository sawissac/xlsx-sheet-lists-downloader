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

| Option                 | Description                                       |
| ---------------------- | ------------------------------------------------- |
| `-o, --out <dir>`    | Output directory (default:`./<workbook-name>/`) |
| `-f, --format <fmt>` | `xlsx` (default), `csv` or `json`           |
| `-s, --sheet <name>` | Only export this sheet — repeat for several      |
| `-l, --list`         | Print sheet names and exit                        |
| `-h, --help`         | Show help                                         |

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
  // fallback: empty cells reuse this language's value (omit to write "")
  defaultLanguage: "en",
});
```

### 2. Build

```bash
bun run next-intl ./path/to/csvFolder -o ./path/to/output
```

Reads every `.csv` in the folder, merges them, and writes one file per
language entry to `<output>/<csvFolder-name>_nextintl/<as>.json`
(`-o` defaults to the parent of the CSV folder; `-c` picks another config file).

Cells with no value fall back to `defaultLanguage`'s value for the same key; if
`defaultLanguage` is omitted (or its own cell is empty) an empty string is written.

Dotted keys are nested (`a.b.c` → `{ "a": { "b": { "c": … } } }`) as next-intl
expects. Rows whose key is not a dotted identifier (section titles, `—`) are
skipped; duplicate keys and CSVs missing a configured column are warned about.

### 3. Check for duplicates and missing translations

```bash
bun run next-intl-check ./path/to/csvFolder
```

Reads the same CSVs and config as the build, but writes nothing — it names every
duplicate key and every empty language cell:

* **duplicate** — the key appears in more than one row; at build time the last
  occurrence wins and the earlier ones are silently overwritten. Listed with the
  files it came from, in read order.
* **default** — the cell is empty but `defaultLanguage` has a value for that key,
  so that value is used.
* **empty** — the cell is empty and there is no fallback (no `defaultLanguage`, its
  own cell is empty, or the language *is* `defaultLanguage`), so `""` is written.

```
5 key(s) in 6 row(s) from 2 csv file(s) — fallback: en ("Lang Value")

✗ 1 duplicate key(s) — the last occurrence wins
    home.title  a.csv → b.csv

✗ en  5/6 filled, 1 empty
    empty   about.title  (a.csv)
✗ ja  4/6 filled, 1 from default, 1 empty
    empty   about.title  (a.csv)
    default home.sub  (a.csv)
! th  3/6 filled, 3 from default
    default home.sub  (a.csv)
    default about.body  (a.csv)
    default contact.title  (b.csv)

4 cell(s) fall back to default, 2 cell(s) empty (1 duplicate key(s), 1 non-key row(s) skipped)
```

| Option                 | Description                                            |
| ---------------------- | ------------------------------------------------------ |
| `-c, --config <file>` | Config file (default:`./next-intl.config.ts`)          |
| `-n, --limit <n>`     | Max keys listed per section (default:`20`, `0` = all)  |
| `-S, --summary`       | Counts only, do not list keys                           |
| `-s, --strict`        | Also fail on `default`-filled cells                     |
| `-h, --help`          | Show help                                               |

Empty cells are listed before `default`-filled ones, so the rows that need a
translator come first. Exits `1` when any cell would be written empty (with
`--strict`, also when any cell falls back to `defaultLanguage`), so it works as a
CI gate before the build. CSVs missing a configured column are warned about and
skipped, the same way the build skips them.
