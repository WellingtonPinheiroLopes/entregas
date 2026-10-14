export async function lookupCep(cep, fetcher = fetch) {
  const response = await fetcher(`https://viacep.com.br/ws/${cep}/json/`)
  if (!response.ok) throw new Error('O serviço de CEP está indisponível. Você pode preencher o endereço manualmente.')
  const result = await response.json()
  if (result.erro) throw new Error('CEP não encontrado. Confira o número ou preencha o endereço manualmente.')
  return result
}

export function mergeViaCep(current, address) {
  const state = address.uf || current.estado
  return {
    ...current,
    endereco: address.logradouro || current.endereco,
    setor: address.bairro || current.setor,
    cidade: address.localidade || current.cidade,
    estado: state ? state.toLocaleUpperCase('pt-BR') : current.estado,
  }
}

export function mergeStreetResult(current, result) {
  const address = result.address || {}
  const postcode = address.postcode ? address.postcode.replace(/\D/g, '').slice(0, 8) : ''
  const street = address.road || current.endereco
  const stateCode = address['ISO3166-2-lvl4']?.replace(/^BR-/, '') || address.state_code?.replace(/^br-?/i, '')
  const stateNames = { Acre: 'AC', Alagoas: 'AL', Amapá: 'AP', Amazonas: 'AM', Bahia: 'BA', Ceará: 'CE', 'Distrito Federal': 'DF', 'Espírito Santo': 'ES', Goiás: 'GO', Maranhão: 'MA', 'Mato Grosso': 'MT', 'Mato Grosso do Sul': 'MS', 'Minas Gerais': 'MG', Pará: 'PA', Paraíba: 'PB', Paraná: 'PR', Pernambuco: 'PE', Piauí: 'PI', 'Rio de Janeiro': 'RJ', 'Rio Grande do Norte': 'RN', 'Rio Grande do Sul': 'RS', Rondônia: 'RO', Roraima: 'RR', 'Santa Catarina': 'SC', 'São Paulo': 'SP', Sergipe: 'SE', Tocantins: 'TO' }
  const uf = stateCode || stateNames[address.state] || current.estado
  return {
    ...current,
    cep: postcode ? postcode.replace(/(\d{5})(\d)/, '$1-$2') : current.cep,
    endereco: street,
    setor: address.suburb || address.neighbourhood || address.city_district || current.setor,
    cidade: address.city || address.town || address.village || address.municipality || current.cidade,
    estado: uf.toLocaleUpperCase('pt-BR'),
  }
}
