const keptPromises = []

function ensureElement(id, tag) {
  let element = document.getElementById(id)
  if (element) return element
  element = document.createElement(tag)
  element.id = id
  document.getElementById('app').appendChild(element)
  return element
}

export function set_status(text) {
  const element = ensureElement('s4-status', 'p')
  element.textContent = text
}

export function set_auth_url(url) {
  const element = ensureElement('s4-auth-url', 'a')
  element.href = url
  element.target = '_blank'
  element.textContent = 'Open PDS authorization'
}

export function set_result(text) {
  const element = ensureElement('s4-result', 'pre')
  element.textContent = text
}

export function set_error(text) {
  const element = ensureElement('s4-error', 'pre')
  element.textContent = text
}

export function keep_promise(promise) {
  keptPromises.push(promise)
  return promise
}
