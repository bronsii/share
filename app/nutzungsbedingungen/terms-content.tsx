"use client";

import Link from "next/link";
import { ArrowLeft, ScrollText } from "lucide-react";
import { TERMS_VERSION } from "@/lib/terms";
import type { UiLanguage } from "@/lib/ui-language";
import { useUiLanguage } from "@/lib/use-ui-language";
import { LanguageSwitch } from "../language-switch";

const termsCopy = {
  de: {
    back: "Zurück zu Sendebude",
    languageLabel: "Sprache wählen",
    kicker: "Regeln für eine faire Nutzung",
    title: "Nutzungsbedingungen",
    intro: "Diese Bedingungen regeln die kostenlose Nutzung von Sendebude. Bitte lies sie vor dem Hochladen aufmerksam durch.",
    effective: "Stand",
    sections: {
      scope: {
        title: "Anbieter, Geltung und Zustimmung",
        body: "Sendebude ist ein kostenloser Dienst des im Impressum genannten Anbieters zur zeitlich begrenzten, Ende-zu-Ende-verschlüsselten Übertragung von Dateien. Diese Bedingungen gelten für Personen, die eine Übertragung erstellen. Vor jedem neuen Upload musst du sie ausdrücklich bestätigen. Der Nutzungsvertrag kommt zustande, wenn du nach der Bestätigung den Upload startest.",
      },
      service: {
        title: "Leistungsumfang",
        body: "Du kannst ohne Registrierung bis zu 20 Dateien mit insgesamt höchstens 5 GiB für 1, 3 oder 7 Tage bereitstellen. Die Laufzeit beginnt mit dem Start des Uploads. Unvollständige Uploads werden nach zwei Stunden ohne Dateiaktivität automatisch bereinigt und können danach nicht fortgesetzt werden. Dateien, Dateinamen und eine optionale Notiz werden im Browser verschlüsselt. Mit dem Ablauf endet der Zugriff; eine regelmäßige Löschroutine entfernt die verschlüsselten Daten kurz danach. Sendebude bietet keine Wiederherstellung an und ist kein dauerhafter Speicher- oder Sicherungsdienst; bewahre deine Originaldateien selbst auf.",
      },
      responsibility: {
        title: "Deine Verantwortung und erforderliche Rechte",
        body: "Du entscheidest, welche Inhalte du hochlädst und wem du den Freigabelink gibst. Du bist für diese Inhalte und ihre Weitergabe verantwortlich. Du darfst nur Dateien übertragen, die du rechtmäßig speichern und weitergeben darfst und für die du alle erforderlichen Rechte oder Einwilligungen besitzt. Du räumst dem Anbieter nur die Rechte ein, die zur vorübergehenden technischen Speicherung und Übermittlung der verschlüsselten Daten erforderlich sind. Der Anbieter macht sich die Inhalte nicht zu eigen.",
      },
      prohibited: {
        title: "Verbotene Nutzung",
        intro: "Insbesondere untersagt sind:",
        items: [
          "rechtswidrige Inhalte und Inhalte, die Urheber-, Marken-, Persönlichkeits-, Datenschutz- oder sonstige Rechte Dritter verletzen;",
          "Darstellungen sexuellen Missbrauchs von Kindern, terroristische Propaganda, volksverhetzende oder andere strafbare Inhalte;",
          "Drohungen, Betrug, Phishing, Schadsoftware oder Dateien zur Vorbereitung von Angriffen;",
          "personenbezogene oder vertrauliche Daten, wenn du zu deren Weitergabe nicht berechtigt bist;",
          "automatisierter Missbrauch sowie das Umgehen von Sicherheits-, Größen-, Speicher- oder Nutzungslimits.",
        ],
        outro: "Die Aufzählung ist nicht abschließend. Maßgeblich sind das geltende Recht und diese Bedingungen.",
      },
      link: {
        title: "Freigabelink und Verschlüsselung",
        body: "Der vollständige Freigabelink enthält hinter dem Zeichen # den Entschlüsselungsschlüssel. Jeder mit diesem vollständigen Link kann die Dateien bis zum Ablauf abrufen. Behandle ihn deshalb wie ein Geheimnis und teile ihn nur mit den vorgesehenen Empfängern. Beim Upload und Download wird der Schlüssel nicht an den Anwendungsserver übertragen oder dort gespeichert. Sendebude bietet keine Wiederherstellung verlorener Schlüssel oder abgelaufener Dateien an.",
      },
      moderation: {
        title: "Prüfung, Beschränkung und Löschung",
        body: "Wegen der Ende-zu-Ende-Verschlüsselung findet keine vorsorgliche oder automatisierte Prüfung von Dateiinhalten statt. Im Rahmen der Inhaltsmoderation werden automatisch nur technische Prüfungen, Rate-Limits und die zeitgesteuerte Bereinigung angewendet. Der Anbieter kann eine konkret bezeichnete Übertragung vollständig löschen, wenn eine hinreichend begründete Meldung, eine behördliche oder gerichtliche Anordnung, ein Verstoß gegen diese Bedingungen, ein Sicherheitsrisiko, ein akutes Betriebs- oder Speicherrisiko oder missbräuchliches Verhalten vorliegt. Maßnahmen werden sorgfältig, objektiv und verhältnismäßig geprüft. Soweit elektronische Kontaktdaten bekannt sind und keine gesetzlichen Gründe entgegenstehen, wird die betroffene Person über Maßnahme, Grund und mögliche Rechtsbehelfe informiert.",
      },
      report: {
        title: "Rechtswidrige Inhalte melden",
        body: "Mutmaßlich rechtswidrige Inhalte kannst du elektronisch an die unten genannte Kontaktstelle melden. Die Meldung sollte folgende Angaben enthalten:",
        items: [
          "die genaue Transfer-URL oder Transfer-ID ohne den geheimen Schlüsselteil nach #;",
          "eine nachvollziehbare Begründung, warum der Inhalt rechtswidrig sein soll;",
          "deinen Namen und deine E-Mail-Adresse; bei Meldungen zu mutmaßlichem sexuellem Missbrauch oder sexueller Ausbeutung von Kindern sind diese Angaben nicht erforderlich;",
          "eine Erklärung, dass du in gutem Glauben davon überzeugt bist, dass die Angaben und Behauptungen der Meldung richtig und vollständig sind.",
        ],
        process: "Der Eingang wird bestätigt. Die Meldung wird zeitnah und sorgfältig geprüft; die angegebene Kontaktadresse erhält eine Mitteilung über die Entscheidung und mögliche Rechtsbehelfe.",
        appeal: "Gegen eine Entscheidung kannst du über dieselbe Kontaktstelle kostenlos Einwand erheben. Der Einwand wird erneut manuell, sorgfältig und objektiv geprüft. Bereits gelöschte Daten können dabei nicht wiederhergestellt werden.",
        contact: "Zentrale elektronische Kontaktstelle für Nutzer und Meldungen",
        subject: "Meldung rechtswidriger Inhalte bei Sendebude",
        languages: "Kommunikationssprachen: Deutsch und Englisch.",
      },
      availability: {
        title: "Verfügbarkeit und Änderungen des Dienstes",
        body: "Der Anbieter bemüht sich um einen sicheren und zuverlässigen Betrieb, garantiert aber keine jederzeit unterbrechungs- oder fehlerfreie Verfügbarkeit. Wartung, technische Störungen, Sicherheitsmaßnahmen, Speichermangel oder Ereignisse außerhalb des Einflussbereichs können den Dienst einschränken. Änderungen oder eine Einstellung betreffen grundsätzlich nur zukünftig angelegte Übertragungen. Bestehende Übertragungen bleiben bis zum gewählten Ablauf verfügbar, soweit nicht ein Grund nach Abschnitt 6, eine gesetzliche Anordnung oder eine technisch unvermeidbare Störung entgegensteht. Zwingende gesetzliche Rechte bleiben unberührt.",
      },
      liability: {
        title: "Haftung",
        paragraphs: [
          "Für die von Nutzern bereitgestellten Inhalte gelten die gesetzlichen Regelungen zur Verantwortlichkeit von Hostingdiensten. Die Verantwortung der Nutzer für ihre Inhalte und die gesetzlichen Pflichten des Anbieters bleiben unberührt.",
          "Der Anbieter haftet unbeschränkt bei Vorsatz und grober Fahrlässigkeit, bei schuldhafter Verletzung von Leben, Körper oder Gesundheit sowie in allen Fällen zwingender gesetzlicher Haftung.",
          "Bei leicht fahrlässiger Verletzung einer wesentlichen Vertragspflicht ist die Haftung auf den vorhersehbaren, vertragstypischen Schaden begrenzt. Im Übrigen ist die Haftung für leicht fahrlässig verursachte Schäden ausgeschlossen, soweit dies gesetzlich zulässig ist.",
          "Wesentliche Vertragspflichten sind Pflichten, deren Erfüllung die ordnungsgemäße Durchführung des Vertrags überhaupt erst ermöglicht und auf deren Einhaltung Nutzer regelmäßig vertrauen dürfen.",
        ],
      },
      minors: {
        title: "Minderjährige",
        body: "Minderjährige dürfen Sendebude nur nutzen, wenn die erforderliche Einwilligung ihrer gesetzlichen Vertretung vorliegt.",
      },
      privacy: {
        title: "Datenschutz",
        body: "Informationen über die Verarbeitung personenbezogener und technischer Daten findest du in den separaten Datenschutzhinweisen. Ihre Kenntnisnahme ist keine datenschutzrechtliche Einwilligung.",
      },
      changes: {
        title: "Änderungen und anwendbares Recht",
        body: "Wesentliche Änderungen dieser Bedingungen werden auf der Website deutlich bekannt gemacht und gelten für zukünftige Uploads erst nach erneuter Bestätigung. Es gilt deutsches Recht. Zwingende Verbraucherschutzvorschriften des Staates, in dem ein Verbraucher seinen gewöhnlichen Aufenthalt hat, bleiben unberührt. Für Gerichtsstände gelten die gesetzlichen Vorschriften.",
      },
    },
    privacyLink: "Datenschutzhinweise",
    imprintLink: "Impressum",
  },
  en: {
    back: "Back to Sendebude",
    languageLabel: "Choose language",
    kicker: "Rules for fair use",
    title: "Terms of Use",
    intro: "These terms govern the free use of Sendebude. Please read them carefully before uploading files.",
    effective: "Effective",
    sections: {
      scope: {
        title: "Provider, scope and acceptance",
        body: "Sendebude is a free service operated by the provider identified in the legal notice. It enables temporary, end-to-end encrypted file transfers. These terms apply to people creating a transfer. You must expressly accept them before every new upload. The agreement is concluded when you start the upload after confirming acceptance.",
      },
      service: {
        title: "Service scope",
        body: "Without registering, you can provide up to 20 files with a combined size of no more than 5 GiB for 1, 3 or 7 days. The lifetime begins when the upload starts. Incomplete uploads are cleaned up automatically after two hours without file activity and cannot then be resumed. Files, file names and an optional note are encrypted in the browser. Access ends on expiry; a recurring cleanup removes the encrypted data shortly afterwards. Sendebude does not provide recovery and is not a permanent storage or backup service; you must retain your original files.",
      },
      responsibility: {
        title: "Your responsibility and required rights",
        body: "You decide which content you upload and who receives the share link. You are responsible for that content and its disclosure. You may transfer only files that you may lawfully store and share and for which you hold all required rights or permissions. You grant the provider only the rights necessary for the temporary technical storage and delivery of the encrypted data. The provider does not adopt user content as its own.",
      },
      prohibited: {
        title: "Prohibited use",
        intro: "In particular, you must not transfer:",
        items: [
          "unlawful content or content infringing copyright, trade marks, privacy, data-protection or other third-party rights;",
          "child sexual abuse material, terrorist propaganda, unlawful incitement or other criminal content;",
          "threats, fraud, phishing, malicious software or files intended to prepare attacks;",
          "personal or confidential data when you are not authorised to disclose it;",
          "automated abuse or attempts to circumvent security, size, storage or usage limits.",
        ],
        outro: "This list is not exhaustive. Applicable law and these terms remain decisive.",
      },
      link: {
        title: "Share link and encryption",
        body: "The complete share link contains the decryption key after the # character. Anyone with the complete link can access the files until expiry. Treat it as a secret and share it only with the intended recipients. During uploads and downloads, the key is neither sent to nor stored by the application server. Sendebude does not provide recovery for lost keys or expired files.",
      },
      moderation: {
        title: "Review, restriction and removal",
        body: "Because transfers are end-to-end encrypted, file contents are not proactively or automatically inspected. For content moderation, only technical validation, rate limits and scheduled cleanup are applied automatically. The provider may completely remove a specifically identified transfer following a sufficiently substantiated notice, an official or judicial order, a breach of these terms, a security risk, an acute operational or storage risk, or abusive conduct. Measures are reviewed carefully, objectively and proportionately. Where electronic contact details are known and no legal restriction applies, the affected person will be informed of the measure, its reason and available remedies.",
      },
      report: {
        title: "Reporting illegal content",
        body: "You can report suspected illegal content electronically to the contact point below. A report should include:",
        items: [
          "the exact transfer URL or transfer ID without the secret key fragment after #;",
          "a substantiated explanation of why the content is considered illegal;",
          "your name and email address; these details are not required for reports concerning suspected child sexual abuse or sexual exploitation;",
          "a statement that you believe in good faith that the information and allegations in the report are accurate and complete.",
        ],
        process: "Receipt will be acknowledged. The report will be reviewed promptly and carefully; the supplied contact address will be informed of the decision and available remedies.",
        appeal: "You may challenge a decision free of charge through the same contact point. The challenge will be reviewed again manually, carefully and objectively. Data already deleted cannot be restored through this process.",
        contact: "Central electronic contact point for users and notices",
        subject: "Report of illegal content on Sendebude",
        languages: "Communication languages: German and English.",
      },
      availability: {
        title: "Availability and service changes",
        body: "The provider aims to operate the service securely and reliably but does not guarantee uninterrupted or error-free availability. Maintenance, technical failures, security measures, storage shortages or events outside the provider's control may restrict the service. Changes or discontinuation will generally affect only transfers created in the future. Existing transfers remain available until their selected expiry unless a reason under section 6, a legal order or a technically unavoidable disruption prevents this. Mandatory statutory rights remain unaffected.",
      },
      liability: {
        title: "Liability",
        paragraphs: [
          "Statutory rules governing the responsibility of hosting services apply to content supplied by users. User responsibility for content and the provider's statutory duties remain unaffected.",
          "The provider has unlimited liability for intent and gross negligence, culpable injury to life, body or health, and wherever liability is mandatory by law.",
          "For a slightly negligent breach of an essential contractual duty, liability is limited to the foreseeable damage typical of the contract. Liability for other damage caused by slight negligence is excluded to the extent permitted by law.",
          "Essential contractual duties are duties whose performance makes the proper execution of the agreement possible in the first place and on whose fulfilment users may normally rely.",
        ],
      },
      minors: {
        title: "Minors",
        body: "Minors may use Sendebude only with the required prior consent of their legal representative.",
      },
      privacy: {
        title: "Privacy",
        body: "Information about the processing of personal and technical data is provided in the separate Privacy Notice. Acknowledging that notice is not consent to data processing.",
      },
      changes: {
        title: "Changes and governing law",
        body: "Material changes to these terms will be clearly announced on the website and will apply to future uploads only after renewed acceptance. German law applies. Mandatory consumer-protection rules of the country in which a consumer habitually resides remain unaffected. Statutory rules determine the competent courts.",
      },
    },
    privacyLink: "Privacy Notice",
    imprintLink: "Legal notice",
  },
} as const;

export function TermsContent({ initialLanguage, contactEmail }: { initialLanguage: UiLanguage; contactEmail: string }) {
  const [language, changeLanguage] = useUiLanguage(initialLanguage);
  const copy = termsCopy[language];
  const { sections } = copy;
  const reportTemplate = language === "de"
    ? [
        "Transfer-URL oder Transfer-ID (ohne Schlüsselteil nach #):",
        "",
        "Begründung der behaupteten Rechtswidrigkeit:",
        "",
        "Name (nicht erforderlich bei Meldungen zu sexuellem Missbrauch oder sexueller Ausbeutung von Kindern):",
        "",
        "E-Mail-Adresse (in diesen Fällen ebenfalls nicht erforderlich):",
        "",
        "Erklärung: Ich bin in gutem Glauben davon überzeugt, dass die Angaben und Behauptungen dieser Meldung richtig und vollständig sind.",
      ].join("\n")
    : [
        "Transfer URL or transfer ID (without the key fragment after #):",
        "",
        "Reasons why the content is considered illegal:",
        "",
        "Name (not required for reports concerning child sexual abuse or sexual exploitation):",
        "",
        "Email address (also not required in those cases):",
        "",
        "Statement: I believe in good faith that the information and allegations in this report are accurate and complete.",
      ].join("\n");
  const reportHref = `mailto:${contactEmail}?subject=${encodeURIComponent(sections.report.subject)}&body=${encodeURIComponent(reportTemplate)}`;
  const effectiveDate = new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${TERMS_VERSION}T00:00:00Z`));

  return (
    <main className="privacy-page">
      <header className="privacy-header">
        <Link className="privacy-back" href="/"><ArrowLeft size={16} aria-hidden="true" />{copy.back}</Link>
        <LanguageSwitch language={language} label={copy.languageLabel} onChange={changeLanguage} />
      </header>

      <article className="privacy-shell terms-shell">
        <div className="privacy-title-icon"><ScrollText size={27} aria-hidden="true" /></div>
        <p className="privacy-kicker">{copy.kicker}</p>
        <h1>{copy.title}</h1>
        <p className="privacy-intro">{copy.intro}</p>
        <p className="terms-effective">{copy.effective}: {effectiveDate}</p>

        <div className="terms-sections">
          <section className="terms-section"><h2>1. {sections.scope.title}</h2><p>{sections.scope.body}</p></section>
          <section className="terms-section"><h2>2. {sections.service.title}</h2><p>{sections.service.body}</p></section>
          <section className="terms-section"><h2>3. {sections.responsibility.title}</h2><p>{sections.responsibility.body}</p></section>
          <section className="terms-section">
            <h2>4. {sections.prohibited.title}</h2>
            <p>{sections.prohibited.intro}</p>
            <ul>{sections.prohibited.items.map((item) => <li key={item}>{item}</li>)}</ul>
            <p>{sections.prohibited.outro}</p>
          </section>
          <section className="terms-section"><h2>5. {sections.link.title}</h2><p>{sections.link.body}</p></section>
          <section className="terms-section"><h2>6. {sections.moderation.title}</h2><p>{sections.moderation.body}</p></section>
          <section className="terms-section" id="rechtswidrige-inhalte-melden">
            <h2>7. {sections.report.title}</h2>
            <p>{sections.report.body}</p>
            <ul>{sections.report.items.map((item) => <li key={item}>{item}</li>)}</ul>
            <p>{sections.report.process}</p>
            <p>{sections.report.appeal}</p>
            <p className="terms-contact"><strong>{sections.report.contact}:</strong> <a href={reportHref}>{contactEmail}</a><br />{sections.report.languages}</p>
          </section>
          <section className="terms-section"><h2>8. {sections.availability.title}</h2><p>{sections.availability.body}</p></section>
          <section className="terms-section">
            <h2>9. {sections.liability.title}</h2>
            {sections.liability.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </section>
          <section className="terms-section"><h2>10. {sections.minors.title}</h2><p>{sections.minors.body}</p></section>
          <section className="terms-section"><h2>11. {sections.privacy.title}</h2><p>{sections.privacy.body}</p></section>
          <section className="terms-section"><h2>12. {sections.changes.title}</h2><p>{sections.changes.body}</p></section>
        </div>

        <nav className="terms-related" aria-label={language === "de" ? "Weitere rechtliche Informationen" : "Further legal information"}>
          <Link href="/datenschutz">{copy.privacyLink}</Link>
          <Link href="/impressum">{copy.imprintLink}</Link>
        </nav>
      </article>
    </main>
  );
}
