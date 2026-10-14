export async function lookupCep(cep, fetcher = fetch) {
  const response = await fetcher(`https://viacep.com.br/ws/${cep}/json/`)
  if (!response.ok) throw new Error('O serviço de CEP está indisponível. Você pode preencher o endereço manualmente.')
  const result = await response.json()
  if (result.erro) throw new Error('CEP não encontrado. Confira o número ou preencha o endereço manualmente.')
  return result
}

export function mergeViaCep(current, address) {
  return { ...current, endereco: address.logradouro || current.endereco, setor: address.bairro || current.setor }
}

export function mergeStreetResult(current, result) {
  const address = result.address || {}
  const postcode = address.postcode ? address.postcode.replace(/\D/g, '').slice(0, 8) : ''
  const street = address.road || current.endereco
  return {
    ...current,
    cep: postcode ? postcode.replace(/(\d{5})(\d)/, '$1-$2') : current.cep,
    endereco: street,
    setor: address.suburb || address.neighbourhood || address.city_district || current.setor,
  }
}
