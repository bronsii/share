"use client";

import Link from "next/link";
import { ArrowLeft, FileText, Mail, MapPin } from "lucide-react";
import type { UiLanguage } from "@/lib/ui-language";
import { useUiLanguage } from "@/lib/use-ui-language";

const imprintCopy = {
  de: {
    back: "Zurück zu Sendebude",
    languageLabel: "Sprache wählen",
    kicker: "Anbieterkennzeichnung",
    title: "Impressum",
    legalBasis: "Angaben gemäß § 5 DDG und § 18 MStV",
    addressTitle: "Anbieter",
    contactTitle: "Kontakt",
  },
  en: {
    back: "Back to Sendebude",
    languageLabel: "Choose language",
    kicker: "Provider information",
    title: "Legal notice",
    legalBasis: "Information pursuant to § 5 DDG and § 18 MStV",
    addressTitle: "Provider",
    contactTitle: "Contact",
  },
} as const;

export function ImprintContent({ initialLanguage }: { initialLanguage: UiLanguage }) {
  const [language, changeLanguage] = useUiLanguage(initialLanguage);
  const copy = imprintCopy[language];

  return (
    <main className="privacy-page">
      <header className="privacy-header">
        <Link className="privacy-back" href="/"><ArrowLeft size={16} aria-hidden="true" />{copy.back}</Link>
        <div className="language-switch" role="group" aria-label={copy.languageLabel}>
          <button type="button" className={language === "de" ? "is-active" : ""} aria-pressed={language === "de"} onClick={() => changeLanguage("de")}>DE</button>
          <button type="button" className={language === "en" ? "is-active" : ""} aria-pressed={language === "en"} onClick={() => changeLanguage("en")}>EN</button>
        </div>
      </header>

      <section className="privacy-shell">
        <div className="privacy-title-icon"><FileText size={27} aria-hidden="true" /></div>
        <p className="privacy-kicker">{copy.kicker}</p>
        <h1>{copy.title}</h1>
        <p className="privacy-intro">{copy.legalBasis}</p>

        <div className="privacy-grid">
          <article className="privacy-card">
            <div className="privacy-card-icon"><MapPin size={20} aria-hidden="true" /></div>
            <h2>{copy.addressTitle}</h2>
            <p>[imprint name removed]<br />[imprint address removed]<br />[imprint locality removed]<br />Deutschland</p>
          </article>
          <article className="privacy-card">
            <div className="privacy-card-icon"><Mail size={20} aria-hidden="true" /></div>
            <h2>{copy.contactTitle}</h2>
            <p><a className="imprint-email" href="mailto:[imprint email removed]">[imprint email removed]</a></p>
          </article>
        </div>
      </section>
    </main>
  );
}
