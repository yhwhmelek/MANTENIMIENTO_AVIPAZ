import {useRef, useState} from 'react'
import {Camera, Paperclip} from 'lucide-react'

export default function ImageAttachment({label, name, accept='image/jpeg,image/png,image/webp', onChange, help}) {
  const gallery=useRef(null), camera=useRef(null)
  const [source,setSource]=useState('gallery'), [filename,setFilename]=useState('')
  function select(event,origin){
    const file=event.target.files?.[0]
    if(!file)return
    setSource(origin);setFilename(file.name)
    const other=origin==='camera'?gallery.current:camera.current
    if(other)other.value=''
    onChange?.(event)
  }
  return <div className="full-field image-attachment">
    <span className="attachment-label">{label}</span>
    <div className="request-toolbar">
      <button type="button" className="secondary-action" onClick={()=>gallery.current?.click()}><Paperclip size={16}/> Seleccionar archivo</button>
      <button type="button" className="secondary-action" onClick={()=>camera.current?.click()}><Camera size={16}/> Tomar foto</button>
    </div>
    <input ref={gallery} hidden name={source==='gallery'?name:undefined} type="file" accept={accept} aria-label={`${label}: seleccionar archivo`} onChange={event=>select(event,'gallery')}/>
    <input ref={camera} hidden name={source==='camera'?name:undefined} type="file" accept="image/*" capture="environment" aria-label={`${label}: tomar foto`} onChange={event=>select(event,'camera')}/>
    {filename&&<span role="status">Archivo seleccionado: {filename}</span>}
    {help&&<span className="field-help">{help}</span>}
    <span className="field-help">En dispositivos compatibles, «Tomar foto» abre la cámara. Si el navegador no lo admite, permite seleccionar una imagen.</span>
  </div>
}
