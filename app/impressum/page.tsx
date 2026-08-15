import type { Metadata } from "next";
import { headers } from "next/headers";
import { getImprintDetails } from "@/lib/imprint";
import { publicPageMetadata } from "@/lib/site-metadata";
import { preferredUiLanguage } from "@/lib/ui-language";
import { ImprintContent } from "./imprint-content";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const language = preferredUiLanguage((await headers()).get("accept-language"));
  const title = language === "de" ? "Impressum | Sendebude" : "Legal notice | Sendebude";
  const description = language === "de" ? "Anbieterkennzeichnung von Sendebude." : "Provider information for Sendebude.";
  return publicPageMetadata({ language, pathname: "/impressum", title, description });
}

export default async function ImprintPage() {
  const initialLanguage = preferredUiLanguage((await headers()).get("accept-language"));
  return <ImprintContent initialLanguage={initialLanguage} details={getImprintDetails()} />;
}
