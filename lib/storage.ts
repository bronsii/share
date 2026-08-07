import { env } from "cloudflare:workers";

export type TransferFile = { id: string; name: string; size: number; type: string };
export type TransferManifest = {
  id: string;
  createdAt: string;
  expiresAt: string;
  message: string;
  files: TransferFile[];
};

type StoredObject = { body: ReadableStream<Uint8Array>; size: number; text(): Promise<string> };
type Bucket = {
  put(key: string, value: ReadableStream | string, options?: {
    httpMetadata?: { contentType?: string; contentDisposition?: string };
    customMetadata?: Record<string, string>;
  }): Promise<unknown>;
  get(key: string): Promise<StoredObject | null>;
  delete(keys: string | string[]): Promise<void>;
};

function bucket() {
  const runtime = env as unknown as { SHARE_FILES?: Bucket };
  if (!runtime.SHARE_FILES) throw new Error("Der Dateispeicher ist derzeit nicht verfügbar.");
  return runtime.SHARE_FILES;
}

export function manifestKey(id: string) { return `manifests/${id}.json`; }
export function fileKey(transferId: string, fileId: string) { return `transfers/${transferId}/${fileId}`; }
export function transferIsExpired(manifest: TransferManifest) {
  return new Date(manifest.expiresAt).getTime() <= Date.now();
}

export async function getTransfer(id: string): Promise<TransferManifest | null> {
  if (!/^[a-zA-Z0-9_-]{12,32}$/.test(id)) return null;
  const object = await bucket().get(manifestKey(id));
  if (!object) return null;
  try { return JSON.parse(await object.text()) as TransferManifest; } catch { return null; }
}

export async function saveTransfer(manifest: TransferManifest, files: File[]) {
  const storage = bucket();
  const writtenKeys: string[] = [];
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const record = manifest.files[index];
      const key = fileKey(manifest.id, record.id);
      await storage.put(key, file.stream(), {
        httpMetadata: { contentType: record.type || "application/octet-stream" },
        customMetadata: { transferId: manifest.id, originalName: record.name, expiresAt: manifest.expiresAt },
      });
      writtenKeys.push(key);
    }
    await storage.put(manifestKey(manifest.id), JSON.stringify(manifest), {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
      customMetadata: { expiresAt: manifest.expiresAt },
    });
  } catch (error) {
    if (writtenKeys.length) await storage.delete(writtenKeys);
    throw error;
  }
}

export async function getStoredFile(transferId: string, fileId: string) { return bucket().get(fileKey(transferId, fileId)); }
export async function deleteTransfer(manifest: TransferManifest) {
  const keys = [manifestKey(manifest.id), ...manifest.files.map((file) => fileKey(manifest.id, file.id))];
  await bucket().delete(keys);
}
