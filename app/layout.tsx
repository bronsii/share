import type { Metadata } from "next";
import { headers } from "next/headers";
import { preferredUiLanguage } from "@/lib/ui-language";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const language = preferredUiLanguage(requestHeaders.get("accept-language"));
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "sendebude.de";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = language === "de" ? "Sendebude - Sicher Daten weitergeben" : "Sendebude - Share files securely";
  const description = language === "de"
    ? "Dateien bis 5 GB sicher, Ende-zu-Ende verschlüsselt und ohne Registrierung weitergeben. Hosted in Germany."
    : "Share files up to 5 GB securely with end-to-end encryption and no registration. Hosted in Germany.";
  return {
    metadataBase: new URL(origin),
    title,
    description,
    alternates: { canonical: origin },
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: { title, description, type: "website", url: origin, images: [{ url: `${origin}/og.png`, width: 1200, height: 630, alt: language === "de" ? "Sendebude - Sicher Daten weitergeben" : "Sendebude - Share files securely" }] },
    twitter: { card: "summary_large_image", title, description, images: [`${origin}/og.png`] },
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const language = preferredUiLanguage((await headers()).get("accept-language"));
  return <html lang={language}><body>{children}</body></html>;
}
