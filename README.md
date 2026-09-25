# MCP-Faultline

> **Break your MCP agent. Then prove it recovered.**

[![CI](https://github.com/gigihsusetyo/mcp-faultline/actions/workflows/ci.yml/badge.svg)](https://github.com/gigihsusetyo/mcp-faultline/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Faultline injects controlled failures into an MCP agent's tool calls, records the trajectory, and grades whether the agent recovered. With evidence, not just pass/fail.

**Status:** MVP. Working, tested, but early. Read [Limitations](#limitations) before trusting it for anything serious.

---

## Why

Most agent benchmarks measure **capability**: can the agent solve the task?

Faultline measures **resilience**. When a tool times out, returns malformed data, or lies, does the agent detect it, recover, or quietly break?

Two agents can both "pass" a task and behave completely differently under failure. Faultline is built to tell them apart.

---

## Quickstart

Requires Node.js >= 20.

```bash
git clone https://github.com/gigihsusetyo/mcp-faultline.git
cd mcp-faultline
npm ci
npm run build

# Run the suite with the embedded agent
node dist/cli.js run

# Oracle validation: good agents vs bad agents
node dist/cli.js negative-controls

# Replay the most recent run
node dist/cli.js replay reports/report.json
```

The `run` command writes `reports/report.json` and `reports/report.md`.

---

## A failure the grader actually caught

This is from the idempotency test. A write succeeds on disk, but the response is replaced by a timeout. The agent retries and writes again.

```
$ npm run test:idempotency-smoke
...
✅ integrity assertion fails
   File written 2 times (expected exactly 1): output.txt
✅ file was actually written (side-effect happened)

Total: 5/5 passed
```

A sequence-based grader would see "two write calls, no error". A state-based grader sees two side effects on a file that should have one. That is the difference.

---

## How it works

```
      Task (YAML)
          |
          v
   +--------------+
   |   Sandbox    |   isolated temp folder
   +--------------+
          |
          v
   +--------------+       +---------------+
   |    Agent     | <---> |  Fault Layer  |   inject / forward
   +--------------+       +---------------+
          |                       |
          |                       v
          |              +------------------+
          |              |  Real MCP Server |
          |              +------------------+
          v
   +--------------+
   |  Trajectory  |   every call, every result
   +--------------+
          |
          v
   +--------------+
   |   Grader     |   5 layers
   +--------------+
          |
          v
      Report (JSON / Markdown)
```

The agent can run embedded (in-process) or as an external process behind a stdio proxy. The proxy lets Faultline sit between a real agent like Cline and a real MCP server.

More detail in [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Commands

| Command | Description |
|---|---|
| `run` | Run the task suite with the embedded agent |
| `list` | List available task YAML files |
| `negative-controls` | Oracle validation: 5 agents × tasks, 21 entries |
| `proxy` | stdio proxy between an external agent and a real MCP server |
| `replay` | Re-run an agent against a recorded trajectory |

---

## Five-layer grading

Every run is graded on five layers. Only the first four affect pass/fail.

| Layer | Question |
|---|---|
| **Outcome** | Did the final workspace match the task? |
| **Safety** | Did the agent stay within allowed tools and constraints? |
| **Recovery** | What strategy did the agent use, and did it work? |
| **Integrity** | What side effects actually happened? |
| **Efficiency** | How many calls, retries, duplicates? (informational) |

Recovery is two-dimensional: a strategy (retry, fallback, abort, ...) and an outcome (recovered, looped, false-recovery, ...).

---

## Fault taxonomy

18 fault types across 6 categories.

| Category | Faults |
|---|---|
| Transport | `timeout`, `latency`, `disconnect`, `rate_limit` |
| Protocol | `malformed_response`, `invalid_schema`, `missing_field` |
| Data | `empty`, `partial_result`, `stale`, `contradictory`, `wrong_value` |
| Authorization | `auth_expired`, `forbidden` |
| Temporal | `delayed`, `out_of_order`, `replayed` |
| Systemic | `burst_failure`, `server_outage`, `cascading_failure` |

Each fault can be applied in one of two modes:

- `mode: instead` replaces the tool call. No side effect happens.
- `mode: after` runs the tool first, then replaces the response. Side effect happens.

`mode: after` is how idempotency violations are modelled: a write succeeds, the agent sees a timeout, retries, and writes twice.

---

## Comparison

| Tool | Focus | Grades recovery? | State-aware? | Replayable? |
|---|---|---|---|---|
| Benchmarks (MCP-Bench, MCP-Atlas, ...) | Capability | No | No | No |
| Chaos tools (mcp-chaos, ...) | Injection + SLI metrics | No | No | No |
| Eval frameworks (mcp-eval, ...) | Pass/fail correctness | No | Partially | No |
| **MCP-Faultline** | Resilience under fault | Yes | Yes | Yes |

The bench measures whether the agent can solve the task. The chaos tool injects faults and measures service-level metrics. Faultline injects faults, then grades what the agent did about them.

---

## Limitations

Honest list. These are the things that are not done yet.

- **Mode A only.** We grade what the agent attempted, not what it consequences were. Mode B is future work.
- **File-based side effects only.** Network calls, emails, git commits are not tracked.
- **One external agent tested.** Cline. Claude Code, Cursor, etc. are untested.
- **No LLM judge.** Everything is deterministic. No model in the grading loop.
- **Fault-level statistics missing.** The report shows pass rates by task, not by fault type.
- **`EmbeddedAgent` loses status detail.** The history always records "error", not the specific status. Known bug.
- **Replay is single-run.** No batch replay, no agent-vs-agent comparison yet.

---

## Development

```bash
npm run build           # tsc
npm run dev             # tsc --watch

npm run test:proxy-smoke        # proxy intercepts and injects faults
npm run test:integrity-smoke    # integrity layer catches double-writes
npm run test:idempotency-smoke  # mode: after produces a real double-write
```

Full suite (build, run, oracle, replay):

```bash
npm run test:all
```

---

## Design notes

A few decisions worth explaining.

**State-based, not sequence-based.** A sequence checker asks "did the agent call tool X before tool Y". A state checker asks "does the final workspace match the task". The second one lets multiple valid solutions pass.

**Faults look like normal responses.** Data-shape faults (`stale`, `empty`, `wrong_value`) return `{ status: "success", data: { _fault: {...}, data } }`. The agent cannot tell from the wire format that anything is wrong. Only the grader sees the `_fault` marker.

**Security is audited, not blocked.** The stdio proxy spawns subprocesses. Rather than blocking unknown commands, we warn and record. Every spawn is logged in the trajectory. The allowlist defaults to `node`, `npx`, `python`, `python3`.

**Replay is real re-execution.** Replaying a trajectory does not just dump the old results. Write tools run again on a fresh sandbox. Read tools return recorded data. The end state matches.

---

## Requirements

- Node.js >= 20
- No Docker. No external services. No API keys for the embedded suite.

---

## License

MIT. See [LICENSE](./LICENSE).

---

## Author

**Gigih Susetyo**. Technical Project Lead, AI Orchestrator.

> *"AI generates. I orchestrate."*