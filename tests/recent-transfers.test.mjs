import assert from "node:assert/strict";
import test from "node:test";
import {
  browserRecentTransferStorage, clearRecentTransfers, forgetRecentTransfer, MAX_RECENT_TRANSFERS,
  notifyRecentTransfersChanged, parseRecentTransfers, readRecentTransfers, RECENT_TRANSFERS_CHANGED_EVENT,
  RECENT_TRANSFERS_STORAGE_KEY, saveRecentTransfer, subscribeRecentTransfers,
} from "../lib/recent-transfers.ts";

const origin = "https://sendebude.de";
const now = Date.parse("2026-09-07T10:00:00.000Z");

function transfer(index = 1, overrides = {}) {
  const id = `2026-09-07_09-00-00-000--${index.toString(16).padStart(32, "0")}`;
  return {
    id,
    url: `${origin}/t/${id}#v1.${"a".repeat(43)}`,
    managementUrl: `${origin}/verwalten/${id}#m1.${"b".repeat(43)}`,
    expiresAt: new Date(now + 24 * 60 * 60 * 1_000).toISOString(),
    savedAt: new Date(now - 1_000 + index).toISOString(),
    ...overrides,
  };
}

function serialized(entries) { return JSON.stringify({ version: 1, entries }); }

function fakeStorage(initial = null) {
  const values = new Map(initial === null ? [] : [[RECENT_TRANSFERS_STORAGE_KEY, initial]]);
  const writes = [];
  return {
    values, writes,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { writes.push(["set", key]); values.set(key, value); },
    removeItem(key) { writes.push(["remove", key]); values.delete(key); },
  };
}

test("A normal visit creates no local history, setting or empty storage entry", () => {
  const storage = fakeStorage();
  assert.deepEqual(readRecentTransfers(storage, origin, now), { entries: [], available: true });
  assert.deepEqual(storage.writes, []);
  assert.equal(storage.values.size, 0);
});

test("An explicit save stores only the selected completed transfer and its local keys", () => {
  const storage = fakeStorage();
  const selected = transfer(1, { name: "secret.txt", message: "private note", files: ["never stored"] });
  assert.equal(saveRecentTransfer(selected, storage, origin, now), true);
  const raw = storage.getItem(RECENT_TRANSFERS_STORAGE_KEY);
  assert.ok(raw.includes("#v1."));
  assert.ok(raw.includes("#m1."));
  assert.equal(raw.includes("secret.txt"), false);
  assert.equal(raw.includes("private note"), false);
  assert.equal(raw.includes("never stored"), false);
  assert.deepEqual(parseRecentTransfers(raw, origin, now), [transfer(1, { savedAt: new Date(now).toISOString() })]);
});

test("Remembering another share is opt-in again and never records an unselected result", () => {
  const storage = fakeStorage();
  const first = transfer(1);
  const second = transfer(2);
  assert.equal(saveRecentTransfer(first, storage, origin, now), true);
  assert.deepEqual(readRecentTransfers(storage, origin, now).entries.map((entry) => entry.id), [first.id]);
  assert.equal(storage.getItem(RECENT_TRANSFERS_STORAGE_KEY).includes(second.id), false);
  assert.equal(saveRecentTransfer(second, storage, origin, now + 1), true);
  assert.deepEqual(readRecentTransfers(storage, origin, now + 1).entries.map((entry) => entry.id), [second.id, first.id]);
});

test("History is bounded and re-saving updates an entry without duplicates", () => {
  const storage = fakeStorage();
  for (let index = 1; index <= 8; index += 1) assert.equal(saveRecentTransfer(transfer(index), storage, origin, now + index), true);
  let entries = readRecentTransfers(storage, origin, now + 10).entries;
  assert.equal(entries.length, MAX_RECENT_TRANSFERS);
  assert.deepEqual(entries.map((entry) => entry.id), [8, 7, 6, 5, 4].map((index) => transfer(index).id));
  assert.equal(saveRecentTransfer(transfer(5), storage, origin, now + 11), true);
  entries = readRecentTransfers(storage, origin, now + 12).entries;
  assert.deepEqual(entries.map((entry) => entry.id), [5, 8, 7, 6, 4].map((index) => transfer(index).id));
});

test("Expiry pruning removes stale secrets from storage, including the last record", () => {
  const expired = transfer(1, { expiresAt: new Date(now).toISOString() });
  const active = transfer(2);
  const storage = fakeStorage(serialized([expired, active]));
  assert.deepEqual(readRecentTransfers(storage, origin, now).entries, [active]);
  assert.equal(storage.getItem(RECENT_TRANSFERS_STORAGE_KEY).includes(expired.id), false);
  assert.deepEqual(readRecentTransfers(storage, origin, Date.parse(active.expiresAt)).entries, []);
  assert.equal(storage.getItem(RECENT_TRANSFERS_STORAGE_KEY), null);
  const blank = fakeStorage();
  assert.equal(saveRecentTransfer(expired, blank, origin, now), false);
  assert.deepEqual(blank.writes, []);
});

test("Canonical same-origin transfer and management links are required", () => {
  const valid = transfer();
  const invalid = [
    { url: valid.url.replace(origin, "https://evil.example") },
    { url: valid.url.replace(origin, "http://sendebude.de") },
    { url: valid.url.replace(origin, "https://sendebude.de:444") },
    { url: valid.url.replace(origin, "https://user:password@sendebude.de") },
    { url: valid.url.replace(origin, "https://sendebude.de.evil.example") },
    { url: valid.url.replace("/t/", "/api/transfers/") },
    { url: valid.url.replace("/t/", "/verwalten/") },
    { url: valid.url.replace("/t/", "/t/../t/") },
    { url: valid.url.replace("#v1.", "?key=secret#v1.") },
    { url: valid.url.replace("#v1.", "/#v1.") },
    { url: valid.url.replace("#v1.", "#m1.") },
    { url: valid.url.replace("#v1.", "#v2.") },
    { url: valid.url.slice(0, -1) },
    { url: `${valid.url}&tracking=1` },
    { url: `${valid.url}\n` },
    { url: valid.url.replace("/t/", "/%74/") },
    { url: valid.url.replace(origin, "") },
    { url: "javascript:alert(1)" },
    { id: transfer(2).id },
    { managementUrl: transfer(2).managementUrl },
    { managementUrl: valid.managementUrl.replace(origin, "https://evil.example") },
    { managementUrl: valid.managementUrl.replace("#m1.", "?token=secret#m1.") },
    { managementUrl: valid.managementUrl.replace("#m1.", "#v1.") },
    { managementUrl: null },
  ];
  assert.deepEqual(parseRecentTransfers(serialized([valid]), origin, now), [valid]);
  for (const override of invalid) assert.deepEqual(parseRecentTransfers(serialized([{ ...valid, ...override }]), origin, now), [], JSON.stringify(override));
});

test("No private management capability is invented for records without one", () => {
  const entry = transfer();
  delete entry.managementUrl;
  const storage = fakeStorage();
  assert.equal(saveRecentTransfer(entry, storage, origin, now), true);
  assert.equal("managementUrl" in readRecentTransfers(storage, origin, now).entries[0], false);
});

test("Malformed, unsupported and oversized storage is safely discarded", () => {
  for (const raw of ["not JSON", "null", "[]", "{}", JSON.stringify({ version: 2, entries: [transfer()] }), "x".repeat(20_001), serialized(Array(101).fill(transfer()))]) {
    const storage = fakeStorage(raw);
    assert.deepEqual(readRecentTransfers(storage, origin, now), { entries: [], available: true });
    assert.equal(storage.getItem(RECENT_TRANSFERS_STORAGE_KEY), null);
  }
});

test("Invalid dates, future saves and excessive retention are rejected", () => {
  for (const override of [
    { expiresAt: "not a date" }, { savedAt: 123 }, { expiresAt: "2026-09-31T00:00:00.000Z" },
    { expiresAt: "2026-09-08T10:00:00Z" }, { savedAt: new Date(now + 61_000).toISOString() },
    { expiresAt: new Date(now + 8 * 24 * 60 * 60 * 1_000).toISOString() },
    { savedAt: new Date(now - 10_000).toISOString(), expiresAt: new Date(now - 20_000).toISOString() },
  ]) assert.deepEqual(parseRecentTransfers(serialized([transfer(1, override)]), origin, now), []);
});

test("Stored duplicates are deduplicated and unknown fields are pruned on read", () => {
  const newer = transfer(1, { savedAt: new Date(now).toISOString() });
  const storage = fakeStorage(serialized([transfer(1, { note: "discard me" }), transfer(2), newer]));
  assert.deepEqual(readRecentTransfers(storage, origin, now).entries, [newer, transfer(2)]);
  assert.equal(storage.getItem(RECENT_TRANSFERS_STORAGE_KEY).includes("discard me"), false);
});

test("Removing one local entry and clearing all never touch unrelated browser settings or the network", (context) => {
  const storage = fakeStorage(serialized([transfer(1), transfer(2)]));
  storage.values.set("share-language", "en");
  const request = context.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected request"); });
  assert.equal(forgetRecentTransfer(transfer(1).id, storage, origin, now), true);
  assert.deepEqual(readRecentTransfers(storage, origin, now).entries, [transfer(2)]);
  assert.equal(clearRecentTransfers(storage), true);
  assert.equal(storage.values.size, 1);
  assert.equal(storage.values.get("share-language"), "en");
  assert.equal(request.mock.callCount(), 0);
});

test("Blocked storage access and quota failures are reported without crashing", () => {
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  assert.deepEqual(readRecentTransfers(null, origin, now), { entries: [], available: false });
  assert.deepEqual(readRecentTransfers(blocked, origin, now), { entries: [], available: false });
  assert.equal(saveRecentTransfer(transfer(), blocked, origin, now), false);
  assert.equal(forgetRecentTransfer(transfer().id, blocked, origin, now), false);
  assert.equal(clearRecentTransfers(blocked), false);
  const full = { ...fakeStorage(), setItem() { throw new Error("quota"); } };
  assert.equal(saveRecentTransfer(transfer(), full, origin, now), false);
});

test("Browser storage access is safe during SSR and when browser policy denies it", (context) => {
  assert.equal(browserRecentTransferStorage(), null);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { get localStorage() { throw new Error("denied"); } } });
  context.after(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete globalThis.window;
  });
  assert.equal(browserRecentTransferStorage(), null);
});

test("Subscribers receive same-tab and other-tab updates without secret event payloads", () => {
  const target = new EventTarget();
  let updates = 0;
  const unsubscribe = subscribeRecentTransfers(() => { updates += 1; }, target);
  let payload;
  target.addEventListener(RECENT_TRANSFERS_CHANGED_EVENT, (event) => { payload = event.detail; });
  notifyRecentTransfersChanged(target);
  assert.equal(updates, 1);
  assert.equal(payload, undefined);
  for (const key of ["unrelated", RECENT_TRANSFERS_STORAGE_KEY, null]) {
    const event = new Event("storage");
    Object.defineProperty(event, "key", { value: key });
    target.dispatchEvent(event);
  }
  assert.equal(updates, 3);
  unsubscribe();
  notifyRecentTransfersChanged(target);
  assert.equal(updates, 3);
});
