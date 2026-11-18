/** Reusable GLB projection loader. Copy this file with Three.js; no editor, UI or Vite dependency. */
import * as THREE from 'three/webgpu'
import type { Node } from 'three/webgpu'
import { Fn, clamp, context, materialReference, max, positionWorld, uniform, uv, vec2, vec4 } from 'three/tsl'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

/** Consumer-side metadata contract; independent of editor types. */
const EXTRAS = 'threeLayeredScene'
export type ProjectionMode = 'tsl' | 'standard'
export type Sampling = { mode: 'uv'; texCoord: 0 } | { mode: 'camera'; cameraId: string; imageUvScale: [number, number]; imageUvOffset: [number, number] }
export interface LayerInfo { layerId: string; listIndex: number; sampling: Sampling }
function fail(message: string): never { throw new Error(message) }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('extrasの構造が不正です。')
  return value as Record<string, unknown>
}
function metadata(value: unknown, role: string) {
  const data = record(value)
  if (data.version !== 1 || data.role !== role) fail(`未対応または不正な${role}のextrasです。`)
  return data
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value) fail('extrasのIDが不正です。')
  return value
}
function pair(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(n => typeof n === 'number' && Number.isFinite(n))) fail('UV変換が不正です。')
  return [value[0], value[1]]
}
function readLayer(value: unknown, cameraId: string): LayerInfo {
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

interface MapMaterial extends THREE.Material { map: THREE.Texture; color?: THREE.Color }

function createProjectionMaterial(original: MapMaterial, sampling: Sampling, matrix: THREE.Matrix4) {
  const material = new THREE.MeshBasicNodeMaterial({ map: original.map, transparent: original.transparent,
    opacity: original.opacity, side: original.side, alphaTest: original.alphaTest, depthWrite: !original.transparent, toneMapped: false })
  material.name = original.name
  if (original.color) material.color.copy(original.color)
  const projection = uniform(matrix)
  const scale = uniform(new THREE.Vector2(...(sampling.mode === 'camera' ? sampling.imageUvScale : [1, 1] as const)))
  const offset = uniform(new THREE.Vector2(...(sampling.mode === 'camera' ? sampling.imageUvOffset : [0, 0] as const)))
  // Three's declarations leave materialReference untyped. A sampled 2D map returns vec4.
  const mapNode = materialReference('map', 'texture', material) as ReturnType<typeof materialReference> & Node<'vec4'>
  const color = uniform(material.color)
  material.colorNode = Fn(() => {
    const coordinates = sampling.mode === 'uv' ? uv() : (() => {
      const clip = projection.mul(vec4(positionWorld, 1)).toVar()
      clip.w.lessThanEqual(0).discard()
      const ndc = clip.xyz.div(max(clip.w, 0.000001)).toVar()
      ndc.z.lessThan(-1).or(ndc.z.greaterThan(1)).discard()
      const imageUV = ndc.xy.mul(0.5).add(0.5).mul(scale).add(offset)
      return vec2(imageUV.x, imageUV.y.oneMinus())
    })()
    // uv mode is already cover-fitted and top-left; never transform or flip it again.
    return context(mapNode, { getUV: () => clamp(coordinates, 0, 1) }).mul(vec4(color, 1))
  })()
  return material
}

export interface ProjectionBinding {
  mesh: THREE.Mesh
  original: MapMaterial
  projected: THREE.MeshBasicNodeMaterial
  info: LayerInfo
}

/** Borrows the source scene. dispose() only restores materials and frees generated TSL materials. */
export interface ProjectionAsset {
  scene: THREE.Object3D
  camera: THREE.PerspectiveCamera
  matrix: THREE.Matrix4
  bindings: ProjectionBinding[]
  composition: { width: number; height: number }
  updateProjection(): void
  setMode(mode: ProjectionMode): void
  dispose(): void
}

/** Does not need the editor model, original image dimensions, or any external JSON. */
export function restoreProjectionAsset(scene: THREE.Object3D): ProjectionAsset {
  const data = metadata(scene.userData[EXTRAS], 'scene'), composition = record(data.composition)
  const projection = record(data.projection), rendering = record(data.rendering)
  if (![composition.width, composition.height].every(n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 1 && n <= 16384)) fail('共通キャンバスの寸法が不正です。')
  const conventions = { imageFit: 'cover', imageAlign: 'center', clipDepthRange: 'minus-one-to-one',
    projectedUvOrigin: 'bottom-left', textureUvOrigin: 'top-left', outsideImage: 'clamp', invalidProjection: 'discard' }
  if (Object.entries(conventions).some(([key, value]) => projection[key] !== value) || rendering.toneMapping !== 'none') fail('未対応の投影設定です。')
  const cameraId = identifier(data.projectionCameraId)
  const cameras: THREE.PerspectiveCamera[] = [], pending: { mesh: THREE.Mesh; original: MapMaterial; info: LayerInfo }[] = []
  const ids = new Set<string>(), indices = new Set<number>()
  scene.traverse(object => {
    const info = object.userData[EXTRAS]
    if (info?.role === 'projectionCamera') {
      const marker = metadata(info, 'projectionCamera')
      if (marker.id === cameraId) {
        if (!(object instanceof THREE.PerspectiveCamera)) fail('投影カメラはPerspectiveCameraである必要があります。')
        cameras.push(object)
      }
    }
    if (object instanceof THREE.Mesh) {
      const info = readLayer(object.userData[EXTRAS], cameraId)
      if (ids.has(info.layerId) || indices.has(info.listIndex)) fail('レイヤーIDまたは一覧順が重複しています。')
      ids.add(info.layerId); indices.add(info.listIndex)
      if (Array.isArray(object.material)) fail('複数マテリアルのPlaneには対応していません。')
      const original = object.material as MapMaterial
      if (!original.map?.isTexture || original.map.flipY || original.map.channel !== 0 || !object.geometry.getAttribute('uv')) fail('GLBの画像またはUV設定が不正です。')
      pending.push({ mesh: object, original, info })
    }
  })
  if (cameras.length !== 1) fail('投影カメラの参照を一意に解決できません。')
  const camera = cameras[0], matrix = new THREE.Matrix4(), bindings: ProjectionBinding[] = []
  let disposed = false
  if (![camera.fov, camera.aspect, camera.near, camera.far].every(Number.isFinite)
    || camera.fov <= 0 || camera.fov >= 180 || camera.aspect <= 0 || camera.near <= 0 || camera.far <= camera.near) fail('投影カメラの設定が不正です。')
  const updateProjection = () => {
    if (disposed) fail('投影アセットは解放済みです。')
    scene.updateWorldMatrix(true, true)
    camera.coordinateSystem = THREE.WebGLCoordinateSystem
    camera.updateProjectionMatrix(); camera.updateWorldMatrix(true, false)
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
    matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    if (!matrix.elements.every(Number.isFinite)) fail('投影行列が不正です。')
  }
  updateProjection()
  try {
    for (const value of pending) bindings.push({ ...value, projected: createProjectionMaterial(value.original, value.info.sampling, matrix) })
  } catch (error) { bindings.forEach(binding => binding.projected.dispose()); throw error }
  return {
    scene, camera, matrix, bindings,
    composition: { width: composition.width as number, height: composition.height as number },
    updateProjection,
    setMode(mode: ProjectionMode) {
      if (disposed) fail('投影アセットは解放済みです。')
      bindings.forEach(binding => { binding.mesh.material = mode === 'tsl' ? binding.projected : binding.original })
    },
    dispose() {
      if (disposed) return
      disposed = true
      bindings.forEach(binding => { binding.mesh.material = binding.original; binding.projected.dispose() })
    },
  }
}

/** Keep depth sorting; the published list order only breaks ties at equal rendering depth. */
export function projectionRenderSort(transparent: boolean) {
  type Item = { id: number | null; groupOrder: number | null; renderOrder: number | null; z: number | null; object: THREE.Object3D | null }
  return (a: Item, b: Item) => (a.groupOrder ?? 0) - (b.groupOrder ?? 0) || (a.renderOrder ?? 0) - (b.renderOrder ?? 0)
    || (transparent ? (b.z ?? 0) - (a.z ?? 0) : (a.z ?? 0) - (b.z ?? 0))
    || (a.object?.userData[EXTRAS]?.listIndex ?? -1) - (b.object?.userData[EXTRAS]?.listIndex ?? -1) || (a.id ?? 0) - (b.id ?? 0)
}

export const MAX_PROJECTION_GLB_BYTES = 400 * 1024 * 1024
export interface ProjectionLoadOptions {
  /** Optional preconfigured loader, for custom decoding or loading-manager policies. */
  loader?: Pick<GLTFLoader, 'parseAsync'>
}
export interface LoadedProjectionAsset extends ProjectionAsset {
  /** Detach scene and free source resources as well as generated TSL materials. Idempotent. */
  dispose(): void
}

function disposeScene(scene: THREE.Object3D) {
  const materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>(), geometries = new Set<THREE.BufferGeometry>()
  scene.traverse(object => {
    if (object instanceof THREE.Mesh) {
      geometries.add(object.geometry)
      const list = Array.isArray(object.material) ? object.material : [object.material]
      list.forEach(material => materials.add(material))
    }
  })
  materials.forEach(material => {
    Object.values(material).forEach(value => { if (value?.isTexture) textures.add(value) })
    material.dispose()
  })
  const images = new Set<{ close?: () => void }>()
  textures.forEach(texture => { if (texture.image) images.add(texture.image); texture.dispose() })
  images.forEach(image => { image.close?.() }); geometries.forEach(geometry => geometry.dispose())
}
/** Load a self-contained GLB and apply TSL. Fetch/File/renderer/camera controls belong to the caller. */
export async function parseProjectionGlb(data: ArrayBuffer, options: ProjectionLoadOptions = {}): Promise<LoadedProjectionAsset> {
  if (data.byteLength > MAX_PROJECTION_GLB_BYTES) throw new Error('GLBは400MB以下にしてください。')
  if (data.byteLength < 12) throw new Error('GLBファイルを指定してください。')
  const header = new DataView(data)
  if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== data.byteLength) {
    throw new Error('GLBヘッダーが不正です。')
  }
  let loader = options.loader
  if (!loader) {
    const manager = new THREE.LoadingManager()
    manager.setURLModifier(url => {
      if (!url.startsWith('blob:') && !url.startsWith('data:')) throw new Error('外部ファイル参照のあるGLBには対応していません。')
      return url
    })
    loader = new GLTFLoader(manager)
  }
  const gltf = await loader.parseAsync(data, '')
  let projection: ProjectionAsset | undefined
  try {
    projection = restoreProjectionAsset(gltf.scene)
    projection.setMode('tsl')
  } catch (error) {
    projection?.dispose()
    disposeScene(gltf.scene)
    throw error
  }
  let disposed = false
  return {
    ...projection,
    dispose() {
      if (disposed) return
      disposed = true
      projection.dispose()
      gltf.scene.removeFromParent()
      disposeScene(gltf.scene)
    },
  }
}
