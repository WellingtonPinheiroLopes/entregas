import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeClientViaCep } from './clientAddress.js'

test('CEP preenche o logradouro disponível e preserva quadra, lote e observação', () => {
  const current = { nome: 'Ana', endereco: '', quadra: 'Q7', lote: 'L2', observacao: 'Portão azul' }
  assert.deepEqual(mergeClientViaCep(current, { logradouro: 'Rua das Flores' }), { ...current, endereco: 'Rua das Flores' })
  assert.deepEqual(mergeClientViaCep(current, {}), current)
})
