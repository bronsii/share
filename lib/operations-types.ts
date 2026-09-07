export type OperationsSummary = {
  checkedAt: string;
  storage: {
    freeBytes: number;
    totalBytes: number;
    reservedUploadBytes: number;
    safetyReserveBytes: number;
    availableForUploadsBytes: number;
    incompleteUploads: number;
    accountingWarnings: number;
  } | null;
  cleanup: {
    status: "ok" | "unknown" | "stale" | "failed" | "unavailable";
    lastAttemptAt: string | null;
    lastAttemptStatus: "success" | "failure" | null;
    lastSuccessAt: string | null;
    lastSuccessCounts: { expired: number; incomplete: number } | null;
    maxAgeMs: number;
  };
};
