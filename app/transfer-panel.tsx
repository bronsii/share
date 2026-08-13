"use client";

import {
  Check,
  ChevronDown,
  Clipboard,
  FileArchive,
  FileImage,
  FileText,
  Pause,
  Play,
  Plus,
  Send,
  ShieldCheck,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { ChangeEvent, DragEvent, KeyboardEvent, useRef, useState } from "react";
import {
  chunkIndexFromCiphertextOffset,
  ciphertextOffsetForChunk,
  createNoncePrefix,
  createTransferKey,
  encodeNoncePrefix,
  encryptedFileSize,
  encryptChunk,
  encryptMetadata,
  PLAINTEXT_CHUNK_SIZE,
  plaintextProgressFromCiphertext,
} from "@/lib/e2e-crypto";

const MAX_FILES = 20;
const MAX_TOTAL_SIZE = 5 * 1024 ** 3;

export type Language = "de" | "en";

const translations = {
  de: {
    tooManyFiles: (maximum: number) => `Du kannst höchstens ${maximum} Dateien auf einmal teilen.`,
    tooLarge: "Die Übertragung darf insgesamt höchstens 5 GB groß sein.",
    emptyOrFolder: "Ordner oder leere Dateien können nicht hochgeladen werden. Bitte wähle einzelne Dateien oder packe den Ordner als ZIP-Datei.",
    uploadFailed: "Die Übertragung konnte nicht erstellt werden.",
    connectionLost: "Die Verbindung wurde beim Hochladen unterbrochen.",
    uploadAborted: "Der Upload wurde abgebrochen.",
    copyManually: "Bitte markiere den Link und kopiere ihn manuell.",
    shareTitle: "Freigabelink",
    ready: "Bereit zum Teilen",
    linkReady: "Dein Link ist fertig.",
    resultCopy: (plural: boolean) => `Jeder mit diesem Link kann die ${plural ? "Dateien" : "Datei"} bis zum Ablaufdatum herunterladen.`,
    openLink: "Freigabelink öffnen",
    copyLink: "Freigabelink kopieren",
    file: "Datei",
    files: "Dateien",
    until: "bis",
    linkCopied: "Link kopiert",
    shareLink: "Hochladen & Link erstellen",
    newTransfer: "Neue Übertragung erstellen",
    newTransferKicker: "Neue Übertragung",
    question: "Was möchtest du teilen?",
    chooseFiles: "Dateien auswählen",
    dropLabel: "Dateien hier ablegen oder auswählen",
    dropFiles: "Dateien hier ablegen",
    clickToChoose: "oder klicken, um auszuwählen",
    selectedFiles: "Ausgewählte Dateien",
    uploaded: "hochgeladen",
    perSecond: "pro Sekunde",
    remaining: "verbleibend",
    timeRemaining: "Restzeit",
    remove: "entfernen",
    pauseUpload: "Upload pausieren",
    resumeUpload: "Upload fortsetzen",
    validFor: "Link gültig für",
    day: "Tag",
    days: "Tage",
    note: "Notiz",
    optional: "optional",
    placeholder: "z. B. hier sind die Urlaubsfotos …",
    cancelUpload: "Upload abbrechen und l\u00f6schen",
    privacy: "Ende-zu-Ende verschlüsselt: Dateien werden vor dem Upload im Browser verschlüsselt. Der Schlüssel bleibt im Freigabelink. Automatische Löschung nach Ablauf.",
    locale: "de-DE",
  },
  en: {
    tooManyFiles: (maximum: number) => `You can share up to ${maximum} files at once.`,
    tooLarge: "The transfer may not exceed 5 GB in total.",
    emptyOrFolder: "Folders or empty files cannot be uploaded. Please choose individual files or create a ZIP archive first.",
    uploadFailed: "The transfer could not be created.",
    connectionLost: "The connection was interrupted during upload.",
    uploadAborted: "The upload was cancelled.",
    copyManually: "Please select the link and copy it manually.",
    shareTitle: "Share link",
    ready: "Ready to share",
    linkReady: "Your link is ready.",
    resultCopy: (plural: boolean) => `Anyone with this link can download the ${plural ? "files" : "file"} until it expires.`,
    openLink: "Open share link",
    copyLink: "Copy share link",
    file: "file",
    files: "files",
    until: "until",
    linkCopied: "Link copied",
    shareLink: "Upload & create link",
    newTransfer: "Create another transfer",
    newTransferKicker: "New transfer",
    question: "What are you sharing?",
    chooseFiles: "Choose files",
    dropLabel: "Drop files here or choose files",
    dropFiles: "Drop files here",
    clickToChoose: "or click to choose",
    selectedFiles: "Selected files",
    uploaded: "uploaded",
    perSecond: "per second",
    remaining: "remaining",
    timeRemaining: "Time remaining",
    remove: "remove",
    pauseUpload: "Pause upload",
    resumeUpload: "Resume upload",
    validFor: "Link valid for",
    day: "day",
    days: "days",
    note: "Note",
    optional: "optional",
    placeholder: "e.g. here are the holiday photos …",
    cancelUpload: "Cancel and delete upload",
    privacy: "End-to-end encrypted: Files are encrypted in your browser before upload. The key remains in the share link. Automatic deletion after expiry.",
    locale: "en-GB",
  },
} as const;

type UploadResult = {
  id: string;
  url: string;
  expiresAt: string;
};

type UploadSession = {
  id: string;
  expiresAt: string;
  files: Array<{ id: string; name: string; size: number; uploaded: number }>;
};

type ClientEncryptionState = {
  key: CryptoKey;
  fragment: string;
  noncePrefixes: Uint8Array[];
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(bytes < 10 * 1024 ** 3 ? 1 : 0)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
}

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

function FileGlyph({ file }: { file: File }) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const isArchive = ["zip", "rar", "7z", "tar", "gz"].includes(extension ?? "");
  if (file.type.startsWith("image/")) return <FileImage size={19} />;
  if (isArchive) return <FileArchive size={19} />;
  return <FileText size={19} />;
}

export function TransferPanel({ language }: { language: Language }) {
  const text = translations[language];
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false);
  const pausedRef = useRef(false);
  const requestRef = useRef<XMLHttpRequest | null>(null);
  const sessionRef = useRef<UploadSession | null>(null);
  const encryptionRef = useRef<ClientEncryptionState | null>(null);
  const speedSampleRef = useRef({ time: 0, bytes: 0, value: 0 });
  const [files, setFiles] = useState<File[]>([]);
  const [days, setDays] = useState("3");
  const [message, setMessage] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [paused, setPaused] = useState(false);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<UploadResult | null>(null);
  const [copied, setCopied] = useState(false);

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  const remainingBytes = Math.max(0, totalSize - uploadedBytes);
  const totalProgress = totalSize ? Math.min(100, Math.round((uploadedBytes / totalSize) * 100)) : 0;
  const remainingSeconds = uploadSpeed > 0 ? remainingBytes / uploadSpeed : 0;

  function uploadedBytesForFile(index: number) {
    const previousBytes = files.slice(0, index).reduce((sum, file) => sum + file.size, 0);
    return Math.min(files[index].size, Math.max(0, uploadedBytes - previousBytes));
  }

  function addFiles(incoming: File[]) {
    if (uploadingRef.current) return;
    setError("");
    setResult(null);
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
    void createTransfer(next);
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

  async function createTransfer(uploadFiles = files) {
    if (!uploadFiles.length || uploadingRef.current) return;
    uploadingRef.current = true;
    pausedRef.current = false;
    setUploading(true);
    setPaused(false);
    setCurrentFileIndex(0);
    setUploadedBytes(0);
    setUploadSpeed(0);
    speedSampleRef.current = { time: performance.now(), bytes: 0, value: 0 };
    setError("");
    try {
      const { key, fragment } = await createTransferKey();
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
      encryptionRef.current = { key, fragment, noncePrefixes };
      const response = await fetch("/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: uploadFiles.map((file) => ({ size: encryptedFileSize(file.size), plaintextSize: file.size })),
          days: Number(days),
          encryption: { version: 1, metadata: encryptedMetadata },
        }),
      });
      const session = await response.json() as UploadSession & { error?: string };
      if (!response.ok || !session.id) throw new Error(session.error || text.uploadFailed);
      sessionRef.current = session;
      await continueUpload(uploadFiles, session);
    } catch (uploadError) {
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

  function updateProgress(bytes: number) {
    setUploadedBytes(bytes);
    const now = performance.now();
    const sample = speedSampleRef.current;
    const elapsed = (now - sample.time) / 1000;
    if (elapsed < 1) return;
    const instant = Math.max(0, bytes - sample.bytes) / elapsed;
    const smoothed = sample.value ? sample.value * 0.7 + instant * 0.3 : instant;
    speedSampleRef.current = { time: now, bytes, value: smoothed };
    setUploadSpeed(smoothed);
  }

  function uploadChunk(
    sessionId: string,
    fileId: string,
    body: Blob | ArrayBuffer,
    offset: number,
    progressStart: number,
    progressBytes: number,
  ) {
    return new Promise<number>((resolve, reject) => {
      const request = new XMLHttpRequest();
      requestRef.current = request;
      request.open("PUT", `/api/uploads/${sessionId}/${fileId}`);
      request.responseType = "json";
      request.setRequestHeader("X-Upload-Offset", String(offset));
      const requestBytes = body instanceof Blob ? body.size : body.byteLength;
      request.upload.addEventListener("progress", (event) => {
        const fraction = requestBytes > 0 ? Math.min(1, event.loaded / requestBytes) : 0;
        updateProgress(progressStart + progressBytes * fraction);
      });
      request.addEventListener("load", () => {
        const response = request.response as { uploaded?: number; error?: string } | null;
        if (request.status >= 200 && request.status < 300 && typeof response?.uploaded === "number") resolve(response.uploaded);
        else reject(new Error(response?.error || text.uploadFailed));
      });
      request.addEventListener("error", () => reject(new Error(text.connectionLost)));
      request.addEventListener("abort", () => reject(new DOMException("Paused", "AbortError")));
      request.send(body);
    });
  }

  async function continueUpload(uploadFiles = files, knownSession = sessionRef.current) {
    if (!knownSession || pausedRef.current) return;
    const statusResponse = await fetch(`/api/uploads/${knownSession.id}`, { cache: "no-store" });
    const status = await statusResponse.json() as { files?: Array<{ id: string; uploaded: number }>; error?: string };
    if (!statusResponse.ok || !status.files) throw new Error(status.error || text.uploadFailed);
    const offsets = new Map(status.files.map((file) => [file.id, file.uploaded]));
    const encryption = encryptionRef.current;
    if (encryption) {
      await continueEncryptedUpload(uploadFiles, knownSession, offsets, encryption);
      return;
    }
    let completedBefore = 0;
    updateProgress(status.files.reduce((sum, file) => sum + file.uploaded, 0));
    try {
      for (let index = 0; index < uploadFiles.length; index += 1) {
        const file = uploadFiles[index];
        const serverFile = knownSession.files[index];
        setCurrentFileIndex(index);
        let offset = offsets.get(serverFile.id) ?? 0;
        while (offset < file.size) {
          if (pausedRef.current) return;
          const end = Math.min(offset + PLAINTEXT_CHUNK_SIZE, file.size);
          offset = await uploadChunk(knownSession.id, serverFile.id, file.slice(offset, end), offset, completedBefore + offset, end - offset);
          updateProgress(completedBefore + offset);
        }
        completedBefore += file.size;
      }
      const completeResponse = await fetch(`/api/uploads/${knownSession.id}/complete`, { method: "POST" });
      const payload = await completeResponse.json() as UploadResult & { error?: string };
      if (!completeResponse.ok || !payload.url) throw new Error(payload.error || text.uploadFailed);
      setUploadedBytes(uploadFiles.reduce((sum, file) => sum + file.size, 0));
      setUploadSpeed(0);
      setResult(payload);
      setCopied(false);
      sessionRef.current = null;
      uploadingRef.current = false;
      setUploading(false);
    } catch (uploadError) {
      if (uploadError instanceof DOMException && uploadError.name === "AbortError" && pausedRef.current) return;
      throw uploadError;
    } finally {
      requestRef.current = null;
    }
  }

  async function continueEncryptedUpload(
    uploadFiles: File[],
    knownSession: UploadSession,
    offsets: Map<string, number>,
    encryption: ClientEncryptionState,
  ) {
    const resumedPlaintext = knownSession.files.reduce((sum, serverFile, index) => {
      return sum + plaintextProgressFromCiphertext(offsets.get(serverFile.id) ?? 0, uploadFiles[index].size);
    }, 0);
    updateProgress(resumedPlaintext);
    let completedBefore = 0;
    try {
      for (let index = 0; index < uploadFiles.length; index += 1) {
        const file = uploadFiles[index];
        const serverFile = knownSession.files[index];
        setCurrentFileIndex(index);
        let cipherOffset = offsets.get(serverFile.id) ?? 0;
        let chunkIndex = chunkIndexFromCiphertextOffset(cipherOffset, file.size);
        let plaintextOffset = Math.min(file.size, chunkIndex * PLAINTEXT_CHUNK_SIZE);
        while (plaintextOffset < file.size) {
          if (pausedRef.current) return;
          const end = Math.min(plaintextOffset + PLAINTEXT_CHUNK_SIZE, file.size);
          const plaintext = await file.slice(plaintextOffset, end).arrayBuffer();
          const ciphertext = await encryptChunk(encryption.key, encryption.noncePrefixes[index], chunkIndex, plaintext);
          if (pausedRef.current) return;
          if (cipherOffset !== ciphertextOffsetForChunk(chunkIndex)) throw new Error(text.uploadFailed);
          cipherOffset = await uploadChunk(
            knownSession.id,
            serverFile.id,
            ciphertext,
            cipherOffset,
            completedBefore + plaintextOffset,
            end - plaintextOffset,
          );
          plaintextOffset = end;
          chunkIndex += 1;
          updateProgress(completedBefore + plaintextOffset);
        }
        completedBefore += file.size;
      }
      const completeResponse = await fetch(`/api/uploads/${knownSession.id}/complete`, { method: "POST" });
      const payload = await completeResponse.json() as UploadResult & { error?: string };
      if (!completeResponse.ok || !payload.url) throw new Error(payload.error || text.uploadFailed);
      setUploadedBytes(uploadFiles.reduce((sum, file) => sum + file.size, 0));
      setUploadSpeed(0);
      setResult({ ...payload, url: `${payload.url}#${encryption.fragment}` });
      setCopied(false);
      sessionRef.current = null;
      encryptionRef.current = null;
      uploadingRef.current = false;
      setUploading(false);
    } catch (uploadError) {
      if (uploadError instanceof DOMException && uploadError.name === "AbortError" && pausedRef.current) return;
      throw uploadError;
    } finally {
      requestRef.current = null;
    }
  }

  function pauseUpload() {
    pausedRef.current = true;
    setPaused(true);
    setUploadSpeed(0);
    requestRef.current?.abort();
  }

  function resumeUpload() {
    if (!sessionRef.current || !pausedRef.current) return;
    pausedRef.current = false;
    setPaused(false);
    setError("");
    speedSampleRef.current = { time: performance.now(), bytes: uploadedBytes, value: 0 };
    void continueUpload().catch((uploadError) => {
      pausedRef.current = true;
      setPaused(true);
      setUploadSpeed(0);
      setError(uploadError instanceof Error ? uploadError.message : text.uploadFailed);
    });
  }

  async function cancelUpload() {
    pausedRef.current = true;
    requestRef.current?.abort();
    const session = sessionRef.current;
    sessionRef.current = null;
    encryptionRef.current = null;
    if (session) await fetch(`/api/uploads/${session.id}`, { method: "DELETE" }).catch(() => undefined);
    uploadingRef.current = false;
    setUploading(false);
    setPaused(false);
    setFiles([]);
    setUploadedBytes(0);
    setUploadSpeed(0);
    setError("");
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
    setResult(null);
    setCopied(false);
    setUploadedBytes(0);
    setUploadSpeed(0);
    uploadingRef.current = false;
    pausedRef.current = false;
    sessionRef.current = null;
    encryptionRef.current = null;
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
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button" type="button" onClick={shareLink}>
          {copied ? <Check size={18} /> : <Send size={18} />}
          {copied ? text.linkCopied : text.shareLink}
        </button>
        <p className="privacy-note"><ShieldCheck size={15} aria-hidden="true" /><span>{text.privacy}</span></p>
        <button className="text-button" type="button" onClick={reset}>{text.newTransfer}</button>
      </section>
    );
  }

  return (
    <section className="transfer-card" aria-labelledby="transfer-title">
      <div className="card-heading">
        <div>
          <p className="panel-kicker">{text.newTransferKicker}</p>
          <h2 id="transfer-title">{text.question}</h2>
        </div>
        <div className="limit-pill">max. 5{"\u00a0"}GB</div>
      </div>

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
        <div className="file-list" aria-label={text.selectedFiles}>
          <div className="file-list-heading"><span>{files.length} {files.length === 1 ? text.file : text.files}</span><span>{formatBytes(totalSize)}</span></div>
          {files.map((file, index) => {
            const fileUploadedBytes = uploadedBytesForFile(index);
            const fileProgress = file.size ? Math.min(100, Math.round((fileUploadedBytes / file.size) * 100)) : 100;
            const isCurrentUpload = uploading && index === currentFileIndex;
            return (
              <div className="file-row" key={fileKey(file)}>
                <span className="file-glyph" aria-hidden="true"><FileGlyph file={file} /></span>
                <span className="file-name" title={file.name}>{file.name}</span>
                <span className="file-progress" aria-label={`${fileProgress}% ${text.uploaded}`}>{fileProgress}%</span>
                <span className="file-speed" aria-label={isCurrentUpload && uploadSpeed > 0 ? `${formatBytes(uploadSpeed)} ${text.perSecond}` : undefined}>
                  {isCurrentUpload && uploadSpeed > 0 ? `${formatBytes(uploadSpeed)}/s` : ""}
                </span>
                <span className="file-size"><strong>{formatBytes(fileUploadedBytes)}</strong> / {formatBytes(file.size)}</span>
                <span className="file-actions">
                  {isCurrentUpload && (
                    <button className="pause-button" type="button" onClick={paused ? resumeUpload : pauseUpload} aria-label={paused ? text.resumeUpload : text.pauseUpload}>
                      {paused ? <Play size={16} /> : <Pause size={16} />}
                    </button>
                  )}
                  <button type="button" onClick={() => uploading ? void cancelUpload() : setFiles((current) => current.filter((item) => fileKey(item) !== fileKey(file)))} aria-label={uploading ? text.cancelUpload : `${file.name} ${text.remove}`}><Trash2 size={16} /></button>
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
          <progress max="100" value={totalProgress} aria-label={`${totalProgress} % ${text.uploaded}`} />
          <div className="upload-summary-line upload-summary-details">
            <span>{uploadSpeed > 0 ? `${formatBytes(uploadSpeed)}/s` : paused ? "—" : "…"}</span>
            <span>{formatBytes(remainingBytes)} {text.remaining}</span>
            <span>{text.timeRemaining}: {formatDuration(remainingSeconds, language)}</span>
          </div>
        </div>
      )}

      <div className="settings-row">
        <label>
          <span>{text.validFor}</span>
          <span className="select-wrap">
            <select value={days} disabled={uploading} onChange={(event) => setDays(event.target.value)}>
              <option value="1">1 {text.day}</option><option value="3">3 {text.days}</option><option value="7">7 {text.days}</option>
            </select>
            <ChevronDown size={16} aria-hidden="true" />
          </span>
        </label>
        <label>
          <span>{text.note} <em>{text.optional}</em></span>
          <textarea maxLength={500} rows={2} disabled={uploading} value={message} onChange={(event) => setMessage(event.target.value)} placeholder={text.placeholder} />
        </label>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      <button
        className="primary-button"
        type="button"
        disabled={!files.length || uploading}
        onClick={() => void createTransfer(files)}
      >
        <Send size={18} aria-hidden="true" />
        {text.shareLink}
      </button>

      <p className="privacy-note"><ShieldCheck size={15} aria-hidden="true" /><span>{text.privacy}</span></p>
    </section>
  );
}
