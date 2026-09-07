export const MAX_UPLOAD_RETRIES = 4;
const MAX_RETRY_DELAY_MS = 60_000;

export type UploadRetryState = { attempt: number; maximum: number; delayMs: number };

export class UploadUnavailableError extends Error {
  constructor() { super("Upload unavailable"); this.name = "UploadUnavailableError"; }
}

export class UploadRequestError extends Error {
  readonly status: number;
  readonly retryAfterMs: number;

  constructor(message: string, status = 0, retryAfterMs = 0) {
    super(message);
    this.name = "UploadRequestError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export function retryAfterMilliseconds(value: string | null, now = Date.now()) {
  if (!value?.trim()) return 0;
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/u.test(trimmed)) return Number(trimmed) * 1000;
  const timestamp = Date.parse(trimmed);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : 0;
}

export function isRetryableUploadError(error: unknown) {
  return error instanceof UploadRequestError
    && [0, 408, 409, 425, 429, 500, 502, 503, 504].includes(error.status);
}

export function waitForUploadRetry(delayMs: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", abort, { once: true });
  });
}

type RetryOptions = {
  signal: AbortSignal;
  onRetry?: (state: UploadRetryState | null) => void;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
};

export async function withUploadRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  const { signal, onRetry, wait = waitForUploadRetry } = options;
  try {
    for (let failures = 0; ; failures += 1) {
      signal.throwIfAborted();
      try {
        const result = await operation();
        signal.throwIfAborted();
        return result;
      } catch (error) {
        signal.throwIfAborted();
        if (!isRetryableUploadError(error) || failures >= MAX_UPLOAD_RETRIES) throw error;
        const retryAfter = (error as UploadRequestError).retryAfterMs;
        // A long rate limit pauses the transfer instead of retrying before the server allows it.
        if (retryAfter > MAX_RETRY_DELAY_MS) throw error;
        const delayMs = Math.max(1000 * 2 ** failures, retryAfter);
        onRetry?.({ attempt: failures + 1, maximum: MAX_UPLOAD_RETRIES, delayMs });
        await wait(delayMs, signal);
        signal.throwIfAborted();
        onRetry?.(null);
      }
    }
  } finally {
    onRetry?.(null);
  }
}

export async function uploadJson<T>(url: string, init: RequestInit, failureMessage: string): Promise<T> {
  const signal = init.signal ?? new AbortController().signal;
  signal.throwIfAborted();
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) });
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof TypeError || (error instanceof DOMException && error.name === "TimeoutError")) {
      throw new UploadRequestError(failureMessage);
    }
    throw error;
  }
  let payload: T & { error?: string };
  try {
    payload = await response.json();
  } catch {
    signal.throwIfAborted();
    // A successful response with a missing body is ambiguous: check its offset before replaying.
    throw new UploadRequestError(failureMessage, response.ok ? 0 : response.status,
      retryAfterMilliseconds(response.headers.get("Retry-After")));
  }
  signal.throwIfAborted();
  if (!response.ok) {
    throw new UploadRequestError(typeof payload?.error === "string" ? payload.error : failureMessage,
      response.status, retryAfterMilliseconds(response.headers.get("Retry-After")));
  }
  return payload;
}

export function sendUploadChunk(options: {
  url: string;
  body: Blob | ArrayBuffer;
  offset: number;
  signal: AbortSignal;
  failureMessage: string;
  connectionMessage: string;
  onProgress: (fraction: number) => void;
}) {
  const { url, body, offset, signal, failureMessage, connectionMessage, onProgress } = options;
  signal.throwIfAborted();
  return new Promise<number>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    let inactivityTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let lastUploaded = 0;
    const cleanup = () => {
      settled = true;
      clearTimeout(inactivityTimer);
      signal.removeEventListener("abort", abort);
    };
    const activity = () => {
      if (settled) return;
      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        cleanup();
        reject(new UploadRequestError(connectionMessage));
        request.abort();
      }, 60_000);
    };
    request.open("PUT", url);
    request.responseType = "json";
    request.timeout = 0;
    request.setRequestHeader("X-Upload-Offset", String(offset));
    const requestBytes = body instanceof Blob ? body.size : body.byteLength;
    request.upload.addEventListener("progress", (event) => {
      if (settled || signal.aborted) return;
      if (event.loaded > lastUploaded) {
        lastUploaded = event.loaded;
        activity();
      }
      onProgress(requestBytes > 0 ? Math.min(1, event.loaded / requestBytes) : 0);
    });
    // After upload ends, allow a finite 60 seconds for the server's acknowledgement.
    request.upload.addEventListener("load", activity);
    request.addEventListener("load", () => {
      cleanup();
      if (signal.aborted) { reject(signal.reason); return; }
      const response = request.response as { uploaded?: number; error?: string } | null;
      if (request.status >= 200 && request.status < 300 && Number.isSafeInteger(response?.uploaded)) {
        resolve(response!.uploaded!);
      } else {
        reject(new UploadRequestError(response?.error || failureMessage,
          request.status >= 200 && request.status < 300 ? 0 : request.status,
          retryAfterMilliseconds(request.getResponseHeader("Retry-After"))));
      }
    });
    const connectionError = () => { cleanup(); reject(new UploadRequestError(connectionMessage)); };
    request.addEventListener("error", connectionError);
    request.addEventListener("timeout", connectionError);
    request.addEventListener("abort", () => { cleanup(); reject(signal.reason ?? new DOMException("Paused", "AbortError")); });
    signal.addEventListener("abort", abort, { once: true });
    try { activity(); request.send(body); } catch (error) { cleanup(); reject(error); }
  });
}

/** Cancel both the upload and an already-finalized share, using its separate sender capability. */
export async function deleteCancelledUpload(sessionId: string, managementToken?: string) {
  const signal = AbortSignal.timeout(15_000);
  const response = await fetch(`/api/uploads/${sessionId}`, { method: "DELETE", signal });
  if (!response.ok) throw new UploadRequestError("Upload deletion failed", response.status);
  if (managementToken) {
    const completed = await fetch(`/api/transfers/${sessionId}/manage`, {
      method: "DELETE", signal, headers: { Authorization: `Bearer ${managementToken}` },
    });
    if (!completed.ok && completed.status !== 404) throw new UploadRequestError("Share deletion failed", completed.status);
  }
}

/** Replay only the original ciphertext, and only after the server confirms it is uncommitted. */
export async function uploadChunkWithRetry(options: RetryOptions & {
  offset: number;
  body: Blob | ArrayBuffer;
  send: (body: Blob | ArrayBuffer, offset: number) => Promise<number>;
  readOffset: () => Promise<number>;
  failureMessage: string;
}) {
  const { body, offset, send, readOffset, failureMessage, signal } = options;
  const end = offset + (body instanceof Blob ? body.size : body.byteLength);
  let mustReconcile = false;
  return withUploadRetry(async () => {
    if (mustReconcile) {
      const confirmed = await readOffset();
      signal.throwIfAborted();
      if (confirmed === end) return end;
      if (confirmed !== offset) throw new Error(failureMessage);
    }
    try {
      const confirmed = await send(body, offset);
      signal.throwIfAborted();
      if (confirmed !== end) throw new Error(failureMessage);
      return confirmed;
    } catch (error) {
      mustReconcile = true;
      throw error;
    }
  }, options);
}

/** Keep an in-flight block across pause/resume; never re-encrypt its nonce from another file read. */
export function pendingUploadCiphertext(
  pending: Map<string, { offset: number; ciphertext: Promise<ArrayBuffer> }>,
  fileId: string,
  offset: number,
  encrypt: () => Promise<ArrayBuffer>,
) {
  const existing = pending.get(fileId);
  if (existing?.offset === offset) return existing.ciphertext;
  const entry = { offset, ciphertext: encrypt() };
  pending.set(fileId, entry);
  void entry.ciphertext.catch(() => { if (pending.get(fileId) === entry) pending.delete(fileId); });
  return entry.ciphertext;
}

export function shouldWarnBeforeUploadLeave(uploading: boolean, recovery: boolean, completed: boolean) {
  return !completed && (uploading || recovery);
}
