import { expect, test, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createSceneDocument } from '../src/scene-json.ts'
import { initialLayers, defaultSettings, changeOrientation, orientationFor, setFrontDepthPx, setFrontRect } from '../src/model.ts'

const bytes = new Uint8Array([137, 80, 78, 71, 0, 255, 1, 2])
const image = (fileName = '画像.png') => ({ fileName, blob: new Blob([bytes], { type: 'image/png' }) })
const sourcesFor = layers => new Map(layers.map(layer => [layer.id, image(`${layer.id}.png`)]))
const decode = asset => Buffer.from(asset.data.split(',')[1], 'base64')

test('demo JSON follows the agreed structure and exports canonical pixels without derived scene or UI state', async () => {
  const layers = initialLayers(defaultSettings), before = structuredClone(layers)
  const data = await createSceneDocument(defaultSettings, layers, sourcesFor(layers))
  expect(Object.keys(data)).toEqual(['schemaVersion', 'composition', 'referencePlane', 'projectionCamera', 'projection', 'layers', 'assets'])
  expect(data.schemaVersion).toBe(1)
  expect(data.composition).toEqual({ width: 1920, height: 1080 })
  expect(data.referencePlane).toEqual({ height: 5 })
  expect(data.projectionCamera).toEqual({ fov: 45 })
  expect(data.projection).toEqual({ imageFit: 'cover', imageAlign: 'center', outsideImage: 'clamp' })
  expect(data.layers[0]).toEqual({
    id: 'layer-1', name: 'レイヤー 1', imageId: 'image-layer-1', visible: true, editorColor: '#78c5b1', alphaMode: 'BLEND',
    orientation: { relation: 'parallel', direction: 'front' }, originPx: { x: 0, y: 0, z: 0 },
    placement: { type: 'screen', rectPx: { x: 0, y: 0, width: 1920, height: 1080 }, zPx: -8640 },
  })
  expect(data.layers[1].placement.zPx).toBe(216)
  expect(data.layers[2].originPx).toEqual({ x: 0, y: -540, z: 0 })
  expect(data.layers[2].placement).toEqual({ type: 'surface', centerXPx: 0, widthPx: 12960, frontZPx: 0, backZPx: -6048 })
  expect(data.layers[2].alphaMode).toBe('OPAQUE')
  for (const layer of data.layers) {
    expect(layer).not.toHaveProperty('transform')
    expect(layer).not.toHaveProperty('depthRange')
    expect(layer).not.toHaveProperty('origin')
    expect(data.assets.find(asset => asset.id === layer.imageId)).toBeDefined()
  }
  expect(structuredClone(layers)).toEqual(before)
})

test.each(['down', 'up', 'left', 'right'])('%s exports axis-specific surface coordinates with no cached geometry', async direction => {
  const layer = changeOrientation(defaultSettings, initialLayers(defaultSettings)[2], orientationFor(direction))
  const p = layer.placement
  p.centerPx = 123.1234567890123; p.sizePx = 5678.9876543210987
  const data = await createSceneDocument(defaultSettings, [layer], sourcesFor([layer]))
  const wall = direction === 'left' || direction === 'right'
  const placement = data.layers[0].placement
  expect(placement[wall ? 'centerYPx' : 'centerXPx']).toBe(p.centerPx)
  expect(placement[wall ? 'heightPx' : 'widthPx']).toBe(p.sizePx)
  expect(placement.frontZPx).toBe(p.frontZPx)
  expect(placement.backZPx).toBe(p.backZPx)
  expect(Object.keys(placement)).toHaveLength(5)
})

test('reordered, added, hidden and deleted layers retain their list order and only referenced images', async () => {
  const original = initialLayers(defaultSettings), sources = sourcesFor(original)
  const hidden = original[1]; hidden.visible = false
  const added = { ...structuredClone(hidden), id: 'new-image', name: '追加画像' }
  sources.set(added.id, image('追加画像.webp'))
  const layers = [hidden, added, original[0]]
  const data = await createSceneDocument(defaultSettings, layers, sources)
  expect(data.layers.map(layer => layer.id)).toEqual(['layer-2', 'new-image', 'layer-1'])
  expect(data.layers[0].visible).toBe(false)
  expect(data.assets.map(asset => asset.id)).toEqual(data.layers.map(layer => layer.imageId))
  expect(data.assets.some(asset => asset.id === 'image-ground')).toBe(false)
  const empty = await createSceneDocument(defaultSettings, [], sources)
  expect(empty.layers).toEqual([]); expect(empty.assets).toEqual([])
})

test('embedded images preserve actual sample file bytes and original names', async () => {
  const layers = initialLayers(defaultSettings)
  const sources = new Map(), originals = []
  for (const [i, name] of ['background.png', 'foreground.png', 'ground.png'].entries()) {
    const sourceBytes = await readFile(new URL(`../public/samples/${name}`, import.meta.url))
    originals.push(sourceBytes)
    sources.set(layers[i].id, { fileName: name, blob: new Blob([sourceBytes], { type: 'image/png' }) })
  }
  const data = await createSceneDocument(defaultSettings, layers, sources)
  data.assets.forEach((asset, i) => {
    expect(decode(asset)).toEqual(originals[i])
    expect(asset.name).toBe(sources.get(layers[i].id).fileName)
    expect(asset.data.startsWith('data:image/png;base64,')).toBe(true)
  })
})

test.each(['image/png', 'image/jpeg', 'image/webp'])('%s survives base64 chunk boundaries byte for byte', async mimeType => {
  const layer = initialLayers(defaultSettings)[0]
  const buffer = Uint8Array.from({ length: 24576 * 2 + 5 }, (_, i) => i % 256)
  const data = await createSceneDocument(defaultSettings, [layer], new Map([[layer.id, { fileName: '元画像', blob: new Blob([buffer], { type: mimeType }) }]]))
  expect(data.assets[0].mimeType).toBe(mimeType)
  expect(data.assets[0].data.startsWith(`data:${mimeType};base64,`)).toBe(true)
  expect(decode(data.assets[0])).toEqual(Buffer.from(buffer))
})

test('async export captures settings, pixels and image sources together, without rounding or later edits', async () => {
  const settings = { ...defaultSettings }
  let layer = setFrontRect(initialLayers(settings)[0], { x: 123.1234567890123, y: -27.9876543210987, width: 612.3456789012345, height: 456.7890123456789 })
  layer = setFrontDepthPx(layer, -1234.1234567890123, 'screen')
  const before = structuredClone(layer), source = image('保存時.png')
  let release
  const gate = new Promise(resolve => { release = resolve })
  vi.spyOn(source.blob, 'arrayBuffer').mockReturnValue(gate)
  const sources = new Map([[layer.id, source]]), layers = [layer]
  const pending = createSceneDocument(settings, layers, sources)
  settings.fov = 75; layer.placement.rectPx.x = 999; layer.placement.zPx = -500
  layer.name = '変更後'; layer.originPx.x = 100; layers.length = 0
  sources.set(layer.id, image('変更後.png')); source.fileName = '別の名前.png'
  release(bytes.buffer)
  const data = await pending
  expect(data.projectionCamera.fov).toBe(45)
  expect(data.layers[0].name).toBe(before.name)
  expect(data.layers[0].placement).toEqual(before.placement)
  expect(data.layers[0].originPx).toEqual(before.originPx)
  expect(data.assets[0].name).toBe('保存時.png')
  expect(JSON.parse(JSON.stringify(data)).layers[0].placement).toEqual(before.placement)
})

test('missing or unreadable source images fail without changing edited data', async () => {
  const layers = initialLayers(defaultSettings), before = structuredClone(layers)
  await expect(createSceneDocument(defaultSettings, layers, new Map())).rejects.toThrow('元画像')
  const sources = sourcesFor(layers)
  sources.get(layers[0].id).blob = new Blob([], { type: 'image/png' })
  await expect(createSceneDocument(defaultSettings, layers, sources)).rejects.toThrow('画像')
  const broken = new Blob([bytes], { type: 'image/png' })
  vi.spyOn(broken, 'arrayBuffer').mockRejectedValue(new Error('画像の読み出し失敗'))
  sources.get(layers[0].id).blob = broken
  await expect(createSceneDocument(defaultSettings, layers, sources)).rejects.toThrow('読み出し失敗')
  expect(structuredClone(layers)).toEqual(before)
})
