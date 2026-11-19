import { PerspectiveCamera, WebGLCoordinateSystem } from 'three'
import { geometryTransform, referenceMetrics } from './model'
import type { Layer, SceneSettings } from './model'

/** Shared projection basis for the preview, vertex UVs and exported camera. */
export function configureProjectionCamera(camera: PerspectiveCamera, settings: SceneSettings, layers: readonly Layer[]) {
  const metrics = referenceMetrics(settings)
  const extent = layers.reduce((max, layer) => {
    const t = geometryTransform(layer)
    return Math.max(max, Math.hypot(t.x, t.y, t.z) + Math.hypot(t.width, t.height))
  }, 0)
  camera.coordinateSystem = WebGLCoordinateSystem
  camera.fov = settings.fov; camera.aspect = metrics.aspect; camera.near = metrics.near
  camera.far = Math.max(metrics.cameraZ * 2, metrics.cameraZ + extent * 2)
  camera.position.set(0, 0, metrics.cameraZ); camera.rotation.set(0, 0, 0)
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true)
}
