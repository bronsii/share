// ZIP64, uncompressed and streamed: even a 5 GiB transfer never needs to fit in memory.
export type BrowserZipEntry = { name: string; size: number; chunks: () => AsyncIterable<Uint8Array> };
const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});

export function updateCrc32(crc: number, bytes: Uint8Array) {
  let value = (crc ^ 0xffffffff) >>> 0;
  for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 255];
  return (value ^ 0xffffffff) >>> 0;
}

export function uniqueZipNames(names: string[]) {
  const used = new Set<string>();
  return names.map((original) => {
    // No paths, dot entries or platform-specific extraction paths.
    const base = Array.from(original, (character) => character.charCodeAt(0) < 32 || "/\\:".includes(character) ? "_" : character).join("").replace(/^\.+$/u, "file") || "file";
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const extension = dot > 0 ? base.slice(dot) : "";
    let name = base;
    let suffix = 1;
    while (used.has(name.toLowerCase())) name = `${stem} (${++suffix})${extension}`;
    used.add(name.toLowerCase());
    return name;
  });
}

function header(size: number, signature: number) {
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, signature, true);
  return { bytes, view };
}

function entrySize(entry: Pick<BrowserZipEntry, "name" | "size">) {
  const name = encoder.encode(entry.name);
  if (!Number.isSafeInteger(entry.size) || entry.size < 0 || name.length > 65535) throw new Error("Invalid ZIP entry");
  return name;
}

export function browserZipSize(entries: Pick<BrowserZipEntry, "name" | "size">[]) {
  const size = entries.reduce((total, entry) => total + entry.size + 148 + entrySize(entry).length * 2, 98);
  if (!Number.isSafeInteger(size)) throw new Error("ZIP is too large");
  return size;
}

export async function* browserZip(entries: BrowserZipEntry[]): AsyncGenerator<Uint8Array> {
  browserZipSize(entries);
  let offset = 0;
  const directory: Uint8Array[] = [];
  for (const entry of entries) {
    const name = entrySize(entry);
    const start = offset;
    const local = header(30 + name.length + 20, 0x04034b50);
    local.view.setUint16(4, 45, true);
    local.view.setUint16(6, 0x0808, true);
    local.view.setUint16(12, 33, true); // 1980-01-01 (no local file timestamps disclosed)
    local.view.setUint32(18, 0xffffffff, true);
    local.view.setUint32(22, 0xffffffff, true);
    local.view.setUint16(26, name.length, true);
    local.view.setUint16(28, 20, true);
    local.bytes.set(name, 30);
    local.view.setUint16(30 + name.length, 1, true);
    local.view.setUint16(32 + name.length, 16, true);
    local.view.setBigUint64(34 + name.length, BigInt(entry.size), true);
    local.view.setBigUint64(42 + name.length, BigInt(entry.size), true);
    yield local.bytes;
    offset += local.bytes.length;
    let crc = 0;
    let read = 0;
    for await (const chunk of entry.chunks()) {
      read += chunk.length;
      if (read > entry.size) throw new Error("ZIP entry size mismatch");
      crc = updateCrc32(crc, chunk);
      offset += chunk.length;
      yield chunk;
    }
    if (read !== entry.size) throw new Error("ZIP entry size mismatch");
    const descriptor = header(24, 0x08074b50);
    descriptor.view.setUint32(4, crc, true);
    descriptor.view.setBigUint64(8, BigInt(read), true);
    descriptor.view.setBigUint64(16, BigInt(read), true);
    yield descriptor.bytes;
    offset += 24;

    const central = header(46 + name.length + 28, 0x02014b50);
    central.view.setUint16(4, 45, true);
    central.view.setUint16(6, 45, true);
    central.view.setUint16(8, 0x0808, true);
    central.view.setUint16(14, 33, true);
    central.view.setUint32(16, crc, true);
    central.view.setUint32(20, 0xffffffff, true);
    central.view.setUint32(24, 0xffffffff, true);
    central.view.setUint16(28, name.length, true);
    central.view.setUint16(30, 28, true);
    central.view.setUint32(42, 0xffffffff, true);
    central.bytes.set(name, 46);
    central.view.setUint16(46 + name.length, 1, true);
    central.view.setUint16(48 + name.length, 24, true);
    central.view.setBigUint64(50 + name.length, BigInt(read), true);
    central.view.setBigUint64(58 + name.length, BigInt(read), true);
    central.view.setBigUint64(66 + name.length, BigInt(start), true);
    directory.push(central.bytes);
  }
  const directoryStart = offset;
  for (const bytes of directory) { yield bytes; offset += bytes.length; }
  const end = header(56, 0x06064b50);
  end.view.setBigUint64(4, BigInt(44), true);
  end.view.setUint16(12, 45, true);
  end.view.setUint16(14, 45, true);
  end.view.setBigUint64(24, BigInt(entries.length), true);
  end.view.setBigUint64(32, BigInt(entries.length), true);
  end.view.setBigUint64(40, BigInt(offset - directoryStart), true);
  end.view.setBigUint64(48, BigInt(directoryStart), true);
  yield end.bytes;
  const locator = header(20, 0x07064b50);
  locator.view.setBigUint64(8, BigInt(offset), true);
  locator.view.setUint32(16, 1, true);
  yield locator.bytes;
  const legacy = header(22, 0x06054b50);
  legacy.view.setUint16(8, 0xffff, true);
  legacy.view.setUint16(10, 0xffff, true);
  legacy.view.setUint32(12, 0xffffffff, true);
  legacy.view.setUint32(16, 0xffffffff, true);
  yield legacy.bytes;
}
