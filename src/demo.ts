/** Static sample assets are shared by the 3D preview and the 2D comparison. */
export const demoFiles = ['background.png', 'foreground.png', 'ground.png'] as const

export async function loadDemoImages() {
  return Promise.all(demoFiles.map(async (filename) => {
    const response = await fetch(`${import.meta.env.BASE_URL}samples/${filename}`)
    if (!response.ok) throw new Error(`サンプル画像 samples/${filename} を読み込めませんでした。`)
    const blob = new Blob([await response.arrayBuffer()], { type: 'image/png' })
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.src = url
    try {
      await image.decode()
    } catch {
      throw new Error(`サンプル画像 samples/${filename} を読み込めませんでした。`)
    } finally {
      URL.revokeObjectURL(url)
    }
    return { image, blob, fileName: filename }
  }))
}
