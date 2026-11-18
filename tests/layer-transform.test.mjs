import { expect, test } from 'vitest'
import { Group, Object3D, PerspectiveCamera, Vector3 } from 'three/webgpu'
import { applyLayerTransform } from '../src/layer-transform.ts'
import { changePreset, defaultOrigin, defaultSettings, initialLayers, moveOrigin, reconfigureScene, referenceMetrics } from '../src/model.ts'

function closeVector(actual, expected) {
  actual.toArray().forEach((value, i) => expect(value).toBeCloseTo(expected[i], 10))
}
function objects(layer) {
  const root = new Group()
  const plane = new Object3D()
  root.add(plane)
  applyLayerTransform(root, plane, layer)
  return { root, plane }
}

test('preset origins lie on the reference frame edges at world z=0', () => {
  const halfWidth = 5 * 1920 / 1080 / 2
  for (const [preset, expected] of [
    ['front', [0, 0, 0]], ['ground', [0, -2.5, 0]], ['ceiling', [0, 2.5, 0]],
    ['left-wall', [-halfWidth, 0, 0]], ['right-wall', [halfWidth, 0, 0]],
  ]) {
    expect(Object.values(defaultOrigin(defaultSettings, preset))).toEqual(expected)
  }
})

test('preset normals face the interior while each placement origin stays at z=0', () => {
  const source = initialLayers(defaultSettings)[2]
  for (const [preset, normal] of [
    ['front', [0, 0, 1]], ['ground', [0, 1, 0]], ['ceiling', [0, -1, 0]],
    ['left-wall', [1, 0, 0]], ['right-wall', [-1, 0, 0]],
  ]) {
    const layer = changePreset(defaultSettings, source, preset)
    const { root, plane } = objects(layer)
    closeVector(new Vector3().applyMatrix4(root.matrixWorld), [layer.origin.x, layer.origin.y, 0])
    closeVector(new Vector3(0, 0, 1).transformDirection(plane.matrixWorld), normal)
    closeVector(new Vector3().applyMatrix4(plane.matrixWorld),
      [layer.transform.x, layer.transform.y, layer.transform.z])
    if (preset !== 'front') {
      // The placement origin belongs to the surface plane, not a floating pivot.
      expect(new Vector3().applyMatrix4(root.matrixWorld).sub(plane.getWorldPosition(new Vector3()))
        .dot(new Vector3(...normal))).toBeCloseTo(0, 10)
    }
  }
})

test('separating the ground origin preserves all four corners of the existing sample', () => {
  const layer = initialLayers(defaultSettings)[2]
  const { plane } = objects(layer)
  for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) {
    closeVector(new Vector3(x, y, 0).applyMatrix4(plane.matrixWorld),
      [layer.transform.x + x * layer.transform.width, layer.transform.y,
        layer.transform.z - y * layer.transform.height])
  }
})

test('moving a placement origin preserves the local geometry offset and does not mutate the source', () => {
  const source = initialLayers(defaultSettings)[2]
  const before = structuredClone(source)
  const original = objects(source)
  const moved = moveOrigin(source, 2, -1)
  const result = objects(moved)
  closeVector(result.plane.position, original.plane.position.toArray())
  expect(moved.origin).toEqual({ x: 2, y: -1, z: 0 })
  expect(source).toEqual(before)
  expect(() => moveOrigin(source, Infinity, 0)).toThrow()
})

test('FOV correction leaves the placement origin on z=0 and scales the ground offset', () => {
  const layers = initialLayers(defaultSettings)
  const updated = reconfigureScene(defaultSettings, { ...defaultSettings, fov: 60 }, layers, true)
  expect(updated[2].origin).toEqual(layers[2].origin)
  expect(updated[2].origin).not.toBe(layers[2].origin)
  const { root } = objects(updated[2])
  expect(root.getWorldPosition(new Vector3()).z).toBe(0)
})

test.each(['ground', 'left-wall', 'right-wall', 'ceiling'])('%s preserves its projected surface and placement origin through FOV changes', (preset) => {
  let layer = changePreset(defaultSettings, initialLayers(defaultSettings)[2], preset)
  layer = moveOrigin(layer, layer.origin.x + 0.8, layer.origin.y - 0.3)
  layer.transform = { ...layer.transform, z: -9, width: 11, height: 7 }
  const original = structuredClone(layer)
  const project = (settings, surface) => {
    const camera = new PerspectiveCamera(settings.fov, settings.width / settings.height, 0.01, 1000)
    camera.position.z = referenceMetrics(settings).cameraZ
    camera.updateMatrixWorld(true)
    const { plane } = objects(surface)
    return [-0.5, 0, 0.5].flatMap(x => [-0.5, 0, 0.5].map(y =>
      new Vector3(x, y, 0).applyMatrix4(plane.matrixWorld).project(camera)))
  }
  const expected = project(defaultSettings, layer)
  const crossSection = preset === 'left-wall' || preset === 'right-wall' ? 'height' : 'width'
  for (const preserveScreen of [true, false]) {
    for (const fov of [20, 60, 90]) {
      const next = { ...defaultSettings, fov }
      const [updated] = reconfigureScene(defaultSettings, next, [layer], preserveScreen)
      project(next, updated).forEach((point, i) => {
        expect(point.x).toBeCloseTo(expected[i].x, 10)
        expect(point.y).toBeCloseTo(expected[i].y, 10)
      })
      expect(updated.origin).toEqual(layer.origin)
      expect(updated.origin.z).toBe(0)
      for (const key of ['x', 'y', crossSection]) expect(updated.transform[key]).toBe(layer.transform[key])
    }
  }
  let current = layer
  let previous = defaultSettings
  for (const fov of [60, 30, 75, 45]) {
    const next = { ...defaultSettings, fov }
    ;[current] = reconfigureScene(previous, next, [current], true)
    previous = next
  }
  for (const key of Object.keys(layer.transform)) expect(current.transform[key]).toBeCloseTo(layer.transform[key], 10)
  expect(layer).toEqual(original)
  const [resolutionOnly] = reconfigureScene(defaultSettings, { ...defaultSettings, width: 3840, height: 2160 }, [layer], true)
  expect(resolutionOnly.transform).toEqual(layer.transform)
})
