import { TransferPanel } from "./transfer-panel";

export default function Home() {
  return (
    <main className="compact-page">
      <section className="hero-shell compact-hero">
        <div className="ambient ambient-one" />
        <div className="ambient ambient-two" />

        <div className="site-header" aria-hidden="true" />

        <div className="hero-grid compact-grid">
          <div className="hero-copy compact-copy">
            <h1>
              Hochladen.
              <span>Link teilen.</span>
            </h1>
            <p className="hero-lead">100% free. Ohne Registrierung. max. 15 GB.</p>
          </div>
          <TransferPanel />
        </div>
      </section>
    </main>
  );
}
