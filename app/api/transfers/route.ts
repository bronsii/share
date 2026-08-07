import { NextResponse } from "next/server";
import { saveTransfer, TransferManifest } from "@/lib/storage";

export const dynamic = "force-dynamic";

const MAX_FILES = 20;
const MAX_TOTAL_SIZE = 100 * 1024 * 1024;
const ALLOWED_DAYS = new Set([1, 3, 7]);

function createId() { return crypto.randomUUID().replaceAll("-", "").slice(0, 20); }

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_TOTAL_SIZE + 1024 * 1024) {
    return NextResponse.json({ error: "Die Übertragung darf insgesamt höchstens 100 MB groß sein." }, { status: 413 });
  }
  try {
    const data = await request.formData();
    const files = data.getAll("files").filter((value): value is File => value instanceof File);
    const requestedDays = Number(data.get("days") ?? 7);
    const days = ALLOWED_DAYS.has(requestedDays) ? requestedDays : 7;
    const message = String(data.get("message") ?? "").trim().slice(0, 500);
    if (!files.length) return NextResponse.json({ error: "Bitte wähle mindestens eine Datei aus." }, { status: 400 });
    if (files.length > MAX_FILES) return NextResponse.json({ error: `Maximal ${MAX_FILES} Dateien sind möglich.` }, { status: 400 });
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > MAX_TOTAL_SIZE) {
      return NextResponse.json({ error: "Die Übertragung darf insgesamt höchstens 100 MB groß sein." }, { status: 413 });
    }
    const now = new Date();
    const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const id = createId();
    const manifest: TransferManifest = {
      id,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      message,
      files: files.map((file) => ({ id: createId(), name: file.name.slice(0, 240) || "Datei", size: file.size, type: file.type || "application/octet-stream" })),
    };
    await saveTransfer(manifest, files);
    return NextResponse.json({ id, url: `${new URL(request.url).origin}/t/${id}`, expiresAt: manifest.expiresAt }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Transfer upload failed", error);
    return NextResponse.json({ error: "Der Upload ist gerade nicht möglich. Bitte versuche es erneut." }, { status: 500 });
  }
}
