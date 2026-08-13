import { headers } from "next/headers";
import { preferredUiLanguage } from "@/lib/ui-language";
import { HomeContent } from "./home-content";

export default async function Home() {
  const initialLanguage = preferredUiLanguage((await headers()).get("accept-language"));
  return <HomeContent initialLanguage={initialLanguage} />;
}
