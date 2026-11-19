/** Demo UI; Camera projection is reusable independently in ./glb-projection. */
import * as THREE from 'three/webgpu'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { applyCameraProjection } from './glb-projection'
import type { CameraProjection } from './glb-projection'
import { assertImageFitsGpu, maxTextureSize } from './gpu-texture'

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
  const view = get<HTMLSelectElement>('viewer-view'), reset = get<HTMLButtonElement>('viewer-reset')
  let disposed = false, revision = 0, frame = 0, current: CameraProjection | undefined
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#17212a')
  const camera = new THREE.PerspectiveCamera(), renderer = new THREE.WebGPURenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping
  const controls = new OrbitControls(camera, canvas); controls.enabled = false
  const requestRender = () => {
    if (disposed || frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (disposed) return
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
    if (current) { current.dispose(); current.scene.removeFromParent(); disposeScene(current.scene) }
    void renderer.dispose().catch(() => {})
  }
  if (import.meta.hot) import.meta.hot.dispose(destroy)
  try { await renderer.init() } catch (error) {
    destroy(); status(error instanceof Error ? error.message : '描画を初期化できませんでした。', true); return
  }
  if (disposed) return
  open.disabled = false; observer.observe(get('viewer-area')); fit()
  open.onclick = () => { fileInput.value = ''; fileInput.click() }
  view.onchange = resetCamera; reset.onclick = resetCamera
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0]
    if (!file) return
    const token = ++revision
    let candidateScene: THREE.Object3D | undefined, candidate: CameraProjection | undefined
    open.disabled = true; status('GLBを読み込み中…')
    try {
      const bytes = await file.arrayBuffer()
      if (bytes.byteLength < 12 || new DataView(bytes).getUint32(0, true) !== 0x46546c67) throw new Error('GLBファイルを選択してください。')
      const manager = new THREE.LoadingManager()
      manager.setURLModifier(url => {
        if (!url.startsWith('blob:') && !url.startsWith('data:')) throw new Error('外部ファイル参照のあるGLBには対応していません。')
        return url
      })
      candidateScene = (await new GLTFLoader(manager).parseAsync(bytes, '')).scene
      if (disposed || token !== revision) return
      const limit = maxTextureSize(renderer)
      candidateScene.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        for (const material of materials) {
          for (const value of Object.values(material)) {
            if (value instanceof THREE.Texture) assertImageFitsGpu(value.image, limit)
          }
        }
      })
      candidate = applyCameraProjection(candidateScene)
      const previous = current
      scene.add(candidate.scene); current = candidate; candidate = undefined; candidateScene = undefined
      if (previous) { previous.dispose(); previous.scene.removeFromParent(); disposeScene(previous.scene) }
      view.disabled = false; reset.disabled = false
      resetCamera(); fit(); status(''); get('viewer-filename').textContent = file.name
    } catch (error) {
      if (!disposed && token === revision) status(error instanceof Error ? error.message : 'GLBを読み込めませんでした。', true)
    } finally {
      candidate?.dispose(); if (candidateScene) disposeScene(candidateScene)
      if (!disposed && token === revision) { open.disabled = false; requestRender() }
    }
  }
}

// Only this UI entry touches the DOM or owns a renderer.
const viewerCanvas = typeof document === 'undefined' ? null : document.querySelector<HTMLCanvasElement>('#viewer-canvas')
if (viewerCanvas) void startViewer(viewerCanvas)
