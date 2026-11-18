import * as THREE from 'three/webgpu'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { projectionMaterial } from './projection'
import { referenceMetrics } from './model'
import { applyLayerTransform } from './layer-transform'
import type { Layer, SceneSettings } from './model'

interface LayerView {
  root: THREE.Group
  originMarker: THREE.AxesHelper
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicNodeMaterial>
  outline: THREE.LineSegments
  projection: ReturnType<typeof projectionMaterial>
}

function makeRenderer(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NoToneMapping
  return renderer
}

export class Editor {
  private scene = new THREE.Scene()
  private baseCamera = new THREE.PerspectiveCamera()
  private previewCamera = new THREE.PerspectiveCamera()
  private workCamera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000)
  private projectionMatrix = new THREE.Matrix4()
  private previewRenderer: THREE.WebGPURenderer
  private workRenderer: THREE.WebGPURenderer
  private controls: OrbitControls
  private helpers = new THREE.Group()
  private cameraHelper: THREE.CameraHelper
  private reference: THREE.LineSegments
  private views: LayerView[]
  private observer: ResizeObserver
  private frame = 0
  private disposed = false
  private initialized = false
  private settings: SceneSettings
  private layers: Layer[]
  selected = 0
  diagnostic = 1
  surrounding = false
  offsetX = 0
  offsetY = 0

  constructor(previewCanvas: HTMLCanvasElement, workCanvas: HTMLCanvasElement,
    settings: SceneSettings, layers: Layer[], textures: THREE.Texture[]) {
    this.settings = settings
    this.layers = layers
    this.previewRenderer = makeRenderer(previewCanvas)
    try {
      this.workRenderer = makeRenderer(workCanvas)
    } catch (error) {
      void this.previewRenderer.dispose().catch(() => {})
      throw error
    }
    this.scene.background = new THREE.Color('#17212a')
    this.scene.add(this.helpers)
    this.reference = this.makeOutline('#f0ead6')
    this.helpers.add(this.reference)
    const grid = new THREE.GridHelper(40, 40, '#52646c', '#2c3d46')
    grid.position.y = -2.52
    this.helpers.add(grid)
    this.cameraHelper = new THREE.CameraHelper(this.baseCamera)
    this.helpers.add(this.cameraHelper)
    this.views = layers.map((layer, index) => {
      const projection = projectionMaterial(textures[index]!, this.projectionMatrix, layer.editorColor)
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), projection.material)
      const outline = this.makeOutline(layer.editorColor)
      const root = new THREE.Group()
      const originMarker = new THREE.AxesHelper(0.4)
      mesh.add(outline)
      root.add(mesh, originMarker)
      this.scene.add(root)
      return { root, originMarker, mesh, outline, projection }
    })
    this.workCamera.position.set(13, 8, 16)
    this.controls = new OrbitControls(this.workCamera, workCanvas)
    this.controls.target.set(0, -1, -2)
    this.controls.minDistance = 0.1
    this.controls.maxDistance = 500
    this.controls.update()
    this.controls.addEventListener('change', this.requestRender)
    this.observer = new ResizeObserver(this.requestRender)
    this.observer.observe(previewCanvas.parentElement!)
    this.observer.observe(workCanvas.parentElement!)
    this.update(settings, layers)
  }

  private makeOutline(color: string) {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.5, -0.5, 0.001), new THREE.Vector3(0.5, -0.5, 0.001),
      new THREE.Vector3(0.5, -0.5, 0.001), new THREE.Vector3(0.5, 0.5, 0.001),
      new THREE.Vector3(0.5, 0.5, 0.001), new THREE.Vector3(-0.5, 0.5, 0.001),
      new THREE.Vector3(-0.5, 0.5, 0.001), new THREE.Vector3(-0.5, -0.5, 0.001),
    ])
    return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }))
  }

  update(settings: SceneSettings, layers: Layer[]) {
    this.settings = settings
    this.layers = layers
    const metrics = referenceMetrics(settings)
    // Projection UVs deliberately retain the same -1..1 convention on either backend.
    this.baseCamera.coordinateSystem = THREE.WebGLCoordinateSystem
    this.baseCamera.fov = settings.fov
    this.baseCamera.aspect = metrics.aspect
    this.baseCamera.near = metrics.near
    // Fit the clip range to the current scene rather than image pixel dimensions.
    const extent = Math.max(...layers.map(({ transform: t }) =>
      Math.hypot(t.x, t.y, t.z) + Math.hypot(t.width, t.height)))
    this.baseCamera.far = Math.max(metrics.cameraZ * 2, metrics.cameraZ + extent * 2)
    this.baseCamera.position.set(0, 0, metrics.cameraZ)
    this.baseCamera.rotation.set(0, 0, 0)
    this.baseCamera.updateProjectionMatrix()
    this.baseCamera.updateMatrixWorld(true)
    this.projectionMatrix.multiplyMatrices(this.baseCamera.projectionMatrix, this.baseCamera.matrixWorldInverse)
    this.reference.scale.set(metrics.width, metrics.height, 1)
    // A camera helper reaching all the way to far obscures the useful working area.
    const actualFar = this.baseCamera.far
    this.baseCamera.far = metrics.cameraZ + settings.referenceHeight * 2
    this.baseCamera.updateProjectionMatrix()
    this.cameraHelper.update()
    this.baseCamera.far = actualFar
    this.baseCamera.updateProjectionMatrix()
    this.workCamera.far = Math.max(1000, this.baseCamera.far * 2)
    this.workCamera.updateProjectionMatrix()
    this.views.forEach(({ root, mesh, outline, projection }, i) => {
      const layer = layers[i]!
      applyLayerTransform(root, mesh, layer)
      projection.uniforms.editorColor.value.set(layer.editorColor)
      ;(outline.material as THREE.LineBasicMaterial).color.set(layer.editorColor)
    })
    this.requestRender()
  }

  async init() {
    const results = await Promise.allSettled([this.previewRenderer.init(), this.workRenderer.init()])
    const failure = results.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') {
      await this.dispose()
      throw failure.reason
    }
    if (!this.disposed) {
      this.initialized = true
      this.requestRender()
    }
  }

  get maxTextureSize() {
    const limit = (renderer: THREE.WebGPURenderer) => {
      // The backends expose different native limits; access only after init().
      const backend = renderer.backend as typeof renderer.backend & {
        device?: { limits: { maxTextureDimension2D: number } }
        gl?: WebGL2RenderingContext
      }
      if (backend.device) return backend.device.limits.maxTextureDimension2D
      if (backend.gl) return Number(backend.gl.getParameter(backend.gl.MAX_TEXTURE_SIZE))
      throw new Error('レンダラーのテクスチャ上限を取得できませんでした。')
    }
    return Math.min(limit(this.previewRenderer), limit(this.workRenderer))
  }

  setTexture(index: number, texture: THREE.Texture) {
    this.views[index]!.projection.imageNode.value = texture
    this.requestRender()
  }

  setWorkView(view: string) {
    const distance = Math.max(referenceMetrics(this.settings).width, this.settings.referenceHeight) * 1.8
    this.controls.target.set(0, -1, -2)
    this.workCamera.up.set(0, 1, 0)
    if (view === 'side') this.workCamera.position.set(distance, -1, -2)
    else if (view === 'top') this.workCamera.position.set(0, distance, -1.99)
    else this.workCamera.position.set(distance, distance * 0.6, distance)
    this.controls.update()
    this.requestRender()
  }

  requestRender = () => {
    if (!this.frame && this.initialized && !this.disposed) this.frame = requestAnimationFrame(this.render)
  }

  private fit(renderer: THREE.WebGPURenderer) {
    const { width, height } = renderer.domElement.getBoundingClientRect()
    const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height))
    const size = renderer.getSize(new THREE.Vector2())
    if (size.x !== w || size.y !== h) renderer.setSize(w, h, false)
    return w / h
  }

  private prepareView(work: boolean) {
    this.helpers.visible = work
    this.views.forEach(({ mesh, outline, originMarker, projection }, i) => {
      const diagnostic = work ? this.diagnostic : 0
      projection.uniforms.diagnosticMode.value = diagnostic
      outline.visible = work
      originMarker.visible = work
      ;(outline.material as THREE.LineBasicMaterial).opacity = i === this.selected ? 1 : 0.35
      const transparent = diagnostic !== 0 || this.layers[i]!.alphaMode === 'BLEND'
      if (mesh.material.transparent !== transparent) {
        mesh.material.transparent = transparent
        mesh.material.needsUpdate = true
      }
      mesh.material.depthWrite = !transparent
      // Work view deliberately reveals the backs of planes for inspection.
      const side = work ? THREE.DoubleSide : THREE.FrontSide
      if (mesh.material.side !== side) {
        mesh.material.side = side
        mesh.material.needsUpdate = true
      }
    })
  }

  private render = () => {
    this.frame = 0
    this.fit(this.previewRenderer)
    const workAspect = this.fit(this.workRenderer)
    this.previewCamera.copy(this.baseCamera)
    this.previewCamera.position.x += this.offsetX
    this.previewCamera.position.y += this.offsetY
    // Expand the inspection window without changing the stored reference FOV.
    this.previewCamera.zoom = this.surrounding ? 1 / 1.5 : 1
    this.previewCamera.updateProjectionMatrix()
    this.previewCamera.updateMatrixWorld(true)
    this.prepareView(false)
    this.previewRenderer.render(this.scene, this.previewCamera)
    this.workCamera.aspect = workAspect
    this.workCamera.updateProjectionMatrix()
    this.prepareView(true)
    this.workRenderer.render(this.scene, this.workCamera)
  }

  async dispose() {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.observer.disconnect()
    this.controls.dispose()
    this.cameraHelper.dispose()
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        object.geometry.dispose()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        materials.forEach((material) => material.dispose())
      }
    })
    await Promise.allSettled([this.previewRenderer.dispose(), this.workRenderer.dispose()])
  }
}
