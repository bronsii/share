import type { Metadata } from "next";
import type { UiLanguage } from "@/lib/ui-language";

export const SITE_ORIGIN = "https://sendebude.de";

type PageMetadataOptions = {
  language: UiLanguage;
  pathname: "/" | "/datenschutz" | "/impressum" | "/nutzungsbedingungen";
  title: string;
  description: string;
};

export function publicPageMetadata({
  language,
  pathname,
  title,
  description,
}: PageMetadataOptions): Metadata {
  const canonical = pathname === "/" ? SITE_ORIGIN : `${SITE_ORIGIN}${pathname}`;
  const image = `${SITE_ORIGIN}/og.png`;

  return {
    title,
    description,
    alternates: { canonical },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
    openGraph: {
      type: "website",
      siteName: "Sendebude",
      locale: language === "de" ? "de_DE" : "en_US",
      url: canonical,
      title,
      description,
      images: [{ url: image, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

export function privatePageMetadata({
  language,
  title,
  description,
}: Omit<PageMetadataOptions, "pathname">): Metadata {
  const privateRobots = {
    index: false,
    follow: false,
    noarchive: true,
    nosnippet: true,
    noimageindex: true,
    nocache: true,
  } as const;

  return {
    title,
    description,
    robots: {
      ...privateRobots,
      googleBot: privateRobots,
    },
    openGraph: {
      type: "website",
      siteName: "Sendebude",
      locale: language === "de" ? "de_DE" : "en_US",
      title,
      description,
      images: [{ url: `${SITE_ORIGIN}/og.png`, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${SITE_ORIGIN}/og.png`],
    },
  };
}
