interface ImageDimensions { width: number; height: number }

/** Same aspect check for image replacement and subsequent canvas-setting changes. */
export function imageAspectNotice(image: ImageDimensions, canvas: ImageDimensions): string | null {
  if (![image.width, image.height, canvas.width, canvas.height].every(value => Number.isFinite(value) && value > 0)) return null
  const difference = Math.abs(image.width / image.height / (canvas.width / canvas.height) - 1)
  return difference > 0.001
    ? '2D換算解像度と縦横比が異なります。枠に合わせて伸縮します。'
    : null
}
