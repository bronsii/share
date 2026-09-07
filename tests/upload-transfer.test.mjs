import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { createNoncePrefix, createTransferKey, decryptChunk, encryptedFileSize } from "../lib/e2e-crypto.ts";

// The app's extensionless bundler imports need file URLs for this native Node test.
const source = (await readFile(new URL("../lib/upload-transfer.ts", import.meta.url), "utf8"))
  .replaceAll('from "./e2e-crypto"', `from "${new URL("../lib/e2e-crypto.ts", import.meta.url).href}"`)
  .replaceAll('from "./upload-network"', `from "${new URL("../lib/upload-network.ts", import.meta.url).href}"`);
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { runEncryptedUpload } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

async function uploadFixture(t, onSend) {
  const { key, fragment } = await createTransferKey();
  const file = new File(["upload me"], "test.txt", { lastModified: 1 });
  const session = { id: "session", expiresAt: "2026-09-08T00:00:00Z", files: [{ id: "file", name: "file", size: encryptedFileSize(file.size), uploaded: 0 }] };
  const encryption = { key, fragment, noncePrefixes: [createNoncePrefix()], pendingChunks: new Map() };
  const controller = new AbortController();
  const state = { offset: 0, sends: [], requests: [], completions: 0 };
  class Request extends EventTarget {
    upload = new EventTarget();
    response = null;
    status = 0;
    open(method) { assert.equal(method, "PUT"); }
    setRequestHeader(name, value) { assert.equal(name, "X-Upload-Offset"); this.offset = Number(value); }
    getResponseHeader() { return null; }
    send(body) {
      state.sends.push(body);
      state.requests.push("PUT");
      queueMicrotask(() => onSend({ request: this, body, state, controller }));
    }
    abort() { this.dispatchEvent(new Event("abort")); }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, "XMLHttpRequest");
  globalThis.XMLHttpRequest = Request;
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "XMLHttpRequest", original);
    else delete globalThis.XMLHttpRequest;
  });
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.equal(init.signal.aborted, false);
    if (init.method === "POST") {
      state.requests.push("complete");
      state.completions += 1;
      assert.equal(state.offset, session.files[0].size);
      return Response.json({ id: session.id, url: "https://example.test/t/session", expiresAt: session.expiresAt });
    }
    state.requests.push("GET");
    return Response.json({ files: [{ id: "file", uploaded: state.offset }] });
  });
  const progress = [];
  return {
    file, encryption, state, controller, progress,
    options: { files: [file], session, encryption, signal: controller.signal, failureMessage: "Failed", connectionMessage: "Offline", onProgress: (bytes) => progress.push(bytes), onRetry: () => {} },
  };
}

function commit({ request, body, state }) {
  assert.equal(request.offset, state.offset);
  state.offset += body.byteLength;
  request.response = { uploaded: state.offset };
  request.status = 200;
  request.dispatchEvent(new Event("load"));
}

test("encrypted runner recovers a committed response lost and finalizes exactly once", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const fixture = await uploadFixture(t, ({ request, body, state }) => {
    assert.equal(request.offset, state.offset);
    state.offset += body.byteLength;
    request.dispatchEvent(new Event("error"));
  });
  const result = await runEncryptedUpload({
    ...fixture.options,
    onRetry: (retry) => { if (retry) queueMicrotask(() => t.mock.timers.tick(retry.delayMs)); },
  });
  assert.equal(result.id, "session");
  assert.deepEqual(fixture.state.requests, ["GET", "PUT", "GET", "complete"]);
  assert.equal(fixture.state.completions, 1);
  assert.equal(fixture.state.sends.length, 1);
  assert.equal(fixture.encryption.pendingChunks.size, 0);
  assert.equal(fixture.progress.at(-1), fixture.file.size);
  const decoded = await decryptChunk(fixture.encryption.key, fixture.encryption.noncePrefixes[0], 0, fixture.state.sends[0]);
  assert.equal(new TextDecoder().decode(decoded), "upload me");
});

test("pause in a live PUT then resume reuses ciphertext without rereading or re-encrypting the file", async (t) => {
  const fixture = await uploadFixture(t, (context) => {
    if (context.state.sends.length === 1) context.controller.abort();
    else commit(context);
  });
  let reads = 0;
  const file = {
    name: "test.txt", lastModified: 1, size: fixture.file.size,
    slice: () => { reads += 1; return new Blob([reads === 1 ? "upload me" : "changed!!"]); },
  };
  await assert.rejects(runEncryptedUpload({ ...fixture.options, files: [file] }), { name: "AbortError" });
  assert.equal(fixture.encryption.pendingChunks.size, 1);
  const resumed = new AbortController();
  await runEncryptedUpload({ ...fixture.options, files: [file], signal: resumed.signal });
  assert.equal(reads, 1);
  assert.strictEqual(fixture.state.sends[0], fixture.state.sends[1]);
  assert.deepEqual(fixture.state.requests, ["GET", "PUT", "GET", "PUT", "complete"]);
  assert.equal(fixture.state.completions, 1);
});

test("pause after server commit then resume skips the committed nonce", async (t) => {
  const fixture = await uploadFixture(t, ({ body, state, controller }) => {
    state.offset += body.byteLength;
    controller.abort();
  });
  await assert.rejects(runEncryptedUpload(fixture.options), { name: "AbortError" });
  await runEncryptedUpload({ ...fixture.options, signal: new AbortController().signal });
  assert.equal(fixture.state.sends.length, 1);
  assert.equal(fixture.encryption.pendingChunks.size, 0);
  assert.deepEqual(fixture.state.requests, ["GET", "PUT", "GET", "complete"]);
});

test("malformed server offsets stop before encryption, PUT or finalization", async (t) => {
  const fixture = await uploadFixture(t, () => assert.fail("Must not upload"));
  fixture.state.offset = 1;
  await assert.rejects(runEncryptedUpload(fixture.options), /Blockgrenze/u);
  assert.equal(fixture.state.sends.length, 0);
  assert.equal(fixture.state.completions, 0);
  assert.equal(fixture.encryption.pendingChunks.size, 0);
});

test("missing upload plus missing completed share returns the terminal unavailable signal", async (t) => {
  const fixture = await uploadFixture(t, () => assert.fail("Must not upload"));
  const calls = [];
  globalThis.fetch.mock.mockImplementation(async (_url, init) => {
    calls.push(init.method ?? "GET");
    return Response.json({ error: "Gone" }, { status: 404 });
  });
  await assert.rejects(runEncryptedUpload(fixture.options), { name: "UploadUnavailableError" });
  assert.deepEqual(calls, ["GET", "POST"]);
  assert.equal(fixture.encryption.pendingChunks.size, 0);
});

test("missing upload still restores the result of an earlier successfully finalized share", async (t) => {
  const fixture = await uploadFixture(t, () => assert.fail("Must not upload"));
  globalThis.fetch.mock.mockImplementation(async (_url, init) => init.method === "POST"
    ? Response.json({ id: "session", url: "https://example.test/t/session", expiresAt: fixture.options.session.expiresAt })
    : Response.json({ error: "Gone" }, { status: 410 }));
  assert.equal((await runEncryptedUpload(fixture.options)).id, "session");
  assert.equal(fixture.state.sends.length, 0);
});
