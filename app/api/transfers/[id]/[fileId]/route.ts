import { deleteTransfer, getStoredFile, getTransfer } from "@/lib/storage";

export const dynamic = "force-dynamic";

function safeDisposition(name: string) {
  const fallback = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await context.params;
  const manifest = await getTransfer(id);
  if (!manifest) return new Response("Übertragung nicht gefunden.", { status: 404 });
  if (new Date(manifest.expiresAt).getTime() <= Date.now()) {
    await deleteTransfer(manifest).catch(() => undefined);
    return new Response("Dieser Link ist abgelaufen.", { status: 410 });
  }
  const file = manifest.files.find((item) => item.id === fileId);
  if (!file) return new Response("Datei nicht gefunden.", { status: 404 });
  const object = await getStoredFile(id, fileId);
  if (!object) return new Response("Datei nicht gefunden.", { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "Content-Length": String(object.size),
      "Content-Disposition": safeDisposition(file.name),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
