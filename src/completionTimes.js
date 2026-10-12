export function completionTimes(form, original, isTechnician, now = new Date()) {
  if (isTechnician) return {
    finish_now: true,
    repair_finished_at: undefined,
    stopped_at: original.stopped_at || null,
    restored_at: null,
  }
  // La API recibe fechas locales de Ecuador (UTC-5), sin sufijo de zona.
  const finished = new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 19)
  return {
    repair_finished_at: finished.slice(0, 16),
    stopped_at: form.stopped_at || null,
    restored_at: form.restored_at || null,
  }
}
