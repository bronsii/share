"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { preferredUiLanguage, type UiLanguage, UI_LANGUAGE_STORAGE_KEY } from "@/lib/ui-language";

const LANGUAGE_CHANGE_EVENT = "share-language-change";
let transientLanguage: UiLanguage | null = null;

function subscribe(onStoreChange: () => void) {
  const onStorageChange = () => {
    transientLanguage = null;
    onStoreChange();
  };
  window.addEventListener("storage", onStorageChange);
  window.addEventListener(LANGUAGE_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStorageChange);
    window.removeEventListener(LANGUAGE_CHANGE_EVENT, onStoreChange);
  };
}

function browserLanguage() {
  if (transientLanguage) return transientLanguage;
  try {
    const storedLanguage = window.localStorage.getItem(UI_LANGUAGE_STORAGE_KEY);
    if (storedLanguage === "de" || storedLanguage === "en") return storedLanguage;
  } catch {
    // Private Browsermodi können lokalen Speicher deaktivieren.
  }
  return preferredUiLanguage(window.navigator.languages?.join(",") || window.navigator.language);
}

export function useUiLanguage(initialLanguage: UiLanguage) {
  const language = useSyncExternalStore(subscribe, browserLanguage, () => initialLanguage);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const changeLanguage = useCallback((nextLanguage: UiLanguage) => {
    transientLanguage = nextLanguage;
    try {
      window.localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, nextLanguage);
    } catch {
      // Die Auswahl gilt dann nur für den aktuellen Seitenaufruf.
    }
    window.dispatchEvent(new Event(LANGUAGE_CHANGE_EVENT));
  }, []);

  return [language, changeLanguage] as const;
}
