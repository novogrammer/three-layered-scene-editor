import { Float32BufferAttribute, Vector4 } from 'three/webgpu'
import type { BufferGeometry, Matrix4 } from 'three/webgpu'

/** Exact for a plane parallel to the reference image: no per-fragment reprojection. */
export function updateProjectedUVs(geometry: BufferGeometry, worldMatrix: Matrix4, projectionFromWorld: Matrix4): boolean {
  const position = geometry.getAttribute('position')
  const values = new Float32Array(position.count * 2)
  const point = new Vector4()
  let valid = true
  for (let i = 0; i < position.count; i++) {
    point.set(position.getX(i), position.getY(i), position.getZ(i), 1)
      .applyMatrix4(worldMatrix).applyMatrix4(projectionFromWorld)
    const safe = Math.abs(point.w) > 1e-8
    const z = safe ? point.z / point.w : Infinity
    valid = valid && point.w > 0 && z >= -1 && z <= 1
    // Retain out-of-range UVs for diagnostics; ClampToEdgeWrapping handles sampling.
    values[i * 2] = safe ? point.x / point.w * 0.5 + 0.5 : 0
    values[i * 2 + 1] = safe ? point.y / point.w * 0.5 + 0.5 : 0
  }
  const uv = geometry.getAttribute('uv')
  if (uv && uv.count === position.count) {
    for (let i = 0; i < position.count; i++) uv.setXY(i, values[i * 2]!, values[i * 2 + 1]!)
    uv.needsUpdate = true
  } else geometry.setAttribute('uv', new Float32BufferAttribute(values, 2))
  return valid
}
