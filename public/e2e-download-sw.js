const downloads = new Map();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("message", (event) => {
  if (event.data?.type !== "prepare-e2e-download" || !event.ports[0]) return;
  const { token, name, size, contentType } = event.data;
  if (!/^[a-f0-9-]{36}$/.test(token) || !Number.isSafeInteger(size) || size <= 0) return;
  downloads.set(token, { port: event.ports[0], name: String(name), size, contentType: String(contentType || "application/octet-stream") });
  event.ports[0].postMessage({ type: "ready" });
  setTimeout(() => downloads.delete(token), 120000);
});

function contentDisposition(name) {
  const fallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const match = /^\/e2e-download\/([a-f0-9-]{36})$/.exec(url.pathname);
  if (!match) return;
  const download = downloads.get(match[1]);
  downloads.delete(match[1]);
  if (!download) {
    event.respondWith(new Response("Download nicht gefunden.", { status: 404 }));
    return;
  }

  let controller;
  let awaitingChunk = false;
  let closed = false;
  function requestChunk() {
    if (closed || awaitingChunk || !controller || controller.desiredSize <= 0) return;
    awaitingChunk = true;
    download.port.postMessage({ type: "pull" });
  }
  const stream = new ReadableStream({
    start(nextController) {
      controller = nextController;
      download.port.onmessage = ({ data }) => {
        if (closed) return;
        if (data?.type === "chunk" && data.chunk instanceof ArrayBuffer) {
          awaitingChunk = false;
          controller.enqueue(new Uint8Array(data.chunk));
          requestChunk();
        } else if (data?.type === "done") {
          closed = true;
          controller.close();
          download.port.close();
        } else if (data?.type === "error") {
          closed = true;
          controller.error(new Error(String(data.message || "Download fehlgeschlagen.")));
          download.port.close();
        }
      };
      requestChunk();
    },
    pull() {
      requestChunk();
    },
    cancel() {
      closed = true;
      download.port.postMessage({ type: "cancel" });
      download.port.close();
    },
  });
  event.respondWith(new Response(stream, {
    headers: {
      "Content-Type": download.contentType,
      "Content-Length": String(download.size),
      "Content-Disposition": contentDisposition(download.name),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  }));
});
