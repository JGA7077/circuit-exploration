// ---------------------------------------------------------------------------
// mnaSolver.js — MNA (Modified Nodal Analysis) netlist builder
// Converts Falstad coordinate-based circuit to node-based netlist
// ---------------------------------------------------------------------------

/**
 * Union-Find data structure for merging nodes connected by wires.
 */
class UnionFind {
  constructor () {
    this.parent = new Map()
    this.rank = new Map()
  }

  makeSet (x) {
    if (!this.parent.has(x)) {
      this.parent.set(x, x)
      this.rank.set(x, 0)
    }
  }

  find (x) {
    this.makeSet(x)
    if (this.parent.get(x) !== x) {
      this.parent.set(x, this.find(this.parent.get(x)))
    }
    return this.parent.get(x)
  }

  union (x, y) {
    this.makeSet(x)
    this.makeSet(y)
    const rx = this.find(x)
    const ry = this.find(y)
    if (rx === ry) return
    const rrx = this.rank.get(rx)
    const rry = this.rank.get(ry)
    if (rrx < rry) {
      this.parent.set(rx, ry)
    } else if (rrx > rry) {
      this.parent.set(ry, rx)
    } else {
      this.parent.set(ry, rx)
      this.rank.set(rx, rrx + 1)
    }
  }
}

/**
 * Generate a string key for a coordinate pair.
 */
function key (x, y) {
  return `${Math.round(x)},${Math.round(y)}`
}

/**
 * Build a node-based netlist from a parsed Falstad circuit.
 *
 * Returns:
 * {
 *   nodeMap: Map<string, number>,  // coordinate key → node index (0 = ground)
 *   numNodes: number,              // total nodes (including ground)
 *   elements: [                    // list of circuit elements
 *     { type, ref, node1, node2, value, ... }
 *   ]
 * }
 */
export function buildNetlist (circuit) {
  const uf = new UnionFind()

  // Register all ground points
  for (const g of circuit.grounds) {
    uf.makeSet(key(g.x, g.y))
  }

  // Register all wire endpoints and union them
  for (const w of circuit.wires) {
    const k1 = key(w.x1, w.y1)
    const k2 = key(w.x2, w.y2)
    uf.makeSet(k1)
    uf.makeSet(k2)
    uf.union(k1, k2)
  }

  // Register all component endpoints
  for (const c of circuit.components) {
    const k1 = key(c.x1, c.y1)
    const k2 = key(c.x2, c.y2)
    uf.makeSet(k1)
    uf.makeSet(k2)
  }

  // Also register output probe endpoints
  for (const o of circuit.outputs) {
    const k1 = key(o.x1, o.y1)
    const k2 = key(o.x2, o.y2)
    uf.makeSet(k1)
    uf.makeSet(k2)
  }

  // Find the ground root(s)
  const groundRoots = new Set()
  for (const g of circuit.grounds) {
    groundRoots.add(uf.find(key(g.x, g.y)))
  }

  // Collect all unique roots and assign node indices
  const allRoots = new Set()
  for (const k of uf.parent.keys()) {
    allRoots.add(uf.find(k))
  }

  // Ground nodes get index 0, others get 1, 2, 3...
  const nodeMap = new Map()
  let nextNode = 1
  for (const root of allRoots) {
    if (groundRoots.has(root)) {
      nodeMap.set(root, 0)
    }
  }
  for (const root of allRoots) {
    if (!groundRoots.has(root)) {
      nodeMap.set(root, nextNode++)
    }
  }

  // Map coordinate keys to node indices
  const coordToNode = (x, y) => {
    const k = key(x, y)
    const root = uf.find(k)
    const node = nodeMap.get(root)
    return node !== undefined ? node : 0 // default to ground if unknown
  }

  // Build element list
  const elements = []
  for (const c of circuit.components) {
    const node1 = coordToNode(c.x1, c.y1)
    const node2 = coordToNode(c.x2, c.y2)

    const el = {
      type: c.type,
      ref: c.ref,
      node1,
      node2,
      value: c.value
    }

    // Store extra attributes for specific types
    if (c.type === 'diode') {
      el.model = c.value // model name
      el.Is = 2.52e-9 // default 1N4148 saturation current
      el.n = 1.752 // default emission coefficient
      el.Vt = 0.02585 // thermal voltage at 300K
    }
    if (c.type === 'npn' || c.type === 'pnp') {
      el.model = c.value
      el.polarity = c.type === 'npn' ? 1 : -1
    }
    if (c.type === 'voltage' || c.type === 'sine') {
      el.dcValue = c.dcValue || 0
      el.acAmplitude = c.acAmplitude || 0
      el.acFrequency = c.acFrequency || 0
    }
    if (c.type === 'ind') {
      el.inductance = c.value
    }

    elements.push(el)
  }

  // Add voltage sources from circuit (if parser supports them)
  if (circuit.voltageSources) {
    for (const vs of circuit.voltageSources) {
      const node1 = coordToNode(vs.x1, vs.y1)
      const node2 = coordToNode(vs.x2, vs.y2)
      elements.push({
        type: 'voltage',
        ref: vs.ref,
        node1,
        node2,
        value: vs.dcValue || 0,
        dcValue: vs.dcValue || 0,
        acAmplitude: vs.acAmplitude || 0,
        acFrequency: vs.acFrequency || 0
      })
    }
  }

  // Add current sources from circuit (if parser supports them)
  if (circuit.currentSources) {
    for (const cs of circuit.currentSources) {
      const node1 = coordToNode(cs.x1, cs.y1)
      const node2 = coordToNode(cs.x2, cs.y2)
      elements.push({
        type: 'current',
        ref: cs.ref,
        node1,
        node2,
        value: cs.dcValue || 0,
        dcValue: cs.dcValue || 0
      })
    }
  }

  const numNodes = nextNode // ground is 0, so total = nextNode

  return { nodeMap, coordToNode, numNodes, elements, uf }
}

/**
 * Analyze the netlist to determine what parameters can be exposed.
 * Returns a list of tunable parameters with their ranges.
 */
export function analyzeParameters (elements) {
  const params = []

  for (const el of elements) {
    if (el.type === 'res') {
      params.push({
        name: `r_${el.ref}`,
        label: `${el.ref} (Ω)`,
        ref: el.ref,
        default: el.value,
        min: el.value * 0.01,
        max: el.value * 100,
        skew: 0.3
      })
    }
    if (el.type === 'cap') {
      params.push({
        name: `c_${el.ref}`,
        label: `${el.ref} (F)`,
        ref: el.ref,
        default: el.value,
        min: el.value * 0.01,
        max: el.value * 100,
        skew: 0.3
      })
    }
    if (el.type === 'ind') {
      params.push({
        name: `l_${el.ref}`,
        label: `${el.ref} (H)`,
        ref: el.ref,
        default: el.inductance,
        min: el.inductance * 0.01,
        max: el.inductance * 100,
        skew: 0.3
      })
    }
    if (el.type === 'voltage') {
      params.push({
        name: `v_${el.ref}`,
        label: `${el.ref} (V)`,
        ref: el.ref,
        default: el.dcValue,
        min: -50,
        max: 50,
        skew: 0.3
      })
    }
  }

  return params
}
