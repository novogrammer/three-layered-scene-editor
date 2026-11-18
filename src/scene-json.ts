import type { LayerData, SceneSettings } from './model'

export interface ImageSource {
  fileName: string
  blob: Blob
}

type SavedPlacement =
  | { type: 'screen'; rectPx: { x: number; y: number; width: number; height: number }; zPx: number }
  | { type: 'surface'; centerXPx: number; widthPx: number; frontZPx: number; backZPx: number }
  | { type: 'surface'; centerYPx: number; heightPx: number; frontZPx: number; backZPx: number }

function savedPlacement(layer: LayerData): SavedPlacement {
  const p = layer.placement
  if (p.type === 'screen') return { type: 'screen', rectPx: { ...p.rectPx }, zPx: p.zPx }
  const depth = { frontZPx: p.frontZPx, backZPx: p.backZPx }
  return layer.orientation.direction === 'left' || layer.orientation.direction === 'right'
    ? { type: 'surface', centerYPx: p.centerPx, heightPx: p.sizePx, ...depth }
    : { type: 'surface', centerXPx: p.centerPx, widthPx: p.sizePx, ...depth }
}

async function imageDataUrl(blob: Blob): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type) || !blob.size) {
    throw new Error('保存する画像の形式またはデータが不正です。')
  }
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const chunks: string[] = []
  // Each full chunk has a multiple of three bytes, so concatenating base64 is lossless.
  for (let offset = 0; offset < bytes.length; offset += 24576) {
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24576))))
  }
  return `data:${blob.type};base64,${chunks.join('')}`
}

/** Capture the committed scene and source files before any asynchronous image encoding. */
export async function createSceneDocument(settings: SceneSettings, layers: readonly LayerData[], sources: ReadonlyMap<string, ImageSource>) {
  const config = { ...settings }
  const snapshot = structuredClone(layers)
  const images = snapshot.map(layer => {
    const source = sources.get(layer.id)
    if (!source) throw new Error(`「${layer.name}」の元画像が見つかりません。`)
    return { id: `image-${layer.id}`, name: source.fileName, blob: source.blob }
  })
  const assets = await Promise.all(images.map(async image => ({
    id: image.id, name: image.name, mimeType: image.blob.type, data: await imageDataUrl(image.blob),
  })))
  return {
    schemaVersion: 1,
    composition: { width: config.width, height: config.height },
    referencePlane: { height: config.referenceHeight },
    projectionCamera: { fov: config.fov },
    projection: { imageFit: 'cover', imageAlign: 'center', outsideImage: 'clamp' },
    layers: snapshot.map(layer => ({
      id: layer.id, name: layer.name, imageId: `image-${layer.id}`,
      visible: layer.visible, editorColor: layer.editorColor, alphaMode: layer.alphaMode,
      orientation: { ...layer.orientation }, originPx: { ...layer.originPx }, placement: savedPlacement(layer),
    })),
    assets,
  }
}
