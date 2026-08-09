"use client";

import { useState } from "react";
import { Language, TransferPanel } from "./transfer-panel";

const heroCopy = {
  de: {
    firstLine: "Hochladen.",
    secondLine: "Link teilen.",
    lead: "100% kostenlos. ohne Registrierung. max. 15 GB.",
    languageLabel: "Sprache wählen",
  },
  en: {
    firstLine: "Upload.",
    secondLine: "Share the link.",
    lead: "100% free. no registration. max. 15 GB.",
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
            <h1>
              {text.firstLine}
              <span>{text.secondLine}</span>
            </h1>
            <p className="hero-lead">{text.lead}</p>
          </div>
          <TransferPanel language={language} />
        </div>
      </section>
    </main>
  );
}
