export default function PreventiveCoverage({machines = []}) {
  if (!machines.length) return null
  return <details className="preventive-coverage"><summary>Máquinas incluidas ({machines.length})</summary><ul>{machines.map(machine => <li key={machine.machine_id}>{machine.code} · {machine.name} · {[machine.plant, machine.tower].filter(Boolean).join(' / ')}</li>)}</ul></details>
}
