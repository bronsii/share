import type { Metadata } from "next";
import { headers } from "next/headers";
import { privatePageMetadata } from "@/lib/site-metadata";
import { getTransfer, transferIsExpired } from "@/lib/storage";
import { preferredUiLanguage } from "@/lib/ui-language";
import { DownloadContent } from "./download-content";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const language = preferredUiLanguage((await headers()).get("accept-language"));
  const title = language === "de" ? "Private Freigabe | Sendebude" : "Private share | Sendebude";
  const description = language === "de"
    ? "Private, Ende-zu-Ende verschlüsselte Sendebude-Freigabe."
    : "Private, end-to-end encrypted Sendebude share.";
  return privatePageMetadata({ language, title, description });
}

export default async function TransferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [transfer, requestHeaders] = await Promise.all([getTransfer(id), headers()]);
  const initialLanguage = preferredUiLanguage(requestHeaders.get("accept-language"));
  if (!transfer) return <DownloadContent initialLanguage={initialLanguage} state="missing" />;
  if (transferIsExpired(transfer)) return <DownloadContent initialLanguage={initialLanguage} state="expired" />;

  return (
    <DownloadContent
      initialLanguage={initialLanguage}
      state="ready"
      transfer={{
        id: transfer.id,
        expiresAt: transfer.expiresAt,
        message: transfer.message,
        files: transfer.files.map(({ id: fileId, name, size, type, plaintextSize }) => ({
          id: fileId,
          name,
          size,
          type,
          plaintextSize,
        })),
        encryption: transfer.encryption,
      }}
    />
  );
}
