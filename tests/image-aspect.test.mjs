import { expect, test } from 'vitest'
import { imageAspectNotice } from '../src/image-aspect.ts'

test('different pixel resolutions with the same aspect need no notice', () => {
  expect(imageAspectNotice({ width: 960, height: 540 }, { width: 1920, height: 1080 })).toBeNull()
})

test('a different aspect returns a nonblocking notice instead of throwing', () => {
  expect(imageAspectNotice({ width: 1080, height: 1920 }, { width: 1920, height: 1080 }))
    .toContain('枠に合わせて伸縮')
})

test('rechecking the current settings adds and clears the image notice', () => {
  const image = { width: 1920, height: 1080 }
  expect(imageAspectNotice(image, { width: 1920, height: 1080 })).toBeNull()
  expect(imageAspectNotice(image, { width: 1080, height: 1080 })).not.toBeNull()
  expect(imageAspectNotice(image, { width: 3840, height: 2160 })).toBeNull()
})

test('small pixel-rounding differences keep the existing aspect tolerance', () => {
  const canvas = { width: 1920, height: 1080 }
  expect(imageAspectNotice({ width: 1919, height: 1080 }, canvas)).toBeNull()
  expect(imageAspectNotice({ width: 1910, height: 1080 }, canvas)).not.toBeNull()
})
