export function populateDeliveryAddress(form, client) {
  return {
    ...form,
    cliente_id: String(client.id),
    cep_destino: client.cep || '',
    endereco_destino: client.endereco || client.logradouro || '',
    quadra_destino: client.quadra || '',
    lote_destino: client.lote || '',
    numero_destino: client.numero || '',
    setor_destino: client.setor || client.bairro || '',
    cidade_destino: client.cidade || '',
    estado_destino: client.estado || client.uf || '',
  }
}

export function requiresClientAddressConfirmation(form, clientId, addressEdited) {
  return Boolean(addressEdited && form.cliente_id && String(form.cliente_id) !== String(clientId))
}
