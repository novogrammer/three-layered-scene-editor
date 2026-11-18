import { Group, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Scene } from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { createLayerModel } from './model'
import type { LayerData, SceneSettings } from './model'
import { applyLayerTransform } from './layer-transform'
import { updateProjectedUVs } from './projected-uv'
import { centeredCover } from './image-fit'
import type { ImageDimensions } from './image-fit'
import type { ImageSource } from './scene-json'
import { embedOriginalImages } from './glb-container'
import type { GlbOriginalImage } from './glb-container'
import { configureProjectionCamera } from './projection-camera'

/** Coarse vertex-UV preview grid; final projection can be evaluated by a shader. */
export const SURFACE_GRID_SEGMENTS = 8
export interface GlbImageSource extends ImageSource { image: ImageDimensions }

export async function createSceneGlb(settings: SceneSettings, layers: readonly LayerData[], sources: ReadonlyMap<string, GlbImageSource>): Promise<ArrayBuffer> {
  const config = { ...settings }, snapshot = structuredClone(layers).map(layer => createLayerModel(config, layer))
  const images = new Map<string, { fileName: string; blob: Blob; width: number; height: number }>()
  for (const layer of snapshot.filter(layer => layer.visible)) {
    const source = sources.get(layer.id)
    if (!source) throw new Error(`「${layer.name}」の元画像が見つかりません。`)
    images.set(layer.id, { fileName: source.fileName, blob: source.blob, width: source.image.width, height: source.image.height })
  }
  const scene = new Scene(), camera = new PerspectiveCamera()
  camera.name = 'projectionCamera'; configureProjectionCamera(camera, config, snapshot); scene.add(camera)
  const matrix = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  const owned: { geometry: PlaneGeometry; material: MeshBasicMaterial }[] = []
  try {
    for (const layer of snapshot.filter(layer => layer.visible)) {
      const projected = layer.orientation.relation === 'perpendicular'
      const segments = projected ? SURFACE_GRID_SEGMENTS : 1
      const geometry = new PlaneGeometry(1, 1, segments, segments)
      const material = new MeshBasicMaterial({ transparent: layer.alphaMode === 'BLEND' })
      material.name = layer.id
      owned.push({ geometry, material })
      const root = new Group(), mesh = new Mesh(geometry, material)
      root.name = layer.name; mesh.name = layer.name; root.add(mesh); scene.add(root)
      applyLayerTransform(root, mesh, layer)
      if (!updateProjectedUVs(geometry, mesh.matrixWorld, matrix)) throw new Error(`「${layer.name}」が投影カメラの範囲外です。配置を調整してください。`)
      const fit = centeredCover(images.get(layer.id)!, config).uv, uv = geometry.getAttribute('uv')
      for (let i = 0; i < uv.count; i++) {
        // glTF samples the original image with top-left texture coordinates (no canvas flip).
        uv.setXY(i, uv.getX(i) * fit.scaleX + fit.offsetX, 1 - (uv.getY(i) * fit.scaleY + fit.offsetY))
      }
      uv.needsUpdate = true
    }
    const originalImages = new Map<string, GlbOriginalImage>(), shared = new Map<Blob, GlbOriginalImage>()
    for (const [id, image] of images) {
      let original = shared.get(image.blob)
      if (!original) {
        original = { fileName: image.fileName, mimeType: image.blob.type, bytes: new Uint8Array(await image.blob.arrayBuffer()) }
        shared.set(image.blob, original)
      }
      originalImages.set(id, original)
    }
    // Export without maps to avoid GLTFExporter's canvas-based image re-encoding.
    const result = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: true })
    if (!(result instanceof ArrayBuffer)) throw new Error('GLBを作成できませんでした。')
    return embedOriginalImages(result, originalImages)
  } finally {
    owned.forEach(({ geometry, material }) => { geometry.dispose(); material.dispose() })
  }
}
