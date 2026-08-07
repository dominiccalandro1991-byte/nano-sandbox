"use client"

/**
 * Client boundary for the engine. The engine owns IndexedDB and a Worker, so it
 * is instantiated exactly once per document and shared by reference. `revision`
 * increments on every engine mutation so panels can re-read derived views.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import { NanoHabitatEngine } from "@/lib/nhse/engine"

interface EngineContextValue {
  engine: NanoHabitatEngine | null
  revision: number
  error: string | null
  refresh: () => void
}

const EngineContext = createContext<EngineContextValue>({
  engine: null,
  revision: 0,
  error: null,
  refresh: () => {},
})

export function EngineProvider({ children }: { children: ReactNode }) {
  const [engine, setEngine] = useState<NanoHabitatEngine | null>(null)
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    let instance: NanoHabitatEngine | null = null

    NanoHabitatEngine.create()
      .then((created) => {
        if (disposed) {
          created.dispose()
          return
        }
        instance = created
        setEngine(created)
        setRevision((r) => r + 1)
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause))
      })

    return () => {
      disposed = true
      instance?.dispose()
    }
  }, [])

  useEffect(() => {
    if (!engine) return
    return engine.subscribe(() => setRevision((r) => r + 1))
  }, [engine])

  const refresh = useCallback(() => setRevision((r) => r + 1), [])

  return (
    <EngineContext.Provider value={{ engine, revision, error, refresh }}>
      {children}
    </EngineContext.Provider>
  )
}

export function useEngine(): EngineContextValue {
  return useContext(EngineContext)
}

/**
 * Reads a derived view out of the engine. Re-runs whenever the engine emits or
 * a dependency key changes. Errors surface as state instead of throwing so a
 * single bad panel can never blank the shell.
 */
export function useEngineQuery<T>(
  read: (engine: NanoHabitatEngine) => Promise<T>,
  deps: unknown[],
): { data: T | null; loading: boolean; error: string | null } {
  const { engine, revision } = useEngine()
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!engine) return
    let active = true
    setLoading(true)
    read(engine)
      .then((value) => {
        if (!active) return
        setData(value)
        setError(null)
      })
      .catch((cause: unknown) => {
        if (!active) return
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, revision, ...deps])

  return { data, loading, error }
}
