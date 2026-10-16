import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const readSource = (name) => readFile(new URL(`./${name}`, import.meta.url), 'utf8')

test('sino consulta notificações periodicamente e mantém navegação sem URL de entrega', async () => {
  const [component, app] = await Promise.all([readSource('Notifications.jsx'), readSource('App.jsx')])
  assert.match(component, /setInterval\(\(\) => refresh\(\), 30000\)/)
  assert.match(component, /onOpenDeliveries\(\)/)
  assert.doesNotMatch(component, /\/deliveries\/\$\{.*entrega/)
  assert.match(app, /<Notifications api=\{api\} csrfToken=\{csrfToken\} onExpired=\{onExpired\} onOpenDeliveries=/)
})

test('sino mostra contador, estado vazio, data e ações de leitura', async () => {
  const component = await readSource('Notifications.jsx')
  assert.match(component, /notification-count/)
  assert.match(component, /Nenhuma notificação\./)
  assert.match(component, /formatDate\(item\.criado_em\)/)
  assert.match(component, /notifications\/\$\{id\}\/read/)
  assert.match(component, /notifications\/read-all/)
  assert.match(component, /Há uma nova entrega disponível\./)
})

test('sino permanece utilizável em telas pequenas', async () => {
  const css = await readSource('App.css')
  assert.match(css, /\.notification-control/)
  assert.match(css, /\.notifications-popover/)
  assert.match(css, /@media \(max-width:520px\) \{ \.notifications-popover/)
})
