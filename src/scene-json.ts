import type { LayerData, SceneSettings } from './model'
import type { ImageAssetV1, SceneDocumentV2, SceneLayerV2 } from './scene-document'

export interface ImageSource {
  fileName: string
  blob: Blob
}

function savedLayer(layer: LayerData): SceneLayerV2 {
  const common = {
    id: layer.id, name: layer.name, imageId: `image-${layer.id}`,
    visible: layer.visible, editorColor: layer.editorColor, alphaMode: layer.alphaMode,
    originPx: { ...layer.originPx },
    framePx: { ...layer.framePx },
  }
  const p = layer.placement
  if (p.type === 'screen') {
    if (layer.orientation.relation !== 'parallel') throw new Error('面の向きと配置方式が一致していません。')
    return { ...common, orientation: { relation: 'parallel', direction: 'front' },
      placement: { type: 'screen', rectPx: { ...p.rectPx }, zPx: p.zPx } }
  }
  if (layer.orientation.relation !== 'perpendicular') throw new Error('面の向きと配置方式が一致していません。')
  const direction = layer.orientation.direction
  const depth = { frontZPx: p.frontZPx, backZPx: p.backZPx }
  return direction === 'left' || direction === 'right'
    ? { ...common, orientation: { relation: 'perpendicular', direction },
      placement: { type: 'surface', centerYPx: p.centerPx, heightPx: p.sizePx, ...depth } }
    : { ...common, orientation: { relation: 'perpendicular', direction },
      placement: { type: 'surface', centerXPx: p.centerPx, widthPx: p.sizePx, ...depth } }
}

async function encodeImage(blob: Blob): Promise<Pick<ImageAssetV1, 'mimeType' | 'data'>> {
  const mimeType = blob.type
  if ((mimeType !== 'image/png' && mimeType !== 'image/jpeg' && mimeType !== 'image/webp') || !blob.size) {
    throw new Error('保存する画像の形式またはデータが不正です。')
  }
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const chunks: string[] = []
  // Each full chunk has a multiple of three bytes, so concatenating base64 is lossless.
  for (let offset = 0; offset < bytes.length; offset += 24576) {
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24576))))
  }
  return { mimeType, data: `data:${mimeType};base64,${chunks.join('')}` }
}

/** Capture the committed scene and source files before any asynchronous image encoding. */
export async function createSceneDocument(settings: SceneSettings, layers: readonly LayerData[], sources: ReadonlyMap<string, ImageSource>): Promise<SceneDocumentV2> {
  const config = { ...settings }
  const snapshot = structuredClone(layers)
  const images = snapshot.map(layer => {
    const source = sources.get(layer.id)
    if (!source) throw new Error(`「${layer.name}」の元画像が見つかりません。`)
    return { id: `image-${layer.id}`, name: source.fileName, blob: source.blob }
  })
  const assets: ImageAssetV1[] = await Promise.all(images.map(async image => ({
    id: image.id, name: image.name, ...await encodeImage(image.blob),
  })))
  return {
    schemaVersion: 2,
    composition: { width: config.width, height: config.height },
    referencePlane: { height: config.referenceHeight },
    projectionCamera: { fov: config.fov },
    projection: { imageFit: 'cover', imageAlign: 'center', outsideImage: 'clamp' },
    layers: snapshot.map(savedLayer),
    assets,
  }
}
