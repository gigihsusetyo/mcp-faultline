# MCP-Faultline

> **Break your MCP agent. Then prove it recovered.**

[![CI](https://github.com/gigihsusetyo/mcp-faultline/actions/workflows/ci.yml/badge.svg)](https://github.com/gigihsusetyo/mcp-faultline/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Reproducible, task-level, state-aware resilience evaluation for MCP agents.**

Faultline injects controlled failures into the tool calls of an MCP agent, records the full trajectory, and grades whether the agent recovered — with verifiable evidence, not just a pass/fail bit.

---

## Why

Most agent benchmarks measure **capability**: can the agent solve the task?

Faultline measures **resilience**: when a tool times out, returns malformed data, or lies — does the agent detect it, recover, or quietly break?

Two agents can both "pass" a task while behaving completely differently under failure. Faultline is built to tell them apart.

---

## Quickstart

```bash
# Install
npm ci

# Build
npm run build

# Run the task suite (embedded agent)
node dist/cli.js run

# Run oracle validation (negative controls)
node dist/cli.js negative-controls

# Replay the most recent run
node dist/cli.js replay reports/report.json
```

The `run` command writes `reports/report.json` and `reports/report.md`.

---

## Commands

| Command | Description |
|---|---|
| `run` | Run the task suite with the embedded agent and produce a report |
| `list` | List available task YAML files |
| `negative-controls` | Run oracle validation (good agents vs bad agents) |
| `proxy` | Run the stdio proxy between an external MCP agent and a real MCP server |
| `replay` | Re-run an agent against a recorded trajectory |

---

## What's Inside

### Five-layer grading

Every run is graded on five independent layers:

1. **Outcome** — did the final state of the workspace match the task?
2. **Safety** — did the agent stay within its allowed tools and constraints?
3. **Recovery** — how did the agent respond to failures? (strategy + outcome)
4. **Integrity** — what side-effects actually happened? (e.g. written exactly once)
5. **Efficiency** — how much work did it take? (informational, not pass/fail)

### Fault taxonomy

18 fault types across 6 categories:

- **Transport** — `timeout`, `latency`, `disconnect`, `rate_limit`
- **Protocol** — `malformed_response`, `invalid_schema`, `missing_field`
- **Data** — `empty`, `partial_result`, `stale`, `contradictory`, `wrong_value`
- **Authorization** — `auth_expired`, `forbidden`
- **Temporal** — `delayed`, `out_of_order`, `replayed`
- **Systemic** — `burst_failure`, `server_outage`, `cascading_failure`

Plus two injection modes per fault:

- `mode: instead` — the fault replaces execution (no side-effect)
- `mode: after` — the fault is appended after execution (side-effect happens) — this is how idempotency violations are modelled

### Negative controls

A 21-entry matrix of (agent × task) pairs that proves the framework can distinguish a good agent from a broken one. See `node dist/cli.js negative-controls`.

### Replay

Every run can be replayed from its recorded trajectory: same tool responses, same grade, same efficiency — without touching the network.

---

## Requirements

- Node.js >= 20
- No Docker, no external services, no API keys needed for the embedded suite

---

## Development

```bash
npm run build           # tsc
npm run dev             # tsc --watch

npm run test:proxy-smoke        # proxy intercepts + injects faults
npm run test:integrity-smoke    # integrity layer catches double-writes
npm run test:idempotency-smoke  # mode: after produces a real double-write
```

---

## License

MIT — see [LICENSE](./LICENSE).

---

## Author

**Gigih Susetyo** — Technical Project Lead | AI Orchestrator

> *"AI generates. I orchestrate."*