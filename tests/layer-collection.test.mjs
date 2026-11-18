import { expect, test } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three/webgpu'
import { compositionLayers, createLayer, MAX_LAYERS, removeLayer } from '../src/layer-collection.ts'
import { defaultSettings, initialLayers, referenceMetrics } from '../src/model.ts'

test('new image layers start at the reference frame and preserve the existing collection', () => {
  const settings = { ...defaultSettings, width: 1080, height: 1920, referenceHeight: 7, fov: 60 }
  const layers = initialLayers(settings), before = structuredClone(layers)
  const added = createLayer(settings, layers, 'new-image', '素材')
  expect(added.orientation).toEqual({ relation: 'parallel', direction: 'front' })
  expect(added.origin).toEqual({ x: 0, y: 0, z: 0 })
  expect(added.depthRange).toBeNull()
  const metrics = referenceMetrics(settings)
  const camera = new PerspectiveCamera(settings.fov, metrics.aspect, 0.01, 1000)
  camera.position.z = metrics.cameraZ; camera.updateMatrixWorld(true)
  const t = added.transform
  const min = new Vector3(t.x - t.width / 2, t.y - t.height / 2, t.z).project(camera)
  const max = new Vector3(t.x + t.width / 2, t.y + t.height / 2, t.z).project(camera)
  expect(min.x).toBeCloseTo(-1); expect(min.y).toBeCloseTo(-1)
  expect(max.x).toBeCloseTo(1); expect(max.y).toBeCloseTo(1)
  expect(layers).toEqual(before)
})

test('layer limit and duplicate IDs are rejected without changing the collection', () => {
  const layers = initialLayers(defaultSettings)
  expect(() => createLayer(defaultSettings, layers, layers[0].id, 'duplicate')).toThrow()
  while (layers.length < MAX_LAYERS) layers.push(createLayer(defaultSettings, layers, `new-${layers.length}`, '画像'))
  const before = structuredClone(layers)
  expect(() => createLayer(defaultSettings, layers, 'overflow', '画像')).toThrow()
  expect(layers).toEqual(before)
})

test.each([0, 1, 2])('deleting the selected layer at index %i selects its closest remaining neighbor', index => {
  const layers = initialLayers(defaultSettings), before = structuredClone(layers)
  const removed = layers[index]
  const result = removeLayer(layers, removed.id, removed.id)
  expect(result.layers.some(layer => layer.id === removed.id)).toBe(false)
  expect(result.selectedId).toBe(result.layers[Math.min(index, result.layers.length - 1)].id)
  expect(layers).toEqual(before)
})

test('deleting an unselected layer preserves selection by ID, including after index shifts', () => {
  const layers = initialLayers(defaultSettings)
  const result = removeLayer(layers, layers[0].id, layers[2].id)
  expect(result.selectedId).toBe(layers[2].id)
})

test('deleting every layer produces an empty collection that can be populated again', () => {
  let state = { layers: initialLayers(defaultSettings), selectedId: 'layer-1' }
  while (state.layers.length) state = removeLayer(state.layers, state.selectedId, state.selectedId)
  expect(state).toEqual({ layers: [], selectedId: null })
  const added = createLayer(defaultSettings, state.layers, 'after-empty', '画像')
  expect(added.id).toBe('after-empty')
})

test('comparison draws back to front using center Z without changing list order', () => {
  const layers = initialLayers(defaultSettings), before = structuredClone(layers)
  expect(compositionLayers(layers).map(layer => layer.id)).toEqual(['layer-1', 'ground', 'layer-2'])
  expect(layers).toEqual(before)
  // Move the foreground behind the ground, then add a new layer further back.
  layers.find(layer => layer.id === 'layer-2').transform.z = -20
  const added = createLayer(defaultSettings, layers, 'new', '画像')
  added.transform.z = -50
  layers.push(added)
  expect(compositionLayers(layers).map(layer => layer.id)).toEqual(['new', 'layer-1', 'layer-2', 'ground'])
  expect(compositionLayers(removeLayer(layers, 'layer-1', null).layers).map(layer => layer.id))
    .toEqual(['new', 'layer-2', 'ground'])
  expect(compositionLayers([])).toEqual([])
})

test('comparison keeps list order when Z positions are equal', () => {
  const layers = initialLayers(defaultSettings)
  layers.forEach(layer => { layer.transform.z = 0 })
  expect(compositionLayers(layers).map(layer => layer.id)).toEqual(layers.map(layer => layer.id))
})
