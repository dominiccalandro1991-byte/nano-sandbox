"use client"

import { useEffect, useState } from "react"
import { Boxes, Cloud, FileCode2, Gauge, Network, Search, ShieldCheck, Terminal } from "lucide-react"
import { EngineProvider, useEngine, useEngineQuery } from "./engine-context"
import { CapacityView } from "./capacity-view"
import { FilesView } from "./files-view"
import { GraphView } from "./graph-view"
import { HabitatsView } from "./habitats-view"
import { RemoteView } from "./remote-view"
import { RunView } from "./run-view"
import { SearchView } from "./search-view"
import { VerifyView } from "./verify-view"
import { formatBytes, shortHash } from "@/lib/nhse/format"
import { cn } from "@/lib/utils"

type TabId = "habitats" | "files" | "graph" | "run" | "search" | "capacity" | "verify" | "remote"

/** Three-hub navigation: Input / Upload, Engine Control, Results & Synthesis. */
const HUBS: {
  id: string
  label: string
  tabs: { id: TabId; label: string; icon: typeof Boxes }[]
}[] = [
  {
    id: "input",
    label: "Input / Upload",
    tabs: [
      { id: "habitats", label: "Habitats", icon: Boxes },
      { id: "files", label: "Files", icon: FileCode2 },
      { id: "search", label: "Search", icon: Search },
    ],
  },
  {
    id: "engines",
    label: "Engine Control",
    tabs: [
      { id: "run", label: "Run", icon: Terminal },
      { id: "remote", label: "Remote", icon: Cloud },
      { id: "verify", label: "Verify", icon: ShieldCheck },
    ],
  },
  {
    id: "results",
    label: "Results & Synthesis",
    tabs: [
      { id: "graph", label: "Graph", icon: Network },
      { id: "capacity", label: "Store", icon: Gauge },
    ],
  },
]

const TABS = HUBS.flatMap((h) => h.tabs)

export function Shell() {
  return (
    <EngineProvider>
      <ShellBody />
    </EngineProvider>
  )
}

function ShellBody() {
  const { engine, error } = useEngine()
  const [tab, setTab] = useState<TabId>("habitats")
  const [activeId, setActiveId] = useState<string | null>(null)

  const habitats = useEngineQuery((e) => e.listHabitats(), [])
  const capacity = useEngineQuery((e) => e.capacity(), [])

  useEffect(() => {
    const list = habitats.data
    if (!list || list.length === 0) return
    if (!activeId || !list.some((item) => item.id === activeId)) setActiveId(list[0].id)
  }, [habitats.data, activeId])

  const active = (habitats.data ?? []).find((item) => item.id === activeId) ?? null

  if (error) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <div className="max-w-sm rounded-lg border border-destructive/40 bg-destructive/10 p-4">
          <h1 className="font-mono text-sm text-destructive">Engine failed to start</h1>
          <p className="mt-2 break-words text-[11px] leading-relaxed text-muted-foreground">{error}</p>
        </div>
      </main>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header
        className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur-md"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex min-w-0 flex-col">
            <h1 className="font-mono text-[13px] font-semibold tracking-tight">
              Ultimate Fix-It<span className="text-primary"> / </span>
              <span className="text-muted-foreground">
                {active ? active.name : engine ? "no habitat" : "booting"}
              </span>
            </h1>
            <p className="tabnum truncate font-mono text-[10px] text-muted-foreground/70">
              {engine ? engine.backend : "—"} · head {shortHash(active?.head, 7)}
              {capacity.data
                ? ` · ${formatBytes(capacity.data.physicalBytes)} · ${capacity.data.expansionFactor.toFixed(1)}×`
                : ""}
            </p>
          </div>
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              engine ? "bg-primary" : "bg-muted-foreground animate-pulse",
            )}
            aria-hidden="true"
          />
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-3">
        {!engine ? (
          <p className="py-16 text-center font-mono text-xs text-muted-foreground">
            opening container…
          </p>
        ) : tab === "habitats" ? (
          <HabitatsView activeId={activeId} onSelect={setActiveId} />
        ) : tab === "search" ? (
          <SearchView
            onOpenHabitat={(id) => {
              setActiveId(id)
              setTab("files")
            }}
          />
        ) : tab === "verify" ? (
          <VerifyView />
        ) : tab === "remote" ? (
          <RemoteView />
        ) : !activeId ? (
          <p className="py-16 text-center font-mono text-xs text-muted-foreground">
            select a habitat first
          </p>
        ) : tab === "files" ? (
          <FilesView habitatId={activeId} />
        ) : tab === "graph" ? (
          <GraphView habitatId={activeId} />
        ) : tab === "run" ? (
          <RunView habitatId={activeId} />
        ) : (
          <CapacityView habitatId={activeId} />
        )}
      </main>

      <nav
        className="sticky bottom-0 z-20 border-t border-border bg-background/90 backdrop-blur-md"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Diagnostic hubs"
      >
        <div className="mx-auto w-full max-w-2xl px-2 py-1.5 space-y-1">
          {HUBS.map((hub) => (
            <div key={hub.id}>
              <p className="px-1 pb-0.5 font-mono text-[8px] uppercase tracking-[0.12em] text-muted-foreground/60">
                {hub.label}
              </p>
              <ul className="scroll-panel flex gap-1 overflow-x-auto">
                {hub.tabs.map(({ id, label, icon: Icon }) => {
                  const selected = tab === id
                  return (
                    <li key={id} className="flex-1 min-w-0">
                      <button
                        type="button"
                        onClick={() => setTab(id)}
                        aria-current={selected ? "page" : undefined}
                        className={cn(
                          "flex min-h-11 w-full min-w-12 flex-col items-center justify-center gap-0.5 rounded-md transition-colors",
                          selected ? "bg-primary/10 text-primary" : "text-muted-foreground active:bg-accent",
                        )}
                      >
                        <Icon className="size-3.5" aria-hidden="true" />
                        <span className="font-mono text-[8px] uppercase tracking-[0.06em]">{label}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>
    </div>
  )
}
