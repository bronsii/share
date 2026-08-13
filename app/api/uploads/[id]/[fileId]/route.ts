import { createWriteStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NextResponse } from "next/server";
import {
  appendUploadChunk,
  consumeStorageReservation,
  getUploadFile,
  InsufficientStorageError,
  UploadOffsetConflictError,
} from "@/lib/storage";
import { acquireRequestSlot, clientRateLimitKey, consumeRateLimit } from "@/lib/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_CHUNK_SIZE = 8 * 1024 ** 2;
const MAX_CHUNK_REQUESTS_PER_HOUR = 3000;
const MAX_CONCURRENT_CHUNKS_PER_CLIENT = 3;
const MAX_CONCURRENT_CHUNKS_GLOBAL = 16;
type Context = { params: Promise<{ id: string; fileId: string }> };

export async function PUT(request: Request, context: Context) {
  const clientKey = await clientRateLimitKey(request);
  const requestLimit = await consumeRateLimit({
    scope: "upload-chunks-hour",
    key: clientKey,
    limit: MAX_CHUNK_REQUESTS_PER_HOUR,
    windowMs: 60 * 60 * 1000,
  });
  if (!requestLimit.allowed) {
    return NextResponse.json(
      { error: "Zu viele Dateiabschnitte. Bitte setze den Upload später fort." },
      { status: 429, headers: { "Retry-After": String(requestLimit.retryAfter), "Cache-Control": "no-store" } },
    );
  }
  const releaseChunkSlot = acquireRequestSlot(
    "upload-chunks",
    clientKey,
    MAX_CONCURRENT_CHUNKS_PER_CLIENT,
    MAX_CONCURRENT_CHUNKS_GLOBAL,
  );
  if (!releaseChunkSlot) {
    return NextResponse.json(
      { error: "Zu viele parallele Uploads." },
      { status: 429, headers: { "Retry-After": "2", "Cache-Control": "no-store" } },
    );
  }

  const { id, fileId } = await context.params;
  let temporaryPath: string | null = null;
  try {
    const target = await getUploadFile(id, fileId);
    if (!target) return NextResponse.json({ error: "Upload nicht gefunden." }, { status: 404 });
    const offset = Number(request.headers.get("x-upload-offset"));
    const length = Number(request.headers.get("content-length"));
    if (!Number.isSafeInteger(offset) || offset < 0 || offset !== target.uploaded) {
      return NextResponse.json({ error: "Upload-Position stimmt nicht \u00fcberein.", uploaded: target.uploaded }, { status: 409 });
    }
    if (!Number.isSafeInteger(length) || length <= 0 || length > MAX_CHUNK_SIZE || offset + length > target.file.size || !request.body) {
      return NextResponse.json({ error: "Ung\u00fcltiger Dateiabschnitt." }, { status: 400 });
    }
    if (target.session.encryption && target.file.plaintextSize) {
      const cipherChunkSize = target.session.encryption.chunkSize + 16;
      const chunkIndex = Math.floor(offset / cipherChunkSize);
      const plaintextOffset = chunkIndex * target.session.encryption.chunkSize;
      const expectedLength = Math.min(target.session.encryption.chunkSize, target.file.plaintextSize - plaintextOffset) + 16;
      if (offset !== chunkIndex * cipherChunkSize || length !== expectedLength) {
        return NextResponse.json({ error: "Ung\u00fcltiger verschl\u00fcsselter Dateiabschnitt." }, { status: 400 });
      }
    }

    temporaryPath = `${target.path}.${crypto.randomUUID()}.part`;
    let received = 0;
    const enforceLength = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.byteLength;
        callback(received > length ? new Error("Dateiabschnitt überschreitet die angegebene Größe.") : null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0]),
      enforceLength,
      createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 }),
    );
    if (received !== length || (await stat(temporaryPath)).size !== length) throw new Error("Dateiabschnitt ist unvollständig.");
    const uploaded = await appendUploadChunk(target.path, temporaryPath, offset, length);
    if (uploaded > target.file.size) throw new Error("Datei ist gr\u00f6\u00dfer als erwartet.");
    await consumeStorageReservation(target.session.storageReservationId, uploaded - target.uploaded).catch((error) => {
      console.error("Storage reservation update failed", error);
    });
    return NextResponse.json({ uploaded }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (request.signal.aborted) return NextResponse.json({ error: "Upload pausiert." }, { status: 499 });
    if (error instanceof UploadOffsetConflictError) {
      const current = await getUploadFile(id, fileId);
      return NextResponse.json({ error: "Upload-Position stimmt nicht überein.", uploaded: current?.uploaded ?? 0 }, { status: 409 });
    }
    if (error instanceof InsufficientStorageError) {
      return NextResponse.json({ error: error.message }, { status: 507 });
    }
    console.error("Chunk upload failed", error);
    return NextResponse.json({ error: "Der Dateiabschnitt konnte nicht gespeichert werden." }, { status: 500 });
  } finally {
    releaseChunkSlot();
    if (temporaryPath) await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}
