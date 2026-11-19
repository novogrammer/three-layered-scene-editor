import './style.css'
import * as THREE from 'three/webgpu'
import { Editor } from './editor'
import { loadDemoImages } from './demo'
import { createSceneDocument } from './scene-json'
import { MAX_SCENE_JSON_BYTES, prepareSceneImport } from './scene-import'
import { createSceneGlb } from './scene-glb'
import type { ImageSource } from './scene-json'
import { imageAspectNotice } from './image-aspect'
import { centeredCover } from './image-fit'
import { compositionLayers, createLayer, MAX_LAYERS, moveLayer, removeLayer } from './layer-collection'
import { changeOrientation, defaultSettings, initialLayers, moveOrigin, moveOriginPx, setFrontDepth, setFrontDepthPx, setFrontRect, reconfigureScene, referenceMetrics, isWall, orientationFor, planeDirections, planeRelations, surfacePlacementValues, setSurfacePlacementValue } from './model'
import type { DiagnosticMode } from './projection'
import type { Layer, PlacementPolicy, PlacementUnit, PlaneDirection, SceneSettings } from './model'

const app = document.querySelector<HTMLDivElement>('#app')!
const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
let settings = { ...defaultSettings }
let layers = initialLayers(settings)
let selectedId: string | null = layers[0]?.id ?? null
let adding = false
let saving = false
let loading = false
let exportingGlb = false
let sceneRevision = 0
let depthPolicy: PlacementPolicy = 'screen'
let alive = true
const source = get<HTMLCanvasElement>('source')
interface LayerAsset extends ImageSource { image: HTMLImageElement; texture: THREE.Texture }
let assets = new Map<string, LayerAsset>()
const imageRequests = new Map<string, symbol>()
const textureMap = () => new Map([...assets].map(([id, asset]) => [id, asset.texture]))

function replaceLayer(updated: Layer) {
  layers = layers.map(layer => layer.id === updated.id ? updated : layer)
}
let editor: Editor

function makeTexture(image: HTMLImageElement) {
  const texture = new THREE.Texture(image)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

function makeLayerAsset(source: ImageSource & { image: HTMLImageElement }): LayerAsset {
  return { ...source, texture: makeTexture(source.image) }
}

function status(message: string, error = false) {
  const element = get('status')
  element.textContent = message
  element.classList.toggle('error', error)
}

function compare() {
  // Comparison is an input composition, not a second render of the 3D geometry.
  const scale = Math.min(1, 2048 / Math.max(settings.width, settings.height))
  source.width = Math.max(1, Math.round(settings.width * scale))
  source.height = Math.max(1, Math.round(settings.height * scale))
  const ctx = source.getContext('2d')!
  ctx.fillStyle = '#17212a'
  ctx.fillRect(0, 0, source.width, source.height)
  for (const layer of compositionLayers(layers)) {
    if (!layer.visible) continue
    const image = assets.get(layer.id)!.image
    const crop = centeredCover({ width: image.naturalWidth, height: image.naturalHeight }, settings).source
    ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, source.width, source.height)
  }
}

function fitStages() {
  const aspect = settings.width / settings.height
  for (const id of ['preview-stage', 'source-stage']) {
    const stage = get(id)
    const parent = stage.parentElement!
    const width = Math.min(parent.clientWidth, parent.clientHeight * aspect)
    stage.style.width = `${Math.max(1, width)}px`
    stage.style.height = `${Math.max(1, width / aspect)}px`
  }
  editor?.requestRender()
}

function updateSceneView(updateEditor = true) {
  editor.selectedId = selectedId
  if (updateEditor) editor.update(settings, layers, textureMap())
  const metrics = referenceMetrics(settings)
  get('camera-info').textContent = `基準平面 ${metrics.width.toFixed(3)} × ${metrics.height.toFixed(3)} / カメラZ +${metrics.cameraZ.toFixed(3)}`
  const warning = layers.some((layer) => layer.transform.z >= metrics.cameraZ - metrics.near)
  if (warning) status('カメラに近すぎるPlaneがあります。FOVを狭くするか、Planeを奥へ移動してください。', true)
  compare()
  fitStages()
}

function renderLayerUI() {
  renderList()
  renderPanel()
}

function refreshScene() {
  refreshAppearance()
  renderPanel()
}

// Keep the current inputs alive while changing visibility, color or material.
function refreshAppearance() {
  updateSceneView()
  renderList()
}

function refreshSelection() {
  editor.selectedId = selectedId
  renderLayerUI()
  editor.requestRender()
}

function renderList() {
  const list = get('layer-list')
  list.replaceChildren()
  layers.forEach((layer) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `layer-item ${layer.id === selectedId ? 'selected' : ''}`
    button.setAttribute('aria-pressed', String(layer.id === selectedId))
    const dot = document.createElement('span')
    dot.className = 'layer-dot'
    dot.style.background = layer.editorColor
    const name = document.createElement('span')
    name.textContent = layer.name
    const detail = document.createElement('small')
    detail.textContent = layer.visible ? planeDirections[layer.orientation.direction] : '非表示'
    button.append(dot, name, detail)
    button.onclick = () => {
      selectedId = layer.id
      refreshSelection()
    }
    list.append(button)
  })
  updateAddButton()
}

function numberField(parent: HTMLElement, label: string, value: number, onChange: (value: number) => void,
  min = -1000, max = 1000, step = 'any') {
  const wrapper = document.createElement('label')
  wrapper.textContent = label
  const input = document.createElement('input')
  input.type = 'number'
  input.value = String(Number(value.toFixed(4)))
  input.min = String(min); input.max = String(max); input.step = step
  input.required = true
  wrapper.append(input); parent.append(wrapper)
  input.onchange = () => {
    if (!input.reportValidity() || !Number.isFinite(input.valueAsNumber)) return
    try {
      onChange(input.valueAsNumber)
      refreshScene()
    } catch (error) {
      status(error instanceof Error ? error.message : '入力値を確認してください。', true)
      renderPanel()
    }
  }
  return input
}

function coordinateHint(parent: HTMLElement, text: string, id: string, inputs: HTMLInputElement[]) {
  const hint = document.createElement('span')
  hint.id = id; hint.className = 'coordinate-hint'; hint.textContent = text
  parent.append(hint)
  inputs.forEach(input => input.setAttribute('aria-describedby', id))
}

function renderPanel() {
  const layer = layers.find(layer => layer.id === selectedId)
  const panel = get('layer-panel')
  const expanded3D = panel.querySelector<HTMLDetailsElement>('details[data-placement-3d]')?.open ?? false
  panel.replaceChildren()
  panel.hidden = !layer
  if (!layer) return
  const asset = assets.get(layer.id)!
  const heading = document.createElement('div'); heading.className = 'panel-heading'
  const deleteButton = document.createElement('button'); deleteButton.type = 'button'; deleteButton.textContent = '削除'
  deleteButton.onclick = () => deleteLayer(layer.id)
  const title = document.createElement('h2'); title.textContent = layer.name
  heading.append(title, deleteButton); panel.append(heading)
  const orderControls = document.createElement('div'); orderControls.className = 'layer-order'
  const index = layers.findIndex(item => item.id === layer.id)
  for (const [offset, label] of [[-1, '上へ'], [1, '下へ']] as const) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label
    button.disabled = offset === -1 ? index === 0 : index === layers.length - 1
    button.onclick = () => {
      layers = moveLayer(layers, layer.id, offset)
      refreshScene()
    }
    orderControls.append(button)
  }
  panel.append(orderControls)
  const change = (direction: PlaneDirection) => {
    try {
      replaceLayer(changeOrientation(settings, layer, orientationFor(direction)))
      refreshScene()
      status('')
    } catch (error) {
      status(error instanceof Error ? error.message : '面の向きを変更できませんでした。', true)
      renderPanel()
    }
  }
  const relationLabel = document.createElement('label'); relationLabel.textContent = '基準面との関係'
  const relation = document.createElement('select')
  for (const [value, name] of Object.entries(planeRelations)) {
    const option = document.createElement('option'); option.value = value; option.textContent = name
    relation.append(option)
  }
  relation.value = layer.orientation.relation
  relation.onchange = () => change(relation.value === 'parallel' ? 'front' : 'down')
  relationLabel.append(relation); panel.append(relationLabel)
  if (layer.orientation.relation === 'perpendicular') {
    const directionLabel = document.createElement('label'); directionLabel.textContent = '向き'
    const direction = document.createElement('select')
    direction.title = '配置する側の向きです。下は地面、上は天井、左右は壁。位置は基準点で指定します。'
    for (const [value, name] of Object.entries(planeDirections)) {
      if (value === 'front') continue
      const option = document.createElement('option'); option.value = value; option.textContent = name
      direction.append(option)
    }
    direction.value = layer.orientation.direction
    direction.onchange = () => change(direction.value as PlaneDirection)
    directionLabel.append(direction); panel.append(directionLabel)
  }
  const fileLabel = document.createElement('label'); fileLabel.textContent = '画像'
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp'; input.title = 'PNG / JPEG / WebP、32MB以下'
  fileLabel.append(input); panel.append(fileLabel)
  const fileInfo = document.createElement('p'); fileInfo.className = 'asset-name'; fileInfo.textContent = `${asset.fileName} / ${asset.image.width} × ${asset.image.height}`
  panel.append(fileInfo)
  const image = asset.image
  const aspectMessage = imageAspectNotice({ width: image.naturalWidth, height: image.naturalHeight }, settings)
  if (aspectMessage) {
    const notice = document.createElement('p')
    notice.id = 'image-aspect-notice'
    notice.className = 'image-notice'
    notice.setAttribute('role', 'status')
    notice.textContent = aspectMessage
    input.setAttribute('aria-describedby', notice.id)
    panel.append(notice)
  }
  input.onchange = () => { const file = input.files?.[0]; if (file) void loadImage(file, layer.id) }
  const row = document.createElement('div'); row.className = 'layer-options'
  const visibleLabel = document.createElement('label'); visibleLabel.className = 'inline-check'
  const visible = document.createElement('input'); visible.type = 'checkbox'; visible.checked = layer.visible
  visibleLabel.append(visible, '表示')
  visible.onchange = () => { layer.visible = visible.checked; refreshAppearance() }
  const colorLabel = document.createElement('label'); colorLabel.className = 'inline-check'; colorLabel.textContent = '識別色'
  const color = document.createElement('input'); color.type = 'color'; color.value = layer.editorColor
  colorLabel.append(color)
  color.oninput = () => { layer.editorColor = color.value; refreshAppearance() }
  row.append(visibleLabel, colorLabel); panel.append(row)
  const modeLabel = document.createElement('label'); modeLabel.textContent = 'マテリアル'
  const mode = document.createElement('select')
  mode.innerHTML = '<option value="BLEND">透過</option><option value="OPAQUE">不透明</option>'
  mode.value = layer.alphaMode
  mode.onchange = () => { layer.alphaMode = mode.value as Layer['alphaMode']; refreshAppearance() }
  modeLabel.append(mode); panel.append(modeLabel)
  const metrics = referenceMetrics(settings)
  const parallel = layer.orientation.relation === 'parallel'

  function placementFields(parent: HTMLElement, unit: PlacementUnit) {
    const px = unit === 'px', factor = px ? 1 / metrics.scale : 1
    const grid = document.createElement('div'); grid.className = 'pair'; parent.append(grid)
    if (parallel) {
      if (layer!.placement.type !== 'screen') throw new Error('正面レイヤーの配置方式が一致していません。')
      const rect = layer!.placement.rectPx
      for (const [key, name] of [['x', px ? 'X' : '位置X'], ['y', px ? 'Y' : '位置Y'], ['width', '幅'], ['height', '高さ']] as const) {
        const input = numberField(grid, name, px ? rect[key] : layer!.transform[key], value => {
          if (px) replaceLayer(setFrontRect(layer!, { ...rect, [key]: value }))
          else layer!.transform[key] = value
        }, key === 'width' || key === 'height' ? (px ? 0 : 0.01) : (px ? -Number.MAX_SAFE_INTEGER : -500),
        px ? Number.MAX_SAFE_INTEGER : 500)
        input.setAttribute('aria-label', `${px ? '2D配置' : '3D配置'} ${name} ${px ? 'px' : 'シーン単位'}`)
      }
      if (px) {
        const label = document.createElement('label'); label.textContent = 'Z変更時の配置'
        const select = document.createElement('select')
        select.innerHTML = '<option value="screen">2D配置を保持</option><option value="world">3D配置を保持</option>'
        select.title = '2D配置の保持は、基準カメラから見た位置とサイズを維持します。'
        select.value = depthPolicy; select.onchange = () => { depthPolicy = select.value as PlacementPolicy }
        label.append(select); parent.append(label)
      }
      const zInput = numberField(parent, '奥行きZ', px ? layer!.placement.zPx : layer!.transform.z, value => {
        replaceLayer(px ? setFrontDepthPx(layer!, value, depthPolicy) : setFrontDepth(layer!, value, depthPolicy))
      }, -500 * factor, (metrics.cameraZ - metrics.near - 0.001) * factor)
      zInput.setAttribute('aria-label', `奥行きZ ${px ? 'px相当' : 'シーン単位'}`)
      coordinateHint(zInput.parentElement!, '基準面 Z = 0', `reference-z-${unit}`, [zInput])
    } else {
      const values = surfacePlacementValues(layer!, unit), wall = isWall(layer!)
      for (const [key, name] of [['center', wall ? '中心Y' : '中心X'], ['size', wall ? '高さ' : '幅'],
        ['frontZ', '手前端Z'], ['backZ', '奥端Z']] as const) {
        const depth = key === 'frontZ' || key === 'backZ'
        const input = numberField(grid, name, values[key], value => {
          replaceLayer(setSurfacePlacementValue(layer!, unit, key, value))
        }, (key === 'size' ? 0.01 : depth ? -1000 : -500) * factor, (depth ? 1000 : 500) * factor)
        input.setAttribute('aria-label', `${name} ${px ? 'px相当' : 'シーン単位'}`)
      }
      const depthInputs = [...grid.querySelectorAll<HTMLInputElement>('input')].slice(2)
      coordinateHint(grid, '基準面 Z = 0', `reference-z-${unit}`, depthInputs)
    }
  }

  function originFields(parent: HTMLElement, unit: PlacementUnit) {
    const px = unit === 'px', factor = px ? 1 / metrics.scale : 1
    const title = document.createElement('h2'); title.textContent = px ? '配置基準点 · px' : '配置基準点'
    title.title = '基準点を動かすと、面も同じ量だけ移動します。Zは0です。'
    parent.append(title)
    const grid = document.createElement('div'); grid.className = 'pair'; parent.append(grid)
    const inputs: HTMLInputElement[] = []
    for (const key of ['x', 'y'] as const) {
      const input = numberField(grid, key.toUpperCase(), px ? layer!.originPx[key] : layer!.origin[key], value => {
        replaceLayer(px ? moveOriginPx(layer!, key === 'x' ? value : layer!.originPx.x, key === 'y' ? value : layer!.originPx.y)
          : moveOrigin(layer!, key === 'x' ? value : layer!.origin.x, key === 'y' ? value : layer!.origin.y))
      }, -500 * factor, 500 * factor)
      input.setAttribute('aria-label', `配置基準点 ${key.toUpperCase()} ${px ? 'px相当' : 'シーン単位'}`)
      inputs.push(input)
    }
    if (layer!.orientation.relation === 'perpendicular') {
      const width = px ? settings.width : metrics.width, height = px ? settings.height : metrics.height
      const edges = { down: ['下端', 'Y', -height / 2], up: ['上端', 'Y', height / 2],
        left: ['左端', 'X', -width / 2], right: ['右端', 'X', width / 2] } as const
      const [edge, axis, value] = edges[layer!.orientation.direction]
      coordinateHint(grid, `基準面の${edge} ${axis} = ${Number(value.toFixed(4))}`, `origin-edge-${unit}`, inputs)
    }
  }

  const placementTitle = document.createElement('h2'); placementTitle.textContent = '配置 · px'
  placementTitle.title = parallel
    ? 'X・Y・幅・高さは基準カメラから見た矩形。左上が原点で、Xは右、Yは下が正。Zは基準面の縮尺によるpx相当値です。'
    : '基準面の縮尺によるpx相当値。基準面中央が原点で、Xは右、Yは上、Zはカメラ側が正です。'
  panel.append(placementTitle)
  placementFields(panel, 'px')
  originFields(panel, 'px')
  const details = document.createElement('details'); details.setAttribute('data-placement-3d', ''); details.open = expanded3D
  const summary = document.createElement('summary'); summary.textContent = '3D配置'; summary.title = 'シーン単位で編集'
  details.append(summary); panel.append(details)
  placementFields(details, 'scene')
  originFields(details, 'scene')

}

function updateAddButton() {
  const button = get<HTMLButtonElement>('add-layer')
  button.disabled = adding || layers.length >= MAX_LAYERS
  button.title = layers.length >= MAX_LAYERS ? `最大${MAX_LAYERS}枚です` : '画像からレイヤーを追加'
}

async function decodeImage(file: Blob) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('PNG・JPEG・WebPの画像を選んでください。')
  if (file.size > 32 * 1024 * 1024) throw new Error('画像は32MB以下にしてください。')
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const maxSize = Math.min(8192, maxTextureSize)
    if (image.width > maxSize || image.height > maxSize) throw new Error(`画像の各辺は${maxSize}px以下にしてください。`)
    return image
  } finally { URL.revokeObjectURL(url) }
}

async function addImageLayer(file: File) {
  if (adding) return
  if (layers.length >= MAX_LAYERS) { status(`レイヤーは${MAX_LAYERS}枚まで追加できます。`, true); return }
  adding = true
  const revision = sceneRevision
  updateAddButton()
  status('画像を読み込み中…')
  try {
    const image = await decodeImage(file)
    if (!alive || revision !== sceneRevision) return
    const layer = createLayer(settings, layers, crypto.randomUUID(), file.name.replace(/\.[^.]+$/, '') || file.name)
    assets.set(layer.id, makeLayerAsset({ image, blob: file, fileName: file.name }))
    layers = [...layers, layer]
    selectedId = layer.id
    refreshScene()
    status('レイヤーを追加しました。')
  } catch (error) {
    if (alive && revision === sceneRevision) status(error instanceof Error ? error.message : '画像を読み込めませんでした。', true)
  } finally {
    adding = false
    if (alive) updateAddButton()
  }
}

function deleteLayer(id: string) {
  const asset = assets.get(id)
  const result = removeLayer(layers, id, selectedId)
  layers = result.layers; selectedId = result.selectedId
  imageRequests.delete(id)
  assets.delete(id)
  // Remove GPU views before releasing the texture they referenced.
  refreshScene()
  asset?.texture.dispose()
  status('')
}

async function loadImage(file: File, id: string) {
  const request = Symbol()
  imageRequests.set(id, request)
  try {
    const image = await decodeImage(file)
    if (!alive || imageRequests.get(id) !== request || !assets.has(id)) return
    const previous = assets.get(id)!
    assets.set(id, makeLayerAsset({ image, blob: file, fileName: file.name }))
    refreshScene()
    previous.texture.dispose()
    status('画像を読み込みました。')
  } catch (error) {
    if (alive && imageRequests.get(id) === request && assets.has(id)) {
      status(error instanceof Error ? error.message : '画像を読み込めませんでした。', true)
    }
  }
}

async function loadJson(file: File) {
  if (loading) return
  loading = true
  const button = get<HTMLButtonElement>('load-json'); button.disabled = true
  const nextAssets = new Map<string, LayerAsset>()
  let installed = false
  status('JSONを読み込み中…')
  try {
    if (file.size > MAX_SCENE_JSON_BYTES) throw new Error('JSONは400MB以下にしてください。')
    const prepared = await prepareSceneImport(await file.text(), decodeImage)
    if (!alive) return
    for (const [id, asset] of prepared.assets) {
      nextAssets.set(id, makeLayerAsset(asset))
    }
    const previous = { settings, layers, assets, selectedId }
    const form = get<HTMLFormElement>('settings-form')
    const keys = ['width', 'height', 'referenceHeight', 'fov'] as const
    const oldInputs = keys.map(key => (form.elements.namedItem(key) as HTMLInputElement).value)
    try {
      editor.replaceScene(prepared.settings, prepared.layers,
        new Map([...nextAssets].map(([id, asset]) => [id, asset.texture])), () => {
          settings = prepared.settings; layers = prepared.layers; assets = nextAssets
          selectedId = layers[0]?.id ?? null
          keys.forEach(key => { (form.elements.namedItem(key) as HTMLInputElement).value = String(settings[key]) })
          updateSceneView(false); renderLayerUI()
        })
    } catch (error) {
      settings = previous.settings; layers = previous.layers; assets = previous.assets; selectedId = previous.selectedId
      keys.forEach((key, index) => { (form.elements.namedItem(key) as HTMLInputElement).value = oldInputs[index] })
      updateSceneView(false); renderLayerUI()
      throw error
    }
    installed = true
    sceneRevision++
    imageRequests.clear()
    previous.assets.forEach(asset => asset.texture.dispose())
    status('JSONを読み込みました。')
  } catch (error) {
    if (alive) status(error instanceof Error ? error.message : 'JSONを読み込めませんでした。', true)
  } finally {
    if (!installed) nextAssets.forEach(asset => asset.texture.dispose())
    loading = false
    if (alive) button.disabled = false
  }
}

function downloadFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  try {
    const link = document.createElement('a')
    link.href = url; link.download = filename
    document.body.append(link)
    try { link.click() } finally { link.remove() }
  } finally {
    // Give the browser time to start reading the download before releasing the URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

async function saveJson() {
  if (saving) return
  const button = get<HTMLButtonElement>('save-json')
  saving = true; button.disabled = true
  status('JSONを作成中…')
  try {
    const data = await createSceneDocument(settings, layers, assets)
    if (!alive) return
    const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' })
    downloadFile(blob, 'three-layered-scene.json')
    status('JSONを書き出しました。')
  } catch (error) {
    if (alive) status(error instanceof Error ? error.message : 'JSONを保存できませんでした。', true)
  } finally {
    saving = false
    if (alive) button.disabled = false
  }
}

async function exportGlb() {
  if (exportingGlb) return
  exportingGlb = true
  const button = get<HTMLButtonElement>('export-glb'); button.disabled = true
  status('GLBを作成中…')
  try {
    const data = await createSceneGlb(settings, layers, assets)
    if (!alive) return
    downloadFile(new Blob([data], { type: 'model/gltf-binary' }), 'three-layered-scene.glb')
    status('GLBを書き出しました。')
  } catch (error) {
    if (alive) status(error instanceof Error ? error.message : 'GLBを書き出せませんでした。', true)
  } finally {
    exportingGlb = false
    if (alive) button.disabled = false
  }
}

let maxTextureSize = 8192
let stageObserver: ResizeObserver | undefined

// Register before awaiting GPU initialization so HMR cannot leave an old editor alive.
if (import.meta.hot) import.meta.hot.dispose(() => {
  alive = false
  stageObserver?.disconnect()
  if (editor) void editor.dispose()
  assets.forEach(asset => asset.texture.dispose())
  assets.clear()
  imageRequests.clear()
})

async function start() {
  const inputs = app.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, button, select')
  inputs.forEach((element) => { element.disabled = true })
  try {
    status('画像を読み込み中…')
    const samples = await loadDemoImages()
    if (!alive) return
    layers.forEach((layer, index) => {
      const sample = samples[index]!
      assets.set(layer.id, makeLayerAsset(sample))
    })
    editor = new Editor(get('preview'), get('work'), settings, layers, textureMap())
    status('初期化中…')
    await editor.init()
    if (!alive) return
    inputs.forEach((element) => { element.disabled = false })
    maxTextureSize = editor.maxTextureSize
    get('save-json').onclick = () => { void saveJson() }
    get('export-glb').onclick = () => { void exportGlb() }
    const loadInput = get<HTMLInputElement>('load-json-file')
    get('load-json').onclick = () => { loadInput.value = ''; loadInput.click() }
    loadInput.onchange = () => { const file = loadInput.files?.[0]; if (file) void loadJson(file) }
    const addInput = get<HTMLInputElement>('add-layer-image')
    get('add-layer').onclick = () => { addInput.value = ''; addInput.click() }
    addInput.onchange = () => { const file = addInput.files?.[0]; if (file) void addImageLayer(file) }
    const form = get<HTMLFormElement>('settings-form')
    const keys = ['width', 'height', 'referenceHeight', 'fov'] as const
    for (const key of keys) (form.elements.namedItem(key) as HTMLInputElement).value = String(settings[key])
    form.onsubmit = (event) => {
      event.preventDefault()
      if (!form.reportValidity()) return
      const next = Object.fromEntries(keys.map((key) => [key, Number((form.elements.namedItem(key) as HTMLInputElement).value)])) as unknown as SceneSettings
      try {
        referenceMetrics(next)
        const policy = get<HTMLSelectElement>('fov-policy').value as PlacementPolicy
        const updated = reconfigureScene(settings, next, layers, policy)
        settings = next; layers = updated
        refreshScene()
        status('設定を適用しました。')
      } catch (error) { status(error instanceof Error ? error.message : '設定を適用できません。', true) }
    }
    const offset = (axis: 'x' | 'y') => {
      const input = get<HTMLInputElement>(`offset-${axis}`)
      input.oninput = () => {
        const value = input.valueAsNumber
        if (axis === 'x') editor.offsetX = value
        else editor.offsetY = value
        get(`offset-${axis}-value`).textContent = value.toFixed(2)
        get('preview-label').hidden = !(editor.offsetX || editor.offsetY)
        editor.requestRender()
      }
    }
    offset('x'); offset('y')
    get('reset-preview').onclick = () => {
      for (const axis of ['x', 'y']) {
        get<HTMLInputElement>(`offset-${axis}`).value = '0'
        get(`offset-${axis}-value`).textContent = '0.00'
      }
      editor.offsetX = editor.offsetY = 0
      get('preview-label').hidden = true
      editor.requestRender()
    }
    get<HTMLInputElement>('surrounding').onchange = (event) => {
      editor.surrounding = (event.target as HTMLInputElement).checked
      get('reference-frame').hidden = !editor.surrounding
      editor.requestRender()
    }
    get<HTMLSelectElement>('diagnostic').onchange = (event) => {
      editor.diagnostic = (event.target as HTMLSelectElement).value as DiagnosticMode
      editor.requestRender()
    }
    document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
      button.onclick = () => editor.setWorkView(button.dataset.view!)
    })
    stageObserver = new ResizeObserver(fitStages)
    document.querySelectorAll('.image-area').forEach((element) => stageObserver!.observe(element))
    refreshScene()
    status('')
  } catch (error) {
    if (!alive) return
    if (editor) await editor.dispose()
    status(`編集画面を開始できませんでした。${error instanceof Error ? ` ${error.message}` : ''}`, true)
    app.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, button, select').forEach((element) => { element.disabled = true })
  }

}

void start()
