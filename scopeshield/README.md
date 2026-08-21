# ScopeShield

Fail-fast environment validation proxy. **Not an NHSE engine.**

Compiled Rust CLI (`scopeshield/bin/scopeshield`). Boot latency of the check is sub-millisecond on the CI contract.

```
./scopeshield/bin/scopeshield check --contract scopeshield/contracts/nano-sandbox.yaml --skip-liveness
echo $?   # 0 pass, 1 halt
```

Intercept a compiler (does **not** hook Pages `npm run build` by default — that would take the site down):

```
SCOPESHIELD_CONTRACT=scopeshield/contracts/ci.yaml ./scopeshield/wrap.sh npm run build
```

Contracts:

| File | Use |
|---|---|
| `contracts/ci.yaml` | GitHub Actions / tests. No production secrets. |
| `contracts/nano-sandbox.yaml` | Render `nano-sandbox-api`. Forbids dead CausalRail DB ref `hlwqtlrkwhuogcwnhjrs`. |
| `contracts/causalrail.yaml` | Render `causalrail-api`. Forbids nano-sandbox `sujvxxrwjqsziswuazwm`. |

HTTP (same rules, Python mirror so Render does not need rustc):

- `GET /scopeshield/health`
- `GET /scopeshield/preflight?profile=nano-sandbox`
- `GET /scopeshield/contract/nano-sandbox` (names only)

Live values are never written to JSON output.
