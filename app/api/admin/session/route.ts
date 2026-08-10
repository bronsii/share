import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE_NAME,
  ADMIN_SESSION_SECONDS,
  adminCodeIsValid,
  adminRequestIsAuthenticated,
  createAdminSessionToken,
} from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Attempt = { count: number; resetAt: number };
const globalAttempts = globalThis as typeof globalThis & { shareAdminAttempts?: Map<string, Attempt> };
const attempts = globalAttempts.shareAdminAttempts ??= new Map<string, Attempt>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

function clientAddress(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request.headers.get("x-real-ip")
    ?? "unknown";
}

export async function GET(request: Request) {
  return NextResponse.json({ authenticated: adminRequestIsAuthenticated(request) });
}

export async function POST(request: Request) {
  const address = clientAddress(request);
  const now = Date.now();
  const current = attempts.get(address);
  if (current && current.resetAt > now && current.count >= MAX_ATTEMPTS) {
    return NextResponse.json({ error: "Zu viele Versuche. Bitte warte 15 Minuten." }, { status: 429 });
  }

  const body = await request.json().catch(() => null) as { code?: unknown } | null;
  try {
    if (!body || typeof body.code !== "string" || !adminCodeIsValid(body.code)) {
      attempts.set(address, current && current.resetAt > now
        ? { ...current, count: current.count + 1 }
        : { count: 1, resetAt: now + WINDOW_MS });
      return NextResponse.json({ error: "Der Code ist nicht richtig." }, { status: 401 });
    }

    attempts.delete(address);
    const response = NextResponse.json({ authenticated: true });
    response.cookies.set(ADMIN_COOKIE_NAME, createAdminSessionToken(), {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: ADMIN_SESSION_SECONDS,
    });
    return response;
  } catch (error) {
    console.error("Admin login failed", error);
    return NextResponse.json({ error: "Die Verwaltung ist noch nicht konfiguriert." }, { status: 503 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(ADMIN_COOKIE_NAME, "", {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
