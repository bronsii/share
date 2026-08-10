import { NextResponse } from "next/server";
import { adminRequestIsAuthenticated } from "@/lib/admin-auth";
import { listTransfersForAdmin } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!adminRequestIsAuthenticated(request)) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }
  return NextResponse.json({ transfers: await listTransfersForAdmin() });
}
