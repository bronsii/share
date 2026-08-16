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
  chunkIndexFromCiphertextOffset,
  ciphertextOffsetForChunk,
  createNoncePrefix,
  createTransferKey,
  decodeNoncePrefix,
  encodeNoncePrefix,
  encryptedFileSize,
  encryptChunk,
  encryptMetadata,
  importTransferKey,
  PLAINTEXT_CHUNK_SIZE,
  plaintextProgressFromCiphertext,
} from "@/lib/e2e-crypto";
import { formatBytes } from "@/lib/format-bytes";
import { TERMS_VERSION } from "@/lib/terms";
import type { UiLanguage } from "@/lib/ui-language";
import { orderRecoveryFiles, validUploadRecovery } from "@/lib/upload-recovery.mjs";
import { FileGlyph } from "./file-glyph";

const MAX_FILES = 20;
const MAX_TOTAL_SIZE = 5 * 1024 ** 3;
const UPLOAD_RECOVERY_STORAGE_KEY = "share-upload-recovery-v1";

type Language = UiLanguage;

const translations = {
  de: {
    tooManyFiles: (maximum: number) => `Du kannst höchstens ${maximum} Dateien auf einmal teilen.`,
    tooLarge: "Die Übertragung darf insgesamt höchstens 5 GB groß sein.",
    emptyOrFolder: "Ordner oder leere Dateien können nicht hochgeladen werden. Bitte wähle einzelne Dateien oder packe den Ordner als ZIP-Datei.",
    uploadFailed: "Die Übertragung konnte nicht erstellt werden.",
    connectionLost: "Die Verbindung wurde beim Hochladen unterbrochen.",
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
    shareAction: "Link teilen",
    newTransfer: "Neue Übertragung erstellen",
    newTransferKicker: "Neue Übertragung",
    question: "Was möchtest du teilen?",
    chooseFiles: "Dateien auswählen",
    dropLabel: "Dateien hier ablegen oder auswählen",
    dropFiles: "Dateien hier ablegen",
    clickToChoose: "oder klicken, um auszuwählen",
    selectedFiles: "Ausgewählte Dateien",
    ofMaximum: "von 5000\u00a0MB",
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
    cancelUpload: "Gesamten Upload abbrechen und löschen",
    removeUploadingFile: (name: string) => `${name} aus diesem Upload entfernen`,
    removeFileFailed: "Die Datei konnte nicht aus dem Upload entfernt werden.",
    recoveryTitle: "Unterbrochenen Upload fortsetzen",
    recoveryBody: "Wähle dieselben Dateien erneut aus. Danach läuft der Upload automatisch an der letzten bestätigten Stelle weiter.",
    recoveryChoose: "Dateien erneut auswählen",
    recoveryDiscard: "Upload verwerfen",
    recoveryMismatch: "Die ausgewählten Dateien stimmen nicht mit dem unterbrochenen Upload überein.",
    recoveryUnavailable: "Der unterbrochene Upload ist nicht mehr verfügbar. Bitte starte eine neue Übertragung.",
    privacyTitle: "Datenschutz",
    imprintTitle: "Impressum",
    termsTitle: "Nutzungsbedingungen",
    termsAcceptanceStart: "Ich akzeptiere die",
    termsAcceptanceMiddle: "und habe die",
    privacyAcknowledgementTitle: "Datenschutzhinweise",
    termsAcceptanceEnd: "zur Kenntnis genommen.",
    locale: "de-DE",
  },
  en: {
    tooManyFiles: (maximum: number) => `You can share up to ${maximum} files at once.`,
    tooLarge: "The transfer may not exceed 5 GB in total.",
    emptyOrFolder: "Folders or empty files cannot be uploaded. Please choose individual files or create a ZIP archive first.",
    uploadFailed: "The transfer could not be created.",
    connectionLost: "The connection was interrupted during upload.",
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
    shareAction: "Share link",
    newTransfer: "Create another transfer",
    newTransferKicker: "New transfer",
    question: "What are you sharing?",
    chooseFiles: "Choose files",
    dropLabel: "Drop files here or choose files",
    dropFiles: "Drop files here",
    clickToChoose: "or click to choose",
    selectedFiles: "Selected files",
    ofMaximum: "of 5000\u00a0MB",
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
    cancelUpload: "Cancel and delete entire upload",
    removeUploadingFile: (name: string) => `Remove ${name} from this upload`,
    removeFileFailed: "The file could not be removed from the upload.",
    recoveryTitle: "Resume interrupted upload",
    recoveryBody: "Choose the same files again. The upload will automatically continue from the last confirmed position.",
    recoveryChoose: "Choose files again",
    recoveryDiscard: "Discard upload",
    recoveryMismatch: "The selected files do not match the interrupted upload.",
    recoveryUnavailable: "The interrupted upload is no longer available. Please start a new transfer.",
    privacyTitle: "Privacy",
    imprintTitle: "Legal notice",
    termsTitle: "Terms of Use",
    termsAcceptanceStart: "I accept the",
    termsAcceptanceMiddle: "and acknowledge the",
    privacyAcknowledgementTitle: "Privacy Notice",
    termsAcceptanceEnd: ".",
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

type RecoveryFile = {
  name: string;
  size: number;
  lastModified: number;
};

type UploadRecovery = {
  version: 1;
  session: UploadSession;
  fragment: string;
  noncePrefixes: string[];
  files: RecoveryFile[];
  days: string;
  message: string;
};

function loadUploadRecovery() {
  try {
    const stored = window.sessionStorage.getItem(UPLOAD_RECOVERY_STORAGE_KEY);
    if (!stored) return null;
    const recovery: unknown = JSON.parse(stored);
    if (validUploadRecovery(recovery)) return recovery as UploadRecovery;
    window.sessionStorage.removeItem(UPLOAD_RECOVERY_STORAGE_KEY);
  } catch {
    // Beschädigte oder blockierte Sitzungsdaten verhindern keinen neuen Upload.
  }
  return null;
}

function saveUploadRecovery(recovery: UploadRecovery) {
  try {
    window.sessionStorage.setItem(UPLOAD_RECOVERY_STORAGE_KEY, JSON.stringify(recovery));
  } catch {
    // Der Upload funktioniert weiter, nur die Wiederaufnahme nach Reload entfällt.
  }
}

function clearUploadRecovery() {
  try {
    window.sessionStorage.removeItem(UPLOAD_RECOVERY_STORAGE_KEY);
  } catch {
    // Ein blockierter Sitzungsspeicher muss nicht bereinigt werden.
  }
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

function monotonicTimestamp() {
  return performance.now();
}

export function TransferPanel({ language }: { language: Language }) {
  const text = translations[language];
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false);
  const pausedRef = useRef(false);
  const requestRef = useRef<XMLHttpRequest | null>(null);
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
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<UploadResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [recovery, setRecovery] = useState<UploadRecovery | null>(null);
  const [removingFileKey, setRemovingFileKey] = useState<string | null>(null);
  const [cancellingUpload, setCancellingUpload] = useState(false);

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

  const termsAccepted = acceptedTermsLanguage === language;
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
    setUploading(true);
    setPaused(false);
    setFiles(orderedFiles);
    setCurrentFileIndex(0);
    setUploadedBytes(0);
    setUploadSpeed(0);
    setError("");
    speedSampleRef.current = { time: monotonicTimestamp(), bytes: 0, value: 0 };
    const generation = ++uploadGenerationRef.current;

    try {
      const key = await importTransferKey(storedRecovery.fragment);
      const noncePrefixes = storedRecovery.noncePrefixes.map(decodeNoncePrefix);
      sessionRef.current = storedRecovery.session;
      encryptionRef.current = { key, fragment: storedRecovery.fragment, noncePrefixes };
      setRecovery(null);
      await continueUpload(orderedFiles, storedRecovery.session, generation);
    } catch (uploadError) {
      if (sessionRef.current) {
        pausedRef.current = true;
        setPaused(true);
        setUploadSpeed(0);
      } else {
        clearUploadRecovery();
        setRecovery(null);
        uploadingRef.current = false;
        setUploading(false);
        void fetch(`/api/uploads/${storedRecovery.session.id}`, { method: "DELETE" }).catch(() => undefined);
      }
      setError(uploadError instanceof Error ? uploadError.message : text.recoveryUnavailable);
    }
  }

  async function discardRecovery() {
    const storedRecovery = recovery;
    clearUploadRecovery();
    setRecovery(null);
    setError("");
    if (storedRecovery) {
      await fetch(`/api/uploads/${storedRecovery.session.id}`, { method: "DELETE" }).catch(() => undefined);
    }
  }

  async function createTransfer(uploadFiles = files) {
    if (!uploadFiles.length || uploadingRef.current || !termsAccepted) return;
    uploadingRef.current = true;
    pausedRef.current = false;
    setUploading(true);
    setPaused(false);
    setCurrentFileIndex(0);
    setUploadedBytes(0);
    setUploadSpeed(0);
    speedSampleRef.current = { time: monotonicTimestamp(), bytes: 0, value: 0 };
    const generation = ++uploadGenerationRef.current;
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
          terms: { accepted: true, version: TERMS_VERSION, language },
        }),
      });
      const session = await response.json() as UploadSession & { error?: string };
      if (!response.ok || !session.id) throw new Error(session.error || text.uploadFailed);
      sessionRef.current = session;
      persistUploadRecovery(uploadFiles, session, encryptionRef.current);
      await continueUpload(uploadFiles, session, generation);
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
        if (requestRef.current === request) requestRef.current = null;
        if (request.status >= 200 && request.status < 300 && typeof response?.uploaded === "number") resolve(response.uploaded);
        else reject(new Error(response?.error || text.uploadFailed));
      });
      request.addEventListener("error", () => {
        if (requestRef.current === request) requestRef.current = null;
        reject(new Error(text.connectionLost));
      });
      request.addEventListener("abort", () => {
        if (requestRef.current === request) requestRef.current = null;
        reject(new DOMException("Paused", "AbortError"));
      });
      request.send(body);
    });
  }

  async function continueUpload(
    uploadFiles = files,
    knownSession = sessionRef.current,
    generation = uploadGenerationRef.current,
  ) {
    if (!knownSession || pausedRef.current || generation !== uploadGenerationRef.current) return;
    const statusResponse = await fetch(`/api/uploads/${knownSession.id}`, { cache: "no-store" });
    const status = await statusResponse.json() as { files?: Array<{ id: string; uploaded: number }>; error?: string };
    if (generation !== uploadGenerationRef.current) return;
    if (statusResponse.status === 404 || statusResponse.status === 410) {
      const completeResponse = await fetch(`/api/uploads/${knownSession.id}/complete`, { method: "POST" });
      const completed = await completeResponse.json() as UploadResult & { error?: string };
      const encryption = encryptionRef.current;
      if (completeResponse.ok && completed.url && encryption) {
        setUploadedBytes(uploadFiles.reduce((sum, file) => sum + file.size, 0));
        setUploadSpeed(0);
        setResult({ ...completed, url: `${completed.url}#${encryption.fragment}` });
        setCopied(false);
        clearUploadRecovery();
        sessionRef.current = null;
        encryptionRef.current = null;
        uploadingRef.current = false;
        setUploading(false);
        return;
      }
      clearUploadRecovery();
      sessionRef.current = null;
      encryptionRef.current = null;
      throw new Error(text.recoveryUnavailable);
    }
    if (!statusResponse.ok || !status.files) throw new Error(status.error || text.uploadFailed);
    const offsets = new Map(status.files.map((file) => [file.id, file.uploaded]));
    const encryption = encryptionRef.current;
    if (encryption) {
      await continueEncryptedUpload(uploadFiles, knownSession, offsets, encryption, generation);
      return;
    }
    let completedBefore = 0;
    updateProgress(status.files.reduce((sum, file) => sum + file.uploaded, 0));
    try {
      for (let index = 0; index < uploadFiles.length; index += 1) {
        if (generation !== uploadGenerationRef.current) return;
        const file = uploadFiles[index];
        const serverFile = knownSession.files[index];
        setCurrentFileIndex(index);
        let offset = offsets.get(serverFile.id) ?? 0;
        while (offset < file.size) {
          if (pausedRef.current || generation !== uploadGenerationRef.current) return;
          const end = Math.min(offset + PLAINTEXT_CHUNK_SIZE, file.size);
          offset = await uploadChunk(knownSession.id, serverFile.id, file.slice(offset, end), offset, completedBefore + offset, end - offset);
          updateProgress(completedBefore + offset);
        }
        completedBefore += file.size;
      }
      if (generation !== uploadGenerationRef.current) return;
      const completeResponse = await fetch(`/api/uploads/${knownSession.id}/complete`, { method: "POST" });
      const payload = await completeResponse.json() as UploadResult & { error?: string };
      if (generation !== uploadGenerationRef.current) return;
      if (!completeResponse.ok || !payload.url) throw new Error(payload.error || text.uploadFailed);
      setUploadedBytes(uploadFiles.reduce((sum, file) => sum + file.size, 0));
      setUploadSpeed(0);
      setResult(payload);
      setCopied(false);
      clearUploadRecovery();
      sessionRef.current = null;
      uploadingRef.current = false;
      setUploading(false);
    } catch (uploadError) {
      if (generation !== uploadGenerationRef.current) return;
      if (uploadError instanceof DOMException && uploadError.name === "AbortError" && pausedRef.current) return;
      throw uploadError;
    }
  }

  async function continueEncryptedUpload(
    uploadFiles: File[],
    knownSession: UploadSession,
    offsets: Map<string, number>,
    encryption: ClientEncryptionState,
    generation: number,
  ) {
    const resumedPlaintext = knownSession.files.reduce((sum, serverFile, index) => {
      return sum + plaintextProgressFromCiphertext(offsets.get(serverFile.id) ?? 0, uploadFiles[index].size);
    }, 0);
    updateProgress(resumedPlaintext);
    let completedBefore = 0;
    try {
      for (let index = 0; index < uploadFiles.length; index += 1) {
        if (generation !== uploadGenerationRef.current) return;
        const file = uploadFiles[index];
        const serverFile = knownSession.files[index];
        setCurrentFileIndex(index);
        let cipherOffset = offsets.get(serverFile.id) ?? 0;
        let chunkIndex = chunkIndexFromCiphertextOffset(cipherOffset, file.size);
        let plaintextOffset = Math.min(file.size, chunkIndex * PLAINTEXT_CHUNK_SIZE);
        while (plaintextOffset < file.size) {
          if (pausedRef.current || generation !== uploadGenerationRef.current) return;
          const end = Math.min(plaintextOffset + PLAINTEXT_CHUNK_SIZE, file.size);
          const plaintext = await file.slice(plaintextOffset, end).arrayBuffer();
          const ciphertext = await encryptChunk(encryption.key, encryption.noncePrefixes[index], chunkIndex, plaintext);
          if (pausedRef.current || generation !== uploadGenerationRef.current) return;
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
      if (generation !== uploadGenerationRef.current) return;
      const completeResponse = await fetch(`/api/uploads/${knownSession.id}/complete`, { method: "POST" });
      const payload = await completeResponse.json() as UploadResult & { error?: string };
      if (generation !== uploadGenerationRef.current) return;
      if (!completeResponse.ok || !payload.url) throw new Error(payload.error || text.uploadFailed);
      setUploadedBytes(uploadFiles.reduce((sum, file) => sum + file.size, 0));
      setUploadSpeed(0);
      setResult({ ...payload, url: `${payload.url}#${encryption.fragment}` });
      setCopied(false);
      clearUploadRecovery();
      sessionRef.current = null;
      encryptionRef.current = null;
      uploadingRef.current = false;
      setUploading(false);
    } catch (uploadError) {
      if (generation !== uploadGenerationRef.current) return;
      if (uploadError instanceof DOMException && uploadError.name === "AbortError" && pausedRef.current) return;
      throw uploadError;
    }
  }

  function pauseUpload() {
    uploadGenerationRef.current += 1;
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
    speedSampleRef.current = { time: monotonicTimestamp(), bytes: uploadedBytes, value: 0 };
    const generation = ++uploadGenerationRef.current;
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
    if (cancellingUploadRef.current) return;
    cancellingUploadRef.current = true;
    setCancellingUpload(true);
    uploadGenerationRef.current += 1;
    pausedRef.current = true;
    requestRef.current?.abort();
    const session = sessionRef.current;
    clearUploadRecovery();
    sessionRef.current = null;
    encryptionRef.current = null;
    if (session) await fetch(`/api/uploads/${session.id}`, { method: "DELETE" }).catch(() => undefined);
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
    const generation = ++uploadGenerationRef.current;
    pausedRef.current = true;
    requestRef.current?.abort();
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
      const response = await fetch(`/api/uploads/${session.id}/${serverFile.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ encryption: { version: 1, metadata: encryptedMetadata } }),
      });
      const updated = await response.json() as UploadSession & { error?: string };
      if (!response.ok || !updated.id || updated.files.length !== remainingFiles.length) {
        throw new Error(updated.error || text.removeFileFailed);
      }

      const nextEncryption = { ...encryption, noncePrefixes: remainingNoncePrefixes };
      sessionRef.current = updated;
      encryptionRef.current = nextEncryption;
      setFiles(remainingFiles);
      setCurrentFileIndex(Math.min(index, remainingFiles.length - 1));
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
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button" type="button" onClick={shareLink}>
          {copied ? <Check size={18} /> : <Send size={18} />}
          {copied ? text.linkCopied : text.shareAction}
        </button>
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
        <div>
          <p className="panel-kicker">{text.newTransferKicker}</p>
          <h2 id="transfer-title">{text.question}</h2>
        </div>
        <div className="limit-pill">max. 5{"\u00a0"}GB</div>
      </div>

      {recovery && (
        <div className="upload-recovery" role="status">
          <div>
            <strong>{text.recoveryTitle}</strong>
            <span>{text.recoveryBody}</span>
          </div>
          <div className="upload-recovery-actions">
            <button type="button" onClick={() => inputRef.current?.click()}>{text.recoveryChoose}</button>
            <button type="button" onClick={() => void discardRecovery()}>{text.recoveryDiscard}</button>
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
          <span>{files.length} {files.length === 1 ? text.file : text.files}</span>
          <span>
            {uploading ? <><strong>{formatBytes(uploadedBytes)}</strong> / {formatBytes(totalSize)} {text.uploaded}</> : <><strong>{formatBytes(totalSize)}</strong> {text.ofMaximum}</>}
          </span>
        </div>
      )}

      {files.length > 0 && (
        <div className="file-list" aria-label={text.selectedFiles}>
          {files.map((file, index) => {
            const fileUploadedBytes = uploadedBytesForFile(index);
            const fileProgress = file.size ? Math.min(100, Math.round((fileUploadedBytes / file.size) * 100)) : 100;
            const isCurrentUpload = uploading && index === currentFileIndex;
            return (
              <div className="file-row" key={fileKey(file)}>
                <span className="file-glyph" aria-hidden="true"><FileGlyph name={file.name} type={file.type} size={19} /></span>
                <span className="file-name" title={file.name}>{file.name}</span>
                <span className="file-progress" aria-label={uploading ? `${fileProgress}% ${text.uploaded}` : undefined}>{uploading ? `${fileProgress}%` : ""}</span>
                <span className="file-speed" aria-label={isCurrentUpload && uploadSpeed > 0 ? `${formatBytes(uploadSpeed)} ${text.perSecond}` : undefined}>
                  {isCurrentUpload && uploadSpeed > 0 ? `${formatBytes(uploadSpeed)}/s` : ""}
                </span>
                <span className="file-size">
                  {uploading ? <><strong>{formatBytes(fileUploadedBytes)}</strong> / {formatBytes(file.size)}</> : formatBytes(file.size)}
                </span>
                <span className="file-actions">
                  {isCurrentUpload && (
                    <button type="button" disabled={Boolean(removingFileKey) || cancellingUpload} onClick={paused ? resumeUpload : pauseUpload} aria-label={paused ? text.resumeUpload : text.pauseUpload}>
                      {paused ? <Play size={16} /> : <Pause size={16} />}
                    </button>
                  )}
                  <button type="button" disabled={Boolean(removingFileKey) || cancellingUpload || (uploading && totalProgress >= 100)} onClick={() => void removeFile(index)} aria-label={uploading ? text.removeUploadingFile(file.name) : `${file.name} ${text.remove}`}><Trash2 size={16} /></button>
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
            <button className="upload-cancel-all" type="button" disabled={Boolean(removingFileKey) || cancellingUpload} onClick={() => void cancelUpload()} aria-label={text.cancelUpload} title={text.cancelUpload}>
              <Trash2 size={16} />
            </button>
          </div>
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
