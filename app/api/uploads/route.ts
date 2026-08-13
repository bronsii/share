import { NextResponse } from "next/server";
import {
  cleanupExpiredTransfers,
  countIncompleteUploadSessions,
  createFolderName,
  createTransferId,
  ensureStorageCapacity,
  InsufficientStorageError,
  prepareTransferFolder,
  removeTransferFolder,
  TransferFile,
  UploadSession,
  writeUploadSession,
} from "@/lib/storage";
import {
  clientRateLimitKey,
  consumeRateLimit,
  readJsonBody,
  RequestBodyTooLargeError,
} from "@/lib/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_FILES = 20;
const MAX_TOTAL_SIZE = 5 * 1024 ** 3;
const PLAINTEXT_CHUNK_SIZE = 4 * 1024 ** 2;
const GCM_TAG_SIZE = 16;
const ALLOWED_DAYS = new Set([1, 3, 7]);
const MAX_SESSION_ATTEMPTS_PER_HOUR = 10;
const MAX_UPLOAD_BYTES_PER_DAY = 20 * 1024 ** 3;
const MAX_ACTIVE_UPLOADS_PER_CLIENT = 2;
const MAX_ACTIVE_UPLOADS_GLOBAL = 32;
const MAX_SESSION_REQUEST_BYTES = 64 * 1024;

const globalUploadAdmission = globalThis as typeof globalThis & { shareUploadAdmissionQueue?: Promise<void> };
globalUploadAdmission.shareUploadAdmissionQueue ??= Promise.resolve();

class UploadLimitError extends Error {
  constructor(message: string, readonly retryAfter = 1800) {
    super(message);
  }
}

async function withUploadAdmission<T>(operation: () => Promise<T>) {
  const previous = globalUploadAdmission.shareUploadAdmissionQueue ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.catch(() => undefined).then(() => current);
  globalUploadAdmission.shareUploadAdmissionQueue = queued;
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (globalUploadAdmission.shareUploadAdmissionQueue === queued) {
      globalUploadAdmission.shareUploadAdmissionQueue = Promise.resolve();
    }
  }
}

type UploadRequest = {
  files?: Array<{ size?: number; plaintextSize?: number }>;
  days?: number;
  encryption?: { version?: number; metadata?: string };
};

export async function POST(request: Request) {
  const now = new Date();
  const folderName = createFolderName(now);
  let folderPrepared = false;
  try {
    const ownerKey = await clientRateLimitKey(request);
    const sessionAttempts = await consumeRateLimit({
      scope: "upload-sessions-hour",
      key: ownerKey,
      limit: MAX_SESSION_ATTEMPTS_PER_HOUR,
      windowMs: 60 * 60 * 1000,
    });
    if (!sessionAttempts.allowed) {
      throw new UploadLimitError("Zu viele neue Uploads. Bitte versuche es später erneut.", sessionAttempts.retryAfter);
    }

    const body = await readJsonBody<UploadRequest>(request, MAX_SESSION_REQUEST_BYTES);
    if (!Array.isArray(body.files) || body.files.length < 1 || body.files.length > MAX_FILES) {
      return NextResponse.json({ error: `Bitte w\u00e4hle zwischen 1 und ${MAX_FILES} Dateien aus.` }, { status: 400 });
    }
    if (body.files.some((file) => !Number.isSafeInteger(file.size) || (file.size ?? 0) <= 0)) {
      return NextResponse.json(
        { error: "Ordner oder leere Dateien können nicht hochgeladen werden. Bitte wähle einzelne Dateien oder eine ZIP-Datei." },
        { status: 400 },
      );
    }
    const encrypted = body.encryption?.version === 1;
    if (!body.encryption) {
      return NextResponse.json({ error: "Uploads müssen Ende-zu-Ende verschlüsselt sein." }, { status: 400 });
    }
    if (!encrypted || typeof body.encryption.metadata !== "string" || !/^[A-Za-z0-9_-]{40,50000}$/u.test(body.encryption.metadata)) {
      return NextResponse.json({ error: "Ungültige Verschlüsselungsdaten." }, { status: 400 });
    }
    if (body.files.some((file) => {
      const plaintextSize = file.plaintextSize;
      const expectedSize = Number.isSafeInteger(plaintextSize) && plaintextSize! > 0
        ? plaintextSize! + Math.ceil(plaintextSize! / PLAINTEXT_CHUNK_SIZE) * GCM_TAG_SIZE
        : -1;
      return file.size !== expectedSize;
    })) {
      return NextResponse.json({ error: "Ungültige verschlüsselte Dateigröße." }, { status: 400 });
    }
    const totalSize = body.files.reduce((sum, file) => sum + file.size!, 0);
    const plaintextTotalSize = body.files.reduce((sum, file) => sum + file.plaintextSize!, 0);
    if (!Number.isSafeInteger(totalSize) || !Number.isSafeInteger(plaintextTotalSize) || plaintextTotalSize > MAX_TOTAL_SIZE) {
      return NextResponse.json({ error: "Die \u00dcbertragung darf insgesamt h\u00f6chstens 5 GB gro\u00df sein." }, { status: 413 });
    }

    const session = await withUploadAdmission(async () => {
      await cleanupExpiredTransfers();
      const [clientActiveUploads, globalActiveUploads] = await Promise.all([
        countIncompleteUploadSessions(ownerKey),
        countIncompleteUploadSessions(),
      ]);
      if (clientActiveUploads >= MAX_ACTIVE_UPLOADS_PER_CLIENT) {
        throw new UploadLimitError("Du hast bereits zwei unvollständige Uploads. Bitte setze einen fort oder brich ihn ab.");
      }
      if (globalActiveUploads >= MAX_ACTIVE_UPLOADS_GLOBAL) {
        throw new UploadLimitError("Der Upload-Dienst ist gerade ausgelastet. Bitte versuche es später erneut.", 900);
      }
      const dailyBytes = await consumeRateLimit({
        scope: "upload-bytes-day",
        key: ownerKey,
        limit: MAX_UPLOAD_BYTES_PER_DAY,
        windowMs: 24 * 60 * 60 * 1000,
        cost: plaintextTotalSize,
      });
      if (!dailyBytes.allowed) {
        throw new UploadLimitError("Das tägliche Upload-Limit ist erreicht. Bitte versuche es später erneut.", dailyBytes.retryAfter);
      }

      await ensureStorageCapacity(totalSize);
      await prepareTransferFolder(folderName);
      folderPrepared = true;

      const files: TransferFile[] = body.files!.map((file, index) => ({
        id: crypto.randomUUID().replaceAll("-", "").slice(0, 20),
        name: `Verschlüsselte Datei ${index + 1}`,
        storedName: `${crypto.randomUUID().replaceAll("-", "")}.bin`,
        size: file.size!,
        type: "application/octet-stream",
        plaintextSize: file.plaintextSize,
      }));
      const days = ALLOWED_DAYS.has(Number(body.days)) ? Number(body.days) : 3;
      const nextSession: UploadSession = {
        id: createTransferId(folderName),
        folderName,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + days * 86400000).toISOString(),
        message: "",
        files,
        encryption: { version: 1, metadata: body.encryption!.metadata!, chunkSize: PLAINTEXT_CHUNK_SIZE },
        security: { ownerKey },
      };
      await writeUploadSession(nextSession);
      return nextSession;
    });
    return NextResponse.json({ id: session.id, expiresAt: session.expiresAt, files: session.files.map(({ id, name, size }) => ({ id, name, size, uploaded: 0 })) }, { status: 201 });
  } catch (error) {
    if (folderPrepared) await removeTransferFolder(folderName).catch(() => undefined);
    if (error instanceof UploadLimitError) {
      return NextResponse.json({ error: error.message }, { status: 429, headers: { "Retry-After": String(error.retryAfter), "Cache-Control": "no-store" } });
    }
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "Die Upload-Anfrage ist zu groß." }, { status: 413, headers: { "Cache-Control": "no-store" } });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Ungültige Upload-Anfrage." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    console.error("Upload session creation failed", error);
    const status = error instanceof InsufficientStorageError ? 507 : 500;
    return NextResponse.json({ error: error instanceof InsufficientStorageError ? error.message : "Der Upload konnte nicht gestartet werden." }, { status });
  }
}
