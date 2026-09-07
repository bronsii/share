import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { browserZip, browserZipSize, uniqueZipNames, updateCrc32 } from "../lib/browser-zip.ts";
import { createManagementToken, managementUrl } from "../lib/management-token.ts";
import { createHash } from "node:crypto";

test("Browser ZIP64 has correct CRC, UTF-8 names, entry sizes and an independently readable directory", async () => {
  const bytes = new TextEncoder().encode("123456789");
  assert.equal(updateCrc32(0, bytes), 0xcbf43926);
  assert.equal(updateCrc32(updateCrc32(0, bytes.slice(0, 3)), bytes.slice(3)), 0xcbf43926);
  assert.deepEqual(uniqueZipNames(["Äpfel.txt", "äpfel.txt", "Äpfel (2).txt", "../a", ".."]), ["Äpfel.txt", "äpfel (2).txt", "Äpfel (2) (2).txt", ".._a", "file"]);
  const entries = [{ name: "Äpfel.txt", size: 9, chunks: async function* () { yield bytes.slice(0, 4); yield bytes.slice(4); } }, { name: "leer.txt", size: 0, chunks: async function* () {} }];
  const chunks = [];
  for await (const chunk of browserZip(entries)) chunks.push(chunk);
  const zip = Buffer.concat(chunks);
  assert.equal(zip.length, browserZipSize(entries));
  const result = spawnSync(process.env.TEST_PYTHON ?? (process.platform === "win32" ? "python" : "python3"), ["-c", "import io,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.namelist()==['Äpfel.txt','leer.txt']; assert z.read('Äpfel.txt')==b'123456789'; assert z.read('leer.txt')==b''; assert z.testzip() is None"], { input: zip });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr.toString());
});

test("ZIP64 headers represent files larger than 4 GiB without buffering or truncation", async () => {
  const size = 5 * 1024 ** 3;
  const entry = { name: "large.bin", size, chunks: async function* () {} };
  const iterator = browserZip([entry]);
  const { value } = await iterator.next();
  const view = new DataView(value.buffer);
  assert.equal(view.getBigUint64(34 + new TextEncoder().encode(entry.name).length, true), BigInt(size));
  assert.equal(browserZipSize([entry]), size + 148 + 18 + 98);
  await iterator.return();
  await assert.rejects(async () => { for await (const chunk of browserZip([entry])) void chunk; }, /size mismatch/u);
});

test("Management capability is random, independent, hashed and placed only in a fragment", async () => {
  const first = await createManagementToken();
  const second = await createManagementToken();
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/u);
  assert.notEqual(first.token, second.token);
  assert.equal(first.hash, createHash("sha256").update(first.token).digest("hex"));
  const url = new URL(managementUrl("https://sendebude.de/t/test#v1.secret", "test", first.token));
  assert.equal(url.pathname, "/verwalten/test");
  assert.equal(url.hash, `#m1.${first.token}`);
  assert.equal(url.search, "");
  assert.equal(url.href.includes("v1.secret"), false);
  assert.equal(managementUrl("https://sendebude.de", "test"), undefined);
});
