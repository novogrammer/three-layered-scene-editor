import { expect, test } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { defaultSettings, referenceMetrics, placeFront, frontRect, initialLayers, reconfigureScene } from '../src/model.ts'

const close = (actual, expected, epsilon = 1e-9) => expect(Math.abs(actual - expected), `${actual} != ${expected}`).toBeLessThan(epsilon)
function projectedBounds(settings, transform) {
  const metrics = referenceMetrics(settings)
  const camera = new PerspectiveCamera(settings.fov, metrics.aspect, metrics.near, 1000)
  camera.position.z = metrics.cameraZ
  camera.updateMatrixWorld(true)
  const lowerLeft = new Vector3(transform.x - transform.width / 2, transform.y - transform.height / 2, transform.z).project(camera)
  const upperRight = new Vector3(transform.x + transform.width / 2, transform.y + transform.height / 2, transform.z).project(camera)
  return [lowerLeft.x, lowerLeft.y, upperRight.x, upperRight.y]
}

test('reference height determines world scale independently of source pixel density', () => {
  const normal = referenceMetrics(defaultSettings)
  const doubled = referenceMetrics({ ...defaultSettings, width: 3840, height: 2160 })
  close(normal.height, 5)
  close(normal.width, 5 * 16 / 9)
  close(normal.cameraZ, 5 / (2 * Math.tan(Math.PI / 8)))
  close(normal.cameraZ, doubled.cameraZ)
  close(normal.width, doubled.width)
  close(normal.scale, doubled.scale * 2)
})

test('assisted depth placement preserves a non-centered rectangle in the actual perspective camera', () => {
  const rect = { x: 230, y: 130, width: 640, height: 410 }
  const expected = [rect.x / 1920 * 2 - 1, 1 - (rect.y + rect.height) / 1080 * 2,
    (rect.x + rect.width) / 1920 * 2 - 1, 1 - rect.y / 1080 * 2]
  for (const z of [-20, -1, 0, 2, 5]) {
    const transform = placeFront(defaultSettings, rect, z)
    projectedBounds(defaultSettings, transform).forEach((n, i) => close(n, expected[i]))
    const recovered = frontRect(defaultSettings, transform)
    for (const key of Object.keys(rect)) close(recovered[key], rect[key])
  }
})

test('full-canvas plane at z=0 exactly matches the reference frame, including portrait aspect', () => {
  for (const [width, height] of [[1920, 1080], [1080, 1920]]) {
    const settings = { ...defaultSettings, width, height }
    const plane = placeFront(settings, { x: 0, y: 0, width, height }, 0)
    projectedBounds(settings, plane).forEach((n, i) => close(n, [-1, -1, 1, 1][i]))
  }
})

test('screen-preserving FOV changes retain projected bounds and leave ground unchanged', () => {
  const layers = initialLayers(defaultSettings)
  const before = structuredClone(layers)
  const next = { ...defaultSettings, fov: 75 }
  const result = reconfigureScene(defaultSettings, next, layers, true)
  for (let i = 0; i < 2; i++) {
    projectedBounds(next, result[i].transform).forEach((n, j) => close(n, projectedBounds(defaultSettings, layers[i].transform)[j]))
    close(result[i].transform.z, layers[i].transform.z)
  }
  expect(result[2].transform).toStrictEqual(layers[2].transform)
  expect(layers).toStrictEqual(before)
})

test('world-preserving FOV changes keep all 3D transforms intact', () => {
  const layers = initialLayers(defaultSettings)
  const result = reconfigureScene(defaultSettings, { ...defaultSettings, fov: 65 }, layers, false)
  expect(result).toStrictEqual(layers)
  expect(result[0].transform).not.toBe(layers[0].transform)
})

test('resolution changes preserve normalized framing without inflating world geometry', () => {
  const layers = initialLayers(defaultSettings)
  const next = { ...defaultSettings, width: 3840, height: 2160 }
  const result = reconfigureScene(defaultSettings, next, layers, true)
  expect(result.map(l => l.transform)).toStrictEqual(layers.map(l => l.transform))
})

test('invalid settings and planes crossing the near plane are rejected without partial edits', () => {
  for (const patch of [{ width: 0 }, { height: NaN }, { referenceHeight: -1 }, { fov: 180 }, { fov: Infinity }]) {
    expect(() => referenceMetrics({ ...defaultSettings, ...patch })).toThrow()
  }
  const rect = { x: 0, y: 0, width: 1920, height: 1080 }
  const metrics = referenceMetrics(defaultSettings)
  expect(() => placeFront(defaultSettings, rect, metrics.cameraZ)).toThrow()
  expect(() => placeFront(defaultSettings, rect, metrics.cameraZ - metrics.near / 2)).toThrow()
  expect(() => placeFront(defaultSettings, { ...rect, width: 0 }, 0)).toThrow()
  const layers = initialLayers(defaultSettings)
  layers[1].transform.z = 3
  const before = structuredClone(layers)
  expect(() => reconfigureScene(defaultSettings, { ...defaultSettings, fov: 140 }, layers, true)).toThrow()
  expect(layers).toStrictEqual(before)
})
