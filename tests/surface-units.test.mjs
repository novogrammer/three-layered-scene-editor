import { expect, test } from 'vitest'
import { changeOrientation, defaultSettings, initialLayers, orientationFor, referenceMetrics,
  reconfigureScene, surfacePlacementValues, setSurfacePlacementValue } from '../src/model.ts'

const fields = ['center', 'size', 'frontZ', 'backZ', 'originX', 'originY']
const surface = direction => changeOrientation(defaultSettings, initialLayers(defaultSettings)[2], orientationFor(direction))

test('reading either unit repeatedly leaves canonical data and geometry untouched', () => {
  const layer = surface('down'), before = structuredClone(layer), transform = { ...layer.transform }
  for (let i = 0; i < 100; i++) {
    expect(surfacePlacementValues(layer, 'px')).toEqual({ center: 0, size: 12960, frontZ: 0, backZ: -6048, originX: 0, originY: -540 })
    expect(surfacePlacementValues(layer, 'scene')).toEqual({ center: 0, size: 60, frontZ: 0, backZ: -28, originX: 0, originY: -2.5 })
  }
  expect(structuredClone(layer)).toEqual(before)
  expect({ ...layer.transform }).toEqual(transform)
})

test.each(['down', 'up', 'left', 'right'])('%s accepts exact pixel input and equivalent scene input', direction => {
  const layer = surface(direction), before = structuredClone(layer), scale = referenceMetrics(defaultSettings).scale
  const input = { center: 123.1234567890123, size: 960.9876543210987, frontZ: 128.1234567890123,
    backZ: -12000.9876543210987, originX: 27.1234567890123, originY: -219.9876543210987 }
  for (const field of fields) {
    const pxLayer = setSurfacePlacementValue(layer, 'px', field, input[field])
    const sceneLayer = setSurfacePlacementValue(layer, 'scene', field, input[field] * scale)
    expect(surfacePlacementValues(pxLayer, 'px')[field]).toBe(input[field])
    for (const key of Object.keys(pxLayer.transform)) expect(pxLayer.transform[key]).toBeCloseTo(sceneLayer.transform[key], 10)
    if (field === 'originX' || field === 'originY') {
      expect(pxLayer.transform.x - layer.transform.x).toBeCloseTo(pxLayer.origin.x - layer.origin.x, 10)
      expect(pxLayer.transform.y - layer.transform.y).toBeCloseTo(pxLayer.origin.y - layer.origin.y, 10)
    } else {
      expect(pxLayer.originPx).toEqual(layer.originPx)
      for (const other of fields.filter(key => key !== field)) {
        expect(surfacePlacementValues(pxLayer, 'px')[other]).toBe(surfacePlacementValues(layer, 'px')[other])
      }
    }
    expect(structuredClone(layer)).toEqual(before)
  }
})

test('unit input uses the current scale after reference settings change', () => {
  const next = { ...defaultSettings, referenceHeight: 7, height: 1920, width: 1080, fov: 60 }
  const [layer] = reconfigureScene(defaultSettings, next, [surface('right')], true)
  const changed = setSurfacePlacementValue(layer, 'px', 'originX', 540)
  expect(changed.origin.x).toBeCloseTo(540 * 7 / 1920, 10)
  expect(surfacePlacementValues(changed, 'scene').originX).toBeCloseTo(changed.origin.x, 10)
  const size = setSurfacePlacementValue(changed, 'scene', 'size', 3)
  expect(surfacePlacementValues(size, 'px').size).toBeCloseTo(3 * 1920 / 7, 10)
})

test.each(['px', 'scene'])('invalid %s input is rejected without changing the layer', unit => {
  const layer = surface('down'), before = structuredClone(layer), values = surfacePlacementValues(layer, unit)
  for (const [field, value] of [['size', 0], ['size', -1], ['frontZ', values.backZ], ['backZ', values.frontZ], ['originY', NaN], ['center', Infinity]]) {
    expect(() => setSurfacePlacementValue(layer, unit, field, value)).toThrow()
    expect(structuredClone(layer)).toEqual(before)
  }
  for (const field of fields) expect(structuredClone(setSurfacePlacementValue(layer, unit, field, values[field]))).toEqual(before)
  expect(() => surfacePlacementValues(initialLayers(defaultSettings)[0], unit)).toThrow()
})
