"use client";

import { useEffect, useState } from "react";
import type { UiLanguage } from "@/lib/ui-language";

export function ExpiryLabel({ expiresAt, language }: { expiresAt: string; language: UiLanguage }) {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setRemaining(Math.max(0, new Date(expiresAt).getTime() - Date.now()));
    update();
    const interval = setInterval(update, 30_000);
    return () => clearInterval(interval);
  }, [expiresAt]);
  if (remaining === null) return null;
  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.ceil(remaining / 60_000);
  const count = days || hours || minutes;
  const unit = days ? (language === "de" ? (count === 1 ? "Tag" : "Tage") : (count === 1 ? "day" : "days"))
    : hours ? (language === "de" ? (count === 1 ? "Stunde" : "Stunden") : (count === 1 ? "hour" : "hours"))
    : (language === "de" ? (count === 1 ? "Minute" : "Minuten") : (count === 1 ? "minute" : "minutes"));
  return <span className="expiry-relative">{remaining <= 0 ? (language === "de" ? "Abgelaufen" : "Expired")
    : language === "de" ? `Noch ${count} ${unit}` : `${count} ${unit} left`}</span>;
}
