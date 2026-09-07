"use client";

import {
  Check,
  ChevronDown,
  Clipboard,
  FileText,
  Pause,
  Play,
  Plus,
  Send,
  ShieldCheck,
  ScrollText,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { ChangeEvent, DragEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  createNoncePrefix,
  createTransferKey,
  decodeNoncePrefix,
  encodeNoncePrefix,
  encryptedFileSize,
  encryptMetadata,
  importTransferKey,
  plaintextProgressFromCiphertext,
} from "@/lib/e2e-crypto";
import { formatBytes } from "@/lib/format-bytes";
import { TERMS_VERSION } from "@/lib/terms";
import type { UiLanguage } from "@/lib/ui-language";
import { orderRecoveryFiles } from "@/lib/upload-recovery.mjs";
import { uploadTranslations } from "@/lib/upload-copy";
import { clearUploadRecovery, loadUploadRecovery, saveUploadRecovery } from "@/lib/upload-recovery-storage";
import { runEncryptedUpload } from "@/lib/upload-transfer";
import { deleteCancelledUpload, shouldWarnBeforeUploadLeave, UploadUnavailableError } from "@/lib/upload-network";
import type { UploadRetryState } from "@/lib/upload-network";
import type { ClientEncryptionState, UploadRecovery, UploadResult, UploadSession } from "@/lib/upload-types";
import { FileGlyph } from "./file-glyph";
import { createManagementToken, managementUrl } from "@/lib/management-token";
import { ShareExtras } from "./share-extras";
import { ExpiryLabel } from "./expiry-label";

const MAX_FILES = 20;
const MAX_TOTAL_SIZE = 5 * 1024 ** 3;

type Language = UiLanguage;

function formatDuration(seconds: number, language: Language) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const rounded = Math.ceil(seconds);
  if (rounded < 60) return language === "de" ? `${rounded} Sek.` : `${rounded} sec`;
  const minutes = Math.ceil(rounded / 60);
  if (minutes < 60) return language === "de" ? `${minutes} Min.` : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return language === "de" ? `${hours} Std. ${restMinutes} Min.` : `${hours} hr ${restMinutes} min`;
}

function fileKey(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function monotonicTimestamp() {
  return performance.now();
}

function completedUploadFileCount(files: File[], uploadedBytes: number) {
  let completed = 0;
  let cumulativeSize = 0;
  for (const file of files) {
    cumulativeSize += file.size;
    if (uploadedBytes < cumulativeSize) break;
    completed += 1;
  }
  return completed;
}

export function TransferPanel({ language }: { language: Language }) {
  const text = uploadTranslations[language];
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false);
  const pausedRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<UploadSession | null>(null);
  const encryptionRef = useRef<ClientEncryptionState | null>(null);
  const uploadGenerationRef = useRef(0);
  const cancellingUploadRef = useRef(false);
  const speedSampleRef = useRef({ time: 0, bytes: 0, value: 0 });
  const [files, setFiles] = useState<File[]>([]);
  const [days, setDays] = useState("3");
  const [message, setMessage] = useState("");
  const [acceptedTermsLanguage, setAcceptedTermsLanguage] = useState<Language | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [paused, setPaused] = useState(false);
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<UploadResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [recovery, setRecovery] = useState<UploadRecovery | null>(null);
  const [removingFileKey, setRemovingFileKey] = useState<string | null>(null);
  const [cancellingUpload, setCancellingUpload] = useState(false);
  const [startingUpload, setStartingUpload] = useState(false);
  const [retrying, setRetrying] = useState<UploadRetryState | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const storedRecovery = loadUploadRecovery();
      if (!storedRecovery) return;
      setRecovery(storedRecovery);
      if (["1", "3", "7"].includes(storedRecovery.days)) setDays(storedRecovery.days);
      setMessage(storedRecovery.message.slice(0, 500));
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!shouldWarnBeforeUploadLeave(uploading, Boolean(recovery), Boolean(result))) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [uploading, recovery, result]);

  useEffect(() => () => {
    uploadGenerationRef.current += 1;
    controllerRef.current?.abort();
  }, []);

  function beginUploadAttempt() {
    controllerRef.current?.abort();
    controllerRef.current = new AbortController();
    setRetrying(null);
    return ++uploadGenerationRef.current;
  }

  const termsAccepted = acceptedTermsLanguage === language;
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  const completedFiles = completedUploadFileCount(files, uploadedBytes);
  const remainingBytes = Math.max(0, totalSize - uploadedBytes);
  const totalProgress = totalSize ? Math.min(100, Math.round((uploadedBytes / totalSize) * 100)) : 0;
  const remainingSeconds = uploadSpeed > 0 ? remainingBytes / uploadSpeed : 0;

  function uploadedBytesForFile(index: number) {
    const previousBytes = files.slice(0, index).reduce((sum, file) => sum + file.size, 0);
    return Math.min(files[index].size, Math.max(0, uploadedBytes - previousBytes));
  }

  function addFiles(incoming: File[]) {
    if (uploadingRef.current || cancellingUploadRef.current) return;
    setError("");
    setResult(null);
    if (recovery) {
      void resumeRecoveredUpload(incoming, recovery);
      return;
    }
    if (incoming.some((file) => file.size === 0)) {
      setError(text.emptyOrFolder);
      return;
    }
    const known = new Set(files.map(fileKey));
    const unique = incoming.filter((file) => !known.has(fileKey(file)));
    const next = [...files, ...unique];
    if (next.length > MAX_FILES) {
      setError(text.tooManyFiles(MAX_FILES));
      return;
    }
    const size = next.reduce((sum, file) => sum + file.size, 0);
    if (size > MAX_TOTAL_SIZE) {
      setError(text.tooLarge);
      return;
    }
    if (!next.length) return;
    setFiles(next);
  }

  function onFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  }

  function onDropzoneKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!uploadingRef.current && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      inputRef.current?.click();
    }
  }

  async function resumeRecoveredUpload(incoming: File[], storedRecovery: UploadRecovery) {
    const orderedFiles = orderRecoveryFiles(incoming, storedRecovery.files);
    if (!orderedFiles) {
      setError(text.recoveryMismatch);
      return;
    }

    uploadingRef.current = true;
    pausedRef.current = false;
    setStartingUpload(true);
    setUploading(true);
    setPaused(false);
    setFiles(orderedFiles);
    setUploadedBytes(0);
    setUploadSpeed(0);
    setError("");
    speedSampleRef.current = { time: monotonicTimestamp(), bytes: 0, value: 0 };
    const generation = beginUploadAttempt();

    try {
      const key = await importTransferKey(storedRecovery.fragment);
      if (generation !== uploadGenerationRef.current) return;
      const noncePrefixes = storedRecovery.noncePrefixes.map(decodeNoncePrefix);
      sessionRef.current = storedRecovery.session;
      encryptionRef.current = { key, fragment: storedRecovery.fragment, noncePrefixes, managementToken: storedRecovery.managementToken, pendingChunks: new Map() };
      setRecovery(null);
      setStartingUpload(false);
      await continueUpload(orderedFiles, storedRecovery.session, generation);
    } catch (uploadError) {
      if (generation !== uploadGenerationRef.current) return;
      setStartingUpload(false);
      if (sessionRef.current) {
        pausedRef.current = true;
        setPaused(true);
        setUploadSpeed(0);
      } else {
        uploadingRef.current = false;
        setUploading(false);
      }
      setError(uploadError instanceof Error ? uploadError.message : text.recoveryUnavailable);
    }
  }

  async function discardRecovery() {
    if (uploadingRef.current || cancellingUploadRef.current) return;
    if (!window.confirm(text.cancelConfirmation)) return;
    const storedRecovery = recovery;
    cancellingUploadRef.current = true;
    setCancellingUpload(true);
    setError("");
    try {
      if (storedRecovery) await deleteCancelledUpload(storedRecovery.session.id, storedRecovery.managementToken);
      clearUploadRecovery();
      setRecovery(null);
    } catch {
      setError(text.cancelFailed);
    } finally {
      cancellingUploadRef.current = false;
      setCancellingUpload(false);
    }
  }

  async function createTransfer(uploadFiles = files) {
    if (!uploadFiles.length || uploadingRef.current || !termsAccepted) return;
    uploadingRef.current = true;
    pausedRef.current = false;
    setStartingUpload(true);
    setUploading(true);
    setPaused(false);
    setUploadedBytes(0);
    setUploadSpeed(0);
    speedSampleRef.current = { time: monotonicTimestamp(), bytes: 0, value: 0 };
    const generation = beginUploadAttempt();
    setError("");
    try {
      const { key, fragment } = await createTransferKey();
      const management = await createManagementToken();
      const noncePrefixes = uploadFiles.map(() => createNoncePrefix());
      const encryptedMetadata = await encryptMetadata(key, {
        version: 1,
        message: message.trim(),
        files: uploadFiles.map((file, index) => ({
          name: file.name.slice(0, 240),
          type: (file.type || "application/octet-stream").slice(0, 200),
          size: file.size,
          noncePrefix: encodeNoncePrefix(noncePrefixes[index]),
        })),
      });
      if (generation !== uploadGenerationRef.current) return;
      encryptionRef.current = { key, fragment, noncePrefixes, managementToken: management.token, pendingChunks: new Map() };
      const response = await fetch("/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: uploadFiles.map((file) => ({ size: encryptedFileSize(file.size), plaintextSize: file.size })),
          days: Number(days),
          managementTokenHash: management.hash,
          encryption: { version: 1, metadata: encryptedMetadata },
          terms: { accepted: true, version: TERMS_VERSION, language },
        }),
      });
      const session = await response.json() as UploadSession & { error?: string };
      if (!response.ok || !session.id) throw new Error(session.error || text.uploadFailed);
      // Creation is not replayed or aborted: learn the ID so a cancelled creation can be cleaned up.
      if (generation !== uploadGenerationRef.current) {
        void deleteCancelledUpload(session.id, management.token).catch(() => {
          if (!uploadingRef.current) setError(text.cancelCleanupFailed);
        });
        return;
      }
      sessionRef.current = session;
      persistUploadRecovery(uploadFiles, session, encryptionRef.current);
      setStartingUpload(false);
      await continueUpload(uploadFiles, session, generation);
    } catch (uploadError) {
      if (generation !== uploadGenerationRef.current) return;
      setStartingUpload(false);
      if (!pausedRef.current) {
        if (sessionRef.current) {
          pausedRef.current = true;
          setPaused(true);
          setUploadSpeed(0);
        } else {
          uploadingRef.current = false;
          setUploading(false);
        }
        setError(uploadError instanceof Error ? uploadError.message : text.uploadFailed);
      }
    }
  }

  function persistUploadRecovery(
    uploadFiles: File[],
    session: UploadSession,
    encryption: ClientEncryptionState | null,
  ) {
    if (!encryption) return;
    saveUploadRecovery({
      version: 1,
      session,
      fragment: encryption.fragment,
      managementToken: encryption.managementToken,
      noncePrefixes: encryption.noncePrefixes.map(encodeNoncePrefix),
      files: uploadFiles.map((file) => ({ name: file.name, size: file.size, lastModified: file.lastModified })),
      days,
      message: message.trim(),
    });
  }

  function updateProgress(bytes: number) {
    setUploadedBytes(bytes);
    const now = monotonicTimestamp();
    const sample = speedSampleRef.current;
    const elapsed = (now - sample.time) / 1000;
    if (elapsed < 1) return;
    const instant = Math.max(0, bytes - sample.bytes) / elapsed;
    const smoothed = sample.value ? sample.value * 0.7 + instant * 0.3 : instant;
    speedSampleRef.current = { time: now, bytes, value: smoothed };
    setUploadSpeed(smoothed);
  }

  async function continueUpload(
    uploadFiles = files,
    knownSession = sessionRef.current,
    generation = uploadGenerationRef.current,
  ) {
    const encryption = encryptionRef.current;
    const controller = controllerRef.current;
    if (!knownSession || !encryption || !controller || pausedRef.current || generation !== uploadGenerationRef.current) return;
    const isCurrent = () => generation === uploadGenerationRef.current && !controller.signal.aborted;
    try {
      const payload = await runEncryptedUpload({
        files: uploadFiles,
        session: knownSession,
        encryption,
        signal: controller.signal,
        failureMessage: text.uploadFailed,
        connectionMessage: text.connectionLost,
        onProgress: (bytes) => { if (isCurrent()) updateProgress(bytes); },
        onRetry: (state) => {
          if (!isCurrent()) return;
          setRetrying(state);
          if (state) {
            setUploadSpeed(0);
            speedSampleRef.current.value = 0;
          }
        },
      });
      if (!isCurrent()) return;
      setUploadedBytes(uploadFiles.reduce((sum, file) => sum + file.size, 0));
      setUploadSpeed(0);
      setResult({ ...payload, url: `${payload.url}#${encryption.fragment}`, managementUrl: managementUrl(payload.url, payload.id, encryption.managementToken) });
      setCopied(false);
      clearUploadRecovery();
      sessionRef.current = null;
      encryptionRef.current = null;
      uploadingRef.current = false;
      setUploading(false);
      setPaused(false);
      setRetrying(null);
    } catch (uploadError) {
      if (!isCurrent()) return;
      if (uploadError instanceof UploadUnavailableError) {
        clearUploadRecovery();
        setRecovery(null);
        sessionRef.current = null;
        encryptionRef.current = null;
        uploadingRef.current = false;
        pausedRef.current = false;
        setUploading(false);
        setPaused(false);
        setUploadedBytes(0);
        setUploadSpeed(0);
        setRetrying(null);
        setError(text.recoveryUnavailable);
        return;
      }
      throw uploadError;
    }
  }

  function pauseUpload() {
    if (!sessionRef.current) return;
    uploadGenerationRef.current += 1;
    pausedRef.current = true;
    setPaused(true);
    setUploadSpeed(0);
    controllerRef.current?.abort();
    setRetrying(null);
  }

  function resumeUpload() {
    if (!sessionRef.current || !pausedRef.current) return;
    pausedRef.current = false;
    setPaused(false);
    setError("");
    speedSampleRef.current = { time: monotonicTimestamp(), bytes: uploadedBytes, value: 0 };
    const generation = beginUploadAttempt();
    void continueUpload(files, sessionRef.current, generation).catch((uploadError) => {
      if (generation !== uploadGenerationRef.current) return;
      if (sessionRef.current) {
        pausedRef.current = true;
        setPaused(true);
        setUploadSpeed(0);
      } else {
        uploadingRef.current = false;
        setUploading(false);
        setPaused(false);
      }
      setError(uploadError instanceof Error ? uploadError.message : text.uploadFailed);
    });
  }

  async function cancelUpload() {
    if (cancellingUploadRef.current || !window.confirm(text.cancelConfirmation)) return;
    cancellingUploadRef.current = true;
    setCancellingUpload(true);
    setStartingUpload(false);
    uploadGenerationRef.current += 1;
    pausedRef.current = true;
    controllerRef.current?.abort();
    setRetrying(null);
    const session = sessionRef.current ?? recovery?.session;
    const managementToken = encryptionRef.current?.managementToken ?? recovery?.managementToken;
    setPaused(true);
    setUploadSpeed(0);
    if (session) {
      try {
        await deleteCancelledUpload(session.id, managementToken);
      } catch {
        setError(text.cancelFailed);
        if (!encryptionRef.current && recovery) {
          uploadingRef.current = false;
          pausedRef.current = false;
          setUploading(false);
          setPaused(false);
        }
        cancellingUploadRef.current = false;
        setCancellingUpload(false);
        return;
      }
    }
    clearUploadRecovery();
    setRecovery(null);
    sessionRef.current = null;
    encryptionRef.current = null;
    uploadingRef.current = false;
    setUploading(false);
    setPaused(false);
    setFiles([]);
    setAcceptedTermsLanguage(null);
    setUploadedBytes(0);
    setUploadSpeed(0);
    setError("");
    cancellingUploadRef.current = false;
    setCancellingUpload(false);
  }

  async function removeFile(index: number) {
    const selectedFile = files[index];
    if (!selectedFile || removingFileKey) return;
    if (!uploadingRef.current) {
      setFiles((current) => current.filter((_file, fileIndex) => fileIndex !== index));
      return;
    }

    const session = sessionRef.current;
    const encryption = encryptionRef.current;
    const serverFile = session?.files[index];
    if (!session || !encryption || !serverFile) return;
    if (files.length === 1) {
      await cancelUpload();
      return;
    }

    const wasPaused = pausedRef.current;
    const generation = beginUploadAttempt();
    pausedRef.current = true;
    setPaused(true);
    setUploadSpeed(0);
    setRemovingFileKey(fileKey(selectedFile));
    setError("");

    const remainingFiles = files.filter((_file, fileIndex) => fileIndex !== index);
    const remainingNoncePrefixes = encryption.noncePrefixes.filter((_nonce, nonceIndex) => nonceIndex !== index);
    try {
      const encryptedMetadata = await encryptMetadata(encryption.key, {
        version: 1,
        message: message.trim(),
        files: remainingFiles.map((file, fileIndex) => ({
          name: file.name.slice(0, 240),
          type: (file.type || "application/octet-stream").slice(0, 200),
          size: file.size,
          noncePrefix: encodeNoncePrefix(remainingNoncePrefixes[fileIndex]),
        })),
      });
      if (generation !== uploadGenerationRef.current) return;
      const response = await fetch(`/api/uploads/${session.id}/${serverFile.id}`, {
        method: "DELETE",
        signal: AbortSignal.any([controllerRef.current!.signal, AbortSignal.timeout(15_000)]),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ encryption: { version: 1, metadata: encryptedMetadata } }),
      });
      const updated = await response.json() as UploadSession & { error?: string };
      if (generation !== uploadGenerationRef.current) return;
      if (!response.ok || !updated.id || updated.files.length !== remainingFiles.length) {
        throw new Error(updated.error || text.removeFileFailed);
      }

      const nextEncryption = { ...encryption, noncePrefixes: remainingNoncePrefixes };
      nextEncryption.pendingChunks.delete(serverFile.id);
      sessionRef.current = updated;
      encryptionRef.current = nextEncryption;
      setFiles(remainingFiles);
      const resumedBytes = updated.files.reduce((sum, serverFile, fileIndex) => {
        return sum + plaintextProgressFromCiphertext(serverFile.uploaded, remainingFiles[fileIndex].size);
      }, 0);
      setUploadedBytes(resumedBytes);
      persistUploadRecovery(remainingFiles, updated, nextEncryption);
      setRemovingFileKey(null);

      if (wasPaused) {
        setPaused(true);
        return;
      }
      pausedRef.current = false;
      setPaused(false);
      speedSampleRef.current = { time: monotonicTimestamp(), bytes: resumedBytes, value: 0 };
      void continueUpload(remainingFiles, updated, generation).catch((uploadError) => {
        if (generation !== uploadGenerationRef.current) return;
        pausedRef.current = true;
        setPaused(true);
        setUploadSpeed(0);
        setError(uploadError instanceof Error ? uploadError.message : text.uploadFailed);
      });
    } catch (removeError) {
      if (generation !== uploadGenerationRef.current) return;
      setRemovingFileKey(null);
      pausedRef.current = true;
      setPaused(true);
      setError(removeError instanceof Error ? removeError.message : text.removeFileFailed);
    }
  }

  async function copyLink() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      setError(text.copyManually);
    }
  }

  async function shareLink() {
    if (!result) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: text.shareTitle, url: result.url });
        return;
      } catch (shareError) {
        if (shareError instanceof DOMException && shareError.name === "AbortError") return;
      }
    }
    await copyLink();
  }

  function reset() {
    setFiles([]);
    setMessage("");
    setAcceptedTermsLanguage(null);
    setResult(null);
    setCopied(false);
    setUploadedBytes(0);
    setUploadSpeed(0);
    uploadingRef.current = false;
    pausedRef.current = false;
    sessionRef.current = null;
    encryptionRef.current = null;
    uploadGenerationRef.current += 1;
    controllerRef.current?.abort();
    setRetrying(null);
    setStartingUpload(false);
    clearUploadRecovery();
    setError("");
  }

  if (result) {
    return (
      <section className="transfer-card result-card" aria-live="polite">
        <div className="success-mark"><Check size={26} strokeWidth={2.5} aria-hidden="true" /></div>
        <p className="panel-kicker">{text.ready}</p>
        <h2>{text.linkReady}</h2>
        <p className="result-copy">{text.resultCopy(files.length !== 1)}</p>
        <div className="share-link-row">
          <a className="share-link" href={result.url} target="_blank" rel="noreferrer" aria-label={text.openLink}>
            {result.url}
          </a>
          <button type="button" onClick={copyLink} aria-label={text.copyLink}>
            {copied ? <Check size={18} /> : <Clipboard size={18} />}
          </button>
        </div>
        <div className="result-meta">
          <span>{files.length} {files.length === 1 ? text.file : text.files}</span>
          <span>{formatBytes(totalSize)}</span>
          <span>{text.until} {new Intl.DateTimeFormat(text.locale, { dateStyle: "medium" }).format(new Date(result.expiresAt))}</span>
          <ExpiryLabel expiresAt={result.expiresAt} language={language} />
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button" type="button" onClick={shareLink}>
          {copied ? <Check size={18} /> : <Send size={18} />}
          {copied ? text.linkCopied : text.shareAction}
        </button>
        <ShareExtras url={result.url} managementUrl={result.managementUrl} expiresAt={result.expiresAt} language={language} />
        <div className="sendebude-footer-links">
          <a className="sendebude-data-link" href="/datenschutz"><ShieldCheck size={15} aria-hidden="true" /><span>{text.privacyTitle}</span></a>
          <a className="sendebude-data-link" href="/nutzungsbedingungen"><ScrollText size={15} aria-hidden="true" /><span>{text.termsTitle}</span></a>
          <a className="sendebude-data-link" href="/impressum"><FileText size={15} aria-hidden="true" /><span>{text.imprintTitle}</span></a>
        </div>
        <button className="text-button" type="button" onClick={reset}>{text.newTransfer}</button>
      </section>
    );
  }

  return (
    <section className="transfer-card" aria-labelledby="transfer-title">
      <div className="card-heading">
        <p className="panel-kicker">{text.newTransferKicker}</p>
        <div className="limit-pill">{text.limits}</div>
        <h2 id="transfer-title">{text.question}</h2>
      </div>

      {recovery && (
        <div className="upload-recovery" role="status">
          <div>
            <strong>{text.recoveryTitle}</strong>
            <span>{text.recoveryBody}</span>
          </div>
          <div className="upload-recovery-actions">
            <button type="button" disabled={uploading || cancellingUpload} onClick={() => inputRef.current?.click()}>{text.recoveryChoose}</button>
            <button type="button" disabled={uploading || cancellingUpload} onClick={() => void discardRecovery()}>{text.recoveryDiscard}</button>
          </div>
        </div>
      )}

      <input ref={inputRef} className="sr-only" type="file" multiple disabled={uploading} onChange={onFilesSelected} aria-label={text.chooseFiles} />

      <div
        className={`dropzone ${dragging ? "is-dragging" : ""}`}
        role="button"
        tabIndex={uploading ? -1 : 0}
        onClick={() => { if (!uploadingRef.current) inputRef.current?.click(); }}
        onKeyDown={onDropzoneKeyDown}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
        onDrop={onDrop}
        aria-disabled={uploading}
        aria-label={text.dropLabel}
      >
        <div className="upload-icon"><UploadCloud size={24} aria-hidden="true" /></div>
        <div><strong>{text.dropFiles}</strong><span>{text.clickToChoose}</span></div>
        <Plus className="dropzone-plus" size={20} aria-hidden="true" />
      </div>

      {files.length > 0 && (
        <div className="selection-counter" aria-live="polite">
          <span>{uploading ? text.uploadedFileCount(completedFiles, files.length) : `${files.length} ${files.length === 1 ? text.file : text.files}`}</span>
          {!uploading && <span><strong>{formatBytes(totalSize)}</strong> {text.ofMaximum}</span>}
        </div>
      )}

      {files.length > 0 && (
        <div className="file-list" aria-label={text.selectedFiles}>
          {files.map((file, index) => {
            const fileUploadedBytes = uploadedBytesForFile(index);
            const fileProgress = file.size ? Math.min(100, Math.round((fileUploadedBytes / file.size) * 100)) : 100;
            return (
              <div className="file-row" key={fileKey(file)}>
                <span className="file-glyph" aria-hidden="true"><FileGlyph name={file.name} type={file.type} size={19} /></span>
                <span className="file-name" title={file.name}>{file.name}</span>
                <span className="file-progress" aria-label={uploading ? `${fileProgress}% ${text.uploaded}` : undefined}>{uploading ? `${fileProgress}%` : ""}</span>
                <span className="file-size">
                  {uploading ? <><strong>{formatBytes(fileUploadedBytes)}</strong> / {formatBytes(file.size)}</> : formatBytes(file.size)}
                </span>
                <span className="file-actions">
                  <button type="button" disabled={startingUpload || Boolean(removingFileKey) || cancellingUpload || (uploading && totalProgress >= 100)} onClick={() => void removeFile(index)} aria-label={uploading ? text.removeUploadingFile(file.name) : `${file.name} ${text.remove}`}><Trash2 size={16} /></button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {uploading && (
        <div className="upload-summary" aria-live="polite">
          <div className="upload-summary-line">
            <strong>{totalProgress} %</strong>
            <span>{formatBytes(uploadedBytes)} / {formatBytes(totalSize)}</span>
          </div>
          <div className="upload-progress-row">
            <progress max="100" value={totalProgress} aria-label={`${totalProgress} % ${text.uploaded}`} />
            <button className="upload-pause-toggle" type="button" disabled={startingUpload || Boolean(removingFileKey) || cancellingUpload} onClick={paused ? resumeUpload : pauseUpload} aria-label={paused ? text.resumeUpload : text.pauseUpload} title={paused ? text.resumeUpload : text.pauseUpload}>
              {paused ? <Play size={16} /> : <Pause size={16} />}
            </button>
            <button className="upload-cancel-all" type="button" disabled={Boolean(removingFileKey) || cancellingUpload} onClick={() => void cancelUpload()} aria-label={text.cancelUpload} title={text.cancelUpload}>
              <Trash2 size={16} />
            </button>
          </div>
          {retrying && <p className="upload-retry-status" role="status">{text.retrying(retrying.attempt, retrying.maximum, Math.ceil(retrying.delayMs / 1000))}</p>}
          <div className="upload-summary-line upload-summary-details">
            <span className="upload-speed" aria-label={uploadSpeed > 0 ? `${formatBytes(uploadSpeed)} ${text.perSecond}` : undefined}>{uploadSpeed > 0 ? `${formatBytes(uploadSpeed)}/s` : paused ? "—" : "…"}</span>
            <span>{formatBytes(remainingBytes)} {text.remaining}</span>
            <span>{text.timeRemaining}: {formatDuration(remainingSeconds, language)}</span>
          </div>
        </div>
      )}

      <div className="settings-row">
        <label>
          <span>{text.validFor}</span>
          <span className="select-wrap">
            <select value={days} disabled={uploading || Boolean(recovery)} onChange={(event) => setDays(event.target.value)}>
              <option value="1">1 {text.day}</option><option value="3">3 {text.days}</option><option value="7">7 {text.days}</option>
            </select>
            <ChevronDown size={16} aria-hidden="true" />
          </span>
        </label>
        <label>
          <span>{text.note} <em>{text.optional}</em></span>
          <textarea maxLength={500} rows={2} disabled={uploading || Boolean(recovery)} value={message} onChange={(event) => setMessage(event.target.value)} placeholder={text.placeholder} />
        </label>
      </div>

      {!uploading && !recovery && (
        <div className="terms-consent">
          <input
            id="terms-accepted"
            type="checkbox"
            required
            checked={termsAccepted}
            onChange={(event) => setAcceptedTermsLanguage(event.target.checked ? language : null)}
            aria-labelledby="terms-consent-copy"
          />
          <span id="terms-consent-copy">
            <label htmlFor="terms-accepted">{text.termsAcceptanceStart}{" "}</label>
            <a href="/nutzungsbedingungen" target="_blank" rel="noreferrer">{text.termsTitle}</a>{" "}
            <label htmlFor="terms-accepted">{text.termsAcceptanceMiddle}{" "}</label>
            <a href="/datenschutz" target="_blank" rel="noreferrer">{text.privacyAcknowledgementTitle}</a>
            <label htmlFor="terms-accepted">{language === "de" ? " " : null}{text.termsAcceptanceEnd}</label>
          </span>
        </div>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

      <button
        className="primary-button"
        type="button"
        disabled={!files.length || uploading || !termsAccepted}
        onClick={() => void createTransfer(files)}
      >
        <Send size={18} aria-hidden="true" />
        {text.shareLink}
      </button>

      <div className="sendebude-footer-links">
        <a className="sendebude-data-link" href="/datenschutz"><ShieldCheck size={15} aria-hidden="true" /><span>{text.privacyTitle}</span></a>
        <a className="sendebude-data-link" href="/nutzungsbedingungen"><ScrollText size={15} aria-hidden="true" /><span>{text.termsTitle}</span></a>
        <a className="sendebude-data-link" href="/impressum"><FileText size={15} aria-hidden="true" /><span>{text.imprintTitle}</span></a>
      </div>
    </section>
  );
}
