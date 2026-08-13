export const E2E_VERSION = 1 as const;
export const PLAINTEXT_CHUNK_SIZE = 4 * 1024 ** 2;
export const GCM_TAG_SIZE = 16;

export type EncryptedFileMetadata = {
  name: string;
  type: string;
  size: number;
  noncePrefix: string;
};

export type EncryptedTransferMetadata = {
  version: typeof E2E_VERSION;
  message: string;
  files: EncryptedFileMetadata[];
};

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("Ungültige Schlüsseldaten.");
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function encryptedFileSize(plaintextSize: number) {
  if (!Number.isSafeInteger(plaintextSize) || plaintextSize <= 0) throw new Error("Ungültige Dateigröße.");
  return plaintextSize + Math.ceil(plaintextSize / PLAINTEXT_CHUNK_SIZE) * GCM_TAG_SIZE;
}

export function plaintextProgressFromCiphertext(ciphertextBytes: number, plaintextSize: number) {
  if (ciphertextBytes <= 0) return 0;
  const fullCipherChunk = PLAINTEXT_CHUNK_SIZE + GCM_TAG_SIZE;
  const completedChunks = Math.floor(ciphertextBytes / fullCipherChunk);
  const partialCipherBytes = ciphertextBytes % fullCipherChunk;
  return Math.min(plaintextSize, completedChunks * PLAINTEXT_CHUNK_SIZE + Math.max(0, partialCipherBytes - GCM_TAG_SIZE));
}

export function ciphertextOffsetForChunk(chunkIndex: number) {
  if (!Number.isSafeInteger(chunkIndex) || chunkIndex < 0) throw new Error("Ungültiger Blockindex.");
  return chunkIndex * (PLAINTEXT_CHUNK_SIZE + GCM_TAG_SIZE);
}

export function chunkIndexFromCiphertextOffset(offset: number, plaintextSize: number) {
  const encryptedSize = encryptedFileSize(plaintextSize);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > encryptedSize) throw new Error("Ungültige Upload-Position.");
  if (offset === encryptedSize) return Math.ceil(plaintextSize / PLAINTEXT_CHUNK_SIZE);
  const fullCipherChunk = PLAINTEXT_CHUNK_SIZE + GCM_TAG_SIZE;
  if (offset % fullCipherChunk !== 0) throw new Error("Upload-Position liegt nicht auf einer Blockgrenze.");
  return offset / fullCipherChunk;
}

export function createNoncePrefix() {
  return crypto.getRandomValues(new Uint8Array(12));
}

function nonceForChunk(prefix: Uint8Array, chunkIndex: number) {
  if (prefix.byteLength !== 12 || !Number.isSafeInteger(chunkIndex) || chunkIndex < 0) throw new Error("Ungültiger Nonce.");
  const nonce = prefix.slice();
  let carry = BigInt(chunkIndex);
  for (let index = nonce.length - 1; index >= 0 && carry > 0; index -= 1) {
    carry += BigInt(nonce[index]);
    nonce[index] = Number(carry & BigInt(0xff));
    carry >>= BigInt(8);
  }
  if (carry > 0) throw new Error("Nonce-Bereich ist erschöpft.");
  return nonce;
}

export async function createTransferKey() {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  return { key, fragment: `v${E2E_VERSION}.${bytesToBase64Url(raw)}` };
}

export async function importTransferKey(fragment: string) {
  const match = /^v1\.([A-Za-z0-9_-]+)$/u.exec(fragment);
  if (!match) throw new Error("Der Freigabeschlüssel fehlt oder ist ungültig.");
  const raw = base64UrlToBytes(match[1]);
  if (raw.byteLength !== 32) throw new Error("Der Freigabeschlüssel ist ungültig.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptChunk(key: CryptoKey, noncePrefix: Uint8Array, chunkIndex: number, plaintext: ArrayBuffer) {
  return crypto.subtle.encrypt({ name: "AES-GCM", iv: nonceForChunk(noncePrefix, chunkIndex), tagLength: 128 }, key, plaintext);
}

export async function decryptChunk(key: CryptoKey, noncePrefix: Uint8Array, chunkIndex: number, ciphertext: ArrayBuffer) {
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: nonceForChunk(noncePrefix, chunkIndex), tagLength: 128 }, key, ciphertext);
}

export async function encryptMetadata(key: CryptoKey, metadata: EncryptedTransferMetadata) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(metadata));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, tagLength: 128 }, key, plaintext));
  const packed = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  packed.set(iv, 0);
  packed.set(ciphertext, iv.byteLength);
  return bytesToBase64Url(packed);
}

export async function decryptMetadata(key: CryptoKey, packedValue: string): Promise<EncryptedTransferMetadata> {
  const packed = base64UrlToBytes(packedValue);
  if (packed.byteLength < 29) throw new Error("Verschlüsselte Metadaten sind ungültig.");
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: packed.slice(0, 12), tagLength: 128 }, key, packed.slice(12));
  const metadata = JSON.parse(new TextDecoder().decode(plaintext)) as EncryptedTransferMetadata;
  if (metadata.version !== E2E_VERSION || !Array.isArray(metadata.files)) throw new Error("Unbekanntes Verschlüsselungsformat.");
  return metadata;
}

export function encodeNoncePrefix(prefix: Uint8Array) {
  if (prefix.byteLength !== 12) throw new Error("Ungültiger Nonce-Präfix.");
  return bytesToBase64Url(prefix);
}

export function decodeNoncePrefix(value: string) {
  const prefix = base64UrlToBytes(value);
  if (prefix.byteLength !== 12) throw new Error("Ungültiger Nonce-Präfix.");
  return prefix;
}
