import Link from "next/link";
import { TransferPanel } from "./transfer-panel";

export default function Home() {
  return (
    <main className="compact-page">
      <section className="hero-shell compact-hero">
        <div className="ambient ambient-one" />
        <div className="ambient ambient-two" />

        <header className="site-header">
          <Link className="brand" href="/" aria-label="Share Startseite">
            <span className="brand-mark">b</span>
            <span className="brand-name">share.</span>
          </Link>
        </header>

        <div className="hero-grid compact-grid">
          <div className="hero-copy compact-copy">
            <p className="eyebrow">Dateien teilen</p>
            <h1>
              Hochladen.
              <span>Link teilen.</span>
            </h1>
            <p className="hero-lead">max. 15GB. ohne registrierung. 100% free.</p>
          </div>
          <TransferPanel />
        </div>
      </section>
    </main>
  );
}
