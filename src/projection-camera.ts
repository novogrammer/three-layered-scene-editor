import { PerspectiveCamera, WebGLCoordinateSystem } from 'three'
import { referenceMetrics } from './model'
import type { Layer, SceneSettings } from './model'

/** Shared projection basis for the preview, vertex UVs and exported camera. */
export function configureProjectionCamera(camera: PerspectiveCamera, settings: SceneSettings, layers: readonly Layer[]) {
  const metrics = referenceMetrics(settings)
  const extent = Math.max(0, ...layers.map(({ transform: t }) => Math.hypot(t.x, t.y, t.z) + Math.hypot(t.width, t.height)))
  camera.coordinateSystem = WebGLCoordinateSystem
  camera.fov = settings.fov; camera.aspect = metrics.aspect; camera.near = metrics.near
  camera.far = Math.max(metrics.cameraZ * 2, metrics.cameraZ + extent * 2)
  camera.position.set(0, 0, metrics.cameraZ); camera.rotation.set(0, 0, 0)
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true)
}
