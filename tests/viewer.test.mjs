import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Scene, Texture, Vector3 } from 'three/webgpu'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { restoreProjectionAsset, viewerRenderSort } from '../src/viewer.ts'
// Only the test harness imports the producer to exercise the real GLB contract.
import { createSceneGlb } from '../src/scene-glb.ts'
import { initialLayers, defaultSettings } from '../src/model.ts'

const key = 'threeLayeredScene'
beforeAll(() => vi.stubGlobal('FileReader', class {
  readAsArrayBuffer(blob) { void blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.() }) }
}))
afterAll(() => vi.unstubAllGlobals())

async function exportedScene(settings = defaultSettings) {
  const layers = initialLayers(settings)
  const bytes = await readFile(new URL('../public/samples/ground.png', import.meta.url))
  const sources = new Map(layers.map(layer => [layer.id, { fileName: 'image.png', blob: new Blob([bytes], { type: 'image/png' }), image: { width: 1920, height: 1080 } }]))
  const buffer = await createSceneGlb(settings, layers, sources)
  const loader = new GLTFLoader()
  loader.register(() => ({ name: 'test-texture-decoding', loadTexture: () => {
    const texture = new Texture(); texture.flipY = false; return Promise.resolve(texture)
  } }))
  return (await loader.parseAsync(buffer, '')).scene
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

test('viewer imports only Three.js and no editor module, including type imports', async () => {
  const source = await readFile(new URL('../src/viewer.ts', import.meta.url), 'utf8')
  const imports = [...source.matchAll(/(?:from\s+|import\s*\()(['"])([^'"]+)\1/g)].map(match => match[2])
  expect(imports.length).toBeGreaterThan(0)
  expect(imports.every(name => name === 'three' || name.startsWith('three/'))).toBe(true)
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
  expect([b, a].sort(viewerRenderSort(true))).toEqual([a, b])
  b.z = 0.7
  expect([a, b].sort(viewerRenderSort(true))).toEqual([b, a])
  expect([b, a].sort(viewerRenderSort(false))).toEqual([a, b])
})
