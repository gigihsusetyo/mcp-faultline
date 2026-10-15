---
name: mcp-faultline
description: Test MCP agent resilience under controlled tool failures. Use when the user wants to check whether an agent recovers from timeouts, malformed data, or wrong responses. Injects faults, records trajectory, grades recovery with 5-layer evidence. This is an evaluation tool. It does not repair or improve agents.
---

# MCP-Faultline

Break your MCP agent (in a controlled way). Then prove it recovered.

Faultline injects synthetic failures into an MCP agent's tool calls, records the trajectory, and grades whether the agent recovered. With evidence, not just pass/fail.

Faultline is an evaluation tool. It measures behavior. It does not fix or improve agents.

## When to use this skill

Use this skill when the user wants to:

- Test how an MCP agent behaves when a tool times out, returns bad data, or lies.
- Check whether an agent retries, falls back, aborts, or quietly breaks.
- Replay a previous run to check whether it was reproducible.
- Audit an agent's side effects (for example, did it write a file twice when it should have written once).

Do not use this skill for general MCP server development, tool-building, or capability benchmarks. This is specifically for resilience evaluation under fault.

If the user asks for a mix of testing and fixing, run the evaluation, report the findings, and stop. Do not modify the agent's implementation unless the user separately asks for that in a new request.

## Prerequisites

- Node.js 20 or newer.
- Git and npm available on the system.
- A terminal the agent can run commands in.

Verify Node.js:

    node --version

Should print v20 or newer. If it prints an older version, stop and tell the user.

## Setup

MCP-Faultline is a Node.js CLI. It is not a server. The user must install it once before this skill can use it.

### Check if it is already installed

If the CLI is on the PATH (for example, installed globally or linked):

    mcp-faultline --version

If it prints a version, skip to Usage.

If the command fails, inspect the error before assuming the CLI is not installed.

- If the executable is not found (command not found, no such file), proceed to the install step.
- If the executable is found but fails for another reason (permission denied, runtime error), report the error to the user. Do not reinstall.
- If you are not sure which case applies, report what you saw and ask the user before installing.

Note: `npx mcp-faultline --version` may download the package if it is not installed. That is a side effect. If you only want to check whether a local install exists, use the command above, not `npx`.

### Install from the public repo

If it is not installed, clone and build it. Pick a destination folder that does not already exist. Do not overwrite an existing folder without asking the user first.

For example, clone into the home directory:

    cd ~
    git clone https://github.com/gigihsusetyo/mcp-faultline.git
    cd mcp-faultline
    npm ci
    npm run build

`npm ci` uses the checked-in `package-lock.json` to install exact versions. Do not use `npm install` here.

If `git clone` fails because the folder already exists, ask the user what to do. Options:

1. Use the existing folder if it already contains a Faultline install.
2. Clone into a different folder.
3. If the user explicitly asks you to remove the existing folder, do so. Otherwise, do not delete anything. Report the situation and wait for the user's decision.

If `npm ci` or `npm run build` fails, stop and report the error. Common causes are network issues, a Node version that is too old, or a corrupted cache.

### Verify the build

After a successful build, from inside the repo folder:

    node dist/cli.js --version

Should print `0.2.0` or newer.

The remaining commands in this skill assume the current directory is the cloned repo folder. If you are somewhere else, either `cd` into the repo, or use absolute paths.

## Commands

| Command | What it does |
|---|---|
| `run` | Run the task suite with the embedded agent |
| `list` | List available task YAML files |
| `negative-controls` | Oracle validation: 5 agents x tasks, 21 entries |
| `proxy` | stdio proxy between an external agent and a real MCP server |
| `replay` | Re-run an agent against a recorded trajectory |

Full command reference: see `references/` in this skill folder.

## Usage

Run the following commands from inside the cloned repo folder.

### Run the suite

    node dist/cli.js run

This runs the 7 embedded tasks, injects faults where the task specifies, grades each one, and writes `reports/report.json` and `reports/report.md`.

If a `reports/` folder already contains files from a previous run, they will be overwritten. Ask the user before running if the previous reports matter.

### Oracle validation

    node dist/cli.js negative-controls

This runs a 21-entry matrix of (agent, task) pairs. Good agents should pass, bad agents should fail.

The validation passes when all 21 entries produce the expected result. That is, when the framework correctly distinguishes good agents from bad ones. It does not mean every agent in the matrix is supposed to pass.

### Replay a previous run

    node dist/cli.js replay reports/report.json

This re-executes the agent against the recorded trajectory and compares the new result with the old one.

The replay matches when three things are identical:

1. The grade verdict (pass/fail).
2. The number of tool calls.
3. The efficiency metrics (calls, retries, fallbacks, duplicates).

Wall time will differ. That is expected and does not count as a mismatch.

If the replay does not match, it usually means the agent behaved differently than in the original run. This can happen if the agent is non-deterministic or if the environment changed.

### Use the stdio proxy

The proxy sits between a real external agent (Cline, Claude Code, etc.) and a real MCP server. The proxy injects faults into the traffic.

    node dist/cli.js proxy \
      --server "node /path/to/mcp-server.js" \
      --task tasks/proxy-only/echo-fault-smoke.yaml

For setup with Cline specifically, see `references/proxy-setup.md`. The reference covers where to find the config file, how to add the proxy entry, and how to verify the connection.

## What the grader checks

Every run is graded on 5 layers. Only the first 4 affect pass/fail.

1. **Outcome** - did the final workspace match the task?
2. **Safety** - did the agent stay within allowed tools and constraints?
3. **Recovery** - what strategy did the agent use, and did it work?
4. **Integrity** - what side effects actually happened?
5. **Efficiency** - how many calls, retries, duplicates? (informational)

A run passes only if layers 1-4 all pass. There is no weighting. A single failure in any of the first four layers fails the run.

Efficiency does not affect pass/fail. It is reported for context.

## Safety rules

Before running any command, follow these rules.

**Ask before installing.** Cloning the repo and running `npm ci` downloads code and modifies the local filesystem.

Two different situations require two different responses:

1. **Faultline is already installed** (the `mcp-faultline --version` check succeeded). No install action is needed. Proceed to usage.
2. **Faultline is not installed.** Ask the user for permission before running `git clone` and `npm ci`. A previous session does not carry permission. Even if the user approved an install earlier in this conversation, confirm once more before you actually run the commands.

**Do not overwrite existing files without asking.** The `run` command writes to `reports/`. If that folder already has files, ask before overwriting.

**Do not remove folders.** If `git clone` fails because the destination exists, do not delete anything. Ask the user.

**Do not modify the user's workspace.** Faultline writes only to two places:

1. **Its own temp sandbox.** A throwaway folder created by the CLI for each run. This is where the agent under test does its work. The CLI cleans it up after the run.
2. **The `reports/` folder inside the cloned Faultline repo.** This is where `report.json` and `report.md` are written.

Everything else is off-limits:

- The user's own project folders.
- Files outside the Faultline repo.
- Any file the agent is asked to inspect but not modify.

If the user asks to test their own MCP server or their own agent, that work happens in the temp sandbox or in a config file the user explicitly points you to. Do not reach outside.

The sandbox is a temp folder, not a container. Path safety is enforced in code (a call cannot escape via `../`), but the folder is not isolated at the OS level.

**Do not modify the agent under test.** This skill evaluates agents. It does not repair them.

**Do not run the proxy without the user's explicit request.** The stdio proxy spawns subprocesses. It should only run when the user asks for it.

## When the user wants to write their own task

See `references/task-format.md`. There is also a starter template in `templates/task-template.yaml`.

The task YAML is validated when loaded. If a required field is missing, the CLI will report a schema error and stop.

## Known limitations

Be honest about these when the user asks.

- **Mode A only.** Faultline grades what the agent attempted, not the consequences in the broader system. Mode A means the grader sees the agent's calls and the resulting workspace, but not downstream effects.
- **File-based side effects only.** Network calls, emails, git commits are not tracked. File operations that are tracked include create, modify, and delete within the sandbox.
- **One external agent tested.** Cline. Claude Code and Cursor are untested but likely work with the same configuration pattern.
- **No LLM judge.** Everything is deterministic. There is no model in the grading loop. Results still depend on the environment (Node version, filesystem state).
- **Fault-level statistics missing.** Reports show pass rates by task, not by fault type. Individual fault events are still in the trajectory.
- **Replay is single-run.** No batch replay, no agent-vs-agent comparison.
- **The embedded agent loses status detail.** History records "error", not the specific failure type. The trajectory still contains the real status.
- **Not a security boundary.** The sandbox is a temp folder with path checks, not a container. Faultline evaluates resilience, not isolation. Do not rely on it to contain malicious code.

## What not to claim

Do not tell the user that this skill:

- Supports all MCP agents. Only the embedded agent and Cline are tested.
- Grades network side effects. Only file operations are tracked.
- Uses an LLM to judge. It does not.
- Makes agents better. It measures, it does not fix.

When describing support for a specific agent, prefer "tested with Cline" over "supports Cline". The distinction matters.

## Reporting results

After a run, read `reports/report.md`. It contains:

- Overall pass rate with a 95% Wilson confidence interval.
- Per-task breakdown.
- Recovery classification (strategy + outcome).
- Efficiency metrics.
- Data quality warnings.

Explain the data quality warnings to the user. Do not present pass rate without context. If the sample is small (1 run per task), say so.

If `reports/report.md` is missing or unreadable, check `reports/report.json`. If both are missing, the run did not complete. Report that to the user.

## Links

- GitHub: https://github.com/gigihsusetyo/mcp-faultline
- Architecture: `ARCHITECTURE.md` in the repo
- License: MIT
