import { useState } from 'react'
import type { Tag } from '../domain/types'
export function TagPicker({
  tags,
  selected,
  onChange,
  onCreate,
}: {
  tags: Tag[]
  selected: string[]
  onChange: (ids: string[]) => void
  onCreate: (name: string) => Promise<Tag>
}) {
  const [name, setName] = useState(''),
    [extra, setExtra] = useState<Tag[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const all = [
    ...tags,
    ...extra.filter((t) => !tags.some((existing) => existing.id === t.id)),
  ]
  async function create() {
    if (!name.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const existing = all.find(
        (t) =>
          t.name.trim().toLocaleLowerCase('pt-BR') ===
          name.trim().toLocaleLowerCase('pt-BR'),
      )
      const tag = existing || (await onCreate(name.trim()))
      if (!existing) setExtra((items) => [...items, tag])
      onChange([...new Set([...selected, tag.id])])
      setName('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível criar a tag')
    } finally {
      setBusy(false)
    }
  }
  return (
    <fieldset>
      <legend>Tags opcionais</legend>
      <div className="tag-picker">
        {all.map((tag) => (
          <label key={tag.id}>
            <input
              type="checkbox"
              name="tag_ids"
              value={tag.id}
              checked={selected.includes(tag.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...selected, tag.id]
                    : selected.filter((id) => id !== tag.id),
                )
              }
            />
            {tag.name}
          </label>
        ))}
      </div>
      <div className="inline-tag">
        <input
          aria-label="Nova tag"
          value={name}
          maxLength={60}
          placeholder="Digite uma nova tag"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void create()
            }
          }}
        />
        <button
          type="button"
          className="secondary"
          disabled={busy || !name.trim()}
          onClick={() => void create()}
        >
          {busy ? 'Criando…' : '+ Criar tag'}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  )
}
