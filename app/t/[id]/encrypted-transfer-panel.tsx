"use client";

import { Check, Download, FileArchive, KeyRound, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FileGlyph } from "@/app/file-glyph";
import { ExpiryLabel } from "@/app/expiry-label";
import { saveBrowserDownload } from "@/lib/browser-download";
import { browserZip, browserZipSize, uniqueZipNames } from "@/lib/browser-zip";
import {
  decodeNoncePrefix, decryptChunk, decryptMetadata, EncryptedTransferMetadata,
  GCM_TAG_SIZE, importTransferKey, PLAINTEXT_CHUNK_SIZE,
} from "@/lib/e2e-crypto";
import { formatBytes } from "@/lib/format-bytes";
import type { UiLanguage } from "@/lib/ui-language";
import { downloadCopy } from "./download-copy";

type EncryptedFile = { id: string; size: number; plaintextSize: number };
type Props = { id: string; encryptedMetadata: string; files: EncryptedFile[]; expiresAt: string; language: UiLanguage };
type Target = number | "all";

function validFileName(name: string) {
  return Boolean(name) && name.length <= 240 && !name.includes("/") && !name.includes("\\")
    && !Array.from(name).some((character) => character.charCodeAt(0) < 32);
}

export function EncryptedTransferPanel({ id, encryptedMetadata, files, expiresAt, language }: Props) {
  const copy = downloadCopy[language];
  const keyRef = useRef<CryptoKey | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [metadata, setMetadata] = useState<EncryptedTransferMetadata | null>(null);
  const [error, setError] = useState("");
  const [target, setTarget] = useState<Target | null>(null);
  const [phase, setPhase] = useState<"idle" | "preparing" | "downloading" | "done" | "failed" | "cancelled">("idle");
  const [progress, setProgress] = useState(0);
  const [completed, setCompleted] = useState<number[]>([]);
  const busy = phase === "preparing" || phase === "downloading";

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const key = await importTransferKey(window.location.hash.slice(1));
        const decrypted = await decryptMetadata(key, encryptedMetadata);
        if (decrypted.message.length > 500 || decrypted.files.length !== files.length || decrypted.files.some((file, index) =>
          file.size !== files[index].plaintextSize || !validFileName(file.name) || file.type.length > 200)) throw new Error(copy.invalidMetadata);
        decrypted.files.forEach((file) => decodeNoncePrefix(file.noncePrefix));
        if (active) { keyRef.current = key; setMetadata(decrypted); }
      } catch { if (active) setError(copy.keyHint); }
    })();
    return () => { active = false; keyRef.current = null; };
  }, [copy.invalidMetadata, copy.keyHint, encryptedMetadata, files]);

  useEffect(() => () => abortRef.current?.abort(new DOMException("Unmounted", "AbortError")), []);

  async function download(which: Target) {
    const key = keyRef.current;
    if (!key || !metadata || abortRef.current) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;
    setError(""); setTarget(which); setPhase("preparing"); setProgress(0);
    const indices = which === "all" ? metadata.files.map((_, index) => index) : [which];
    const total = indices.reduce((sum, index) => sum + metadata.files[index].size, 0);
    let processed = 0;
    async function* decryptedChunks(index: number, heartbeat: () => void) {
      const file = metadata!.files[index];
      const response = await fetch(`/api/transfers/${id}/${files[index].id}`, { cache: "no-store", signal });
      if (!response.ok || !response.body) throw new Error(response.status === 404 || response.status === 410 ? copy.expiredBody : response.status === 429 ? copy.downloadLimit : copy.downloadFailed);
      const reader = response.body.getReader();
      let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
      let bufferOffset = 0;
      const nonce = decodeNoncePrefix(file.noncePrefix);
      try {
        let offset = 0;
        let chunkIndex = 0;
        while (offset < file.size) {
          signal.throwIfAborted();
          const length = Math.min(PLAINTEXT_CHUNK_SIZE, file.size - offset);
          const ciphertext = new Uint8Array(length + GCM_TAG_SIZE);
          let written = 0;
          while (written < ciphertext.length) {
            if (bufferOffset === buffer.length) {
              const next = await reader.read();
              if (next.done) throw new Error(copy.downloadIncomplete);
              buffer = next.value; bufferOffset = 0; heartbeat();
            }
            const take = Math.min(buffer.length - bufferOffset, ciphertext.length - written);
            ciphertext.set(buffer.subarray(bufferOffset, bufferOffset + take), written);
            written += take; bufferOffset += take;
          }
          let plaintext: ArrayBuffer;
          try { plaintext = await decryptChunk(key!, nonce, chunkIndex++, ciphertext.buffer); }
          catch { throw new Error(copy.fileDecryptFailed); }
          signal.throwIfAborted();
          offset += plaintext.byteLength; processed += plaintext.byteLength;
          setProgress(Math.min(100, Math.floor(processed / total * 100)));
          yield new Uint8Array(plaintext);
        }
      } finally { await reader.cancel().catch(() => undefined); }
    }
    try {
      const names = uniqueZipNames(metadata.files.map((file) => file.name));
      const entries = metadata.files.map((file, index) => ({ name: names[index], size: file.size }));
      const file = metadata.files[indices[0]];
      await saveBrowserDownload({
        name: which === "all" ? "Sendebude.zip" : file.name,
        size: which === "all" ? browserZipSize(entries) : file.size,
        contentType: which === "all" ? "application/zip" : file.type,
        language, copy, controller,
        onStart: () => setPhase("downloading"),
        chunks: (heartbeat) => which === "all"
          ? browserZip(entries.map((entry, index) => ({ ...entry, chunks: () => decryptedChunks(index, heartbeat) })))
          : decryptedChunks(which, heartbeat),
      });
      setCompleted((previous) => [...new Set([...previous, ...indices])]);
      setPhase("done");
    } catch (downloadError) {
      const cancelled = downloadError instanceof DOMException && downloadError.name === "AbortError";
      setError(cancelled ? "" : downloadError instanceof Error ? downloadError.message : copy.downloadFailed);
      setPhase(cancelled ? "cancelled" : "failed");
    } finally { abortRef.current = null; }
  }

  if (error && !metadata) return <section className="download-card encrypted-error-card"><div className="empty-clock"><KeyRound size={28} /></div><h1>{copy.missingKeyTitle}</h1><p role="alert">{error}</p></section>;
  if (!metadata) return <section className="download-card encrypted-loading"><KeyRound size={24} /><span>{copy.decrypting}</span></section>;
  const totalSize = metadata.files.reduce((sum, file) => sum + file.size, 0);
  const expires = new Intl.DateTimeFormat(copy.locale, { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Berlin" }).format(new Date(expiresAt));
  return (
    <section className="download-card">
      <div className="e2e-badge"><ShieldCheck size={15} /> {copy.encryptedBadge}</div>
      <div className="download-title-row">
        <div><p className="panel-kicker">{copy.encryptedKicker}</p><h1>{metadata.files.length === 1 ? copy.oneFile : copy.multipleFiles(metadata.files.length)}</h1></div>
        <div className="download-total"><span>{copy.total}</span><strong>{formatBytes(totalSize)}</strong></div>
      </div>
      {metadata.message && <blockquote className="sender-message">“{metadata.message}”</blockquote>}
      {metadata.files.length > 1 && <>
        <button type="button" className="download-all-button" disabled={busy} onClick={() => void download("all")}><FileArchive size={21} aria-hidden="true" /><span><strong>{copy.downloadAll}</strong><small>{copy.downloadAllHint}</small></span><Download size={19} aria-hidden="true" /></button>
        <p className="encrypted-download-hint">{copy.zipHint}</p>
      </>}
      <div className="download-file-list">
        {metadata.files.map((file, index) => (
          <div className="download-file enhanced-download-file" key={files[index].id}>
            <span className="download-file-icon" aria-hidden="true"><FileGlyph name={file.name} type={file.type} /></span>
            <span className="download-file-details"><span className="download-file-name">{file.name}</span><span className="file-detail-size">{formatBytes(file.size)}{completed.includes(index) && <span className="file-complete"><Check size={14} aria-hidden="true" />{copy.handedOver}</span>}</span></span>
            <button type="button" className="file-download-button" disabled={busy} onClick={() => void download(index)} aria-label={copy.secureDownloadFile(file.name)}><Download size={17} aria-hidden="true" /><span>{completed.includes(index) ? copy.again : copy.download}</span></button>
          </div>
        ))}
      </div>
      {phase !== "idle" && <div className={`download-status download-status-${phase}`}>
        <p role="status">{phase === "preparing" ? copy.preparing : phase === "downloading" ? `${copy.downloading} · ${progress} %` : phase === "done" ? copy.handedOver : phase === "cancelled" ? copy.downloadCancelled : copy.downloadFailed}</p>
        {busy && <><progress max={100} value={progress} aria-label={copy.downloading} /><button type="button" className="text-button" onClick={() => abortRef.current?.abort(new DOMException(copy.downloadCancelled, "AbortError"))}>{copy.cancel}</button></>}
        {phase === "done" && <p className="download-status-hint">{copy.completedHint}</p>}
        {phase === "failed" && <><p className="form-error" role="alert">{error}</p><p className="download-status-hint">{copy.retryHint}</p></>}
        {(phase === "failed" || phase === "cancelled") && target !== null && <button type="button" className="text-button" onClick={() => void download(target)}>{copy.retry}</button>}
      </div>}
      <div className="download-expiry"><ShieldCheck size={18} /><span><ExpiryLabel expiresAt={expiresAt} language={language} />{copy.encryptedUntil} <strong>{expires}{copy.clockSuffix ? ` ${copy.clockSuffix}` : ""}</strong>.</span></div>
    </section>
  );
}
