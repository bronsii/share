import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    { error: "Dieser unverschlüsselte Uploadweg wurde deaktiviert. Bitte verwende den Ende-zu-Ende verschlüsselten Upload auf der Startseite." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
