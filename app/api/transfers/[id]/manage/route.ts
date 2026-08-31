import { createHash, timingSafeEqual } from "node:crypto";
import { deleteTransfer, getTransfer } from "@/lib/storage";
import { clientRateLimitKey, consumeRateLimit, ProxyConfigurationError, proxyConfigurationUnavailable, requestHasSameOrigin } from "@/lib/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!requestHasSameOrigin(request)) return Response.json({ error: "Anfrage nicht erlaubt." }, { status: 403, headers });
    const key = await clientRateLimitKey(request);
    const limit = await consumeRateLimit({ scope: "sender-delete", key, limit: 30, windowMs: 15 * 60 * 1000 });
    if (!limit.allowed) return Response.json({ error: "Bitte versuche es später erneut." }, { status: 429, headers: { ...headers, "Retry-After": String(limit.retryAfter) } });
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(request.headers.get("authorization") ?? "")?.[1];
    const transfer = await getTransfer((await params).id);
    const hash = transfer?.managementTokenHash;
    if (!token || !hash || !/^[a-f0-9]{64}$/u.test(hash)
      || !timingSafeEqual(createHash("sha256").update(token).digest(), Buffer.from(hash, "hex"))) {
      return Response.json({ error: "Link ungültig oder Freigabe nicht mehr vorhanden." }, { status: 404, headers });
    }
    await deleteTransfer(transfer!);
    return new Response(null, { status: 204, headers });
  } catch (error) {
    if (error instanceof ProxyConfigurationError) return proxyConfigurationUnavailable();
    // Never log the request: its authorization header carries a private capability.
    console.error("Sender deletion failed");
    return Response.json({ error: "Löschen fehlgeschlagen. Bitte versuche es erneut." }, { status: 500, headers });
  }
}
