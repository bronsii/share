"use client";

import { useState } from "react";
import { LockKeyhole } from "lucide-react";
import { Language, TransferPanel } from "./transfer-panel";

const heroCopy = {
  de: {
    firstLine: "Upload.",
    secondLine: "Share.",
    lead: "Kostenlos. Ohne Registrierung. Bis zu 5\u00a0GB.",
    hosting: "Hosted in Germany.",
    languageLabel: "Sprache wählen",
  },
  en: {
    firstLine: "Upload.",
    secondLine: "Share.",
    lead: "Free. No registration. Up to 5\u00a0GB.",
    hosting: "Hosted in Germany.",
    languageLabel: "Choose language",
  },
} as const;

export default function Home() {
  const [language, setLanguage] = useState<Language>("de");
  const text = heroCopy[language];

  function changeLanguage(nextLanguage: Language) {
    setLanguage(nextLanguage);
    document.documentElement.lang = nextLanguage;
  }

  return (
    <main className="compact-page">
      <section className="hero-shell compact-hero">
        <div className="ambient ambient-one" />
        <div className="ambient ambient-two" />

        <header className="site-header">
          <div className="language-switch" role="group" aria-label={text.languageLabel}>
            <button type="button" className={language === "de" ? "is-active" : ""} aria-pressed={language === "de"} onClick={() => changeLanguage("de")}>DE</button>
            <button type="button" className={language === "en" ? "is-active" : ""} aria-pressed={language === "en"} onClick={() => changeLanguage("en")}>EN</button>
          </div>
        </header>

        <div className="hero-grid compact-grid">
          <div className="hero-copy compact-copy">
            <h1 className="is-inline">
              {text.firstLine}
              <span>{text.secondLine}</span>
            </h1>
            <p className="hero-lead"><span>{text.lead}</span><span><i className="inline-germany-flag" role="img" aria-label="Deutschlandflagge" />{text.hosting}</span></p>
          </div>
          <TransferPanel language={language} />
        </div>
      </section>
      <a className="admin-lock-link" href="/verwaltung" aria-label="Private Verwaltung öffnen" title="Verwaltung">
        <LockKeyhole size={14} />
      </a>
    </main>
  );
}
