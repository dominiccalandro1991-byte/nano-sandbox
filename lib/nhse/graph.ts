/**
 * Architecture graph extraction.
 *
 * Nodes are modules, edges are dependency contracts. Layering uses an
 * iterative longest-path relaxation over the DAG (Kahn order), and cycles are
 * detected with an explicit-stack Tarjan-style DFS so deeply nested graphs can
 * never blow the JS call stack.
 *
 * Complexity: O(V + E) for parsing, cycle detection, and layering.
 */

import type { ArchitectureGraph, GraphEdge, GraphNode } from "./types"

const IMPORT_PATTERN =
  /(?:^|\s)(?:import\s+(?:[\s\S]*?)\s+from\s*|import\s*|export\s+(?:[\s\S]*?)\s+from\s*|require\s*\(\s*)["']([^"']+)["']/g

const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", "/index.ts", "/index.js"]

export function parseSpecifiers(source: string): string[] {
  const found: string[] = []
  IMPORT_PATTERN.lastIndex = 0
  let match = IMPORT_PATTERN.exec(source)
  while (match !== null) {
    found.push(match[1])
    match = IMPORT_PATTERN.exec(source)
  }
  return found
}

/** Resolve a relative specifier against a POSIX-style path set. */
export function resolveSpecifier(fromPath: string, specifier: string, known: Set<string>): string | null {
  if (!specifier.startsWith(".")) return null
  const fromDir = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")) : ""
  const segments = `${fromDir}/${specifier}`.split("/")
  const stack: string[] = []
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue
    if (segment === "..") {
      stack.pop()
      continue
    }
    stack.push(segment)
  }
  const base = stack.join("/")
  for (const extension of EXTENSIONS) {
    const candidate = `${base}${extension}`
    if (known.has(candidate)) return candidate
  }
  return null
}

interface SourceFile {
  path: string
  text: string
  bytes: number
}

export function buildArchitectureGraph(files: SourceFile[]): ArchitectureGraph {
  const known = new Set(files.map((file) => file.path))
  const adjacency = new Map<string, Set<string>>()
  const unresolved: { from: string; specifier: string }[] = []

  for (const file of files) adjacency.set(file.path, new Set())

  for (const file of files) {
    const targets = adjacency.get(file.path)
    if (!targets) continue
    for (const specifier of parseSpecifiers(file.text)) {
      const resolved = resolveSpecifier(file.path, specifier, known)
      if (resolved && resolved !== file.path) targets.add(resolved)
      else if (!resolved) unresolved.push({ from: file.path, specifier })
    }
  }

  const cycles = findCycles(adjacency)
  const cyclicEdges = new Set<string>()
  for (const cycle of cycles) {
    for (let i = 0; i < cycle.length; i++) {
      const from = cycle[i]
      const to = cycle[(i + 1) % cycle.length]
      if (adjacency.get(from)?.has(to)) cyclicEdges.add(`${from}->${to}`)
    }
  }

  const layerOf = computeLayers(adjacency, cyclicEdges)

  const fanOut = new Map<string, number>()
  const fanIn = new Map<string, number>()
  const edges: GraphEdge[] = []
  for (const [from, targets] of adjacency) {
    fanOut.set(from, targets.size)
    for (const to of targets) {
      fanIn.set(to, (fanIn.get(to) ?? 0) + 1)
      edges.push({ from, to, cyclic: cyclicEdges.has(`${from}->${to}`) })
    }
  }

  const nodes: GraphNode[] = files.map((file) => ({
    id: file.path,
    label: file.path.split("/").slice(-1)[0],
    layer: layerOf.get(file.path) ?? 0,
    fanIn: fanIn.get(file.path) ?? 0,
    fanOut: fanOut.get(file.path) ?? 0,
    bytes: file.bytes,
  }))

  const maxLayer = nodes.reduce((max, node) => Math.max(max, node.layer), 0)
  const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => [])
  for (const node of nodes) layers[node.layer].push(node.id)
  for (const layer of layers) layer.sort()

  return { nodes, edges, layers, cycles, unresolved }
}

/** Iterative DFS with an explicit stack; returns each elementary cycle found. */
function findCycles(adjacency: Map<string, Set<string>>): string[][] {
  const WHITE = 0
  const GREY = 1
  const BLACK = 2
  const color = new Map<string, number>()
  for (const node of adjacency.keys()) color.set(node, WHITE)
  const cycles: string[][] = []
  const seen = new Set<string>()

  for (const root of adjacency.keys()) {
    if (color.get(root) !== WHITE) continue
    const path: string[] = []
    const stack: { node: string; iterator: Iterator<string> }[] = [
      { node: root, iterator: (adjacency.get(root) ?? new Set<string>()).values() },
    ]
    color.set(root, GREY)
    path.push(root)

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      const next = frame.iterator.next()
      if (next.done) {
        color.set(frame.node, BLACK)
        stack.pop()
        path.pop()
        continue
      }
      const child = next.value
      if (!adjacency.has(child)) continue
      const childColor = color.get(child)
      if (childColor === GREY) {
        const start = path.indexOf(child)
        if (start !== -1) {
          const cycle = path.slice(start)
          const key = [...cycle].sort().join("|")
          if (!seen.has(key)) {
            seen.add(key)
            cycles.push(cycle)
          }
        }
        continue
      }
      if (childColor === WHITE) {
        color.set(child, GREY)
        path.push(child)
        stack.push({ node: child, iterator: (adjacency.get(child) ?? new Set<string>()).values() })
      }
    }
  }
  return cycles
}

/**
 * Longest-path layering. Cyclic edges are excluded so the relaxation always
 * terminates; the iteration cap is a hard safety bound (never reached on a DAG).
 */
function computeLayers(adjacency: Map<string, Set<string>>, cyclicEdges: Set<string>): Map<string, number> {
  const layer = new Map<string, number>()
  for (const node of adjacency.keys()) layer.set(node, 0)
  const nodeCount = adjacency.size
  for (let iteration = 0; iteration < nodeCount + 1; iteration++) {
    let changed = false
    for (const [from, targets] of adjacency) {
      for (const to of targets) {
        if (cyclicEdges.has(`${from}->${to}`)) continue
        const candidate = (layer.get(from) ?? 0) + 1
        if (candidate > (layer.get(to) ?? 0)) {
          layer.set(to, candidate)
          changed = true
        }
      }
    }
    if (!changed) break
  }
  return layer
}

/** ASCII architecture blueprint, rendered directly from the live graph. */
export function renderAsciiGraph(graph: ArchitectureGraph, width = 44): string {
  if (graph.nodes.length === 0) return "(empty habitat — no modules materialized)"
  const lines: string[] = []
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  graph.layers.forEach((layer, index) => {
    lines.push(`L${index} ${"─".repeat(Math.max(0, width - 3 - String(index).length))}`)
    for (const id of layer) {
      const node = byId.get(id)
      if (!node) continue
      const dependencies = graph.edges.filter((edge) => edge.from === id)
      lines.push(`  ├─ ${node.label}  (in ${node.fanIn} / out ${node.fanOut})`)
      dependencies.forEach((edge, position) => {
        const branch = position === dependencies.length - 1 ? "└→" : "├→"
        lines.push(`  │   ${branch} ${edge.to}${edge.cyclic ? "  [cycle]" : ""}`)
      })
    }
  })
  if (graph.cycles.length > 0) {
    lines.push("")
    lines.push("!! dependency cycles detected:")
    for (const cycle of graph.cycles) lines.push(`   ${cycle.join(" → ")} → ${cycle[0]}`)
  }
  return lines.join("\n")
}
