import { expect, test, vi } from 'vitest'
import { createSceneDocument } from '../src/scene-json.ts'
import { parseSceneDocument, prepareSceneImport } from '../src/scene-import.ts'
import { changeOrientation, createLayerModel, defaultSettings, initialLayers, orientationFor, referenceMetrics, setFrontRect, validateScenePlacement } from '../src/model.ts'
import { assertImageFitsGpu } from '../src/gpu-texture.ts'

const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 255])
async function document() {
  const layers = initialLayers(defaultSettings)
  const sources = new Map(layers.map(layer => [layer.id, { fileName: `${layer.id}.png`, blob: new Blob([bytes], { type: 'image/png' }) }]))
  return createSceneDocument(defaultSettings, layers, sources)
}
const decode = async () => ({ width: 1920, height: 1080 })

test.each([
  ['small reference height', { referenceHeight: 0.01 }, () => {}],
  ['large reference height', { referenceHeight: 1000 }, () => {}],
  ['narrow FOV', { fov: 1 }, () => {}],
  ['wide FOV', { fov: 179 }, () => {}],
  ['large screen rectangle', {}, data => { data.placement.rectPx = { x: -1e6, y: 1e6, width: 1e6, height: 2e6 } }],
  ['tiny positive rectangle', {}, data => { data.placement.rectPx.width = 1e-6; data.placement.rectPx.height = 1e-6 }],
  ['distant depth', {}, data => { data.placement.zPx = -1e6 }],
  ['depth just beyond the near plane', {}, data => {
    const metrics = referenceMetrics(defaultSettings)
    data.placement.zPx = (metrics.cameraZ - metrics.near - 1e-6) / metrics.scale
  }],
  ['large placement origin', {}, data => { data.originPx.x = 1e6; data.originPx.y = -1e6 }],
])('%s is accepted by the UI validator and JSON round-trip with the same exact data', async (_, patch, edit) => {
  const settings = { ...defaultSettings, ...patch }
  const data = structuredClone(initialLayers(defaultSettings)[0])
  data.placement.zPx = 0
  edit(data)
  const layer = createLayerModel(settings, data)
  expect(() => validateScenePlacement(settings, [layer])).not.toThrow()
  const sources = new Map([[layer.id, { fileName: 'image.png', blob: new Blob([bytes], { type: 'image/png' }) }]])
  const doc = await createSceneDocument(settings, [layer], sources)
  const restored = await prepareSceneImport(JSON.stringify(doc), decode)
  expect(restored.settings).toEqual(settings)
  expect(structuredClone(restored.layers[0])).toEqual(data)
})

test.each(['down', 'up', 'left', 'right'])('%s accepts large surface ranges and small positive sizes through both validation paths', async direction => {
  const data = structuredClone(changeOrientation(defaultSettings, initialLayers(defaultSettings)[2], orientationFor(direction)))
  Object.assign(data.placement, { centerPx: 1e6, sizePx: 1e-6, frontZPx: 1e6, backZPx: -1e6 })
  data.originPx = { x: 1e6, y: -1e6, z: 0 }
  const layer = createLayerModel(defaultSettings, data)
  expect(() => validateScenePlacement(defaultSettings, [layer])).not.toThrow()
  const sources = new Map([[layer.id, { fileName: 'image.png', blob: new Blob([bytes], { type: 'image/png' }) }]])
  const doc = await createSceneDocument(defaultSettings, [layer], sources)
  const restored = await prepareSceneImport(JSON.stringify(doc), decode)
  expect(structuredClone(restored.layers[0])).toEqual(data)
})

test.each([
  ['zero reference height', d => { d.referencePlane.height = 0 }],
  ['negative reference height', d => { d.referencePlane.height = -1 }],
  ['zero FOV', d => { d.projectionCamera.fov = 0 }],
  ['180 degree FOV', d => { d.projectionCamera.fov = 180 }],
  ['overflowing placement', d => { d.layers[0].placement.rectPx.x = 1e300 }],
  ['underflowing size', d => { d.layers[0].placement.rectPx.width = 1e-100 }],
  ['camera near crossing', d => { d.layers[0].placement.zPx = 2000 }],
  ['zero size', d => { d.layers[0].placement.rectPx.width = 0 }],
])('%s is rejected by both UI and JSON validation, preserving the original scene', async (_, edit) => {
  const doc = await document()
  edit(doc)
  const settings = { ...doc.composition, referenceHeight: doc.referencePlane.height, fov: doc.projectionCamera.fov }
  const current = initialLayers(defaultSettings), before = structuredClone(current)
  const candidate = structuredClone(current[0])
  candidate.placement = structuredClone(doc.layers[0].placement)
  expect(() => validateScenePlacement(settings, [createLayerModel(settings, candidate)])).toThrow()
  await expect(prepareSceneImport(JSON.stringify(doc), decode)).rejects.toThrow()
  expect(structuredClone(current)).toEqual(before)
})

test('save/import/save preserves the full document, source bytes, list order and exact pixel inputs', async () => {
  const doc = await document()
  const layer = setFrontRect(initialLayers(defaultSettings)[0], { x: -123.1234567890123, y: 83.9876543210987, width: 678.1234567890123, height: 456.9876543210987 })
  doc.layers[0].placement = structuredClone(layer.placement)
  doc.layers.reverse(); doc.assets.reverse(); doc.layers[0].visible = false
  const before = structuredClone(doc)
  const restored = await prepareSceneImport(JSON.stringify(doc), async blob => {
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes)
    return decode()
  })
  expect(restored.layers.map(l => l.id)).toEqual(doc.layers.map(l => l.id))
  expect(restored.layers[0].visible).toBe(false)
  const saved = await createSceneDocument(restored.settings, restored.layers, restored.assets)
  expect(saved).toEqual(doc)
  expect(doc).toEqual(before)
  restored.layers.forEach(layer => {
    const clone = createLayerModel(restored.settings, structuredClone(layer))
    expect({ ...clone.transform }).toEqual({ ...layer.transform })
  })
})

test.each(['down', 'up', 'left', 'right'])('%s round-trips its axis-specific surface data without applying FOV correction again', async direction => {
  const original = changeOrientation(defaultSettings, initialLayers(defaultSettings)[2], orientationFor(direction))
  const sources = new Map([[original.id, { fileName: 'surface.png', blob: new Blob([bytes], { type: 'image/png' }) }]])
  const doc = await createSceneDocument(defaultSettings, [original], sources)
  const restored = await prepareSceneImport(JSON.stringify(doc), decode)
  expect(structuredClone(restored.layers[0])).toEqual(structuredClone(original))
  expect({ ...restored.layers[0].transform }).toEqual({ ...original.transform })
})

test('empty scenes and shared image references are valid', async () => {
  const doc = await document()
  doc.layers = []; doc.assets = []
  const restored = await prepareSceneImport(JSON.stringify(doc), vi.fn(() => { throw new Error('no images') }))
  expect(restored.layers).toEqual([]); expect(restored.assets.size).toBe(0)
  const shared = await document()
  shared.layers.forEach(layer => { layer.imageId = shared.assets[0].id })
  shared.assets.splice(1)
  const read = vi.fn(decode)
  const result = await prepareSceneImport(JSON.stringify(shared), read)
  expect(read).toHaveBeenCalledTimes(1)
  expect(result.assets.get('layer-1')).toBe(result.assets.get('layer-2'))
})

test.each([
  ['version', d => { d.schemaVersion = 2 }],
  ['missing field', d => { delete d.referencePlane }],
  ['invalid size', d => { d.composition.width = 0 }],
  ['fractional resolution', d => { d.composition.width = 1.5 }],
  ['FOV', d => { d.projectionCamera.fov = 180 }],
  ['projection mode', d => { d.projection.outsideImage = 'repeat' }],
  ['duplicate layers', d => { d.layers[1].id = d.layers[0].id }],
  ['duplicate assets', d => { d.assets[1].id = d.assets[0].id }],
  ['missing reference', d => { d.layers[0].imageId = 'missing' }],
  ['invalid layers array', d => { d.layers = {} }],
  ['invalid assets array', d => { d.assets = null }],
  ['direction', d => { d.layers[0].orientation.direction = 'left' }],
  ['origin Z', d => { d.layers[0].originPx.z = 1 }],
  ['non-number', d => { d.layers[0].originPx.x = '0' }],
  ['color', d => { d.layers[0].editorColor = 'blue' }],
  ['visibility', d => { d.layers[0].visible = 1 }],
  ['alpha mode', d => { d.layers[0].alphaMode = 'MASK' }],
  ['zero rectangle', d => { d.layers[0].placement.rectPx.width = 0 }],
  ['endpoints', d => { d.layers[2].placement.backZPx = 0 }],
  ['wrong surface axis', d => { delete d.layers[2].placement.widthPx; d.layers[2].placement.heightPx = 100 }],
])('invalid %s is rejected before decoding any image', async (_, mutate) => {
  const doc = await document(); mutate(doc)
  const reader = vi.fn(decode)
  await expect(prepareSceneImport(JSON.stringify(doc), reader)).rejects.toThrow()
  expect(reader).not.toHaveBeenCalled()
})

test.each(['{', 'null', '[]', '"text"'])('invalid JSON root %s is rejected', text => {
  expect(() => parseSceneDocument(text)).toThrow()
})

test.each([
  ['external URL', d => { d.assets[0].data = 'https://example.com/image.png' }],
  ['MIME mismatch', d => { d.assets[0].mimeType = 'image/jpeg' }],
  ['base64', d => { d.assets[0].data = 'data:image/png;base64,@@@@' }],
  ['empty image', d => { d.assets[0].data = 'data:image/png;base64,' }],
  ['camera crossing', d => { d.layers[0].placement.zPx = 2000 }],
  ['infinite derived geometry', d => { d.layers[0].placement.rectPx.x = 1e300 }],
  ['unrenderable origin', d => { d.layers[0].originPx.x = 1e300 }],
])('invalid %s does not alter an existing edited scene', async (_, mutate) => {
  const current = initialLayers(defaultSettings), before = structuredClone(current)
  const doc = await document(); mutate(doc)
  await expect(prepareSceneImport(JSON.stringify(doc), decode)).rejects.toThrow()
  expect(structuredClone(current)).toEqual(before)
})

test('a late image decoding failure leaves edited data intact and does not return a partial scene', async () => {
  const doc = await document(), current = initialLayers(defaultSettings), before = structuredClone(current)
  const reader = vi.fn().mockResolvedValueOnce({ width: 1920, height: 1080 }).mockRejectedValueOnce(new Error('画像が壊れています'))
  await expect(prepareSceneImport(JSON.stringify(doc), reader)).rejects.toThrow('壊れています')
  expect(reader).toHaveBeenCalledTimes(2)
  expect(structuredClone(current)).toEqual(before)
})

test.each([{ width: 0, height: 1 }, { width: NaN, height: 1 }, { width: 1.5, height: 1 }])('invalid decoded dimensions are rejected', async size => {
  await expect(prepareSceneImport(JSON.stringify(await document()), async () => size)).rejects.toThrow('寸法')
})

test('more than nine layers and images and a large composition round-trip without fixed limits', async () => {
  const doc = await document(), layer = doc.layers[0], asset = doc.assets[0]
  doc.composition = { width: 65536, height: 32768 }
  doc.layers = Array.from({ length: 20 }, (_, i) => ({ ...structuredClone(layer), id: `layer-${i}`, imageId: `image-layer-${i}` }))
  doc.assets = Array.from({ length: 20 }, (_, i) => ({ ...asset, id: `image-layer-${i}` }))
  const restored = await prepareSceneImport(JSON.stringify(doc), async () => ({ width: 16384, height: 9000 }))
  expect(restored.layers).toHaveLength(20)
  expect(restored.assets.size).toBe(20)
  expect(await createSceneDocument(restored.settings, restored.layers, restored.assets)).toEqual(doc)
})

test('embedded images larger than 32 MiB retain their bytes', async () => {
  const layers = initialLayers(defaultSettings).slice(0, 1)
  const data = new Uint8Array(32 * 1024 * 1024 + 1)
  data[0] = 137; data[data.length - 1] = 255
  const sources = new Map([[layers[0].id, { fileName: 'large.png', blob: new Blob([data], { type: 'image/png' }) }]])
  const doc = await createSceneDocument(defaultSettings, layers, sources)
  const restored = await prepareSceneImport(JSON.stringify(doc), decode)
  const blob = restored.assets.get(layers[0].id).blob
  expect(blob.size).toBe(data.length)
  expect(Buffer.from(await blob.arrayBuffer()).equals(Buffer.from(data))).toBe(true)
})

test('GPU image limits are enforced by the decoder before replacing the edited scene', async () => {
  const current = initialLayers(defaultSettings), before = structuredClone(current)
  const text = JSON.stringify(await document())
  const reader = vi.fn(async () => {
    const image = { width: 8193, height: 1080 }
    assertImageFitsGpu(image, 8192)
    return image
  })
  await expect(prepareSceneImport(text, reader)).rejects.toThrow('GPU')
  expect(reader).toHaveBeenCalledTimes(1)
  expect(structuredClone(current)).toEqual(before)
})
