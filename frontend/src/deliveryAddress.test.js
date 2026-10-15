import { test } from 'node:test'
import assert from 'node:assert/strict'
import { populateDeliveryAddress, requiresClientAddressConfirmation } from './deliveryAddress.js'

test('selecionar cliente carrega os campos disponíveis no snapshot sem inventar número', () => {
  const form = { cliente_id: '', descricao: 'Pedido', numero_destino: 'preexistente' }
  const client = { id: 19, cep: '01001000', endereco: 'Praça da Sé', quadra: 'Q2', lote: 'L3', setor: 'Centro', cidade: 'São Paulo', estado: 'SP' }
  assert.deepEqual(populateDeliveryAddress(form, client), {
    ...form, cliente_id: '19', cep_destino: '01001000', endereco_destino: 'Praça da Sé', quadra_destino: 'Q2', lote_destino: 'L3',
    numero_destino: '', setor_destino: 'Centro', cidade_destino: 'São Paulo', estado_destino: 'SP',
  })
})

test('trocar cliente pede confirmação após edição manual e não a pede para seleção inicial', () => {
  const form = { cliente_id: '19' }
  assert.equal(requiresClientAddressConfirmation({ cliente_id: '' }, '19', true), false)
  assert.equal(requiresClientAddressConfirmation(form, '20', false), false)
  assert.equal(requiresClientAddressConfirmation(form, '20', true), true)
  assert.equal(requiresClientAddressConfirmation(form, '19', true), false)
})
