import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { crc32 } from "node:zlib";

export type ZipSource = {
  name: string;
  path: string;
  size: number;
  modifiedAt?: Date;
};

type CentralEntry = {
  name: Buffer;
  size: bigint;
  checksum: number;
  localHeaderOffset: bigint;
  dosTime: number;
  dosDate: number;
};

const UTF8_WITH_DATA_DESCRIPTOR = 0x0808;
const ZIP64_VERSION = 45;
const UINT32_MAX = 0xffffffff;

function dosTimestamp(value = new Date()) {
  const year = Math.min(2107, Math.max(1980, value.getUTCFullYear()));
  const month = value.getUTCMonth() + 1;
  const day = value.getUTCDate();
  const hours = value.getUTCHours();
  const minutes = value.getUTCMinutes();
  const seconds = Math.floor(value.getUTCSeconds() / 2);
  return {
    time: (hours << 11) | (minutes << 5) | seconds,
    date: ((year - 1980) << 9) | (month << 5) | day,
  };
}

function localFileHeader(name: Buffer, size: bigint, dosTime: number, dosDate: number) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(ZIP64_VERSION, 4);
  header.writeUInt16LE(UTF8_WITH_DATA_DESCRIPTOR, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(dosTime, 10);
  header.writeUInt16LE(dosDate, 12);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(UINT32_MAX, 18);
  header.writeUInt32LE(UINT32_MAX, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(20, 28);

  const extra = Buffer.alloc(20);
  extra.writeUInt16LE(0x0001, 0);
  extra.writeUInt16LE(16, 2);
  extra.writeBigUInt64LE(size, 4);
  extra.writeBigUInt64LE(size, 12);
  return Buffer.concat([header, name, extra]);
}

function dataDescriptor(checksum: number, size: bigint) {
  const descriptor = Buffer.alloc(24);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(checksum >>> 0, 4);
  descriptor.writeBigUInt64LE(size, 8);
  descriptor.writeBigUInt64LE(size, 16);
  return descriptor;
}

function centralDirectoryHeader(entry: CentralEntry) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(ZIP64_VERSION, 4);
  header.writeUInt16LE(ZIP64_VERSION, 6);
  header.writeUInt16LE(UTF8_WITH_DATA_DESCRIPTOR, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(entry.dosTime, 12);
  header.writeUInt16LE(entry.dosDate, 14);
  header.writeUInt32LE(entry.checksum >>> 0, 16);
  header.writeUInt32LE(UINT32_MAX, 20);
  header.writeUInt32LE(UINT32_MAX, 24);
  header.writeUInt16LE(entry.name.length, 28);
  header.writeUInt16LE(28, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(UINT32_MAX, 42);

  const extra = Buffer.alloc(28);
  extra.writeUInt16LE(0x0001, 0);
  extra.writeUInt16LE(24, 2);
  extra.writeBigUInt64LE(entry.size, 4);
  extra.writeBigUInt64LE(entry.size, 12);
  extra.writeBigUInt64LE(entry.localHeaderOffset, 20);
  return Buffer.concat([header, entry.name, extra]);
}

function zip64EndRecords(entryCount: bigint, centralSize: bigint, centralOffset: bigint, zip64EndOffset: bigint) {
  const zip64End = Buffer.alloc(56);
  zip64End.writeUInt32LE(0x06064b50, 0);
  zip64End.writeBigUInt64LE(BigInt(44), 4);
  zip64End.writeUInt16LE(ZIP64_VERSION, 12);
  zip64End.writeUInt16LE(ZIP64_VERSION, 14);
  zip64End.writeUInt32LE(0, 16);
  zip64End.writeUInt32LE(0, 20);
  zip64End.writeBigUInt64LE(entryCount, 24);
  zip64End.writeBigUInt64LE(entryCount, 32);
  zip64End.writeBigUInt64LE(centralSize, 40);
  zip64End.writeBigUInt64LE(centralOffset, 48);

  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeUInt32LE(0, 4);
  locator.writeBigUInt64LE(zip64EndOffset, 8);
  locator.writeUInt32LE(1, 16);

  const legacyEnd = Buffer.alloc(22);
  legacyEnd.writeUInt32LE(0x06054b50, 0);
  legacyEnd.writeUInt16LE(0, 4);
  legacyEnd.writeUInt16LE(0, 6);
  legacyEnd.writeUInt16LE(0xffff, 8);
  legacyEnd.writeUInt16LE(0xffff, 10);
  legacyEnd.writeUInt32LE(UINT32_MAX, 12);
  legacyEnd.writeUInt32LE(UINT32_MAX, 16);
  legacyEnd.writeUInt16LE(0, 20);
  return Buffer.concat([zip64End, locator, legacyEnd]);
}

async function* generateZip(sources: ZipSource[]) {
  let offset = BigInt(0);
  const centralEntries: CentralEntry[] = [];

  for (const source of sources) {
    if (!Number.isSafeInteger(source.size) || source.size < 0) throw new Error("Ungültige Dateigröße.");
    const name = Buffer.from(source.name.normalize("NFC"), "utf8");
    if (name.length === 0 || name.length > 0xffff) throw new Error("Ungültiger ZIP-Dateiname.");
    const size = BigInt(source.size);
    const { time, date } = dosTimestamp(source.modifiedAt);
    const localHeaderOffset = offset;
    const localHeader = localFileHeader(name, size, time, date);
    yield localHeader;
    offset += BigInt(localHeader.length);

    let checksum = 0;
    let streamedSize = BigInt(0);
    for await (const chunk of createReadStream(source.path)) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      checksum = crc32(buffer, checksum);
      streamedSize += BigInt(buffer.length);
      offset += BigInt(buffer.length);
      yield buffer;
    }
    if (streamedSize !== size) throw new Error("Die Dateigröße hat sich während des Downloads geändert.");

    const descriptor = dataDescriptor(checksum, size);
    yield descriptor;
    offset += BigInt(descriptor.length);
    centralEntries.push({ name, size, checksum, localHeaderOffset, dosTime: time, dosDate: date });
  }

  const centralOffset = offset;
  for (const entry of centralEntries) {
    const centralHeader = centralDirectoryHeader(entry);
    yield centralHeader;
    offset += BigInt(centralHeader.length);
  }
  const centralSize = offset - centralOffset;
  yield zip64EndRecords(BigInt(centralEntries.length), centralSize, centralOffset, offset);
}

export function createZipStream(sources: ZipSource[]) {
  return Readable.from(generateZip(sources));
}
