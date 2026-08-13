import path from "node:path";

/** @param {string} name */
export function sanitizeFileName(name) {
  const withoutControlCharacters = Array.from(path.basename(name), (character) =>
    character.charCodeAt(0) < 32 ? "_" : character,
  ).join("");
  const baseName = withoutControlCharacters
    .replace(/[<>:"/\\|?*]/g, "_")
    .trim()
    .slice(0, 180)
    .replace(/[. ]+$/g, "")
    .trim();
  return baseName || "Datei";
}
