/** @param {{ name: string, size: number, lastModified: number }} file */
export function recoveryFileKey(file) {
  return JSON.stringify([file.name, file.size, file.lastModified]);
}

/** @param {unknown} value */
export function validUploadRecovery(value) {
  if (!value || typeof value !== "object") return false;
  const recovery = /** @type {Record<string, any>} */ (value);
  const session = recovery.session;
  if (recovery.version !== 1
    || !session
    || !/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}--[a-f0-9]{32}$/u.test(session.id)
    || typeof session.expiresAt !== "string"
    || !Array.isArray(session.files)
    || !Array.isArray(recovery.files)
    || !Array.isArray(recovery.noncePrefixes)
    || recovery.files.length < 1
    || recovery.files.length > 20
    || session.files.length !== recovery.files.length
    || recovery.noncePrefixes.length !== recovery.files.length
    || typeof recovery.fragment !== "string"
    || !/^v1\.[A-Za-z0-9_-]{43}$/u.test(recovery.fragment)
    || !["1", "3", "7"].includes(recovery.days)
    || typeof recovery.message !== "string"
    || recovery.message.length > 500) return false;
  if (recovery.files.some((file) => !file
    || typeof file.name !== "string"
    || !Number.isSafeInteger(file.size)
    || file.size <= 0
    || !Number.isSafeInteger(file.lastModified)
    || file.lastModified < 0)) return false;
  return session.files.every((file) => file
    && typeof file.id === "string"
    && /^[a-f0-9]{32}$/u.test(file.id)
    && typeof file.name === "string"
    && Number.isSafeInteger(file.size)
    && file.size > 0
    && Number.isSafeInteger(file.uploaded)
    && file.uploaded >= 0)
    && recovery.noncePrefixes.every((nonce) => typeof nonce === "string" && /^[A-Za-z0-9_-]{16}$/u.test(nonce));
}

/**
 * @template {{ name: string, size: number, lastModified: number }} T
 * @param {T[]} incoming
 * @param {Array<{ name: string, size: number, lastModified: number }>} expected
 * @returns {T[] | null}
 */
export function orderRecoveryFiles(incoming, expected) {
  if (incoming.length !== expected.length) return null;
  const available = new Map();
  for (const file of incoming) {
    const key = recoveryFileKey(file);
    const matches = available.get(key) ?? [];
    matches.push(file);
    available.set(key, matches);
  }
  const orderedFiles = [];
  for (const expectedFile of expected) {
    const matches = available.get(recoveryFileKey(expectedFile));
    const selectedFile = matches?.shift();
    if (!selectedFile) return null;
    orderedFiles.push(selectedFile);
  }
  return Array.from(available.values()).some((matches) => matches.length > 0) ? null : orderedFiles;
}
