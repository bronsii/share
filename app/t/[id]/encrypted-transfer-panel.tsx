"use client";

import { Download, KeyRound, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FileGlyph } from "@/app/file-glyph";
import {
  decodeNoncePrefix,
  decryptChunk,
  decryptMetadata,
  EncryptedTransferMetadata,
  GCM_TAG_SIZE,
  importTransferKey,
  PLAINTEXT_CHUNK_SIZE,
} from "@/lib/e2e-crypto";
import { formatBytes } from "@/lib/format-bytes";
import type { UiLanguage } from "@/lib/ui-language";
import { downloadCopy } from "./download-copy";

type EncryptedFile = { id: string; size: number; plaintextSize: number };
type Props = { id: string; encryptedMetadata: string; files: EncryptedFile[]; expiresAt: string; language: UiLanguage };
const DOWNLOAD_START_TIMEOUT_MS = 15_000;
const DOWNLOAD_IDLE_TIMEOUT_MS = 120_000;

function validFileName(name: string) {
  return Boolean(name)
    && name.length <= 240
    && !name.includes("/")
    && !name.includes("\\")
    && !Array.from(name).some((character) => character.charCodeAt(0) < 32);
}

async function ensureDownloadWorker(copy: (typeof downloadCopy)[UiLanguage]) {
  if (!("serviceWorker" in navigator)) throw new Error(copy.streamingUnsupported);
  const registration = await navigator.serviceWorker.register("/e2e-download-sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise<void>((resolve, reject) => {
      const onControllerChange = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      const timeout = window.setTimeout(() => {
        navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
        reject(new Error(copy.workerReload));
      }, 5000);
      navigator.serviceWorker.addEventListener("controllerchange", onControllerChange, { once: true });
      if (navigator.serviceWorker.controller) onControllerChange();
    });
  }
  return navigator.serviceWorker.controller ?? registration.active;
}

function createExactReader(reader: ReadableStreamDefaultReader<Uint8Array>, incompleteMessage: string) {
  let current: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  let currentOffset = 0;
  return async (length: number, onReadProgress?: () => void) => {
    const result = new Uint8Array(length);
    let written = 0;
    while (written < length) {
      if (currentOffset >= current.byteLength) {
        const next = await reader.read();
        if (next.done) throw new Error(incompleteMessage);
        current = next.value;
        currentOffset = 0;
        onReadProgress?.();
      }
      const available = current.byteLength - currentOffset;
      const take = Math.min(available, length - written);
      result.set(current.subarray(currentOffset, currentOffset + take), written);
      currentOffset += take;
      written += take;
    }
    return result.buffer;
  };
}

export function EncryptedTransferPanel({ id, encryptedMetadata, files, expiresAt, language }: Props) {
  const copy = downloadCopy[language];
  const keyRef = useRef<CryptoKey | null>(null);
  const [metadata, setMetadata] = useState<EncryptedTransferMetadata | null>(null);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const fragment = window.location.hash.slice(1);
        const key = await importTransferKey(fragment);
        const decrypted = await decryptMetadata(key, encryptedMetadata);
        if (decrypted.message.length > 500 || decrypted.files.length !== files.length || decrypted.files.some((file, index) => {
          return file.size !== files[index].plaintextSize
            || !validFileName(file.name)
            || file.type.length > 200;
        })) throw new Error(copy.invalidMetadata);
        decrypted.files.forEach((file) => decodeNoncePrefix(file.noncePrefix));
        if (active) {
          keyRef.current = key;
          setMetadata(decrypted);
        }
      } catch (loadError) {
        if (active) {
          const localizedMessage = loadError instanceof Error
            && (language === "de" || loadError.message === copy.invalidMetadata)
            ? loadError.message
            : copy.decryptFailed;
          setError(localizedMessage);
        }
      }
    })();
    return () => { active = false; keyRef.current = null; };
  }, [copy.decryptFailed, copy.invalidMetadata, encryptedMetadata, files, language]);

  async function downloadFile(index: number) {
    const key = keyRef.current;
    const fileMetadata = metadata?.files[index];
    const serverFile = files[index];
    if (!key || !fileMetadata || downloading !== null) return;
    setError("");
    setDownloading(index);
    setProgress(0);
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let port: MessagePort | null = null;
    let completionTimeout: number | null = null;
    try {
      const worker = await ensureDownloadWorker(copy);
      if (!worker) throw new Error(copy.workerUnavailable);
      const response = await fetch(`/api/transfers/${id}/${serverFile.id}`, { cache: "no-store" });
      if (!response.ok || !response.body) {
        const serverMessage = await response.text();
        throw new Error(language === "de" && serverMessage ? serverMessage : copy.downloadFailed);
      }
      reader = response.body.getReader();
      const readExactly = createExactReader(reader, copy.downloadIncomplete);
      const noncePrefix = decodeNoncePrefix(fileMetadata.noncePrefix);
      const channel = new MessageChannel();
      port = channel.port1;
      const token = crypto.randomUUID();
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error(copy.workerNoResponse)), 5000);
        port!.onmessage = ({ data }) => {
          if (data?.type === "ready") {
            window.clearTimeout(timeout);
            resolve();
          }
        };
        worker.postMessage({
          type: "prepare-e2e-download",
          token,
          name: fileMetadata.name,
          size: fileMetadata.size,
          contentType: fileMetadata.type,
        }, [channel.port2]);
      });

      let chunkIndex = 0;
      let plaintextOffset = 0;
      let finished = false;
      const completion = new Promise<void>((resolve, reject) => {
        const clearCompletionTimeout = () => {
          if (completionTimeout !== null) window.clearTimeout(completionTimeout);
          completionTimeout = null;
        };
        const armCompletionTimeout = (delay: number, message: string) => {
          clearCompletionTimeout();
          completionTimeout = window.setTimeout(() => {
            if (finished) return;
            finished = true;
            const timeoutError = new Error(message);
            port?.postMessage({ type: "error", message });
            void reader?.cancel();
            reject(timeoutError);
          }, delay);
        };
        armCompletionTimeout(DOWNLOAD_START_TIMEOUT_MS, copy.downloadStartTimeout);
        port!.onmessage = ({ data }) => {
          if (data?.type === "cancel") {
            finished = true;
            clearCompletionTimeout();
            void reader?.cancel();
            reject(new Error(copy.downloadCancelled));
            return;
          }
          if (data?.type !== "pull" || finished) return;
          armCompletionTimeout(DOWNLOAD_IDLE_TIMEOUT_MS, copy.downloadIdleTimeout);
          void (async () => {
            try {
              if (plaintextOffset >= fileMetadata.size) {
                finished = true;
                clearCompletionTimeout();
                port!.postMessage({ type: "done" });
                resolve();
                return;
              }
              const plaintextLength = Math.min(PLAINTEXT_CHUNK_SIZE, fileMetadata.size - plaintextOffset);
              const ciphertext = await readExactly(
                plaintextLength + GCM_TAG_SIZE,
                () => armCompletionTimeout(DOWNLOAD_IDLE_TIMEOUT_MS, copy.downloadIdleTimeout),
              );
              const plaintext = await decryptChunk(key, noncePrefix, chunkIndex, ciphertext);
              if (finished) return;
              plaintextOffset += plaintext.byteLength;
              chunkIndex += 1;
              setProgress(Math.min(100, Math.round((plaintextOffset / fileMetadata.size) * 100)));
              port!.postMessage({ type: "chunk", chunk: plaintext }, [plaintext]);
              armCompletionTimeout(DOWNLOAD_IDLE_TIMEOUT_MS, copy.downloadIdleTimeout);
            } catch (downloadError) {
              if (finished) return;
              finished = true;
              clearCompletionTimeout();
              const message = downloadError instanceof Error ? downloadError.message : copy.decryptionFailed;
              port!.postMessage({ type: "error", message });
              reject(downloadError);
            }
          })();
        };
      });
      const anchor = document.createElement("a");
      anchor.href = `/e2e-download/${token}?lang=${language}`;
      anchor.download = "";
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      await completion;
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : copy.fileDecryptFailed);
    } finally {
      if (completionTimeout !== null) window.clearTimeout(completionTimeout);
      port?.close();
      await reader?.cancel().catch(() => undefined);
      setDownloading(null);
    }
  }

  if (error && !metadata) {
    return (
      <section className="download-card encrypted-error-card">
        <div className="empty-clock"><KeyRound size={28} /></div>
        <h1>{copy.missingKeyTitle}</h1>
        <p>{error}</p>
      </section>
    );
  }
  if (!metadata) {
    return <section className="download-card encrypted-loading"><KeyRound size={24} /><span>{copy.decrypting}</span></section>;
  }

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
      {metadata.files.length > 1 && <p className="encrypted-download-hint">{copy.individualFiles}</p>}
      <div className="download-file-list">
        {metadata.files.map((file, index) => (
          <div className="download-file" key={files[index].id}>
            <span className="download-file-icon" aria-hidden="true"><FileGlyph name={file.name} type={file.type} /></span>
            <span className="download-file-name">{file.name}</span>
            <span className="download-file-size">{downloading === index ? `${progress} %` : formatBytes(file.size)}</span>
            <button type="button" disabled={downloading !== null} onClick={() => void downloadFile(index)} aria-label={copy.secureDownloadFile(file.name)}><Download size={19} /></button>
          </div>
        ))}
      </div>
      {error && <p className="form-error encrypted-download-error" role="alert">{error}</p>}
      <div className="download-expiry"><ShieldCheck size={18} /><span>{copy.encryptedUntil} <strong>{expires}{copy.clockSuffix ? ` ${copy.clockSuffix}` : ""}</strong>.</span></div>
    </section>
  );
}
