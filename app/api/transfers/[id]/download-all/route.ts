import { deleteTransfer, getStoredFile, getTransfer, incrementTransferStat } from "@/lib/storage";
import { createZipStream, type ZipSource } from "@/lib/zip-stream";
import { Readable } from "node:stream";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const manifest = await getTransfer(id);
  if (!manifest) return new Response("Übertragung nicht gefunden.", { status: 404 });
  if (new Date(manifest.expiresAt).getTime() <= Date.now()) {
    await deleteTransfer(manifest).catch(() => undefined);
    return new Response("Dieser Link ist abgelaufen.", { status: 410 });
  }
  if (manifest.files.length < 2) {
    return new Response("Für diese Übertragung ist kein ZIP-Download nötig.", { status: 400 });
  }

  const sources: ZipSource[] = [];
  for (const file of manifest.files) {
    const object = await getStoredFile(id, file.id);
    if (!object) return new Response("Eine Datei wurde nicht gefunden.", { status: 404 });
    sources.push({
      name: file.storedName,
      path: object.path,
      size: object.size,
      modifiedAt: new Date(manifest.createdAt),
    });
  }

  await incrementTransferStat(id, "downloads");
  const stream = createZipStream(sources);
  const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
  return new Response(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="Share-${manifest.folderName}.zip"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
