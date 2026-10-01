import {Component} from 'react'

export default class AppErrorBoundary extends Component {
  state = {error: null}
  static getDerivedStateFromError(error) { return {error} }
  componentDidCatch(error, info) { console.error('Error al mostrar la aplicación', error, info) }
  render() {
    if (!this.state.error) return this.props.children
    return <main style={{maxWidth:640, margin:'10vh auto', padding:24}} role="alert">
      <h1>No se pudo mostrar la aplicación</h1>
      <p>Recarga la página para volver a intentar. Si el problema continúa, comparte el detalle del error.</p>
      <button type="button" className="primary-action" onClick={() => window.location.reload()}>Recargar aplicación</button>
      <details style={{marginTop:20}}><summary>Detalle del error</summary><pre style={{whiteSpace:'pre-wrap', overflowWrap:'anywhere'}}>{String(this.state.error?.message || this.state.error)}</pre></details>
    </main>
  }
}
