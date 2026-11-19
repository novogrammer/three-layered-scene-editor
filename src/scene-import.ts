import { createLayerModel, referenceMetrics, validateScenePlacement } from './model'
import type { LayerData, SceneSettings } from './model'
import type { ImageAssetV1, SceneDocumentV2, SceneLayerV1, SceneLayerV2 } from './scene-document'

function invalid(message: string): never { throw new Error(`JSONを読み込めません。${message}`) }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('データの構造が不正です。')
  return value as Record<string, unknown>
}
function string(value: unknown): string {
  if (typeof value !== 'string') invalid('文字列が必要です。')
  return value
}
function id(value: unknown): string {
  const result = string(value)
  if (!result) invalid('IDが空です。')
  return result
}
function number(value: unknown, positive = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive && value <= 0)) invalid('数値が不正です。')
  return value
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) invalid('配列が必要です。')
  return value
}
function unique(ids: string[]) {
  if (new Set(ids).size !== ids.length) invalid('IDが重複しています。')
}
function layer(value: unknown): SceneLayerV1 {
  const v = object(value), origin = object(v.originPx), orientation = object(v.orientation), p = object(v.placement)
  if (typeof v.visible !== 'boolean') invalid('表示状態が不正です。')
  if (v.alphaMode !== 'OPAQUE' && v.alphaMode !== 'BLEND') invalid('マテリアル設定が未対応です。')
  const alphaMode: SceneLayerV1['alphaMode'] = v.alphaMode
  const editorColor = string(v.editorColor)
  if (!/^#[0-9a-fA-F]{6}$/.test(editorColor)) invalid('識別色が不正です。')
  if (origin.z !== 0) invalid('配置基準点のZは0にしてください。')
  const common = { id: id(v.id), name: string(v.name), imageId: id(v.imageId), visible: v.visible,
    editorColor, alphaMode, originPx: { x: number(origin.x), y: number(origin.y), z: 0 as const } }
  if (orientation.relation === 'parallel' && orientation.direction === 'front' && p.type === 'screen') {
    const r = object(p.rectPx)
    return { ...common, orientation: { relation: 'parallel', direction: 'front' },
      placement: { type: 'screen', rectPx: { x: number(r.x), y: number(r.y), width: number(r.width, true), height: number(r.height, true) }, zPx: number(p.zPx) } }
  }
  const direction = orientation.direction
  if (orientation.relation !== 'perpendicular' || p.type !== 'surface') invalid('面の向きと配置方式が不正です。')
  const depth = { frontZPx: number(p.frontZPx), backZPx: number(p.backZPx) }
  if (depth.frontZPx <= depth.backZPx) invalid('手前端Zは奥端Zより大きくしてください。')
  if (direction === 'down' || direction === 'up') {
    return { ...common, orientation: { relation: 'perpendicular', direction },
      placement: { type: 'surface', centerXPx: number(p.centerXPx), widthPx: number(p.widthPx, true), ...depth } }
  }
  if (direction === 'left' || direction === 'right') {
    return { ...common, orientation: { relation: 'perpendicular', direction },
      placement: { type: 'surface', centerYPx: number(p.centerYPx), heightPx: number(p.heightPx, true), ...depth } }
  }
  return invalid('面の向きが未対応です。')
}
function asset(value: unknown): ImageAssetV1 {
  const v = object(value)
  if (v.mimeType !== 'image/png' && v.mimeType !== 'image/jpeg' && v.mimeType !== 'image/webp') invalid('画像形式が未対応です。')
  return { id: id(v.id), name: string(v.name), mimeType: v.mimeType, data: string(v.data) }
}

/** Normalize legacy v1 into v2 before restoring any runtime objects. */
export function parseSceneDocument(text: string): SceneDocumentV2 {
  let value: unknown
  try { value = JSON.parse(text) } catch { return invalid('JSONの構文が不正です。') }
  const v = object(value)
  if (v.schemaVersion !== 1 && v.schemaVersion !== 2) invalid('対応していない保存形式のバージョンです。')
  const c = object(v.composition), r = object(v.referencePlane), camera = object(v.projectionCamera), projection = object(v.projection)
  const width = number(c.width), height = number(c.height), referenceHeight = number(r.height), fov = number(camera.fov)
  try { referenceMetrics({ width, height, referenceHeight, fov }) }
  catch (error) { invalid(error instanceof Error ? error.message : '基準設定が不正です。') }
  if (projection.imageFit !== 'cover' || projection.imageAlign !== 'center' || projection.outsideImage !== 'clamp') invalid('投影設定が未対応です。')
  const layers = array(v.layers).map(value => {
    const frame = v.schemaVersion === 1 ? { width, height } : object(object(value).framePx)
    return { ...layer(value), framePx: { width: number(frame.width, true), height: number(frame.height, true) } }
  }), assets = array(v.assets).map(asset)
  unique(layers.map(l => l.id)); unique(assets.map(a => a.id))
  const assetIds = new Set(assets.map(a => a.id))
  if (layers.some(l => !assetIds.has(l.imageId))) invalid('参照する画像がありません。')
  return { schemaVersion: 2, composition: { width, height }, referencePlane: { height: referenceHeight },
    projectionCamera: { fov }, projection: { imageFit: 'cover', imageAlign: 'center', outsideImage: 'clamp' }, layers, assets }
}

function imageBlob(asset: ImageAssetV1): Blob {
  const prefix = `data:${asset.mimeType};base64,`
  if (!asset.data.startsWith(prefix)) invalid('画像はMIMEが一致する埋め込みData URLで指定してください。')
  const encoded = asset.data.slice(prefix.length)
  if (!encoded || encoded.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) invalid('画像データが不正です。')
  let binary: string
  try { binary = atob(encoded) } catch { return invalid('画像のBase64が不正です。') }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: asset.mimeType })
}

function editableLayer(value: SceneLayerV2): LayerData {
  const p = value.placement
  const placement: LayerData['placement'] = p.type === 'screen' ? { ...p, rectPx: { ...p.rectPx } }
    : 'centerXPx' in p ? { type: 'surface', centerPx: p.centerXPx, sizePx: p.widthPx, frontZPx: p.frontZPx, backZPx: p.backZPx }
    : { type: 'surface', centerPx: p.centerYPx, sizePx: p.heightPx, frontZPx: p.frontZPx, backZPx: p.backZPx }
  return { id: value.id, name: value.name, orientation: { ...value.orientation }, originPx: { ...value.originPx },
    editorColor: value.editorColor, visible: value.visible, alphaMode: value.alphaMode, placement, framePx: { ...value.framePx } }
}

/** Prepare everything without touching the active editor. The caller installs only a complete result. */
export async function prepareSceneImport<T extends { width: number; height: number }>(text: string, decode: (blob: Blob) => Promise<T>) {
  const doc = parseSceneDocument(text)
  const settings: SceneSettings = { ...doc.composition, referenceHeight: doc.referencePlane.height, fov: doc.projectionCamera.fov }
  const layers = doc.layers.map(value => createLayerModel(settings, editableLayer(value)))
  validateScenePlacement(settings, layers)
  const decoded = new Map<string, { image: T; blob: Blob; fileName: string }>()
  for (const value of doc.assets) {
    const blob = imageBlob(value), image = await decode(blob)
    if (![image.width, image.height].every(n => Number.isSafeInteger(n) && n > 0)) invalid('画像の寸法が不正です。')
    decoded.set(value.id, { image, blob, fileName: value.name })
  }
  const assets = new Map(doc.layers.map(layer => [layer.id, decoded.get(layer.imageId)!]))
  return { settings, layers, assets }
}
