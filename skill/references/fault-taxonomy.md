# Fault Taxonomy

18 fault types across 6 categories. Each one simulates a specific way a tool can fail.

## Categories

### Transport

Failures at the connection or transport layer.

- `timeout` - the call hangs and eventually times out.
- `latency` - the call succeeds, but with an abnormal delay.
- `disconnect` - the connection drops mid-call.
- `rate_limit` - the server rejects the call with a rate-limit error.

### Protocol

Failures in the response format.

- `malformed_response` - the response cannot be parsed.
- `invalid_schema` - the response parses, but violates the declared schema.
- `missing_field` - the response is valid JSON, but a required field is absent.

### Data

Failures in the content of the response. The call succeeds, but the data is wrong.

- `empty` - success status, but an empty payload.
- `partial_result` - success status, but an incomplete result.
- `stale` - success status, but the data is outdated.
- `contradictory` - success status, but the data contradicts a prior result.
- `wrong_value` - success status, but a specific field has an incorrect value.

Data faults are the most important category. They look like success on the wire. The agent cannot tell from the format alone that anything is wrong. Only by cross-checking against another source can the agent detect the problem. This is what separates resilience evaluation from error handling.

### Authorization

Failures related to permissions.

- `auth_expired` - the auth token has expired.
- `forbidden` - the caller lacks permission for this call.

### Temporal

Failures related to ordering and time.

- `delayed` - the response arrives after a long delay, but is still valid.
- `out_of_order` - the response corresponds to a different (earlier) request.
- `replayed` - the response is a replay of a previous response.

### Systemic

Failures affecting multiple calls.

- `burst_failure` - many calls fail in a short window.
- `server_outage` - the target server is entirely unreachable.
- `cascading_failure` - one failure triggers failures in dependent calls.

## Injection modes

Each fault can be applied in one of two modes.

### `mode: instead`

The fault replaces the tool call. The real tool is not called.

- No side effect happens.
- The agent sees a synthetic error or a synthetic response.
- Use this for testing how the agent handles a call that fails outright.

### `mode: after`

The fault is appended after the tool runs.

- The real tool is called first. Side effects happen.
- Then the response is replaced with the synthetic one.
- The agent sees the synthetic response, but the side effect already occurred.
- Use this for testing idempotency violations and state-vs-sequence problems.

### Example: idempotency violation

    fault_injection:
      - tool: write_file
        call_number: 1
        fault: timeout
        mode: after
        message: "Response timeout after write succeeded"

The agent writes a file successfully. The response is replaced with a timeout. The agent believes the write failed and retries. The second write also happens. The file is now written twice when it should have been written once.

A sequence-based grader would see "two write calls, no error." A state-based grader sees two side effects on a file that should have one. This is the case Faultline is built for.

## Fault definitions in code

Faults are defined in `src/fault/registry.ts`. Each entry has:

- `type` - the fault type string.
- `category` - one of the 6 categories.
- `description` - a short human-readable description.
- `build` - a function that produces the synthetic result.

Adding a new fault means adding one entry to the registry. Nothing else changes.

## Data-shape faults look like success

Faults in the `Data` category return a success status with a special marker in the payload:

    {
      "status": "success",
      "data": {
        "_fault": { "kind": "stale" },
        "data": { ... }
      }
    }

The agent cannot tell from the wire format that anything is wrong. Only the grader reads the `_fault` marker. This is intentional. Silent wrong data is the hardest failure mode to detect, and the one most worth testing.

## Current limitations

- Only `mode: instead` and `mode: after` are supported. No `before` or `replace`.
- Only `transient` schedule is reachable from the task schema. `persistent` and `probabilistic` are wired in the code but not exposed.
- Faults target tool calls only. They do not target network transport, process crashes, or filesystem failures directly.
