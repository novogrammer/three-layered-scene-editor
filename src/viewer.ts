/** Standalone GLB consumer: imports only Three.js, never editor code or editor data. */
import * as THREE from 'three/webgpu'
import type { Node } from 'three/webgpu'
import { Fn, clamp, context, materialReference, max, positionWorld, uniform, uv, vec2, vec4 } from 'three/tsl'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

const EXTRAS = 'threeLayeredScene'
type Mode = 'tsl' | 'standard'
type Sampling = { mode: 'uv'; texCoord: 0 } | { mode: 'camera'; cameraId: string; imageUvScale: [number, number]; imageUvOffset: [number, number] }
interface LayerInfo { layerId: string; listIndex: number; sampling: Sampling }
interface MapMaterial extends THREE.Material { map: THREE.Texture; color?: THREE.Color }
interface Binding { mesh: THREE.Mesh; original: MapMaterial; projected: THREE.MeshBasicNodeMaterial; info: LayerInfo }
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

function projectionMaterial(original: MapMaterial, sampling: Sampling, matrix: THREE.Matrix4) {
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

/** Does not need the editor model, original image dimensions, or any external JSON. */
export function restoreProjectionAsset(scene: THREE.Object3D) {
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
  const camera = cameras[0], matrix = new THREE.Matrix4(), bindings: Binding[] = []
  if (![camera.fov, camera.aspect, camera.near, camera.far].every(Number.isFinite)
    || camera.fov <= 0 || camera.fov >= 180 || camera.aspect <= 0 || camera.near <= 0 || camera.far <= camera.near) fail('投影カメラの設定が不正です。')
  const updateProjection = () => {
    scene.updateWorldMatrix(true, true)
    camera.coordinateSystem = THREE.WebGLCoordinateSystem
    camera.updateProjectionMatrix(); camera.updateWorldMatrix(true, false)
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
    matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    if (!matrix.elements.every(Number.isFinite)) fail('投影行列が不正です。')
  }
  updateProjection()
  try {
    for (const value of pending) bindings.push({ ...value, projected: projectionMaterial(value.original, value.info.sampling, matrix) })
  } catch (error) { bindings.forEach(binding => binding.projected.dispose()); throw error }
  return {
    scene, camera, matrix, bindings,
    composition: { width: composition.width as number, height: composition.height as number },
    updateProjection,
    setMode(mode: Mode) { bindings.forEach(binding => { binding.mesh.material = mode === 'tsl' ? binding.projected : binding.original }) },
    dispose() { bindings.forEach(binding => { binding.mesh.material = binding.original; binding.projected.dispose() }) },
  }
}

/** Keep depth sorting; the published list order only breaks ties at equal rendering depth. */
export function viewerRenderSort(transparent: boolean) {
  type Item = { id: number | null; groupOrder: number | null; renderOrder: number | null; z: number | null; object: THREE.Object3D | null }
  return (a: Item, b: Item) => (a.groupOrder ?? 0) - (b.groupOrder ?? 0) || (a.renderOrder ?? 0) - (b.renderOrder ?? 0)
    || (transparent ? (b.z ?? 0) - (a.z ?? 0) : (a.z ?? 0) - (b.z ?? 0))
    || (a.object?.userData[EXTRAS]?.listIndex ?? -1) - (b.object?.userData[EXTRAS]?.listIndex ?? -1) || (a.id ?? 0) - (b.id ?? 0)
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

async function startViewer(canvas: HTMLCanvasElement) {
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
  const status = (text: string, error = false) => { get('viewer-status').textContent = text; get('viewer-status').classList.toggle('error', error) }
  const open = get<HTMLButtonElement>('viewer-open'), fileInput = get<HTMLInputElement>('viewer-file')
  const mode = get<HTMLSelectElement>('viewer-mode'), view = get<HTMLSelectElement>('viewer-view'), reset = get<HTMLButtonElement>('viewer-reset')
  let disposed = false, compiling = false, revision = 0, frame = 0, current: ReturnType<typeof restoreProjectionAsset> | undefined
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#17212a')
  const camera = new THREE.PerspectiveCamera(), renderer = new THREE.WebGPURenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping
  renderer.setOpaqueSort(viewerRenderSort(false)); renderer.setTransparentSort(viewerRenderSort(true))
  const controls = new OrbitControls(camera, canvas); controls.enabled = false
  const requestRender = () => {
    if (disposed || compiling || frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (disposed || compiling) return
      try { current?.updateProjection(); renderer.render(scene, camera) }
      catch (error) { status(error instanceof Error ? error.message : '描画できませんでした。', true) }
    })
  }
  const fit = () => {
    const area = get('viewer-area'), stage = get('viewer-stage'), aspect = current ? current.composition.width / current.composition.height : 16 / 9
    const width = Math.max(1, Math.min(area.clientWidth, area.clientHeight * aspect)), height = width / aspect
    stage.style.width = `${width}px`; stage.style.height = `${height}px`
    renderer.setSize(Math.round(width), Math.max(1, Math.round(height)), false)
    requestRender()
  }
  const resetCamera = () => {
    if (!current) return
    current.updateProjection()
    camera.copy(current.camera, false)
    camera.userData = {} // Display camera must not masquerade as the fixed projection camera.
    current.camera.matrixWorld.decompose(camera.position, camera.quaternion, camera.scale)
    controls.enabled = view.value === 'orbit'
    if (controls.enabled) {
      const box = new THREE.Box3().setFromObject(current.scene), sphere = box.getBoundingSphere(new THREE.Sphere())
      const radius = Math.max(1, Number.isFinite(sphere.radius) ? sphere.radius : 1)
      if (box.isEmpty()) sphere.center.set(0, 0, 0)
      controls.target.copy(sphere.center)
      camera.scale.set(1, 1, 1)
      camera.position.copy(sphere.center).add(new THREE.Vector3(1, 0.6, 1).normalize().multiplyScalar(radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.2))
      camera.far = Math.max(camera.far, radius * 30); controls.minDistance = radius * 0.01; controls.maxDistance = radius * 10
      controls.update()
    }
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true); requestRender()
  }
  controls.addEventListener('change', requestRender)
  const observer = new ResizeObserver(fit)
  const destroy = () => {
    disposed = true; revision++; cancelAnimationFrame(frame); observer.disconnect(); controls.dispose()
    current?.dispose(); if (current) disposeScene(current.scene)
    void renderer.dispose().catch(() => {})
  }
  if (import.meta.hot) import.meta.hot.dispose(destroy)
  try { await renderer.init() } catch (error) {
    destroy(); status(error instanceof Error ? error.message : '描画を初期化できませんでした。', true); return
  }
  if (disposed) return
  open.disabled = false; observer.observe(get('viewer-area')); fit()
  open.onclick = () => { fileInput.value = ''; fileInput.click() }
  mode.onchange = () => { current?.setMode(mode.value as Mode); requestRender() }
  view.onchange = resetCamera; reset.onclick = resetCamera
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0]
    if (!file) return
    const token = ++revision
    let candidateScene: THREE.Object3D | undefined, candidate: ReturnType<typeof restoreProjectionAsset> | undefined
    open.disabled = true; status('GLBを読み込み中…')
    try {
      if (file.size > 400 * 1024 * 1024) fail('GLBは400MB以下にしてください。')
      const bytes = await file.arrayBuffer()
      if (bytes.byteLength < 12 || new DataView(bytes).getUint32(0, true) !== 0x46546c67) fail('GLBファイルを選択してください。')
      const manager = new THREE.LoadingManager()
      manager.setURLModifier(url => {
        if (!url.startsWith('blob:') && !url.startsWith('data:')) fail('外部ファイル参照のあるGLBには対応していません。')
        return url
      })
      const gltf = await new GLTFLoader(manager).parseAsync(bytes, '')
      candidateScene = gltf.scene
      if (disposed || token !== revision) return
      candidate = restoreProjectionAsset(gltf.scene)
      // Compile before replacing the visible asset; shader failures leave it intact.
      const temporary = new THREE.Scene(); temporary.add(candidate.scene)
      const compileCamera = candidate.camera.clone()
      candidate.camera.matrixWorld.decompose(compileCamera.position, compileCamera.quaternion, compileCamera.scale)
      candidate.updateProjection()
      compiling = true
      candidate.setMode('tsl'); await renderer.compileAsync(temporary, compileCamera)
      candidate.setMode('standard'); await renderer.compileAsync(temporary, compileCamera)
      if (disposed || token !== revision) return
      candidate.setMode(mode.value as Mode)
      const previous = current
      scene.add(candidate.scene); current = candidate; candidate = undefined; candidateScene = undefined
      if (previous) { scene.remove(previous.scene); previous.dispose(); disposeScene(previous.scene) }
      mode.disabled = false; view.disabled = false; reset.disabled = false
      resetCamera(); fit(); status(''); get('viewer-filename').textContent = file.name
    } catch (error) {
      if (!disposed && token === revision) status(error instanceof Error ? error.message : 'GLBを読み込めませんでした。', true)
    } finally {
      compiling = false
      candidate?.dispose(); if (candidateScene) disposeScene(candidateScene)
      if (!disposed && token === revision) { open.disabled = false; requestRender() }
    }
  }
}

// Tests may import the independent restoration API without initializing a DOM or GPU.
const viewerCanvas = typeof document === 'undefined' ? null : document.querySelector<HTMLCanvasElement>('#viewer-canvas')
if (viewerCanvas) void startViewer(viewerCanvas)
