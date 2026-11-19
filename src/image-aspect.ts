import type { ImageDimensions } from './image-fit'

/** Recheck against the current layer frame after image, frame or composition changes. */
export function imageAspectNotice(image: ImageDimensions, frame: ImageDimensions): string | null {
  if (![image.width, image.height, frame.width, frame.height].every(value => Number.isFinite(value) && value > 0)) return null
  const difference = Math.abs(image.width / image.height / (frame.width / frame.height) - 1)
  return difference > 0.001
    ? '仮想枠と縦横比が異なります。縦横比を保ち、中央でトリミングします。'
    : null
}
