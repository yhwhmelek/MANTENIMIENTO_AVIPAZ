import { useState } from 'react'
import { X } from 'lucide-react'

export default function UserProfile({ apiUrl, token, user, onSaved, onClose }) {
  const [profile, setProfile] = useState({
    nombre: user.nombre || '', nombres: user.nombres || '',
    apellidos: user.apellidos || '', correo: user.correo || '',
  })
  const [passwords, setPasswords] = useState({ password_actual: '', password_nueva: '', confirmar: '' })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function saveProfile(event) {
    event.preventDefault()
    setBusy(true); setError(''); setMessage('')
    try {
      const response = await fetch(`${apiUrl}/auth/me`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Revisa los datos del perfil.')
      onSaved(data)
      setMessage('Perfil actualizado. Usa el nuevo usuario para tu próximo inicio de sesión si lo cambiaste.')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  async function changePassword(event) {
    event.preventDefault()
    if (passwords.password_nueva !== passwords.confirmar) return setError('Las contraseñas nuevas no coinciden.')
    setBusy(true); setError(''); setMessage('')
    try {
      const response = await fetch(`${apiUrl}/auth/me/password`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password_actual: passwords.password_actual, password_nueva: passwords.password_nueva }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'No se pudo cambiar la contraseña.')
      setPasswords({ password_actual: '', password_nueva: '', confirmar: '' })
      setMessage('Contraseña actualizada.')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return <div className="modal-backdrop" role="presentation"><div className="motor-modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
    <div className="modal-header"><div><p className="eyebrow">MI CUENTA</p><h2 id="profile-title">Editar mi información</h2></div><button type="button" onClick={onClose} aria-label="Cerrar perfil"><X /></button></div>
    <form onSubmit={saveProfile} className="motor-form-grid">
      <label>Usuario de acceso *<input required autoComplete="username" maxLength={100} value={profile.nombre} onChange={e => setProfile({ ...profile, nombre: e.target.value })}/></label>
      <label>Nombre<input autoComplete="given-name" maxLength={100} value={profile.nombres} onChange={e => setProfile({ ...profile, nombres: e.target.value })}/></label>
      <label>Apellido<input autoComplete="family-name" maxLength={100} value={profile.apellidos} onChange={e => setProfile({ ...profile, apellidos: e.target.value })}/></label>
      <label className="full-field">Correo electrónico *<input required type="email" autoComplete="email" value={profile.correo} onChange={e => setProfile({ ...profile, correo: e.target.value })}/></label>
      <div className="full-field"><button className="primary-action" disabled={busy}>Guardar información</button></div>
    </form>
    <h3>Cambiar contraseña</h3>
    <form onSubmit={changePassword} className="motor-form-grid">
      <label>Contraseña actual *<input required type="password" autoComplete="current-password" value={passwords.password_actual} onChange={e => setPasswords({ ...passwords, password_actual: e.target.value })}/></label>
      <label>Contraseña nueva *<input required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={passwords.password_nueva} onChange={e => setPasswords({ ...passwords, password_nueva: e.target.value })}/></label>
      <label>Confirmar contraseña *<input required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={passwords.confirmar} onChange={e => setPasswords({ ...passwords, confirmar: e.target.value })}/></label>
      <div className="full-field"><button className="secondary-action" disabled={busy}>Cambiar contraseña</button></div>
    </form>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </div></div>
}
