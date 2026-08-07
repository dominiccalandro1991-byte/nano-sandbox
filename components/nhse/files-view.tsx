"use client"

import { useEffect, useState } from "react"
import { useEngine, useEngineQuery } from "./engine-context"
import { ActionButton, EmptyState, Panel, Row, Tag } from "./primitives"
import { formatBytes, formatPercent, formatWhen, shortHash } from "@/lib/nhse/format"

export function FilesView({ habitatId }: { habitatId: string }) {
  const { engine, refresh } = useEngine()
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [loaded, setLoaded] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newPath, setNewPath] = useState("")

  const files = useEngineQuery((e) => e.listFiles(habitatId), [habitatId])
  const history = useEngineQuery((e) => e.history(habitatId, 12), [habitatId])

  useEffect(() => {
    setSelected(null)
    setDraft("")
    setLoaded(null)
    setNotice(null)
  }, [habitatId])

  useEffect(() => {
    if (!engine || !selected) return
    let active = true
    engine
      .readFile(habitatId, selected)
      .then((text) => {
        if (!active) return
        setDraft(text)
        setLoaded(text)
      })
      .catch((error: unknown) => {
        if (active) setNotice(error instanceof Error ? error.message : String(error))
      })
    return () => {
      active = false
    }
  }, [engine, habitatId, selected])

  const dirty = loaded !== null && draft !== loaded

  async function save() {
    if (!engine || !selected) return
    setBusy(true)
    setNotice(null)
    try {
      const changed = await engine.writeFile(habitatId, selected, draft, `edit ${selected}`)
      setLoaded(draft)
      setNotice(
        changed
          ? "committed — new merkle root written"
          : "identical content: deduplicated, no commit created",
      )
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
      refresh()
    }
  }

  async function createFile() {
    const path = newPath.trim().replace(/^\/+/, "")
    if (!engine || !path) return
    setBusy(true)
    setNotice(null)
    try {
      await engine.writeFile(habitatId, path, `// ${path}\n`, `create ${path}`)
      setNewPath("")
      setSelected(path)
      setNotice(`created ${path}`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
      refresh()
    }
  }

  const list = files.data ?? []
  const entry = list.find((item) => item.path === selected) ?? null
  const rawTotal = list.reduce((sum, item) => sum + item.rawSize, 0)
  const storedTotal = list.reduce((sum, item) => sum + item.storedSize, 0)

  return (
    <div className="flex flex-col gap-3">
      <Panel
        title="Tree"
        hint={`${list.length} paths · ${formatBytes(rawTotal)} logical · ${formatBytes(storedTotal)} stored`}
      >
        {list.length === 0 ? (
          <EmptyState>Empty tree. Add a file below.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {list.map((file) => (
              <li key={file.path}>
                <Row active={file.path === selected} onClick={() => setSelected(file.path)}>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate font-mono text-xs">{file.path}</span>
                    <span className="tabnum font-mono text-[10px] text-muted-foreground">
                      {shortHash(file.hash)} · {formatBytes(file.rawSize)} →{" "}
                      {formatBytes(file.storedSize)}
                    </span>
                  </div>
                  <Tag tone={file.codec === "gzip" ? "primary" : "neutral"}>{file.codec}</Tag>
                </Row>
              </li>
            ))}
          </ul>
        )}
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void createFile()
          }}
        >
          <input
            value={newPath}
            onChange={(event) => setNewPath(event.target.value)}
            placeholder="src/new-module.js"
            aria-label="New file path"
            className="min-h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 font-mono text-sm outline-none placeholder:text-muted-foreground/60 focus-visible:border-primary/60"
          />
          <ActionButton type="submit" disabled={!newPath.trim() || busy}>
            add
          </ActionButton>
        </form>
      </Panel>

      {selected ? (
        <Panel
          title="Editor"
          hint={
            entry
              ? `${selected} · ${formatPercent(entry.storedSize / Math.max(1, entry.rawSize))} of raw`
              : selected
          }
          action={
            <div className="flex items-center gap-2">
              {dirty ? <Tag tone="primary">dirty</Tag> : null}
              <ActionButton
                variant="solid"
                disabled={!dirty || busy}
                onClick={() => void save()}
              >
                {busy ? "writing" : "commit"}
              </ActionButton>
            </div>
          }
        >
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label={`Contents of ${selected}`}
            className="scroll-panel h-64 w-full resize-none rounded-md border border-input bg-background p-3 font-mono text-[13px] leading-relaxed outline-none focus-visible:border-primary/60"
          />
          <div className="mt-2 flex gap-2">
            <ActionButton
              variant="fault"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  if (!engine) return
                  setBusy(true)
                  try {
                    await engine.deleteFile(habitatId, selected)
                    setSelected(null)
                    setLoaded(null)
                    setDraft("")
                    setNotice(`removed ${selected}`)
                  } catch (error) {
                    setNotice(error instanceof Error ? error.message : String(error))
                  } finally {
                    setBusy(false)
                    refresh()
                  }
                })()
              }}
            >
              remove
            </ActionButton>
            <ActionButton
              disabled={!dirty}
              onClick={() => setDraft(loaded ?? "")}
            >
              revert
            </ActionButton>
          </div>
          {notice ? (
            <p className="mt-2 break-words font-mono text-[11px] leading-relaxed text-primary">
              {notice}
            </p>
          ) : null}
        </Panel>
      ) : null}

      <Panel title="History" hint="Append-only commit chain">
        {(history.data ?? []).length === 0 ? (
          <EmptyState>No commits yet.</EmptyState>
        ) : (
          <ol className="flex flex-col gap-2">
            {(history.data ?? []).map((item) => (
              <li key={item.hash} className="border-l border-border pl-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-mono text-xs">{item.commit.message}</span>
                  <span className="tabnum shrink-0 font-mono text-[10px] text-muted-foreground">
                    {shortHash(item.hash, 7)}
                  </span>
                </div>
                <p className="tabnum font-mono text-[10px] text-muted-foreground">
                  {formatWhen(item.commit.ts)} · +{item.added.length} ~{item.modified.length} -
                  {item.removed.length}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  )
}
