import { expect, test } from 'vitest'
import { Matrix4, Texture } from 'three/webgpu'
import { surfaceMaterial } from '../src/projection.ts'

// Exercise Three.js's real reference-node updates without a browser or GPU.
test.each([false, true])('material.map is the live texture source (projected=%s)', projected => {
  const first = new Texture({ width: 1920, height: 1080 })
  const second = new Texture({ width: 1080, height: 1920 })
  const surface = surfaceMaterial(first, new Matrix4(), '#78c5b1', projected)
  try {
    expect(surface.material.map).toBe(first)
    expect(surface.material.colorNode).not.toBeNull()
    expect(surface.projected).toBe(projected)
    expect(surface).not.toHaveProperty('imageNode')
    const reference = surface.mapNode
    expect(reference.updateReference({ material: surface.material })).toBe(surface.material)
    const sample = reference.setup()
    expect(sample.isTextureNode).toBe(true)
    expect(sample.value).toBe(first)
    surface.material.map = second
    reference.updateReference({ material: surface.material })
    reference.update()
    expect(sample.value).toBe(second)
    expect(surface.material.map.image).toEqual({ width: 1080, height: 1920 })
    expect(reference.setup()).toBe(sample)
  } finally {
    surface.material.dispose(); first.dispose(); second.dispose()
  }
})

test('map references are bound to their own material and do not leak between layers', () => {
  const a = new Texture(), b = new Texture(), replacement = new Texture()
  const first = surfaceMaterial(a, new Matrix4(), '#ffffff', false)
  const second = surfaceMaterial(b, new Matrix4(), '#000000', true)
  try {
    first.mapNode.updateReference({ material: second.material })
    second.mapNode.updateReference({ material: first.material })
    const aSample = first.mapNode.setup(), bSample = second.mapNode.setup()
    expect(aSample.value).toBe(a); expect(bSample.value).toBe(b)
    second.material.map = replacement
    first.mapNode.update(); second.mapNode.update()
    expect(aSample.value).toBe(a); expect(bSample.value).toBe(replacement)
  } finally {
    first.material.dispose(); second.material.dispose(); a.dispose(); b.dispose(); replacement.dispose()
  }
})
