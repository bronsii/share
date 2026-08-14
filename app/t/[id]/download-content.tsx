"use client";

import Link from "next/link";
import { ArrowLeft, Clock3, Download, FileArchive, ShieldCheck } from "lucide-react";
import { FileGlyph } from "@/app/file-glyph";
import { LanguageSwitch } from "@/app/language-switch";
import { formatBytes } from "@/lib/format-bytes";
import type { UiLanguage } from "@/lib/ui-language";
import { useUiLanguage } from "@/lib/use-ui-language";
import { downloadCopy } from "./download-copy";
import { EncryptedTransferPanel } from "./encrypted-transfer-panel";
import { TransferViewTracker } from "./view-tracker";

type PublicFile = { id: string; name: string; size: number; type: string; plaintextSize?: number };
type PublicTransfer = {
  id: string;
  expiresAt: string;
  message: string;
  files: PublicFile[];
  encryption?: { version: 1; metadata: string };
};

type Props = {
  initialLanguage: UiLanguage;
  state: "ready" | "expired" | "missing";
  transfer?: PublicTransfer;
};

export function DownloadContent({ initialLanguage, state, transfer }: Props) {
  const [language, changeLanguage] = useUiLanguage(initialLanguage);
  const copy = downloadCopy[language];

  if (state !== "ready" || !transfer) {
    const expired = state === "expired";
    return (
      <main className="download-page">
        <div className="download-ambient" />
        <header className="download-header">
          <Link className="back-link" href="/"><ArrowLeft size={16} /> {copy.home}</Link>
          <LanguageSwitch language={language} label={copy.languageLabel} onChange={changeLanguage} />
        </header>
        <section className="empty-transfer-card">
          <div className="empty-clock"><Clock3 size={28} /></div>
          <h1>{expired ? copy.expiredTitle : copy.missingTitle}</h1>
          <p>{expired ? copy.expiredBody : copy.missingBody}</p>
          <Link className="primary-button as-link" href="/"><ArrowLeft size={18} /> {copy.home}</Link>
        </section>
      </main>
    );
  }

  const totalSize = transfer.files.reduce((sum, file) => sum + file.size, 0);
  const expires = new Intl.DateTimeFormat(copy.locale, {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  }).format(new Date(transfer.expiresAt));
  const title = transfer.files.length === 1 ? copy.oneFile : copy.multipleFiles(transfer.files.length);

  return (
    <main className="download-page">
      <TransferViewTracker id={transfer.id} />
      <div className="download-ambient" />
      <header className="download-header">
        <Link className="back-link" href="/"><ArrowLeft size={16} /> {copy.home}</Link>
        <LanguageSwitch language={language} label={copy.languageLabel} onChange={changeLanguage} />
      </header>
      {transfer.encryption?.version === 1 ? (
        <EncryptedTransferPanel
          id={transfer.id}
          encryptedMetadata={transfer.encryption.metadata}
          files={transfer.files.map((file) => ({ id: file.id, size: file.size, plaintextSize: file.plaintextSize ?? 0 }))}
          expiresAt={transfer.expiresAt}
          language={language}
        />
      ) : (
        <section className="download-card">
          <div className="download-title-row">
            <div><p className="panel-kicker">{copy.sharedKicker}</p><h1>{title}</h1></div>
            <div className="download-total"><span>{copy.total}</span><strong>{formatBytes(totalSize)}</strong></div>
          </div>
          {transfer.message && <blockquote className="sender-message">“{transfer.message}”</blockquote>}
          {transfer.files.length > 1 && (
            <a className="download-all-button" href={`/api/transfers/${transfer.id}/download-all`}>
              <FileArchive size={21} aria-hidden="true" />
              <span><strong>{copy.downloadAll}</strong><small>{copy.downloadAllHint}</small></span>
              <Download size={19} aria-hidden="true" />
            </a>
          )}
          <div className="download-file-list">
            {transfer.files.map((file) => (
              <div className="download-file" key={file.id}>
                <span className="download-file-icon" aria-hidden="true"><FileGlyph name={file.name} type={file.type} /></span>
                <span className="download-file-name">{file.name}</span>
                <span className="download-file-size">{formatBytes(file.size)}</span>
                <a href={`/api/transfers/${transfer.id}/${file.id}`} aria-label={copy.downloadFile(file.name)}><Download size={19} /></a>
              </div>
            ))}
          </div>
          <div className="download-expiry"><ShieldCheck size={18} /><span>{copy.validUntil} <strong>{expires}{copy.clockSuffix ? ` ${copy.clockSuffix}` : ""}</strong>.</span></div>
        </section>
      )}
    </main>
  );
}
