import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Scene, Texture, Vector3 } from 'three/webgpu'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { applyCameraProjection } from '../src/glb-projection.ts'
// Only the test harness imports the producer to exercise the real GLB contract.
import { createSceneGlb } from '../src/scene-glb.ts'
import { initialLayers, defaultSettings } from '../src/model.ts'

// Observe values passed to Three.js uniforms without exposing them through the consumer API.
const matrixUniforms = vi.hoisted(() => [])
vi.mock('three/tsl', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, uniform(value, ...args) {
    const node = actual.uniform(value, ...args)
    if (value?.isMatrix4) matrixUniforms.push(node)
    return node
  } }
})

function meshStates(scene) {
  const result = []
  scene.traverse(object => { if (object.isMesh) result.push({ mesh: object, original: object.material }) })
  return result
}
function observeProjection(scene) {
  const start = matrixUniforms.length
  const projection = applyCameraProjection(scene)
  const uniforms = matrixUniforms.slice(start)
  expect(uniforms.length).toBeGreaterThan(0)
  return { projection, uniforms }
}

const key = 'threeLayeredScene'
beforeAll(() => vi.stubGlobal('FileReader', class {
  readAsArrayBuffer(blob) { void blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.() }) }
}))
afterAll(() => vi.unstubAllGlobals())

async function exportedBuffer(settings = defaultSettings, expanded = false) {
  const layers = initialLayers(settings)
  if (expanded) layers.forEach((layer, i) => { layer.framePx = { width: settings.width * (i === 1 ? 1 : 1.25), height: settings.height * 1.4 } })
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

async function exportedScene(settings = defaultSettings, expanded = false) {
  return (await textureLoader().parseAsync(await exportedBuffer(settings, expanded), '')).scene
}

function fixture() {
  const scene = new Scene(), camera = new PerspectiveCamera(45, 16 / 9, 0.01, 100)
  camera.position.z = 6
  scene.userData[key] = { version: 2, role: 'scene', projectionCameraId: 'fixed', composition: { width: 1920, height: 1080 }, rendering: { toneMapping: 'none' }, projection: {
    imageFit: 'cover', imageAlign: 'center', clipDepthRange: 'minus-one-to-one', projectedUvOrigin: 'bottom-left', textureUvOrigin: 'top-left', outsideImage: 'clamp', invalidProjection: 'discard',
  } }
  camera.userData[key] = { version: 2, role: 'projectionCamera', id: 'fixed' }
  scene.add(camera)
  for (const [index, sampling] of [{ mode: 'uv', texCoord: 0 }, { mode: 'camera', cameraId: 'fixed', imageUvScale: [0.5, 1], imageUvOffset: [0.25, 0] }].entries()) {
    const map = new Texture(); map.flipY = false
    const material = new MeshBasicMaterial({ map, transparent: index === 1, opacity: index ? 0.75 : 1 })
    const mesh = new Mesh(new PlaneGeometry(), material)
    mesh.userData[key] = { version: 2, role: 'layer', layerId: `layer-${index}`, listIndex: index, framePx: { width: 1920, height: 1080 }, sampling }
    scene.add(mesh)
  }
  return scene
}

test('reusable module depends only on Three.js, without local imports, Loader, DOM or viewer UI', async () => {
  const source = await readFile(new URL('../src/glb-projection.ts', import.meta.url), 'utf8')
  const imports = [...source.matchAll(/(?:from\s+|import\s*\()(['"])([^'"]+)\1/g)].map(match => match[2])
  expect(imports.length).toBeGreaterThan(0)
  expect(imports.every(name => name === 'three' || name.startsWith('three/'))).toBe(true)
  expect(source).not.toMatch(/\b(?:document|window|requestAnimationFrame|ResizeObserver|GLTFLoader)\b|import\.meta/)
})

test.each([[defaultSettings, false], [{ ...defaultSettings, width: 1080, height: 1920, fov: 60 }, false],
  [{ ...defaultSettings, width: 65536, height: 32768 }, false], [defaultSettings, true]])('applies actual exported GLB using extras alone, preserving UV and texture identity (expanded=%s)', async (settings, expanded) => {
  const scene = await exportedScene(settings, expanded), states = meshStates(scene)
  const { projection, uniforms } = observeProjection(scene)
  try {
    expect(projection.composition).toEqual({ width: settings.width, height: settings.height })
    expect(states).toHaveLength(3)
    expect(projection.camera.userData[key].role).toBe('projectionCamera')
    for (const { mesh, original } of states) {
      expect(mesh.material.isMeshBasicNodeMaterial).toBe(true)
      expect(mesh.material.map).toBe(original.map)
      expect(mesh.material.transparent).toBe(original.transparent)
      expect(mesh.material.opacity).toBe(original.opacity)
      expect(mesh.material.side).toBe(original.side)
      expect(mesh.material.depthWrite).toBe(!original.transparent)
      expect(mesh.material.toneMapped).toBe(false)
      const positions = mesh.geometry.getAttribute('position'), uv = mesh.geometry.getAttribute('uv')
      const sampling = mesh.userData[key].sampling
      if (sampling.mode === 'camera') {
        for (let i = 0; i < positions.count; i++) {
          const point = new Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(uniforms[0].value)
          const u = (point.x * 0.5 + 0.5) * sampling.imageUvScale[0] + sampling.imageUvOffset[0]
          const v = 1 - ((point.y * 0.5 + 0.5) * sampling.imageUvScale[1] + sampling.imageUvOffset[1])
          expect(u).toBeCloseTo(uv.getX(i), 5); expect(v).toBeCloseTo(uv.getY(i), 5)
        }
      } else expect(sampling).toEqual({ mode: 'uv', texCoord: 0 })
    }
    const before = projection.camera.matrixWorld.clone()
    const display = projection.camera.clone(); display.position.x += 10
    projection.updateProjection()
    expect(projection.camera.matrixWorld.elements).toEqual(before.elements)
  } finally { projection.dispose() }
})

test('projection uniforms follow asset transforms independently of display-camera changes', () => {
  const scene = fixture(), mesh = meshStates(scene)[1].mesh
  const { projection, uniforms } = observeProjection(scene)
  try {
    const before = uniforms[0].value.clone(), local = new Vector3(0.12, 0.34, 0)
    const expected = local.clone().applyMatrix4(mesh.matrixWorld).applyMatrix4(before)
    scene.position.set(13, -2, 7); scene.rotation.y = 0.4; scene.scale.setScalar(2)
    projection.updateProjection()
    for (const uniform of uniforms) {
      const result = local.clone().applyMatrix4(mesh.matrixWorld).applyMatrix4(uniform.value)
      expect(result.x).toBeCloseTo(expected.x, 10); expect(result.y).toBeCloseTo(expected.y, 10)
      expect(uniform.value.elements).not.toEqual(new Matrix4().elements)
    }
    expect(projection.camera.coordinateSystem).toBe(2000)
  } finally { projection.dispose() }
})

test.each([
  ['version', scene => { scene.userData[key].version = 1 }],
  ['missing scene metadata', scene => { delete scene.userData[key] }],
  ['invalid composition', scene => { scene.userData[key].composition.width = Infinity }],
  ['unsupported projection', scene => { scene.userData[key].projection.textureUvOrigin = 'bottom-left' }],
  ['tone mapping', scene => { scene.userData[key].rendering.toneMapping = 'aces' }],
  ['camera reference', scene => { scene.userData[key].projectionCameraId = 'missing' }],
  ['camera settings', scene => { scene.children[0].near = -1 }],
  ['old camera version', scene => { scene.children[0].userData[key].version = 1 }],
  ['old layer version', scene => { scene.children[1].userData[key].version = 1 }],
  ['missing frame', scene => { delete scene.children[1].userData[key].framePx }],
  ['invalid frame', scene => { scene.children[1].userData[key].framePx.height = 0 }],
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
  expect(() => applyCameraProjection(scene)).toThrow()
  expect(scene.children.filter(node => node.isMesh).map(mesh => mesh.material)).toEqual(original)
})

test('disposal restores original materials and leaves borrowed textures alive', () => {
  const scene = fixture(), states = meshStates(scene)
  const disposeTexture = vi.spyOn(states[0].original.map, 'dispose')
  const projection = applyCameraProjection(scene)
  const projectedDisposals = states.map(({ mesh }) => vi.spyOn(mesh.material, 'dispose'))
  projection.dispose()
  states.forEach(({ mesh, original }) => expect(mesh.material).toBe(original))
  projectedDisposals.forEach(dispose => expect(dispose).toHaveBeenCalledOnce())
  expect(disposeTexture).not.toHaveBeenCalled()
})

test('borrowed-scene disposal is idempotent and never frees caller-owned resources', () => {
  const scene = fixture(), parent = new Scene(); parent.add(scene)
  const { mesh, original } = meshStates(scene)[0]
  const originalDispose = vi.spyOn(original, 'dispose'), geometryDispose = vi.spyOn(mesh.geometry, 'dispose')
  const projection = applyCameraProjection(scene), generatedDispose = vi.spyOn(mesh.material, 'dispose')
  projection.dispose(); projection.dispose()
  expect(scene.parent).toBe(parent)
  expect(originalDispose).not.toHaveBeenCalled(); expect(geometryDispose).not.toHaveBeenCalled()
  expect(generatedDispose).toHaveBeenCalledOnce()
})

test('public API exposes only scene, fixed camera, composition, update and disposal', () => {
  const scene = fixture(), states = meshStates(scene), projection = applyCameraProjection(scene)
  expect(Object.keys(projection).sort()).toEqual(['scene', 'camera', 'composition', 'updateProjection', 'dispose'].sort())
  states.forEach(({ mesh }) => expect(mesh.material.isMeshBasicNodeMaterial).toBe(true))
  const textureDispose = vi.spyOn(states[0].original.map, 'dispose')
  projection.dispose()
  expect(textureDispose).not.toHaveBeenCalled()
  expect(() => projection.updateProjection()).toThrow('解放済み')
})
