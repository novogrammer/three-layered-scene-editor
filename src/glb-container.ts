/** Standard GLB chunks; geometry is produced by Three.js, images are appended unchanged. */
export interface GlbJson {
  asset: { version: string }
  buffers?: { byteLength: number }[]
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number }[]
  materials?: { name?: string; pbrMetallicRoughness?: { baseColorTexture?: { index: number } } }[]
  images?: { name: string; mimeType: string; bufferView: number }[]
  textures?: { sampler: number; source?: number; extensions?: { EXT_texture_webp: { source: number } } }[]
  samplers?: { magFilter: number; minFilter: number; wrapS: number; wrapT: number }[]
  extensionsUsed?: string[]
  extensionsRequired?: string[]
  [key: string]: unknown
}
const aligned = (n: number) => Math.ceil(n / 4) * 4

export function readGlb(buffer: ArrayBuffer): { json: GlbJson; binary: Uint8Array } {
  const view = new DataView(buffer)
  if (buffer.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2
    || view.getUint32(8, true) !== buffer.byteLength) throw new Error('GLBヘッダーが不正です。')
  let json: GlbJson | undefined, binary = new Uint8Array()
  for (let offset = 12; offset < buffer.byteLength;) {
    if (offset + 8 > buffer.byteLength) throw new Error('GLBチャンクが不正です。')
    const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true)
    if (length % 4 || offset + 8 + length > buffer.byteLength) throw new Error('GLBチャンクが不正です。')
    const bytes = new Uint8Array(buffer, offset + 8, length)
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(bytes)) as GlbJson
    if (type === 0x004e4942) binary = new Uint8Array(bytes)
    offset += 8 + length
  }
  if (!json) throw new Error('GLBのJSONがありません。')
  return { json, binary }
}

export function writeGlb(json: GlbJson, binary: Uint8Array): ArrayBuffer {
  if (binary.length) json.buffers = [{ byteLength: binary.length }]
  const text = new TextEncoder().encode(JSON.stringify(json)), jsonLength = aligned(text.length), binLength = aligned(binary.length)
  const buffer = new ArrayBuffer(12 + 8 + jsonLength + (binLength ? 8 + binLength : 0))
  const view = new DataView(buffer), bytes = new Uint8Array(buffer)
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, buffer.byteLength, true)
  view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true)
  bytes.fill(0x20, 20, 20 + jsonLength); bytes.set(text, 20)
  if (binLength) {
    const offset = 20 + jsonLength
    view.setUint32(offset, binLength, true); view.setUint32(offset + 4, 0x004e4942, true)
    bytes.set(binary, offset + 8)
  }
  return buffer
}

export interface GlbOriginalImage { fileName: string; mimeType: string; bytes: Uint8Array }

export function embedOriginalImages(buffer: ArrayBuffer, images: ReadonlyMap<string, GlbOriginalImage>): ArrayBuffer {
  const { json, binary } = readGlb(buffer)
  const parts: { offset: number; bytes: Uint8Array }[] = [{ offset: 0, bytes: binary }]
  let byteLength = binary.length
  const seen = new Map<GlbOriginalImage, number>()
  for (const material of json.materials ?? []) {
    const image = images.get(material.name ?? '')
    if (!image) throw new Error('GLBに格納する元画像が見つかりません。')
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType) || !image.bytes.length) throw new Error('元画像の形式またはデータが不正です。')
    let textureIndex = seen.get(image)
    if (textureIndex === undefined) {
      const offset = aligned(byteLength)
      parts.push({ offset, bytes: image.bytes }); byteLength = offset + image.bytes.length
      const bufferView = (json.bufferViews ??= []).push({ buffer: 0, byteOffset: offset, byteLength: image.bytes.length }) - 1
      const source = (json.images ??= []).push({ name: image.fileName, mimeType: image.mimeType, bufferView }) - 1
      if (!json.samplers?.length) json.samplers = [{ magFilter: 9729, minFilter: 9729, wrapS: 33071, wrapT: 33071 }]
      const texture = image.mimeType === 'image/webp'
        ? { sampler: 0, extensions: { EXT_texture_webp: { source } } } : { sampler: 0, source }
      textureIndex = (json.textures ??= []).push(texture) - 1
      if (image.mimeType === 'image/webp') {
        json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), 'EXT_texture_webp'])]
        json.extensionsRequired = [...new Set([...(json.extensionsRequired ?? []), 'EXT_texture_webp'])]
      }
      seen.set(image, textureIndex)
    }
    ;(material.pbrMetallicRoughness ??= {}).baseColorTexture = { index: textureIndex }
  }
  const combined = new Uint8Array(byteLength)
  parts.forEach(part => combined.set(part.bytes, part.offset))
  return writeGlb(json, combined)
}
