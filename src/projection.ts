import { Color, MeshBasicNodeMaterial, Vector2 } from 'three/webgpu'
import type { Matrix4, Texture } from 'three/webgpu'
import { Fn, If, clamp, float, fract, max, mix, positionWorld, screenCoordinate, step, texture, uniform, uv, vec3, vec4 } from 'three/tsl'

/** Backend-independent projection; the reference matrix uses WebGL's -1..1 clip Z. */
export function surfaceMaterial(image: Texture, matrix: Matrix4, color: string, projected: boolean) {
  const uniforms = {
    projectionFromWorld: uniform(matrix),
    diagnosticMode: uniform(0, 'int'),
    projectionValid: uniform(true),
    editorColor: uniform(new Color(color)),
    imageUvScale: uniform(new Vector2(1, 1)),
    imageUvOffset: uniform(new Vector2(0, 0)),
  }
  const imageNode = texture(image)
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
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
    const sample = imageNode.sample(clamp(imageUV, 0, 1)).toVar()
    const result = vec4(sample).toVar()

    If(uniforms.diagnosticMode.equal(2), () => {
      result.assign(vec4(uniforms.editorColor, 0.65))
    }).ElseIf(valid.not(), () => {
      uniforms.diagnosticMode.equal(0).discard()
      result.assign(vec4(0.8, 0.12, 0.24, 0.85))
    }).ElseIf(uniforms.diagnosticMode.equal(1), () => {
      If(inside.not(), () => {
        const hatch = step(0.5, fract(screenCoordinate.x.add(screenCoordinate.y).div(12)))
        result.assign(vec4(mix(vec3(0.32, 0.08, 0.14), vec3(1, 0.34, 0.18), hatch), 0.85))
      }).Else(() => {
        result.assign(vec4(mix(sample.rgb, uniforms.editorColor, 0.25), max(sample.a, float(0.35))))
      })
    })
    return result
  })()
  return { material, uniforms, imageNode, projected }
}
