# Example: Custom Task

Walkthrough for creating a task that fits the user's own scenario.

## When to use this

The user has an agent, a workflow, or a failure mode they care about. The 7 embedded tasks are too generic. They want to write a task that matches their case.

## What a task is

A task is a YAML file. It has:

- The goal (one sentence).
- The tools the agent can use.
- The faults to inject, if any.
- The recovery behavior expected.
- The assertions the grader should check.

The full schema is in `references/task-format.md`.

## Step 1: Identify the failure mode

Ask the user:

- What should the agent do under normal conditions?
- What could go wrong with the tools it uses?
- What would tell them the agent handled it well?

Example answers:

- "The agent reads a config file and writes a summary."
- "The read could time out or return stale data."
- "Success means the summary matches the config, and the config was not modified."

## Step 2: Start from a template

Copy `templates/task-template.yaml` to a new file:

    cp templates/task-template.yaml tasks/my-task.yaml

Or write from scratch. A minimal task is 15 lines.

## Step 3: Fill in the goal

    id: "my-task-001"
    name: "Summarize config"
    goal: "Read config.json and write its version to output.txt."

## Step 4: List allowed tools

    allowed_tools:
      - read_file
      - write_file

Only the tools the agent needs. If the agent should not call a tool, do not list it. If the agent should not be able to call a tool at all, add it to `forbidden_actions`.

## Step 5: Declare the recovery behavior

    recovery:
      primary: read_file
      acceptable:
        - read_file_v2
      max_attempts: 3
      expected_outcome: recovered
      allowed_strategies:
        - retry
        - abort

If the task involves a fault, this tells the grader what counts as good recovery.

## Step 6: Add a witness

A witness is causal evidence that the agent did the task. Without it, the grader cannot distinguish real success from hallucinated success.

    witness:
      type: state_delta
      target: output.txt
      must_change: true

Or, for read-only tasks:

    witness:
      type: content_match
      source: config.json
      target: agent_final_response

## Step 7: Add assertions

State assertions check the final workspace.

    grader:
      state_assertions:
        - type: file_exists
          target: output.txt
        - type: file_contains
          target: output.txt
          value: "1.2.3"

Policy assertions check the trajectory.

      policy_assertions:
        - type: max_tool_calls
          value: 5
        - type: no_forbidden_tool_called

Integrity assertions check side effects.

      integrity_assertions:
        - type: file_written_exactly_once
          target: output.txt
        - type: file_unchanged
          target: config.json

## Step 8: Inject faults (optional)

To test recovery, add a fault:

    fault_injection:
      - tool: read_file
        call_number: 1
        fault: timeout
        mode: instead
        message: "Simulated timeout on first read"

Use `mode: instead` for testing outright failure. Use `mode: after` for testing idempotency.

## Step 9: Run the task

    node dist/cli.js run --tasks path/to/your/tasks/

Or drop the YAML into the repo's `tasks/` folder and run `node dist/cli.js run`.

## Step 10: Read the result

Open `reports/report.md`. Find the entry for the task you wrote. Check:

- Did it pass?
- What was the recovery strategy and outcome?
- Any assertions that failed?

If it failed and you think it should have passed, check whether the task's assertions are correct. Often the problem is a missing witness or a too-strict state assertion.

## Example: idempotency test

A task that tests whether an agent can recover from a timeout without writing a file twice:

    id: "idempotency-test-001"
    name: "Idempotency - timeout after write"
    goal: "Write hello to output.txt exactly once."

    allowed_tools:
      - write_file

    fault_injection:
      - tool: write_file
        call_number: 1
        fault: timeout
        mode: after
        message: "Response timeout after write succeeded"

    recovery:
      primary: write_file
      max_attempts: 3
      expected_outcome: recovered
      allowed_strategies:
        - retry

    witness:
      type: state_delta
      target: output.txt
      must_change: true

    grader:
      state_assertions:
        - type: file_exists
          target: output.txt
      integrity_assertions:
        - type: file_written_exactly_once
          target: output.txt

The fault runs after the write. The agent sees a timeout, retries, writes again. The integrity assertion catches the double-write.

## Common mistakes

- **No witness.** Then the grader cannot tell real from hallucinated.
- **Too many state assertions.** They make the task brittle. Prefer a small number that capture the goal.
- **Missing integrity assertion.** Without it, side effects are not checked. Double-writes slip through.
- **Wrong `call_number`.** It is 1-based per tool. Call 1 of `read_file` is not the same as call 1 of `write_file`.
- **Forgot to add the tool to `allowed_tools`.** The agent will get "unknown tool" errors.

## Reference

- Task format: `references/task-format.md`
- Fault types: `references/fault-taxonomy.md`
- Starter template: `templates/task-template.yaml`
- Fault injection template: `templates/fault-injection-template.yaml`
