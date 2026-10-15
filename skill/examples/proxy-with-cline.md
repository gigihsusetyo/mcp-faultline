# Example: Proxy with Cline

Walkthrough for testing a real external agent (Cline) with the stdio proxy.

## Why this example matters

This is the case that Faultline was built for. An agent the user does not control (Cline, an LLM-driven agent) talks to a real MCP server. Faultline sits in the middle, injects faults, and records what happens.

No changes to the agent. No changes to the server. Faultline is invisible.

## Prerequisites

- VS Code installed.
- Cline extension installed (the `saoudrizwan.claude-dev` extension).
- Node.js 20 or newer.
- MCP-Faultline cloned and built.
- A real MCP server to spawn. For this example, use the mock server that ships with Faultline:

    tests/fixtures/mock-mcp-server.mjs

The mock server has one tool: `echo`.

## Step 1: Verify the proxy works

Before configuring Cline, run the proxy manually to confirm it spawns the mock server correctly.

    node dist/cli.js proxy \
      --server "node tests/fixtures/mock-mcp-server.mjs"

You should see log lines starting with `[proxy]`:

    [proxy] command_allowed - Command allowlisted: node
    [proxy] server_spawn - MCP server spawned: node
    [proxy] proxy_start - proxy server listening on stdio

The proxy is now waiting for input on stdin. Press Ctrl+C to stop it.

If you see errors here, do not configure Cline yet. Fix the proxy first.

## Step 2: Locate the Cline config file

On macOS:

    ~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json

The easiest way to open it: in VS Code, open the Cline panel, go to MCP Servers, click the gear icon, and choose Configure MCP Servers.

## Step 3: Add the proxy to the config

Paste this into the JSON file. Replace `/absolute/path/to/mcp-faultline` with the actual path on your machine. Use `pwd` in the repo folder to get it.

    {
      "mcpServers": {
        "faultline-proxy": {
          "command": "node",
          "args": [
            "/absolute/path/to/mcp-faultline/dist/cli.js",
            "proxy",
            "--server",
            "node /absolute/path/to/mcp-faultline/tests/fixtures/mock-mcp-server.mjs"
          ],
          "disabled": false,
          "autoApprove": []
        }
      }
    }

There is no `--task` flag yet. This means the proxy forwards everything without injecting faults. This is the safe first step: verify the connection works before adding faults.

## Step 4: Reload VS Code

Open the command palette (`Cmd+Shift+P` on macOS) and run:

    Developer: Reload Window

This makes Cline re-read the config.

## Step 5: Verify the connection

Open the Cline panel. Under MCP Servers, you should see `faultline-proxy` with a green dot. This means the proxy is connected.

Click the server to expand it. You should see one tool: `echo`.

If the dot is red, check the troubleshooting section in `references/proxy-setup.md`.

## Step 6: Test that tools work

In the Cline chat, ask:

    Use the echo tool from faultline-proxy to echo the message "hello proxy"

Cline should:

1. Call `echo` with `{"message": "hello proxy"}`.
2. Show a confirmation prompt (unless you enabled auto-approve).
3. Receive the response `hello proxy`.

The task completes. No faults were injected.

## Step 7: Add a fault

Now edit the Cline config again. Add the `--task` flag:

      "args": [
        "/absolute/path/to/mcp-faultline/dist/cli.js",
        "proxy",
        "--server",
        "node /absolute/path/to/mcp-faultline/tests/fixtures/mock-mcp-server.mjs",
        "--task",
        "/absolute/path/to/mcp-faultline/tasks/proxy-only/echo-fault-smoke.yaml"
      ],

Reload VS Code. Verify the connection again.

## Step 8: Test fault injection

Ask Cline again:

    Use the echo tool from faultline-proxy to echo the message "fault test 1"

What should happen:

1. **Call 1** - Faultline injects a `timeout` on the first call. The real server is not reached. Cline sees an error.
2. **Call 2** - Cline retries. Faultline forwards to the real server. The echo succeeds.

Cline should complete the task with the echoed message.

This is the proof that Faultline works with a real agent. Cline's own retry logic ran, not yours.

## Step 9: Understand what just happened

The user did not write any retry logic. Cline decided to retry. This is why Faultline measures resilience and not capability.

A sequence-based checker would see "two calls to echo." It cannot tell whether the agent should have retried, whether the first call was real, or what the agent believed happened.

Faultline records the trajectory and grades the behavior. It knows:

- Call 1 was a synthetic timeout. The real server was never reached.
- Call 2 reached the real server and succeeded.
- Cline's recovery strategy was `retry`.
- The outcome was `recovered`.

This is the story Faultline tells.

## Step 10: Try a different fault

Change the fault in the task YAML. For example:

    fault_injection:
      - tool: echo
        call_number: 1
        fault: malformed_response
        mode: instead
        message: "Simulated malformed response"

Reload VS Code. Ask Cline to use `echo` again. See how Cline handles a different failure.

The behavior may differ. Cline might retry, might fall back, might give up. Faultline records whatever it does.

## Troubleshooting

### Cline shows the server as red

Check the troubleshooting section in `references/proxy-setup.md`. The most common cause is an incorrect absolute path.

### Cline connects but the tool does not appear

Click the refresh icon next to `faultline-proxy` in the MCP Servers panel. Wait a few seconds.

### Fault does not appear to be injected

Check that the `--task` flag points to a YAML file with a valid `fault_injection` entry. Verify the `tool` name matches a tool the server exposes. Verify the `call_number` is 1 for the first call.

### First call succeeds but should have failed

The `call_number` in the fault YAML may not match. Counts are per tool, 1-based. If the mock server has only `echo`, the first `echo` call is call 1.

## What this proves

When this works, you have shown:

- Faultline can sit between a real agent and a real MCP server.
- The agent does not need to know Faultline exists.
- The agent's natural recovery behavior can be observed and graded.
- The `mode: instead` fault produces a synthetic failure without touching the server.

This is the same pattern you can use with any external agent. Cline is one example. The configuration for Claude Code, Cursor, and others is similar.

## Further reading

- Proxy setup reference: `references/proxy-setup.md`
- Fault taxonomy: `references/fault-taxonomy.md`
- Fault injection template: `templates/fault-injection-template.yaml`
