export function completionTimes(form, original, isTechnician, now = new Date()) {
  // La API recibe fechas locales de Ecuador (UTC-5), sin sufijo de zona.
  const finished = new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 19)
  return {
    repair_finished_at: isTechnician ? finished : finished.slice(0, 16),
    stopped_at: isTechnician ? original.stopped_at || null : form.stopped_at || null,
    restored_at: isTechnician ? (original.stopped_at ? finished : null) : form.restored_at || null,
  }
}
