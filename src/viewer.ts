/** Demo UI; GLB loading and projection are reusable independently in ./glb-viewer. */
import * as THREE from 'three/webgpu'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { MAX_PROJECTION_GLB_BYTES, parseProjectionGlb, projectionRenderSort } from './glb-viewer'
import type { LoadedProjectionAsset, ProjectionMode } from './glb-viewer'

async function startViewer(canvas: HTMLCanvasElement) {
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
  const status = (text: string, error = false) => { get('viewer-status').textContent = text; get('viewer-status').classList.toggle('error', error) }
  const open = get<HTMLButtonElement>('viewer-open'), fileInput = get<HTMLInputElement>('viewer-file')
  const mode = get<HTMLSelectElement>('viewer-mode'), view = get<HTMLSelectElement>('viewer-view'), reset = get<HTMLButtonElement>('viewer-reset')
  let disposed = false, compiling = false, revision = 0, frame = 0, current: LoadedProjectionAsset | undefined
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#17212a')
  const camera = new THREE.PerspectiveCamera(), renderer = new THREE.WebGPURenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping
  renderer.setOpaqueSort(projectionRenderSort(false)); renderer.setTransparentSort(projectionRenderSort(true))
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
    current?.dispose()
    void renderer.dispose().catch(() => {})
  }
  if (import.meta.hot) import.meta.hot.dispose(destroy)
  try { await renderer.init() } catch (error) {
    destroy(); status(error instanceof Error ? error.message : '描画を初期化できませんでした。', true); return
  }
  if (disposed) return
  open.disabled = false; observer.observe(get('viewer-area')); fit()
  open.onclick = () => { fileInput.value = ''; fileInput.click() }
  mode.onchange = () => { current?.setMode(mode.value as ProjectionMode); requestRender() }
  view.onchange = resetCamera; reset.onclick = resetCamera
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0]
    if (!file) return
    const token = ++revision
    let candidate: LoadedProjectionAsset | undefined
    open.disabled = true; status('GLBを読み込み中…')
    try {
      if (file.size > MAX_PROJECTION_GLB_BYTES) throw new Error('GLBは400MB以下にしてください。')
      candidate = await parseProjectionGlb(await file.arrayBuffer())
      if (disposed || token !== revision) return
      // Compile before replacing the visible asset; shader failures leave it intact.
      const temporary = new THREE.Scene(); temporary.add(candidate.scene)
      const compileCamera = candidate.camera.clone()
      candidate.camera.matrixWorld.decompose(compileCamera.position, compileCamera.quaternion, compileCamera.scale)
      candidate.updateProjection()
      compiling = true
      candidate.setMode('tsl'); await renderer.compileAsync(temporary, compileCamera)
      candidate.setMode('standard'); await renderer.compileAsync(temporary, compileCamera)
      if (disposed || token !== revision) return
      candidate.setMode(mode.value as ProjectionMode)
      const previous = current
      scene.add(candidate.scene); current = candidate; candidate = undefined
      previous?.dispose()
      mode.disabled = false; view.disabled = false; reset.disabled = false
      resetCamera(); fit(); status(''); get('viewer-filename').textContent = file.name
    } catch (error) {
      if (!disposed && token === revision) status(error instanceof Error ? error.message : 'GLBを読み込めませんでした。', true)
    } finally {
      compiling = false
      candidate?.dispose()
      if (!disposed && token === revision) { open.disabled = false; requestRender() }
    }
  }
}

// Only this UI entry touches the DOM or owns a renderer.
const viewerCanvas = typeof document === 'undefined' ? null : document.querySelector<HTMLCanvasElement>('#viewer-canvas')
if (viewerCanvas) void startViewer(viewerCanvas)
