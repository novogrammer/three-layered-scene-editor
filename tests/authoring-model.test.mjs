import { expect, test } from 'vitest'
import { createLayerModel, defaultSettings, initialLayers, referenceMetrics, setFrontDepth,
  setDepthRange, moveOrigin, changeOrientation, orientationFor, reconfigureScene } from '../src/model.ts'

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
  for (const z of [-50, -2, 0, 3, -40]) current = setFrontDepth(current, z, true)
  expect(current.placement.rectPx).toEqual(rect)
  let settings = defaultSettings
  for (const fov of [60, 30, 75, 45]) {
    const next = { ...settings, fov }
    ;[current] = reconfigureScene(settings, next, [current], true)
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
  const moved = setFrontDepth(layer, -20, false)
  closeTransform(moved.transform, { ...t, z: -20 })
  expect(moved.placement.rectPx).not.toEqual(layer.placement.rectPx)
  expect(copy(layer)).toEqual(original)
})

test.each(['down', 'up', 'left', 'right'])('%s endpoint and origin edits preserve unrelated authoring data', direction => {
  const layer = changeOrientation(defaultSettings, initialLayers(defaultSettings)[2], orientationFor(direction))
  const original = copy(layer), scale = referenceMetrics(defaultSettings).scale
  const moved = setDepthRange(layer, 2, layer.depthRange.backZ)
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
    for (const screen of [true, false]) {
      const result = reconfigureScene(defaultSettings, next, layers, screen)
      result.forEach((layer, i) => {
        expect(layer.origin.x).toBeCloseTo(layers[i].origin.x, 10)
        expect(layer.origin.y).toBeCloseTo(layers[i].origin.y, 10)
        if (i < 2 && !screen) closeTransform(layer.transform, layers[i].transform)
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
  expect(() => { layer.transform = { x: 0, y: 0, z: 100, width: 1, height: 1 } }).toThrow()
  expect(copy(layer)).toEqual(original)
  expect(() => setFrontDepth(layer, 100, true)).toThrow()
  expect(copy(layer)).toEqual(original)
})
