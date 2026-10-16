import { useEffect, useId, useRef, useState } from 'react'

export default function RecordSearch({ api, endpoint, label, query, selected, onQueryChange, onSelect, details, disabled = false, required = false, onExpired }) {
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const rootRef = useRef(null)
  const listId = useId()

  useEffect(() => {
    if (disabled || selected || query.trim().length < 2) return undefined
    const controller = new AbortController()
    let current = true
    const timer = setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const rows = await api(`${endpoint}?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
        if (current) { setResults(rows.slice(0, 10)); setActiveIndex(-1) }
      } catch (requestError) {
        if (!current) return
        setResults([])
        if (/autenticação|sessão inválida/i.test(requestError.message)) onExpired()
        else setError(requestError.message || 'Não foi possível pesquisar. Tente novamente.')
      } finally { if (current) setLoading(false) }
    }, 250)
    return () => { current = false; clearTimeout(timer); controller.abort() }
  }, [api, disabled, endpoint, onExpired, query, selected])

  useEffect(() => {
    function closeOnOutsideClick(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [])

  function select(record) {
    onSelect(record)
    setResults([])
    setLoading(false)
    setError('')
    setOpen(false)
    setActiveIndex(-1)
  }

  function handleKeyDown(event) {
    if (event.key === 'ArrowDown' && results.length) {
      event.preventDefault(); setOpen(true); setActiveIndex((index) => (index + 1) % results.length)
    } else if (event.key === 'ArrowUp' && results.length) {
      event.preventDefault(); setOpen(true); setActiveIndex((index) => (index <= 0 ? results.length - 1 : index - 1))
    } else if (event.key === 'Enter' && open && results.length) {
      event.preventDefault(); select(results[activeIndex >= 0 ? activeIndex : 0])
    } else if (event.key === 'Escape') {
      setOpen(false); setActiveIndex(-1)
    }
  }

  const showList = open && !disabled && !selected && query.trim().length > 0
  return <div className="account-field record-search" ref={rootRef}>
    <label htmlFor={`${listId}-input`}>{label}{required ? ' *' : ''}</label>
    <input
      id={`${listId}-input`}
      type="search"
      role="combobox"
      autoComplete="off"
      aria-autocomplete="list"
      aria-expanded={showList}
      aria-controls={listId}
      aria-activedescendant={activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined}
      aria-required={required}
      required={required}
      value={query}
      disabled={disabled}
      placeholder={`Digite o nome ${label.toLocaleLowerCase('pt-BR')}`}
      onFocus={() => setOpen(true)}
      onKeyDown={handleKeyDown}
      onChange={(event) => { onQueryChange(event.target.value); setOpen(true); setError(''); setResults([]); setLoading(false) }}
    />
    {selected && <small className="record-search-selected" role="status">Selecionado: {selected.nome}{details(selected) ? ` · ${details(selected)}` : ''}</small>}
    {selected && !disabled && <button className="record-search-clear" type="button" onClick={() => onQueryChange('')} aria-label={`Limpar ${label.toLocaleLowerCase('pt-BR')} selecionado`}>Limpar seleção</button>}
    {showList && <div className="record-search-results" id={listId} role="listbox" aria-label={`Sugestões de ${label.toLocaleLowerCase('pt-BR')}`}>
      {loading && <p className="record-search-message" role="status">Pesquisando...</p>}
      {error && <p className="record-search-message error-message" role="alert">{error}</p>}
      {!loading && !error && query.trim().length < 2 && <p className="record-search-message">Digite ao menos 2 caracteres.</p>}
      {!loading && !error && query.trim().length >= 2 && results.length === 0 && <p className="record-search-message" role="status">Nenhum resultado encontrado.</p>}
      {!loading && results.map((record, index) => <button
        className={`record-search-option ${index === activeIndex ? 'record-search-option-active' : ''}`}
        id={`${listId}-option-${index}`}
        type="button"
        role="option"
        aria-selected={index === activeIndex}
        key={record.id}
        onMouseEnter={() => setActiveIndex(index)}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => select(record)}
      ><strong>{record.nome}</strong>{details(record) && <span>{details(record)}</span>}</button>)}
    </div>}
  </div>
}
