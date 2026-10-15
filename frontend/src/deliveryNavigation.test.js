import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buildDestinationQuery, buildFallbackAddress, createNavigationLinks, formatDestinationAddress, normalizeDestinationCep } from './deliveryNavigation.js'

const fullSnapshot = Object.freeze({
  endereco_destino: 'Rua São João', numero_destino: '25', quadra_destino: 'A', lote_destino: '03',
  setor_destino: 'Jardim América', cidade_destino: 'São Paulo', estado_destino: 'SP', cep_destino: '01001-000',
})

test('normaliza CEP com máscara e sem máscara, validando oito dígitos', () => {
  assert.equal(normalizeDestinationCep('01001-000'), '01001000')
  assert.equal(normalizeDestinationCep(' 01.001 000 '), '01001000')
  assert.equal(normalizeDestinationCep('1234567'), '1234567')
  assert.equal(normalizeDestinationCep(''), '')
})

test('Google Maps prioriza CEP e complementa com cidade, UF e endereço codificado', () => {
  const links = createNavigationLinks(fullSnapshot)
  const url = new URL(links.googleMaps)
  assert.equal(url.origin, 'https://www.google.com')
  assert.equal(url.pathname, '/maps/dir/')
  assert.equal(url.searchParams.get('api'), '1')
  assert.equal(url.searchParams.get('destination'), 'CEP 01001000, São Paulo, SP, Rua São João, Nº 25, Quadra A, Lote 03, Jardim América')
  assert.equal(url.searchParams.get('travelmode'), 'driving')
  assert.equal(url.searchParams.get('dir_action'), 'navigate')
  assert.match(url.search, /%C3%A3|%C3%A9/)
  assert.match(links.searchQuery, /^CEP 01001000, São Paulo, SP,/)
  const unmaskedUrl = new URL(createNavigationLinks({ ...fullSnapshot, cep_destino: '01001000' }).googleMaps)
  assert.equal(unmaskedUrl.searchParams.get('destination'), url.searchParams.get('destination'))
})

test('CEP ausente ou inválido usa fallback completo em vez de pesquisar somente a rua', () => {
  for (const cep of ['', '1234567', '123456789']) {
    const links = createNavigationLinks({ ...fullSnapshot, cep_destino: cep })
    assert.equal(links.isValidCep, false)
    assert.equal(links.canNavigate, true)
    assert.equal(links.searchQuery, 'Rua São João, Nº 25, Quadra A, Lote 03 - Jardim América, São Paulo - SP')
    assert.equal(new URL(links.googleMaps).searchParams.get('destination'), links.searchQuery)
    assert.equal(new URL(links.waze).searchParams.get('q'), links.searchQuery)
  }
})

test('fallback monta o formato especificado sem CEP', () => {
  const snapshot = { endereco_destino: 'Av. Joaquim Pedro Dias', setor_destino: 'Vila Adelia', cidade_destino: 'Goiânia', estado_destino: 'GO', cep_destino: '' }
  assert.equal(buildFallbackAddress(snapshot), 'Av. Joaquim Pedro Dias - Vila Adelia, Goiânia - GO')
  assert.equal(createNavigationLinks(snapshot).searchQuery, 'Av. Joaquim Pedro Dias - Vila Adelia, Goiânia - GO')
})

test('campos vazios não deixam hífens ou vírgulas, e cidade/bairro repetidos aparecem uma vez', () => {
  const snapshot = { endereco_destino: 'Rua A', numero_destino: '', quadra_destino: '', lote_destino: '', setor_destino: 'Campinas', cidade_destino: 'Campinas', estado_destino: 'SP', cep_destino: '  ' }
  assert.equal(formatDestinationAddress(snapshot), 'Rua A, Campinas, SP')
  assert.equal(buildDestinationQuery(snapshot), 'Rua A, Campinas - SP')
  assert.equal(buildFallbackAddress({ cidade_destino: 'Goiânia', estado_destino: 'GO' }), 'Goiânia - GO')
})

test('sem CEP válido, endereço insuficiente não cria URLs', () => {
  for (const snapshot of [
    {},
    { endereco_destino: 'Rua sem referência' },
    { cidade_destino: 'Goiânia', estado_destino: 'GO', cep_destino: '1234' },
  ]) {
    const links = createNavigationLinks(snapshot)
    assert.equal(links.canNavigate, false)
    assert.equal(links.googleMaps, null)
    assert.equal(links.waze, null)
  }
})

test('Waze usa busca textual por CEP, cidade e endereço sem inventar coordenadas', () => {
  const url = new URL(createNavigationLinks(fullSnapshot).waze)
  assert.equal(url.origin, 'https://waze.com')
  assert.equal(url.pathname, '/ul')
  assert.equal(url.searchParams.get('q'), 'CEP 01001000, São Paulo, SP, Rua São João, Nº 25, Quadra A, Lote 03, Jardim América')
  assert.equal(url.searchParams.has('navigate'), false)
  assert.equal(url.searchParams.has('ll'), false)
})

test('links usam exclusivamente o snapshot histórico e não alteram o endereço salvo', () => {
  const before = { ...fullSnapshot }
  const links = createNavigationLinks(fullSnapshot)
  assert.match(links.googleMaps, /CEP\+01001000/)
  assert.equal(links.searchQuery.includes('São Paulo'), true)
  assert.deepEqual(fullSnapshot, before)
})

test('menu mantém somente as opções Google Maps e Waze', async () => {
  const component = await readFile(new URL('./Deliveries.jsx', import.meta.url), 'utf8')
  assert.ok(component.includes('className="delivery-navigation-link delivery-navigation-google"'))
  assert.ok(component.includes('>Google Maps</a>'))
  assert.ok(component.includes('className="delivery-navigation-link delivery-navigation-waze"'))
  assert.ok(component.includes('>Waze</a>'))
  assert.equal(/Outro aplicativo|shareOrCopyDestination|shareDestination/.test(component), false)
})
