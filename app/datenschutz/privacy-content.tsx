"use client";

import Link from "next/link";
import { ArrowLeft, Code2, EyeOff, LockKeyhole, Server, ShieldCheck, Trash2 } from "lucide-react";
import type { UiLanguage } from "@/lib/ui-language";
import { useUiLanguage } from "@/lib/use-ui-language";

const privacyCopy = {
  de: {
    back: "Zurück zu Share",
    languageLabel: "Sprache wählen",
    kicker: "Sicherheit & Transparenz",
    title: "Datenschutz",
    intro: "Unsere Intention ist ein einfacher und datensparsamer Dateiversand. Du sollst nachvollziehen können, was mit deinen Daten passiert – ohne Registrierung, Werbung oder Analyse-Tracker.",
    encryptionTitle: "Ende-zu-Ende verschlüsselt",
    encryptionBody: "Dateien, Dateinamen und Notizen werden bereits in deinem Browser verschlüsselt. Der Schlüssel bleibt im Freigabelink und wird nicht an den Server übertragen. Der Server speichert nur verschlüsselte Inhalte.",
    storageTitle: "Speicherung und Löschung",
    storageBody: "Du bestimmst eine Laufzeit von 1, 3 oder 7 Tagen. Danach werden die Dateien automatisch gelöscht. Abgebrochene, unvollständige Uploads werden ebenfalls automatisch bereinigt.",
    germanyTitle: "Hosted in Germany",
    germanyBody: "Die Dateien werden auf unserem Server in Falkenstein, Deutschland, gespeichert. Für die Übertragung wird eine verschlüsselte HTTPS-Verbindung verwendet.",
    visibleTitle: "Technisch sichtbare Daten",
    visibleBody: "Für Betrieb und Missbrauchsschutz verarbeitet der Dienst notwendige technische Daten wie IP-Adresse auf Netzwerkebene, Zeitpunkt, Dateianzahl, Größen und Ablaufdatum. Der Dateiinhalt bleibt verschlüsselt.",
    localTitle: "Keine Werbe-Tracker",
    localBody: "Die Seite verwendet keine Werbe- oder Analyse-Tracker. Im Browser werden nur die Sprachauswahl und bei Bedarf Informationen zur Wiederaufnahme eines unterbrochenen Uploads gespeichert.",
    sourceTitle: "Open Source",
    sourceBody: "Offener und überprüfbarer Quellcode gehört zur Intention dieses Projekts. Das GitHub-Repository ist momentan noch privat und wird erst nach seiner öffentlichen Freigabe hier verlinkt.",
    sourceStatus: "Öffentliche Freigabe ausstehend",
  },
  en: {
    back: "Back to Share",
    languageLabel: "Choose language",
    kicker: "Security & transparency",
    title: "Privacy",
    intro: "Our intention is simple, privacy-friendly file sharing. You should be able to understand what happens to your data — without registration, advertising, or analytics trackers.",
    encryptionTitle: "End-to-end encrypted",
    encryptionBody: "Files, file names, and notes are encrypted in your browser. The key remains in the share link and is not sent to the server. The server stores encrypted content only.",
    storageTitle: "Storage and deletion",
    storageBody: "You choose a lifetime of 1, 3, or 7 days. Files are automatically deleted afterwards. Cancelled and incomplete uploads are cleaned up automatically as well.",
    germanyTitle: "Hosted in Germany",
    germanyBody: "Files are stored on our server in Falkenstein, Germany. Transfers use an encrypted HTTPS connection.",
    visibleTitle: "Operational data",
    visibleBody: "For operation and abuse prevention, the service processes necessary technical data such as the IP address at network level, time, file count, sizes, and expiry date. File contents remain encrypted.",
    localTitle: "No advertising trackers",
    localBody: "The site does not use advertising or analytics trackers. The browser stores only your language choice and, when needed, information required to resume an interrupted upload.",
    sourceTitle: "Open source",
    sourceBody: "Open and auditable source code is part of this project's intention. The GitHub repository is currently private and will be linked here after its public release.",
    sourceStatus: "Public release pending",
  },
} as const;

export function PrivacyContent({ initialLanguage }: { initialLanguage: UiLanguage }) {
  const [language, changeLanguage] = useUiLanguage(initialLanguage);
  const copy = privacyCopy[language];

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
        <div className="privacy-title-icon"><ShieldCheck size={27} aria-hidden="true" /></div>
        <p className="privacy-kicker">{copy.kicker}</p>
        <h1>{copy.title}</h1>
        <p className="privacy-intro">{copy.intro}</p>

        <div className="privacy-grid">
          <article className="privacy-card">
            <div className="privacy-card-icon"><LockKeyhole size={20} aria-hidden="true" /></div>
            <h2>{copy.encryptionTitle}</h2>
            <p>{copy.encryptionBody}</p>
          </article>
          <article className="privacy-card">
            <div className="privacy-card-icon"><Trash2 size={20} aria-hidden="true" /></div>
            <h2>{copy.storageTitle}</h2>
            <p>{copy.storageBody}</p>
          </article>
          <article className="privacy-card">
            <div className="privacy-card-icon"><Server size={20} aria-hidden="true" /></div>
            <h2>{copy.germanyTitle}</h2>
            <p>{copy.germanyBody}</p>
          </article>
          <article className="privacy-card">
            <div className="privacy-card-icon"><EyeOff size={20} aria-hidden="true" /></div>
            <h2>{copy.visibleTitle}</h2>
            <p>{copy.visibleBody}</p>
          </article>
          <article className="privacy-card">
            <div className="privacy-card-icon"><ShieldCheck size={20} aria-hidden="true" /></div>
            <h2>{copy.localTitle}</h2>
            <p>{copy.localBody}</p>
          </article>
          <article className="privacy-card">
            <div className="privacy-card-icon"><Code2 size={20} aria-hidden="true" /></div>
            <h2>{copy.sourceTitle}</h2>
            <p>{copy.sourceBody}</p>
            <span className="privacy-status">{copy.sourceStatus}</span>
          </article>
        </div>
      </section>
    </main>
  );
}
