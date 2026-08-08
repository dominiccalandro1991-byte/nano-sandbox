/**
 * Seed habitats. These are real, runnable module graphs — not fixtures. The
 * checksum module is byte-identical across two habitats so global content
 * deduplication is observable from a cold start.
 */

const CHECKSUM_MODULE = `// FNV-1a 32-bit checksum. Shared, byte-identical, across habitats.
function checksum(text) {
  var hash = 2166136261;
  for (var i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

module.exports = { checksum: checksum };
`

export interface SeedHabitat {
  id: string
  name: string
  description: string
  files: Record<string, string>
  liveModules: string[]
  notes: { title: string; body: string }[]
}

export const SEED_HABITATS: SeedHabitat[] = [
  {
    id: "lattice",
    name: "nano-lattice-sim",
    description: "Deterministic 2D lattice diffusion solver with an energy-conservation harness.",
    liveModules: ["src/main.js"],
    files: {
      "README.md": `# nano-lattice-sim

A dependency-free diffusion solver used to exercise the habitat runtime adapter.

- `src/lattice.js` — grid allocation and stencil application
- `src/physics.js` — explicit-Euler diffusion step with a CFL guard
- `src/checksum.js` — shared checksum utility (deduplicated across habitats)
- `src/main.js` — entry point; prints total mass drift per step

Run it from the Run tab. Total mass must stay conserved to 1e-9.
`,
      "src/checksum.js": CHECKSUM_MODULE,
      "src/lattice.js": `// Flat Float64 lattice with periodic boundaries. O(1) indexing.
function createLattice(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("lattice dimensions must be positive integers");
  }
  return { width: width, height: height, cells: new Float64Array(width * height) };
}

function index(lattice, x, y) {
  var w = lattice.width;
  var h = lattice.height;
  var wrappedX = ((x % w) + w) % w;
  var wrappedY = ((y % h) + h) % h;
  return wrappedY * w + wrappedX;
}

function get(lattice, x, y) {
  return lattice.cells[index(lattice, x, y)];
}

function set(lattice, x, y, value) {
  lattice.cells[index(lattice, x, y)] = value;
}

function totalMass(lattice) {
  var sum = 0;
  for (var i = 0; i < lattice.cells.length; i++) { sum += lattice.cells[i]; }
  return sum;
}

module.exports = {
  createLattice: createLattice,
  index: index,
  get: get,
  set: set,
  totalMass: totalMass
};
`,
      "src/physics.js": `var lattice = require("./lattice");

// Explicit-Euler diffusion. Stable while dt * d * 4 <= 1 (CFL condition).
function step(grid, diffusion, dt) {
  if (diffusion < 0) { throw new Error("diffusion coefficient must be >= 0"); }
  if (dt <= 0) { throw new Error("dt must be > 0"); }
  var courant = diffusion * dt * 4;
  if (courant > 1 + 1e-12) {
    throw new Error("CFL violation: reduce dt (courant=" + courant.toFixed(4) + ")");
  }
  var next = lattice.createLattice(grid.width, grid.height);
  for (var y = 0; y < grid.height; y++) {
    for (var x = 0; x < grid.width; x++) {
      var center = lattice.get(grid, x, y);
      var laplacian =
        lattice.get(grid, x + 1, y) +
        lattice.get(grid, x - 1, y) +
        lattice.get(grid, x, y + 1) +
        lattice.get(grid, x, y - 1) -
        4 * center;
      lattice.set(next, x, y, center + diffusion * dt * laplacian);
    }
  }
  return next;
}

module.exports = { step: step };
`,
      "src/main.js": `var lattice = require("./lattice");
var physics = require("./physics");
var checksum = require("./checksum").checksum;

var grid = lattice.createLattice(24, 24);
lattice.set(grid, 12, 12, 1000);
var initialMass = lattice.totalMass(grid);
console.log("initial mass", initialMass.toFixed(6));

var maxDrift = 0;
for (var i = 0; i < 40; i++) {
  grid = physics.step(grid, 0.2, 1);
  var drift = Math.abs(lattice.totalMass(grid) - initialMass);
  if (drift > maxDrift) { maxDrift = drift; }
}

console.log("steps", 40, "peak center", lattice.get(grid, 12, 12).toFixed(6));
console.log("max mass drift", maxDrift.toExponential(3));
console.log("state checksum", checksum(Array.from(grid.cells.slice(0, 32)).join(",")));

module.exports.result = {
  conserved: maxDrift < 1e-9,
  maxDrift: maxDrift,
  center: lattice.get(grid, 12, 12)
};
`,
    },
    notes: [
      {
        title: "CFL bound",
        body: "Explicit Euler on a 4-point stencil stays stable while diffusion * dt * 4 <= 1. The guard in physics.js throws instead of silently producing NaN, which keeps the runtime adapter safe and prevents hard-to-debug drift.",
      },
      {
        title: "Why Float64Array",
        body: "Flat typed arrays keep the working-set page contiguous, so the governor can account for it precisely and compress it back in one move.",
      },
    ],
  },
  {
    id: "serpent",
    name: "habitat-serpent",
    description: "Headless deterministic snake game logic with a seeded RNG and replay verification.",
    liveModules: ["src/main.js"],
    files: {
      "README.md": `# habitat-serpent

Pure game logic, no rendering. The board advances from a seeded RNG so a replay
always reproduces the exact same run — which is what makes it testable inside
the habitat instead of requiring a native binary.
`,
      "src/rng.js": `// xorshift32: deterministic, seedable, 2^32-1 period.
function createRng(seed) {
  var state = seed >>> 0 || 0x9e3779b9;
  return function next() {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
}

function pickInt(rng, max) {
  return Math.floor(rng() * max) % max;
}

module.exports = { createRng: createRng, pickInt: pickInt };
`,
      "src/game.js": `var rngModule = require("./rng");

function createGame(size, seed) {
  var rng = rngModule.createRng(seed);
  var game = {
    size: size,
    rng: rng,
    snake: [{ x: (size / 2) | 0, y: (size / 2) | 0 }],
    direction: { x: 1, y: 0 },
    food: null,
    score: 0,
    alive: true,
    ticks: 0
  };
  game.food = spawnFood(game);
  return game;
}

function occupied(game, x, y) {
  for (var i = 0; i < game.snake.length; i++) {
    if (game.snake[i].x === x && game.snake[i].y === y) { return true; }
  }
  return false;
}

function spawnFood(game) {
  for (var attempt = 0; attempt < game.size * game.size * 4; attempt++) {
    var x = rngModule.pickInt(game.rng, game.size);
    var y = rngModule.pickInt(game.rng, game.size);
    if (!occupied(game, x, y)) { return { x: x, y: y }; }
  }
  return null; // Board is full: a win state, not a crash.
}

function turn(game, dx, dy) {
  if (dx === -game.direction.x && dy === -game.direction.y) { return; }
  game.direction = { x: dx, y: dy };
}

function tick(game) {
  if (!game.alive) { return game; }
  game.ticks += 1;
  var head = game.snake[0];
  var next = { x: head.x + game.direction.x, y: head.y + game.direction.y };
  if (next.x < 0 || next.y < 0 || next.x >= game.size || next.y >= game.size) {
    game.alive = false;
    return game;
  }
  var eating = game.food && next.x === game.food.x && next.y === game.food.y;
  var body = eating ? game.snake : game.snake.slice(0, game.snake.length - 1);
  for (var i = 0; i < body.length; i++) {
    if (body[i].x === next.x && body[i].y === next.y) {
      game.alive = false;
      return game;
    }
  }
  game.snake = [next].concat(body);
  if (eating) {
    game.score += 1;
    game.food = spawnFood(game);
  }
  return game;
}

// Greedy pilot: chase food on the axis with the largest gap, never reverse.
function autopilot(game) {
  if (!game.food) { return; }
  var head = game.snake[0];
  var dx = game.food.x - head.x;
  var dy = game.food.y - head.y;
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) { turn(game, dx > 0 ? 1 : -1, 0); }
  else if (dy !== 0) { turn(game, 0, dy > 0 ? 1 : -1); }
}

module.exports = {
  createGame: createGame,
  tick: tick,
  turn: turn,
  autopilot: autopilot,
  occupied: occupied
};
`,
      "src/main.js": `var game = require("./game");

function playOut(seed, maxTicks) {
  var state = game.createGame(12, seed);
  while (state.alive && state.ticks < maxTicks) {
    game.autopilot(state);
    game.tick(state);
  }
  return state;
}

var runA = playOut(1337, 400);
var runB = playOut(1337, 400);

console.log("run A -> score", runA.score, "ticks", runA.ticks, "alive", runA.alive);
console.log("run B -> score", runB.score, "ticks", runB.ticks, "alive", runB.alive);
var deterministic = runA.score === runB.score && runA.ticks === runB.ticks;
console.log("replay deterministic:", deterministic);

module.exports.result = { score: runA.score, ticks: runA.ticks, deterministic: deterministic };
`,
    },
    notes: [
      {
        title: "Determinism is the test surface",
        body: "Because the RNG is seeded and the pilot is pure, two runs of the same seed must be byte-identical. That single property replaces an entire visual QA pass.",
      },
    ],
  },
  {
    id: "cahs",
    name: "cahs-reference",
    description: "Reference notes and a working Merkle-root calculator for the content store itself.",
    liveModules: ["src/main.js"],
    files: {
      "README.md": `# cahs-reference

Executable documentation for the Content-Addressable Hierarchical Store.
` + "`src/checksum.js` is byte-identical to the copy in nano-lattice-sim, so the\nCAS stores exactly one physical copy and reports two logical references.\n",
      "src/checksum.js": CHECKSUM_MODULE,
      "src/merkle.js": `var checksum = require("./checksum").checksum;

// Binary Merkle root over pre-hashed leaves. Odd nodes are promoted, not padded.
function merkleRoot(leaves) {
  if (!Array.isArray(leaves) || leaves.length === 0) { return checksum(""); }
  var level = leaves.map(function (leaf) { return checksum(String(leaf)); });
  while (level.length > 1) {
    var next = [];
    for (var i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) { next.push(checksum(level[i] + level[i + 1])); }
      else { next.push(level[i]); }
    }
    level = next;
  }
  return level[0];
}

module.exports = { merkleRoot: merkleRoot };
`,
      "src/main.js": `var merkle = require("./merkle");

var pathsA = ["src/a.js", "src/b.js", "src/c.js"];
var pathsB = ["src/a.js", "src/b.js", "src/c.js"];
var pathsC = ["src/a.js", "src/b.js", "src/c.js!"];

var rootA = merkle.merkleRoot(pathsA);
var rootB = merkle.merkleRoot(pathsB);
var rootC = merkle.merkleRoot(pathsC);

console.log("root A", rootA);
console.log("root B", rootB);
console.log("root C", rootC);
console.log("identical input -> identical root:", rootA === rootB);
console.log("one byte changed -> root diverges:", rootA !== rootC);
console.log("empty set root", merkle.merkleRoot([]));

module.exports.result = { stable: rootA === rootB, sensitive: rootA !== rootC, root: rootA };
`,
    },
    notes: [
      {
        title: "Dedup is not a cache",
        body: "Two habitats referencing the same content hold one physical blob with refs=2. Deleting one habitat decrements the reference; physical bytes are only reclaimed at zero.",
      },
      {
        title: "Capacity model",
        body: "C_eff = S / r, where r = physical / logical. The Capacity panel computes r from live measurements rather than from the assumed 0.04-0.15 band.",
      },
    ],
  },
]
