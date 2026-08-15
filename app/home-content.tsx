"use client";

import { LockKeyhole, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { UiLanguage } from "@/lib/ui-language";
import { useUiLanguage } from "@/lib/use-ui-language";
import { LanguageSwitch } from "./language-switch";
import { TransferPanel } from "./transfer-panel";

const heroCopy = {
  de: {
    firstLine: "dateien.",
    secondLine: "sicher.",
    thirdLine: "teilen.",
    lead: "Dateien hochladen und per Link weitergeben.",
    features: [
      { label: "Kostenlos" },
      { label: "Automatische Löschung" },
      { label: "Bis zu 5\u00a0GB" },
      { label: "Ende-zu-Ende verschlüsselt" },
      { label: "Ohne Registrierung" },
      { label: "Keine Werbe- oder Analyse-Tracker" },
      { label: "Open Source", href: "https://github.com/bronsii/share" },
      { label: "Hosted in Germany", flag: true },
    ],
    languageLabel: "Sprache wählen",
    flagLabel: "Deutschlandflagge",
    homeLabel: "Startseite von sendebude.de",
    adminLabel: "Private Verwaltung öffnen",
  },
  en: {
    firstLine: "files.",
    secondLine: "secure.",
    thirdLine: "share.",
    lead: "Upload files and share them by link.",
    features: [
      { label: "Free" },
      { label: "Automatic deletion" },
      { label: "Up to 5\u00a0GB" },
      { label: "End-to-end encrypted" },
      { label: "No registration" },
      { label: "No advertising or analytics trackers" },
      { label: "Open source", href: "https://github.com/bronsii/share" },
      { label: "Hosted in Germany", flag: true },
    ],
    languageLabel: "Choose language",
    flagLabel: "Flag of Germany",
    homeLabel: "sendebude.de home page",
    adminLabel: "Open private administration",
  },
} as const;

export function HomeContent({ initialLanguage }: { initialLanguage: UiLanguage }) {
  const [language, changeLanguage] = useUiLanguage(initialLanguage);
  const text = heroCopy[language];
  const renderFeatures = (placement: "primary" | "mobile") => (
    <ul className={`hero-features hero-features-${placement}`}>
      {text.features.map((feature) => (
        <li key={feature.label}>
          <i className="feature-dot" aria-hidden="true" />
          <span className={"flag" in feature && feature.flag ? "feature-with-flag" : undefined}>
            {"href" in feature && feature.href ? (
              <a href={feature.href} target="_blank" rel="noreferrer">{feature.label}</a>
            ) : feature.label}
            {"flag" in feature && feature.flag ? <i className="inline-germany-flag" role="img" aria-label={text.flagLabel} /> : null}
          </span>
        </li>
      ))}
    </ul>
  );

  return (
    <main>
      <section className="hero-shell compact-hero">
        <header className="site-header">
          <Link className="site-domain" href="/" aria-label={text.homeLabel}>
            <span className="site-domain-mark"><ShieldCheck size={15} aria-hidden="true" /></span>
            <span>sendebude.de</span>
          </Link>
          <LanguageSwitch language={language} label={text.languageLabel} onChange={changeLanguage} />
        </header>

        <div className="hero-grid compact-grid">
          <div className="hero-copy compact-copy">
            <h1 className={`secure-heading secure-heading-${language}`}>
              {text.firstLine}{" "}
              <span>{text.secondLine}</span>{" "}
              <span className="hero-third-line">{text.thirdLine}</span>
            </h1>
            <p className="hero-lead">{text.lead}</p>
            {renderFeatures("primary")}
          </div>
          <TransferPanel language={language} />
          {renderFeatures("mobile")}
        </div>
      </section>
      <a className="admin-lock-link" href="/verwaltung" aria-label={text.adminLabel} title={language === "de" ? "Verwaltung" : "Administration"}>
        <LockKeyhole size={14} />
      </a>
    </main>
  );
}
