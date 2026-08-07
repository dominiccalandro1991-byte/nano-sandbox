"use client"

import { useEngine, useEngineQuery } from "./engine-context"
import { ActionButton, Bar, EmptyState, Metric, Panel, Tag } from "./primitives"
import { formatBytes, formatCount, formatPercent, formatWhen } from "@/lib/nhse/format"

export function CapacityView({ habitatId }: { habitatId: string }) {
  const { engine, refresh } = useEngine()
  const capacity = useEngineQuery((e) => e.capacity(), [])
  const predictor = useEngineQuery((e) => e.predictorStats(habitatId), [habitatId])
  const governor = engine?.governorStats() ?? null
  const model = capacity.data

  return (
    <div className="flex flex-col gap-3">
      <Panel
        title="Effective capacity"
        hint="C_eff = S / r, where r = physical ÷ logical"
      >
        {!model ? (
          <EmptyState>Measuring store…</EmptyState>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Signature element: the expansion readout. */}
            <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                expansion factor
              </p>
              <p className="tabnum font-mono text-4xl leading-none text-primary">
                {model.expansionFactor.toFixed(1)}×
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                {formatBytes(model.storageBudgetBytes)} of physical budget behaves like{" "}
                {formatBytes(model.effectiveCapacityBytes)} of habitat content at the measured
                ratio r = {model.ratio.toFixed(4)}.
              </p>
              <div className="mt-3">
                <Bar ratio={model.ratio} />
                <p className="tabnum mt-1 font-mono text-[10px] text-muted-foreground">
                  r target band 0.04 – 0.15 · measured {formatPercent(model.ratio, 2)}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Metric label="logical" value={formatBytes(model.logicalBytes)} sub="as referenced" />
              <Metric label="physical" value={formatBytes(model.physicalBytes)} sub="on device" />
              <Metric
                label="dedup saved"
                value={formatBytes(model.dedupSavedBytes)}
                sub="identical content"
              />
              <Metric
                label="compression"
                value={formatPercent(
                  1 - model.physicalBytes / Math.max(1, model.uniqueRawBytes),
                  1,
                )}
                sub="on unique bytes"
              />
              <Metric label="blobs" value={formatCount(model.blobCount)} />
              <Metric label="objects" value={formatCount(model.objectCount)} />
            </div>
          </div>
        )}
      </Panel>

      <Panel
        title="Working set"
        hint="Governor keeps resident bytes under budget"
        action={
          <ActionButton
            onClick={() => {
              engine?.governor.clear()
              refresh()
            }}
          >
            drop
          </ActionButton>
        }
      >
        {!governor ? (
          <EmptyState>Governor not armed.</EmptyState>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <Bar
                ratio={governor.residentBytes / Math.max(1, governor.budgetBytes)}
                tone={governor.pressure > 0.85 ? "fault" : "primary"}
              />
              <p className="tabnum mt-1 font-mono text-[10px] text-muted-foreground">
                {formatBytes(governor.residentBytes)} / {formatBytes(governor.budgetBytes)} resident ·
                pressure {formatPercent(governor.pressure)}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Metric label="resident" value={formatCount(governor.residentCount)} sub="materialized" />
              <Metric
                label="hit rate"
                value={formatPercent(governor.hitRate, 1)}
                emphasis
                sub={`${formatCount(governor.hits)} hit / ${formatCount(governor.misses)} miss`}
              />
              <Metric label="evictions" value={formatCount(governor.evictions)} />
              <Metric
                label="predictor"
                value={predictor.data ? formatPercent(predictor.data.hitRate, 1) : "—"}
                sub={
                  predictor.data
                    ? `${formatCount(predictor.data.transitions)} transitions`
                    : "warming"
                }
              />
            </div>
            {governor.events.length > 0 ? (
              <ul className="scroll-panel max-h-44 overflow-y-auto rounded-md border border-border bg-background p-2.5">
                {[...governor.events]
                  .reverse()
                  .slice(0, 24)
                  .map((event, index) => (
                    <li key={index} className="flex items-baseline gap-2 py-0.5">
                      <Tag tone={event.kind === "evict" || event.kind === "pressure" ? "fault" : "neutral"}>
                        {event.kind}
                      </Tag>
                      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
                        {event.detail}
                      </span>
                      <span className="tabnum shrink-0 font-mono text-[10px] text-muted-foreground/60">
                        {formatWhen(event.ts)}
                      </span>
                    </li>
                  ))}
              </ul>
            ) : null}
          </div>
        )}
      </Panel>
    </div>
  )
}
