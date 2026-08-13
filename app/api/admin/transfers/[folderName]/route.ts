import { NextResponse } from "next/server";
import { adminRequestIsAuthenticated } from "@/lib/admin-auth";
import { requestHasSameOrigin } from "@/lib/request-security";
import { removeTransferFolder } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ folderName: string }> };

export async function DELETE(request: Request, context: Context) {
  if (!requestHasSameOrigin(request)) {
    return NextResponse.json({ error: "Anfrage nicht erlaubt." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  if (!adminRequestIsAuthenticated(request)) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }
  const { folderName } = await context.params;
  try {
    await removeTransferFolder(folderName);
    return NextResponse.json({ deleted: true });
  } catch {
    return NextResponse.json({ error: "Die Freigabe konnte nicht gelöscht werden." }, { status: 400 });
  }
}
