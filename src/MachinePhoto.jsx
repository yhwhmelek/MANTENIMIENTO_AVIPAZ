import AuthenticatedPhoto from './AuthenticatedPhoto'

export default function MachinePhoto({apiUrl, token, machineId, name}) {
  if (!machineId) return null
  return <AuthenticatedPhoto key={machineId} apiUrl={apiUrl} token={token} path={`/maquinas/${machineId}/imagen`} label={`Foto de máquina: ${name || machineId}`} />
}
