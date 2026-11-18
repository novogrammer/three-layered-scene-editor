import { expect, test, vi } from 'vitest'
import { reconcileLayerViews } from '../src/layer-views.ts'

test('adding and deleting views preserves surviving resources by stable ID', () => {
  const create = vi.fn(id => ({ id, texture: `${id}-texture` })), dispose = vi.fn()
  let views = reconcileLayerViews(new Map(), ['a', 'b'], create, dispose)
  const retained = views.get('b')
  views = reconcileLayerViews(views, ['b', 'c'], create, dispose)
  expect(views.get('b')).toBe(retained)
  expect(create.mock.calls.map(call => call[0])).toEqual(['a', 'b', 'c'])
  expect(dispose.mock.calls.map(call => call[0].id)).toEqual(['a'])
  views = reconcileLayerViews(views, [], create, dispose)
  expect(views.size).toBe(0)
  expect(dispose.mock.calls.map(call => call[0].id)).toEqual(['a', 'b', 'c'])
})

test('failed creation disposes only newly-created resources and retains the previous scene', () => {
  const old = { id: 'existing' }, previous = new Map([['existing', old]])
  const create = vi.fn(id => {
    if (id === 'failure') throw new Error('creation failed')
    return { id }
  })
  const dispose = vi.fn()
  expect(() => reconcileLayerViews(previous, ['existing', 'new', 'failure'], create, dispose)).toThrow('creation failed')
  expect(previous.get('existing')).toBe(old)
  expect(dispose.mock.calls.map(call => call[0].id)).toEqual(['new'])
})

test('duplicate IDs are rejected before allocating or disposing resources', () => {
  const create = vi.fn(), dispose = vi.fn()
  expect(() => reconcileLayerViews(new Map(), ['a', 'a'], create, dispose)).toThrow()
  expect(create).not.toHaveBeenCalled(); expect(dispose).not.toHaveBeenCalled()
})

test('replacement retains previous resources until apply succeeds, even for identical IDs', async () => {
  const { replaceLayerViews } = await import('../src/layer-views.ts')
  const old = { id: 'same', generation: 'old' }, previous = new Map([['same', old]]), disposed = []
  let applied
  replaceLayerViews(previous, ['same'], id => ({ id, generation: 'new' }), views => {
    expect(disposed).toEqual([])
    expect(previous.get('same')).toBe(old)
    applied = views.get('same')
    expect(applied).not.toBe(old)
  }, view => disposed.push(view))
  expect(applied.generation).toBe('new')
  expect(disposed).toEqual([old])
})

test('failed replacement application releases only candidate resources', async () => {
  const { replaceLayerViews } = await import('../src/layer-views.ts')
  const old = { id: 'same', generation: 'old' }, previous = new Map([['same', old]]), disposed = []
  expect(() => replaceLayerViews(previous, ['same', 'extra'], id => ({ id, generation: 'new' }), () => {
    throw new Error('apply failed')
  }, view => disposed.push(view))).toThrow('apply failed')
  expect(previous.get('same')).toBe(old)
  expect(disposed.map(view => view.generation)).toEqual(['new', 'new'])
})

test('editor rolls its scene references back when the final commit fails', async () => {
  const { Editor } = await import('../src/editor.ts')
  const old = { id: 'same', generation: 'old' }, originalSettings = {}, originalLayers = [{ id: 'same' }], originalTextures = new Map()
  const disposed = []
  const editor = {
    views: new Map([['same', old]]), settings: originalSettings, layers: originalLayers,
    textures: originalTextures, selectedId: 'same',
    createView: layer => ({ id: layer.id, generation: 'new' }),
    disposeView: view => disposed.push(view),
    update(settings, layers, textures) { this.settings = settings; this.layers = layers; this.textures = textures },
  }
  expect(() => Editor.prototype.replaceScene.call(editor, { new: true }, [{ id: 'same' }], new Map(), () => {
    editor.selectedId = 'changed'
    throw new Error('final commit failed')
  })).toThrow('final commit failed')
  expect(editor.settings).toBe(originalSettings)
  expect(editor.layers).toBe(originalLayers)
  expect(editor.textures).toBe(originalTextures)
  expect(editor.selectedId).toBe('same')
  expect(editor.views.get('same')).toBe(old)
  expect(disposed).toEqual([{ id: 'same', generation: 'new' }])
})
