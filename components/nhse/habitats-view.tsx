"use client"

import { useRef, useState } from "react"
import { useEngine, useEngineQuery } from "./engine-context"
import { ActionButton, EmptyState, Panel, Row, Tag } from "./primitives"
import { formatBytes, formatWhen, shortHash } from "@/lib/nhse/format"
import type { HabitatRecord } from "@/lib/nhse/types"

export function HabitatsView({
  activeId,
  onSelect,
}: {
  activeId: string | null
  onSelect: (id: string) => void
}) {
  const { engine, refresh } = useEngine()
  const [name, setName] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const habitats = useEngineQuery((e) => e.listHabitats(), [])
  const capacity = useEngineQuery((e) => e.capacity(), [])

  async function guard(label: string, work: () => Promise<void>) {
    if (!engine) return
    setBusy(label)
    setNotice(null)
    try {
      await work()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
      refresh()
    }
  }

  async function create() {
    const trimmed = name.trim()
    if (!engine || !trimmed) return
    await guard("create", async () => {
      const record = await engine.createHabitat(trimmed, "created on device")
      setName("")
      onSelect(record.id)
    })
  }

  async function exportHabitat(habitat: HabitatRecord) {
    if (!engine) return
    await guard("export", async () => {
      const bundle = await engine.exportHabitat(habitat.id)
      const blob = new Blob([bundle.text], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = bundle.filename
      anchor.rel = "noopener"
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      setNotice(`exported ${bundle.filename} (${formatBytes(bundle.bytes)})`)
    })
  }

  async function importFile(file: File) {
    if (!engine) return
    await guard("import", async () => {
      const text = await file.text()
      const record = await engine.importHabitat(text)
      onSelect(record.id)
      setNotice(`imported "${record.name}" — merkle chain verified`)
    })
  }

  const list = habitats.data ?? []

  return (
    <div className="flex flex-col gap-3">
      <Panel
        title="New habitat"
        hint="Sealed container: its own tree, history, and live modules."
      >
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void create()
          }}
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="habitat name"
            aria-label="Habitat name"
            className="min-h-10 rounded-md border border-input bg-background px-3 font-mono text-sm outline-none placeholder:text-muted-foreground/60 focus-visible:border-primary/60"
          />
          <div className="flex gap-2">
            <ActionButton
              type="submit"
              variant="solid"
              disabled={!name.trim() || busy !== null}
              className="flex-1"
            >
              {busy === "create" ? "creating" : "create"}
            </ActionButton>
            <ActionButton
              onClick={() => fileInput.current?.click()}
              disabled={busy !== null}
              className="flex-1"
            >
              {busy === "import" ? "verifying" : "import"}
            </ActionButton>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ""
              if (file) void importFile(file)
            }}
          />
        </form>
        {notice ? (
          <p className="mt-2 break-words font-mono text-[11px] leading-relaxed text-primary">
            {notice}
          </p>
        ) : null}
      </Panel>

      <Panel
        title="Habitats"
        hint={
          capacity.data
            ? `${list.length} containers · ${formatBytes(capacity.data.physicalBytes)} physical`
            : `${list.length} containers`
        }
      >
        {list.length === 0 ? (
          <EmptyState>No habitats yet. Create one above.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {list.map((habitat) => {
              const active = habitat.id === activeId
              return (
                <li key={habitat.id} className="flex flex-col gap-1.5">
                  <Row active={active} onClick={() => onSelect(habitat.id)}>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-mono text-sm">{habitat.name}</span>
                        {active ? <Tag tone="primary">active</Tag> : null}
                      </span>
                      <span className="tabnum truncate font-mono text-[10px] text-muted-foreground">
                        head {shortHash(habitat.head)} · {habitat.notes.length} notes ·{" "}
                        {habitat.liveModules.length} live · {formatWhen(habitat.updatedAt)}
                      </span>
                    </div>
                  </Row>
                  <div className="flex gap-2 pl-1">
                    <ActionButton
                      onClick={() => void exportHabitat(habitat)}
                      disabled={busy !== null}
                      className="flex-1"
                    >
                      export
                    </ActionButton>
                    <ActionButton
                      variant="fault"
                      disabled={busy !== null || list.length === 1}
                      onClick={() =>
                        void guard("delete", async () => {
                          await engine?.deleteHabitat(habitat.id)
                          if (activeId === habitat.id) {
                            const remaining = list.find((item) => item.id !== habitat.id)
                            if (remaining) onSelect(remaining.id)
                          }
                        })
                      }
                      className="flex-1"
                    >
                      delete
                    </ActionButton>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>
    </div>
  )
}
