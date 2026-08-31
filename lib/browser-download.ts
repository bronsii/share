import type { downloadCopy } from "@/app/t/[id]/download-copy";
import type { UiLanguage } from "@/lib/ui-language";

type Copy = (typeof downloadCopy)[UiLanguage];
type Options = {
  name: string; size: number; contentType: string; language: UiLanguage; copy: Copy;
  controller: AbortController;
  chunks: (heartbeat: () => void) => AsyncGenerator<Uint8Array>;
  onStart: () => void;
};

async function ensureDownloadWorker(copy: Copy, signal: AbortSignal) {
  if (!("serviceWorker" in navigator)) throw new Error(copy.streamingUnsupported);
  const ready = (async () => {
    await navigator.serviceWorker.register("/e2e-download-sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        navigator.serviceWorker.removeEventListener("controllerchange", changed);
        signal.removeEventListener("abort", aborted);
      };
      const changed = () => { if (navigator.serviceWorker.controller) { cleanup(); resolve(); } };
      const aborted = () => { cleanup(); reject(signal.reason); };
      navigator.serviceWorker.addEventListener("controllerchange", changed);
      signal.addEventListener("abort", aborted, { once: true });
      if (signal.aborted) aborted(); else changed();
    });
  })();
  await Promise.race([ready, new Promise<never>((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  })]);
  signal.throwIfAborted();
  const worker = navigator.serviceWorker.controller;
  if (!worker) throw new Error(copy.workerUnavailable);
  return worker;
}

// A bounded, pull-driven stream. Neither a full file nor a full ZIP is buffered.
export async function saveBrowserDownload(options: Options) {
  const { copy, controller, onStart } = options;
  const { signal } = controller;
  let timer: ReturnType<typeof setTimeout>;
  let port: MessagePort | undefined;
  let iterator: AsyncGenerator<Uint8Array> | undefined;
  let frame: HTMLIFrameElement | undefined;
  const arm = (ms: number, message: string) => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new Error(message)), ms);
  };
  const heartbeat = () => arm(120_000, copy.downloadIdleTimeout);
  try {
    arm(15_000, copy.workerReload);
    const worker = await ensureDownloadWorker(copy, signal);
    const channel = new MessageChannel();
    port = channel.port1;
    const token = crypto.randomUUID();
    const waitForMessage = new Promise<void>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      port!.onmessage = ({ data }) => {
        if (data?.type === "ready") { signal.removeEventListener("abort", abort); resolve(); }
      };
    });
    worker.postMessage({ type: "prepare-e2e-download", token, name: options.name, size: options.size, contentType: options.contentType }, [channel.port2]);
    arm(5_000, copy.workerNoResponse);
    await waitForMessage;
    signal.throwIfAborted();
    iterator = options.chunks(heartbeat);
    let started = false;
    let pulling = false;
    let sent = 0;
    const completion = new Promise<void>((resolve, reject) => {
      const abort = () => {
        port?.postMessage({ type: "error", message: copy.downloadFailed });
        reject(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      port!.onmessage = ({ data }) => {
        if (data?.type === "cancel") { controller.abort(new DOMException(copy.downloadCancelled, "AbortError")); return; }
        if (data?.type !== "pull" || pulling || signal.aborted) return;
        pulling = true;
        if (!started) { started = true; onStart(); }
        heartbeat();
        void (async () => {
          try {
            const chunk = await iterator!.next();
            signal.throwIfAborted();
            if (chunk.done) {
              if (sent !== options.size) throw new Error(copy.downloadIncomplete);
              signal.removeEventListener("abort", abort);
              port!.postMessage({ type: "done" });
              resolve();
              return;
            }
            sent += chunk.value.byteLength;
            if (sent > options.size) throw new Error(copy.downloadIncomplete);
            const buffer = chunk.value.slice().buffer;
            port!.postMessage({ type: "chunk", chunk: buffer }, [buffer]);
            heartbeat();
          } catch (error) { controller.abort(error); }
          finally { pulling = false; }
        })();
      };
    });
    arm(15_000, copy.downloadStartTimeout);
    // Keep native download navigation out of the app document, including on errors.
    frame = document.createElement("iframe");
    frame.hidden = true;
    frame.title = copy.download;
    frame.referrerPolicy = "no-referrer";
    // WebKit needs scripts permitted for the frame's Service Worker controller.
    frame.setAttribute("sandbox", "allow-same-origin allow-scripts allow-downloads");
    frame.src = `/e2e-download/${token}?lang=${options.language}`;
    document.body.append(frame);
    await completion;
  } finally {
    clearTimeout(timer!);
    port?.close();
    await iterator?.return(undefined).catch(() => undefined);
    // Give the native download manager time to consume the stream's final message.
    if (frame) setTimeout(() => frame?.remove(), signal.aborted ? 0 : 60_000);
  }
}
