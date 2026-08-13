"use client";

/* eslint-disable jsx-a11y/no-autofocus -- Das PIN-Feld soll beim Öffnen der Verwaltung sofort eingabebereit sein. */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Clock3, Download, Eye, File, LockKeyhole, LogOut, RefreshCw, Trash2 } from "lucide-react";

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
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function AdminPanel() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [code, setCode] = useState("");
  const [transfers, setTransfers] = useState<AdminTransfer[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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
    const response = await fetch("/api/admin/transfers", { cache: "no-store" });
    if (response.status === 401) {
      setAuthenticated(false);
      return;
    }
    if (!response.ok) throw new Error("Die Uploads konnten nicht geladen werden.");
    const data = await response.json() as { transfers: AdminTransfer[] };
    setTransfers(data.transfers);
    setAuthenticated(true);
  }, []);

  useEffect(() => {
    fetch("/api/admin/session", { cache: "no-store" })
      .then((response) => response.json())
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
    const response = await fetch("/api/admin/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      setError(data.error ?? "Anmeldung fehlgeschlagen.");
      setCode("");
      setBusy(false);
      focusCodeInput();
      return;
    }
    setCode("");
    await loadTransfers().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Laden fehlgeschlagen."));
    setBusy(false);
  }

  function updateCode(rawValue: string) {
    const next = rawValue.slice(0, 256);
    setError("");
    setCode(next);
  }

  async function logout() {
    await fetch("/api/admin/session", { method: "DELETE" });
    setAuthenticated(false);
    setTransfers([]);
  }

  async function deleteTransfer(transfer: AdminTransfer) {
    const label = transfer.files.length === 1 ? transfer.files[0].name : `${transfer.files.length} Dateien`;
    if (!window.confirm(`„${label}“ wirklich endgültig löschen?`)) return;
    setDeleting(transfer.folderName);
    setError("");
    const response = await fetch(`/api/admin/transfers/${encodeURIComponent(transfer.folderName)}`, { method: "DELETE" });
    if (response.ok) {
      setTransfers((current) => current.filter((item) => item.folderName !== transfer.folderName));
    } else {
      const data = await response.json().catch(() => ({})) as { error?: string };
      setError(data.error ?? "Löschen fehlgeschlagen.");
    }
    setDeleting("");
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
          <button type="button" onClick={() => void loadTransfers()} aria-label="Liste aktualisieren"><RefreshCw size={17} /></button>
          <button type="button" onClick={() => void logout()} aria-label="Abmelden"><LogOut size={17} /></button>
        </div>
      </div>
      {error && <p className="admin-error" role="alert">{error}</p>}
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
                <button type="button" onClick={() => void deleteTransfer(transfer)} disabled={deleting === transfer.folderName}>
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
  return <Link className="admin-back" href="/"><ArrowLeft size={16} /> Zurück zu Share</Link>;
}
