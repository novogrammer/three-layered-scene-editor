import './style.css'
import * as THREE from 'three'
import { Editor } from './editor'
import { demoImage } from './demo'
import { defaultSettings, frontRect, initialLayers, placeFront, reconfigureScene, referenceMetrics } from './model'
import type { Layer, SceneSettings } from './model'

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <header class="app-header">
    <div><span class="brand-mark">▱</span><strong>Layered Scene</strong><span class="badge">最小構成 / 01</span></div>
    <span class="header-note">Camera Projection · 2.5D</span>
  </header>
  <div class="workspace">
    <aside class="sidebar">
      <section><h2>基準設定</h2>
        <form id="settings-form">
          <div class="pair">
            <label>2D幅 <span>px</span><input name="width" type="number" min="1" max="16384" step="1" required></label>
            <label>2D高さ <span>px</span><input name="height" type="number" min="1" max="16384" step="1" required></label>
          </div>
          <div class="pair">
            <label>基準平面の高さ<input name="referenceHeight" type="number" min="0.1" max="100" step="any" required></label>
            <label>垂直FOV <span>°</span><input name="fov" type="number" min="5" max="140" step="any" required></label>
          </div>
          <label>FOV・基準設定変更時の正面レイヤー
            <select id="fov-policy"><option value="screen">2D配置を保つ</option><option value="world">3D配置を保つ</option></select>
          </label>
          <button class="primary full" type="submit">基準設定を適用</button>
        </form>
        <p id="camera-info" class="readout"></p>
        <p class="hint">地面は3D配置を維持。基準カメラは視差確認で変更されません。</p>
      </section>
      <section><div class="section-heading"><h2>レイヤー</h2><span>2 + 地面</span></div><div id="layer-list"></div></section>
      <section id="layer-panel"></section>
      <p class="sidebar-note">保存・GLB出力は次の段階で実装します。再読み込みすると編集内容は失われます。</p>
    </aside>
    <main>
      <div class="main-toolbar">
        <div><h1>シーン検証</h1><p>構図を保って、奥行きを探る</p></div>
        <label class="inline-check"><input id="surrounding" type="checkbox">周囲を表示</label>
      </div>
      <div class="comparison">
        <section class="view-card"><div class="view-heading"><h2>プレビュー</h2><span id="preview-label">基準位置</span></div>
          <div class="image-area"><div id="preview-stage" class="image-stage"><canvas id="preview"></canvas><div id="reference-frame" hidden></div></div></div>
        </section>
        <section class="view-card"><div class="view-heading"><h2>元画像の2D合成</h2><span>レイヤー1 → 地面 → レイヤー2</span></div>
          <div class="image-area"><div id="source-stage" class="image-stage"><canvas id="source"></canvas></div></div>
        </section>
      </div>
      <section class="parallax-controls">
        <strong>視差確認</strong>
        <label>左右 <input id="offset-x" type="range" min="-1" max="1" step="0.01" value="0"><output id="offset-x-value">0.00</output></label>
        <label>上下 <input id="offset-y" type="range" min="-1" max="1" step="0.01" value="0"><output id="offset-y-value">0.00</output></label>
        <button id="reset-preview" type="button">基準へ戻す</button>
      </section>
      <section class="view-card work-card">
        <div class="view-heading work-heading"><h2>配置確認</h2>
          <div class="work-actions"><select id="diagnostic" aria-label="配置確認の表示"><option value="1">投影範囲を確認</option><option value="0">実表示</option><option value="2">レイヤー識別色</option></select>
          <button type="button" data-view="orbit">斜め</button><button type="button" data-view="side">横</button><button type="button" data-view="top">上</button></div>
        </div>
        <div class="work-stage"><canvas id="work"></canvas></div>
        <div class="view-footer"><span>ドラッグ：回転 / ホイール：拡大縮小 / 右ドラッグ：移動</span><span>橙ハッチ：画面外　赤：投影不可　白枠：基準平面</span></div>
      </section>
      <p id="status" role="status" aria-live="polite">サンプル画像を表示中。各レイヤーの画像を読み込んで試せます。</p>
    </main>
  </div>`

const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
let settings = { ...defaultSettings }
let layers = initialLayers(settings)
let selected = 0
let depthMode = 'screen'
let alive = true
const source = get<HTMLCanvasElement>('source')
const images: (HTMLCanvasElement | HTMLImageElement)[] = [demoImage('back'), demoImage('front'), demoImage('ground')]
const sourceNames = ['サンプル：遠景', 'サンプル：前景', 'サンプル：地面']
const uploadVersions = [0, 0, 0]
const textures = images.map(makeTexture)
let editor: Editor

function makeTexture(image: HTMLCanvasElement | HTMLImageElement) {
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
    detail.textContent = layer.visible ? (layer.kind === 'ground' ? '水平' : '正面') : '非表示'
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
  if (layer.kind === 'front') {
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
    for (const [key, label] of [['y', '地面の高さY'], ['z', '中心Z'], ['x', '中心X'], ['width', '幅'], ['height', '奥行きサイズ']] as const) {
      numberField(grid, label, layer.transform[key], (value) => { layer.transform[key] = value },
        key === 'width' || key === 'height' ? 0.01 : -500, 500)
    }
    const hint = document.createElement('p'); hint.className = 'hint'
    hint.textContent = '地面はXZ面に水平。FOV変更では移動・拡縮しません。端が見える場合は幅や奥行きを広げてください。'
    panel.append(hint)
  }
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

try {
  editor = new Editor(get('preview'), get('work'), settings, layers, textures)
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
  const observer = new ResizeObserver(fitStages)
  document.querySelectorAll('.image-area').forEach((element) => observer.observe(element))
  renderList(); renderPanel(); sync()
  if (import.meta.hot) import.meta.hot.dispose(() => {
    alive = false
    observer.disconnect()
    editor.dispose()
    textures.forEach((texture) => texture.dispose())
  })
} catch (error) {
  status(`3D表示を開始できませんでした。WebGL 2が利用できる環境で開いてください。${error instanceof Error ? ` ${error.message}` : ''}`, true)
  app.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, button, select').forEach((element) => { element.disabled = true })
}
