"use client";

import {
  Check,
  ChevronDown,
  Clipboard,
  FileArchive,
  FileImage,
  FileText,
  LoaderCircle,
  Plus,
  Send,
  ShieldCheck,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { ChangeEvent, DragEvent, KeyboardEvent, useRef, useState } from "react";

const MAX_FILES = 20;
const MAX_TOTAL_SIZE = 15 * 1024 ** 3;

type UploadResult = {
  id: string;
  url: string;
  expiresAt: string;
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(bytes < 10 * 1024 ** 3 ? 1 : 0)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
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

export function TransferPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false);
  const [files, setFiles] = useState<File[]>([]);
  const [days, setDays] = useState("3");
  const [message, setMessage] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<UploadResult | null>(null);
  const [copied, setCopied] = useState(false);

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);

  function uploadedBytesForFile(index: number) {
    const previousBytes = files.slice(0, index).reduce((sum, file) => sum + file.size, 0);
    return Math.min(files[index].size, Math.max(0, uploadedBytes - previousBytes));
  }

  function addFiles(incoming: File[]) {
    if (uploadingRef.current) return;
    setError("");
    setResult(null);
    const known = new Set(files.map(fileKey));
    const unique = incoming.filter((file) => !known.has(fileKey(file)));
    const next = [...files, ...unique];
    if (next.length > MAX_FILES) {
      setError(`Du kannst höchstens ${MAX_FILES} Dateien auf einmal teilen.`);
      return;
    }
    const size = next.reduce((sum, file) => sum + file.size, 0);
    if (size > MAX_TOTAL_SIZE) {
      setError("Die Übertragung darf insgesamt höchstens 15GB groß sein.");
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
    setUploading(true);
    setUploadedBytes(0);
    setError("");
    try {
      const body = new FormData();
      uploadFiles.forEach((file) => body.append("files", file));
      body.append("days", days);
      body.append("message", message.trim());
      const payload = await new Promise<UploadResult>((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open("POST", "/api/transfers");
        request.responseType = "json";
        request.upload.addEventListener("progress", (event) => {
          if (!event.lengthComputable) return;
          setUploadedBytes(Math.min(event.loaded, uploadFiles.reduce((sum, file) => sum + file.size, 0)));
        });
        request.addEventListener("load", () => {
          const response = request.response as (UploadResult & { error?: string }) | null;
          if (request.status >= 200 && request.status < 300 && response?.url) {
            setUploadedBytes(uploadFiles.reduce((sum, file) => sum + file.size, 0));
            resolve(response);
            return;
          }
          reject(new Error(response?.error || "Die Übertragung konnte nicht erstellt werden."));
        });
        request.addEventListener("error", () => reject(new Error("Die Verbindung wurde beim Hochladen unterbrochen.")));
        request.addEventListener("abort", () => reject(new Error("Der Upload wurde abgebrochen.")));
        request.send(body);
      });
      setResult(payload);
      setCopied(false);
    } catch (uploadError) {
      setUploadedBytes(0);
      setError(uploadError instanceof Error ? uploadError.message : "Die Übertragung konnte nicht erstellt werden.");
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  }

  async function copyLink() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      setError("Bitte markiere den Link und kopiere ihn manuell.");
    }
  }

  async function shareLink() {
    if (!result) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Freigabelink", url: result.url });
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
    uploadingRef.current = false;
    setError("");
  }

  if (result) {
    return (
      <section className="transfer-card result-card" aria-live="polite">
        <div className="success-mark"><Check size={26} strokeWidth={2.5} aria-hidden="true" /></div>
        <p className="panel-kicker">Bereit zum Teilen</p>
        <h2>Dein Link ist fertig.</h2>
        <p className="result-copy">
          Jeder mit diesem Link kann die {files.length === 1 ? "Datei" : "Dateien"} bis zum Ablaufdatum herunterladen.
        </p>
        <div className="share-link-row">
          <a className="share-link" href={result.url} target="_blank" rel="noreferrer" aria-label="Freigabelink öffnen">
            {result.url}
          </a>
          <button type="button" onClick={copyLink} aria-label="Freigabelink kopieren">
            {copied ? <Check size={18} /> : <Clipboard size={18} />}
          </button>
        </div>
        <div className="result-meta">
          <span>{files.length} {files.length === 1 ? "Datei" : "Dateien"}</span>
          <span>{formatBytes(totalSize)}</span>
          <span>bis {new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(new Date(result.expiresAt))}</span>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button" type="button" onClick={shareLink}>
          {copied ? <Check size={18} /> : <Send size={18} />}
          {copied ? "Link kopiert" : "Freigabelink teilen"}
        </button>
        <button className="text-button" type="button" onClick={reset}>Neue Übertragung erstellen</button>
      </section>
    );
  }

  return (
    <section className="transfer-card" aria-labelledby="transfer-title">
      <div className="card-heading">
        <div>
          <p className="panel-kicker">Neue Übertragung</p>
          <h2 id="transfer-title">Was möchtest du teilen?</h2>
        </div>
        <div className="limit-pill">max. 15GB</div>
      </div>

      <input ref={inputRef} className="sr-only" type="file" multiple disabled={uploading} onChange={onFilesSelected} aria-label="Dateien auswählen" />

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
        aria-label="Dateien hier ablegen oder auswählen"
      >
        <div className="upload-icon"><UploadCloud size={24} aria-hidden="true" /></div>
        <div><strong>Dateien hier ablegen</strong><span>oder klicken, um auszuwählen</span></div>
        <Plus className="dropzone-plus" size={20} aria-hidden="true" />
      </div>

      {files.length > 0 && (
        <div className="file-list" aria-label="Ausgewählte Dateien">
          <div className="file-list-heading"><span>{files.length} {files.length === 1 ? "Datei" : "Dateien"}</span><span>{formatBytes(totalSize)}</span></div>
          {files.map((file, index) => {
            const fileUploadedBytes = uploadedBytesForFile(index);
            const fileProgress = file.size ? Math.min(100, Math.round((fileUploadedBytes / file.size) * 100)) : 100;
            return (
              <div className="file-row" key={fileKey(file)}>
                <span className="file-progress" aria-label={`${fileProgress}% hochgeladen`}>{fileProgress}%</span>
                <span className="file-glyph" aria-hidden="true"><FileGlyph file={file} /></span>
                <span className="file-name" title={file.name}>{file.name}</span>
                <span className="file-size"><strong>{formatBytes(fileUploadedBytes)}</strong> / {formatBytes(file.size)}</span>
                <button type="button" disabled={uploading} onClick={() => setFiles((current) => current.filter((item) => fileKey(item) !== fileKey(file)))} aria-label={`${file.name} entfernen`}><Trash2 size={16} /></button>
              </div>
            );
          })}
        </div>
      )}

      <div className="settings-row">
        <label>
          <span>Link gültig für</span>
          <span className="select-wrap">
            <select value={days} disabled={uploading} onChange={(event) => setDays(event.target.value)}>
              <option value="1">1 Tag</option><option value="3">3 Tage</option><option value="7">7 Tage</option>
            </select>
            <ChevronDown size={16} aria-hidden="true" />
          </span>
        </label>
        <label>
          <span>Notiz <em>optional</em></span>
          <textarea maxLength={500} rows={2} disabled={uploading} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="z. b. hier sind die urlaubsfotos …" />
        </label>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      <button className="primary-button" type="button" disabled={!files.length || uploading} onClick={() => void createTransfer(files)}>
        {uploading ? <LoaderCircle className="spinner" size={19} aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}
        {uploading ? "Upload läuft …" : "Freigabelink teilen"}
      </button>

      <p className="privacy-note"><ShieldCheck size={15} aria-hidden="true" />Der Link ist zufällig und wird nicht öffentlich gelistet.</p>
    </section>
  );
}
