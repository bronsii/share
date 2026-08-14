"use client";

import { LockKeyhole, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { UiLanguage } from "@/lib/ui-language";
import { useUiLanguage } from "@/lib/use-ui-language";
import { TransferPanel } from "./transfer-panel";

const heroCopy = {
  de: {
    firstLine: "daten.",
    secondLine: "sicher.",
    thirdLine: "teilen.",
    features: [
      { label: "Kostenlos" },
      { label: "Automatische Löschung" },
      { label: "Bis zu 5\u00a0GB" },
      { label: "Ende-zu-Ende verschlüsselt" },
      { label: "Open Source geplant" },
      { label: "Keine Werbe- oder Analyse-Tracker" },
      { label: "Ohne Registrierung" },
      { label: "Hosted in Germany", flag: true },
    ],
    languageLabel: "Sprache wählen",
    flagLabel: "Deutschlandflagge",
    homeLabel: "Startseite von sendebude.de",
    adminLabel: "Private Verwaltung öffnen",
  },
  en: {
    firstLine: "data.",
    secondLine: "secure.",
    thirdLine: "share.",
    features: [
      { label: "Free" },
      { label: "Automatic deletion" },
      { label: "Up to 5\u00a0GB" },
      { label: "End-to-end encrypted" },
      { label: "Open source planned" },
      { label: "No advertising or analytics trackers" },
      { label: "No registration" },
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

  return (
    <main className="compact-page">
      <section className="hero-shell compact-hero">
        <div className="ambient ambient-one" />
        <div className="ambient ambient-two" />

        <header className="site-header">
          <Link className="site-domain" href="/" aria-label={text.homeLabel}>
            <span className="site-domain-mark"><ShieldCheck size={15} aria-hidden="true" /></span>
            <span>sendebude.de</span>
          </Link>
          <div className="language-switch" role="group" aria-label={text.languageLabel}>
            <button type="button" className={language === "de" ? "is-active" : ""} aria-pressed={language === "de"} onClick={() => changeLanguage("de")}>DE</button>
            <button type="button" className={language === "en" ? "is-active" : ""} aria-pressed={language === "en"} onClick={() => changeLanguage("en")}>EN</button>
          </div>
        </header>

        <div className="hero-grid compact-grid">
          <div className="hero-copy compact-copy">
            <h1 className="secure-heading">
              {text.firstLine}
              <span>{text.secondLine}</span>
              <span className="hero-third-line">{text.thirdLine}</span>
            </h1>
            <ul className="hero-features">
              {text.features.map((feature) => (
                <li key={feature.label}>
                  <i className="feature-dot" aria-hidden="true" />
                  <span>{"flag" in feature && feature.flag ? <i className="inline-germany-flag" role="img" aria-label={text.flagLabel} /> : null}{feature.label}</span>
                </li>
              ))}
            </ul>
          </div>
          <TransferPanel language={language} />
        </div>
      </section>
      <a className="admin-lock-link" href="/verwaltung" aria-label={text.adminLabel} title={language === "de" ? "Verwaltung" : "Administration"}>
        <LockKeyhole size={14} />
      </a>
    </main>
  );
}
