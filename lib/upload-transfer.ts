import {
  chunkIndexFromCiphertextOffset,
  ciphertextOffsetForChunk,
  encryptChunk,
  PLAINTEXT_CHUNK_SIZE,
  plaintextProgressFromCiphertext,
} from "./e2e-crypto";
import {
  pendingUploadCiphertext,
  sendUploadChunk,
  uploadChunkWithRetry,
  uploadJson,
  UploadRequestError,
  UploadUnavailableError,
  withUploadRetry,
} from "./upload-network";
import type { UploadRetryState } from "./upload-network";
import type { ClientEncryptionState, UploadResult, UploadSession } from "./upload-types";

type UploadStatus = { files: Array<{ id: string; uploaded: number }> };

type UploadOptions = {
  files: File[];
  session: UploadSession;
  encryption: ClientEncryptionState;
  signal: AbortSignal;
  failureMessage: string;
  connectionMessage: string;
  onProgress: (bytes: number) => void;
  onRetry: (state: UploadRetryState | null) => void;
};

function validatedOffsets(status: UploadStatus, session: UploadSession, files: File[], failureMessage: string) {
  if (!Array.isArray(status?.files) || status.files.length !== files.length || session.files.length !== files.length) {
    throw new Error(failureMessage);
  }
  const offsets = new Map(status.files.map((file) => [file.id, file.uploaded]));
  for (let index = 0; index < files.length; index += 1) {
    const offset = offsets.get(session.files[index].id);
    if (offset === undefined) throw new Error(failureMessage);
    chunkIndexFromCiphertextOffset(offset, files[index].size);
  }
  return offsets;
}

/** Own the chunk/network lifecycle; React owns only the visible transfer state. */
export async function runEncryptedUpload(options: UploadOptions): Promise<UploadResult> {
  const { files, session, encryption, signal, failureMessage, connectionMessage, onProgress, onRetry } = options;
  const retry = { signal, onRetry };
  const statusUrl = `/api/uploads/${session.id}`;
  const readOffsets = async () => validatedOffsets(
    await uploadJson<UploadStatus>(statusUrl, { cache: "no-store", signal }, failureMessage), session, files, failureMessage,
  );
  const complete = async () => {
    const result = await withUploadRetry(() => uploadJson<UploadResult>(`${statusUrl}/complete`, { method: "POST", signal }, failureMessage), retry);
    if (!result?.url || result.id !== session.id) throw new Error(failureMessage);
    return result;
  };

  let offsets: Map<string, number>;
  try {
    offsets = await withUploadRetry(readOffsets, retry);
  } catch (error) {
    // Completion is idempotent; an earlier completion response may have been lost.
    if (error instanceof UploadRequestError && [404, 410].includes(error.status)) {
      try {
        return await complete();
      } catch (completionError) {
        if (completionError instanceof UploadRequestError && [404, 410].includes(completionError.status)) {
          throw new UploadUnavailableError();
        }
        throw completionError;
      }
    }
    throw error;
  }
  signal.throwIfAborted();
  onProgress(session.files.reduce((sum, file, index) => sum + plaintextProgressFromCiphertext(offsets.get(file.id)!, files[index].size), 0));
  let completedBefore = 0;
  for (let index = 0; index < files.length; index += 1) {
    signal.throwIfAborted();
    const file = files[index];
    const serverFile = session.files[index];
    let cipherOffset = offsets.get(serverFile.id)!;
    let chunkIndex = chunkIndexFromCiphertextOffset(cipherOffset, file.size);
    let plaintextOffset = Math.min(file.size, chunkIndex * PLAINTEXT_CHUNK_SIZE);
    // A paused request may already have committed; its old ciphertext is no longer needed.
    const pending = encryption.pendingChunks.get(serverFile.id);
    if (pending && pending.offset < cipherOffset) encryption.pendingChunks.delete(serverFile.id);
    while (plaintextOffset < file.size) {
      signal.throwIfAborted();
      const end = Math.min(plaintextOffset + PLAINTEXT_CHUNK_SIZE, file.size);
      if (cipherOffset !== ciphertextOffsetForChunk(chunkIndex)) throw new Error(failureMessage);
      const ciphertext = await pendingUploadCiphertext(encryption.pendingChunks, serverFile.id, cipherOffset, async () => {
        const plaintext = await file.slice(plaintextOffset, end).arrayBuffer();
        return encryptChunk(encryption.key, encryption.noncePrefixes[index], chunkIndex, plaintext);
      });
      signal.throwIfAborted();
      cipherOffset = await uploadChunkWithRetry({
        ...retry,
        offset: cipherOffset,
        body: ciphertext,
        failureMessage,
        readOffset: async () => {
          const confirmed = (await readOffsets()).get(serverFile.id)!;
          onProgress(completedBefore + plaintextProgressFromCiphertext(confirmed, file.size));
          return confirmed;
        },
        send: (body, offset) => sendUploadChunk({
          url: `${statusUrl}/${serverFile.id}`, body, offset, signal, failureMessage, connectionMessage,
          onProgress: (fraction) => onProgress(completedBefore + plaintextOffset + (end - plaintextOffset) * fraction),
        }),
      });
      signal.throwIfAborted();
      encryption.pendingChunks.delete(serverFile.id);
      plaintextOffset = end;
      chunkIndex += 1;
      onProgress(completedBefore + plaintextOffset);
    }
    completedBefore += file.size;
  }
  signal.throwIfAborted();
  return complete();
}
