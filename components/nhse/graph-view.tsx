"use client"

import { useEngineQuery } from "./engine-context"
import { Bar, EmptyState, Metric, Panel, Tag } from "./primitives"
import { formatBytes } from "@/lib/nhse/format"

export function GraphView({ habitatId }: { habitatId: string }) {
  const graph = useEngineQuery((e) => e.graph(habitatId), [habitatId])
  const data = graph.data

  if (!data) {
    return (
      <Panel title="Architecture graph">
        <EmptyState>{graph.error ?? "Resolving dependency layers…"}</EmptyState>
      </Panel>
    )
  }

  const maxBytes = Math.max(1, ...data.nodes.map((node) => node.bytes))
  const byId = new Map(data.nodes.map((node) => [node.id, node]))

  return (
    <div className="flex flex-col gap-3">
      <Panel title="Topology" hint="Static import graph, layered by depth">
        <div className="grid grid-cols-2 gap-2">
          <Metric label="modules" value={String(data.nodes.length)} />
          <Metric label="edges" value={String(data.edges.length)} />
          <Metric label="layers" value={String(data.layers.length)} />
          <Metric
            label="cycles"
            value={String(data.cycles.length)}
            emphasis={data.cycles.length === 0}
            sub={data.cycles.length === 0 ? "acyclic" : "review required"}
          />
        </div>
      </Panel>

      <Panel title="Layers" hint="Layer 0 has no internal dependencies">
        {data.layers.length === 0 ? (
          <EmptyState>No resolvable modules in this habitat.</EmptyState>
        ) : (
          <ol className="flex flex-col gap-3">
            {data.layers.map((layer, index) => (
              <li key={index} className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  layer {index}
                </span>
                {layer.map((id) => {
                  const node = byId.get(id)
                  if (!node) return null
                  return (
                    <div
                      key={id}
                      className="flex flex-col gap-1 rounded-md border border-border bg-background/40 px-2.5 py-2"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-mono text-xs">{node.label}</span>
                        <span className="tabnum shrink-0 font-mono text-[10px] text-muted-foreground">
                          in {node.fanIn} · out {node.fanOut}
                        </span>
                      </div>
                      <Bar ratio={node.bytes / maxBytes} tone="muted" />
                      <span className="tabnum font-mono text-[10px] text-muted-foreground">
                        {formatBytes(node.bytes)}
                      </span>
                    </div>
                  )
                })}
              </li>
            ))}
          </ol>
        )}
      </Panel>

      {data.cycles.length > 0 ? (
        <Panel title="Cycles" hint="Edges that close a dependency loop">
          <ul className="flex flex-col gap-1.5">
            {data.cycles.map((cycle, index) => (
              <li
                key={index}
                className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-destructive"
              >
                {cycle.join(" → ")}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {data.unresolved.length > 0 ? (
        <Panel title="External" hint="Specifiers outside this habitat">
          <ul className="flex flex-col gap-1.5">
            {data.unresolved.map((item, index) => (
              <li key={index} className="flex items-center gap-2">
                <Tag>ext</Tag>
                <span className="truncate font-mono text-[11px] text-muted-foreground">
                  {item.from} → {item.specifier}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  )
}
