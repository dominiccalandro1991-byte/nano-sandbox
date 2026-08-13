"use client"

import { Panel, Metric, Tag, Row } from "./primitives"

/**
 * NASE overview panel — explains the five agents and attestation-freshness
 * invariant in plain language so the UI is self-explanatory.
 */
const AGENTS = [
  {
    id: "policy-governor",
    title: "Policy Governor",
    does: "Owns policy & identity. Every action must pass its checks first.",
  },
  {
    id: "detector",
    title: "Detector",
    does: "Watches habitat access patterns and flags anomalies.",
  },
  {
    id: "predictor",
    title: "Predictor",
    does: "Scores near-term risk and ranks attack surface.",
  },
  {
    id: "responder",
    title: "Responder",
    does: "Only runs approved actions: quarantine, re-encrypt, alert, kill-switch.",
  },
  {
    id: "auditor",
    title: "Auditor",
    does: "Writes an immutable, content-addressed trail of every decision.",
  },
  {
    id: "governing-orchestrator",
    title: "Orchestrator",
    does: "Coordinates agents; never bypasses the Governor or Tool-Gateway.",
  },
]

export function SecurityView() {
  return (
    <div className="flex flex-col gap-3">
      <Panel
        title="NanoAegis (NASE)"
        hint="Personal autonomous security formal core — protects NHSE habitats"
      >
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          NASE is a zero-trust multi-agent security layer inside the same sandbox as your
          habitats. Nothing leaves the container. Every sensitive action must present a{" "}
          <span className="text-foreground">fresh attestation</span> (age ≤ Δt, default 30s)
          and a capability the agent is allowed to use.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Metric label="Invariant" value="Fresh ≤ 30s" sub="attestation-freshness" emphasis />
          <Metric label="Chokepoint" value="Tool-Gateway" sub="least-privilege only" />
          <Metric label="Agents" value="6" sub="5 specialists + orchestrator" />
          <Metric label="Engine id" value="nase-aegis" sub="in diagnostic registry" />
        </div>
      </Panel>

      <Panel title="What each agent does" hint="Tap Remote → nase-aegis to run formal checks">
        <ul className="flex flex-col gap-2">
          {AGENTS.map((a) => (
            <li key={a.id} className="rounded-md border border-border bg-background/40 px-2.5 py-2">
              <Row>
                <span className="font-mono text-[11px] font-semibold text-foreground">{a.title}</span>
                <Tag>{a.id}</Tag>
              </Row>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{a.does}</p>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="How to run a check" hint="Uses the Remote diagnostic job API">
        <ol className="list-decimal space-y-1.5 pl-4 text-[12px] text-muted-foreground">
          <li>Open <span className="text-foreground">Remote</span> under Engine Control.</li>
          <li>Select validator <span className="font-mono text-foreground">nase-aegis</span>.</li>
          <li>
            Send JSON with <span className="font-mono">agent_id</span>,{" "}
            <span className="font-mono">action</span>, and{" "}
            <span className="font-mono">attestation_timestamp</span>.
          </li>
          <li>Stale or missing attestation → denied. Hash mismatch → quarantine signal.</li>
        </ol>
      </Panel>
    </div>
  )
}
