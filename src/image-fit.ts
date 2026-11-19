export interface ImageDimensions { width: number; height: number }

/** Centered cover, based on the entire image canvas, including transparent margins. */
export function centeredCover(image: ImageDimensions, frame: ImageDimensions) {
  if (![image.width, image.height, frame.width, frame.height].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('画像と表示枠の寸法には正の有限値を指定してください。')
  }
  const scale = Math.max(frame.width / image.width, frame.height / image.height)
  const scaleX = frame.width / (image.width * scale)
  const scaleY = frame.height / (image.height * scale)
  const offsetX = (1 - scaleX) / 2
  const offsetY = (1 - scaleY) / 2
  return {
    source: { x: offsetX * image.width, y: offsetY * image.height, width: scaleX * image.width, height: scaleY * image.height },
    uv: { scaleX, scaleY, offsetX, offsetY },
  }
}

/** Base-camera UV -> centered layer frame -> cover-fitted image UV. */
export function projectedCover(image: ImageDimensions, frame: ImageDimensions, composition: ImageDimensions) {
  const cover = centeredCover(image, frame).uv
  const scaleX = cover.scaleX * composition.width / frame.width
  const scaleY = cover.scaleY * composition.height / frame.height
  return { scaleX, scaleY, offsetX: (1 - scaleX) / 2, offsetY: (1 - scaleY) / 2 }
}

/** Canvas draw patches for the same sampling, including clamped image-edge extension. */
export function compositionImageRects(image: ImageDimensions, frame: ImageDimensions, composition: ImageDimensions) {
  const fit = projectedCover(image, frame, composition)
  const segments = (size: number, output: number, scale: number, offset: number) => {
    const clamp = (n: number) => Math.max(0, Math.min(1, n))
    const cuts = [0, clamp(-offset / scale), clamp((1 - offset) / scale), 1]
    return cuts.slice(0, -1).flatMap((a, i) => {
      const b = cuts[i + 1]!
      if (b <= a) return []
      const start = clamp(a * scale + offset) * size, end = clamp(b * scale + offset) * size
      return [{ source: end > start ? start : Math.min(size - 1, start),
        length: end > start ? end - start : 1, target: a * output, extent: (b - a) * output }]
    })
  }
  const xs = segments(image.width, composition.width, fit.scaleX, fit.offsetX)
  const ys = segments(image.height, composition.height, fit.scaleY, fit.offsetY)
  return xs.flatMap(x => ys.map(y => ({ source: { x: x.source, y: y.source, width: x.length, height: y.length },
    target: { x: x.target, y: y.target, width: x.extent, height: y.extent } })))
}
