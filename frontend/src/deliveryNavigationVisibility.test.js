import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { canTraceDelivery } from './deliveryNavigation.js'

const source = await readFile(new URL('./Deliveries.jsx', import.meta.url), 'utf8')
const recordSearchSource = await readFile(new URL('./RecordSearch.jsx', import.meta.url), 'utf8')
const backendSource = await readFile(new URL('../../backend/src/deliveries.js', import.meta.url), 'utf8')

test('clientes e entregadores exibem nomes sem IDs técnicos, mantendo IDs para seleção e gravação', () => {
  assert.doesNotMatch(recordSearchSource, /selected\.nome\} · #\$\{selected\.id\}/)
  assert.doesNotMatch(recordSearchSource, /<span>#\$\{record\.id\}/)
  assert.match(recordSearchSource, /key=\{record\.id\}/)
  assert.match(recordSearchSource, /onClick=\{\(\) => select\(record\)\}/)
  assert.doesNotMatch(source, /#\$\{item\.cliente_id\}|#\$\{item\.entregador_id\}/)
  assert.doesNotMatch(source, /· #\$\{detail\.entrega\.cliente_id\}|· #\$\{detail\.entrega\.entregador_id\}/)
  assert.match(source, /cliente_id: String\(client\.id\)/)
  assert.match(source, /entregador_id: String\(deliverer\.id\)/)
  assert.match(source, /JSON\.stringify\(payload\)/)
  assert.match(source, /Entrega #\$\{detail\.entrega\.id\}/)
})

test('navegação também exige que a entrega esteja atribuída ao usuário atual', () => {
  assert.match(source, /const terminal = detail && \['concluida', 'cancelada'\]\.includes\(detail\.entrega\.status\)/)
  assert.match(source, /const detailMine = isAdmin \|\| detail\?\.entrega\.atribuida_a_mim === true/)
  assert.match(source, /const canTraceRoute = detail && detailMine && canTraceDelivery\(detail\.entrega\.status\)/)
  assert.match(source, /\{canTraceRoute && <section className="delivery-navigation"/)
  assert.match(source, /delivery-navigation-google/)
  assert.match(source, /delivery-navigation-waze/)
})

test('na farmácia e em trânsito permitem navegação; concluída e cancelada bloqueiam', () => {
  assert.equal(canTraceDelivery('na_farmacia'), true)
  assert.equal(canTraceDelivery('em_transito'), true)
  assert.equal(canTraceDelivery('concluida'), false)
  assert.equal(canTraceDelivery('cancelada'), false)
})

test('as opções Google Maps e Waze só existem dentro da seção guardada pelo status', () => {
  const start = source.indexOf('{canTraceRoute && <section className="delivery-navigation"')
  const end = source.indexOf('</section>}', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const guardedNavigation = source.slice(start, end)
  assert.match(guardedNavigation, /Traçar rota/)
  assert.match(guardedNavigation, />Google Maps<\/a>/)
  assert.match(guardedNavigation, />Waze<\/a>/)
})

test('conclusão e cancelamento recarregam os detalhes sem exigir atualização manual', () => {
  const statusAction = source.slice(source.indexOf('async function updateStatus'), source.indexOf('async function confirmReturnToPharmacy'))
  const cancelAction = source.slice(source.indexOf('async function cancelDelivery'), source.indexOf('const missingClientFields'))
  assert.match(statusAction, /if \(detail\) await openDetail\(deliveryId\)/)
  assert.match(cancelAction, /if \(detail\) await openDetail\(deliveryId\)/)
})

test('cadastro aceita entrega sem entregador e indica a atribuição pendente na lista e no detalhe', () => {
  const saveAction = source.slice(source.indexOf('async function save'), source.indexOf('async function openDetail'))
  assert.doesNotMatch(saveAction, /!form\.entregador_id/)
  assert.match(source, /endpoint="\/deliverers" label="Entregador"[^>]*onExpired=\{onExpired\} \/>/)
  assert.match(source, /item\.entregador_nome \|\| ['"]Aguardando entregador/)
  assert.match(source, /atribuida_a_mim/)
})

test('entregador pode pedir conclusão apenas da própria entrega em trânsito com confirmação', () => {
  assert.match(source, /detail\.entrega\.status === 'em_transito' && \(isAdmin \|\| \(isDeliverer && detailMine\)\)/)
  assert.match(source, /isDeliverer \? openStatusConfirmation\('concluida'\) : updateStatus\('concluida'\)/)
  assert.match(source, /Confirma que esta entrega foi realizada\?/)
  assert.match(source, /onDeliveryChange\(\)/)
  assert.match(source, /async function openDetail\(id\)/)
})

test('ações cadastrais e de administração são ocultas para entregadores', () => {
  assert.match(source, /isAdmin && <button type="button" className="secondary-button delivery-action-edit"/)
  assert.match(source, /!terminal && \(isAdmin \|\| \(isDeliverer && detailMine\)\)/)
  assert.match(source, /detail\.entrega\.status === 'em_transito' && \(isAdmin \|\| \(isDeliverer && detailMine\)\) && <button type="button" className="submit-button account-submit delivery-action-complete"/)
  assert.match(source, /!detail\.entrega\.pre_visualizacao/)
  assert.match(source, /window\.setInterval\(refreshVisibleData, 30000\)/)
  assert.match(source, /window\.addEventListener\('focus', refreshVisibleData\)/)
  assert.match(source, /catch\(\(requestError\) => \{ setDetail\(null\); setError\(requestError\.message\) \}/)
})

test('prévia de entrega não atribuída oculta cliente, endereço e navegação', () => {
  assert.match(source, /item\.pre_visualizacao \? '—'/)
  assert.match(source, /item\.pre_visualizacao \? 'Após atribuição' : addressSummary\(item\)/)
  assert.match(source, /!detail\.entrega\.pre_visualizacao && <><div className="delivery-full-row"><span>Endereço de destino/)
  assert.match(backendSource, /id: row\.id, status: row\.status, descricao: row\.descricao, criado_em: row\.criado_em/)
  assert.match(backendSource, /status = 'na_farmacia' AND entregador_id IS NULL/)
  assert.match(backendSource, /assignedFilters = \['e\.entregador_id = \?'\]/)
  assert.match(backendSource, /WHERE id = \? AND status = 'na_farmacia' AND entregador_id IS NULL/)
})
