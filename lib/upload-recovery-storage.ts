import { validUploadRecovery } from "./upload-recovery.mjs";
import type { UploadRecovery } from "./upload-types";

const UPLOAD_RECOVERY_STORAGE_KEY = "share-upload-recovery-v1";

export function loadUploadRecovery() {
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

export function saveUploadRecovery(recovery: UploadRecovery) {
  try {
    window.sessionStorage.setItem(UPLOAD_RECOVERY_STORAGE_KEY, JSON.stringify(recovery));
  } catch {
    // Der Upload funktioniert weiter, nur die Wiederaufnahme nach Reload entfällt.
  }
}

export function clearUploadRecovery() {
  try {
    window.sessionStorage.removeItem(UPLOAD_RECOVERY_STORAGE_KEY);
  } catch {
    // Ein blockierter Sitzungsspeicher muss nicht bereinigt werden.
  }
}


