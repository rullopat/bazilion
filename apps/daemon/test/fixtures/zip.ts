// Reads back an archive written by `lib/zip.ts`: stored files only, no compression.

export interface StoredFile {
  name: string
  bytes: Buffer
  /** The CRC-32 the archive records for the file. */
  crc: number
}

export function readStoredZip(zip: Buffer): StoredFile[] {
  const end = zip.length - 22
  if (zip.readUInt32LE(end) !== 0x06054b50) throw new Error('no end-of-directory record')
  const count = zip.readUInt16LE(end + 10)
  let at = zip.readUInt32LE(end + 16)
  const files: StoredFile[] = []
  for (let index = 0; index < count; index++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error('bad directory entry')
    if (zip.readUInt16LE(at + 10) !== 0) throw new Error('file is not stored')
    const crc = zip.readUInt32LE(at + 16)
    const size = zip.readUInt32LE(at + 24)
    const nameLength = zip.readUInt16LE(at + 28)
    const local = zip.readUInt32LE(at + 42)
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8')
    if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error('bad file header')
    const data = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    files.push({ name, bytes: zip.subarray(data, data + size), crc })
    at += 46 + nameLength
  }
  return files
}
