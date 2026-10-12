// Operational timestamps are assigned by the server, including for older clients.
export function completionTimes() {
  return {
    finish_now: true,
    repair_started_at: undefined,
    repair_finished_at: undefined,
    stopped_at: undefined,
    restored_at: undefined,
  }
}
