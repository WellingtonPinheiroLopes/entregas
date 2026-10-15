const text = (value) => String(value ?? '').trim()
const digits = (value) => text(value).replace(/\D/g, '')

export function formatDestinationAddress(delivery = {}) {
  const cepDigits = digits(delivery.cep_destino)
  const cep = cepDigits.length === 8 ? `${cepDigits.slice(0, 5)}-${cepDigits.slice(5)}` : text(delivery.cep_destino)
  return [
    delivery.endereco_destino,
    delivery.numero_destino,
    delivery.quadra_destino && `Quadra ${text(delivery.quadra_destino)}`,
    delivery.lote_destino && `Lote ${text(delivery.lote_destino)}`,
    delivery.setor_destino,
    delivery.cidade_destino,
    delivery.estado_destino,
    cep && `CEP ${cep}`,
  ].map(text).filter(Boolean).join(', ')
}

export function hasSufficientDestination(delivery = {}) {
  const street = text(delivery.endereco_destino)
  const locator = [delivery.numero_destino, delivery.quadra_destino, delivery.lote_destino, delivery.setor_destino, delivery.cidade_destino, delivery.estado_destino, delivery.cep_destino].some((part) => text(part))
  const cepComplete = digits(delivery.cep_destino).length === 8
  const cityAndState = text(delivery.cidade_destino) && text(delivery.estado_destino)
  return Boolean((street && locator) || (cepComplete && (text(delivery.cidade_destino) || text(delivery.estado_destino))) || (cityAndState && (text(delivery.setor_destino) || text(delivery.quadra_destino) || text(delivery.lote_destino))))
}

export function createNavigationLinks(delivery = {}) {
  const destination = formatDestinationAddress(delivery)
  const googleParams = new URLSearchParams({ api: '1', destination, travelmode: 'driving', dir_action: 'navigate' })
  const wazeParams = new URLSearchParams({ q: destination, navigate: 'yes' })
  return {
    destination,
    isSufficient: hasSufficientDestination(delivery),
    googleMaps: `https://www.google.com/maps/dir/?${googleParams.toString()}`,
    waze: `https://waze.com/ul?${wazeParams.toString()}`,
  }
}

export async function shareOrCopyDestination(address, { navigatorRef = globalThis.navigator, documentRef = globalThis.document } = {}) {
  if (typeof navigatorRef?.share === 'function') {
    try {
      await navigatorRef.share({ title: 'Endereço de destino', text: address })
      return 'shared'
    } catch (error) {
      if (error?.name === 'AbortError') throw error
    }
  }

  if (typeof navigatorRef?.clipboard?.writeText === 'function') {
    await navigatorRef.clipboard.writeText(address)
    return 'copied'
  }

  if (documentRef?.body && typeof documentRef.execCommand === 'function') {
    const textarea = documentRef.createElement('textarea')
    textarea.value = address
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    documentRef.body.appendChild(textarea)
    textarea.select()
    const copied = documentRef.execCommand('copy')
    documentRef.body.removeChild(textarea)
    if (copied) return 'copied'
  }

  throw new Error('Não foi possível compartilhar nem copiar o endereço neste navegador.')
}
