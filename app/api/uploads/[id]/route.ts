import { NextResponse } from "next/server";
import { getUploadProgress, getUploadSession, removeTransferFolder } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  const session = await getUploadSession(id);
  if (!session) return NextResponse.json({ error: "Upload nicht gefunden." }, { status: 404 });
  return NextResponse.json({ id, files: await getUploadProgress(session) }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  const session = await getUploadSession(id);
  if (!session) return NextResponse.json({ ok: true });
  await removeTransferFolder(session.folderName);
  return NextResponse.json({ ok: true });
}
