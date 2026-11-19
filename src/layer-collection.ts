import { createLayerModel, geometryTransform, orientationFor } from './model'
import type { Layer, SceneSettings } from './model'

const colors = ['#78c5b1', '#efb66d', '#9695e4', '#dc8fa7', '#81b5df', '#b9ca78']

export function createLayer(settings: SceneSettings, layers: Layer[], id: string, name: string): Layer {
  if (layers.some(layer => layer.id === id)) throw new Error('レイヤーIDが重複しています。')
  const rect = { x: 0, y: 0, width: settings.width, height: settings.height }
  return createLayerModel(settings, {
    id, name, orientation: orientationFor('front'), originPx: { x: 0, y: 0, z: 0 },
    editorColor: colors[layers.length % colors.length]!, visible: true, alphaMode: 'BLEND',
    placement: { type: 'screen', rectPx: rect, zPx: 0 },
    framePx: { width: settings.width, height: settings.height },
  })
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
  return [...layers].sort((a, b) => geometryTransform(a).z - geometryTransform(b).z)
}

export function moveLayer(layers: readonly Layer[], id: string, offset: -1 | 1): Layer[] {
  const result = [...layers]
  const index = result.findIndex(layer => layer.id === id)
  const target = index + offset
  if (index < 0 || target < 0 || target >= result.length) return result
  ;[result[index], result[target]] = [result[target]!, result[index]!]
  return result
}
