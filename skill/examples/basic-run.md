# Example: Basic Run

A complete walkthrough of the simplest way to use MCP-Faultline.

## What this example does

The user wants to see whether MCP-Faultline works and what it does. They have never used it before.

The agent will:

1. Verify that MCP-Faultline is installed.
2. Run the embedded task suite.
3. Read the report.
4. Explain the results.

## Step 1: Check installation

Ask the user whether they have already installed MCP-Faultline, or check yourself:

    npx mcp-faultline --version

If it prints a version, skip to Step 3.

If not, install it:

    git clone https://github.com/gigihsusetyo/mcp-faultline.git
    cd mcp-faultline
    npm ci
    npm run build

This installs dependencies and compiles the TypeScript source into `dist/`.

## Step 2: Verify the build

    node dist/cli.js --version

Should print `0.2.0` or newer.

If it does not, check that `node --version` is 20 or newer.

## Step 3: Run the suite

    node dist/cli.js run

This runs the embedded task suite. You will see output like:

    Running 7 task(s) x 1 run(s)...
    JSON report: .../reports/report.json
    Markdown report: .../reports/report.md

    Summary:
      Total:     7
      Passed:    7
      Failed:    0
      Pass rate: 100.0%
      95% CI:    [64.6%, 100.0%]

The run takes less than a second. It spawns a fresh temp folder for each task, seeds the workspace, runs the embedded agent, records the trajectory, grades, and cleans up.

## Step 4: Read the report

Open `reports/report.md`. Show the user the following sections:

1. **Overall** - pass rate and confidence interval.
2. **Task-Level Statistics** - macro view, unit is task.
3. **Data Quality** - warnings about sample size.
4. **Recovery Classification** - what strategies the agent used.
5. **Efficiency** - how many tool calls, retries, duplicates.

Do not skip Data Quality. The warnings are part of the report on purpose.

## Step 5: Explain what they saw

Key points to cover with the user:

- The suite has 7 tasks. Each tests a different failure mode or behavioral constraint.
- Faults were injected on some tasks. The embedded agent recovered from them.
- The grader checked 5 layers: outcome, safety, recovery, integrity, efficiency.
- Only the first four layers affect pass/fail. Efficiency is informational.
- The report is honest about sample size. One run per task is a small sample.

## Step 6: Offer next steps

Suggest the user try one of:

- **Oracle validation** - `node dist/cli.js negative-controls`. Shows the grader can tell good agents from bad.
- **Replay** - `node dist/cli.js replay reports/report.json`. Proves the run is reproducible.
- **A custom task** - see `examples/custom-task.md`.
- **The stdio proxy** - see `examples/proxy-with-cline.md`.

## What to avoid

Do not tell the user:

- That the suite measures agent capability. It measures resilience, not capability.
- That the pass rate is meaningful without context. Always mention sample size.
- That this proves the user's agent is good or bad. This suite uses the embedded agent. It does not test theirs.

## Sample output

    $ node dist/cli.js run
    Running 7 task(s) x 1 run(s)...
    JSON report: /path/to/reports/report.json
    Markdown report: /path/to/reports/report.md

    Summary:
      Total:     7
      Passed:    7
      Failed:    0
      Pass rate: 100.0%
      95% CI:    [64.6%, 100.0%]

Then open `reports/report.md` and read the top sections.
