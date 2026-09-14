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
