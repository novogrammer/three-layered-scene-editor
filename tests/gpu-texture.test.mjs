import { expect, test, vi } from 'vitest'
import { assertImageFitsGpu, maxTextureSize } from '../src/gpu-texture.ts'

test('WebGPU uses the active device limit, including limits above 8192', () => {
  const limit = maxTextureSize({ backend: { device: { limits: { maxTextureDimension2D: 16384 } } } })
  expect(limit).toBe(16384)
  expect(() => assertImageFitsGpu({ width: 16384, height: 9000 }, limit)).not.toThrow()
  expect(() => assertImageFitsGpu({ width: 16385, height: 1 }, limit)).toThrow('16384')
  expect(() => assertImageFitsGpu({ width: 1, height: 16385 }, limit)).toThrow('GPU')
})

test('WebGL fallback uses MAX_TEXTURE_SIZE even when it is below 8192', () => {
  const gl = { MAX_TEXTURE_SIZE: 3379, getParameter: vi.fn(() => 4096) }
  const limit = maxTextureSize({ backend: { gl } })
  expect(gl.getParameter).toHaveBeenCalledWith(gl.MAX_TEXTURE_SIZE)
  expect(() => assertImageFitsGpu({ width: 4096, height: 4096 }, limit)).not.toThrow()
  expect(() => assertImageFitsGpu({ width: 4097, height: 1 }, limit)).toThrow('4096')
})

test.each([{}, { device: { limits: { maxTextureDimension2D: 0 } } }])('missing GPU limits do not fall back to an arbitrary fixed value', backend => {
  expect(() => maxTextureSize({ backend })).toThrow('上限を取得')
})
