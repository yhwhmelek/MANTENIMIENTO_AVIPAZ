import {useEffect, useRef, useState} from 'react'

export default function MachinePhoto({apiUrl, token, machineId, name}) {
  const host = useRef(null)
  const [visible, setVisible] = useState(false)
  const [photo, setPhoto] = useState(null)
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    })
    if (host.current) observer.observe(host.current)
    return () => observer.disconnect()
  }, [machineId])
  useEffect(() => {
    setPhoto(null)
    if (!machineId || !visible) return
    const controller = new AbortController()
    let url
    fetch(`${apiUrl}/maquinas/${machineId}/imagen`, {headers:{Authorization:`Bearer ${token}`}, signal:controller.signal})
      .then(async response => {
        if (!response.ok) return
        const blob = await response.blob()
        if (controller.signal.aborted) return
        url = URL.createObjectURL(blob)
        setPhoto({url, machineId})
      }).catch(() => {})
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url) }
  }, [apiUrl, token, machineId, visible])
  if (!machineId) return null
  return <div ref={host} className="request-machine-photo">
    {photo?.machineId === machineId ? <a href={photo.url} target="_blank" rel="noreferrer" aria-label={`Ampliar foto de ${name || 'la máquina'}`}><img src={photo.url} alt={`Máquina: ${name || machineId}`} onError={() => setPhoto(null)} /></a> : <span>Foto de máquina no disponible</span>}
  </div>
}
