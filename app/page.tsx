import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  Clock3,
  FolderUp,
  Link2,
  LockKeyhole,
  Sparkles,
} from "lucide-react";
import { TransferPanel } from "./transfer-panel";

const steps = [
  {
    number: "01",
    title: "Dateien auswählen",
    copy: "Zieh deine Dateien ins Fenster oder wähle sie auf deinem Gerät aus.",
  },
  {
    number: "02",
    title: "Link erstellen",
    copy: "Bestimme die Laufzeit und ergänze auf Wunsch eine persönliche Nachricht.",
  },
  {
    number: "03",
    title: "Sicher teilen",
    copy: "Kopiere den privaten Link und schicke ihn nur an die richtigen Personen.",
  },
];

export default function Home() {
  return (
    <main>
      <section className="hero-shell">
        <div className="ambient ambient-one" />
        <div className="ambient ambient-two" />

        <header className="site-header">
          <Link className="brand" href="/" aria-label="Share Startseite">
            <span className="brand-mark">b</span>
            <span className="brand-name">share.</span>
          </Link>
          <nav className="main-nav" aria-label="Hauptnavigation">
            <a href="#so-gehts">So funktioniert&apos;s</a>
            <a className="external-link" href="https://bronsinger.de">
              bronsinger.de <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          </nav>
        </header>

        <div className="hero-grid">
          <div className="hero-copy">
            <div className="eyebrow">
              <Sparkles size={15} aria-hidden="true" />
              Einfach teilen. Ohne Konto.
            </div>
            <h1>
              Große Dateien.
              <span>Ein kleiner Link.</span>
            </h1>
            <p className="hero-lead">
              Bilder, Videos und Dokumente unkompliziert weitergeben. Hochladen,
              Link kopieren, fertig.
            </p>
            <div className="confidence-list" aria-label="Vorteile">
              <span><Check size={16} aria-hidden="true" /> Ohne Registrierung</span>
              <span><Clock3 size={16} aria-hidden="true" /> Link mit Ablaufdatum</span>
              <span><LockKeyhole size={16} aria-hidden="true" /> Nicht öffentlich gelistet</span>
            </div>
          </div>

          <TransferPanel />
        </div>

        <div className="hero-note" aria-hidden="true">
          <span>sendebude.de</span>
          <span className="hero-note-line" />
          <span>Einfach · direkt · persönlich</span>
        </div>
      </section>

      <section className="how-section" id="so-gehts">
        <div className="section-heading">
          <div>
            <p className="section-kicker">In drei Schritten</p>
            <h2>Teilen darf leicht sein.</h2>
          </div>
          <p>
            Keine Ordnerfreigaben, keine Konten und keine komplizierten
            Berechtigungen. Nur ein Link, der genau so lange funktioniert, wie
            du ihn brauchst.
          </p>
        </div>

        <div className="steps-grid">
          {steps.map((step) => (
            <article className="step-card" key={step.number}>
              <span className="step-number">{step.number}</span>
              <div className="step-icon" aria-hidden="true">
                {step.number === "01" ? <FolderUp size={23} /> : step.number === "02" ? <Link2 size={23} /> : <LockKeyhole size={23} />}
              </div>
              <h3>{step.title}</h3>
              <p>{step.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="site-footer">
        <Link className="footer-brand" href="/">
          <span className="brand-mark brand-mark-small">b</span>
          <span>sendebude.de</span>
        </Link>
        <p>Für Dateien, die ankommen sollen.</p>
        <a href="https://bronsinger.de">
          bronsinger.de <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      </footer>
    </main>
  );
}
