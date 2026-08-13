"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { MessageSquare, Send } from "lucide-react"
import { useEngine } from "./engine-context"
import { Panel, ActionButton, Tag } from "./primitives"
import { cn } from "@/lib/utils"

type ChatMsg = {
  id: string
  role: "user" | "assistant" | "system"
  text: string
  ts: number
  tool?: string
  hash?: string
}

const TOOL_HINTS: { re: RegExp; engine: string }[] = [
  { re: /\b(usse|stress|torque|load\s*lb|500\s*lb|300\s*lb)\b/i, engine: "usse-stress" },
  { re: /\b(oiav|vault|copyright|patent|ip\s*package|seal\s+asset)\b/i, engine: "oiav-vault" },
  { re: /\b(nase|attestation|tool-?gateway|quarantine)\b/i, engine: "nase-aegis" },
  { re: /\b(nadre|self-?heal|memory\s*pressure|debug\s*repair)\b/i, engine: "nadre-monitor" },
  { re: /\b(causal|fusion|failure\s*point)\b/i, engine: "causal-fusion" },
  { re: /\b(soft-?body|physics)\b/i, engine: "soft-body-physics" },
  { re: /\b(thermal|heat|dissipat)\b/i, engine: "thermal-dissipation" },
  { re: /\b(geometry|tolerance)\b/i, engine: "geometry-tolerance" },
  { re: /\b(repair\s*plan|rte)\b/i, engine: "rte-repair-plan" },
  { re: /\b(nnacc|chat\s*core)\b/i, engine: "nnacc-chat" },
]

function matchTool(text: string): string | undefined {
  for (const h of TOOL_HINTS) {
    if (h.re.test(text)) return h.engine
  }
  return undefined
}

function localReply(text: string, tool?: string): string {
  if (tool) {
    return (
      `Routing proposal → **${tool}** (NASE-gated allow-list). ` +
      `On a live backend, NNACC would submit a structured job after attestation-freshness (Δt ≤ 30s). ` +
      `This message is written into the habitat under chat/ as a content-addressed trail.`
    )
  }
  const lower = text.toLowerCase()
  if (/(hello|hi|hey|help)/.test(lower)) {
    return (
      "NNACC is the in-app chat core. I ground turns in your NHSE habitat, propose tools " +
      "into the 25-engine registry, and require NASE-fresh attestation for mutations. " +
      "Try: “run USSE on a 400 lb load”, “seal IP in OIAV”, or “NADRE health check”."
    )
  }
  return (
    "No tool intent matched. Say an engine name (USSE, OIAV, NASE, NADRE, thermal…) " +
    "to propose a gateway-bounded call. Session text is still stored in the habitat CAS."
  )
}

async function shortHash(text: string): Promise<string> {
  try {
    const data = new TextEncoder().encode(text)
    const digest = await crypto.subtle.digest("SHA-256", data)
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 12)
  } catch {
    return String(text.length)
  }
}

export function ChatView({ habitatId }: { habitatId: string }) {
  const { engine } = useEngine()
  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      id: "sys-0",
      role: "system",
      text: "NNACC formal core — tools are registry-bounded; mutations need NASE-fresh attestation.",
      ts: Date.now(),
    },
  ])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const persist = useCallback(
    async (next: ChatMsg[]) => {
      if (!engine) return
      const body = JSON.stringify(
        {
          habitatId,
          updatedAt: Date.now(),
          messages: next.filter((m) => m.role !== "system"),
        },
        null,
        2,
      )
      try {
        await engine.writeFile(habitatId, "chat/nnacc-session.json", body, "nnacc session trail")
      } catch {
        // Persistence failure must not break the UI turn.
      }
    },
    [engine, habitatId],
  )

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    setBusy(true)
    setInput("")
    const ts = Date.now()
    const tool = matchTool(text)
    const userHash = await shortHash(`user:${text}:${ts}`)
    const userMsg: ChatMsg = { id: `u-${ts}`, role: "user", text, ts, hash: userHash }
    const reply = localReply(text, tool)
    const aHash = await shortHash(`assistant:${reply}:${ts}`)
    const assistantMsg: ChatMsg = {
      id: `a-${ts}`,
      role: "assistant",
      text: reply,
      ts: ts + 1,
      tool,
      hash: aHash,
    }
    setMessages((prev) => {
      const next = [...prev, userMsg, assistantMsg]
      void persist(next)
      return next
    })
    setBusy(false)
  }

  return (
    <div className="flex h-[min(70dvh,560px)] flex-col gap-2">
      <Panel title="NNACC chat" hint="Engine 25 · habitat-grounded · NASE tool allow-list">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Conversations stay in this habitat (<span className="font-mono text-foreground">chat/nnacc-session.json</span>).
          Tool names map to the diagnostic registry; this static build proposes calls locally.
        </p>
      </Panel>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                "max-w-[92%] rounded-md px-2.5 py-2 text-[12px] leading-snug",
                m.role === "user" && "ml-auto bg-primary/15 text-foreground",
                m.role === "assistant" && "bg-background/60 text-foreground",
                m.role === "system" && "border border-border/60 text-muted-foreground",
              )}
            >
              <div className="mb-1 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                <MessageSquare className="size-3" aria-hidden />
                {m.role}
                {m.tool ? <Tag>{m.tool}</Tag> : null}
                {m.hash ? <span className="opacity-60">{m.hash}</span> : null}
              </div>
              <p className="whitespace-pre-wrap">{m.text}</p>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <form
          className="flex gap-2 border-t border-border p-2"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask NNACC… e.g. run USSE on 400 lb load"
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-2 font-mono text-[12px] outline-none focus:border-primary"
            disabled={busy}
            aria-label="Chat message"
          />
          <ActionButton type="submit" disabled={busy || !input.trim()}>
            <Send className="size-3.5" />
          </ActionButton>
        </form>
      </div>
    </div>
  )
}
