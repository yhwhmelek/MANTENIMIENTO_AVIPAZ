import { criteria, levels } from './RequestPriority'

export default function PriorityCriteria() {
  return <details className="priority-criteria">
    <summary>Criterios de criticidad y pesos · Matriz N × I × C</summary>
    <div className="priority-criteria-content">
      <h2>Una misma matriz para mantenimiento y mejoras</h2>
      <p>Las solicitudes correctivas, preventivas y de mejora técnica utilizan los mismos factores, escalas y niveles de prioridad. Se evalúa la actividad solicitada.</p>
      <h3>Cálculo y pesos</h3>
      <p><strong>PR = N × I × C</strong> (puntaje de 1 a 64). Cada factor toma un valor entero de 1 a 4 y se multiplica una vez. No se utilizan porcentajes ni coeficientes adicionales. La consecuencia tiene una regla especial de escalamiento y precedencia en los desempates.</p>
      <div className="table-scroll"><table>
        <caption>Criterios para asignar los valores de cada factor</caption>
        <thead><tr><th scope="col">Valor</th>{criteria.map(([key, label]) => <th scope="col" key={key}>{label}</th>)}</tr></thead>
        <tbody>{[1, 2, 3, 4].map(value => <tr key={value}><th scope="row">{value}</th>{criteria.map(([key, , descriptions]) => <td key={key}>{descriptions[value - 1]}</td>)}</tr>)}</tbody>
      </table></div>
      <h3>Niveles de criticidad</h3>
      <div className="table-scroll"><table>
        <caption>Nivel base según el producto N × I × C</caption>
        <thead><tr><th scope="col">Puntaje PR</th><th scope="col">Nivel base</th></tr></thead>
        <tbody>{[['1–11', 'BAJO'], ['12–23', 'MEDIO'], ['24–47', 'ALTO'], ['48–64', 'CRITICO']].map(([range, level]) => <tr key={level}><td>{range}</td><td><span className={`priority-badge priority-${level}`}>{levels[level]}</span></td></tr>)}</tbody>
      </table></div>
      <p><strong>Regla obligatoria: si C = 4, el nivel final es como mínimo ALTO.</strong> Si el producto alcanza CRÍTICO, conserva ese nivel.</p>
      <p>Ejemplos: N = 2, I = 3, C = 2 → PR = 12, MEDIO. N = 1, I = 1, C = 4 → PR = 4, base BAJO y nivel final ALTO. N = 4, I = 3, C = 4 → PR = 48, CRÍTICO.</p>
      <h3>Validación y orden de atención</h3>
      <p>La preevaluación del solicitante es referencial. Mantenimiento valida los factores y establece la prioridad oficial. Una solicitud sin validación se muestra como «Sin validar», no como BAJO.</p>
      <p>El listado coloca primero las solicitudes sin validar para su revisión. Las validadas se ordenan por nivel: CRÍTICO, ALTO, MEDIO y BAJO. Dentro del mismo nivel se prioriza C, después I y después N, de mayor a menor; luego la fecha de solicitud más antigua y el identificador.</p>
      <h3>Particularidad de las mejoras técnicas</h3>
      <p>La verificación técnica y la viabilidad son requisitos adicionales para ejecutar una mejora: debe constar «Procede» o «Procede con modificaciones». Los beneficios y la viabilidad no añaden puntos ni modifican los pesos de la matriz.</p>
    </div>
  </details>
}
