import { expect, test } from 'vitest'
import { createLayerModel, defaultSettings, initialLayers, referenceMetrics, setFrontDepth,
  setSurfacePlacementValue, moveOrigin, changeOrientation, orientationFor, reconfigureScene } from '../src/model.ts'

const copy = layer => structuredClone(layer)
const closeTransform = (a, b) => {
  for (const key of ['x', 'y', 'z', 'width', 'height']) expect(a[key]).toBeCloseTo(b[key], 10)
}

test('the demo has pixel authoring data, with derived scene fields excluded from the data', () => {
  const [back, front, ground] = initialLayers(defaultSettings)
  expect(back.placement).toEqual({ type: 'screen', rectPx: { x: 0, y: 0, width: 1920, height: 1080 }, zPx: -8640 })
  expect(front.placement.zPx).toBe(216)
  expect(ground.originPx).toEqual({ x: 0, y: -540, z: 0 })
  expect(ground.placement).toEqual({ type: 'surface', centerPx: 0, sizePx: 12960, frontZPx: 0, backZPx: -6048 })
  expect(ground.transform.y).toBe(-2.5)
  expect(ground.depthRange).toEqual({ frontZ: 0, backZ: -28 })
  for (const layer of [back, front, ground]) {
    expect(Object.keys(layer)).not.toContain('transform')
    expect(Object.keys(layer)).not.toContain('origin')
    expect(Object.keys(layer)).not.toContain('depthRange')
    closeTransform(createLayerModel(defaultSettings, copy(layer)).transform, layer.transform)
  }
})

test('reads and repeated screen-preserving depth/FOV changes never reverse-convert the screen rectangle', () => {
  const layer = initialLayers(defaultSettings)[0]
  layer.placement.rectPx = { x: 103.1234567890123, y: 80.8765432109876, width: 631.1234567890123, height: 419.9876543210987 }
  const rect = { ...layer.placement.rectPx }, data = copy(layer)
  for (let i = 0; i < 100; i++) void { ...layer.transform }
  expect(copy(layer)).toEqual(data)
  let current = layer
  for (const z of [-50, -2, 0, 3, -40]) current = setFrontDepth(current, z, 'screen')
  expect(current.placement.rectPx).toEqual(rect)
  let settings = defaultSettings
  for (const fov of [60, 30, 75, 45]) {
    const next = { ...settings, fov }
    ;[current] = reconfigureScene(settings, next, [current], 'screen')
    expect(current.placement.rectPx).toEqual(rect)
    settings = next
  }
})

test('scene-unit setters update only the affected authoring fields', () => {
  const layer = initialLayers(defaultSettings)[0]
  const original = copy(layer), before = { ...layer.transform }
  layer.transform.x = before.x + 1.25
  expect(layer.transform.x).toBeCloseTo(before.x + 1.25, 10)
  expect(layer.placement.rectPx.y).toBe(original.placement.rectPx.y)
  expect(layer.placement.rectPx.width).toBe(original.placement.rectPx.width)
  expect(layer.placement.rectPx.height).toBe(original.placement.rectPx.height)
  expect(layer.placement.zPx).toBe(original.placement.zPx)
  const old = { ...layer.transform }, rect = { ...layer.placement.rectPx }
  layer.transform.width = old.width * 0.7
  expect(layer.transform.x).toBeCloseTo(old.x, 10)
  expect(layer.transform.width).toBeCloseTo(old.width * 0.7, 10)
  expect(layer.placement.rectPx.y).toBe(rect.y)
  expect(layer.placement.rectPx.height).toBe(rect.height)
  const unchanged = copy(layer)
  for (const key of Object.keys(layer.transform)) layer.transform[key] = layer.transform[key]
  expect(copy(layer)).toEqual(unchanged)
})

test('world-preserving depth changes keep geometry while updating authoring rectangle', () => {
  const layer = initialLayers(defaultSettings)[0], original = copy(layer)
  const t = { ...layer.transform }
  const moved = setFrontDepth(layer, -20, 'world')
  closeTransform(moved.transform, { ...t, z: -20 })
  expect(moved.placement.rectPx).not.toEqual(layer.placement.rectPx)
  expect(copy(layer)).toEqual(original)
})

test.each(['down', 'up', 'left', 'right'])('%s endpoint and origin edits preserve unrelated authoring data', direction => {
  const layer = changeOrientation(defaultSettings, initialLayers(defaultSettings)[2], orientationFor(direction))
  const original = copy(layer), scale = referenceMetrics(defaultSettings).scale
  const moved = setSurfacePlacementValue(layer, 'scene', 'frontZ', 2)
  expect(moved.placement.frontZPx).toBe(2 / scale)
  expect(moved.placement.backZPx).toBe(layer.placement.backZPx)
  expect(moved.placement.centerPx).toBe(layer.placement.centerPx)
  expect(moved.placement.sizePx).toBe(layer.placement.sizePx)
  const shifted = moveOrigin(moved, moved.origin.x + 1, moved.origin.y - 0.5)
  expect(shifted.origin.x).toBeCloseTo(moved.origin.x + 1, 10)
  expect(shifted.origin.y).toBeCloseTo(moved.origin.y - 0.5, 10)
  expect(shifted.originPx.z).toBe(0)
  expect(shifted.placement.frontZPx).toBe(moved.placement.frontZPx)
  expect(copy(layer)).toEqual(original)
})

test('height and resolution reconfiguration preserve existing scene-unit behavior without mutating the source', () => {
  const layers = initialLayers(defaultSettings), original = layers.map(copy)
  for (const patch of [{ referenceHeight: 7 }, { width: 1080, height: 1920 }, { width: 3840, height: 2160 },
    { referenceHeight: 8, width: 1080, height: 1920, fov: 60 }]) {
    const next = { ...defaultSettings, ...patch }
    for (const policy of ['screen', 'world']) {
      const result = reconfigureScene(defaultSettings, next, layers, policy)
      result.forEach((layer, i) => {
        expect(layer.origin.x).toBeCloseTo(layers[i].origin.x, 10)
        expect(layer.origin.y).toBeCloseTo(layers[i].origin.y, 10)
        if (i < 2 && policy === 'world') closeTransform(layer.transform, layers[i].transform)
      })
      expect(result[2].transform.width).toBeCloseTo(layers[2].transform.width, 10)
    }
  }
  expect(layers.map(copy)).toEqual(original)
})

test('invalid scene edits leave authoring data untouched', () => {
  const layer = initialLayers(defaultSettings)[0], original = copy(layer)
  for (const [key, value] of [['x', NaN], ['z', 100], ['width', -1], ['height', Infinity]]) {
    expect(() => { layer.transform[key] = value }).toThrow()
    expect(copy(layer)).toEqual(original)
  }
  expect(() => setFrontDepth(layer, 100, 'screen')).toThrow()
  expect(copy(layer)).toEqual(original)
})

test('2D rectangle edits preserve exact pixel inputs, depth and origin, and project to the requested bounds', async () => {
  const { setFrontRect, setFrontDepth } = await import('../src/model.ts')
  const { PerspectiveCamera, Vector3 } = await import('three')
  const rect = { x: -123.1234567890123, y: 57.8765432109876, width: 678.123456789, height: 432.987654321 }
  for (const z of [-40, 0, 2]) {
    const source = setFrontDepth(initialLayers(defaultSettings)[0], z, 'screen'), before = copy(source)
    const layer = setFrontRect(source, rect)
    expect(layer.placement.rectPx).toEqual(rect)
    expect(layer.placement.rectPx).not.toBe(rect)
    expect(layer.placement.zPx).toBe(source.placement.zPx)
    expect(layer.originPx).toEqual(source.originPx)
    expect(copy(source)).toEqual(before)
    const m = referenceMetrics(defaultSettings)
    const camera = new PerspectiveCamera(defaultSettings.fov, m.aspect, m.near, 1000)
    camera.position.z = m.cameraZ; camera.updateMatrixWorld(true)
    const t = layer.transform
    const topLeft = new Vector3(t.x - t.width / 2, t.y + t.height / 2, t.z).project(camera)
    const bottomRight = new Vector3(t.x + t.width / 2, t.y - t.height / 2, t.z).project(camera)
    expect((topLeft.x + 1) * 1920 / 2).toBeCloseTo(rect.x, 9)
    expect((1 - topLeft.y) * 1080 / 2).toBeCloseTo(rect.y, 9)
    expect((bottomRight.x + 1) * 1920 / 2).toBeCloseTo(rect.x + rect.width, 9)
    expect((1 - bottomRight.y) * 1080 / 2).toBeCloseTo(rect.y + rect.height, 9)
  }
})

test('invalid 2D edits are rejected before changing the authoring data', async () => {
  const { setFrontRect } = await import('../src/model.ts')
  const [layer, , ground] = initialLayers(defaultSettings), before = copy(layer)
  for (const patch of [{ x: NaN }, { y: Infinity }, { width: 0 }, { height: -1 }]) {
    expect(() => setFrontRect(layer, { ...layer.placement.rectPx, ...patch })).toThrow()
    expect(copy(layer)).toEqual(before)
  }
  expect(() => setFrontRect(ground, { x: 0, y: 0, width: 1920, height: 1080 })).toThrow()
})

test('pixel depth inputs retain their exact value in both screen and world preserving modes', async () => {
  const { setFrontDepthPx } = await import('../src/model.ts')
  const layer = initialLayers(defaultSettings)[0], before = copy(layer), zPx = -1234.1234567890123
  const scale = referenceMetrics(defaultSettings).scale
  for (const policy of ['screen', 'world']) {
    const edited = setFrontDepthPx(layer, zPx, policy)
    expect(edited.placement.zPx).toBe(zPx)
    expect(edited.originPx).toEqual(layer.originPx)
    if (policy === 'screen') expect(edited.placement.rectPx).toEqual(layer.placement.rectPx)
    else closeTransform(edited.transform, { ...layer.transform, z: zPx * scale })
    expect(edited.transform.z).toBeCloseTo(zPx * scale, 10)
  }
  expect(() => setFrontDepthPx(layer, 10000, 'screen')).toThrow()
  expect(copy(layer)).toEqual(before)
})

test('pixel origin input retains precision while moving a parallel plane with its origin', async () => {
  const { moveOriginPx } = await import('../src/model.ts')
  const layer = initialLayers(defaultSettings)[0], before = copy(layer)
  const x = 123.1234567890123, y = -321.9876543210987, scale = referenceMetrics(defaultSettings).scale
  const edited = moveOriginPx(layer, x, y)
  expect(edited.originPx).toEqual({ x, y, z: 0 })
  expect(edited.transform.x - layer.transform.x).toBeCloseTo(x * scale, 10)
  expect(edited.transform.y - layer.transform.y).toBeCloseTo(y * scale, 10)
  expect(edited.placement.zPx).toBe(layer.placement.zPx)
  expect(edited.placement.rectPx.width).toBe(layer.placement.rectPx.width)
  expect(edited.placement.rectPx.height).toBe(layer.placement.rectPx.height)
  expect(() => moveOriginPx(layer, NaN, y)).toThrow()
  expect(copy(layer)).toEqual(before)
})
