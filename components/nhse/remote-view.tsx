"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ActionButton, EmptyState, Metric, Panel, Row, Tag } from "./primitives"
import { formatMs, formatWhen } from "@/lib/nhse/format"
import {
  checkRemoteHealth,
  getRemoteEngineUrl,
  listRemoteJobs,
  listRemoteValidators,
  setRemoteEngineUrl,
  submitRemoteJob,
  type RemoteJob,
  type RemoteValidatorInfo,
} from "@/lib/nhse/remote-client"

type ConnectionState = "unconfigured" | "checking" | "online" | "offline"

function defaultsFromSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(schema)) {
    if (raw && typeof raw === "object" && "default" in (raw as Record<string, unknown>)) {
      out[key] = (raw as Record<string, unknown>).default
    }
  }
  return out
}

export function RemoteView() {
  const [urlInput, setUrlInput] = useState("")
  const [configuredUrl, setConfiguredUrl] = useState<string | null>(null)
  const [connection, setConnection] = useState<ConnectionState>("unconfigured")
  const [connectionDetail, setConnectionDetail] = useState<string | null>(null)

  const [validators, setValidators] = useState<RemoteValidatorInfo[]>([])
  const [selectedValidator, setSelectedValidator] = useState<string | null>(null)
  const [payloadText, setPayloadText] = useState("{}")
  const [seedText, setSeedText] = useState("")
  const [label, setLabel] = useState("")

  const [submitting, setSubmitting] = useState(false)
  const [lastResult, setLastResult] = useState<RemoteJob | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)

  const [recentJobs, setRecentJobs] = useState<RemoteJob[]>([])

  useEffect(() => {
    const existing = getRemoteEngineUrl()
    if (existing) {
      setUrlInput(existing)
      setConfiguredUrl(existing)
    }
  }, [])

  const refreshHealth = useCallback(async (url: string) => {
    setConnection("checking")
    setConnectionDetail(null)
    const health = await checkRemoteHealth(url)
    if (!health.ok) {
      setConnection("offline")
      setConnectionDetail(health.error)
      setValidators([])
      return
    }
    setConnection("online")
    setConnectionDetail(`${health.data.service} v${health.data.version}`)
    const validatorsResult = await listRemoteValidators(url)
    if (validatorsResult.ok) {
      setValidators(validatorsResult.data)
      if (!selectedValidator && validatorsResult.data.length > 0) {
        const first = validatorsResult.data[0]
        setSelectedValidator(first.id)
        setPayloadText(JSON.stringify(defaultsFromSchema(first.payload_schema), null, 2))
      }
    }
    const jobsResult = await listRemoteJobs(url, 10)
    if (jobsResult.ok) setRecentJobs(jobsResult.data)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (configuredUrl) void refreshHealth(configuredUrl)
  }, [configuredUrl, refreshHealth])

  function handleSave() {
    const trimmed = urlInput.trim().replace(/\/+$/, "")
    setRemoteEngineUrl(trimmed || null)
    setConfiguredUrl(trimmed || null)
    if (!trimmed) {
      setConnection("unconfigured")
      setValidators([])
      setRecentJobs([])
    }
  }

  function handleValidatorPick(id: string) {
    setSelectedValidator(id)
    const info = validators.find((v) => v.id === id)
    if (info) setPayloadText(JSON.stringify(defaultsFromSchema(info.payload_schema), null, 2))
  }

  async function handleSubmit() {
    if (!configuredUrl || !selectedValidator) return
    let parsedPayload: Record<string, unknown>
    try {
      parsedPayload = payloadText.trim() ? JSON.parse(payloadText) : {}
    } catch (cause) {
      setLastError(`Payload is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`)
      return
    }
    const seed = seedText.trim() ? Number(seedText.trim()) : null
    if (seedText.trim() && !Number.isFinite(seed)) {
      setLastError("Seed must be a number.")
      return
    }

    setSubmitting(true)
    setLastError(null)
    const result = await submitRemoteJob(configuredUrl, {
      validatorId: selectedValidator,
      payload: parsedPayload,
      seed,
      label: label.trim() || null,
    })
    setSubmitting(false)

    if (!result.ok) {
      setLastError(result.error)
      return
    }
    setLastResult(result.data)
    const jobsResult = await listRemoteJobs(configuredUrl, 10)
    if (jobsResult.ok) setRecentJobs(jobsResult.data)
  }

  const selectedInfo = useMemo(
    () => validators.find((v) => v.id === selectedValidator) ?? null,
    [validators, selectedValidator],
  )

  const connectionTag = useMemo(() => {
    switch (connection) {
      case "online":
        return <Tag tone="primary">online</Tag>
      case "offline":
        return <Tag tone="fault">offline</Tag>
      case "checking":
        return <Tag tone="neutral">checking</Tag>
      default:
        return <Tag tone="neutral">not configured</Tag>
    }
  }, [connection])

  return (
    <div className="flex flex-col gap-3">
      <Panel
        title="Remote engine"
        hint="Optional. NHSE runs fully on-device without this configured."
        action={connectionTag}
      >
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              value={urlInput}
              onChange={(event) => setUrlInput(event.target.value)}
              placeholder="https://your-backend.example.com"
              className="min-w-0 flex-1 rounded-md border border-border bg-background/40 px-2.5 py-2 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/60"
            />
            <ActionButton variant="solid" onClick={handleSave}>
              save
            </ActionButton>
            {configuredUrl ? (
              <ActionButton onClick={() => void refreshHealth(configuredUrl)}>recheck</ActionButton>
            ) : null}
          </div>
          {connectionDetail ? (
            <p className="break-words font-mono text-[11px] text-muted-foreground/80">{connectionDetail}</p>
          ) : null}
          {!configuredUrl ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground/70">
              Point this at a running instance of backend/ (see backend/README.md). Until then, every
              other tab in NHSE works exactly as before.
            </p>
          ) : null}
        </div>
      </Panel>

      {connection === "online" ? (
        <Panel
          title="Run a validation job"
          hint={selectedInfo ? selectedInfo.description : "Choose a validator"}
        >
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-wrap gap-1.5">
              {validators.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => handleValidatorPick(v.id)}
                  className={
                    v.id === selectedValidator
                      ? "rounded-sm border border-primary/50 bg-primary/10 px-2 py-1 font-mono text-[11px] text-primary"
                      : "rounded-sm border border-border px-2 py-1 font-mono text-[11px] text-muted-foreground active:bg-accent"
                  }
                >
                  {v.id}
                </button>
              ))}
            </div>

            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                payload (json)
              </span>
              <textarea
                value={payloadText}
                onChange={(event) => setPayloadText(event.target.value)}
                rows={6}
                className="w-full resize-y rounded-md border border-border bg-background/40 px-2.5 py-2 font-mono text-[11px] text-foreground"
              />
            </label>

            <div className="flex gap-2">
              <label className="flex flex-1 flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  seed (optional)
                </span>
                <input
                  value={seedText}
                  onChange={(event) => setSeedText(event.target.value)}
                  placeholder="e.g. 42"
                  className="rounded-md border border-border bg-background/40 px-2.5 py-2 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/60"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  label (optional)
                </span>
                <input
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="e.g. agent-run-3"
                  className="rounded-md border border-border bg-background/40 px-2.5 py-2 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/60"
                />
              </label>
            </div>

            <ActionButton
              variant="solid"
              disabled={!selectedValidator || submitting}
              onClick={() => void handleSubmit()}
            >
              {submitting ? "running" : "run"}
            </ActionButton>

            {lastError ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 font-mono text-[11px] text-destructive">
                {lastError}
              </p>
            ) : null}

            {lastResult ? (
              <div className="flex flex-col gap-2 rounded-md border border-border bg-background/40 px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px]">{lastResult.label ?? lastResult.id}</span>
                  <Tag tone={lastResult.status === "passed" ? "primary" : lastResult.status === "running" || lastResult.status === "queued" ? "neutral" : "fault"}>
                    {lastResult.status}
                  </Tag>
                </div>
                {lastResult.report ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Metric
                      label="score"
                      value={lastResult.report.score === null ? "—" : lastResult.report.score.toFixed(3)}
                      emphasis
                    />
                    <Metric
                      label="duration"
                      value={lastResult.duration_seconds ? formatMs(lastResult.duration_seconds * 1000) : "—"}
                    />
                  </div>
                ) : null}
                {lastResult.error ? (
                  <p className="font-mono text-[11px] text-destructive">{lastResult.error}</p>
                ) : null}
                {lastResult.report?.findings?.length ? (
                  <ul className="flex flex-col gap-1">
                    {lastResult.report.findings.map((finding, index) => (
                      <li key={index} className="text-[11px] leading-relaxed text-muted-foreground">
                        · {finding}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {lastResult.report?.details && Object.keys(lastResult.report.details).length > 0 ? (
                  <pre className="max-h-64 overflow-auto rounded-md bg-background/60 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
                    {JSON.stringify(lastResult.report.details, null, 2)}
                  </pre>
                ) : null}
              </div>
            ) : null}
          </div>
        </Panel>
      ) : null}

      <Panel title="Recent remote jobs" hint={`${recentJobs.length} shown`}>
        {recentJobs.length === 0 ? (
          <EmptyState>
            {connection === "online" ? "No jobs submitted yet." : "Connect a remote engine to see job history."}
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {recentJobs.map((job) => (
              <Row key={job.id}>
                <div className="flex w-full items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-mono text-[11px]">{job.label ?? job.validator_id}</span>
                    <span className="text-[10px] text-muted-foreground/70">{formatWhen(job.submitted_at * 1000)}</span>
                  </div>
                  <Tag tone={job.status === "passed" ? "primary" : job.status === "running" || job.status === "queued" ? "neutral" : "fault"}>
                    {job.status}
                  </Tag>
                </div>
              </Row>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
