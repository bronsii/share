"use client";

import { Check, Clipboard, QrCode, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { UiLanguage } from "@/lib/ui-language";

export function ShareExtras({ url, managementUrl, language }: { url: string; managementUrl?: string; language: UiLanguage }) {
  const de = language === "de";
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrError, setQrError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  useEffect(() => {
    if (!qrOpen) return;
    let active = true;
    void import("qrcode").then((qr) => {
      if (active && canvasRef.current) return qr.toCanvas(canvasRef.current, url, { width: 512, margin: 4, errorCorrectionLevel: "M", color: { dark: "#30271FFF", light: "#FFFFFFFF" } });
    }).catch(() => { if (active) setQrError(true); });
    return () => { active = false; };
  }, [url, qrOpen]);
  async function copyManagement() {
    if (!managementUrl) return;
    try { await navigator.clipboard.writeText(managementUrl); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  }
  return <div className="share-extras">
    <details onToggle={(event) => setQrOpen(event.currentTarget.open)}>
      <summary><QrCode size={17} aria-hidden="true" />{de ? "Freigabelink als QR-Code" : "Share link as QR code"}</summary>
      <div className="qr-panel">
        <canvas ref={canvasRef} role="img" aria-label={de ? "QR-Code für den vollständigen Freigabelink" : "QR code for the complete share link"} />
        <p>{de ? "Mit der Handykamera scannen. Jeder mit diesem QR-Code kann die Dateien öffnen." : "Scan with your phone camera. Anyone with this QR code can open the files."}</p>
        {qrError && <p role="alert">{de ? "QR-Code nicht verfügbar. Bitte kopiere den Freigabelink oben." : "QR code unavailable. Please copy the share link above."}</p>}
      </div>
    </details>
    {managementUrl && <details className="sender-management">
      <summary><ShieldCheck size={17} aria-hidden="true" />{de ? "Nur für dich: Freigabe vorzeitig löschen" : "Just for you: delete this share early"}</summary>
      <p>{de ? "Bewahre diesen privaten Löschlink auf, bevor du die Seite verlässt. Nicht an Empfänger weitergeben. Er kann nicht wiederhergestellt werden." : "Save this private deletion link before leaving this page. Do not share it with recipients. It cannot be recovered."}</p>
      <label className="sr-only" htmlFor="sender-management-url">{de ? "Privater Löschlink" : "Private deletion link"}</label>
      <input id="sender-management-url" value={managementUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
      <div className="sender-actions"><button type="button" className="secondary-action" onClick={() => void copyManagement()}>{copied ? <Check size={16} /> : <Clipboard size={16} />}{copied ? (de ? "Löschlink kopiert" : "Deletion link copied") : (de ? "Löschlink kopieren" : "Copy deletion link")}</button><a href={managementUrl} target="_blank" rel="noreferrer">{de ? "Öffnen" : "Open"}</a></div>
      {copyError && <p role="alert">{de ? "Bitte markiere den Link und kopiere ihn manuell." : "Please select the link and copy it manually."}</p>}
    </details>}
  </div>;
}
