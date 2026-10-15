import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createNavigationLinks, formatDestinationAddress, hasSufficientDestination, shareOrCopyDestination } from './deliveryNavigation.js'

const fullSnapshot = Object.freeze({
  endereco_destino: 'Rua São João', numero_destino: '25', quadra_destino: 'A', lote_destino: '03',
  setor_destino: 'Jardim América', cidade_destino: 'São Paulo', estado_destino: 'SP', cep_destino: '01001-000',
})

test('Google Maps usa destino histórico completo, trânsito de carro e codifica acentos', () => {
  const url = new URL(createNavigationLinks(fullSnapshot).googleMaps)
  assert.equal(url.origin, 'https://www.google.com')
  assert.equal(url.pathname, '/maps/dir/')
  assert.equal(url.searchParams.get('api'), '1')
  assert.equal(url.searchParams.get('destination'), 'Rua São João, 25, Quadra A, Lote 03, Jardim América, São Paulo, SP, CEP 01001-000')
  assert.equal(url.searchParams.get('travelmode'), 'driving')
  assert.equal(url.searchParams.get('dir_action'), 'navigate')
  assert.match(url.search, /%C3%A3|%C3%A9/)
})

test('endereço incompleto omite campos vazios sem inventar dados', () => {
  const snapshot = { endereco_destino: 'Rua das Flores', numero_destino: '', setor_destino: '', cidade_destino: 'Campinas', estado_destino: 'SP', cep_destino: '' }
  assert.equal(formatDestinationAddress(snapshot), 'Rua das Flores, Campinas, SP')
  assert.equal(hasSufficientDestination(snapshot), true)
  assert.equal(hasSufficientDestination({ endereco_destino: 'Rua sem referência' }), false)
  assert.equal(formatDestinationAddress({ endereco_destino: '', cidade_destino: '' }), '')
})

test('Waze recebe busca textual do endereço e não usa coordenadas inexistentes', () => {
  const url = new URL(createNavigationLinks(fullSnapshot).waze)
  assert.equal(url.origin, 'https://waze.com')
  assert.equal(url.pathname, '/ul')
  assert.equal(url.searchParams.get('q'), formatDestinationAddress(fullSnapshot))
  assert.equal(url.searchParams.get('navigate'), 'yes')
  assert.equal(url.searchParams.has('ll'), false)
})

test('compartilha pelo mecanismo nativo quando disponível', async () => {
  let shared
  const result = await shareOrCopyDestination('Rua São João, São Paulo', {
    navigatorRef: { share: async (payload) => { shared = payload } },
  })
  assert.equal(result, 'shared')
  assert.deepEqual(shared, { title: 'Endereço de destino', text: 'Rua São João, São Paulo' })
})

test('copia para área de transferência quando compartilhamento não existe', async () => {
  let copied
  const result = await shareOrCopyDestination('Rua São João, São Paulo', {
    navigatorRef: { clipboard: { writeText: async (value) => { copied = value } } },
  })
  assert.equal(result, 'copied')
  assert.equal(copied, 'Rua São João, São Paulo')
})

test('usa fallback compatível de cópia e informa quando nenhum mecanismo funciona', async () => {
  const children = []
  let execValue
  const documentRef = {
    body: {
      appendChild: (child) => children.push(child),
      removeChild: (child) => children.splice(children.indexOf(child), 1),
    },
    createElement: () => ({ style: {}, setAttribute() {}, select() {} }),
    execCommand: (command) => { execValue = command; return true },
  }
  assert.equal(await shareOrCopyDestination('Destino', { navigatorRef: {}, documentRef }), 'copied')
  assert.equal(execValue, 'copy')
  assert.equal(children.length, 0)
  await assert.rejects(shareOrCopyDestination('Destino', { navigatorRef: {}, documentRef: {} }), /Não foi possível compartilhar nem copiar/)
})

test('links usam exclusivamente o snapshot e não alteram o endereço salvo', () => {
  const before = { ...fullSnapshot }
  const links = createNavigationLinks(fullSnapshot)
  assert.match(links.googleMaps, /Rua\+S%C3%A3o\+Jo%C3%A3o/)
  assert.deepEqual(fullSnapshot, before)
  assert.equal(links.destination.includes('Endereço atual do cadastro'), false)
})
