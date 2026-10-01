import AuthenticatedPhoto from './AuthenticatedPhoto'
import MachinePhoto from './MachinePhoto'

export default function RequestPhotos({apiUrl, token, work}) {
  const data = work.request_data
  const paths = data.image_paths?.length ? data.image_paths : data.image_path ? [data.image_path] : []
  if (!data.machine_id && !paths.length) return null
  return <div className="request-alert-photos">
    <MachinePhoto apiUrl={apiUrl} token={token} machineId={data.machine_id} name={data.machine_name}/>
    {paths.map((path, index) => <AuthenticatedPhoto key={`${work.id}:${path}:${index}`} apiUrl={apiUrl} token={token} path={`/solicitudes-mantenimiento/${work.id}/imagenes/${index}`} label={`Foto de solicitud #${work.id} (${index + 1})`}/>)}
  </div>
}
