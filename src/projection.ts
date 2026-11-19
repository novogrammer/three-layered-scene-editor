import { Color, MeshBasicNodeMaterial, Vector2 } from 'three/webgpu'
import type { Matrix4, Node, Texture } from 'three/webgpu'
import { Fn, If, clamp, context, float, fract, materialReference, max, mix, positionWorld, screenCoordinate, step, uniform, uv, vec3, vec4 } from 'three/tsl'

// Numeric codes are only used at the TSL uniform boundary.
export const diagnosticModes = { image: 0, bounds: 1, color: 2 } as const
export type DiagnosticMode = keyof typeof diagnosticModes

/** Backend-independent projection; the reference matrix uses WebGL's -1..1 clip Z. */
export function surfaceMaterial(image: Texture, matrix: Matrix4, color: string, projected: boolean) {
  const uniforms = {
    projectionFromWorld: uniform(matrix),
    diagnosticMode: uniform(diagnosticModes.image, 'int'),
    projectionValid: uniform(true),
    editorColor: uniform(new Color(color)),
    imageUvScale: uniform(new Vector2(1, 1)),
    imageUvOffset: uniform(new Vector2(0, 0)),
  }
  const material = new MeshBasicNodeMaterial({ map: image, transparent: true, depthWrite: false })
  // @types/three leaves material references untyped; a sampled 2D map yields vec4.
  const mapNode = materialReference('map', 'texture', material) as ReturnType<typeof materialReference> & Node<'vec4'>
  material.colorNode = Fn(() => {
    const { projectedUV, valid } = projected ? (() => {
      // Perpendicular surfaces need perspective division per fragment.
      const clip = uniforms.projectionFromWorld.mul(vec4(positionWorld, 1)).toVar()
      const ndc = clip.xyz.div(max(clip.w, 0.000001)).toVar()
      return {
        projectedUV: ndc.xy.mul(0.5).add(0.5).toVar(),
        valid: clip.w.greaterThan(0).and(ndc.z.greaterThanEqual(-1)).and(ndc.z.lessThanEqual(1)),
      }
    })() : { projectedUV: uv(), valid: uniforms.projectionValid }
    const inside = valid.and(projectedUV.x.greaterThanEqual(0)).and(projectedUV.x.lessThanEqual(1))
      .and(projectedUV.y.greaterThanEqual(0)).and(projectedUV.y.lessThanEqual(1))
    // Frame diagnostics use unmodified frame UVs. Cover and edge extension apply to sampling only.
    const imageUV = projectedUV.mul(uniforms.imageUvScale).add(uniforms.imageUvOffset)
    const sample = context(mapNode, { getUV: () => clamp(imageUV, 0, 1) }).toVar()
    const result = vec4(sample).toVar()

    If(uniforms.diagnosticMode.equal(diagnosticModes.color), () => {
      result.assign(vec4(uniforms.editorColor, 0.65))
    }).ElseIf(valid.not(), () => {
      uniforms.diagnosticMode.equal(diagnosticModes.image).discard()
      result.assign(vec4(0.8, 0.12, 0.24, 0.85))
    }).ElseIf(uniforms.diagnosticMode.equal(diagnosticModes.bounds), () => {
      If(inside.not(), () => {
        const hatch = step(0.5, fract(screenCoordinate.x.add(screenCoordinate.y).div(12)))
        result.assign(vec4(mix(vec3(0.32, 0.08, 0.14), vec3(1, 0.34, 0.18), hatch), 0.85))
      }).Else(() => {
        result.assign(vec4(mix(sample.rgb, uniforms.editorColor, 0.25), max(sample.a, float(0.35))))
      })
    })
    return result
  })()
  return { material, uniforms, mapNode, projected }
}
