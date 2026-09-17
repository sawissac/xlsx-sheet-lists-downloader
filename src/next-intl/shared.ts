import { join, resolve } from "node:path";
import { readdir, stat } from "node:fs/promises";
import * as XLSX from "xlsx";
import { CONFIG_FILE, type LanguageColumn, type NextIntlConfig } from "./config";

/** Sheets often contain section-title rows ("Header, Draft State") or "—" placeholders in the key column. */
export const VALID_KEY = /^[\w-]+(\.[\w-]+)*$/;

/** Exit with a message. Used for every user-facing failure in the CLIs. */
export function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

export async function requireCsvFolder(input: string): Promise<string> {
  const csvFolder = resolve(input);
  if (!(await stat(csvFolder).catch(() => null))?.isDirectory()) fail(`Not a directory: ${csvFolder}`);
  return csvFolder;
}

export async function listCsvFiles(csvFolder: string): Promise<string[]> {
  const files = (await readdir(csvFolder)).filter((f) => f.toLowerCase().endsWith(".csv")).sort();
  if (files.length === 0) fail(`No .csv files in ${csvFolder}`);
  return files;
}

export type LoadedConfig = {
  config: NextIntlConfig;
  /** Resolved `defaultLanguage` column, or undefined when none is configured. */
  defaultLanguage: LanguageColumn | undefined;
};

export async function loadConfig(configFile: string): Promise<LoadedConfig> {
  const configPath = resolve(configFile);
  if (!(await Bun.file(configPath).exists())) {
    fail(`Config not found: ${configPath}\nRun "bun run next-intl-init" first.`);
  }
  const config = (await import(configPath)).default as NextIntlConfig;
  if (
    !config?.key?.name ||
    !Array.isArray(config.language) ||
    config.language.length === 0 ||
    config.language.some((l) => !l?.name || !l?.as)
  ) {
    fail(`Invalid config in ${configPath}: need key.name and a non-empty language[] of { name, as }`);
  }
  const dupAs = config.language.map((l) => l.as).filter((a, i, arr) => arr.indexOf(a) !== i);
  if (dupAs.length) fail(`Invalid config: duplicate "as" value(s) ${[...new Set(dupAs)].join(", ")}`);

  // Fallback column: rows with an empty value for a language reuse this one's value.
  const defaultLanguage = config.defaultLanguage
    ? config.language.find((l) => l.as === config.defaultLanguage)
    : undefined;
  if (config.defaultLanguage && !defaultLanguage) {
    fail(
      `Invalid config: defaultLanguage "${config.defaultLanguage}" is not one of the language "as" values ` +
        `(${config.language.map((l) => l.as).join(", ")})`,
    );
  }
  return { config, defaultLanguage };
}

export type CsvSheet = {
  /** Rows keyed by trimmed header cell. */
  records: Record<string, unknown>[];
  header: string[];
};

export async function readCsv(csvFolder: string, file: string): Promise<CsvSheet> {
  const wb = XLSX.read(await Bun.file(join(csvFolder, file)).text(), { type: "string" });
  const sheet = wb.Sheets[wb.SheetNames[0]!]!;
  // Trim header cells: sheets often have stray spaces ("Lang Value ").
  const rawRecords = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  const records = rawRecords.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim(), v])));
  return { records, header: Object.keys(records[0] ?? {}) };
}

/** Columns the config needs that this CSV does not have. */
export function missingColumns(config: NextIntlConfig, header: string[]): string[] {
  return [config.key.name, ...config.language.map((l) => l.name)].filter((c) => !header.includes(c));
}

/** Key cell of a row after the configured find/replace; "" when the row has no key. */
export function readKey(config: NextIntlConfig, rec: Record<string, unknown>): string {
  const key = String(rec[config.key.name] ?? "").trim();
  if (!key) return "";
  return config.key.targetText ? key.replaceAll(config.key.targetText, config.key.replaceText) : key;
}

export { CONFIG_FILE };
