import Busboy from "busboy";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import {
  cleanupExpiredTransfers,
  createFolderName,
  createTransferId,
  ensureStorageCapacity,
  InsufficientStorageError,
  prepareTransferFolder,
  removeTransferFolder,
  storedFilePath,
  TransferFile,
  TransferManifest,
  uniqueStoredName,
  writeTransferManifest,
} from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_FILES = 20;
const MAX_TOTAL_SIZE = 15 * 1024 ** 3;
const MULTIPART_OVERHEAD = 10 * 1024 ** 2;
const ALLOWED_DAYS = new Set([1, 3, 7]);

class UploadError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function createFileId() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 20);
}

function publicOrigin(request: Request) {
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const forwardedProtocol = request.headers.get("x-forwarded-proto");
  if (!forwardedHost) return new URL(request.url).origin;
  const protocol = forwardedProtocol ?? (forwardedHost.includes("localhost") || forwardedHost.startsWith("127.") ? "http" : "https");
  return `${protocol}://${forwardedHost}`;
}

async function receiveUpload(request: Request, folderName: string) {
  if (!request.body) throw new UploadError("Der Upload enthält keine Daten.", 400);

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data")) {
    throw new UploadError("Ungültiges Upload-Format.", 415);
  }

  const parser = Busboy({
    headers: Object.fromEntries(request.headers),
    limits: {
      files: MAX_FILES,
      fileSize: MAX_TOTAL_SIZE,
      fields: 4,
      fieldSize: 2_000,
      parts: MAX_FILES + 4,
      headerPairs: 100,
    },
  });

  const files: TransferFile[] = [];
  const writes: Promise<void>[] = [];
  const usedNames = new Set<string>();
  let totalSize = 0;
  let requestedDays = 7;
  let message = "";
  let uploadProblem: UploadError | null = null;

  parser.on("field", (fieldName, value, info) => {
    if (info.valueTruncated) {
      uploadProblem ??= new UploadError("Ein Formularfeld ist zu lang.", 400);
      return;
    }
    if (fieldName === "days") requestedDays = Number(value);
    if (fieldName === "message") message = value.trim().slice(0, 500);
  });

  parser.on("file", (fieldName, stream, info) => {
    if (fieldName !== "files" || !info.filename) {
      stream.resume();
      return;
    }

    const originalName = info.filename.slice(0, 240) || "Datei";
    const storedName = uniqueStoredName(originalName, usedNames);
    const record: TransferFile = {
      id: createFileId(),
      name: originalName,
      storedName,
      size: 0,
      type: info.mimeType || "application/octet-stream",
    };
    files.push(record);

    stream.on("data", (chunk: Buffer) => {
      record.size += chunk.length;
      totalSize += chunk.length;
      if (totalSize > MAX_TOTAL_SIZE) {
        uploadProblem ??= new UploadError("Die Übertragung darf insgesamt höchstens 15 GB groß sein.", 413);
      }
    });
    stream.on("limit", () => {
      uploadProblem ??= new UploadError("Die Übertragung darf insgesamt höchstens 15 GB groß sein.", 413);
    });

    const write = pipeline(
      stream,
      createWriteStream(storedFilePath(folderName, storedName), { flags: "wx" }),
    ).catch((error: unknown) => {
      uploadProblem ??= error instanceof UploadError
        ? error
        : new UploadError("Eine Datei konnte nicht gespeichert werden.", 500);
    });
    writes.push(write);
  });

  parser.on("filesLimit", () => {
    uploadProblem ??= new UploadError(`Maximal ${MAX_FILES} Dateien sind möglich.`, 400);
  });
  parser.on("partsLimit", () => {
    uploadProblem ??= new UploadError("Der Upload enthält zu viele Bestandteile.", 400);
  });

  await new Promise<void>((resolve, reject) => {
    parser.once("close", resolve);
    parser.once("error", (error) => reject(error));
    const body = Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0]);
    body.once("error", reject);
    body.pipe(parser);
  });
  await Promise.all(writes);

  if (uploadProblem) throw uploadProblem;
  if (!files.length) throw new UploadError("Bitte wähle mindestens eine Datei aus.", 400);
  if (totalSize > MAX_TOTAL_SIZE) throw new UploadError("Die Übertragung darf insgesamt höchstens 15 GB groß sein.", 413);

  return {
    files,
    days: ALLOWED_DAYS.has(requestedDays) ? requestedDays : 7,
    message,
  };
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    return NextResponse.json({ error: "Der Browser hat keine Uploadgröße übermittelt." }, { status: 411 });
  }
  if (contentLength > MAX_TOTAL_SIZE + MULTIPART_OVERHEAD) {
    return NextResponse.json({ error: "Die Übertragung darf insgesamt höchstens 15 GB groß sein." }, { status: 413 });
  }

  const now = new Date();
  const folderName = createFolderName(now);
  let folderPrepared = false;

  try {
    await cleanupExpiredTransfers();
    await ensureStorageCapacity(contentLength);
    await prepareTransferFolder(folderName);
    folderPrepared = true;

    const upload = await receiveUpload(request, folderName);
    const expiresAt = new Date(now.getTime() + upload.days * 24 * 60 * 60 * 1000);
    const id = createTransferId(folderName);
    const manifest: TransferManifest = {
      id,
      folderName,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      message: upload.message,
      files: upload.files,
    };
    await writeTransferManifest(manifest);

    return NextResponse.json(
      { id, url: `${publicOrigin(request)}/t/${id}`, expiresAt: manifest.expiresAt },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (folderPrepared) await removeTransferFolder(folderName).catch(() => undefined);
    console.error("Transfer upload failed", error);
    if (error instanceof UploadError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof InsufficientStorageError) {
      return NextResponse.json({ error: error.message }, { status: 507 });
    }
    return NextResponse.json(
      { error: "Der Upload ist gerade nicht möglich. Bitte versuche es erneut." },
      { status: 500 },
    );
  }
}
