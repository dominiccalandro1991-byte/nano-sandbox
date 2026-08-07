"use client"

import { useEffect, useState } from "react"
import { useEngine } from "./engine-context"
import { ActionButton, EmptyState, Panel, Tag } from "./primitives"
import { formatPercent } from "@/lib/nhse/format"
import type { SearchHit } from "@/lib/nhse/types"

export function SearchView({ onOpenHabitat }: { onOpenHabitat: (id: string) => void }) {
  const { engine } = useEngine()
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!engine) return
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setHits(null)
      return
    }
    let active = true
    setBusy(true)
    const timer = setTimeout(() => {
      engine
        .search(trimmed, 24)
        .then((results) => {
          if (!active) return
          setHits(results)
          setError(null)
        })
        .catch((cause: unknown) => {
          if (active) setError(cause instanceof Error ? cause.message : String(cause))
        })
        .finally(() => {
          if (active) setBusy(false)
        })
    }, 180)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [engine, query])

  return (
    <div className="flex flex-col gap-3">
      <Panel title="Semantic search" hint="Deterministic token embeddings, ranked across all habitats">
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="search content"
            aria-label="Search query"
            autoCapitalize="off"
            autoCorrect="off"
            className="min-h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 font-mono text-sm outline-none placeholder:text-muted-foreground/60 focus-visible:border-primary/60"
          />
          {query ? <ActionButton onClick={() => setQuery("")}>clear</ActionButton> : null}
        </div>
        {error ? (
          <p className="mt-2 font-mono text-[11px] text-destructive">{error}</p>
        ) : null}
      </Panel>

      <Panel
        title="Results"
        hint={hits ? `${hits.length} hits${busy ? " · refining" : ""}` : "Type at least 2 characters"}
      >
        {!hits ? (
          <EmptyState>
            Query the store to rank paths by cosine similarity against their content embedding.
          </EmptyState>
        ) : hits.length === 0 ? (
          <EmptyState>Nothing matched. Try a broader term.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {hits.map((hit, index) => (
              <li key={`${hit.habitatId}:${hit.path}:${index}`}>
                <button
                  type="button"
                  onClick={() => onOpenHabitat(hit.habitatId)}
                  className="flex w-full flex-col gap-1 rounded-md border border-border bg-background/40 px-2.5 py-2 text-left active:bg-accent"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-xs">{hit.path}</span>
                    <Tag tone="primary">{formatPercent(hit.score, 0)}</Tag>
                  </span>
                  <span className="truncate font-mono text-[10px] text-muted-foreground">
                    {hit.habitatName}
                  </span>
                  <span className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground/80">
                    {hit.preview}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
