import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { Texture, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { createSceneGlb } from '../src/scene-glb.ts'
import { readGlb } from '../src/glb-container.ts'
import { initialLayers, defaultSettings, referenceMetrics, changeOrientation, orientationFor, createLayerModel, setDepthRange } from '../src/model.ts'
import { centeredCover } from '../src/image-fit.ts'

// GLTFExporter uses FileReader for binary packaging; no browser or canvas is needed here.
beforeAll(() => vi.stubGlobal('FileReader', class {
  readAsArrayBuffer(blob) { void blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.() }) }
}))
afterAll(() => vi.unstubAllGlobals())

async function sourcesFor(layers) {
  const names = ['background.png', 'foreground.png', 'ground.png']
  const sources = new Map()
  for (const [index, layer] of layers.entries()) {
    const name = names[index % names.length], bytes = await readFile(new URL(`../public/samples/${name}`, import.meta.url))
    sources.set(layer.id, { fileName: name, blob: new Blob([bytes], { type: 'image/png' }), image: { width: 1920, height: 1080 } })
  }
  return sources
}

async function loadGeometry(buffer) {
  const loader = new GLTFLoader()
  // Image decoding is deliberately replaced. Parse the real GLB structure, geometry, materials and cameras.
  loader.register(() => ({ name: 'test-image-decoder', loadTexture: () => Promise.resolve(new Texture()) }))
  return loader.parseAsync(buffer, '')
}

test('demo GLB embeds original files byte for byte with unlit materials, alpha modes and camera', async () => {
  const layers = initialLayers(defaultSettings), before = structuredClone(layers), sources = await sourcesFor(layers)
  const buffer = await createSceneGlb(defaultSettings, layers, sources), { json, binary } = readGlb(buffer)
  expect(new DataView(buffer).getUint32(8, true)).toBe(buffer.byteLength)
  expect(buffer.byteLength % 4).toBe(0)
  expect(json.asset.version).toBe('2.0')
  expect(json.images).toHaveLength(3); expect(json.meshes).toHaveLength(3)
  expect(json.cameras).toHaveLength(1)
  expect(json.cameras[0].perspective.yfov).toBeCloseTo(Math.PI / 4, 12)
  expect(json.cameras[0].perspective.aspectRatio).toBeCloseTo(1920 / 1080, 12)
  expect(json.extensionsUsed).toContain('KHR_materials_unlit')
  expect(json.extensionsUsed).not.toContain('EXT_texture_webp')
  expect(json.extensionsUsed).not.toContain('KHR_texture_basisu')
  for (const material of json.materials) {
    expect(material.extensions.KHR_materials_unlit).toEqual({})
    expect(material.alphaMode ?? 'OPAQUE').toBe(layers.find(layer => layer.id === material.name).alphaMode)
    const texture = json.textures[material.pbrMetallicRoughness.baseColorTexture.index]
    const image = json.images[texture.source], view = json.bufferViews[image.bufferView]
    const source = sources.get(material.name)
    expect(image.mimeType).toBe(source.blob.type)
    expect(image.name).toBe(source.fileName)
    expect(binary.slice(view.byteOffset, view.byteOffset + view.byteLength))
      .toEqual(new Uint8Array(await source.blob.arrayBuffer()))
    expect(view.byteOffset % 4).toBe(0)
    expect(json.samplers[texture.sampler]).toMatchObject({ wrapS: 33071, wrapT: 33071, minFilter: 9729, magFilter: 9729 })
  }
  expect(structuredClone(layers)).toEqual(before)
})

test.each([defaultSettings, { ...defaultSettings, width: 1080, height: 1920, fov: 60 }])('Three.js reads exported geometry and its vertex UVs match the projection and cover', async settings => {
  const initial = initialLayers(settings), layers = [initial[0]]
  for (const direction of ['down', 'up', 'left', 'right']) {
    const data = structuredClone(setDepthRange(changeOrientation(settings, initial[2], orientationFor(direction)), 0, -28))
    data.id = direction; data.name = direction
    layers.push(createLayerModel(settings, data))
  }
  const sources = await sourcesFor(layers), buffer = await createSceneGlb(settings, layers, sources)
  const loaded = await loadGeometry(buffer)
  loaded.scene.updateMatrixWorld(true)
  const camera = loaded.cameras[0]
  expect(camera.position.z).toBeCloseTo(referenceMetrics(settings).cameraZ, 10)
  const meshes = []
  loaded.scene.traverse(object => { if (object.isMesh) meshes.push(object) })
  expect(meshes).toHaveLength(layers.length)
  for (const mesh of meshes) {
    const layer = layers.find(layer => layer.id === mesh.material.name)
    expect(layer).toBeDefined()
    const position = mesh.geometry.getAttribute('position'), uv = mesh.geometry.getAttribute('uv')
    const parallel = layer.orientation.relation === 'parallel'
    expect(position.count).toBe(parallel ? 4 : 81)
    expect(mesh.geometry.index.count / 3).toBe(parallel ? 2 : 128)
    if (!parallel) {
      expect(new Set(Array.from({ length: position.count }, (_, i) => position.getX(i))).size).toBe(9)
      expect(new Set(Array.from({ length: position.count }, (_, i) => position.getY(i))).size).toBe(9)
    }
    const center = mesh.getWorldPosition(new Vector3())
    expect(center.x).toBeCloseTo(layer.transform.x, 10)
    expect(center.y).toBeCloseTo(layer.transform.y, 10)
    expect(center.z).toBeCloseTo(layer.transform.z, 10)
    const fit = centeredCover(sources.get(layer.id).image, settings).uv
    for (let index = 0; index < position.count; index++) {
      const point = new Vector3().fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld).project(camera)
      expect(uv.getX(index)).toBeCloseTo((point.x * 0.5 + 0.5) * fit.scaleX + fit.offsetX, 5)
      expect(uv.getY(index)).toBeCloseTo(1 - ((point.y * 0.5 + 0.5) * fit.scaleY + fit.offsetY), 5)
    }
  }
})

test('hidden layers and helpers are excluded; an empty scene still contains the camera', async () => {
  const layers = initialLayers(defaultSettings)
  layers.forEach(layer => { layer.visible = false })
  const { json } = readGlb(await createSceneGlb(defaultSettings, layers, new Map()))
  expect(json.cameras).toHaveLength(1)
  expect(json.meshes ?? []).toEqual([])
  expect(json.images ?? []).toEqual([])
  expect(json.nodes).toHaveLength(1)
  const empty = await loadGeometry(await createSceneGlb(defaultSettings, [], new Map()))
  expect(empty.cameras).toHaveLength(1)
})

test('shared original blobs are embedded once, including existing WebP without conversion', async () => {
  const layers = initialLayers(defaultSettings).slice(0, 2)
  const image = { fileName: 'original.webp', blob: new Blob([new Uint8Array([82, 73, 70, 70, 1, 2, 3])], { type: 'image/webp' }), image: { width: 1920, height: 1080 } }
  const sources = new Map(layers.map(layer => [layer.id, image]))
  const { json, binary } = readGlb(await createSceneGlb(defaultSettings, layers, sources))
  expect(json.images).toHaveLength(1); expect(json.textures).toHaveLength(1)
  expect(json.extensionsRequired).toContain('EXT_texture_webp')
  const texture = json.textures[0], view = json.bufferViews[json.images[texture.extensions.EXT_texture_webp.source].bufferView]
  expect(texture.source).toBeUndefined()
  expect(binary.slice(view.byteOffset, view.byteOffset + view.byteLength)).toEqual(new Uint8Array(await image.blob.arrayBuffer()))
})

test('invalid projection or missing images fail without changing the active authoring data', async () => {
  const layers = initialLayers(defaultSettings), sources = await sourcesFor(layers), before = structuredClone(layers)
  await expect(createSceneGlb(defaultSettings, layers, new Map())).rejects.toThrow('元画像')
  const bad = createLayerModel(defaultSettings, structuredClone(layers[2]))
  bad.placement.frontZPx = 2000
  await expect(createSceneGlb(defaultSettings, [bad], sources)).rejects.toThrow('範囲外')
  expect(structuredClone(layers)).toEqual(before)
})

test('export captures the camera and source image before asynchronous encoding', async () => {
  const settings = { ...defaultSettings }, layers = initialLayers(settings).slice(0, 1), sources = await sourcesFor(layers)
  const source = sources.get(layers[0].id), original = await source.blob.arrayBuffer()
  let release
  const wait = new Promise(resolve => { release = resolve })
  vi.spyOn(source.blob, 'arrayBuffer').mockReturnValue(wait)
  const pending = createSceneGlb(settings, layers, sources)
  settings.fov = 90; layers[0].placement.zPx = -100
  source.fileName = 'changed.png'; sources.clear()
  release(original)
  const { json } = readGlb(await pending)
  expect(json.cameras[0].perspective.yfov).toBeCloseTo(Math.PI / 4, 12)
  expect(json.images[0].name).toBe('background.png')
})
