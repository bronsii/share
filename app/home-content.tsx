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
    lead: "Kostenlos. Ohne Registrierung. Bis zu 5\u00a0GB.",
    hosting: "Hosted in Germany.",
    languageLabel: "Sprache wählen",
    flagLabel: "Deutschlandflagge",
    homeLabel: "Startseite von sendebude.de",
    adminLabel: "Private Verwaltung öffnen",
  },
  en: {
    firstLine: "data.",
    secondLine: "secure.",
    thirdLine: "share.",
    lead: "Free. No registration. Up to 5\u00a0GB.",
    hosting: "Hosted in Germany.",
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
              <span>{text.thirdLine}</span>
            </h1>
            <p className="hero-lead"><span>{text.lead}</span><span><i className="inline-germany-flag" role="img" aria-label={text.flagLabel} />{text.hosting}</span></p>
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
