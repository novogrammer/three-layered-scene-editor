import { expect, test } from 'vitest'
import { centeredCover } from '../src/image-fit.ts'

test('equal-aspect images keep their full canvas at any pixel resolution', () => {
  expect(centeredCover({ width: 960, height: 540 }, { width: 1920, height: 1080 })).toEqual({
    source: { x: 0, y: 0, width: 960, height: 540 },
    uv: { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 },
  })
})

test.each([
  [{ width: 1920, height: 1080 }, { width: 1080, height: 1080 }, { x: 420, y: 0, width: 1080, height: 1080 }],
  [{ width: 1080, height: 1920 }, { width: 1080, height: 1080 }, { x: 0, y: 420, width: 1080, height: 1080 }],
  [{ width: 1000, height: 1000 }, { width: 1920, height: 1080 }, { x: 0, y: 218.75, width: 1000, height: 562.5 }],
])('centered cover preserves proportions and matches comparison crop to 3D UVs: %j', (image, frame, expected) => {
  const { source, uv } = centeredCover(image, frame)
  for (const key of Object.keys(expected)) expect(source[key]).toBeCloseTo(expected[key], 8)
  expect(source.x).toBeCloseTo((image.width - source.width) / 2, 8)
  expect(source.y).toBeCloseTo((image.height - source.height) / 2, 8)
  expect(frame.width / source.width).toBeCloseTo(frame.height / source.height, 8)
  for (const [u, v] of [[0, 0], [0.5, 0.5], [1, 1], [0.2, 0.7]]) {
    // Canvas's top-down source coordinates agree with the shader's bottom-up UVs.
    const comparisonX = source.x + source.width * u
    const comparisonY = source.y + source.height * (1 - v)
    const imageU = u * uv.scaleX + uv.offsetX
    const imageV = v * uv.scaleY + uv.offsetY
    expect(imageU * image.width).toBeCloseTo(comparisonX, 8)
    expect((1 - imageV) * image.height).toBeCloseTo(comparisonY, 8)
  }
})

test('cover recalculates on settings/image changes and leaves frame-exterior samples unclamped', () => {
  const wide = { width: 1920, height: 1080 }, square = { width: 1080, height: 1080 }
  const { uv } = centeredCover(wide, square)
  expect(uv.scaleX).toBeLessThan(1)
  // Outside the frame, original image margins remain available before edge extension.
  expect(-0.1 * uv.scaleX + uv.offsetX).toBeGreaterThan(0)
  expect(-2 * uv.scaleX + uv.offsetX).toBeLessThan(0)
  expect(centeredCover(square, wide).uv.scaleY).toBeLessThan(1)
  expect(centeredCover(wide, wide).uv).toEqual({ scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 })
})
