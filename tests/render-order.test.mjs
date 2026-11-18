import { expect, test } from 'vitest'
import { layerRenderSort } from '../src/render-order.ts'

const item = (id, z, index) => ({ id, z, groupOrder: 0, renderOrder: 0, object: { userData: { layerListIndex: index } } })

test.each([false, true])('equal-depth surfaces follow list order rather than creation ID (transparent=%s)', transparent => {
  const sort = layerRenderSort(transparent)
  const first = item(9, 0.5, 0), second = item(2, 0.5, 1)
  expect([second, first].sort(sort)).toEqual([first, second])
  first.object.userData.layerListIndex = 1
  second.object.userData.layerListIndex = 0
  expect([first, second].sort(sort)).toEqual([second, first])
})

test('different depths retain normal opaque and transparent sorting regardless of list order', () => {
  const near = item(1, 0.2, 0), far = item(2, 0.8, 1)
  expect([far, near].sort(layerRenderSort(false))).toEqual([near, far])
  expect([near, far].sort(layerRenderSort(true))).toEqual([far, near])
  near.renderOrder = 1
  expect([near, far].sort(layerRenderSort(false))).toEqual([far, near])
})
