/** Static sample assets are shared by the 3D preview and the 2D comparison. */
export const demoFiles = ['background.png', 'foreground.png', 'ground.png'] as const

export async function loadDemoImages(): Promise<HTMLImageElement[]> {
  return Promise.all(demoFiles.map(async (filename) => {
    const image = new Image()
    image.src = `${import.meta.env.BASE_URL}samples/${filename}`
    try {
      await image.decode()
    } catch {
      throw new Error(`サンプル画像 samples/${filename} を読み込めませんでした。`)
    }
    return image
  }))
}
