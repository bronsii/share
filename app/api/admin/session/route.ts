import { isIP } from "node:net";
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
const MAX_GLOBAL_ATTEMPTS = 50;
const WINDOW_MS = 15 * 60 * 1000;
const GLOBAL_ATTEMPT_KEY = "__all__";

function clientAddress(request: Request) {
  const forwardedAddresses = request.headers.get("x-forwarded-for")
    ?.split(",")
    .map((address) => address.trim())
    .filter(Boolean);
  const address = forwardedAddresses?.at(-1);
  return address && isIP(address) ? address : "unknown";
}

function activeAttempt(key: string, now: number) {
  const attempt = attempts.get(key);
  if (attempt && attempt.resetAt <= now) {
    attempts.delete(key);
    return undefined;
  }
  return attempt;
}

function recordFailedAttempt(key: string, now: number) {
  const current = activeAttempt(key, now);
  attempts.set(key, current
    ? { ...current, count: current.count + 1 }
    : { count: 1, resetAt: now + WINDOW_MS });
}

function tooManyAttempts(resetAt: number, now: number) {
  const retryAfter = Math.max(1, Math.ceil((resetAt - now) / 1000));
  return NextResponse.json(
    { error: "Zu viele Versuche. Bitte warte 15 Minuten." },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}

export async function GET(request: Request) {
  return NextResponse.json({ authenticated: adminRequestIsAuthenticated(request) });
}

export async function POST(request: Request) {
  const address = clientAddress(request);
  const now = Date.now();
  const current = activeAttempt(address, now);
  const globalCurrent = activeAttempt(GLOBAL_ATTEMPT_KEY, now);
  if (current && current.count >= MAX_ATTEMPTS) return tooManyAttempts(current.resetAt, now);
  if (globalCurrent && globalCurrent.count >= MAX_GLOBAL_ATTEMPTS) return tooManyAttempts(globalCurrent.resetAt, now);

  const body = await request.json().catch(() => null) as { code?: unknown } | null;
  try {
    if (!body || typeof body.code !== "string" || !adminCodeIsValid(body.code)) {
      recordFailedAttempt(address, now);
      recordFailedAttempt(GLOBAL_ATTEMPT_KEY, now);
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
