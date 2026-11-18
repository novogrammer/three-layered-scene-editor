/** Reconcile by stable ID so deleting one plane never reassigns another plane's resources. */
export function reconcileLayerViews<T>(
  previous: ReadonlyMap<string, T>, ids: readonly string[],
  create: (id: string) => T, dispose: (view: T) => void,
): Map<string, T> {
  if (new Set(ids).size !== ids.length) throw new Error('レイヤーIDが重複しています。')
  const next = new Map<string, T>()
  const created: T[] = []
  try {
    for (const id of ids) {
      let view = previous.get(id)
      if (view === undefined) { view = create(id); created.push(view) }
      next.set(id, view)
    }
  } catch (error) {
    created.forEach(dispose)
    throw error
  }
  for (const [id, view] of previous) if (!next.has(id)) dispose(view)
  return next
}

/** Keep all previous resources alive until the replacement has been applied successfully. */
export function replaceLayerViews<T>(previous: ReadonlyMap<string, T>, ids: readonly string[],
  create: (id: string) => T, apply: (views: Map<string, T>) => void, dispose: (view: T) => void) {
  const next = reconcileLayerViews(new Map<string, T>(), ids, create, dispose)
  try { apply(next) } catch (error) {
    next.forEach(dispose)
    throw error
  }
  previous.forEach(dispose)
}
