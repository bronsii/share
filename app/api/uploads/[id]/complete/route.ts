import { NextResponse } from "next/server";
import { finishUploadSession, getTransfer, getUploadSession, UploadIncompleteError } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

function publicOrigin(request: Request) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return new URL(request.url).origin;
  const protocol = request.headers.get("x-forwarded-proto") ?? (host.includes("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${protocol}://${host}`;
}

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const session = await getUploadSession(id);
  if (!session) {
    const completedTransfer = await getTransfer(id);
    if (!completedTransfer) return NextResponse.json({ error: "Upload nicht gefunden." }, { status: 404 });
    return NextResponse.json(
      { id, url: `${publicOrigin(request)}/t/${id}`, expiresAt: completedTransfer.expiresAt },
      { status: 201 },
    );
  }
  try {
    await finishUploadSession(session);
    return NextResponse.json({ id, url: `${publicOrigin(request)}/t/${id}`, expiresAt: session.expiresAt }, { status: 201 });
  } catch (error) {
    if (error instanceof UploadIncompleteError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("Upload finalization failed", error);
    return NextResponse.json({ error: "Die Freigabe konnte nicht abgeschlossen werden." }, { status: 500 });
  }
}
