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
