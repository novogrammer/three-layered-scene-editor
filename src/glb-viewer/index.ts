/** Public consumer API. Copy this directory with Three.js to reuse it in another project. */
export { parseProjectionGlb, MAX_PROJECTION_GLB_BYTES } from './load'
export type { LoadedProjectionAsset, ProjectionLoadOptions } from './load'
export { restoreProjectionAsset, projectionRenderSort } from './asset'
export type { ProjectionAsset, ProjectionBinding } from './asset'
export type { ProjectionMode, Sampling, LayerInfo } from './metadata'
