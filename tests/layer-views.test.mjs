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
