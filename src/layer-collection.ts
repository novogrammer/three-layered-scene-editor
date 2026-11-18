import { defaultOrigin, orientationFor, placeFront } from './model'
import type { Layer, SceneSettings } from './model'

export const MAX_LAYERS = 9
const colors = ['#78c5b1', '#efb66d', '#9695e4', '#dc8fa7', '#81b5df', '#b9ca78']

export function createLayer(settings: SceneSettings, layers: Layer[], id: string, name: string): Layer {
  if (layers.length >= MAX_LAYERS) throw new Error(`レイヤーは${MAX_LAYERS}枚まで追加できます。`)
  if (layers.some(layer => layer.id === id)) throw new Error('レイヤーIDが重複しています。')
  const rect = { x: 0, y: 0, width: settings.width, height: settings.height }
  return {
    id, name, orientation: orientationFor('front'), origin: defaultOrigin(settings, 'front'),
    editorColor: colors[layers.length % colors.length]!, visible: true, alphaMode: 'BLEND',
    rect, depthRange: null, transform: placeFront(settings, rect, 0),
  }
}

export function removeLayer(layers: Layer[], id: string, selectedId: string | null) {
  const index = layers.findIndex(layer => layer.id === id)
  if (index < 0) return { layers, selectedId }
  const remaining = layers.filter(layer => layer.id !== id)
  return {
    layers: remaining,
    selectedId: selectedId === id ? remaining[Math.min(index, remaining.length - 1)]?.id ?? null : selectedId,
  }
}

/** The reference camera looks along -Z; draw smaller center Z first. Ties retain list order. */
export function compositionLayers(layers: readonly Layer[]): Layer[] {
  return [...layers].sort((a, b) => a.transform.z - b.transform.z)
}
