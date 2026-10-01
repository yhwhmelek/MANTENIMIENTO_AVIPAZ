import {useEffect, useRef, useState} from 'react'

export default function AuthenticatedPhoto({apiUrl, token, path, label}) {
  const host = useRef(null)
  const [visible, setVisible] = useState(false)
  const [photo, setPhoto] = useState(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    })
    if (host.current) observer.observe(host.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    setPhoto(null)
    setFailed(false)
    if (!visible) return
    const controller = new AbortController()
    let url
    fetch(`${apiUrl}${path}`, {headers:{Authorization:`Bearer ${token}`}, signal:controller.signal})
      .then(async response => {
        if (!response.ok) throw new Error('Foto no disponible')
        const blob = await response.blob()
        if (controller.signal.aborted) return
        url = URL.createObjectURL(blob)
        setPhoto({url, path, token})
      }).catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url) }
  }, [apiUrl, token, path, visible])
  const ready = photo?.path === path && photo?.token === token
  return <figure ref={host} className="request-photo-thumbnail">
    <figcaption>{label}</figcaption>
    <div className="request-machine-photo">
      {ready ? <a href={photo.url} target="_blank" rel="noreferrer" aria-label={`Ampliar ${label}`}><img src={photo.url} alt={label} onError={() => {setPhoto(null);setFailed(true)}} /></a> : <span>{failed ? 'Foto no disponible' : 'Cargando foto…'}</span>}
    </div>
  </figure>
}
