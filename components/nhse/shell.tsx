"use client"

import { useEffect, useState } from "react"
import {
  Boxes,
  Cloud,
  FileCode2,
  Gauge,
  Network,
  Search,
  Shield,
  ShieldCheck,
  Terminal,
  Info,
} from "lucide-react"
import { EngineProvider, useEngine, useEngineQuery } from "./engine-context"
import { CapacityView } from "./capacity-view"
import { FilesView } from "./files-view"
import { GraphView } from "./graph-view"
import { HabitatsView } from "./habitats-view"
import { RemoteView } from "./remote-view"
import { RunView } from "./run-view"
import { SearchView } from "./search-view"
import { VerifyView } from "./verify-view"
import { SecurityView } from "./security-view"
import { formatBytes, shortHash } from "@/lib/nhse/format"
import { cn } from "@/lib/utils"

type TabId =
  | "overview"
  | "habitats"
  | "files"
  | "graph"
  | "run"
  | "search"
  | "capacity"
  | "verify"
  | "remote"
  | "security"

type HubDef = {
  id: string
  label: string
  blurb: string
  tabs: { id: TabId; label: string; does: string; icon: typeof Boxes }[]
}

/**
 * Navigation is organized so each hub answers “what is this for?”
 * and each tab answers “what does this button do?”
 */
const HUBS: HubDef[] = [
  {
    id: "start",
    label: "Start here",
    blurb: "Orientation and your project habitats",
    tabs: [
      { id: "overview", label: "Overview", does: "What this app is and how the pieces fit", icon: Info },
      { id: "habitats", label: "Habitats", does: "Create / select a project container", icon: Boxes },
      { id: "files", label: "Files", does: "Browse content-addressed files in the habitat", icon: FileCode2 },
      { id: "search", label: "Search", does: "Find habitats and content by text", icon: Search },
    ],
  },
  {
    id: "engines",
    label: "Diagnostic engines",
    blurb: "Run the 21 validators (physics, repair, NASE…)",
    tabs: [
      { id: "run", label: "Local run", does: "Execute modules inside the selected habitat", icon: Terminal },
      { id: "remote", label: "Remote jobs", does: "Submit JSON jobs to the backend engine API", icon: Cloud },
      { id: "verify", label: "Self-test", does: "Built-in 60-case NHSE verification suite", icon: ShieldCheck },
      { id: "security", label: "NASE", does: "Security agents, attestation, Tool-Gateway", icon: Shield },
    ],
  },
  {
    id: "results",
    label: "Store & structure",
    blurb: "Integrity graph and capacity of the CAS",
    tabs: [
      { id: "graph", label: "Graph", does: "Architecture / dependency graph for the habitat", icon: Network },
      { id: "capacity", label: "Capacity", does: "Bytes used, expansion factor, backend type", icon: Gauge },
    ],
  },
]

const ALL_TABS = HUBS.flatMap((h) => h.tabs)

function OverviewPanel() {
  return (
    <div className="flex flex-col gap-3 py-1">
      <section className="rounded-lg border border-border bg-card p-3">
        <h2 className="font-mono text-[12px] font-semibold tracking-tight">Ultimate Fix-It / NHSE</h2>
        <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
          This is a <span className="text-foreground">content-addressed sandbox</span> for project
          habitats plus a suite of <span className="text-foreground">diagnostic engines</span>.
          Everything below is client-side storage (IndexedDB for binaries, localStorage for small
          metadata) unless you point Remote at a backend.
        </p>
      </section>
      <section className="rounded-lg border border-border bg-card p-3">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          How to use it
        </h3>
        <ol className="mt-2 list-decimal space-y-2 pl-4 text-[12px] leading-snug text-muted-foreground">
          <li>
            <span className="text-foreground">Habitats</span> — pick or create the project container
            you want to work in.
          </li>
          <li>
            <span className="text-foreground">Files / Search</span> — inspect what is stored; hashes
            are the source of truth.
          </li>
          <li>
            <span className="text-foreground">Remote jobs</span> — run any of the 21 engines
            (thermal, geometry, repair planning, <span className="font-mono">nase-aegis</span>, …)
            by pasting a JSON payload.
          </li>
          <li>
            <span className="text-foreground">NASE</span> — read how the security agents work; then
            exercise attestation-freshness via Remote.
          </li>
          <li>
            <span className="text-foreground">Graph / Capacity</span> — see structure and how much
            storage the sandbox is using.
          </li>
        </ol>
      </section>
      <section className="rounded-lg border border-border bg-card p-3">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Engine map
        </h3>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Diagnostic engines live in the backend registry and appear under{" "}
          <span className="text-foreground">Remote</span>. Categories include physics soft-body,
          multi-agent, TCC/CDEM/RTE repair stack, thermal & optical suites, chemical/fluid,
          geometry tolerance, causal fusion, and <span className="text-foreground">NASE</span>{" "}
          security formal core.
        </p>
      </section>
    </div>
  )
}

export function Shell() {
  return (
    <EngineProvider>
      <ShellBody />
    </EngineProvider>
  )
}

function ShellBody() {
  const { engine, error } = useEngine()
  const [tab, setTab] = useState<TabId>("overview")
  const [activeId, setActiveId] = useState<string | null>(null)

  const habitats = useEngineQuery((e) => e.listHabitats(), [])
  const capacity = useEngineQuery((e) => e.capacity(), [])

  useEffect(() => {
    const list = habitats.data
    if (!list || list.length === 0) return
    if (!activeId || !list.some((item) => item.id === activeId)) setActiveId(list[0].id)
  }, [habitats.data, activeId])

  const active = (habitats.data ?? []).find((item) => item.id === activeId) ?? null
  const activeTabMeta = ALL_TABS.find((t) => t.id === tab)

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
        {activeTabMeta ? (
          <div className="mx-auto w-full max-w-2xl border-t border-border/60 px-4 py-1.5">
            <p className="font-mono text-[10px] text-muted-foreground">
              <span className="text-foreground">{activeTabMeta.label}</span>
              <span className="mx-1.5 text-muted-foreground/40">·</span>
              {activeTabMeta.does}
            </p>
          </div>
        ) : null}
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-3">
        {!engine ? (
          <p className="py-16 text-center font-mono text-xs text-muted-foreground">
            opening container…
          </p>
        ) : tab === "overview" ? (
          <OverviewPanel />
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
        ) : tab === "security" ? (
          <SecurityView />
        ) : !activeId ? (
          <p className="py-16 text-center font-mono text-xs text-muted-foreground">
            select a habitat first (Start here → Habitats)
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
        aria-label="App sections"
      >
        <div className="mx-auto w-full max-w-2xl space-y-1.5 px-2 py-1.5">
          {HUBS.map((hub) => (
            <div key={hub.id}>
              <div className="flex items-baseline justify-between gap-2 px-1 pb-0.5">
                <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted-foreground/70">
                  {hub.label}
                </p>
                <p className="truncate font-mono text-[8px] text-muted-foreground/45">{hub.blurb}</p>
              </div>
              <ul className="scroll-panel flex gap-1 overflow-x-auto">
                {hub.tabs.map(({ id, label, icon: Icon }) => {
                  const selected = tab === id
                  return (
                    <li key={id} className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => setTab(id)}
                        aria-current={selected ? "page" : undefined}
                        title={ALL_TABS.find((t) => t.id === id)?.does}
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
