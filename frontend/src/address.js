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
