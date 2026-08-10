"use client";

import { useEffect } from "react";

export function TransferViewTracker({ id }: { id: string }) {
  useEffect(() => {
    fetch(`/api/transfers/${encodeURIComponent(id)}/view`, {
      method: "POST",
      cache: "no-store",
      keepalive: true,
    }).catch(() => undefined);
  }, [id]);

  return null;
}
