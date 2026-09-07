import { NextResponse } from "next/server";
import { adminRequestIsAuthenticated } from "@/lib/admin-auth";
import { getOperationsForAdmin, listTransfersForAdmin } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!adminRequestIsAuthenticated(request)) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const [transfers, operations] = await Promise.all([listTransfersForAdmin(), getOperationsForAdmin()]);
    return NextResponse.json({ transfers, operations }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { error: "Der Upload-Speicher ist gerade nicht erreichbar." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
