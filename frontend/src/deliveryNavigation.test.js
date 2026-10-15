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

test('CEP válido gera somente CEP formatado como destino no Google Maps', () => {
  const links = createNavigationLinks({ ...fullSnapshot, cep_destino: '74485440' })
  const url = new URL(links.googleMaps)
  assert.equal(url.origin, 'https://www.google.com')
  assert.equal(url.pathname, '/maps/dir/')
  assert.equal(url.searchParams.get('api'), '1')
  assert.equal(url.searchParams.get('destination'), '74485-440')
  assert.equal(url.searchParams.get('travelmode'), 'driving')
  assert.equal(url.searchParams.get('dir_action'), 'navigate')
  assert.equal(links.searchQuery, '74485-440')
  const masked = createNavigationLinks({ ...fullSnapshot, cep_destino: '74485-440' })
  assert.equal(masked.searchQuery, '74485-440')
  assert.equal(new URL(masked.googleMaps).searchParams.get('destination'), '74485-440')
})

test('CEP ausente ou inválido usa somente rua, bairro, cidade e estado', () => {
  for (const cep of ['', '1234567', '123456789']) {
    const links = createNavigationLinks({ ...fullSnapshot, cep_destino: cep })
    assert.equal(links.isValidCep, false)
    assert.equal(links.canNavigate, true)
    assert.equal(links.searchQuery, 'Rua São João, Jardim América, São Paulo - SP')
    assert.equal(new URL(links.googleMaps).searchParams.get('destination'), links.searchQuery)
    assert.equal(new URL(links.waze).searchParams.get('q'), links.searchQuery)
  }
})

test('fallback monta o formato solicitado sem CEP', () => {
  const snapshot = { endereco_destino: 'Avenida Joaquim Pedro Dias', setor_destino: 'Goiá II', cidade_destino: 'Goiânia', estado_destino: 'GO', cep_destino: '' }
  assert.equal(buildFallbackAddress(snapshot), 'Avenida Joaquim Pedro Dias, Goiá II, Goiânia - GO')
  const links = createNavigationLinks(snapshot)
  assert.equal(links.searchQuery, 'Avenida Joaquim Pedro Dias, Goiá II, Goiânia - GO')
  assert.equal(new URL(links.googleMaps).searchParams.get('destination'), links.searchQuery)
  assert.equal(new URL(links.waze).searchParams.get('q'), links.searchQuery)
  assert.match(links.googleMaps, /Goi%C3%A2/)
  assert.match(links.waze, /Goi%C3%A2/)
})

test('bairro ausente não deixa pontuação sobrando e rua/cidade/estado permanecem', () => {
  const snapshot = { endereco_destino: 'Avenida Joaquim Pedro Dias', setor_destino: '', cidade_destino: 'Goiânia', estado_destino: 'GO', cep_destino: '' }
  assert.equal(buildFallbackAddress(snapshot), 'Avenida Joaquim Pedro Dias, Goiânia - GO')
})

test('campos vazios não deixam hífens ou vírgulas, e valores duplicados aparecem uma vez', () => {
  const snapshot = { endereco_destino: 'Rua A', numero_destino: '', quadra_destino: '', lote_destino: '', setor_destino: 'Campinas', cidade_destino: 'Campinas', estado_destino: 'SP', cep_destino: '  ' }
  assert.equal(formatDestinationAddress(snapshot), 'Rua A, Campinas, SP')
  assert.equal(buildDestinationQuery(snapshot), 'Rua A, Campinas - SP')
  assert.equal(buildFallbackAddress({ cidade_destino: 'Goiânia', estado_destino: 'GO' }), 'Goiânia - GO')
})

test('quadra, lote, número e complemento nunca entram na busca, e ambos os serviços usam texto idêntico', () => {
  const links = createNavigationLinks({
    endereco_destino: 'Avenida Joaquim Pedro Dias', setor_destino: 'Goiá II', cidade_destino: 'Goiânia', estado_destino: 'GO', cep_destino: '',
    numero_destino: '99', quadra_destino: 'Q1', lote_destino: 'L2', complemento_destino: 'fundos', observacoes: 'portão azul',
  })
  const googleQuery = new URL(links.googleMaps).searchParams.get('destination')
  const wazeQuery = new URL(links.waze).searchParams.get('q')
  assert.equal(googleQuery, 'Avenida Joaquim Pedro Dias, Goiá II, Goiânia - GO')
  assert.equal(wazeQuery, googleQuery)
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

test('Waze recebe somente o CEP formatado e não inventa coordenadas', () => {
  const url = new URL(createNavigationLinks({ ...fullSnapshot, cep_destino: '74485440' }).waze)
  assert.equal(url.origin, 'https://waze.com')
  assert.equal(url.pathname, '/ul')
  assert.equal(url.searchParams.get('q'), '74485-440')
  assert.equal(url.searchParams.has('navigate'), false)
  assert.equal(url.searchParams.has('ll'), false)
})

test('links usam exclusivamente o snapshot histórico e não alteram o endereço salvo', () => {
  const before = { ...fullSnapshot }
  const links = createNavigationLinks(fullSnapshot)
  assert.equal(new URL(links.googleMaps).searchParams.get('destination'), '01001-000')
  assert.equal(new URL(links.waze).searchParams.get('q'), '01001-000')
  assert.equal(links.searchQuery.includes('São Paulo'), false)
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
