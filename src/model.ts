/** Pixels are an input coordinate system; scene dimensions remain independent. */
export interface SceneSettings {
  width: number
  height: number
  referenceHeight: number
  fov: number
}

export interface Rect { x: number; y: number; width: number; height: number }
export interface Transform { x: number; y: number; z: number; width: number; height: number }
export type PlaneDirection = 'front' | 'down' | 'up' | 'left' | 'right'
export type PlaneOrientation =
  | { relation: 'parallel'; direction: 'front' }
  | { relation: 'perpendicular'; direction: 'down' | 'up' | 'left' | 'right' }
export interface PlacementOrigin { x: number; y: number; z: 0 }
export interface DepthRange { frontZ: number; backZ: number }
export const planeDirections: Record<PlaneDirection, string> = {
  front: '正面', down: '下（地面）', up: '上（天井）', left: '左（壁）', right: '右（壁）',
}
export const planeRelations = { parallel: '基準面に平行', perpendicular: '基準面に垂直' }

export function orientationFor(direction: PlaneDirection): PlaneOrientation {
  return direction === 'front' ? { relation: 'parallel', direction } : { relation: 'perpendicular', direction }
}
export function usesProjection(layer: Layer) { return layer.orientation.relation === 'perpendicular' }
export function isWall(layer: Layer) { return layer.orientation.direction === 'left' || layer.orientation.direction === 'right' }
export type AlphaMode = 'OPAQUE' | 'BLEND'
export interface Layer {
  id: string
  name: string
  orientation: PlaneOrientation
  origin: PlacementOrigin
  editorColor: string
  visible: boolean
  alphaMode: AlphaMode
  rect: Rect
  // Surface endpoints are authoritative; transform center/depth are derived render values.
  depthRange: Readonly<DepthRange> | null
  transform: Transform
}

export const defaultSettings: SceneSettings = { width: 1920, height: 1080, referenceHeight: 5, fov: 45 }

// The static sample ground image was exported to match this initial geometry.
export const defaultGroundDepthRange: Readonly<DepthRange> = { frontZ: 0, backZ: -28 }
export const defaultGroundTransform: Transform = {
  x: 0, y: -2.5, width: 60,
  z: (defaultGroundDepthRange.frontZ + defaultGroundDepthRange.backZ) / 2,
  height: defaultGroundDepthRange.frontZ - defaultGroundDepthRange.backZ,
}

export function setDepthRange(layer: Layer, frontZ: number, backZ: number): Layer {
  if (layer.orientation.relation === 'parallel') throw new Error('正面レイヤーは奥行きZで配置してください。')
  if (![frontZ, backZ].every(Number.isFinite) || frontZ <= backZ) {
    throw new Error('手前端Zは奥端Zより大きい有限の数値にしてください。')
  }
  const depthAxis = isWall(layer) ? 'width' : 'height'
  return {
    ...layer,
    orientation: { ...layer.orientation },
    origin: { ...layer.origin },
    rect: { ...layer.rect },
    depthRange: { frontZ, backZ },
    transform: { ...layer.transform, z: (frontZ + backZ) / 2, [depthAxis]: frontZ - backZ },
  }
}

export function defaultOrigin(settings: SceneSettings, direction: PlaneDirection): PlacementOrigin {
  const metrics = referenceMetrics(settings)
  return {
    x: direction === 'left' ? -metrics.width / 2 : direction === 'right' ? metrics.width / 2 : 0,
    y: direction === 'down' ? -metrics.height / 2 : direction === 'up' ? metrics.height / 2 : 0,
    z: 0,
  }
}

/** Normals face the interior of the box. No free Euler-angle editing. */
export function orientationRotation(direction: PlaneDirection): [number, number, number] {
  switch (direction) {
    case 'down': return [-Math.PI / 2, 0, 0]
    case 'up': return [Math.PI / 2, 0, 0]
    case 'left': return [0, Math.PI / 2, 0]
    case 'right': return [0, -Math.PI / 2, 0]
    case 'front': return [0, 0, 0]
  }
}

/** Move the placement origin and geometry together; the origin always stays at z=0. */
export function moveOrigin(layer: Layer, x: number, y: number): Layer {
  if (![x, y].every(Number.isFinite)) throw new Error('配置基準点には有限の数値を指定してください。')
  return {
    ...layer,
    orientation: { ...layer.orientation },
    origin: { x, y, z: 0 },
    rect: { ...layer.rect },
    depthRange: layer.depthRange ? { ...layer.depthRange } : null,
    transform: { ...layer.transform, x: layer.transform.x + x - layer.origin.x, y: layer.transform.y + y - layer.origin.y },
  }
}

export function changeOrientation(settings: SceneSettings, layer: Layer, orientation: PlaneOrientation): Layer {
  if (orientation.direction === layer.orientation.direction) return layer
  const origin = defaultOrigin(settings, orientation.direction)
  const moved = moveOrigin(layer, origin.x, origin.y)
  if (orientation.direction === 'down' || orientation.direction === 'up') moved.transform.y = origin.y
  if (orientation.direction === 'left' || orientation.direction === 'right') moved.transform.x = origin.x
  const metrics = referenceMetrics(settings)
  if (orientation.relation === 'parallel' && moved.transform.z >= metrics.cameraZ - metrics.near) {
    throw new Error('平行な面に変更する前に、両端Zの範囲をカメラより奥へ移動してください。')
  }
  const changed = { ...moved, orientation: { ...orientation } }
  if (orientation.relation === 'parallel') return { ...changed, depthRange: null }
  const size = isWall(changed) ? changed.transform.width : changed.transform.height
  return setDepthRange(changed, changed.transform.z + size / 2, changed.transform.z - size / 2)
}

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
    { id: 'layer-1', name: 'レイヤー 1', orientation: orientationFor('front'), editorColor: '#78c5b1', visible: true,
      origin: defaultOrigin(settings, 'front'),
      depthRange: null,
      alphaMode: 'BLEND', rect: { ...rect }, transform: placeFront(settings, rect, -40) },
    { id: 'layer-2', name: 'レイヤー 2', orientation: orientationFor('front'), editorColor: '#efb66d', visible: true,
      origin: defaultOrigin(settings, 'front'),
      depthRange: null,
      alphaMode: 'BLEND', rect: { ...rect }, transform: placeFront(settings, rect, 1) },
    setDepthRange({ id: 'ground', name: '地面', orientation: orientationFor('down'), editorColor: '#9695e4', visible: true,
      origin: defaultOrigin(settings, 'down'),
      depthRange: null,
      alphaMode: 'OPAQUE', rect: { ...rect }, transform: { ...defaultGroundTransform, y: defaultOrigin(settings, 'down').y } },
      defaultGroundDepthRange.frontZ, defaultGroundDepthRange.backZ),
  ]
}

/** Atomically compute a settings change. Preview camera offsets never enter this model. */
export function reconfigureScene(previous: SceneSettings, next: SceneSettings, layers: Layer[], preserveScreen: boolean): Layer[] {
  const metrics = referenceMetrics(next)
  // Compensate the FOV change only; reference-height changes remain independent.
  const depthScale = Math.tan(previous.fov * Math.PI / 360) / Math.tan(next.fov * Math.PI / 360)
  return layers.map((layer) => {
    let depthRange = layer.depthRange ? { ...layer.depthRange } : null
    let transform = { ...layer.transform }
    let rect = { ...layer.rect }
    if (layer.orientation.relation === 'perpendicular') {
      if (!depthRange) throw new Error('面の手前端Z・奥端Zが設定されていません。')
      depthRange = { frontZ: depthRange.frontZ * depthScale, backZ: depthRange.backZ * depthScale }
      transform = setDepthRange(layer, depthRange.frontZ, depthRange.backZ).transform
    }
    if (layer.orientation.relation === 'parallel' && preserveScreen) {
      const old = frontRect(previous, layer.transform)
      rect = {
        x: old.x * next.width / previous.width,
        y: old.y * next.height / previous.height,
        width: old.width * next.width / previous.width,
        height: old.height * next.height / previous.height,
      }
      transform = placeFront(next, rect, layer.transform.z)
    }
    if (layer.orientation.relation === 'parallel' && transform.z >= metrics.cameraZ - metrics.near) {
      throw new Error('設定変更後にカメラのnear面を越えるレイヤーがあります。奥行きを下げてから適用してください。')
    }
    return { ...layer, orientation: { ...layer.orientation }, origin: { ...layer.origin }, depthRange, rect, transform }
  })
}
