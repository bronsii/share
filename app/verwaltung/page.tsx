import type { Metadata } from "next";
import { headers } from "next/headers";
import { privatePageMetadata } from "@/lib/site-metadata";
import { preferredUiLanguage } from "@/lib/ui-language";
import { AdminBackLink, AdminPanel } from "./admin-panel";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const language = preferredUiLanguage((await headers()).get("accept-language"));
  const title = language === "de" ? "Verwaltung | Sendebude" : "Administration | Sendebude";
  const description = language === "de" ? "Private Verwaltung von Sendebude." : "Private Sendebude administration.";
  return privatePageMetadata({ language, title, description });
}

export default function AdminPage() {
  return (
    <main className="admin-page">
      <AdminBackLink />
      <AdminPanel />
    </main>
  );
}
