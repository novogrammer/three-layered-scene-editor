interface RenderItem {
  id: number | null
  groupOrder: number | null
  renderOrder: number | null
  z: number | null
  object: { userData: { layerListIndex?: number } } | null
}

/** Preserve Three.js depth sorting, using list order only at equal render depth. */
export function layerRenderSort(transparent: boolean) {
  return (a: RenderItem, b: RenderItem): number => {
    const priority = (a.groupOrder ?? 0) - (b.groupOrder ?? 0) || (a.renderOrder ?? 0) - (b.renderOrder ?? 0)
    if (priority) return priority
    const depth = transparent ? (b.z ?? 0) - (a.z ?? 0) : (a.z ?? 0) - (b.z ?? 0)
    if (depth) return depth
    const aIndex = a.object?.userData.layerListIndex ?? -1
    const bIndex = b.object?.userData.layerListIndex ?? -1
    return aIndex - bIndex || (a.id ?? 0) - (b.id ?? 0)
  }
}
