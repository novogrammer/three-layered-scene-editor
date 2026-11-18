/** Consumer-side metadata contract; independent of editor types. */
export const EXTRAS = 'threeLayeredScene'
export type ProjectionMode = 'tsl' | 'standard'
export type Sampling = { mode: 'uv'; texCoord: 0 } | { mode: 'camera'; cameraId: string; imageUvScale: [number, number]; imageUvOffset: [number, number] }
export interface LayerInfo { layerId: string; listIndex: number; sampling: Sampling }
export function fail(message: string): never { throw new Error(message) }
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('extrasの構造が不正です。')
  return value as Record<string, unknown>
}
export function metadata(value: unknown, role: string) {
  const data = record(value)
  if (data.version !== 1 || data.role !== role) fail(`未対応または不正な${role}のextrasです。`)
  return data
}
export function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value) fail('extrasのIDが不正です。')
  return value
}
function pair(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(n => typeof n === 'number' && Number.isFinite(n))) fail('UV変換が不正です。')
  return [value[0], value[1]]
}
export function readLayer(value: unknown, cameraId: string): LayerInfo {
  const data = metadata(value, 'layer'), sampling = record(data.sampling)
  if (typeof data.listIndex !== 'number' || !Number.isSafeInteger(data.listIndex) || data.listIndex < 0) fail('一覧順が不正です。')
  const common = { layerId: identifier(data.layerId), listIndex: data.listIndex }
  if (sampling.mode === 'uv' && sampling.texCoord === 0) return { ...common, sampling: { mode: 'uv', texCoord: 0 } }
  if (sampling.mode === 'camera' && sampling.cameraId === cameraId) {
    const scale = pair(sampling.imageUvScale), offset = pair(sampling.imageUvOffset)
    if (scale.some(n => n <= 0)) fail('UV倍率は正の値にしてください。')
    return { ...common, sampling: { mode: 'camera', cameraId, imageUvScale: scale, imageUvOffset: offset } }
  }
  return fail('未対応のサンプリング方式、または不正な投影カメラ参照です。')
}

