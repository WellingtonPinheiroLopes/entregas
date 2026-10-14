import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lookupCep, mergeStreetResult, mergeViaCep } from './address.js'

test('ViaCEP retorna endereço e preserva número, quadra, lote e dados não retornados', async () => {
  const current = { endereco: 'Rascunho', setor: 'Setor manual', numero: '17', quadra: 'Q2', lote: 'L3' }
  const address = await lookupCep('01001000', async () => ({ ok: true, json: async () => ({ logradouro: 'Praça da Sé', bairro: 'Sé' }) }))
  assert.deepEqual(mergeViaCep(current, address), { ...current, endereco: 'Praça da Sé', setor: 'Sé' })
  assert.deepEqual(mergeViaCep(current, {}), current)
})

test('CEP inexistente e indisponibilidade retornam erros claros sem alterar o rascunho', async () => {
  await assert.rejects(lookupCep('00000000', async () => ({ ok: true, json: async () => ({ erro: true }) })), /CEP não encontrado/)
  await assert.rejects(lookupCep('01001000', async () => ({ ok: false })), /serviço de CEP está indisponível/)
})

test('selecionar resultado preenche apenas endereço, CEP e setor, preservando campos manuais', () => {
  const current = { cep: '', endereco: '', setor: '', numero: '42', quadra: 'B', lote: '09' }
  const merged = mergeStreetResult(current, { address: { road: 'Rua Central', postcode: '01234-567', suburb: 'Centro' } })
  assert.deepEqual(merged, { cep: '01234-567', endereco: 'Rua Central', setor: 'Centro', numero: '42', quadra: 'B', lote: '09' })
  assert.deepEqual(mergeStreetResult(current, { address: { road: 'Rua sem CEP' } }), { ...current, endereco: 'Rua sem CEP' })
})
