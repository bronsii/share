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
  const title = language === "de" ? "Share — Dateien einfach weitergeben" : "Share — Send files with one link";
  const description = language === "de"
    ? "Bilder, Videos und Dokumente hochladen, Freigabelink kopieren und unkompliziert teilen."
    : "Upload images, videos and documents, then share them securely with one link.";
  return {
    metadataBase: new URL(origin),
    title,
    description,
    alternates: { canonical: origin },
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: { title, description, type: "website", url: origin, images: [{ url: `${origin}/og.png`, width: 1200, height: 630, alt: language === "de" ? "Share — Große Dateien. Ein kleiner Link." : "Share — Large files. One small link." }] },
    twitter: { card: "summary_large_image", title, description, images: [`${origin}/og.png`] },
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const language = preferredUiLanguage((await headers()).get("accept-language"));
  return <html lang={language}><body>{children}</body></html>;
}
