import type { Metadata } from "next";
import { headers } from "next/headers";
import { publicPageMetadata } from "@/lib/site-metadata";
import { preferredUiLanguage } from "@/lib/ui-language";
import { PrivacyContent } from "./privacy-content";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const language = preferredUiLanguage(requestHeaders.get("accept-language"));
  const title = language === "de" ? "Datenschutz | Sendebude" : "Privacy | Sendebude";
  const description = language === "de"
    ? "Wie Sendebude Dateien schützt, welche Betriebsdaten verarbeitet werden und wann Daten gelöscht werden."
    : "How Sendebude protects files, which operational data is processed, and when data is deleted.";
  return publicPageMetadata({ language, pathname: "/datenschutz", title, description });
}

export default async function PrivacyPage() {
  const initialLanguage = preferredUiLanguage((await headers()).get("accept-language"));
  return <PrivacyContent initialLanguage={initialLanguage} />;
}
