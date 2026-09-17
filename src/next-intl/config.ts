/** Shape of `next-intl.config.ts`. */
export type NextIntlConfig = {
  /** Column holding the translation key, with an optional find/replace applied to it. */
  key: {
    /** CSV column name that contains the message key (e.g. "Lang Key"). */
    name: string;
    /** Substring to find in every key. Empty string = no replacement. */
    targetText: string;
    /** Replacement for `targetText`. */
    replaceText: string;
  };
  /** Columns to export. Each becomes `<as>.json`. */
  language: LanguageColumn[];
  /**
   * `as` of the language used as fallback. When a row has no value for a
   * language, the default language's value for that row is written instead.
   * Omit (or leave empty) to write an empty string.
   */
  defaultLanguage?: string;
};

export type LanguageColumn = {
  /** CSV column name (e.g. "Japanese"). */
  name: string;
  /** Output file name without extension, usually a locale code (e.g. "ja"). */
  as: string;
};

export const CONFIG_FILE = "next-intl.config.ts";

export function defineConfig(config: NextIntlConfig): NextIntlConfig {
  return config;
}
