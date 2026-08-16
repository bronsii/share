import type { Metadata } from "next";
import { headers } from "next/headers";
import { getImprintDetails } from "@/lib/imprint";
import { publicPageMetadata } from "@/lib/site-metadata";
import { preferredUiLanguage } from "@/lib/ui-language";
import { TermsContent } from "./terms-content";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const language = preferredUiLanguage((await headers()).get("accept-language"));
  const title = language === "de" ? "Nutzungsbedingungen | Sendebude" : "Terms of Use | Sendebude";
  const description = language === "de"
    ? "Regeln für die sichere und rechtmäßige Nutzung von Sendebude."
    : "Rules for the secure and lawful use of Sendebude.";
  return publicPageMetadata({ language, pathname: "/nutzungsbedingungen", title, description });
}

export default async function TermsPage() {
  const initialLanguage = preferredUiLanguage((await headers()).get("accept-language"));
  return <TermsContent initialLanguage={initialLanguage} contactEmail={getImprintDetails().email} />;
}
