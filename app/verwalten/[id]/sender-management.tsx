"use client";

import Link from "next/link";
import { Check, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { LanguageSwitch } from "@/app/language-switch";
import { useUiLanguage } from "@/lib/use-ui-language";
import type { UiLanguage } from "@/lib/ui-language";

export function SenderManagement({ id, initialLanguage }: { id: string; initialLanguage: UiLanguage }) {
  const [language, changeLanguage] = useUiLanguage(initialLanguage);
  const de = language === "de";
  const [token, setToken] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "invalid" | "deleting" | "deleted">("loading");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    // Fragments are browser-only; keep the first render identical to the server HTML.
    queueMicrotask(() => {
      if (!active) return;
      const value = /^#m1\.([A-Za-z0-9_-]{43})$/u.exec(window.location.hash)?.[1];
      setToken(value ?? null);
      setStatus(value ? "ready" : "invalid");
    });
    return () => { active = false; };
  }, []);
  async function remove() {
    if (!token || !checked || status !== "ready") return;
    setStatus("deleting"); setError("");
    try {
      const response = await fetch(`/api/transfers/${encodeURIComponent(id)}/manage`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      if (response.status === 404) { setStatus("invalid"); return; }
      if (!response.ok) throw new Error(response.status === 429 ? (de ? "Zu viele Versuche. Bitte warte einige Minuten." : "Too many attempts. Please wait a few minutes.") : (de ? "Löschen fehlgeschlagen. Bitte versuche es erneut." : "Deletion failed. Please try again."));
      setStatus("deleted"); setToken(null);
      window.history.replaceState(null, "", window.location.pathname);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : (de ? "Bitte prüfe deine Verbindung." : "Please check your connection."));
      setStatus("ready");
    }
  }
  return <main className="download-page">
    <header className="download-header"><Link className="back-link" href="/">Sendebude</Link><LanguageSwitch language={language} label={de ? "Sprache wählen" : "Choose language"} onChange={changeLanguage} /></header>
    <section className="download-card sender-management-card">
      <div className="empty-clock">{status === "deleted" ? <Check size={28} /> : <ShieldCheck size={28} />}</div>
      <p className="panel-kicker">{de ? "Privat · nur für den Absender" : "Private · sender only"}</p>
      <h1>{status === "deleted" ? (de ? "Freigabe gelöscht." : "Share deleted.") : (de ? "Freigabe vorzeitig löschen" : "Delete this share early")}</h1>
      {status === "loading" && <p role="status">{de ? "Löschlink wird geprüft …" : "Checking deletion link …"}</p>}
      {status === "invalid" && <p role="alert">{de ? "Dieser Löschlink ist unvollständig, ungültig oder die Freigabe wurde bereits entfernt. Bitte verwende den privaten Löschlink aus der Upload-Bestätigung." : "This deletion link is incomplete, invalid, or the share has already been removed. Use the private deletion link from your upload confirmation."}</p>}
      {status === "deleted" ? <p role="status">{de ? "Die Dateien wurden vom Server entfernt. Bereits heruntergeladene Kopien bleiben beim Empfänger." : "The files have been removed from the server. Previously downloaded copies remain with recipients."}</p>
        : (status === "ready" || status === "deleting") && <>
          <p>{de ? "Du löschst damit alle Dateien dieser Freigabe vom Server. Neue Downloads sind danach nicht mehr möglich. Bereits gestartete Downloads und gespeicherte Kopien können nicht zurückgerufen werden." : "This removes all files in this share from the server and prevents new downloads. Downloads already in progress and saved copies cannot be recalled."}</p>
          <label className="delete-confirm"><input type="checkbox" checked={checked} disabled={status === "deleting"} onChange={(event) => setChecked(event.target.checked)} /><span>{de ? "Ja, diese Freigabe unwiderruflich löschen." : "Yes, permanently delete this share."}</span></label>
          <button type="button" className="primary-button delete-share-button" disabled={!checked || status === "deleting"} onClick={() => void remove()}><Trash2 size={18} />{status === "deleting" ? (de ? "Wird gelöscht …" : "Deleting …") : (de ? "Freigabe jetzt löschen" : "Delete share now")}</button>
        </>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <Link className="text-button" href="/">{de ? "Zur Startseite" : "Back to home"}</Link>
    </section>
  </main>;
}
