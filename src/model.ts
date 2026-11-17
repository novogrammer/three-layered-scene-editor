/** Pixels are an input coordinate system; scene dimensions remain independent. */
export interface SceneSettings {
  width: number
  height: number
  referenceHeight: number
  fov: number
}

export interface Rect { x: number; y: number; width: number; height: number }
export interface Transform { x: number; y: number; z: number; width: number; height: number }
export type AlphaMode = 'OPAQUE' | 'BLEND'
export interface Layer {
  id: string
  name: string
  kind: 'front' | 'ground'
  editorColor: string
  visible: boolean
  alphaMode: AlphaMode
  rect: Rect
  transform: Transform
}

export const defaultSettings: SceneSettings = { width: 1920, height: 1080, referenceHeight: 5, fov: 45 }

// Shared by the initial geometry and the demo artwork so their ground boundaries agree.
export const defaultGroundTransform: Transform = { x: 0, y: -2.5, z: -8, width: 60, height: 40 }

export function referenceMetrics(settings: SceneSettings) {
  const { width, height, referenceHeight, fov } = settings
  if (![width, height, referenceHeight, fov].every(Number.isFinite)
    || width <= 0 || height <= 0 || referenceHeight <= 0 || fov <= 0 || fov >= 180) {
    throw new Error('解像度・基準高さは正の値、FOVは0°より大きく180°未満で指定してください。')
  }
  return {
    width: referenceHeight * width / height,
    height: referenceHeight,
    scale: referenceHeight / height,
    cameraZ: referenceHeight / (2 * Math.tan(fov * Math.PI / 360)),
    aspect: width / height,
    near: Math.max(0.001, referenceHeight / 1000),
  }
}

export function placeFront(settings: SceneSettings, rect: Rect, z: number): Transform {
  const metrics = referenceMetrics(settings)
  if (![rect.x, rect.y, rect.width, rect.height, z].every(Number.isFinite)
    || rect.width <= 0 || rect.height <= 0 || z >= metrics.cameraZ - metrics.near) {
    throw new Error('矩形のサイズは正の値にし、レイヤーをカメラより奥へ配置してください。')
  }
  const scale = metrics.scale * (metrics.cameraZ - z) / metrics.cameraZ
  return {
    x: (rect.x + rect.width / 2 - settings.width / 2) * scale,
    y: (settings.height / 2 - rect.y - rect.height / 2) * scale,
    z,
    width: rect.width * scale,
    height: rect.height * scale,
  }
}

/** Recover the screen rectangle before a subsequent assisted depth change. */
export function frontRect(settings: SceneSettings, transform: Transform): Rect {
  const metrics = referenceMetrics(settings)
  const scale = metrics.scale * (metrics.cameraZ - transform.z) / metrics.cameraZ
  if (scale <= 0) throw new Error('カメラ前方にあるレイヤーのみ2D配置へ換算できます。')
  const width = transform.width / scale
  const height = transform.height / scale
  return {
    x: transform.x / scale + settings.width / 2 - width / 2,
    y: settings.height / 2 - transform.y / scale - height / 2,
    width,
    height,
  }
}

export function initialLayers(settings: SceneSettings): Layer[] {
  const rect = { x: 0, y: 0, width: settings.width, height: settings.height }
  return [
    { id: 'layer-1', name: 'レイヤー 1', kind: 'front', editorColor: '#78c5b1', visible: true,
      alphaMode: 'BLEND', rect: { ...rect }, transform: placeFront(settings, rect, -40) },
    { id: 'layer-2', name: 'レイヤー 2', kind: 'front', editorColor: '#efb66d', visible: true,
      alphaMode: 'BLEND', rect: { ...rect }, transform: placeFront(settings, rect, 1) },
    { id: 'ground', name: '地面', kind: 'ground', editorColor: '#9695e4', visible: true,
      alphaMode: 'OPAQUE', rect: { ...rect }, transform: { ...defaultGroundTransform } },
  ]
}

/** Atomically compute a settings change. Preview camera offsets never enter this model. */
export function reconfigureScene(previous: SceneSettings, next: SceneSettings, layers: Layer[], preserveScreen: boolean): Layer[] {
  const metrics = referenceMetrics(next)
  return layers.map((layer) => {
    let transform = { ...layer.transform }
    let rect = { ...layer.rect }
    if (layer.kind === 'front' && preserveScreen) {
      const old = frontRect(previous, layer.transform)
      rect = {
        x: old.x * next.width / previous.width,
        y: old.y * next.height / previous.height,
        width: old.width * next.width / previous.width,
        height: old.height * next.height / previous.height,
      }
      transform = placeFront(next, rect, layer.transform.z)
    }
    if (layer.kind === 'front' && transform.z >= metrics.cameraZ - metrics.near) {
      throw new Error('設定変更後にカメラのnear面を越えるレイヤーがあります。奥行きを下げてから適用してください。')
    }
    return { ...layer, rect, transform }
  })
}
