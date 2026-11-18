import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Scene, Texture, Vector3 } from 'three/webgpu'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { parseProjectionGlb, restoreProjectionAsset, projectionRenderSort } from '../src/glb-projection.ts'
// Only the test harness imports the producer to exercise the real GLB contract.
import { createSceneGlb } from '../src/scene-glb.ts'
import { initialLayers, defaultSettings } from '../src/model.ts'

const key = 'threeLayeredScene'
beforeAll(() => vi.stubGlobal('FileReader', class {
  readAsArrayBuffer(blob) { void blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.() }) }
}))
afterAll(() => vi.unstubAllGlobals())

async function exportedBuffer(settings = defaultSettings) {
  const layers = initialLayers(settings)
  const bytes = await readFile(new URL('../public/samples/ground.png', import.meta.url))
  const sources = new Map(layers.map(layer => [layer.id, { fileName: 'image.png', blob: new Blob([bytes], { type: 'image/png' }), image: { width: 1920, height: 1080 } }]))
  return createSceneGlb(settings, layers, sources)
}

function textureLoader() {
  const loader = new GLTFLoader()
  loader.register(() => ({ name: 'test-texture-decoding', loadTexture: () => {
    const texture = new Texture(); texture.flipY = false; return Promise.resolve(texture)
  } }))
  return loader
}

async function exportedScene(settings = defaultSettings) {
  return (await textureLoader().parseAsync(await exportedBuffer(settings), '')).scene
}

function fixture() {
  const scene = new Scene(), camera = new PerspectiveCamera(45, 16 / 9, 0.01, 100)
  camera.position.z = 6
  scene.userData[key] = { version: 1, role: 'scene', projectionCameraId: 'fixed', composition: { width: 1920, height: 1080 }, rendering: { toneMapping: 'none' }, projection: {
    imageFit: 'cover', imageAlign: 'center', clipDepthRange: 'minus-one-to-one', projectedUvOrigin: 'bottom-left', textureUvOrigin: 'top-left', outsideImage: 'clamp', invalidProjection: 'discard',
  } }
  camera.userData[key] = { version: 1, role: 'projectionCamera', id: 'fixed' }
  scene.add(camera)
  for (const [index, sampling] of [{ mode: 'uv', texCoord: 0 }, { mode: 'camera', cameraId: 'fixed', imageUvScale: [0.5, 1], imageUvOffset: [0.25, 0] }].entries()) {
    const map = new Texture(); map.flipY = false
    const material = new MeshBasicMaterial({ map, transparent: index === 1, opacity: index ? 0.75 : 1 })
    const mesh = new Mesh(new PlaneGeometry(), material)
    mesh.userData[key] = { version: 1, role: 'layer', layerId: `layer-${index}`, listIndex: index, sampling }
    scene.add(mesh)
  }
  return scene
}

test('reusable module depends only on Three.js, without local imports, DOM or viewer UI', async () => {
  const source = await readFile(new URL('../src/glb-projection.ts', import.meta.url), 'utf8')
  const imports = [...source.matchAll(/(?:from\s+|import\s*\()(['"])([^'"]+)\1/g)].map(match => match[2])
  expect(imports.length).toBeGreaterThan(0)
  expect(imports.every(name => name === 'three' || name.startsWith('three/'))).toBe(true)
  expect(source).not.toMatch(/\b(?:document|window|requestAnimationFrame|ResizeObserver)\b|import\.meta/)
})

test.each([defaultSettings, { ...defaultSettings, width: 1080, height: 1920, fov: 60 }])('restores actual exported GLB using extras alone, preserving UV and texture identity', async settings => {
  const scene = await exportedScene(settings), asset = restoreProjectionAsset(scene)
  try {
    expect(asset.composition).toEqual({ width: settings.width, height: settings.height })
    expect(asset.bindings).toHaveLength(3)
    expect(asset.camera.userData[key].role).toBe('projectionCamera')
    for (const binding of asset.bindings) {
      expect(binding.projected.map).toBe(binding.original.map)
      expect(binding.projected.transparent).toBe(binding.original.transparent)
      expect(binding.projected.opacity).toBe(binding.original.opacity)
      expect(binding.projected.side).toBe(binding.original.side)
      expect(binding.projected.depthWrite).toBe(!binding.original.transparent)
      expect(binding.projected.toneMapped).toBe(false)
      const positions = binding.mesh.geometry.getAttribute('position'), uv = binding.mesh.geometry.getAttribute('uv')
      const sampling = binding.info.sampling
      if (sampling.mode === 'camera') {
        for (let i = 0; i < positions.count; i++) {
          const point = new Vector3().fromBufferAttribute(positions, i).applyMatrix4(binding.mesh.matrixWorld).applyMatrix4(asset.matrix)
          const u = (point.x * 0.5 + 0.5) * sampling.imageUvScale[0] + sampling.imageUvOffset[0]
          const v = 1 - ((point.y * 0.5 + 0.5) * sampling.imageUvScale[1] + sampling.imageUvOffset[1])
          expect(u).toBeCloseTo(uv.getX(i), 5); expect(v).toBeCloseTo(uv.getY(i), 5)
        }
      } else expect(sampling).toEqual({ mode: 'uv', texCoord: 0 })
    }
    const before = asset.camera.matrixWorld.clone()
    asset.setMode('tsl'); asset.bindings.forEach(binding => expect(binding.mesh.material).toBe(binding.projected))
    const display = asset.camera.clone(); display.position.x += 10
    asset.updateProjection()
    expect(asset.camera.matrixWorld.elements).toEqual(before.elements)
    asset.setMode('standard'); asset.bindings.forEach(binding => expect(binding.mesh.material).toBe(binding.original))
  } finally { asset.dispose() }
})

test('projection follows the asset world transform and is independent of display-camera changes', () => {
  const scene = fixture(), asset = restoreProjectionAsset(scene)
  try {
    const before = asset.matrix.clone()
    const mesh = asset.bindings[1].mesh
    const local = new Vector3(0.12, 0.34, 0)
    const expected = local.clone().applyMatrix4(mesh.matrixWorld).applyMatrix4(before)
    scene.position.set(13, -2, 7); scene.rotation.y = 0.4; scene.scale.setScalar(2)
    asset.updateProjection()
    const result = local.clone().applyMatrix4(mesh.matrixWorld).applyMatrix4(asset.matrix)
    expect(result.x).toBeCloseTo(expected.x, 10); expect(result.y).toBeCloseTo(expected.y, 10)
    expect(asset.camera.coordinateSystem).toBe(2000)
    expect(asset.matrix.elements).not.toEqual(new Matrix4().elements)
  } finally { asset.dispose() }
})

test.each([
  ['version', scene => { scene.userData[key].version = 2 }],
  ['missing scene metadata', scene => { delete scene.userData[key] }],
  ['invalid composition', scene => { scene.userData[key].composition.width = Infinity }],
  ['unsupported projection', scene => { scene.userData[key].projection.textureUvOrigin = 'bottom-left' }],
  ['tone mapping', scene => { scene.userData[key].rendering.toneMapping = 'aces' }],
  ['camera reference', scene => { scene.userData[key].projectionCameraId = 'missing' }],
  ['camera settings', scene => { scene.children[0].near = -1 }],
  ['layer version', scene => { scene.children[1].userData[key].version = 99 }],
  ['missing layer metadata', scene => { delete scene.children[1].userData[key] }],
  ['sampling mode', scene => { scene.children[1].userData[key].sampling.mode = 'other' }],
  ['sampling camera reference', scene => { scene.children[2].userData[key].sampling.cameraId = 'missing' }],
  ['UV scale', scene => { scene.children[2].userData[key].sampling.imageUvScale[0] = NaN }],
  ['duplicate layer ID', scene => { scene.children[2].userData[key].layerId = 'layer-0' }],
  ['duplicate list index', scene => { scene.children[2].userData[key].listIndex = 0 }],
  ['missing texture', scene => { scene.children[1].material.map = null }],
  ['unexpected flip', scene => { scene.children[1].material.map.flipY = true }],
])('rejects invalid %s before replacing any material', (_, mutate) => {
  const scene = fixture(), original = scene.children.filter(node => node.isMesh).map(mesh => mesh.material)
  mutate(scene)
  expect(() => restoreProjectionAsset(scene)).toThrow()
  expect(scene.children.filter(node => node.isMesh).map(mesh => mesh.material)).toEqual(original)
})

test('disposal restores original materials and leaves borrowed textures alive', () => {
  const asset = restoreProjectionAsset(fixture()), disposeTexture = vi.spyOn(asset.bindings[0].original.map, 'dispose')
  const projectedDisposals = asset.bindings.map(binding => vi.spyOn(binding.projected, 'dispose'))
  asset.setMode('tsl'); asset.dispose()
  asset.bindings.forEach(binding => expect(binding.mesh.material).toBe(binding.original))
  projectedDisposals.forEach(dispose => expect(dispose).toHaveBeenCalledOnce())
  expect(disposeTexture).not.toHaveBeenCalled()
})

test('sorting uses depth first and published list order only at equal depth', () => {
  const scene = fixture(), a = { id: 2, groupOrder: 0, renderOrder: 0, z: 0.5, object: scene.children[1] }
  const b = { ...a, id: 1, object: scene.children[2] }
  expect([b, a].sort(projectionRenderSort(true))).toEqual([a, b])
  b.z = 0.7
  expect([a, b].sort(projectionRenderSort(true))).toEqual([b, a])
  expect([b, a].sort(projectionRenderSort(false))).toEqual([a, b])
})

function glbHeader() {
  const data = new ArrayBuffer(12), view = new DataView(data)
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, data.byteLength, true)
  return data
}

test('buffer API loads and applies TSL without any renderer, DOM or viewer state', async () => {
  const scene = fixture(), loader = { parseAsync: vi.fn(async () => ({ scene })) }
  const asset = await parseProjectionGlb(glbHeader(), { loader })
  const parent = new Scene(); parent.add(asset.scene)
  const texture = asset.bindings[0].original.map
  const textureDispose = vi.spyOn(texture, 'dispose')
  const geometryDispose = vi.spyOn(asset.bindings[0].mesh.geometry, 'dispose')
  const originalDispose = vi.spyOn(asset.bindings[0].original, 'dispose')
  const generatedDispose = vi.spyOn(asset.bindings[0].projected, 'dispose')
  expect(loader.parseAsync).toHaveBeenCalledWith(expect.any(ArrayBuffer), '')
  asset.bindings.forEach(binding => expect(binding.mesh.material).toBe(binding.projected))
  asset.setMode('standard'); asset.setMode('tsl')
  asset.dispose(); asset.dispose()
  expect(asset.scene.parent).toBeNull()
  expect(textureDispose).toHaveBeenCalledOnce(); expect(geometryDispose).toHaveBeenCalledOnce()
  expect(originalDispose).toHaveBeenCalledOnce(); expect(generatedDispose).toHaveBeenCalledOnce()
  expect(() => asset.setMode('tsl')).toThrow('解放済み')
  expect(() => asset.updateProjection()).toThrow('解放済み')
})

test('buffer API cleans loaded resources when extras validation fails', async () => {
  const scene = fixture(), loader = { parseAsync: vi.fn(async () => ({ scene })) }
  const meshes = scene.children.filter(object => object.isMesh)
  const disposals = meshes.flatMap(mesh => [vi.spyOn(mesh.material, 'dispose'), vi.spyOn(mesh.material.map, 'dispose'), vi.spyOn(mesh.geometry, 'dispose')])
  scene.userData[key].version = 99
  await expect(parseProjectionGlb(glbHeader(), { loader })).rejects.toThrow('未対応')
  disposals.forEach(dispose => expect(dispose).toHaveBeenCalledOnce())
})

test('buffer API rejects invalid headers before starting a loader', async () => {
  const loader = { parseAsync: vi.fn() }
  for (const data of [new ArrayBuffer(0), new ArrayBuffer(12)]) await expect(parseProjectionGlb(data, { loader })).rejects.toThrow('GLB')
  const invalidVersion = glbHeader(); new DataView(invalidVersion).setUint32(4, 1, true)
  await expect(parseProjectionGlb(invalidVersion, { loader })).rejects.toThrow('GLB')
  expect(loader.parseAsync).not.toHaveBeenCalled()
})

test('borrowed-scene disposal is idempotent and never frees caller-owned resources', () => {
  const scene = fixture(), parent = new Scene(); parent.add(scene)
  const asset = restoreProjectionAsset(scene)
  const mesh = asset.bindings[0].mesh
  const originalDispose = vi.spyOn(asset.bindings[0].original, 'dispose'), geometryDispose = vi.spyOn(mesh.geometry, 'dispose')
  const generatedDispose = vi.spyOn(asset.bindings[0].projected, 'dispose')
  asset.setMode('tsl'); asset.dispose(); asset.dispose()
  expect(scene.parent).toBe(parent)
  expect(originalDispose).not.toHaveBeenCalled(); expect(geometryDispose).not.toHaveBeenCalled()
  expect(generatedDispose).toHaveBeenCalledOnce()
})


test('public buffer API consumes a real producer GLB with a configured Three.js loader', async () => {
  const asset = await parseProjectionGlb(await exportedBuffer(), { loader: textureLoader() })
  try {
    expect(asset.bindings).toHaveLength(3)
    expect(asset.composition).toEqual({ width: 1920, height: 1080 })
    expect(asset.camera.userData[key].role).toBe('projectionCamera')
    asset.bindings.forEach(binding => expect(binding.mesh.material).toBe(binding.projected))
    asset.updateProjection()
    expect(asset.matrix.elements.every(Number.isFinite)).toBe(true)
  } finally { asset.dispose() }
})
