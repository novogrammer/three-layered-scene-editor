import './style.css'
import * as THREE from 'three/webgpu'
import { Editor } from './editor'
import { demoFiles, loadDemoImages } from './demo'
import { changeOrientation, defaultSettings, frontRect, initialLayers, moveOrigin, placeFront, reconfigureScene, referenceMetrics, isWall, orientationFor, planeDirections, planeRelations, setDepthRange } from './model'
import type { Layer, PlaneDirection, SceneSettings } from './model'

const app = document.querySelector<HTMLDivElement>('#app')!
const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
let settings = { ...defaultSettings }
let layers = initialLayers(settings)
let selected = 0
let depthMode = 'screen'
let alive = true
const source = get<HTMLCanvasElement>('source')
const images: HTMLImageElement[] = []
const sourceNames: string[] = demoFiles.map((filename) => `samples/${filename}`)
const uploadVersions = [0, 0, 0]
const textures: THREE.Texture[] = []
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
  for (const index of [0, 2, 1]) {
    if (layers[index]!.visible) ctx.drawImage(images[index]!, 0, 0, source.width, source.height)
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

function sync() {
  editor.update(settings, layers)
  const metrics = referenceMetrics(settings)
  get('camera-info').textContent = `基準平面 ${metrics.width.toFixed(3)} × ${metrics.height.toFixed(3)} / カメラZ +${metrics.cameraZ.toFixed(3)}`
  const warning = layers.some((layer) => layer.transform.z >= metrics.cameraZ - metrics.near)
  if (warning) status('カメラに近すぎるPlaneがあります。FOVを狭くするか、Planeを奥へ移動してください。', true)
  compare()
  fitStages()
}

function renderList() {
  const list = get('layer-list')
  list.replaceChildren()
  layers.forEach((layer, index) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `layer-item ${index === selected ? 'selected' : ''}`
    button.setAttribute('aria-pressed', String(index === selected))
    const dot = document.createElement('span')
    dot.className = 'layer-dot'
    dot.style.background = layer.editorColor
    const name = document.createElement('span')
    name.textContent = layer.name
    const detail = document.createElement('small')
    detail.textContent = layer.visible ? `${planeRelations[layer.orientation.relation]} / ${planeDirections[layer.orientation.direction]}` : '非表示'
    button.append(dot, name, detail)
    button.onclick = () => {
      selected = index
      editor.selected = index
      renderList()
      renderPanel()
      editor.requestRender()
    }
    list.append(button)
  })
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
      sync()
      renderPanel()
    } catch (error) {
      status(error instanceof Error ? error.message : '入力値を確認してください。', true)
      renderPanel()
    }
  }
  return input
}

function renderPanel() {
  const layer = layers[selected]!
  const panel = get('layer-panel')
  panel.replaceChildren()
  const title = document.createElement('h2'); title.textContent = `${layer.name}の設定`; panel.append(title)
  const change = (direction: PlaneDirection) => {
    try {
      layers[selected] = changeOrientation(settings, layer, orientationFor(direction))
      sync(); renderList(); renderPanel()
      status('面の配置方式・向きと基準点を変更しました。位置は下の入力欄で調整できます。')
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
    const directionLabel = document.createElement('label'); directionLabel.textContent = '面の向き'
    const direction = document.createElement('select')
    for (const [value, name] of Object.entries(planeDirections)) {
      if (value === 'front') continue
      const option = document.createElement('option'); option.value = value; option.textContent = name
      direction.append(option)
    }
    direction.value = layer.orientation.direction
    direction.onchange = () => change(direction.value as PlaneDirection)
    directionLabel.append(direction); panel.append(directionLabel)
  }
  const method = document.createElement('p'); method.className = 'hint'
  method.textContent = layer.orientation.relation === 'parallel' ? '表示方式：頂点UV（自動）' : '表示方式：カメラ投影 / TSL（自動）'
  panel.append(method)
  const fileLabel = document.createElement('label'); fileLabel.textContent = '画像を読み込む（PNG / JPEG / WebP）'
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp'
  fileLabel.append(input); panel.append(fileLabel)
  const fileInfo = document.createElement('p'); fileInfo.className = 'hint'; fileInfo.textContent = sourceNames[selected]!
  panel.append(fileInfo)
  const index = selected
  input.onchange = () => { const file = input.files?.[0]; if (file) void loadImage(file, index) }
  const row = document.createElement('div'); row.className = 'layer-options'
  const visibleLabel = document.createElement('label'); visibleLabel.className = 'inline-check'
  const visible = document.createElement('input'); visible.type = 'checkbox'; visible.checked = layer.visible
  visibleLabel.append(visible, '表示')
  visible.onchange = () => { layer.visible = visible.checked; renderList(); sync() }
  const colorLabel = document.createElement('label'); colorLabel.className = 'inline-check'; colorLabel.textContent = '識別色'
  const color = document.createElement('input'); color.type = 'color'; color.value = layer.editorColor
  colorLabel.append(color)
  color.oninput = () => { layer.editorColor = color.value; renderList(); editor.update(settings, layers) }
  row.append(visibleLabel, colorLabel); panel.append(row)
  const modeLabel = document.createElement('label'); modeLabel.textContent = 'アルファ'
  const mode = document.createElement('select')
  mode.innerHTML = '<option value="BLEND">BLEND（透過を使用）</option><option value="OPAQUE">OPAQUE（不透明）</option>'
  mode.value = layer.alphaMode
  mode.onchange = () => { layer.alphaMode = mode.value as Layer['alphaMode']; sync() }
  modeLabel.append(mode); panel.append(modeLabel)
  if (layer.orientation.relation === 'parallel') {
    const label = document.createElement('label'); label.textContent = '奥行き変更時'
    const select = document.createElement('select')
    select.innerHTML = '<option value="screen">2D位置・サイズを保つ</option><option value="world">3D位置・サイズを保つ</option>'
    select.value = depthMode; select.onchange = () => { depthMode = select.value }
    label.append(select); panel.append(label)
    const metrics = referenceMetrics(settings)
    numberField(panel, '奥行きZ（＋が手前 / シーン単位）', layer.transform.z, (z) => {
      if (z >= metrics.cameraZ - metrics.near) throw new Error('カメラより奥へ配置してください。')
      const rect = frontRect(settings, layer.transform)
      layer.transform = depthMode === 'screen' ? placeFront(settings, rect, z) : { ...layer.transform, z }
      layer.rect = frontRect(settings, layer.transform)
    }, -500, metrics.cameraZ - metrics.near - 0.001)
    const details = document.createElement('details')
    const summary = document.createElement('summary'); summary.textContent = '通常の3D配置・サイズ'
    details.append(summary); panel.append(details)
    for (const [key, label] of [['x', '位置X'], ['y', '位置Y'], ['width', '幅'], ['height', '高さ']] as const) {
      numberField(details, label, layer.transform[key], (value) => {
        layer.transform[key] = value
        layer.rect = frontRect(settings, layer.transform)
      }, key === 'width' || key === 'height' ? 0.01 : -500, 500)
    }
  } else {
    const grid = document.createElement('div'); grid.className = 'pair'; panel.append(grid)
    const wall = isWall(layer)
    const fields: [keyof Layer['transform'], string][] = wall
      ? [['y', '面の中心Y'], ['height', '高さ']]
      : [['x', '面の中心X'], ['width', '幅']]
    for (const [key, label] of fields) {
      numberField(grid, label, layer.transform[key], (value) => { layer.transform[key] = value },
        key === 'width' || key === 'height' ? 0.01 : -500, 500)
    }
    const range = layer.depthRange!
    numberField(grid, '手前端Z（＋が手前）', range.frontZ, (value) => {
      layers[selected] = setDepthRange(layer, value, range.backZ)
    }, -1000, 1000)
    numberField(grid, '奥端Z（−が奥）', range.backZ, (value) => {
      layers[selected] = setDepthRange(layer, range.frontZ, value)
    }, -1000, 1000)
    const hint = document.createElement('p'); hint.className = 'hint'
    hint.textContent = wall
      ? '原点Z=0からの両端座標を指定します。FOV変更時は両端Zを伸縮し、左右位置・高さは維持します。'
      : '原点Z=0からの両端座標を指定します。FOV変更時は両端Zを伸縮し、高さ・幅は維持します。'
    panel.append(hint)
  }
  const originTitle = document.createElement('h2'); originTitle.textContent = '配置基準点（Z = 0）'
  panel.append(originTitle)
  const originFields = document.createElement('div'); originFields.className = 'pair'; panel.append(originFields)
  for (const [key, label] of [['x', '基準点X'], ['y', '基準点Y']] as const) {
    numberField(originFields, layer.orientation.relation === 'perpendicular' ? `${label.slice(-1)}位置（基準点）` : label, layer.origin[key], (value) => {
      layers[selected] = moveOrigin(layer, key === 'x' ? value : layer.origin.x, key === 'y' ? value : layer.origin.y)
    }, -500, 500)
  }
  const originHint = document.createElement('p'); originHint.className = 'hint'
  originHint.textContent = '基準点は基準平面上に固定。配置確認ビューの小さなXYZ軸が基準点です。'
  panel.append(originHint)
}

async function loadImage(file: File, index: number) {
  const version = ++uploadVersions[index]!
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    status('PNG・JPEG・WebPの画像を選んでください。', true); return
  }
  if (file.size > 32 * 1024 * 1024) { status('画像は32MB以下にしてください。', true); return }
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    if (!alive || version !== uploadVersions[index]) return
    const maxSize = Math.min(8192, maxTextureSize)
    if (image.width > maxSize || image.height > maxSize) throw new Error(`画像の各辺は${maxSize}px以下にしてください。`)
    if (Math.abs(image.width / image.height / (settings.width / settings.height) - 1) > 0.001) {
      throw new Error('最小構成では共通キャンバスと同じアスペクト比の画像を使います。先に2D換算解像度を設定してください。')
    }
    const texture = makeTexture(image)
    const previous = textures[index]!
    textures[index] = texture
    images[index] = image
    sourceNames[index] = `${file.name} / ${image.width} × ${image.height}`
    editor.setTexture(index, texture)
    previous.dispose()
    sync()
    if (selected === index) renderPanel()
    status(`${layers[index]!.name}に「${file.name}」を読み込みました。`)
  } catch (error) {
    if (alive && version === uploadVersions[index]) status(error instanceof Error ? error.message : '画像を読み込めませんでした。', true)
  } finally { URL.revokeObjectURL(url) }
}

let maxTextureSize = 8192
let stageObserver: ResizeObserver | undefined

// Register before awaiting GPU initialization so HMR cannot leave an old editor alive.
if (import.meta.hot) import.meta.hot.dispose(() => {
  alive = false
  stageObserver?.disconnect()
  if (editor) void editor.dispose()
  textures.forEach((texture) => texture.dispose())
})

async function start() {
  const inputs = app.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, button, select')
  inputs.forEach((element) => { element.disabled = true })
  try {
    status('サンプル画像を読み込んでいます。')
    const samples = await loadDemoImages()
    if (!alive) return
    images.push(...samples)
    textures.push(...samples.map(makeTexture))
    editor = new Editor(get('preview'), get('work'), settings, layers, textures)
    status('描画エンジンを初期化しています。')
    await editor.init()
    if (!alive) return
    inputs.forEach((element) => { element.disabled = false })
    maxTextureSize = editor.maxTextureSize
    const form = get<HTMLFormElement>('settings-form')
    const keys = ['width', 'height', 'referenceHeight', 'fov'] as const
    for (const key of keys) (form.elements.namedItem(key) as HTMLInputElement).value = String(settings[key])
    form.onsubmit = (event) => {
      event.preventDefault()
      if (!form.reportValidity()) return
      const next = Object.fromEntries(keys.map((key) => [key, Number((form.elements.namedItem(key) as HTMLInputElement).value)])) as unknown as SceneSettings
      try {
        referenceMetrics(next)
        const screen = get<HTMLSelectElement>('fov-policy').value === 'screen'
        const updated = reconfigureScene(settings, next, layers, screen)
        settings = next; layers = updated
        sync(); renderPanel()
        status(`基準設定を適用しました。正面レイヤーは${screen ? '2D配置' : '3D配置'}を維持し、投影を更新しました。`)
      } catch (error) { status(error instanceof Error ? error.message : '設定を適用できません。', true) }
    }
    const offset = (axis: 'x' | 'y') => {
      const input = get<HTMLInputElement>(`offset-${axis}`)
      input.oninput = () => {
        const value = input.valueAsNumber
        if (axis === 'x') editor.offsetX = value
        else editor.offsetY = value
        get(`offset-${axis}-value`).textContent = value.toFixed(2)
        get('preview-label').textContent = editor.offsetX || editor.offsetY ? '視差確認中 / 編集カメラは固定' : '基準位置'
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
      get('preview-label').textContent = '基準位置'
      editor.requestRender()
    }
    get<HTMLInputElement>('surrounding').onchange = (event) => {
      editor.surrounding = (event.target as HTMLInputElement).checked
      get('reference-frame').hidden = !editor.surrounding
      editor.requestRender()
    }
    get<HTMLSelectElement>('diagnostic').onchange = (event) => {
      editor.diagnostic = Number((event.target as HTMLSelectElement).value)
      editor.requestRender()
    }
    document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
      button.onclick = () => editor.setWorkView(button.dataset.view!)
    })
    stageObserver = new ResizeObserver(fitStages)
    document.querySelectorAll('.image-area').forEach((element) => stageObserver!.observe(element))
    renderList(); renderPanel(); sync()
    status('サンプル画像を表示中。各レイヤーの画像を読み込んで試せます。')
  } catch (error) {
    if (!alive) return
    if (editor) await editor.dispose()
    status(`編集画面を開始できませんでした。${error instanceof Error ? ` ${error.message}` : ''}`, true)
    app.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, button, select').forEach((element) => { element.disabled = true })
  }

}

void start()
