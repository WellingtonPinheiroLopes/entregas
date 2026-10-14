export function deleteDelivererRequest(api, id, csrfToken) {
  return api(`/deliverers/${id}`, {
    method: 'DELETE',
    headers: { 'X-CSRF-Token': csrfToken },
  })
}

export function removeDelivererFromList(items, id) {
  return items.filter((item) => String(item.id) !== String(id))
}
