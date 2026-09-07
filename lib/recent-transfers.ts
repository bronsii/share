// This list is browser-local. Never send its URLs or key-bearing fragments to an API.
export const RECENT_TRANSFERS_STORAGE_KEY = "sendebude-recent-transfers-v1";
export const RECENT_TRANSFERS_CHANGED_EVENT = "sendebude-recent-transfers-changed";
export const MAX_RECENT_TRANSFERS = 5;

const TRANSFER_ID = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-\d{3}--(?:[a-f0-9]{20}|[a-f0-9]{32})$/u;
const MAX_STORED_LENGTH = 20_000;
const MAX_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000 + 5 * 60 * 1_000;

type LocalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type RecentTransfer = {
  id: string;
  url: string;
  managementUrl?: string;
  expiresAt: string;
  savedAt: string;
};

export type RecentTransfersState = { entries: RecentTransfer[]; available: boolean };
export type TransferToRemember = Pick<RecentTransfer, "url" | "managementUrl" | "expiresAt">;

function validLink(value: unknown, origin: string, route: "t" | "verwalten", id?: string) {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const link = new URL(value);
    const candidate = link.pathname.slice(`/${route}/`.length);
    if (!/^https?:$/u.test(link.protocol) || link.origin !== origin || link.username || link.password
      || link.href !== value || link.search || !TRANSFER_ID.test(candidate)
      || link.pathname !== `/${route}/${candidate}` || (id !== undefined && candidate !== id)
      || !(route === "t" ? /^#v1\.[A-Za-z0-9_-]{43}$/u : /^#m1\.[A-Za-z0-9_-]{43}$/u).test(link.hash)) return null;
    return candidate;
  } catch { return null; }
}

function timestamp(value: unknown) {
  if (typeof value !== "string" || value.length !== 24) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
}

function validateEntry(value: unknown, origin: string, now: number): RecentTransfer | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = validLink(record.url, origin, "t");
  const savedAt = timestamp(record.savedAt);
  const expiresAt = timestamp(record.expiresAt);
  if (!id || record.id !== id || savedAt === null || expiresAt === null
    || savedAt > now + 60_000 || expiresAt <= now || expiresAt <= savedAt
    || expiresAt - savedAt > MAX_LIFETIME_MS
    || (record.managementUrl !== undefined && !validLink(record.managementUrl, origin, "verwalten", id))) return null;
  // Reconstruct the record so names, notes and unknown fields cannot be retained.
  return {
    id, url: record.url as string,
    ...(record.managementUrl === undefined ? {} : { managementUrl: record.managementUrl as string }),
    expiresAt: record.expiresAt as string, savedAt: record.savedAt as string,
  };
}

export function parseRecentTransfers(raw: string | null, origin: string, now = Date.now()): RecentTransfer[] {
  if (!raw || raw.length > MAX_STORED_LENGTH) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    if (record.version !== 1 || !Array.isArray(record.entries) || record.entries.length > 100) return [];
    const entries = record.entries.map((entry) => validateEntry(entry, origin, now))
      .filter((entry): entry is RecentTransfer => entry !== null)
      .sort((left, right) => right.savedAt.localeCompare(left.savedAt));
    return entries.filter((entry, index) => entries.findIndex((other) => other.id === entry.id) === index).slice(0, MAX_RECENT_TRANSFERS);
  } catch { return []; }
}

function persist(storage: LocalStorage, entries: RecentTransfer[]) {
  if (entries.length === 0) storage.removeItem(RECENT_TRANSFERS_STORAGE_KEY);
  else storage.setItem(RECENT_TRANSFERS_STORAGE_KEY, JSON.stringify({ version: 1, entries }));
}

export function readRecentTransfers(storage: LocalStorage | null, origin: string, now = Date.now()): RecentTransfersState {
  if (!storage) return { entries: [], available: false };
  let entries: RecentTransfer[] = [];
  try {
    const raw = storage.getItem(RECENT_TRANSFERS_STORAGE_KEY);
    entries = parseRecentTransfers(raw, origin, now);
    // An ordinary visit never creates a record; only prune records saved earlier.
    if (raw !== null && raw !== (entries.length ? JSON.stringify({ version: 1, entries }) : null)) persist(storage, entries);
    return { entries, available: true };
  } catch { return { entries, available: false }; }
}

// Call only from the explicit, per-transfer remember action after upload completion.
export function saveRecentTransfer(input: TransferToRemember, storage: LocalStorage | null, origin: string, now = Date.now()) {
  const id = validLink(input.url, origin, "t");
  const entry = validateEntry({ ...input, id, savedAt: new Date(now).toISOString() }, origin, now);
  if (!storage || !entry) return false;
  const current = readRecentTransfers(storage, origin, now);
  if (!current.available) return false;
  try {
    persist(storage, [entry, ...current.entries.filter((item) => item.id !== entry.id)].slice(0, MAX_RECENT_TRANSFERS));
    return true;
  } catch { return false; }
}

// Forgetting is local only. Server deletion requires the private management page.
export function forgetRecentTransfer(id: string, storage: LocalStorage | null, origin: string, now = Date.now()) {
  if (!storage) return false;
  const current = readRecentTransfers(storage, origin, now);
  if (!current.available) return false;
  try { persist(storage, current.entries.filter((entry) => entry.id !== id)); return true; }
  catch { return false; }
}

export function clearRecentTransfers(storage: LocalStorage | null) {
  if (!storage) return false;
  try { storage.removeItem(RECENT_TRANSFERS_STORAGE_KEY); return true; }
  catch { return false; }
}

export function browserRecentTransferStorage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; }
  catch { return null; }
}

export function notifyRecentTransfersChanged(target: EventTarget = window) {
  // No secrets in event payloads, URLs, requests, analytics, or server state.
  target.dispatchEvent(new Event(RECENT_TRANSFERS_CHANGED_EVENT));
}

export function subscribeRecentTransfers(listener: () => void, target: EventTarget = window) {
  const onStorage = (event: Event) => {
    const key = (event as StorageEvent).key;
    if (key === null || key === RECENT_TRANSFERS_STORAGE_KEY) listener();
  };
  target.addEventListener("storage", onStorage);
  target.addEventListener(RECENT_TRANSFERS_CHANGED_EVENT, listener);
  return () => {
    target.removeEventListener("storage", onStorage);
    target.removeEventListener(RECENT_TRANSFERS_CHANGED_EVENT, listener);
  };
}
