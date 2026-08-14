import type { Metadata } from "next";
import { headers } from "next/headers";
import { getImprintDetails } from "@/lib/imprint";
import { preferredUiLanguage } from "@/lib/ui-language";
import { ImprintContent } from "./imprint-content";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const language = preferredUiLanguage((await headers()).get("accept-language"));
  return {
    title: language === "de" ? "Impressum | Sendebude" : "Legal notice | Sendebude",
    description: language === "de" ? "Anbieterkennzeichnung von Sendebude." : "Provider information for Sendebude.",
  };
}

export default async function ImprintPage() {
  const initialLanguage = preferredUiLanguage((await headers()).get("accept-language"));
  return <ImprintContent initialLanguage={initialLanguage} details={getImprintDetails()} />;
}
