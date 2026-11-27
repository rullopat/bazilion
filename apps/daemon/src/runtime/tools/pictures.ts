// Pictures an Agent reads or sends on: what kind a file is, from its first bytes, and the largest
// one sent to a provider.

/** The largest picture sent; the providers refuse much smaller ones already. */
export const MAX_PICTURE_BYTES = 25 * 1024 * 1024

export interface PictureType {
  mimeType: string
  extension: string
}

/** PNG, JPEG, GIF or WebP by its signature; null for anything else. */
export function pictureType(bytes: Uint8Array): PictureType | null {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return { mimeType: 'image/png', extension: 'png' }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return { mimeType: 'image/jpeg', extension: 'jpg' }
  if (
    buffer
      .subarray(0, 6)
      .toString('ascii')
      .match(/^GIF8[79]a$/)
  )
    return { mimeType: 'image/gif', extension: 'gif' }
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return { mimeType: 'image/webp', extension: 'webp' }
  return null
}
