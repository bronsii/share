export type UiLanguage = "de" | "en";

export const UI_LANGUAGE_STORAGE_KEY = "share-language";

export function preferredUiLanguage(value: string | null | undefined): UiLanguage {
  const supported = (value ?? "")
    .split(",")
    .map((entry) => entry.trim().split(";", 1)[0]?.toLowerCase())
    .find((entry) => entry === "de" || entry?.startsWith("de-") || entry === "en" || entry?.startsWith("en-"));
  return supported?.startsWith("en") ? "en" : "de";
}
