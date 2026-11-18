import type { Object3D } from 'three/webgpu'
import { presetRotation } from './model'
import type { Layer } from './model'

/** Separate the z=0 placement origin from the geometry center and dimensions. */
export function applyLayerTransform(root: Object3D, plane: Object3D, layer: Layer) {
  const { origin, transform: t } = layer
  root.position.set(origin.x, origin.y, 0)
  root.rotation.set(...presetRotation(layer.kind))
  root.visible = layer.visible
  plane.position.set(t.x - origin.x, t.y - origin.y, t.z)
    .applyQuaternion(root.quaternion.clone().invert())
  plane.rotation.set(0, 0, 0)
  plane.scale.set(t.width, t.height, 1)
  root.updateMatrixWorld(true)
}
