import type { Metadata } from "next";
import { headers } from "next/headers";
import { SITE_ORIGIN } from "@/lib/site-metadata";
import { preferredUiLanguage } from "@/lib/ui-language";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  applicationName: "Sendebude",
  icons: { icon: "/favicon.svg?v=3", shortcut: "/favicon.svg?v=3" },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const language = preferredUiLanguage((await headers()).get("accept-language"));
  return <html lang={language}><body>{children}</body></html>;
}
