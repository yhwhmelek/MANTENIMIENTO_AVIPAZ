import { useState } from 'react'
import { Eye, EyeOff, LockKeyhole, Wrench } from 'lucide-react'
import Dashboard from './Dashboard'

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')
const stored = (key) => window.sessionStorage.getItem(key) || window.localStorage.getItem(key)

function App() {
  const [view, setView] = useState('login')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [token, setToken] = useState(() => stored('access_token'))
  const [currentUser, setCurrentUser] = useState(() => { try { return JSON.parse(stored('usuario')) } catch { return null } })

  async function handleLogin(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const nombre = form.get('nombre')?.trim()
    const password = form.get('password')
    if (!nombre || !password) return setMessage('Completa tu nombre de usuario y contrasena.')
    setLoading(true); setMessage('')
    try {
      const response = await fetch(`${API_URL}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre, password }) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.detail || 'No se pudo iniciar sesion.')
      const storage = form.get('remember') === 'on' ? localStorage : sessionStorage
      const other = storage === localStorage ? sessionStorage : localStorage
      other.removeItem('access_token'); other.removeItem('usuario')
      storage.setItem('access_token', data.access_token); storage.setItem('usuario', JSON.stringify(data.usuario))
      setToken(data.access_token); setCurrentUser(data.usuario)
    } catch (error) { setMessage(error instanceof TypeError ? 'No se pudo conectar con el servidor.' : error.message) } finally { setLoading(false) }
  }

  async function handleRegister(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const nombre = form.get('nombre')?.trim(), correo = form.get('correo')?.trim(), password = form.get('password'), confirmar = form.get('confirmarPassword')
    if (!nombre || !correo || !password || !confirmar) return setMessage('Completa todos los campos.')
    if (password.length < 8) return setMessage('La contrasena debe tener al menos 8 caracteres.')
    if (password !== confirmar) return setMessage('Las contrasenas no coinciden.')
    setLoading(true); setMessage('')
    try {
      const response = await fetch(`${API_URL}/auth/registro`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre, correo, password }) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(Array.isArray(data.detail) ? 'Revisa los datos ingresados.' : data.detail || 'No se pudo crear la cuenta.')
      event.currentTarget.reset(); setView('login'); setMessage(`Cuenta creada para ${data.nombre}. Ya puedes iniciar sesion.`)
    } catch (error) { setMessage(error instanceof TypeError ? 'No se pudo conectar con el servidor.' : error.message) } finally { setLoading(false) }
  }

  function logout() {
    ;[localStorage, sessionStorage].forEach((storage) => { storage.removeItem('access_token'); storage.removeItem('usuario') })
    setToken(null); setCurrentUser(null); setMessage('')
  }

  function updateCurrentUser(user) {
    setCurrentUser(user)
    const storage = localStorage.getItem('access_token') ? localStorage : sessionStorage
    storage.setItem('usuario', JSON.stringify(user))
  }

  if (token && currentUser) return <Dashboard apiUrl={API_URL} token={token} currentUser={currentUser} onUserChange={updateCurrentUser} onLogout={logout} />

  return <main className="login-shell">
    <section className="brand-panel"><div className="brand"><span className="brand-mark"><Wrench size={22} /></span><span>Manteni</span></div><div className="panel-copy"><p className="eyebrow">OPERACIONES EN ORDEN</p><h1>El trabajo de hoy, bajo control.</h1><p>Gestiona mantenimientos, equipos y tareas desde un solo lugar.</p></div><div className="status-row"><span className="status-dot" />Sistema operativo</div></section>
    <section className="form-panel"><div className="mobile-brand brand"><span className="brand-mark"><Wrench size={20} /></span><span>Manteni</span></div><div className="login-card"><div className="login-icon"><LockKeyhole size={25} /></div><p className="eyebrow">{view === 'login' ? 'BIENVENIDO' : 'NUEVA CUENTA'}</p><h2>{view === 'login' ? 'Inicia sesion' : 'Crea tu cuenta'}</h2><p className="subtitle">{view === 'login' ? 'Ingresa tus datos para acceder.' : 'Ingresa tus datos para registrarte.'}</p>
      {view === 'login' ? <form onSubmit={handleLogin} noValidate><label htmlFor="nombre">Nombre de usuario</label><input id="nombre" name="nombre" type="text" autoComplete="username" placeholder="Nombre de usuario" /><div className="password-heading"><label htmlFor="password">Contrasena</label></div><Password id="password" name="password" visible={showPassword} toggle={() => setShowPassword(!showPassword)} /><label className="remember-row"><input type="checkbox" name="remember" /><span>Recordar mi sesion</span></label><Submit loading={loading} text="Ingresar" busy="Ingresando..." /><p className="form-message">{message}</p><p className="switch-copy">¿No tienes cuenta? <button type="button" onClick={() => { setView('register'); setMessage('') }}>Registrate</button></p></form>
      : <form className="register-form" onSubmit={handleRegister} noValidate><label>Nombre de usuario</label><input name="nombre" type="text" autoComplete="username" /><label>Correo electronico</label><input name="correo" type="email" autoComplete="email" /><label>Contrasena</label><Password name="password" visible={showPassword} toggle={() => setShowPassword(!showPassword)} /><label>Confirmar contrasena</label><input name="confirmarPassword" type={showPassword ? 'text' : 'password'} autoComplete="new-password" /><p className="account-defaults">La cuenta se creara activa con rol Usuario.</p><Submit loading={loading} text="Crear cuenta" busy="Creando..." /><p className="form-message">{message}</p><p className="switch-copy">¿Ya tienes cuenta? <button type="button" onClick={() => { setView('login'); setMessage('') }}>Inicia sesion</button></p></form>}
    </div></section>
  </main>
}

function Password({ visible, toggle, ...props }) { return <div className="password-field"><input {...props} type={visible ? 'text' : 'password'} /><button className="visibility-button" type="button" onClick={toggle} aria-label="Mostrar u ocultar contrasena">{visible ? <EyeOff size={20} /> : <Eye size={20} />}</button></div> }
function Submit({ loading, text, busy }) { return <button className="submit-button" disabled={loading}>{loading && <span className="spinner" />}{loading ? busy : text}</button> }

export default App
