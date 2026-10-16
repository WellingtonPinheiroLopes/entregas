import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const readSource = (name) => readFile(new URL(`./${name}`, import.meta.url), 'utf8')

test('painel mostra Área de trabalho antes de Operações e remove o cartão redundante', async () => {
  const app = await readSource('App.jsx')
  const dashboard = app.slice(app.indexOf('function Dashboard'), app.indexOf('\nexport default function App'))
  assert.ok(dashboard.indexOf('className="welcome-card"') < dashboard.indexOf('<DeliveryOverview'))
  assert.equal(/workspace-card|Seu espaço de trabalho|Acesso confirmado/.test(dashboard), false)
})

test('indicadores são atalhos próprios e enviam os quatro status internos', async () => {
  const overview = await readSource('DeliveryOverview.jsx')
  for (const status of ['na_farmacia', 'em_transito', 'concluida', 'cancelada']) {
    assert.ok(overview.includes(`['${status}',`))
  }
  assert.match(overview, /<button type="button" className=\{`delivery-metric metric-\$\{status\}`\}/)
  assert.match(overview, /onClick=\{\(\) => onStatusSelect\?\.\(status\)\}/)
  assert.match(overview, /summary\?\.statuses\?\.\[status\]/)
})

test('entregador acessa painel e tela de entregas sem receber navegação administrativa', async () => {
  const app = await readSource('App.jsx')
  const dashboard = app.slice(app.indexOf('function Dashboard'), app.indexOf('\nexport default function App'))
  assert.match(dashboard, /\['administrador', 'entregador'\]\.includes\(user\.acesso\).*Entregas/)
  assert.match(dashboard, /view === 'deliveries' && \['administrador', 'entregador'\]\.includes\(user\.acesso\).*<Deliveries/)
  assert.match(dashboard, /\['administrador', 'entregador'\]\.includes\(user\.acesso\) && <DeliveryOverview/)
  assert.match(dashboard, /view === 'users' && user\.acesso === 'administrador'/)
})

test('atalhos inicializam o filtro da tabela e o filtro atual permite voltar a Todos', async () => {
  const [app, deliveries] = await Promise.all([readSource('App.jsx'), readSource('Deliveries.jsx')])
  assert.match(app, /function openDeliveries\(status = ''\)[\s\S]*setDeliveryStatusFilter\(status\)[\s\S]*setView\('deliveries'\)/)
  assert.match(app, /onStatusSelect=\{openDeliveries\}/)
  assert.match(app, /initialStatus=\{deliveryStatusFilter\}/)
  assert.match(deliveries, /status: initialStatus/)
  assert.match(deliveries, /new URLSearchParams\(Object\.entries\(filters\)/)
  assert.match(deliveries, /<option value="">Todos<\/option>/)
})

test('atalhos e filtros mantêm estados acessíveis em tamanhos responsivos', async () => {
  const css = await readSource('App.css')
  assert.match(css, /\.delivery-metric:focus-visible/)
  assert.match(css, /\.delivery-metric:hover/)
  assert.match(css, /@media \(max-width: 760px\) \{ \.delivery-metrics \{ grid-template-columns: repeat\(2/)
})
