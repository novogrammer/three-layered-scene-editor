import * as THREE from 'three'

// MeshBasicMaterial retains Three.js's normal color-space/output pipeline.
// Only map sampling is replaced; projected coordinates are divided per fragment.
export function projectionMaterial(texture: THREE.Texture, matrix: THREE.Matrix4, color: string) {
  const uniforms = {
    projectionFromWorld: { value: matrix },
    diagnosticMode: { value: 0 },
    editorColor: { value: new THREE.Color(color) },
  }
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = `uniform mat4 projectionFromWorld;
      varying vec4 vProjected;\n${shader.vertexShader}`.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      vProjected = projectionFromWorld * modelMatrix * vec4(transformed, 1.0);`,
    )
    shader.fragmentShader = `varying vec4 vProjected;
      uniform int diagnosticMode;
      uniform vec3 editorColor;\n${shader.fragmentShader}`.replace(
      '#include <map_fragment>',
      `bool valid = vProjected.w > 0.0;
      vec3 ndc = vProjected.xyz / max(vProjected.w, 0.000001);
      valid = valid && ndc.z >= -1.0 && ndc.z <= 1.0;
      vec2 projectedUV = ndc.xy * 0.5 + 0.5;
      bool inside = valid && all(greaterThanEqual(projectedUV, vec2(0.0)))
        && all(lessThanEqual(projectedUV, vec2(1.0)));
      if (diagnosticMode == 2) {
        diffuseColor = vec4(editorColor, 0.65);
      } else if (!valid) {
        if (diagnosticMode == 0) discard;
        diffuseColor = vec4(0.8, 0.12, 0.24, 0.85);
      } else {
        vec4 sampleColor = texture2D(map, clamp(projectedUV, vec2(0.0), vec2(1.0)));
        diffuseColor *= sampleColor;
        if (diagnosticMode == 1) {
          if (!inside) {
            float hatch = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 12.0));
            diffuseColor = vec4(mix(vec3(0.32, 0.08, 0.14), vec3(1.0, 0.34, 0.18), hatch), 0.85);
          } else {
            diffuseColor.rgb = mix(diffuseColor.rgb, editorColor, 0.25);
            diffuseColor.a = max(diffuseColor.a, 0.35);
          }
        }
      }`,
    )
  }
  material.customProgramCacheKey = () => 'camera-projection-v1'
  return { material, uniforms }
}
