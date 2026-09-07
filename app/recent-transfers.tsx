"use client";

import { Bookmark, Check, Clipboard, ExternalLink, History, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { UiLanguage } from "@/lib/ui-language";
import {
  browserRecentTransferStorage, clearRecentTransfers, forgetRecentTransfer, MAX_RECENT_TRANSFERS,
  notifyRecentTransfersChanged, readRecentTransfers, saveRecentTransfer, subscribeRecentTransfers,
  type RecentTransfersState, type TransferToRemember,
} from "@/lib/recent-transfers";
import styles from "./recent-transfers.module.css";

function useRecentTransfers() {
  const [state, setState] = useState<RecentTransfersState & { loaded: boolean }>({ entries: [], available: true, loaded: false });
  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (active) setState({ ...readRecentTransfers(browserRecentTransferStorage(), window.location.origin), loaded: true });
    };
    // Browser storage is deliberately absent from server rendering and hydration.
    queueMicrotask(refresh);
    const unsubscribe = subscribeRecentTransfers(refresh);
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      unsubscribe();
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return state;
}

export function RememberTransfer({ url, managementUrl, expiresAt, language }: TransferToRemember & { language: UiLanguage }) {
  const de = language === "de";
  const { entries, loaded } = useRecentTransfers();
  const [error, setError] = useState(false);
  const remembered = entries.find((entry) => entry.url === url);

  function toggleRemember() {
    const storage = browserRecentTransferStorage();
    const ok = remembered
      ? forgetRecentTransfer(remembered.id, storage, window.location.origin)
      : saveRecentTransfer({ url, managementUrl, expiresAt }, storage, window.location.origin);
    setError(!ok);
    if (ok) notifyRecentTransfersChanged();
  }

  return <div className={styles.remember}>
    <p className={styles.rememberTitle}>{de ? "Für später auf diesem Gerät" : "For later on this device"}</p>
    <p>{de
      ? "Nur wenn du möchtest: Speichere diese Freigabe mit Schlüssel und privatem Löschlink in diesem Browser. Andere mit Zugriff auf dieses Browserprofil können die Dateien öffnen und löschen. Nicht auf gemeinsam genutzten Geräten speichern."
      : "Only if you choose: save this share, its key and private deletion link in this browser. Others with access to this browser profile can open and delete the files. Do not save on shared devices."}</p>
    <button type="button" className={styles.action} disabled={!loaded} onClick={toggleRemember}>
      {remembered ? <Check size={16} aria-hidden="true" /> : <Bookmark size={16} aria-hidden="true" />}
      {remembered ? (de ? "Hier gemerkt · lokal entfernen" : "Saved here · remove locally") : (de ? "Diese Freigabe auf diesem Gerät merken" : "Remember this share on this device")}
    </button>
    <p className={styles.finePrint}>{de
      ? `Höchstens ${MAX_RECENT_TRANSFERS} Freigaben. Keine Dateien gespeichert. Lokal entfernen löscht nichts auf dem Server. Nach Ablauf wird der Eintrag beim nächsten Öffnen der Seite oder während ihrer Nutzung entfernt.`
      : `Up to ${MAX_RECENT_TRANSFERS} shares. No files stored. Removing a local entry does not delete files from the server. Expired entries are removed when the page is next opened or while it is in use.`}</p>
    {error && <p role="alert">{de ? "Nicht gespeichert oder entfernt: Der Browserspeicher ist gesperrt/voll oder die Freigabe ist abgelaufen. Bewahre die Links bei Bedarf selbst sicher auf." : "Could not save or remove: browser storage is blocked/full or the share has expired. Keep the links somewhere safe if needed."}</p>}
  </div>;
}

export function RecentTransfers({ language }: { language: UiLanguage }) {
  const de = language === "de";
  const { entries, available, loaded } = useRecentTransfers();
  const [feedback, setFeedback] = useState<{ kind: "copied" | "forgotten" | "cleared" | "storage-error" | "copy-error"; id?: string } | null>(null);
  const formatDate = (date: string) => new Intl.DateTimeFormat(de ? "de-DE" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(date));

  function forget(id?: string) {
    const storage = browserRecentTransferStorage();
    const ok = id ? forgetRecentTransfer(id, storage, window.location.origin) : clearRecentTransfers(storage);
    setFeedback({ kind: ok ? (id ? "forgotten" : "cleared") : "storage-error" });
    if (ok) notifyRecentTransfersChanged();
  }

  async function copy(url: string, id: string) {
    try { await navigator.clipboard.writeText(url); setFeedback({ kind: "copied", id }); }
    catch { setFeedback({ kind: "copy-error", id }); }
  }

  // An ordinary visit has no history panel or hydration-only loading placeholder.
  // Keep a compact confirmation visible after removing the last local entry.
  const removalFeedback = feedback?.kind === "forgotten" || feedback?.kind === "cleared" || feedback?.kind === "storage-error";
  if (!loaded || (entries.length === 0 && !removalFeedback)) return null;

  return <section className={styles.section} aria-labelledby="recent-transfers-heading">
    <div className={styles.header}>
      <h2 id="recent-transfers-heading"><History size={19} aria-hidden="true" />{de ? "Auf diesem Gerät gemerkt" : "Remembered on this device"}</h2>
      {entries.length > 0 && <button type="button" className={styles.textAction} onClick={() => forget()}>{de ? "Alle lokal entfernen" : "Remove all locally"}</button>}
    </div>
    {entries.length > 0 && <p className={styles.intro}>{de
      ? "Nur Freigaben, die du nach dem Upload ausdrücklich hier gespeichert hast. Kein Konto, keine Synchronisierung und keine Prüfung auf dem Server. Bereits gelöschte Freigaben können noch in der Liste stehen."
      : "Only shares you explicitly saved here after uploading. No account, syncing or server checks. Shares already deleted may still appear in this list."}</p>}
    {entries.length > 0 && <p className={styles.warning}>{de
      ? "Dieser Browser enthält Schlüssel und private Löschlinks. Wer das Browserprofil nutzt, kann diese Freigaben öffnen und löschen. Auf gemeinsam genutzten Geräten die lokalen Einträge entfernen."
      : "This browser holds keys and private deletion links. Anyone using this browser profile can open and delete these shares. Remove local entries on shared devices."}</p>}
    {!available && entries.length > 0 && <p className={styles.empty} role="status">{de ? "Der lokale Browserspeicher ist nicht verfügbar. Die Freigabelinks funktionieren weiterhin; du kannst sie selbst sicher aufbewahren." : "Local browser storage is unavailable. Share links still work; you can keep them somewhere safe yourself."}</p>}
    {entries.length > 0 && <ul className={styles.list}>
      {entries.map((entry) => <li key={entry.id} className={styles.entry}>
        <div className={styles.entryHeader}>
          <h3>{de ? "Freigabe" : "Share"} {entry.id.slice(-6)}</h3>
          <p>{de ? "Gemerkt am" : "Saved"} <time dateTime={entry.savedAt}>{formatDate(entry.savedAt)}</time><br />{de ? "Ablauf" : "Expires"} <time dateTime={entry.expiresAt}>{formatDate(entry.expiresAt)}</time></p>
        </div>
        <div className={styles.actions}>
          <a className={styles.action} href={entry.url} target="_blank" rel="noreferrer"><ExternalLink size={15} aria-hidden="true" />{de ? "Öffnen" : "Open"}</a>
          <button type="button" className={styles.action} onClick={() => void copy(entry.url, entry.id)}><Clipboard size={15} aria-hidden="true" />{feedback?.kind === "copied" && feedback.id === entry.id ? (de ? "Kopiert" : "Copied") : (de ? "Freigabelink kopieren" : "Copy share link")}</button>
          {entry.managementUrl && <a className={`${styles.action} ${styles.privateAction}`} href={entry.managementUrl} target="_blank" rel="noreferrer"><ShieldCheck size={15} aria-hidden="true" />{de ? "Vom Server löschen …" : "Delete from server …"}</a>}
          <button type="button" className={styles.textAction} onClick={() => forget(entry.id)}><X size={15} aria-hidden="true" />{de ? "Nur lokal entfernen" : "Remove locally only"}</button>
        </div>
        {feedback?.kind === "copy-error" && feedback.id === entry.id && <label className={styles.copyFallback}>{de ? "Bitte diesen Freigabelink markieren und manuell kopieren:" : "Please select and copy this share link manually:"}<input readOnly value={entry.url} onFocus={(event) => event.currentTarget.select()} /></label>}
      </li>)}
    </ul>}
    {entries.length > 0 && <p className={styles.finePrint}>{de
      ? "„Nur lokal entfernen“ vergisst die Links in diesem Browser. „Vom Server löschen …“ öffnet den privaten Löschlink und verlangt eine separate Bestätigung. Ablaufdaten werden lokal geprüft; danach verschwinden die Einträge beim nächsten Seitenbesuch oder während der Nutzung."
      : "“Remove locally only” forgets the links in this browser. “Delete from server …” opens the private deletion link and requires separate confirmation. Expiry is checked locally; expired entries disappear on your next visit or while the page is in use."}</p>}
    <p className={styles.feedback} role="status">{feedback?.kind === "forgotten" || feedback?.kind === "cleared"
      ? (de ? "Lokal entfernt. Die Dateien auf dem Server wurden nicht gelöscht." : "Removed locally. Files on the server were not deleted.")
      : feedback?.kind === "copied" ? (de ? "Freigabelink kopiert." : "Share link copied.")
        : feedback?.kind === "storage-error" ? (de ? "Lokal entfernen fehlgeschlagen. Prüfe die Speichereinstellungen deines Browsers." : "Could not remove local entries. Check your browser storage settings.")
          : feedback?.kind === "copy-error" ? (de ? "Kopieren nicht möglich. Du kannst den angezeigten Link manuell kopieren." : "Copying is unavailable. You can copy the displayed link manually.") : ""}</p>
  </section>;
}
