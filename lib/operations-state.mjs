import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_CLEANUP_MAX_AGE_MS = 45 * 60 * 1000;

export function cleanupStatePath(sharedRoot) {
  return path.join(sharedRoot, ".operations", "cleanup.json");
}

async function readCleanupState(sharedRoot) {
  try {
    return JSON.parse(await readFile(/* turbopackIgnore: true */ cleanupStatePath(sharedRoot), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeCleanupState(sharedRoot, value) {
  const destination = cleanupStatePath(sharedRoot);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await mkdir(/* turbopackIgnore: true */ path.dirname(destination), { recursive: true, mode: 0o700 });
  try {
    await writeFile(/* turbopackIgnore: true */ temporary, JSON.stringify(value), { flag: "wx", mode: 0o600 });
    await rename(/* turbopackIgnore: true */ temporary, destination);
  } finally {
    await rm(/* turbopackIgnore: true */ temporary, { force: true }).catch(() => undefined);
  }
}

function validDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validCounts(counts) {
  return counts && [counts.expired, counts.incomplete].every((value) => Number.isSafeInteger(value) && value >= 0);
}

function validCleanupState(state) {
  return state?.version === 1 && validDate(state.lastAttemptAt)
    && ["success", "failure"].includes(state.lastAttemptStatus)
    && (state.lastSuccessAt === null
      ? state.lastSuccessCounts === null
      : validDate(state.lastSuccessAt) && validCounts(state.lastSuccessCounts))
    && (state.lastSuccessAt === null || Date.parse(state.lastSuccessAt) <= Date.parse(state.lastAttemptAt))
    && (state.lastAttemptStatus !== "success" || state.lastSuccessAt === state.lastAttemptAt);
}

/** Only the explicitly scheduled CLI calls this; request-triggered/manual cleanup does not. */
export async function recordScheduledCleanup({ sharedRoot, success, result = null, now = Date.now() }) {
  let previous = null;
  try {
    previous = await readCleanupState(sharedRoot);
  } catch {
    // A new scheduled run can recover a damaged status file.
  }
  if (!validCleanupState(previous)) previous = null;
  if (success && !validCounts(result)) throw new Error("Invalid cleanup result");
  const timestamp = new Date(now).toISOString();
  await writeCleanupState(sharedRoot, {
    version: 1,
    lastAttemptAt: timestamp,
    lastAttemptStatus: success ? "success" : "failure",
    lastSuccessAt: success ? timestamp : previous?.lastSuccessAt ?? null,
    lastSuccessCounts: success ? { expired: result.expired, incomplete: result.incomplete } : previous?.lastSuccessCounts ?? null,
  });
}

export async function readCleanupSummary({ sharedRoot, now = Date.now(), maxAgeMs = DEFAULT_CLEANUP_MAX_AGE_MS }) {
  const empty = { status: "unknown", lastAttemptAt: null, lastAttemptStatus: null, lastSuccessAt: null, lastSuccessCounts: null, maxAgeMs };
  try {
    const state = await readCleanupState(sharedRoot);
    if (!state) return empty;
    if (!validCleanupState(state) || Date.parse(state.lastAttemptAt) > now + 60_000
      || (state.lastSuccessAt && Date.parse(state.lastSuccessAt) > now + 60_000)) return { ...empty, status: "unavailable" };
    const age = state.lastSuccessAt ? now - Date.parse(state.lastSuccessAt) : Infinity;
    const status = state.lastAttemptStatus === "failure" ? "failed" : age > maxAgeMs ? "stale" : "ok";
    return {
      status,
      maxAgeMs,
      lastAttemptAt: state.lastAttemptAt,
      lastAttemptStatus: state.lastAttemptStatus,
      lastSuccessAt: state.lastSuccessAt,
      lastSuccessCounts: state.lastSuccessCounts
        ? { expired: state.lastSuccessCounts.expired, incomplete: state.lastSuccessCounts.incomplete }
        : null,
    };
  } catch {
    return { ...empty, status: "unavailable" };
  }
}
