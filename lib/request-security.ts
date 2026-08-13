import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const SHARED_ROOT = process.env.SHARED_ROOT ?? path.join(process.cwd(), "shared");
const SECURITY_ROOT = path.join(SHARED_ROOT, ".security");
const RATE_LIMIT_ROOT = path.join(SECURITY_ROOT, "rate-limits");
const RATE_LIMIT_SECRET_PATH = path.join(SECURITY_ROOT, "rate-limit.key");
const MAX_RATE_LIMIT_FILE_AGE_MS = 2 * 24 * 60 * 60 * 1000;
const PROXY_CLIENT_IP_HEADER = "x-share-client-ip";
const PROXY_SECRET_HEADER = "x-share-proxy-secret";

type RateLimitState = { count: number; resetAt: number };
type RateLimitOptions = {
  scope: string;
  key: string;
  limit: number;
  windowMs: number;
  cost?: number;
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfter: number;
};

const globalSecurityState = globalThis as typeof globalThis & {
  shareRateLimitQueues?: Map<string, Promise<void>>;
  shareRateLimitSecret?: Promise<Buffer>;
  shareRateLimitLastPrune?: number;
  shareRequestSlots?: Map<string, number>;
  shareProxyConfigurationWarnings?: Set<string>;
};
globalSecurityState.shareRateLimitQueues ??= new Map();
globalSecurityState.shareRequestSlots ??= new Map();
globalSecurityState.shareProxyConfigurationWarnings ??= new Set();

async function withRateLimitLock<T>(bucketName: string, operation: () => Promise<T>) {
  const queues = globalSecurityState.shareRateLimitQueues!;
  const previous = queues.get(bucketName) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.catch(() => undefined).then(() => current);
  queues.set(bucketName, queued);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (queues.get(bucketName) === queued) queues.delete(bucketName);
  }
}

async function ensureSecurityDirectories() {
  await mkdir(RATE_LIMIT_ROOT, { recursive: true, mode: 0o700 });
  await chmod(SECURITY_ROOT, 0o700).catch(() => undefined);
  await chmod(RATE_LIMIT_ROOT, 0o700).catch(() => undefined);
}

async function loadRateLimitSecret() {
  if (!globalSecurityState.shareRateLimitSecret) {
    globalSecurityState.shareRateLimitSecret = (async () => {
      await ensureSecurityDirectories();
      try {
        const existing = await readFile(RATE_LIMIT_SECRET_PATH);
        if (existing.byteLength !== 32) throw new Error("Ungültiger Rate-Limit-Schlüssel.");
        return existing;
      } catch (error) {
        if (error instanceof Error && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const secret = randomBytes(32);
        try {
          await writeFile(RATE_LIMIT_SECRET_PATH, secret, { flag: "wx", mode: 0o600 });
          return secret;
        } catch (writeError) {
          if (!(writeError instanceof Error) || (writeError as NodeJS.ErrnoException).code !== "EEXIST") throw writeError;
          const existing = await readFile(RATE_LIMIT_SECRET_PATH);
          if (existing.byteLength !== 32) throw new Error("Ungültiger Rate-Limit-Schlüssel.");
          return existing;
        }
      }
    })();
  }
  return globalSecurityState.shareRateLimitSecret;
}

export class ProxyConfigurationError extends Error {}

function failProxyConfiguration(message: string): never {
  if (!globalSecurityState.shareProxyConfigurationWarnings!.has(message)) {
    globalSecurityState.shareProxyConfigurationWarnings!.add(message);
    console.error(`Share proxy configuration error: ${message}`);
  }
  throw new ProxyConfigurationError(message);
}

export function proxyConfigurationUnavailable() {
  return Response.json(
    { error: "Der Reverse Proxy ist nicht korrekt mit Share verbunden." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

function proxyHeadersAreTrusted(request: Request) {
  const expected = process.env.SHARE_PROXY_SECRET;
  const supplied = request.headers.get(PROXY_SECRET_HEADER);
  if (!expected || expected.length < 32) {
    if (process.env.NODE_ENV !== "production") return false;
    return failProxyConfiguration("SHARE_PROXY_SECRET fehlt oder ist kürzer als 32 Zeichen.");
  }
  if (!supplied) return failProxyConfiguration("Der Reverse Proxy hat kein X-Share-Proxy-Secret übermittelt.");
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) {
    return failProxyConfiguration("SHARE_PROXY_SECRET stimmt zwischen Share und Reverse Proxy nicht überein.");
  }
  return true;
}

function clientAddress(request: Request) {
  if (!proxyHeadersAreTrusted(request)) return "development";
  const suppliedAddress = request.headers.get(PROXY_CLIENT_IP_HEADER)?.trim();
  if (suppliedAddress && isIP(suppliedAddress)) return suppliedAddress;
  return failProxyConfiguration("Der Reverse Proxy hat keine gültige Client-IP übermittelt.");
}

function lastForwardedValue(value: string | null) {
  return value?.split(",").map((part) => part.trim()).filter(Boolean).at(-1);
}

async function opaqueKey(namespace: string, value: string) {
  const secret = await loadRateLimitSecret();
  return createHmac("sha256", secret).update(`${namespace}\0${value}`).digest("hex");
}

export function globalRateLimitKey() {
  return "global";
}

export function acquireRequestSlot(scope: string, clientKey: string, clientLimit: number, globalLimit: number) {
  if (!/^[a-z0-9-]{1,60}$/u.test(scope)
    || !Number.isSafeInteger(clientLimit) || clientLimit <= 0
    || !Number.isSafeInteger(globalLimit) || globalLimit < clientLimit) return null;
  const slots = globalSecurityState.shareRequestSlots!;
  const clientSlot = `${scope}:client:${clientKey}`;
  const globalSlot = `${scope}:global`;
  const clientCount = slots.get(clientSlot) ?? 0;
  const globalCount = slots.get(globalSlot) ?? 0;
  if (clientCount >= clientLimit || globalCount >= globalLimit) return null;
  slots.set(clientSlot, clientCount + 1);
  slots.set(globalSlot, globalCount + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const slot of [clientSlot, globalSlot]) {
      const remaining = (slots.get(slot) ?? 1) - 1;
      if (remaining <= 0) slots.delete(slot);
      else slots.set(slot, remaining);
    }
  };
}

export async function clientRateLimitKey(request: Request) {
  return opaqueKey("client", clientAddress(request));
}

async function pruneExpiredRateLimits(now: number) {
  const lastPrune = globalSecurityState.shareRateLimitLastPrune ?? 0;
  if (now - lastPrune < 60 * 60 * 1000) return;
  globalSecurityState.shareRateLimitLastPrune = now;
  const entries = await readdir(RATE_LIMIT_ROOT, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/u.test(entry.name)) return;
    const file = path.join(RATE_LIMIT_ROOT, entry.name);
    try {
      if (now - (await stat(file)).mtimeMs > MAX_RATE_LIMIT_FILE_AGE_MS) await rm(file, { force: true });
    } catch {
      // Eine gleichzeitig entfernte Datei ist bereits bereinigt.
    }
  }));
}

export async function consumeRateLimit(options: RateLimitOptions): Promise<RateLimitResult> {
  const { scope, key, limit, windowMs } = options;
  const cost = options.cost ?? 1;
  if (!/^[a-z0-9-]{1,60}$/u.test(scope)
    || !Number.isSafeInteger(limit) || limit <= 0
    || !Number.isSafeInteger(windowMs) || windowMs <= 0
    || !Number.isSafeInteger(cost) || cost <= 0) {
    throw new Error("Ungültige Rate-Limit-Konfiguration.");
  }

  await ensureSecurityDirectories();
  await pruneExpiredRateLimits(Date.now());
  const bucketName = await opaqueKey("bucket", `${scope}\0${key}`);

  return withRateLimitLock(bucketName, async () => {
    const now = Date.now();
    const finalPath = path.join(RATE_LIMIT_ROOT, `${bucketName}.json`);
    let state: RateLimitState = { count: 0, resetAt: now + windowMs };
    try {
      const stored = JSON.parse(await readFile(finalPath, "utf8")) as RateLimitState;
      if (Number.isSafeInteger(stored.count) && stored.count >= 0
        && Number.isFinite(stored.resetAt) && stored.resetAt > now) state = stored;
    } catch {
      // Ein fehlender oder beschädigter Zähler beginnt ein neues Zeitfenster.
    }

    const allowed = state.count + cost <= limit;
    if (allowed) state.count += cost;
    const temporaryPath = `${finalPath}.${randomBytes(8).toString("hex")}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(state), { flag: "wx", mode: 0o600 });
    await rename(temporaryPath, finalPath);
    const retryAfter = Math.max(1, Math.ceil((state.resetAt - now) / 1000));
    return {
      allowed,
      limit,
      remaining: Math.max(0, limit - state.count),
      resetAt: state.resetAt,
      retryAfter,
    };
  });
}

export function requestHasSameOrigin(request: Request) {
  const suppliedOrigin = request.headers.get("origin");
  if (!suppliedOrigin) return false;
  try {
    const origin = new URL(suppliedOrigin);
    const trustProxy = proxyHeadersAreTrusted(request);
    const forwardedHost = trustProxy ? lastForwardedValue(request.headers.get("x-forwarded-host")) : undefined;
    const host = forwardedHost || request.headers.get("host") || new URL(request.url).host;
    const forwardedProtocol = trustProxy ? lastForwardedValue(request.headers.get("x-forwarded-proto")) : undefined;
    const protocol = forwardedProtocol ? `${forwardedProtocol}:` : new URL(request.url).protocol;
    return origin.protocol === protocol && origin.host === host;
  } catch (error) {
    if (error instanceof ProxyConfigurationError) throw error;
    return false;
  }
}

export class RequestBodyTooLargeError extends Error {}

export async function readJsonBody<T>(request: Request, maximumBytes: number): Promise<T> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) throw new Error("Ungültige maximale Anfragegröße.");
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw new RequestBodyTooLargeError();
  if (!request.body) throw new SyntaxError("Leerer Anfragekörper.");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumBytes) throw new RequestBodyTooLargeError();
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as T;
}
