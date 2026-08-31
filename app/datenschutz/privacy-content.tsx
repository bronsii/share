"use client";

import Link from "next/link";
import { ArrowLeft, Code2, EyeOff, LockKeyhole, Server, ShieldCheck, Trash2 } from "lucide-react";
import type { UiLanguage } from "@/lib/ui-language";
import { useUiLanguage } from "@/lib/use-ui-language";
import { LanguageSwitch } from "../language-switch";

const privacyCopy = {
  de: {
    back: "Zurück zu Sendebude",
    languageLabel: "Sprache wählen",
    kicker: "Sicherheit & Transparenz",
    title: "Datenschutz",
    intro: "Unsere Intention ist ein einfacher und datensparsamer Dateiversand. Du sollst nachvollziehen können, was mit deinen Daten passiert – ohne Registrierung, Werbung oder Analyse-Tracker.",
    encryptionTitle: "Ende-zu-Ende verschlüsselt",
    encryptionBody: "Dateiinhalte, Dateinamen und Notizen werden bereits in deinem Browser verschlüsselt. Der Schlüssel bleibt im Freigabelink und wird nicht an den Server übertragen. Der Server kann diese Inhalte ohne Schlüssel nicht lesen; zusätzlich fallen die unten genannten Betriebsdaten an.",
    storageTitle: "Speicherung und Löschung",
    storageBody: "Du bestimmst eine Laufzeit von 1, 3 oder 7 Tagen. Nach dem Ablauf entfernt eine regelmäßige Löschroutine die Dateien. Mit dem privaten Löschlink kannst du neue Freigaben vorher löschen. Dafür speichert der Server nur einen Hash der separaten Löschberechtigung; diese selbst wird erst bei einer bestätigten Löschanfrage übertragen. Bereits heruntergeladene Kopien bleiben beim Empfänger. Abgebrochene, unvollständige Uploads werden ebenfalls automatisch bereinigt.",
    germanyTitle: "Hosted in Germany",
    germanyBody: "Die Dateien werden auf unserem Server in Falkenstein, Deutschland, gespeichert. Für die Übertragung wird eine verschlüsselte HTTPS-Verbindung verwendet.",
    visibleTitle: "Technisch sichtbare Daten",
    visibleBody: "Für Betrieb und Missbrauchsschutz verarbeitet der Dienst notwendige technische Daten wie IP-Adresse auf Netzwerkebene, Zeitpunkt, Dateianzahl, Größen, Ablaufdatum sowie Fassung, Sprache und Bestätigungszeitpunkt der beim Upload akzeptierten Nutzungsbedingungen. Die Zustimmungsangaben werden zusammen mit der Übertragung gelöscht. Der Dateiinhalt bleibt verschlüsselt.",
    localTitle: "Keine Werbe-Tracker",
    localBody: "Die Seite verwendet keine Werbe- oder Analyse-Tracker. Der Browser speichert die Sprachauswahl und bei Bedarf tablokale Informationen zur Upload-Wiederaufnahme, einschließlich Schlüsselmaterial und separater Löschberechtigung. QR-Code und Sammel-ZIP entstehen lokal auf deinem Gerät. Bei einer Anmeldung in der Verwaltung kommt ein notwendiges, auf zwei Stunden begrenztes Sitzungscookie hinzu.",
    sourceTitle: "Open Source",
    sourceBody: "Der Quellcode von Sendebude ist öffentlich. Du kannst die Umsetzung, Sicherheitsmaßnahmen und Änderungen jederzeit auf GitHub prüfen.",
    sourceStatus: "Quellcode auf GitHub",
  },
  en: {
    back: "Back to Sendebude",
    languageLabel: "Choose language",
    kicker: "Security & transparency",
    title: "Privacy",
    intro: "Our intention is simple, privacy-friendly file sharing. You should be able to understand what happens to your data — without registration, advertising, or analytics trackers.",
    encryptionTitle: "End-to-end encrypted",
    encryptionBody: "File contents, file names, and notes are encrypted in your browser. The key remains in the share link and is not sent to the server. The server cannot read these contents without the key; the operational data listed below is processed separately.",
    storageTitle: "Storage and deletion",
    storageBody: "You choose a lifetime of 1, 3, or 7 days. A recurring cleanup removes files after expiry. New shares can be deleted earlier using the private deletion link. The server stores only a hash of the separate deletion credential; the credential itself is transmitted only when deletion is confirmed. Previously downloaded copies remain with recipients. Cancelled and incomplete uploads are cleaned up automatically as well.",
    germanyTitle: "Hosted in Germany",
    germanyBody: "Files are stored on our server in Falkenstein, Germany. Transfers use an encrypted HTTPS connection.",
    visibleTitle: "Operational data",
    visibleBody: "For operation and abuse prevention, the service processes necessary technical data such as the IP address at network level, time, file count, sizes, expiry date, and the version, language and confirmation time of the Terms accepted when uploading. The acceptance record is deleted together with the transfer. File contents remain encrypted.",
    localTitle: "No advertising trackers",
    localBody: "The site does not use advertising or analytics trackers. The browser stores your language choice and, when needed, tab-local upload-resume information, including key material and the separate deletion credential. QR codes and combined ZIP archives are created locally on your device. Signing in to the administration area additionally sets a necessary session cookie limited to two hours.",
    sourceTitle: "Open source",
    sourceBody: "Sendebude's source code is public. You can inspect the implementation, security measures, and changes on GitHub at any time.",
    sourceStatus: "Source code on GitHub",
  },
} as const;

export function PrivacyContent({ initialLanguage }: { initialLanguage: UiLanguage }) {
  const [language, changeLanguage] = useUiLanguage(initialLanguage);
  const copy = privacyCopy[language];

  return (
    <main className="privacy-page">
      <header className="privacy-header">
        <Link className="privacy-back" href="/"><ArrowLeft size={16} aria-hidden="true" />{copy.back}</Link>
        <LanguageSwitch language={language} label={copy.languageLabel} onChange={changeLanguage} />
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
            <Link
              className="privacy-status"
              href="https://github.com/bronsii/share"
              target="_blank"
              rel="noreferrer"
            >
              {copy.sourceStatus}
            </Link>
          </article>
        </div>
      </section>
    </main>
  );
}
