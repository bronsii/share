import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_UPLOAD_RETRIES,
  deleteCancelledUpload,
  pendingUploadCiphertext,
  retryAfterMilliseconds,
  sendUploadChunk,
  shouldWarnBeforeUploadLeave,
  uploadChunkWithRetry,
  uploadJson,
  UploadRequestError,
  waitForUploadRetry,
  withUploadRetry,
} from "../lib/upload-network.ts";
import { createNoncePrefix, createTransferKey, decryptChunk, encryptChunk } from "../lib/e2e-crypto.ts";

function fixture(overrides = {}) {
  const waits = [];
  const retryStates = [];
  const controller = new AbortController();
  const body = Uint8Array.from([1, 2, 3, 4]).buffer;
  return {
    waits, retryStates, controller,
    options: {
      offset: 0, body, signal: controller.signal, failureMessage: "Upload failed",
      wait: async (delayMs) => { waits.push(delayMs); },
      onRetry: (state) => { retryStates.push(state); },
      ...overrides,
    },
  };
}

test("lost committed PUT response is reconciled without sending or encrypting the chunk again", async () => {
  const { key } = await createTransferKey();
  const nonce = createNoncePrefix();
  const pending = new Map();
  let encryptions = 0;
  const original = new TextEncoder().encode("original bytes").buffer;
  const body = await pendingUploadCiphertext(pending, "file", 0, async () => {
    encryptions += 1;
    return encryptChunk(key, nonce, 0, original);
  });
  let serverOffset = 0;
  let writes = 0;
  let reconciliations = 0;
  const setup = fixture({ body });
  const uploaded = await uploadChunkWithRetry({
    ...setup.options,
    send: async (received, offset) => {
      assert.equal(offset, serverOffset);
      assert.strictEqual(received, body);
      writes += 1;
      serverOffset += received.byteLength;
      throw new UploadRequestError("Response lost");
    },
    readOffset: async () => { reconciliations += 1; return serverOffset; },
  });
  assert.equal(uploaded, body.byteLength);
  assert.equal(writes, 1);
  assert.equal(reconciliations, 1);
  assert.equal(encryptions, 1);
  assert.deepEqual(new Uint8Array(await decryptChunk(key, nonce, 0, body)), new Uint8Array(original));
  assert.deepEqual(setup.waits, [1000]);
  assert.equal(setup.retryStates.at(-1), null);
});

test("transient PUT failure retries the exact same ciphertext after confirming the original offset", async () => {
  const setup = fixture();
  const calls = [];
  let sends = 0;
  const result = await uploadChunkWithRetry({
    ...setup.options,
    send: async (body, offset) => {
      calls.push("PUT");
      assert.strictEqual(body, setup.options.body);
      assert.equal(offset, 0);
      if (++sends === 1) throw new UploadRequestError("Unavailable", 503, 2500);
      return body.byteLength;
    },
    readOffset: async () => { calls.push("GET"); return 0; },
  });
  assert.equal(result, 4);
  assert.deepEqual(calls, ["PUT", "GET", "PUT"]);
  assert.deepEqual(setup.waits, [2500]);
});

test("a failed status reconciliation is retried before any additional PUT", async () => {
  const setup = fixture();
  const calls = [];
  let reads = 0;
  let sends = 0;
  await uploadChunkWithRetry({
    ...setup.options,
    send: async () => { calls.push("PUT"); if (++sends === 1) throw new UploadRequestError("Offline"); return 4; },
    readOffset: async () => { calls.push("GET"); if (++reads === 1) throw new UploadRequestError("Unavailable", 503); return 0; },
  });
  assert.deepEqual(calls, ["PUT", "GET", "GET", "PUT"]);
  assert.deepEqual(setup.waits, [1000, 2000]);
});

test("persistent transient failures stop after four retries with exponential backoff", async () => {
  const setup = fixture();
  let sends = 0;
  let reads = 0;
  await assert.rejects(uploadChunkWithRetry({
    ...setup.options,
    send: async () => { sends += 1; throw new UploadRequestError("Offline"); },
    readOffset: async () => { reads += 1; return 0; },
  }), /Offline/u);
  assert.equal(sends, MAX_UPLOAD_RETRIES + 1);
  assert.equal(reads, MAX_UPLOAD_RETRIES);
  assert.deepEqual(setup.waits, [1000, 2000, 4000, 8000]);
  assert.equal(setup.retryStates.at(-1), null);
});

test("pause during the actual backoff timer cancels retries immediately", async () => {
  const setup = fixture();
  let sends = 0;
  let reads = 0;
  await assert.rejects(uploadChunkWithRetry({
    ...setup.options,
    send: async () => { sends += 1; throw new UploadRequestError("Offline"); },
    readOffset: async () => { reads += 1; return 0; },
    wait: (delayMs, signal) => {
      const waiting = waitForUploadRetry(delayMs, signal);
      queueMicrotask(() => setup.controller.abort());
      return waiting;
    },
  }), { name: "AbortError" });
  assert.equal(sends, 1);
  assert.equal(reads, 0);
  assert.equal(setup.retryStates.at(-1), null);
});

test("removal or cancellation during offset reconciliation cannot start a stale PUT", async () => {
  const setup = fixture();
  let sends = 0;
  await assert.rejects(uploadChunkWithRetry({
    ...setup.options,
    send: async () => { sends += 1; throw new UploadRequestError("Offline"); },
    readOffset: async () => { setup.controller.abort(); return 0; },
  }), { name: "AbortError" });
  assert.equal(sends, 1);
});

test("permission, expired, malformed, size and storage errors pause without automatic retry", async () => {
  for (const status of [400, 401, 403, 404, 410, 413, 415, 422, 507]) {
    const setup = fixture();
    let sends = 0;
    await assert.rejects(uploadChunkWithRetry({
      ...setup.options,
      send: async () => { sends += 1; throw new UploadRequestError(`HTTP ${status}`, status); },
      readOffset: async () => assert.fail("Terminal errors must not poll"),
    }), new RegExp(String(status), "u"));
    assert.equal(sends, 1);
    assert.deepEqual(setup.waits, []);
  }
});

test("offset conflicts reconcile but unexpected partial or advanced offsets never overwrite", async () => {
  for (const confirmed of [1, 8, -1, NaN]) {
    const setup = fixture();
    let sends = 0;
    await assert.rejects(uploadChunkWithRetry({
      ...setup.options,
      send: async () => { sends += 1; throw new UploadRequestError("Conflict", 409); },
      readOffset: async () => confirmed,
    }), /Upload failed/u);
    assert.equal(sends, 1);
  }
  const setup = fixture();
  assert.equal(await uploadChunkWithRetry({
    ...setup.options,
    send: async () => { throw new UploadRequestError("Conflict", 409); },
    readOffset: async () => 4,
  }), 4);
});

test("Retry-After handles seconds and HTTP dates; long delays pause instead of retrying early", async () => {
  const now = Date.parse("2026-09-07T12:00:00Z");
  assert.equal(retryAfterMilliseconds("12", now), 12000);
  assert.equal(retryAfterMilliseconds("Mon, 07 Sep 2026 12:00:05 GMT", now), 5000);
  assert.equal(retryAfterMilliseconds("Mon, 07 Sep 2026 11:59:00 GMT", now), 0);
  assert.equal(retryAfterMilliseconds("invalid", now), 0);
  assert.equal(retryAfterMilliseconds(null, now), 0);
  const setup = fixture();
  await assert.rejects(withUploadRetry(async () => {
    throw new UploadRequestError("Try later", 429, 3_600_000);
  }, setup.options), /Try later/u);
  assert.deepEqual(setup.waits, []);
});

test("paused in-flight encryption is reused on resume even if a later read would have changed bytes", async () => {
  const pending = new Map();
  let finishEncryption;
  let encryptions = 0;
  const first = pendingUploadCiphertext(pending, "file", 0, () => {
    encryptions += 1;
    return new Promise((resolve) => { finishEncryption = resolve; });
  });
  const resumed = pendingUploadCiphertext(pending, "file", 0, async () => {
    encryptions += 1;
    return Uint8Array.of(99).buffer;
  });
  assert.strictEqual(first, resumed);
  finishEncryption(Uint8Array.of(7).buffer);
  assert.deepEqual(new Uint8Array(await resumed), Uint8Array.of(7));
  assert.equal(encryptions, 1);
  pending.delete("file");
  await pendingUploadCiphertext(pending, "file", 4, async () => { encryptions += 1; return new ArrayBuffer(4); });
  assert.equal(encryptions, 2);
});

test("leave guard covers active and paused transfers and recovery, but not idle or completed shares", () => {
  assert.equal(shouldWarnBeforeUploadLeave(false, false, false), false);
  assert.equal(shouldWarnBeforeUploadLeave(true, false, false), true);
  assert.equal(shouldWarnBeforeUploadLeave(false, true, false), true);
  assert.equal(shouldWarnBeforeUploadLeave(true, true, true), false);
  assert.equal(shouldWarnBeforeUploadLeave(false, false, true), false);
});

test("JSON requests preserve terminal HTTP status and Retry-After even when an upstream returns HTML", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("upstream unavailable", { status: 503, headers: { "Retry-After": "3" } }));
  await assert.rejects(uploadJson("/upload", {}, "Failed"), (error) => error.status === 503 && error.retryAfterMs === 3000);
  globalThis.fetch.mock.mockImplementation(async () => new Response("forbidden", { status: 403 }));
  await assert.rejects(uploadJson("/upload", {}, "Failed"), (error) => error.status === 403);
  globalThis.fetch.mock.mockImplementation(async () => { throw new TypeError("network offline"); });
  await assert.rejects(uploadJson("/upload", {}, "Failed"), (error) => error instanceof UploadRequestError && error.status === 0);
});

test("XHR cancellation aborts the active request and suppresses late progress events", async (t) => {
  const requests = [];
  class FakeRequest extends EventTarget {
    upload = new EventTarget();
    aborted = false;
    constructor() { super(); requests.push(this); }
    open() {}
    setRequestHeader() {}
    send() {}
    abort() { this.aborted = true; this.dispatchEvent(new Event("abort")); }
  }
  const originalRequest = Object.getOwnPropertyDescriptor(globalThis, "XMLHttpRequest");
  globalThis.XMLHttpRequest = FakeRequest;
  t.after(() => {
    if (originalRequest) Object.defineProperty(globalThis, "XMLHttpRequest", originalRequest);
    else delete globalThis.XMLHttpRequest;
  });
  const controller = new AbortController();
  let progress = 0;
  const sending = sendUploadChunk({
    url: "/upload", body: new ArrayBuffer(4), offset: 0, signal: controller.signal,
    failureMessage: "Failed", connectionMessage: "Offline", onProgress: () => { progress += 1; },
  });
  const request = requests[0];
  assert.equal(request.timeout, 0);
  controller.abort();
  request.upload.dispatchEvent(new Event("progress"));
  await assert.rejects(sending, { name: "AbortError" });
  assert.equal(request.aborted, true);
  assert.equal(progress, 0);
});

test("XHR inactivity watchdog allows uploads beyond 60 seconds while bytes advance, then bounds response stall", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const requests = [];
  class Request extends EventTarget {
    upload = new EventTarget();
    aborts = 0;
    constructor() { super(); requests.push(this); }
    open() {}
    setRequestHeader() {}
    send() {}
    abort() { this.aborts += 1; this.dispatchEvent(new Event("abort")); }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, "XMLHttpRequest");
  globalThis.XMLHttpRequest = Request;
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "XMLHttpRequest", original);
    else delete globalThis.XMLHttpRequest;
  });
  const sending = sendUploadChunk({ url: "/upload", body: new ArrayBuffer(1000), offset: 0, signal: new AbortController().signal, failureMessage: "Failed", connectionMessage: "Inactive", onProgress: () => {} });
  const request = requests[0];
  for (let index = 1; index <= 5; index += 1) {
    t.mock.timers.tick(30_000);
    const event = new Event("progress");
    Object.defineProperty(event, "loaded", { value: index * 100 });
    request.upload.dispatchEvent(event);
    assert.equal(request.aborts, 0, "advancing uploads must remain alive even beyond a minute");
  }
  request.upload.dispatchEvent(new Event("load"));
  t.mock.timers.tick(59_999);
  assert.equal(request.aborts, 0);
  t.mock.timers.tick(1);
  await assert.rejects(sending, (error) => error instanceof UploadRequestError && error.status === 0);
  assert.equal(request.aborts, 1);
  t.mock.timers.tick(120_000);
  assert.equal(request.aborts, 1, "watchdog must be cleaned up on settlement");
});

test("cancel deletes upload plus a concurrently completed share with one private, bounded capability request", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init });
    return url.endsWith("/manage") ? new Response(null, { status: 204 }) : Response.json({ ok: true });
  });
  await deleteCancelledUpload("session", "private-token");
  assert.deepEqual(calls.map((call) => call.url), ["/api/uploads/session", "/api/transfers/session/manage"]);
  assert.equal(calls[1].init.headers.Authorization, "Bearer private-token");
  assert.strictEqual(calls[0].init.signal, calls[1].init.signal);
  assert.equal(calls.some((call) => call.url.includes("private-token")), false);
  globalThis.fetch.mock.mockImplementation(async () => new Response(null, { status: 503 }));
  await assert.rejects(deleteCancelledUpload("session", "private-token"), (error) => error.status === 503);
});

test("cancel deletion uses a finite 15 second budget and reports timeout instead of claiming success", async (t) => {
  const controller = new AbortController();
  t.mock.method(AbortSignal, "timeout", (milliseconds) => {
    assert.equal(milliseconds, 15_000);
    return controller.signal;
  });
  t.mock.method(globalThis, "fetch", async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    queueMicrotask(() => controller.abort());
  }));
  await assert.rejects(deleteCancelledUpload("session"), { name: "AbortError" });
});
