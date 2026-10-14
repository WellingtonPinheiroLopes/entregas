import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lookupCep, mergeStreetResult, mergeViaCep } from './address.js'

test('ViaCEP retorna endereço, cidade e UF e preserva número, quadra e lote', async () => {
  const current = { endereco: 'Rascunho', setor: 'Setor manual', cidade: '', estado: '', numero: '17', quadra: 'Q2', lote: 'L3' }
  const address = await lookupCep('01001000', async () => ({ ok: true, json: async () => ({ logradouro: 'Praça da Sé', bairro: 'Sé', localidade: 'São Paulo', uf: 'SP' }) }))
  assert.deepEqual(mergeViaCep(current, address), { ...current, endereco: 'Praça da Sé', setor: 'Sé', cidade: 'São Paulo', estado: 'SP' })
  assert.deepEqual(mergeViaCep(current, {}), current)
})

test('CEP inexistente e indisponibilidade retornam erros claros sem alterar o rascunho', async () => {
  await assert.rejects(lookupCep('00000000', async () => ({ ok: true, json: async () => ({ erro: true }) })), /CEP não encontrado/)
  await assert.rejects(lookupCep('01001000', async () => ({ ok: false })), /serviço de CEP está indisponível/)
})

test('selecionar resultado preenche dados disponíveis e preserva número, quadra e lote', () => {
  const current = { cep: '', endereco: '', setor: '', cidade: 'Cidade', estado: 'SP', numero: '42', quadra: 'B', lote: '09' }
  const merged = mergeStreetResult(current, { address: { road: 'Rua Central', postcode: '01234-567', suburb: 'Centro', city: 'Cidade Nova', 'ISO3166-2-lvl4': 'BR-RJ' } })
  assert.deepEqual(merged, { cep: '01234-567', endereco: 'Rua Central', setor: 'Centro', cidade: 'Cidade Nova', estado: 'RJ', numero: '42', quadra: 'B', lote: '09' })
  assert.deepEqual(mergeStreetResult(current, { address: { road: 'Rua sem CEP' } }), { ...current, endereco: 'Rua sem CEP' })
})
