import type { WebGPURenderer } from 'three/webgpu'

/** Read the active backend's limit after renderer.init(). */
export function maxTextureSize(renderer: WebGPURenderer): number {
  const backend = renderer.backend as typeof renderer.backend & {
    device?: { limits: { maxTextureDimension2D: number } }
    gl?: WebGL2RenderingContext
  }
  const limit = backend.device?.limits.maxTextureDimension2D
    ?? (backend.gl ? Number(backend.gl.getParameter(backend.gl.MAX_TEXTURE_SIZE)) : undefined)
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit <= 0) throw new Error('レンダラーのテクスチャ上限を取得できませんでした。')
  return limit
}

export function assertImageFitsGpu(image: { width: number; height: number }, limit: number) {
  if (![image.width, image.height].every(n => Number.isSafeInteger(n) && n > 0)) {
    throw new Error('画像の寸法が不正です。')
  }
  if (image.width > limit || image.height > limit) {
    throw new Error(`画像の寸法 ${image.width} × ${image.height}px がGPUの上限（各辺${limit}px）を超えています。`)
  }
}
