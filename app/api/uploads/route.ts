import { NextResponse } from "next/server";
import {
  cleanupExpiredTransfers,
  createFolderName,
  createTransferId,
  InsufficientStorageError,
  prepareTransferFolder,
  releaseStorageReservation,
  reserveStorageCapacity,
  removeTransferFolder,
  TransferFile,
  UploadSession,
  uniqueStoredName,
  writeUploadSession,
} from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_FILES = 20;
const MAX_TOTAL_SIZE = 15 * 1024 ** 3;
const ALLOWED_DAYS = new Set([1, 3, 7]);

type UploadRequest = {
  files?: Array<{ name?: string; size?: number; type?: string }>;
  days?: number;
  message?: string;
};

export async function POST(request: Request) {
  const now = new Date();
  const folderName = createFolderName(now);
  let folderPrepared = false;
  let storageReservationId: string | undefined;
  try {
    const body = await request.json() as UploadRequest;
    if (!Array.isArray(body.files) || body.files.length < 1 || body.files.length > MAX_FILES) {
      return NextResponse.json({ error: `Bitte w\u00e4hle zwischen 1 und ${MAX_FILES} Dateien aus.` }, { status: 400 });
    }
    if (body.files.some((file) => !Number.isSafeInteger(file.size) || (file.size ?? 0) <= 0)) {
      return NextResponse.json(
        { error: "Ordner oder leere Dateien können nicht hochgeladen werden. Bitte wähle einzelne Dateien oder eine ZIP-Datei." },
        { status: 400 },
      );
    }
    const totalSize = body.files.reduce((sum, file) => sum + file.size!, 0);
    if (!Number.isSafeInteger(totalSize) || totalSize > MAX_TOTAL_SIZE) {
      return NextResponse.json({ error: "Die \u00dcbertragung darf insgesamt h\u00f6chstens 15GB gro\u00df sein." }, { status: 413 });
    }

    await cleanupExpiredTransfers();
    storageReservationId = await reserveStorageCapacity(totalSize);
    await prepareTransferFolder(folderName);
    folderPrepared = true;

    const usedNames = new Set<string>();
    const files: TransferFile[] = body.files.map((file) => ({
      id: crypto.randomUUID().replaceAll("-", "").slice(0, 20),
      name: (file.name || "Datei").slice(0, 240),
      storedName: uniqueStoredName((file.name || "Datei").slice(0, 240), usedNames),
      size: file.size!,
      type: (file.type || "application/octet-stream").slice(0, 200),
    }));
    const days = ALLOWED_DAYS.has(Number(body.days)) ? Number(body.days) : 3;
    const session: UploadSession = {
      id: createTransferId(folderName),
      folderName,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + days * 86400000).toISOString(),
      message: String(body.message ?? "").trim().slice(0, 500),
      files,
      storageReservationId,
    };
    await writeUploadSession(session);
    return NextResponse.json({ id: session.id, expiresAt: session.expiresAt, files: files.map(({ id, name, size }) => ({ id, name, size, uploaded: 0 })) }, { status: 201 });
  } catch (error) {
    if (folderPrepared) await removeTransferFolder(folderName).catch(() => undefined);
    await releaseStorageReservation(storageReservationId).catch(() => undefined);
    console.error("Upload session creation failed", error);
    const status = error instanceof InsufficientStorageError ? 507 : 500;
    return NextResponse.json({ error: error instanceof InsufficientStorageError ? error.message : "Der Upload konnte nicht gestartet werden." }, { status });
  }
}
