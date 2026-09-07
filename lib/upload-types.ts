export type UploadResult = {
  id: string;
  url: string;
  expiresAt: string;
  managementUrl?: string;
};

export type UploadSession = {
  id: string;
  expiresAt: string;
  files: Array<{ id: string; name: string; size: number; uploaded: number }>;
};

export type ClientEncryptionState = {
  key: CryptoKey;
  fragment: string;
  managementToken?: string;
  noncePrefixes: Uint8Array[];
  pendingChunks: Map<string, { offset: number; ciphertext: Promise<ArrayBuffer> }>;
};

export type RecoveryFile = {
  name: string;
  size: number;
  lastModified: number;
};

export type UploadRecovery = {
  version: 1;
  session: UploadSession;
  fragment: string;
  managementToken?: string;
  noncePrefixes: string[];
  files: RecoveryFile[];
  days: string;
  message: string;
};

