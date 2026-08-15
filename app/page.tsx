import type { Metadata } from "next";
import { headers } from "next/headers";
import { publicPageMetadata } from "@/lib/site-metadata";
import { preferredUiLanguage } from "@/lib/ui-language";
import { HomeContent } from "./home-content";

export async function generateMetadata(): Promise<Metadata> {
  const language = preferredUiLanguage((await headers()).get("accept-language"));
  const title = language === "de"
    ? "Dateien sicher teilen – kostenlos bis 5 GB | Sendebude"
    : "Share files securely – free up to 5 GB | Sendebude";
  const description = language === "de"
    ? "Teile Dateien bis 5 GB kostenlos, ohne Registrierung und Ende-zu-Ende verschlüsselt. Automatische Löschung, Open Source und in Deutschland gehostet."
    : "Share files up to 5 GB for free, without registration and with end-to-end encryption. Automatic deletion, open source, and hosted in Germany.";
  return publicPageMetadata({ language, pathname: "/", title, description });
}

export default async function Home() {
  const initialLanguage = preferredUiLanguage((await headers()).get("accept-language"));
  return <HomeContent initialLanguage={initialLanguage} />;
}
