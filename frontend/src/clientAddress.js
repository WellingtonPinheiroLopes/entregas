export function mergeClientViaCep(current, address) {
  return { ...current, endereco: address.logradouro || current.endereco }
}
