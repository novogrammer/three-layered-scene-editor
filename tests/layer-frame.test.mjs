import { expect, test } from 'vitest'
import { Group, Object3D, PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three'
import { applyLayerTransform } from '../src/layer-transform.ts'
import { changeOrientation, createLayerModel, defaultSettings, geometryTransform, initialLayers, moveOrigin,
  orientationFor, reconfigureScene, referenceMetrics, setLayerFrame, setSurfacePlacementValue } from '../src/model.ts'
import { imageAspectNotice } from '../src/image-aspect.ts'

function corners(layer) {
  const root = new Group(), plane = new Object3D()
  root.add(plane); applyLayerTransform(root, plane, layer)
  return [-0.5, 0.5].flatMap(x => [-0.5, 0.5].map(y => new Vector3(x, y, 0).applyMatrix4(plane.matrixWorld)))
}
function camera(settings) {
  const c = new PerspectiveCamera(settings.fov, settings.width / settings.height, referenceMetrics(settings).near, 10000)
  c.position.z = referenceMetrics(settings).cameraZ; c.updateMatrixWorld(true)
  return c
}

function baseLayer(direction) {
  if (direction === 'front') return initialLayers(defaultSettings)[0]
  let layer = changeOrientation(defaultSettings, initialLayers(defaultSettings)[2], orientationFor(direction))
  layer = setSurfacePlacementValue(layer, 'scene', 'frontZ', 0)
  return setSurfacePlacementValue(layer, 'scene', 'backZ', -28)
}

test.each(['front', 'down', 'up', 'left', 'right'])('%s geometry matches actual ray/plane intersections of the expanded image frame', direction => {
  let base = baseLayer(direction)
  base = moveOrigin(base, base.origin.x + 0.3, base.origin.y - 0.2)
  const before = structuredClone(base), original = corners(base), c = camera(defaultSettings)
  const plane = new Plane().setFromCoplanarPoints(original[0], original[1], original[2])
  const expanded = setLayerFrame(base, { width: 2688, height: 1350 }), actual = corners(expanded)
  const caster = new Raycaster()
  original.forEach((point, i) => {
    const ndc = point.clone().project(c)
    caster.setFromCamera(new Vector2(ndc.x * 1.4, ndc.y * 1.25), c)
    const expected = caster.ray.intersectPlane(plane, new Vector3())
    expect(expected).not.toBeNull()
    expect(actual[i].distanceTo(expected)).toBeLessThan(1e-9)
    const projected = actual[i].clone().project(c)
    expect(projected.x).toBeCloseTo(ndc.x * 1.4, 10)
    expect(projected.y).toBeCloseTo(ndc.y * 1.25, 10)
  })
  expect(expanded.origin).toEqual(base.origin)
  expect(expanded.placement).toEqual(base.placement)
  expect(structuredClone(base)).toEqual(before)
  expect(c.fov).toBe(defaultSettings.fov)
})

test.each(['down', 'up', 'left', 'right'])('%s expanded projection survives FOV and composition changes without accumulating expansion', direction => {
  const base = baseLayer(direction)
  const layer = setLayerFrame(base, { width: 2400, height: 1350 })
  const expected = corners(layer).map(p => p.project(camera(defaultSettings)))
  const next = { ...defaultSettings, width: 3840, height: 2160, fov: 60 }
  const [updated] = reconfigureScene(defaultSettings, next, [layer], 'screen')
  expect(updated.framePx).toEqual({ width: 4800, height: 2700 })
  corners(updated).forEach((p, i) => {
    p.project(camera(next))
    expect(p.x).toBeCloseTo(expected[i].x, 9)
    expect(p.y).toBeCloseTo(expected[i].y, 9)
  })
  const [restored] = reconfigureScene(next, defaultSettings, [updated], 'screen')
  expect(geometryTransform(restored)).toEqual(geometryTransform(layer))
})

test('vertical-only expansion keeps projected X and aspect notifications follow each layer frame', () => {
  const layers = initialLayers(defaultSettings), before = structuredClone(layers)
  const frame = { width: 1920, height: 1350 }, image = { ...frame }
  const expanded = setLayerFrame(layers[0], frame)
  expect(geometryTransform(expanded).width).toBe(layers[0].transform.width)
  expect(geometryTransform(expanded).height).toBe(layers[0].transform.height * 1.25)
  expect(imageAspectNotice(image, layers[0].framePx)).not.toBeNull()
  expect(imageAspectNotice(image, expanded.framePx)).toBeNull()
  expect(structuredClone(layers)).toEqual(before)
  expect(geometryTransform(setLayerFrame(expanded, layers[0].framePx))).toEqual({ ...layers[0].transform })
})

test('invalid frames and ambiguous or rear intersections never change existing placement', () => {
  const ground = initialLayers(defaultSettings)[2], before = structuredClone(ground)
  for (const frame of [{ width: 0, height: 1080 }, { width: 1920, height: -1 },
    { width: Infinity, height: 1080 }, { width: 1920, height: NaN }]) {
    expect(() => setLayerFrame(ground, frame)).toThrow('仮想枠')
  }
  const coplanar = moveOrigin(ground, 0, 0)
  expect(() => setLayerFrame(coplanar, { width: 2400, height: 1350 })).toThrow('交点')
  const rear = setSurfacePlacementValue(ground, 'scene', 'frontZ', 10)
  expect(() => setLayerFrame(rear, { width: 2400, height: 1350 })).toThrow('交点')
  expect(structuredClone(ground)).toEqual(before)
  expect(createLayerModel(defaultSettings, before).framePx).toEqual({ width: 1920, height: 1080 })
})
