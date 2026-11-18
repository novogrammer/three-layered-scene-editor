import * as THREE from 'three/webgpu'
import type { Node } from 'three/webgpu'
import { Fn, clamp, context, materialReference, max, positionWorld, uniform, uv, vec2, vec4 } from 'three/tsl'
import type { Sampling } from './metadata'

export interface MapMaterial extends THREE.Material { map: THREE.Texture; color?: THREE.Color }

export function createProjectionMaterial(original: MapMaterial, sampling: Sampling, matrix: THREE.Matrix4) {
  const material = new THREE.MeshBasicNodeMaterial({ map: original.map, transparent: original.transparent,
    opacity: original.opacity, side: original.side, alphaTest: original.alphaTest, depthWrite: !original.transparent, toneMapped: false })
  material.name = original.name
  if (original.color) material.color.copy(original.color)
  const projection = uniform(matrix)
  const scale = uniform(new THREE.Vector2(...(sampling.mode === 'camera' ? sampling.imageUvScale : [1, 1] as const)))
  const offset = uniform(new THREE.Vector2(...(sampling.mode === 'camera' ? sampling.imageUvOffset : [0, 0] as const)))
  // Three's declarations leave materialReference untyped. A sampled 2D map returns vec4.
  const mapNode = materialReference('map', 'texture', material) as ReturnType<typeof materialReference> & Node<'vec4'>
  const color = uniform(material.color)
  material.colorNode = Fn(() => {
    const coordinates = sampling.mode === 'uv' ? uv() : (() => {
      const clip = projection.mul(vec4(positionWorld, 1)).toVar()
      clip.w.lessThanEqual(0).discard()
      const ndc = clip.xyz.div(max(clip.w, 0.000001)).toVar()
      ndc.z.lessThan(-1).or(ndc.z.greaterThan(1)).discard()
      const imageUV = ndc.xy.mul(0.5).add(0.5).mul(scale).add(offset)
      return vec2(imageUV.x, imageUV.y.oneMinus())
    })()
    // uv mode is already cover-fitted and top-left; never transform or flip it again.
    return context(mapNode, { getUV: () => clamp(coordinates, 0, 1) }).mul(vec4(color, 1))
  })()
  return material
}

