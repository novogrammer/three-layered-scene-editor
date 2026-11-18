import { expect, test } from 'vitest'
import { Group, Matrix4, Object3D, PerspectiveCamera, PlaneGeometry, Vector3 } from 'three/webgpu'
import { updateProjectedUVs } from '../src/projected-uv.ts'
import { applyLayerTransform } from '../src/layer-transform.ts'
import { changeOrientation, defaultSettings, initialLayers, moveOrigin, orientationFor, referenceMetrics, usesProjection } from '../src/model.ts'

function cameraFor(settings = defaultSettings) {
  const metrics = referenceMetrics(settings)
  const camera = new PerspectiveCamera(settings.fov, metrics.aspect, 0.01, 1000)
  camera.position.z = metrics.cameraZ
  camera.updateMatrixWorld(true)
  return camera
}

test('parallel-plane vertex UVs match reference projection at vertices and interior points', () => {
  for (const fov of [20, 45, 90]) {
    const settings = { ...defaultSettings, fov }
    const layer = initialLayers(settings)[0]
    layer.transform = { ...layer.transform, x: 2.5, y: -1.2, width: 80, height: 30 }
    const root = new Group(), plane = new Object3D()
    root.add(plane)
    applyLayerTransform(root, plane, layer)
    const camera = cameraFor(settings)
    const matrix = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    const geometry = new PlaneGeometry(1, 1)
    expect(updateProjectedUVs(geometry, plane.matrixWorld, matrix)).toBe(true)
    const positions = geometry.getAttribute('position'), uv = geometry.getAttribute('uv')
    for (let i = 0; i < positions.count; i++) {
      const expected = new Vector3().fromBufferAttribute(positions, i).applyMatrix4(plane.matrixWorld).project(camera)
      expect(uv.getX(i)).toBeCloseTo((expected.x + 1) / 2, 6)
      expect(uv.getY(i)).toBeCloseTo((expected.y + 1) / 2, 6)
    }
    // Linear interpolation of the UVs equals camera projection on a parallel surface.
    for (const [a, b, c] of [[0.2, 0.3, 0.5], [0.7, 0.1, 0.2]]) {
      const indices = [0, 2, 1], weights = [a, b, c]
      const point = new Vector3()
      let u = 0, v = 0
      indices.forEach((index, i) => {
        point.addScaledVector(new Vector3().fromBufferAttribute(positions, index), weights[i])
        u += uv.getX(index) * weights[i]; v += uv.getY(index) * weights[i]
      })
      point.applyMatrix4(plane.matrixWorld).project(camera)
      expect(u).toBeCloseTo((point.x + 1) / 2, 6)
      expect(v).toBeCloseTo((point.y + 1) / 2, 6)
    }
    geometry.dispose()
  }
})

test('out-of-range UVs remain available for range diagnostics', () => {
  const geometry = new PlaneGeometry(100, 100)
  const camera = cameraFor()
  const matrix = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  expect(updateProjectedUVs(geometry, new Matrix4(), matrix)).toBe(true)
  const uv = geometry.getAttribute('uv')
  expect(Math.min(...Array.from(uv.array))).toBeLessThan(0)
  expect(Math.max(...Array.from(uv.array))).toBeGreaterThan(1)
  geometry.dispose()
})

test('invalid projection depth is rejected without producing infinite UVs', () => {
  const geometry = new PlaneGeometry(1, 1), camera = cameraFor()
  const matrix = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  for (const z of [camera.position.z, camera.position.z + 1, -2000]) {
    expect(updateProjectedUVs(geometry, new Matrix4().makeTranslation(0, 0, z), matrix)).toBe(false)
    expect(Array.from(geometry.getAttribute('uv').array).every(Number.isFinite)).toBe(true)
  }
  geometry.dispose()
})

test('relation determines rendering while direction and position remain separate', () => {
  const source = initialLayers(defaultSettings)[0]
  for (const direction of ['front', 'down', 'up', 'left', 'right']) {
    const layer = changeOrientation(defaultSettings, source, orientationFor(direction))
    expect(usesProjection(layer)).toBe(direction !== 'front')
  }
  const down = changeOrientation(defaultSettings, source, orientationFor('down'))
  const raised = moveOrigin(down, 0, 3)
  expect(raised.orientation).toEqual({ relation: 'perpendicular', direction: 'down' })
  expect(raised.origin).toEqual({ x: 0, y: 3, z: 0 })
  expect(raised.transform.y).toBe(3)
})
