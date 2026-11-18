import * as THREE from 'three/webgpu'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { restoreProjectionAsset } from './asset'
import type { ProjectionAsset } from './asset'

export const MAX_PROJECTION_GLB_BYTES = 400 * 1024 * 1024
export interface ProjectionLoadOptions {
  /** Optional preconfigured loader, for custom decoding or loading-manager policies. */
  loader?: Pick<GLTFLoader, 'parseAsync'>
}
export interface LoadedProjectionAsset extends ProjectionAsset {
  /** Detach scene and free source resources as well as generated TSL materials. Idempotent. */
  dispose(): void
}

function disposeScene(scene: THREE.Object3D) {
  const materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>(), geometries = new Set<THREE.BufferGeometry>()
  scene.traverse(object => {
    if (object instanceof THREE.Mesh) {
      geometries.add(object.geometry)
      const list = Array.isArray(object.material) ? object.material : [object.material]
      list.forEach(material => materials.add(material))
    }
  })
  materials.forEach(material => {
    Object.values(material).forEach(value => { if (value?.isTexture) textures.add(value) })
    material.dispose()
  })
  const images = new Set<{ close?: () => void }>()
  textures.forEach(texture => { if (texture.image) images.add(texture.image); texture.dispose() })
  images.forEach(image => { image.close?.() }); geometries.forEach(geometry => geometry.dispose())
}
/** Load a self-contained GLB and apply TSL. Fetch/File/renderer/camera controls belong to the caller. */
export async function parseProjectionGlb(data: ArrayBuffer, options: ProjectionLoadOptions = {}): Promise<LoadedProjectionAsset> {
  if (data.byteLength > MAX_PROJECTION_GLB_BYTES) throw new Error('GLBは400MB以下にしてください。')
  if (data.byteLength < 12) throw new Error('GLBファイルを指定してください。')
  const header = new DataView(data)
  if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== data.byteLength) {
    throw new Error('GLBヘッダーが不正です。')
  }
  let loader = options.loader
  if (!loader) {
    const manager = new THREE.LoadingManager()
    manager.setURLModifier(url => {
      if (!url.startsWith('blob:') && !url.startsWith('data:')) throw new Error('外部ファイル参照のあるGLBには対応していません。')
      return url
    })
    loader = new GLTFLoader(manager)
  }
  const gltf = await loader.parseAsync(data, '')
  let projection: ProjectionAsset | undefined
  try {
    projection = restoreProjectionAsset(gltf.scene)
    projection.setMode('tsl')
  } catch (error) {
    projection?.dispose()
    disposeScene(gltf.scene)
    throw error
  }
  let disposed = false
  return {
    ...projection,
    dispose() {
      if (disposed) return
      disposed = true
      projection.dispose()
      gltf.scene.removeFromParent()
      disposeScene(gltf.scene)
    },
  }
}
