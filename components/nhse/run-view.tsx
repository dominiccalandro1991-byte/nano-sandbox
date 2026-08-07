"use client"

import { useEffect, useState } from "react"
import { useEngine, useEngineQuery } from "./engine-context"
import { ActionButton, EmptyState, Metric, Panel, Row, Tag } from "./primitives"
import { formatMs, formatWhen } from "@/lib/nhse/format"
import { cn } from "@/lib/utils"
import type { RunResult } from "@/lib/nhse/types"

export function RunView({ habitatId }: { habitatId: string }) {
  const { engine, refresh } = useEngine()
  const [entry, setEntry] = useState<string | null>(null)
  const [result, setResult] = useState<RunResult | null>(null)
  const [running, setRunning] = useState(false)

  const habitat = useEngineQuery((e) => e.getHabitat(habitatId), [habitatId])
  const modules = habitat.data?.liveModules ?? []

  useEffect(() => {
    setResult(null)
    setEntry(null)
  }, [habitatId])

  useEffect(() => {
    if (!entry && modules.length > 0) setEntry(modules[0])
  }, [entry, modules])

  async function run() {
    if (!engine || !entry) return
    setRunning(true)
    try {
      setResult(await engine.run(habitatId, entry))
    } catch (error) {
      setResult({
        ok: false,
        entry,
        logs: [],
        error: error instanceof Error ? error.message : String(error),
        durationMs: 0,
        result: null,
      })
    } finally {
      setRunning(false)
      refresh()
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Panel
        title="Live modules"
        hint="Executed in an isolated worker with a resolver over the habitat tree"
        action={
          <ActionButton variant="solid" disabled={!entry || running} onClick={() => void run()}>
            {running ? "running" : "execute"}
          </ActionButton>
        }
      >
        {modules.length === 0 ? (
          <EmptyState>
            This habitat registers no live modules. Any file can still be committed and inspected.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {modules.map((path) => (
              <li key={path}>
                <Row active={path === entry} onClick={() => setEntry(path)}>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{path}</span>
                  {path === entry ? <Tag tone="primary">entry</Tag> : null}
                </Row>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {result ? (
        <Panel
          title="Result"
          hint={result.entry}
          action={<Tag tone={result.ok ? "primary" : "fault"}>{result.ok ? "ok" : "fault"}</Tag>}
        >
          <div className="grid grid-cols-2 gap-2">
            <Metric label="duration" value={formatMs(result.durationMs)} />
            <Metric label="log lines" value={String(result.logs.length)} />
          </div>

          {result.error ? (
            <p className="mt-3 break-words rounded-md border border-destructive/40 bg-destructive/10 p-2.5 font-mono text-[11px] leading-relaxed text-destructive">
              {result.error}
            </p>
          ) : null}

          {result.logs.length > 0 ? (
            <div className="scroll-panel mt-3 max-h-56 overflow-y-auto rounded-md border border-border bg-background p-2.5">
              {result.logs.map((line, index) => (
                <p
                  key={index}
                  className={cn(
                    "break-words font-mono text-[11px] leading-relaxed",
                    line.level === "error" && "text-destructive",
                    line.level === "warn" && "text-primary",
                    (line.level === "log" || line.level === "info") && "text-foreground/85",
                  )}
                >
                  <span className="text-muted-foreground/60">{String(index + 1).padStart(2, "0")} </span>
                  {line.text}
                </p>
              ))}
            </div>
          ) : null}

          {result.result !== undefined && result.result !== null ? (
            <pre className="scroll-panel mt-3 max-h-40 overflow-auto rounded-md border border-border bg-background p-2.5 font-mono text-[11px] leading-relaxed">
              {JSON.stringify(result.result, null, 2)}
            </pre>
          ) : null}
        </Panel>
      ) : null}

      <Panel title="Run log" hint="Persisted live-state snapshots">
        {(habitat.data?.liveState ?? []).length === 0 ? (
          <EmptyState>No runs recorded for this habitat.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {[...(habitat.data?.liveState ?? [])]
              .reverse()
              .slice(0, 12)
              .map((snapshot) => (
                <li key={snapshot.id} className="flex flex-col gap-0.5 border-l border-border pl-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-mono text-[11px]">{snapshot.entry}</span>
                    <Tag tone={snapshot.ok ? "neutral" : "fault"}>
                      {snapshot.ok ? formatMs(snapshot.durationMs) : "fault"}
                    </Tag>
                  </div>
                  <span className="tabnum font-mono text-[10px] text-muted-foreground">
                    {formatWhen(snapshot.ts)} · {snapshot.summary}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
