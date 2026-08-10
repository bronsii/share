import { getTransfer, incrementTransferStat, transferIsExpired } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
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
