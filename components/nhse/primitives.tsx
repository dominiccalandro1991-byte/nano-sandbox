"use client"

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function Panel({
  title,
  hint,
  action,
  children,
  className,
}: {
  title: string
  hint?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn("rounded-lg border border-border bg-card", className)}>
      <header className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="flex min-w-0 flex-col">
          <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {title}
          </h2>
          {hint ? <p className="truncate text-[11px] text-muted-foreground/70">{hint}</p> : null}
        </div>
        {action}
      </header>
      <div className="p-3">{children}</div>
    </section>
  )
}

export function Metric({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string
  value: string
  sub?: string
  emphasis?: boolean
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border bg-background/40 px-2.5 py-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "tabnum font-mono text-sm leading-tight",
          emphasis ? "text-primary" : "text-foreground",
        )}
      >
        {value}
      </span>
      {sub ? <span className="text-[10px] leading-tight text-muted-foreground/70">{sub}</span> : null}
    </div>
  )
}

export function Bar({ ratio, tone = "primary" }: { ratio: number; tone?: "primary" | "muted" | "fault" }) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0))
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-secondary"
      role="progressbar"
      aria-valuenow={Math.round(clamped * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-300",
          tone === "primary" && "bg-primary",
          tone === "muted" && "bg-muted-foreground",
          tone === "fault" && "bg-destructive",
        )}
        style={{ width: `${clamped * 100}%` }}
      />
    </div>
  )
}

export function Tag({
  children,
  tone = "neutral",
}: {
  children: ReactNode
  tone?: "neutral" | "primary" | "fault"
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em]",
        tone === "neutral" && "border-border text-muted-foreground",
        tone === "primary" && "border-primary/40 bg-primary/10 text-primary",
        tone === "fault" && "border-destructive/45 bg-destructive/10 text-destructive",
      )}
    >
      {children}
    </span>
  )
}

export function ActionButton({
  children,
  onClick,
  variant = "ghost",
  disabled,
  type = "button",
  className,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: "solid" | "ghost" | "fault"
  disabled?: boolean
  type?: "button" | "submit"
  className?: string
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors disabled:opacity-40",
        variant === "solid" && "bg-primary text-primary-foreground active:bg-primary/85",
        variant === "ghost" && "border border-border text-foreground active:bg-accent",
        variant === "fault" && "border border-destructive/45 text-destructive active:bg-destructive/10",
        className,
      )}
    >
      {children}
    </button>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="px-1 py-6 text-center text-xs leading-relaxed text-muted-foreground">{children}</p>
  )
}

export function Row({
  children,
  onClick,
  active,
}: {
  children: ReactNode
  onClick?: () => void
  active?: boolean
}) {
  const base =
    "flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors"
  if (!onClick) {
    return <div className={cn(base, "border-border bg-background/40")}>{children}</div>
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        base,
        active ? "border-primary/50 bg-primary/10" : "border-border bg-background/40 active:bg-accent",
      )}
    >
      {children}
    </button>
  )
}
