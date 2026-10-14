import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteDelivererRequest, removeDelivererFromList } from './deliverers.js'

test('a confirmação chama DELETE com CSRF para o entregador escolhido', async () => {
  let request
  const result = await deleteDelivererRequest(async (...args) => {
    request = args
    return { mensagem: 'Entregador excluído com sucesso.' }
  }, 17, 'csrf-token')

  assert.deepEqual(request, ['/deliverers/17', { method: 'DELETE', headers: { 'X-CSRF-Token': 'csrf-token' } }])
  assert.equal(result.mensagem, 'Entregador excluído com sucesso.')
})

test('após exclusão confirmada, remove somente o entregador escolhido da lista', () => {
  const items = [{ id: 1, nome: 'Ana' }, { id: 2, nome: 'Bia' }]
  assert.deepEqual(removeDelivererFromList(items, '2'), [{ id: 1, nome: 'Ana' }])
  assert.equal(items.length, 2)
})
