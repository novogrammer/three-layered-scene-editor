import * as THREE from 'three/webgpu'
import { EXTRAS, fail, identifier, metadata, readLayer, record } from './metadata'
import type { LayerInfo, ProjectionMode } from './metadata'
import { createProjectionMaterial } from './material'
import type { MapMaterial } from './material'

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

