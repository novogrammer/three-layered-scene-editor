/** JSON persistence contract. Keep independent of the runtime editing model. */
export interface ScreenPlacementV1 {
  type: 'screen'
  /** Canvas pixels: top-left origin, +X right, +Y down. */
  rectPx: { x: number; y: number; width: number; height: number }
  /** Spatial pixels: reference-plane origin, +Z toward the camera. */
  zPx: number
}

export interface HorizontalPlacementV1 {
  type: 'surface'
  centerXPx: number
  widthPx: number
  frontZPx: number
  backZPx: number
}

export interface WallPlacementV1 {
  type: 'surface'
  centerYPx: number
  heightPx: number
  frontZPx: number
  backZPx: number
}

interface LayerBaseV1 {
  id: string
  name: string
  imageId: string
  visible: boolean
  editorColor: string
  alphaMode: 'OPAQUE' | 'BLEND'
  /** Spatial pixels: reference-plane center origin, +X right, +Y up. */
  originPx: { x: number; y: number; z: 0 }
}

export type SceneLayerV1 = LayerBaseV1 & (
  | { orientation: { relation: 'parallel'; direction: 'front' }; placement: ScreenPlacementV1 }
  | { orientation: { relation: 'perpendicular'; direction: 'down' | 'up' }; placement: HorizontalPlacementV1 }
  | { orientation: { relation: 'perpendicular'; direction: 'left' | 'right' }; placement: WallPlacementV1 }
)

export type ImageMimeTypeV1 = 'image/png' | 'image/jpeg' | 'image/webp'

export interface ImageAssetV1 {
  id: string
  name: string
  mimeType: ImageMimeTypeV1
  /** Original image bytes encoded as a base64 Data URL. */
  data: string
}

export interface SceneDocumentV1 {
  schemaVersion: 1
  composition: { width: number; height: number }
  /** Height in scene units. */
  referencePlane: { height: number }
  /** Vertical field of view in degrees. */
  projectionCamera: { fov: number }
  projection: { imageFit: 'cover'; imageAlign: 'center'; outsideImage: 'clamp' }
  /** Editor list order; later entries overlay earlier entries at equal Z. */
  layers: SceneLayerV1[]
  /** Written last to keep the editable structure above embedded image data. */
  assets: ImageAssetV1[]
}
