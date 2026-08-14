import { deleteTransfer, getStoredFile, getTransfer, incrementTransferStat } from "@/lib/storage";
import { createZipStream, type ZipSource } from "@/lib/zip-stream";
import { Readable } from "node:stream";
import {
  acquireRequestSlot,
  clientRateLimitKey,
  consumeRateLimit,
  ProxyConfigurationError,
  proxyConfigurationUnavailable,
} from "@/lib/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_DOWNLOAD_STARTS_PER_HOUR = 60;
const MAX_DOWNLOAD_BYTES_PER_DAY = 30 * 1024 ** 3;
const MAX_CONCURRENT_DOWNLOADS_PER_CLIENT = 3;
const MAX_CONCURRENT_DOWNLOADS_GLOBAL = 32;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let clientKey: string;
  try {
    clientKey = await clientRateLimitKey(request);
  } catch (error) {
    if (error instanceof ProxyConfigurationError) return proxyConfigurationUnavailable();
    throw error;
  }
  const lookupLimit = await consumeRateLimit({
    scope: "download-lookups-hour",
    key: clientKey,
    limit: 300,
    windowMs: 60 * 60 * 1000,
  });
  if (!lookupLimit.allowed) {
    return new Response("Zu viele Download-Anfragen.", {
      status: 429,
      headers: { "Retry-After": String(lookupLimit.retryAfter), "Cache-Control": "no-store" },
    });
  }
  const manifest = await getTransfer(id);
  if (!manifest) return new Response("Übertragung nicht gefunden.", { status: 404 });
  if (new Date(manifest.expiresAt).getTime() <= Date.now()) {
    await deleteTransfer(manifest).catch(() => undefined);
    return new Response("Dieser Link ist abgelaufen.", { status: 410 });
  }
  if (manifest.files.length < 2) {
    return new Response("Für diese Übertragung ist kein ZIP-Download nötig.", { status: 400 });
  }
  if (manifest.encryption) {
    return new Response("Ende-zu-Ende verschlüsselte Dateien werden einzeln im Browser entschlüsselt.", { status: 400 });
  }

  const sources: ZipSource[] = [];
  for (const file of manifest.files) {
    const object = await getStoredFile(manifest, file.id);
    if (!object) return new Response("Eine Datei wurde nicht gefunden.", { status: 404 });
    sources.push({
      name: file.storedName,
      path: object.path,
      size: object.size,
      modifiedAt: new Date(manifest.createdAt),
    });
  }

  const totalBytes = sources.reduce((sum, source) => sum + source.size, 0);
  const [requestLimit, byteLimit] = await Promise.all([
    consumeRateLimit({
      scope: "download-starts-hour",
      key: clientKey,
      limit: MAX_DOWNLOAD_STARTS_PER_HOUR,
      windowMs: 60 * 60 * 1000,
    }),
    consumeRateLimit({
      scope: "download-bytes-day",
      key: clientKey,
      limit: MAX_DOWNLOAD_BYTES_PER_DAY,
      windowMs: 24 * 60 * 60 * 1000,
      cost: Math.max(1, totalBytes),
    }),
  ]);
  if (!requestLimit.allowed || !byteLimit.allowed) {
    const retryAfter = Math.max(
      requestLimit.allowed ? 0 : requestLimit.retryAfter,
      byteLimit.allowed ? 0 : byteLimit.retryAfter,
    );
    return new Response("Download-Limit erreicht. Bitte versuche es später erneut.", {
      status: 429,
      headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" },
    });
  }
  const releaseDownload = acquireRequestSlot(
    "downloads",
    clientKey,
    MAX_CONCURRENT_DOWNLOADS_PER_CLIENT,
    MAX_CONCURRENT_DOWNLOADS_GLOBAL,
  );
  if (!releaseDownload) {
    return new Response("Zu viele parallele Downloads.", {
      status: 429,
      headers: { "Retry-After": "2", "Cache-Control": "no-store" },
    });
  }

  await incrementTransferStat(id, "downloads");
  try {
    const stream = createZipStream(sources);
    stream.once("close", releaseDownload);
    stream.once("end", releaseDownload);
    const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
    return new Response(body, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="Sendebude-${manifest.folderName}.zip"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    releaseDownload();
    throw error;
  }
}
