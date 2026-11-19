/** Engine-neutral metadata stored under this key in glTF extras (Three.js userData). */
export const GLB_PROJECTION_EXTRAS_KEY = 'threeLayeredScene'
export const GLB_PROJECTION_CAMERA_ID = 'projection-camera'

export interface GlbSceneProjectionV2 {
  version: 2
  role: 'scene'
  /** Resolve only within this GLB's scene; do not use node names as identifiers. */
  projectionCameraId: string
  composition: { width: number; height: number }
  rendering: { toneMapping: 'none' }
  projection: {
    imageFit: 'cover'
    imageAlign: 'center'
    clipDepthRange: 'minus-one-to-one'
    projectedUvOrigin: 'bottom-left'
    textureUvOrigin: 'top-left'
    outsideImage: 'clamp'
    invalidProjection: 'discard'
  }
}

export interface GlbProjectionCameraV2 {
  version: 2
  role: 'projectionCamera'
  id: string
}

interface LayerProjectionBaseV2 {
  version: 2
  role: 'layer'
  layerId: string
  framePx: { width: number; height: number }
  /** Original editor list index, usable as an equal-depth drawing tie-breaker. */
  listIndex: number
}

export type GlbLayerProjectionV2 = LayerProjectionBaseV2 & {
  sampling:
    | {
      /** TEXCOORD_0 is already an image UV: cover and V inversion are baked in. */
      mode: 'uv'
      texCoord: 0
    }
    | {
      /** Compute bottom-left UV from clip.xy / clip.w, apply cover, then invert V. */
      mode: 'camera'
      cameraId: string
      imageUvScale: [number, number]
      imageUvOffset: [number, number]
    }
}
