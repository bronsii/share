import type { Metadata } from "next";
import { headers } from "next/headers";
import { preferredUiLanguage } from "@/lib/ui-language";
import { PrivacyContent } from "./privacy-content";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const language = preferredUiLanguage(requestHeaders.get("accept-language"));
  return {
    title: language === "de" ? "Datenschutz | Share" : "Privacy | Share",
    description: language === "de"
      ? "Wie Share Dateien schützt, welche Betriebsdaten verarbeitet werden und wann Daten gelöscht werden."
      : "How Share protects files, which operational data is processed, and when data is deleted.",
  };
}

export default async function PrivacyPage() {
  const initialLanguage = preferredUiLanguage((await headers()).get("accept-language"));
  return <PrivacyContent initialLanguage={initialLanguage} />;
}
