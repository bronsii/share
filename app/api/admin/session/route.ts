import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE_NAME,
  ADMIN_SESSION_SECONDS,
  adminCodeIsValid,
  adminRequestIsAuthenticated,
  createAdminSessionToken,
} from "@/lib/admin-auth";
import {
  clientRateLimitKey,
  consumeRateLimit,
  globalRateLimitKey,
  ProxyConfigurationError,
  proxyConfigurationUnavailable,
  readJsonBody,
  requestHasSameOrigin,
  RequestBodyTooLargeError,
} from "@/lib/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_ATTEMPTS = 5;
const MAX_GLOBAL_ATTEMPTS = 25;
const WINDOW_MS = 15 * 60 * 1000;
const GLOBAL_WINDOW_MS = 60 * 60 * 1000;

function tooManyAttempts(retryAfter: number) {
  return NextResponse.json(
    { error: "Zu viele Versuche. Bitte warte und versuche es später erneut." },
    { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request) {
  return NextResponse.json(
    { authenticated: adminRequestIsAuthenticated(request) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  try {
    if (!requestHasSameOrigin(request)) {
      return NextResponse.json({ error: "Anfrage nicht erlaubt." }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
    const clientKey = await clientRateLimitKey(request);
    const [clientLimit, globalLimit] = await Promise.all([
      consumeRateLimit({ scope: "admin-login-client", key: clientKey, limit: MAX_ATTEMPTS, windowMs: WINDOW_MS }),
      consumeRateLimit({ scope: "admin-login-global", key: globalRateLimitKey(), limit: MAX_GLOBAL_ATTEMPTS, windowMs: GLOBAL_WINDOW_MS }),
    ]);
    if (!clientLimit.allowed || !globalLimit.allowed) {
      return tooManyAttempts(Math.max(
        clientLimit.allowed ? 0 : clientLimit.retryAfter,
        globalLimit.allowed ? 0 : globalLimit.retryAfter,
      ));
    }

    const body = await readJsonBody<{ code?: unknown }>(request, 4096);
    if (!body || typeof body.code !== "string" || !adminCodeIsValid(body.code)) {
      return NextResponse.json(
        { error: "Die Passphrase ist nicht richtig." },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }

    const response = NextResponse.json({ authenticated: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(ADMIN_COOKIE_NAME, createAdminSessionToken(), {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: ADMIN_SESSION_SECONDS,
    });
    return response;
  } catch (error) {
    if (error instanceof ProxyConfigurationError) return proxyConfigurationUnavailable();
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "Die Anfrage ist zu groß." }, { status: 413, headers: { "Cache-Control": "no-store" } });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    console.error("Admin login failed", error);
    return NextResponse.json(
      { error: "Die Verwaltung ist noch nicht konfiguriert." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    if (!requestHasSameOrigin(request)) {
      return NextResponse.json({ error: "Anfrage nicht erlaubt." }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
  } catch (error) {
    if (error instanceof ProxyConfigurationError) return proxyConfigurationUnavailable();
    throw error;
  }
  const response = NextResponse.json({ authenticated: false }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(ADMIN_COOKIE_NAME, "", {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
