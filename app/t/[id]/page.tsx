import Link from "next/link";
import { ArrowLeft, Clock3, Download, FileArchive, FileImage, FileText, ShieldCheck } from "lucide-react";
import { getTransfer, transferIsExpired } from "@/lib/storage";
import { TransferViewTracker } from "./view-tracker";

export const dynamic = "force-dynamic";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
}

function iconFor(name: string, type: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  if (type.startsWith("image/")) return <FileImage size={22} />;
  if (["zip", "rar", "7z", "tar", "gz"].includes(extension ?? "")) return <FileArchive size={22} />;
  return <FileText size={22} />;
}

export default async function TransferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const transfer = await getTransfer(id);
  const expired = transfer ? transferIsExpired(transfer) : false;
  if (!transfer || expired) {
    return (
      <main className="download-page">
        <div className="download-ambient" />
        <section className="empty-transfer-card">
          <div className="empty-clock"><Clock3 size={28} /></div>
          <h1>{expired ? "Dieser Link ist abgelaufen." : "Link nicht gefunden."}</h1>
          <p>{expired ? "Die Laufzeit dieser Übertragung ist beendet. Bitte die sendende Person um einen neuen Link." : "Prüfe den Link oder bitte die sendende Person, ihn noch einmal zu teilen."}</p>
          <Link className="primary-button as-link" href="/"><ArrowLeft size={18} /> Zur Startseite</Link>
        </section>
      </main>
    );
  }
  const totalSize = transfer.files.reduce((sum, file) => sum + file.size, 0);
  const expires = new Intl.DateTimeFormat("de-DE", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Berlin" }).format(new Date(transfer.expiresAt));
  return (
    <main className="download-page">
      <TransferViewTracker id={transfer.id} />
      <div className="download-ambient" />
      <header className="download-header">
        <Link className="back-link" href="/"><ArrowLeft size={16} /> Zur Startseite</Link>
      </header>
      <section className="download-card">
        <div className="download-title-row">
          <div><p className="panel-kicker">Für dich freigegeben</p><h1>{transfer.files.length === 1 ? "Eine Datei wartet auf dich." : `${transfer.files.length} Dateien warten auf dich.`}</h1></div>
          <div className="download-total"><span>Gesamt</span><strong>{formatBytes(totalSize)}</strong></div>
        </div>
        {transfer.message && <blockquote className="sender-message">„{transfer.message}“</blockquote>}
        {transfer.files.length > 1 && (
          <a className="download-all-button" href={`/api/transfers/${transfer.id}/download-all`}>
            <FileArchive size={21} aria-hidden="true" />
            <span><strong>Alle Dateien herunterladen</strong><small>Gemeinsam als ZIP-Datei</small></span>
            <Download size={19} aria-hidden="true" />
          </a>
        )}
        <div className="download-file-list">
          {transfer.files.map((file) => (
            <div className="download-file" key={file.id}>
              <span className="download-file-icon" aria-hidden="true">{iconFor(file.name, file.type)}</span>
              <span className="download-file-name">{file.name}</span>
              <span className="download-file-size">{formatBytes(file.size)}</span>
              <a href={`/api/transfers/${transfer.id}/${file.id}`} aria-label={`${file.name} herunterladen`}><Download size={19} /></a>
            </div>
          ))}
        </div>
        <div className="download-expiry"><ShieldCheck size={18} /><span>Dieser Link ist gültig bis <strong>{expires} Uhr</strong>.</span></div>
      </section>
    </main>
  );
}
