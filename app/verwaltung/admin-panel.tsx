"use client";

/* eslint-disable jsx-a11y/no-autofocus -- Das PIN-Feld soll beim Öffnen der Verwaltung sofort eingabebereit sein. */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Clock3, Download, Eye, File, LockKeyhole, LogOut, RefreshCw, Trash2 } from "lucide-react";
import type { OperationsSummary } from "@/lib/operations-types";
import operationsStyles from "./operations.module.css";

type AdminTransfer = {
  folderName: string;
  id: string | null;
  createdAt: string;
  expiresAt: string | null;
  status: "active" | "expired" | "incomplete";
  files: Array<{ id: string | null; name: string; size: number }>;
  totalSize: number;
  viewCount: number;
  downloadCount: number;
};

const statusText = { active: "Aktiv", expired: "Abgelaufen", incomplete: "Unvollständig" } as const;

function formatBytes(bytes: number) {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toLocaleString("de-DE", { maximumFractionDigits: 1 })} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB`;
  return `${(bytes / 1024 ** 3).toLocaleString("de-DE", { maximumFractionDigits: 2 })} GB`;
}

function formatDate(value: string) {
  if (!Number.isFinite(Date.parse(value))) return "unbekannt";
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function OperationsCard({ operations }: { operations: OperationsSummary | null }) {
  if (!operations) return <p className={operationsStyles.warning} role="status">Der Betriebsstatus ist derzeit nicht verfügbar. Bitte aktualisiere die Ansicht.</p>;
  const { storage, cleanup } = operations;
  const cleanupWarnings = {
    ok: "",
    unknown: "Noch kein erfolgreicher planmäßiger Bereinigungslauf bestätigt. Bitte den Cleanup-Timer prüfen.",
    stale: `Der letzte erfolgreiche planmäßige Bereinigungslauf liegt mehr als ${Math.round(cleanup.maxAgeMs / 60_000)} Minuten zurück. Bitte den Cleanup-Timer prüfen.`,
    failed: "Der letzte planmäßige Bereinigungslauf ist fehlgeschlagen oder war unvollständig. Bitte das Service-Protokoll prüfen.",
    unavailable: "Der Bereinigungsstatus ist nicht lesbar. Ein erfolgreicher Lauf kann nicht bestätigt werden.",
  };
  return (
    <section className={operationsStyles.card} aria-labelledby="operations-heading">
      <div className={operationsStyles.heading}>
        <h2 id="operations-heading">Betriebsstatus</h2>
        <span>Stand: {formatDate(operations.checkedAt)}</span>
      </div>
      {storage ? <>
        <dl className={operationsStyles.metrics}>
          <div><dt>Auf Datenträger frei</dt><dd>{formatBytes(storage.freeBytes)}</dd></div>
          <div><dt>Für laufende Uploads reserviert</dt><dd>{formatBytes(storage.reservedUploadBytes)}</dd></div>
          <div><dt>Für neue Uploads verfügbar</dt><dd>{storage.accountingWarnings ? "Nicht verlässlich" : formatBytes(storage.availableForUploadsBytes)}</dd></div>
          <div><dt>Unvollständige Uploads</dt><dd>{storage.incompleteUploads}</dd></div>
        </dl>
        <p className={operationsStyles.note}>Reservierungen sind noch nicht belegter Speicher. Für neue Uploads werden sie und {formatBytes(storage.safetyReserveBytes)} Sicherheitsreserve vom freien Speicher abgezogen.</p>
        {storage.accountingWarnings > 0 && <p className={operationsStyles.warning} role="status">Speichermetadaten sind teilweise unlesbar. Reservierte und verfügbare Kapazität sind möglicherweise unvollständig.</p>}
        {storage.freeBytes < storage.safetyReserveBytes * 2 && <p className={operationsStyles.warning} role="status">Wenig freier Speicher: weniger als {formatBytes(storage.safetyReserveBytes * 2)} auf dem Datenträger verfügbar.</p>}
        {storage.availableForUploadsBytes === 0 && <p className={operationsStyles.warning} role="status">Unter Berücksichtigung der Reservierungen ist kein Speicher für neue Uploads verfügbar.</p>}
        {storage.incompleteUploads > 0 && <p className={operationsStyles.note}>Unvollständige Uploads können noch laufen oder fortgesetzt werden. Die Bereinigung entfernt sie erst nach mindestens zwei Stunden ohne Aktivität.</p>}
      </> : <p className={operationsStyles.warning} role="status">Der Speicherstatus konnte nicht ermittelt werden. Die freie Kapazität ist unbekannt.</p>}
      <div className={operationsStyles.cleanup}>
        <strong>Planmäßige Bereinigung</strong>
        <p className={operationsStyles.note}>Zuletzt erfolgreich: {cleanup.lastSuccessAt ? formatDate(cleanup.lastSuccessAt) : "noch nicht bestätigt"}</p>
        {cleanup.lastAttemptStatus === "failure" && cleanup.lastAttemptAt && <p className={operationsStyles.note}>Letzter fehlgeschlagener Versuch: {formatDate(cleanup.lastAttemptAt)}</p>}
        {cleanup.lastSuccessAt && cleanup.lastSuccessCounts && <p className={operationsStyles.note}>Beim letzten erfolgreichen Lauf entfernt: {cleanup.lastSuccessCounts.expired} abgelaufene Freigaben · {cleanup.lastSuccessCounts.incomplete} unvollständige Uploads</p>}
        {cleanupWarnings[cleanup.status] && <p className={operationsStyles.warning} role="status">{cleanupWarnings[cleanup.status]}</p>}
        <p className={operationsStyles.note}>Bestätigt nur planmäßige Läufe; manuelle Löschungen und Bereinigungen bei API-Anfragen zählen nicht. Hinweise werden ausschließlich hier angezeigt. Die Aktualisieren-Schaltfläche lädt den aktuellen Stand.</p>
      </div>
    </section>
  );
}

export function AdminPanel() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [code, setCode] = useState("");
  const [transfers, setTransfers] = useState<AdminTransfer[]>([]);
  const [operations, setOperations] = useState<OperationsSummary | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState("");
  const codeInput = useRef<HTMLInputElement | null>(null);

  const focusCodeInput = useCallback(() => {
    requestAnimationFrame(() => {
      const input = codeInput.current;
      if (!input) return;
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }, []);

  const loadTransfers = useCallback(async () => {
    const response = await fetch("/api/admin/transfers", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (response.status === 401) {
      setAuthenticated(false);
      setTransfers([]);
      setOperations(null);
      return;
    }
    if (!response.ok) throw new Error("Die Uploads konnten nicht geladen werden.");
    const data = await response.json() as { transfers: AdminTransfer[]; operations: OperationsSummary };
    setTransfers(data.transfers);
    setOperations(data.operations);
    setAuthenticated(true);
  }, []);

  useEffect(() => {
    fetch("/api/admin/session", { cache: "no-store", signal: AbortSignal.timeout(15_000) })
      .then((response) => {
        if (!response.ok) throw new Error("Session check failed");
        return response.json();
      })
      .then((data: { authenticated: boolean }) => data.authenticated ? loadTransfers() : setAuthenticated(false))
      .catch(() => {
        setAuthenticated(false);
        setError("Die Verwaltung ist gerade nicht erreichbar.");
      });
  }, [loadTransfers]);

  useEffect(() => {
    if (authenticated !== false) return;
    focusCodeInput();
  }, [authenticated, focusCodeInput]);

  async function login(code: string) {
    if (busy || code.length < 4) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Anmeldung fehlgeschlagen.");
        setCode("");
        return;
      }
      setCode("");
      await loadTransfers();
    } catch {
      setError("Anmeldung oder Laden fehlgeschlagen. Bitte prüfe die Passphrase und versuche es erneut.");
      setCode("");
    } finally {
      setBusy(false);
      focusCodeInput();
    }
  }

  function updateCode(rawValue: string) {
    const next = rawValue.slice(0, 256);
    setError("");
    setCode(next);
  }

  async function logout() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/session", { method: "DELETE", signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error("Logout failed");
      setAuthenticated(false);
      setTransfers([]);
      setOperations(null);
    } catch {
      setError("Abmelden fehlgeschlagen. Bitte versuche es erneut; die Sitzung ist möglicherweise noch aktiv.");
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    setError("");
    try {
      await loadTransfers();
    } catch {
      setError("Aktualisieren fehlgeschlagen. Die angezeigten Daten sind möglicherweise veraltet.");
    } finally {
      setRefreshing(false);
    }
  }

  async function deleteTransfer(transfer: AdminTransfer) {
    const label = transfer.files.length === 1 ? transfer.files[0].name : `${transfer.files.length} Dateien`;
    if (!window.confirm(`„${label}“ wirklich endgültig löschen?`)) return;
    setDeleting(transfer.folderName);
    setError("");
    try {
      const response = await fetch(`/api/admin/transfers/${encodeURIComponent(transfer.folderName)}`, { method: "DELETE", signal: AbortSignal.timeout(15_000) });
      if (response.status === 401) {
        setAuthenticated(false);
        setTransfers([]);
        setOperations(null);
        return;
      }
      if (!response.ok) throw new Error("Deletion failed");
      setTransfers((current) => current.filter((item) => item.folderName !== transfer.folderName));
      await loadTransfers();
    } catch {
      setError("Löschen oder Aktualisieren fehlgeschlagen. Bitte aktualisiere die Ansicht, um den aktuellen Stand zu prüfen.");
    } finally {
      setDeleting("");
    }
  }

  if (authenticated === null) {
    return <div className="admin-loading"><RefreshCw className="admin-spin" size={22} /> Verwaltung wird geladen …</div>;
  }

  if (!authenticated) {
    return (
      <div className="admin-login-card">
        <div className="admin-lock-mark"><LockKeyhole size={25} /></div>
        <p className="admin-kicker">Private Verwaltung</p>
        <h1>Upload-Speicher</h1>
        <p>Gib deine Admin-Passphrase ein.</p>
        <form onSubmit={(event) => { event.preventDefault(); void login(code); }}>
          <label htmlFor="admin-code">Passphrase</label>
          <input
            ref={codeInput}
            className="admin-passphrase-input"
            id="admin-code"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={code}
            minLength={4}
            maxLength={256}
            aria-label="Admin-Passphrase"
            onChange={(event) => updateCode(event.target.value)}
            disabled={busy}
          />
          {error && <p className="admin-error" role="alert">{error}</p>}
          {busy && <p className="admin-code-state" role="status">Prüfe …</p>}
          <button className="admin-login-button" type="submit" disabled={busy || code.length < 4}>
            {busy ? "Anmeldung läuft …" : "Anmelden"}
          </button>
        </form>
      </div>
    );
  }

  const totalSize = transfers.reduce((sum, transfer) => sum + transfer.totalSize, 0);
  return (
    <div className="admin-dashboard">
      <div className="admin-topline">
        <div>
          <p className="admin-kicker">Private Verwaltung</p>
          <h1>Upload-Speicher</h1>
          <p>{transfers.length} Freigaben · {formatBytes(totalSize)} belegt</p>
        </div>
        <div className="admin-actions">
          <button type="button" onClick={() => void refresh()} disabled={refreshing || busy || Boolean(deleting)} aria-label="Liste und Betriebsstatus aktualisieren"><RefreshCw className={refreshing ? "admin-spin" : undefined} size={17} /></button>
          <button type="button" onClick={() => void logout()} disabled={busy || refreshing || Boolean(deleting)} aria-label="Abmelden"><LogOut size={17} /></button>
        </div>
      </div>
      {error && <p className="admin-error" role="alert">{error}</p>}
      <OperationsCard operations={operations} />
      {transfers.length === 0 ? (
        <div className="admin-empty"><File size={24} /><strong>Der Speicher ist leer.</strong><span>Es sind keine Uploads vorhanden.</span></div>
      ) : (
        <div className="admin-transfer-list">
          {transfers.map((transfer) => (
            <article className="admin-transfer" key={transfer.folderName}>
              <div className="admin-transfer-head">
                <div>
                  <span className={`admin-status is-${transfer.status}`}>{statusText[transfer.status]}</span>
                  <span className="admin-created">erstellt {formatDate(transfer.createdAt)}</span>
                </div>
                <strong>{formatBytes(transfer.totalSize)}</strong>
              </div>
              <div className="admin-files">
                {transfer.files.length ? transfer.files.map((file, index) => (
                  <div className="admin-file" key={file.id ?? `${file.name}-${index}`}>
                    <File size={16} />
                    <span title={file.name}>{file.name}</span>
                    <small>{formatBytes(file.size)}</small>
                  </div>
                )) : <div className="admin-file admin-file-empty">Keine Datei im Ordner</div>}
              </div>
              <div className="admin-transfer-foot">
                <div className="admin-transfer-info">
                  {transfer.id && <span className="admin-transfer-stats">
                    <Eye size={14} />{transfer.viewCount > 0 ? `Link geöffnet: Ja (${transfer.viewCount}×)` : "Link geöffnet: Nein"}
                    <Download size={14} />Downloads: {transfer.downloadCount}
                  </span>}
                  <span><Clock3 size={14} />{transfer.expiresAt ? `gültig bis ${formatDate(transfer.expiresAt)}` : "kein Ablaufdatum"}</span>
                </div>
                <button type="button" onClick={() => void deleteTransfer(transfer)} disabled={Boolean(deleting) || refreshing || busy}>
                  <Trash2 size={16} />{deleting === transfer.folderName ? "Lösche …" : "Freigabe löschen"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function AdminBackLink() {
  return <Link className="admin-back" href="/"><ArrowLeft size={16} /> Zurück zu Sendebude</Link>;
}
