import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE_NAME = "share_admin_session";
export const ADMIN_SESSION_SECONDS = 8 * 60 * 60;

function configuredCode() {
  const value = process.env.SHARE_ADMIN_CODE;
  if (!value) throw new Error("SHARE_ADMIN_CODE ist nicht konfiguriert.");
  return value;
}

function sessionSecret() {
  const value = process.env.SHARE_ADMIN_SESSION_SECRET;
  if (!value) throw new Error("SHARE_ADMIN_SESSION_SECRET ist nicht konfiguriert.");
  return value;
}

function equalText(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function signature(payload: string) {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

export function adminCodeIsValid(code: string) {
  return equalText(String(code), configuredCode());
}

export function createAdminSessionToken() {
  const expiresAt = Math.floor(Date.now() / 1000) + ADMIN_SESSION_SECONDS;
  const payload = `${expiresAt}.${randomBytes(18).toString("base64url")}`;
  return `${payload}.${signature(payload)}`;
}

export function adminRequestIsAuthenticated(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ADMIN_COOKIE_NAME}=`));
  const token = cookie ? decodeURIComponent(cookie.slice(ADMIN_COOKIE_NAME.length + 1)) : "";
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expiresAt, nonce, suppliedSignature] = parts;
  if (!/^\d+$/.test(expiresAt) || Number(expiresAt) <= Math.floor(Date.now() / 1000) || !nonce) return false;
  return equalText(suppliedSignature, signature(`${expiresAt}.${nonce}`));
}
