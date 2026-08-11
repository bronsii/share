import { createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NextResponse } from "next/server";
import { consumeStorageReservation, getUploadFile } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_CHUNK_SIZE = 8 * 1024 ** 2;
type Context = { params: Promise<{ id: string; fileId: string }> };

export async function PUT(request: Request, context: Context) {
  const { id, fileId } = await context.params;
  const target = await getUploadFile(id, fileId);
  if (!target) return NextResponse.json({ error: "Upload nicht gefunden." }, { status: 404 });
  const offset = Number(request.headers.get("x-upload-offset"));
  const length = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(offset) || offset < 0 || offset !== target.uploaded) {
    return NextResponse.json({ error: "Upload-Position stimmt nicht \u00fcberein.", uploaded: target.uploaded }, { status: 409 });
  }
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_CHUNK_SIZE || offset + length > target.file.size || !request.body) {
    return NextResponse.json({ error: "Ung\u00fcltiger Dateiabschnitt." }, { status: 400 });
  }
  try {
    await pipeline(
      Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(target.path, { flags: offset === 0 ? "wx" : "a" }),
    );
    const uploaded = (await stat(target.path)).size;
    if (uploaded > target.file.size) throw new Error("Datei ist gr\u00f6\u00dfer als erwartet.");
    await consumeStorageReservation(target.session.storageReservationId, uploaded - target.uploaded).catch((error) => {
      console.error("Storage reservation update failed", error);
    });
    return NextResponse.json({ uploaded }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (request.signal.aborted) return NextResponse.json({ error: "Upload pausiert." }, { status: 499 });
    console.error("Chunk upload failed", error);
    return NextResponse.json({ error: "Der Dateiabschnitt konnte nicht gespeichert werden." }, { status: 500 });
  }
}
