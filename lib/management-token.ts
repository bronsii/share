// Independent of the encryption key: recipients must never gain deletion rights.
export async function createManagementToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return { token, hash: Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("") };
}

export function managementUrl(shareUrl: string, id: string, token?: string) {
  if (!token) return undefined;
  const url = new URL(`/verwalten/${encodeURIComponent(id)}`, shareUrl);
  url.hash = `m1.${token}`;
  return url.toString();
}
