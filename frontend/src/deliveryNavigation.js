const text = (value) => String(value ?? '').trim()
const digits = (value) => text(value).replace(/\D/g, '')

export function formatDestinationAddress(delivery = {}) {
  const cepDigits = digits(delivery.cep_destino)
  const cep = cepDigits.length === 8 ? `${cepDigits.slice(0, 5)}-${cepDigits.slice(5)}` : text(delivery.cep_destino)
  return uniqueParts([
    delivery.endereco_destino,
    delivery.numero_destino,
    delivery.quadra_destino && `Quadra ${text(delivery.quadra_destino)}`,
    delivery.lote_destino && `Lote ${text(delivery.lote_destino)}`,
    delivery.setor_destino,
    delivery.cidade_destino,
    delivery.estado_destino,
    cep && `CEP ${cep}`,
  ]).join(', ')
}

export function normalizeDestinationCep(value) {
  return digits(value)
}

export function canTraceDelivery(status) {
  return status === 'na_farmacia' || status === 'em_transito'
}

const comparisonKey = (value) => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]/g, '')

function uniqueParts(parts) {
  const seen = new Set()
  return parts.map(text).filter((part) => {
    if (!part) return false
    const key = comparisonKey(part)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function buildFallbackAddress(delivery = {}) {
  const street = text(delivery.endereco_destino)
  const city = text(delivery.cidade_destino)
  const state = text(delivery.estado_destino)
  const streetKey = comparisonKey(street)
  const cityKey = comparisonKey(city)
  const stateKey = comparisonKey(state)
  const sector = [delivery.setor_destino].map(text).find((part) => {
    const key = comparisonKey(part)
    return key && key !== streetKey && key !== cityKey && key !== stateKey
  }) || ''
  const cityValue = cityKey && cityKey !== streetKey ? city : ''
  const cityAndState = uniqueParts([cityValue, stateKey !== streetKey ? state : '']).join(' - ')
  const streetAndSector = uniqueParts([street, sector]).join(', ')
  return [streetAndSector, cityAndState].filter(Boolean).join(', ')
}

export function buildDestinationQuery(delivery = {}) {
  const cep = normalizeDestinationCep(delivery.cep_destino)
  if (cep.length === 8) {
    return `${cep.slice(0, 5)}-${cep.slice(5)}`
  }
  return buildFallbackAddress(delivery)
}

export function hasSufficientFallbackAddress(delivery = {}) {
  const street = text(delivery.endereco_destino)
  const sector = text(delivery.setor_destino)
  const city = text(delivery.cidade_destino)
  return Boolean((street && (sector || city)) || (sector && city))
}

export function createNavigationLinks(delivery = {}) {
  const destination = formatDestinationAddress(delivery)
  const isValidCep = normalizeDestinationCep(delivery.cep_destino).length === 8
  const searchQuery = buildDestinationQuery(delivery)
  const canNavigate = isValidCep || hasSufficientFallbackAddress(delivery)
  if (!canNavigate || !searchQuery) return { destination, searchQuery, isValidCep, canNavigate: false, googleMaps: null, waze: null }
  const googleParams = new URLSearchParams({ api: '1', destination: searchQuery, travelmode: 'driving', dir_action: 'navigate' })
  // Waze documents q=search_terms for textual search; coordinates are deliberately omitted.
  const wazeParams = new URLSearchParams({ q: searchQuery })
  return {
    destination,
    searchQuery,
    isValidCep,
    canNavigate: true,
    googleMaps: `https://www.google.com/maps/dir/?${googleParams.toString()}`,
    waze: `https://waze.com/ul?${wazeParams.toString()}`,
  }
}
