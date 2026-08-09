import { NextResponse } from "next/server";
import { finishUploadSession, getUploadSession } from "@/lib/storage";

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
  if (!session) return NextResponse.json({ error: "Upload nicht gefunden." }, { status: 404 });
  try {
    await finishUploadSession(session);
    return NextResponse.json({ id, url: `${publicOrigin(request)}/t/${id}`, expiresAt: session.expiresAt }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Der Upload ist noch nicht vollst\u00e4ndig." }, { status: 409 });
  }
}
