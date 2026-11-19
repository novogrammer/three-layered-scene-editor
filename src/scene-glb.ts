import { Group, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Scene } from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { createLayerModel, validateScenePlacement } from './model'
import type { LayerData, SceneSettings } from './model'
import { applyLayerTransform } from './layer-transform'
import { updateProjectedUVs } from './projected-uv'
import { projectedCover } from './image-fit'
import type { ImageDimensions } from './image-fit'
import type { ImageSource } from './scene-json'
import { embedOriginalImages } from './glb-container'
import type { GlbOriginalImage } from './glb-container'
import { configureProjectionCamera } from './projection-camera'
import { GLB_PROJECTION_CAMERA_ID, GLB_PROJECTION_EXTRAS_KEY } from './glb-projection-extras'
import type { GlbLayerProjectionV2, GlbProjectionCameraV2, GlbSceneProjectionV2 } from './glb-projection-extras'

/** Coarse vertex-UV preview grid; final projection can be evaluated by a shader. */
export const SURFACE_GRID_SEGMENTS = 8
export interface GlbImageSource extends ImageSource { image: ImageDimensions }

export async function createSceneGlb(settings: SceneSettings, layers: readonly LayerData[], sources: ReadonlyMap<string, GlbImageSource>): Promise<ArrayBuffer> {
  const config = { ...settings }, snapshot = structuredClone(layers).map(layer => createLayerModel(config, layer))
  validateScenePlacement(config, snapshot)
  const images = new Map<string, { fileName: string; blob: Blob; width: number; height: number }>()
  for (const layer of snapshot.filter(layer => layer.visible)) {
    const source = sources.get(layer.id)
    if (!source) throw new Error(`「${layer.name}」の元画像が見つかりません。`)
    images.set(layer.id, { fileName: source.fileName, blob: source.blob, width: source.image.width, height: source.image.height })
  }
  const scene = new Scene(), camera = new PerspectiveCamera()
  const sceneProjection: GlbSceneProjectionV2 = {
    version: 2, role: 'scene', projectionCameraId: GLB_PROJECTION_CAMERA_ID,
    composition: { width: config.width, height: config.height },
    rendering: { toneMapping: 'none' },
    projection: { imageFit: 'cover', imageAlign: 'center', clipDepthRange: 'minus-one-to-one',
      projectedUvOrigin: 'bottom-left', textureUvOrigin: 'top-left', outsideImage: 'clamp', invalidProjection: 'discard' },
  }
  const cameraProjection: GlbProjectionCameraV2 = { version: 2, role: 'projectionCamera', id: GLB_PROJECTION_CAMERA_ID }
  scene.userData[GLB_PROJECTION_EXTRAS_KEY] = sceneProjection
  camera.userData[GLB_PROJECTION_EXTRAS_KEY] = cameraProjection
  camera.name = 'projectionCamera'; configureProjectionCamera(camera, config, snapshot); scene.add(camera)
  const matrix = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  const owned: { geometry: PlaneGeometry; material: MeshBasicMaterial }[] = []
  try {
    for (const [listIndex, layer] of snapshot.entries()) {
      if (!layer.visible) continue
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
      const fit = projectedCover(images.get(layer.id)!, layer.framePx, config), uv = geometry.getAttribute('uv')
      const layerProjection: GlbLayerProjectionV2 = {
        version: 2, role: 'layer', layerId: layer.id, listIndex, framePx: { ...layer.framePx },
        sampling: projected ? { mode: 'camera', cameraId: GLB_PROJECTION_CAMERA_ID,
          imageUvScale: [fit.scaleX, fit.scaleY], imageUvOffset: [fit.offsetX, fit.offsetY] }
          : { mode: 'uv', texCoord: 0 },
      }
      mesh.userData[GLB_PROJECTION_EXTRAS_KEY] = layerProjection
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
