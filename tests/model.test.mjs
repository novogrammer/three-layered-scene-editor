import { expect, test } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { defaultSettings, referenceMetrics, placeFront, frontRect, initialLayers, reconfigureScene } from '../src/model.ts'

test('composition resolution has no fixed pixel cap and must remain a positive safe integer', () => {
  expect(referenceMetrics({ ...defaultSettings, width: 65536, height: 32768 }).aspect).toBe(2)
  for (const width of [0, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => referenceMetrics({ ...defaultSettings, width })).toThrow('整数')
  }
})

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

test('screen-preserving FOV changes retain front-layer projected bounds', () => {
  const layers = initialLayers(defaultSettings)
  const before = structuredClone(layers)
  const next = { ...defaultSettings, fov: 75 }
  const result = reconfigureScene(defaultSettings, next, layers, 'screen')
  for (let i = 0; i < 2; i++) {
    projectedBounds(next, result[i].transform).forEach((n, j) => close(n, projectedBounds(defaultSettings, layers[i].transform)[j]))
    close(result[i].transform.z, layers[i].transform.z)
  }
  expect(layers).toStrictEqual(before)
})

test('world-preserving FOV changes keep front-layer 3D transforms intact', () => {
  const layers = initialLayers(defaultSettings)
  const result = reconfigureScene(defaultSettings, { ...defaultSettings, fov: 65 }, layers, 'world')
  for (let i = 0; i < 2; i++) {
    for (const key of Object.keys(layers[i].transform)) close(result[i].transform[key], layers[i].transform[key])
    expect(result[i].placement.rectPx).not.toEqual(layers[i].placement.rectPx)
  }
  expect(result[0].transform).not.toBe(layers[0].transform)
})

test('FOV changes preserve the projection of ground points in either front-layer mode', () => {
  const layers = initialLayers(defaultSettings)
  layers[2].transform.x = 1.25
  layers[2].transform.y = -1.8
  const before = structuredClone(layers)
  const project = (settings, ground) => {
    const metrics = referenceMetrics(settings)
    const camera = new PerspectiveCamera(settings.fov, metrics.aspect, metrics.near, 1000)
    camera.position.z = metrics.cameraZ
    camera.updateMatrixWorld(true)
    return [0, 0.25, 0.5, 0.7].flatMap(depth => [-0.5, 0, 0.5].map(side => {
      const point = new Vector3(ground.x + ground.width * side, ground.y,
        ground.z + ground.height * (depth - 0.5)).project(camera)
      return [point.x, point.y]
    }))
  }
  const expected = project(defaultSettings, layers[2].transform)
  for (const policy of ['screen', 'world']) {
    for (const fov of [20, 60, 90]) {
      const next = { ...defaultSettings, fov }
      const result = reconfigureScene(defaultSettings, next, layers, policy)
      const ground = result[2].transform
      project(next, ground).flat().forEach((value, i) => close(value, expected.flat()[i]))
      for (const key of ['x', 'y', 'width']) close(ground[key], layers[2].transform[key])
    }
  }
  expect(layers).toStrictEqual(before)
})

test('repeated FOV changes restore the ground when returning to the initial FOV', () => {
  const original = initialLayers(defaultSettings)
  let layers = original
  let previous = defaultSettings
  for (const fov of [60, 30, 75, 45]) {
    const next = { ...defaultSettings, fov }
    layers = reconfigureScene(previous, next, layers, 'screen')
    previous = next
  }
  for (const key of Object.keys(original[2].transform)) {
    close(layers[2].transform[key], original[2].transform[key])
  }
})

test('resolution changes preserve normalized framing without inflating world geometry', () => {
  const layers = initialLayers(defaultSettings)
  const next = { ...defaultSettings, width: 3840, height: 2160 }
  const result = reconfigureScene(defaultSettings, next, layers, 'screen')
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
  expect(() => reconfigureScene(defaultSettings, { ...defaultSettings, fov: 140 }, layers, 'screen')).toThrow()
  expect(layers).toStrictEqual(before)
})
