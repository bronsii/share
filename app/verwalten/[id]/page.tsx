import { headers } from "next/headers";
import { privatePageMetadata } from "@/lib/site-metadata";
import { preferredUiLanguage } from "@/lib/ui-language";
import { SenderManagement } from "./sender-management";

export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const language = preferredUiLanguage((await headers()).get("accept-language"));
  return privatePageMetadata({ language, title: language === "de" ? "Freigabe löschen | Sendebude" : "Delete share | Sendebude", description: language === "de" ? "Privater Löschlink für eine Sendebude-Freigabe." : "Private deletion link for a Sendebude share." });
}
export default async function ManagePage({ params }: { params: Promise<{ id: string }> }) {
  return <SenderManagement id={(await params).id} initialLanguage={preferredUiLanguage((await headers()).get("accept-language"))} />;
}
