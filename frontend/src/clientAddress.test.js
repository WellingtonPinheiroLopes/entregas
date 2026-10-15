import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeClientViaCep } from './clientAddress.js'

test('CEP preenche os campos regionais disponíveis e preserva quadra, lote e observação', () => {
  const current = { nome: 'Ana', endereco: '', quadra: 'Q7', lote: 'L2', observacao: 'Portão azul' }
  assert.deepEqual(mergeClientViaCep(current, { logradouro: 'Rua das Flores', bairro: 'Centro', localidade: 'São Paulo', uf: 'sp' }), {
    ...current, endereco: 'Rua das Flores', setor: 'Centro', cidade: 'São Paulo', estado: 'SP',
  })
  assert.deepEqual(mergeClientViaCep(current, {}), current)
})

test('campos ausentes na resposta de CEP mantêm valores que podem ser ajustados manualmente', () => {
  const current = { endereco: 'Rua manual', setor: 'Meu bairro', cidade: 'Minha cidade', estado: 'AC', quadra: 'Q7', lote: 'L2', observacao: 'Portão azul' }
  assert.deepEqual(mergeClientViaCep(current, { logradouro: '', bairro: '', localidade: '', uf: '' }), current)
})
