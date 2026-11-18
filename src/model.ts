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
  front: '正面', down: '下', up: '上', left: '左', right: '右',
}
export const planeRelations = { parallel: '平行', perpendicular: '垂直' }

export function orientationFor(direction: PlaneDirection): PlaneOrientation {
  return direction === 'front' ? { relation: 'parallel', direction } : { relation: 'perpendicular', direction }
}
export function usesProjection(layer: Layer) { return layer.orientation.relation === 'perpendicular' }
export function isWall(layer: Layer) { return layer.orientation.direction === 'left' || layer.orientation.direction === 'right' }
export type AlphaMode = 'OPAQUE' | 'BLEND'
export type Placement =
  | { type: 'screen'; rectPx: Rect; zPx: number }
  | { type: 'surface'; centerPx: number; sizePx: number; frontZPx: number; backZPx: number }

/** Only these fields are authoritative. Scene-facing properties below are accessors. */
export interface LayerData {
  id: string
  name: string
  orientation: PlaneOrientation
  originPx: PlacementOrigin
  editorColor: string
  visible: boolean
  alphaMode: AlphaMode
  placement: Placement
}
export interface Layer extends LayerData {
  readonly origin: PlacementOrigin
  readonly depthRange: Readonly<DepthRange> | null
  transform: Transform
}

export const defaultSettings: SceneSettings = { width: 1920, height: 1080, referenceHeight: 5, fov: 45 }

function assertFinite(...values: number[]) {
  if (!values.every(Number.isFinite)) throw new Error('有限の数値を指定してください。')
}

// Settings belong to the scene, not serialized layer data.
const configurations = new WeakMap<Layer, SceneSettings>()

/** Bind scene-unit accessors to a snapshot of the reference settings; no scene values are cached. */
export function createLayerModel(settings: SceneSettings, data: LayerData): Layer {
  const config = { ...settings }
  const scale = referenceMetrics(config).scale
  const layer = structuredClone(data) as Layer
  if ((layer.placement.type === 'screen') !== (layer.orientation.relation === 'parallel')) {
    throw new Error('面の向きと配置方式が一致していません。')
  }
  const read = (): Transform => {
    const p = layer.placement
    if (p.type === 'screen') return placeFront(config, p.rectPx, p.zPx * scale)
    const wall = isWall(layer)
    return {
      x: (wall ? layer.originPx.x : p.centerPx) * scale,
      y: (wall ? p.centerPx : layer.originPx.y) * scale,
      z: (p.frontZPx + p.backZPx) / 2 * scale,
      width: (wall ? p.frontZPx - p.backZPx : p.sizePx) * scale,
      height: (wall ? p.sizePx : p.frontZPx - p.backZPx) * scale,
    }
  }
  const write = (key: keyof Transform, value: number) => {
    assertFinite(value)
    if (value === read()[key]) return
    if ((key === 'width' || key === 'height') && value <= 0) throw new Error('サイズは正の値にしてください。')
    const p = layer.placement
    if (p.type === 'screen') {
      const t = read()
      // A direct 3D Z edit preserves world geometry. Screen-preserving Z edits use setFrontDepth.
      if (key === 'z') {
        const rect = frontRect(config, { ...t, z: value })
        placeFront(config, rect, value)
        p.rectPx = rect; p.zPx = value / scale
        return
      }
      const perspectiveScale = scale * (referenceMetrics(config).cameraZ - t.z) / referenceMetrics(config).cameraZ
      const r = p.rectPx
      // Update only affected screen coordinates; preserve all untouched values exactly.
      if (key === 'x') r.x = value / perspectiveScale + config.width / 2 - r.width / 2
      if (key === 'y') r.y = config.height / 2 - value / perspectiveScale - r.height / 2
      if (key === 'width') { const width = value / perspectiveScale; r.x += (r.width - width) / 2; r.width = width }
      if (key === 'height') { const height = value / perspectiveScale; r.y += (r.height - height) / 2; r.height = height }
    } else {
      const wall = isWall(layer)
      if (key === 'x') { if (wall) layer.originPx.x = value / scale; else p.centerPx = value / scale }
      if (key === 'y') { if (wall) p.centerPx = value / scale; else layer.originPx.y = value / scale }
      if (key === 'z') {
        const delta = value / scale - (p.frontZPx + p.backZPx) / 2
        p.frontZPx += delta; p.backZPx += delta
      }
      if (key === 'width' || key === 'height') {
        if (key === (wall ? 'height' : 'width')) p.sizePx = value / scale
        else {
          const center = (p.frontZPx + p.backZPx) / 2
          p.frontZPx = center + value / scale / 2
          p.backZPx = center - value / scale / 2
        }
      }
    }
  }
  const transform = {} as Transform
  for (const key of ['x', 'y', 'z', 'width', 'height'] as const) {
    Object.defineProperty(transform, key, { enumerable: true, get: () => read()[key], set: (value: number) => write(key, value) })
  }
  Object.defineProperties(layer, {
    origin: { get: () => ({ x: layer.originPx.x * scale, y: layer.originPx.y * scale, z: 0 }) },
    depthRange: { get: () => layer.placement.type === 'surface'
      ? { frontZ: layer.placement.frontZPx * scale, backZ: layer.placement.backZPx * scale } : null },
    transform: {
      get: () => transform,
      set: (value: Transform) => {
        assertFinite(value.x, value.y, value.z, value.width, value.height)
        if (value.width <= 0 || value.height <= 0) throw new Error('サイズは正の値にしてください。')
        if (layer.placement.type === 'screen') {
          const rect = frontRect(config, value)
          placeFront(config, rect, value.z)
          layer.placement = { type: 'screen', rectPx: rect, zPx: value.z / scale }
        } else {
          const wall = isWall(layer)
          const depth = wall ? value.width : value.height
          layer.originPx[wall ? 'x' : 'y'] = (wall ? value.x : value.y) / scale
          layer.placement = { type: 'surface', centerPx: (wall ? value.y : value.x) / scale,
            sizePx: (wall ? value.height : value.width) / scale,
            frontZPx: (value.z + depth / 2) / scale, backZPx: (value.z - depth / 2) / scale }
        }
      },
    },
  })
  configurations.set(layer, config)
  return layer
}

export function setDepthRange(layer: Layer, frontZ: number, backZ: number): Layer {
  if (layer.placement.type !== 'surface') throw new Error('正面レイヤーは奥行きZで配置してください。')
  assertFinite(frontZ, backZ)
  if (frontZ <= backZ) throw new Error('手前端Zは奥端Zより大きい有限の数値にしてください。')
  const scale = layerScale(layer)
  // Clone with the same reference settings, retaining all unrelated authoring values.
  const result = cloneLayer(layer)
  const p = result.placement as Extract<Placement, { type: 'surface' }>
  p.frontZPx = frontZ === layer.depthRange!.frontZ ? p.frontZPx : frontZ / scale
  p.backZPx = backZ === layer.depthRange!.backZ ? p.backZPx : backZ / scale
  return result
}

function layerScale(layer: Layer) { return referenceMetrics(configurations.get(layer)!).scale }
function cloneLayer(layer: Layer) { return createLayerModel(configurations.get(layer)!, layer) }

export function defaultOrigin(settings: SceneSettings, direction: PlaneDirection): PlacementOrigin {
  const metrics = referenceMetrics(settings)
  return {
    x: direction === 'left' ? -metrics.width / 2 : direction === 'right' ? metrics.width / 2 : 0,
    y: direction === 'down' ? -metrics.height / 2 : direction === 'up' ? metrics.height / 2 : 0,
    z: 0,
  }
}

export function moveOrigin(layer: Layer, x: number, y: number): Layer {
  assertFinite(x, y)
  const result = cloneLayer(layer), scale = layerScale(layer)
  const dx = x === layer.origin.x ? 0 : x / scale - layer.originPx.x
  const dy = y === layer.origin.y ? 0 : y / scale - layer.originPx.y
  result.originPx.x += dx; result.originPx.y += dy
  const p = result.placement
  if (p.type === 'screen') {
    const config = configurations.get(layer)!, metrics = referenceMetrics(config)
    const factor = metrics.cameraZ / (metrics.cameraZ - layer.transform.z)
    p.rectPx.x += dx * factor; p.rectPx.y -= dy * factor
  } else p.centerPx += isWall(layer) ? dy : dx
  return result
}

export function setFrontDepth(layer: Layer, z: number, preserveScreen: boolean) {
  const result = cloneLayer(layer)
  if (result.placement.type !== 'screen') throw new Error('正面レイヤーを指定してください。')
  const config = configurations.get(layer)!
  placeFront(config, result.placement.rectPx, z)
  if (z === layer.transform.z) return result
  if (preserveScreen) result.placement.zPx = z / layerScale(layer)
  else result.transform.z = z
  return result
}

export function changeOrientation(settings: SceneSettings, layer: Layer, orientation: PlaneOrientation): Layer {
  if (orientation.direction === layer.orientation.direction) return layer
  const origin = defaultOrigin(settings, orientation.direction)
  const moved = moveOrigin(layer, origin.x, origin.y)
  const t = { ...moved.transform }, metrics = referenceMetrics(settings)
  if (orientation.direction === 'down' || orientation.direction === 'up') t.y = origin.y
  if (orientation.direction === 'left' || orientation.direction === 'right') t.x = origin.x
  const data: LayerData = { ...moved, orientation: { ...orientation } }
  if (orientation.relation === 'parallel') {
    data.placement = { type: 'screen', rectPx: frontRect(settings, t), zPx: t.z / metrics.scale }
    placeFront(settings, data.placement.rectPx, t.z)
  } else {
    const wall = orientation.direction === 'left' || orientation.direction === 'right'
    const depth = wall ? t.width : t.height
    data.placement = { type: 'surface', centerPx: (wall ? t.y : t.x) / metrics.scale,
      sizePx: (wall ? t.height : t.width) / metrics.scale,
      frontZPx: (t.z + depth / 2) / metrics.scale, backZPx: (t.z - depth / 2) / metrics.scale }
  }
  return createLayerModel(settings, data)
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

/** Invert projection only for explicit world edits and changes of placement orientation. */
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
  const scale = referenceMetrics(settings).scale
  const rect = { x: 0, y: 0, width: settings.width, height: settings.height }
  const base = { visible: true, originPx: { x: 0, y: 0, z: 0 as const } }
  return [
    createLayerModel(settings, { ...base, id: 'layer-1', name: 'レイヤー 1', editorColor: '#78c5b1', alphaMode: 'BLEND',
      orientation: orientationFor('front'), placement: { type: 'screen', rectPx: { ...rect }, zPx: -40 / scale } }),
    createLayerModel(settings, { ...base, id: 'layer-2', name: 'レイヤー 2', editorColor: '#efb66d', alphaMode: 'BLEND',
      orientation: orientationFor('front'), placement: { type: 'screen', rectPx: { ...rect }, zPx: 1 / scale } }),
    createLayerModel(settings, { ...base, id: 'ground', name: '地面', editorColor: '#9695e4', alphaMode: 'OPAQUE',
      orientation: orientationFor('down'), originPx: { x: 0, y: -settings.height / 2, z: 0 },
      placement: { type: 'surface', centerPx: 0, sizePx: 60 / scale, frontZPx: 0, backZPx: -28 / scale } }),
  ]
}

/** Keep existing scene-unit UI behavior while replacing the scene settings atomically. */
export function reconfigureScene(previous: SceneSettings, next: SceneSettings, layers: Layer[], preserveScreen: boolean): Layer[] {
  const oldMetrics = referenceMetrics(previous), metrics = referenceMetrics(next)
  const ratio = oldMetrics.scale / metrics.scale
  const depthScale = Math.tan(previous.fov * Math.PI / 360) / Math.tan(next.fov * Math.PI / 360)
  return layers.map(layer => {
    const data: LayerData = structuredClone(layer)
    data.originPx.x *= ratio; data.originPx.y *= ratio
    const p = data.placement
    if (p.type === 'surface') {
      p.centerPx *= ratio; p.sizePx *= ratio
      p.frontZPx *= ratio * depthScale; p.backZPx *= ratio * depthScale
    } else {
      p.zPx *= ratio
      if (preserveScreen) {
        p.rectPx.x *= next.width / previous.width; p.rectPx.width *= next.width / previous.width
        p.rectPx.y *= next.height / previous.height; p.rectPx.height *= next.height / previous.height
      } else if (previous.fov !== next.fov || previous.width !== next.width || previous.height !== next.height
        || previous.referenceHeight !== next.referenceHeight) {
        p.rectPx = frontRect(next, layer.transform)
      }
      placeFront(next, p.rectPx, p.zPx * metrics.scale)
    }
    return createLayerModel(next, data)
  })
}
