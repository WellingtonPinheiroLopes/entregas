export function mergeClientViaCep(current, address) {
  const setor = address.bairro || current.setor
  const cidade = address.localidade || current.cidade
  const estado = address.uf ? address.uf.toLocaleUpperCase('pt-BR') : current.estado
  return {
    ...current,
    endereco: address.logradouro || current.endereco,
    ...(setor ? { setor } : {}),
    ...(cidade ? { cidade } : {}),
    ...(estado ? { estado } : {}),
  }
}
