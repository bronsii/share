import { getTransfer, incrementTransferStat, transferIsExpired } from "@/lib/storage";
import { clientRateLimitKey, consumeRateLimit } from "@/lib/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const clientKey = await clientRateLimitKey(request);
  const [generalLimit, transferLimit] = await Promise.all([
    consumeRateLimit({ scope: "transfer-views-hour", key: clientKey, limit: 240, windowMs: 60 * 60 * 1000 }),
    consumeRateLimit({ scope: "transfer-view-day", key: `${clientKey}:${id}`, limit: 20, windowMs: 24 * 60 * 60 * 1000 }),
  ]);
  if (!generalLimit.allowed || !transferLimit.allowed) {
    const retryAfter = Math.max(
      generalLimit.allowed ? 0 : generalLimit.retryAfter,
      transferLimit.allowed ? 0 : transferLimit.retryAfter,
    );
    return new Response(null, { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } });
  }
  const manifest = await getTransfer(id);
  if (!manifest || transferIsExpired(manifest)) {
    return new Response(null, { status: 404 });
  }

  await incrementTransferStat(id, "views");
  return new Response(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}
