"use client"

import { useState } from "react"
import { ActionButton, Bar, EmptyState, Metric, Panel, Tag } from "./primitives"
import { formatMs } from "@/lib/nhse/format"
import { TEST_COUNT, runVerificationSuite, type SuiteSummary } from "@/lib/nhse/selftest"
import type { TestResult } from "@/lib/nhse/types"

export function VerifyView() {
  const [results, setResults] = useState<TestResult[]>([])
  const [summary, setSummary] = useState<SuiteSummary | null>(null)
  const [running, setRunning] = useState(false)
  const [showPassing, setShowPassing] = useState(false)

  async function run() {
    setRunning(true)
    setResults([])
    setSummary(null)
    const collected: TestResult[] = []
    const done = await runVerificationSuite((result) => {
      collected.push(result)
      setResults([...collected])
    })
    setSummary(done)
    setRunning(false)
  }

  const failures = results.filter((item) => item.status === "fail")
  const categories = [...new Set(results.map((item) => item.category))]
  const visible = showPassing ? results : failures

  return (
    <div className="flex flex-col gap-3">
      <Panel
        title="Verification suite"
        hint={`${TEST_COUNT} cases against ephemeral in-memory engines`}
        action={
          <ActionButton variant="solid" disabled={running} onClick={() => void run()}>
            {running ? "running" : "run all"}
          </ActionButton>
        }
      >
        <div className="flex flex-col gap-3">
          <div>
            <Bar
              ratio={results.length / TEST_COUNT}
              tone={failures.length > 0 ? "fault" : "primary"}
            />
            <p className="tabnum mt-1 font-mono text-[10px] text-muted-foreground">
              {results.length} / {TEST_COUNT} executed
              {summary ? ` · ${formatMs(summary.totalMs)}` : ""}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Metric
              label="passed"
              value={String(results.filter((item) => item.status === "pass").length)}
              emphasis
            />
            <Metric label="failed" value={String(failures.length)} />
            <Metric label="groups" value={String(categories.length)} />
          </div>
          {summary ? (
            <p
              className={
                summary.failed === 0
                  ? "rounded-md border border-primary/35 bg-primary/10 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-primary"
                  : "rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-destructive"
              }
            >
              {summary.failed === 0
                ? `all ${summary.passed} cases green — engine invariants hold on this device`
                : `${summary.failed} of ${TEST_COUNT} cases failed`}
            </p>
          ) : null}
        </div>
      </Panel>

      <Panel
        title={showPassing ? "All cases" : "Failures"}
        hint={`${visible.length} shown`}
        action={
          <ActionButton onClick={() => setShowPassing((value) => !value)}>
            {showPassing ? "failures" : "show all"}
          </ActionButton>
        }
      >
        {results.length === 0 ? (
          <EmptyState>
            Nothing executed yet. The suite builds throwaway engines, so your habitats are never
            touched.
          </EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState>No failures.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {visible.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-1 rounded-md border border-border bg-background/40 px-2.5 py-2"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate font-mono text-[11px]">{item.name}</span>
                  <Tag tone={item.status === "pass" ? "neutral" : "fault"}>
                    {item.status === "pass" ? formatMs(item.ms) : "fail"}
                  </Tag>
                </div>
                <p className="break-words text-[11px] leading-relaxed text-muted-foreground">
                  <span className="font-mono text-muted-foreground/60">{item.category} · </span>
                  {item.detail}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
