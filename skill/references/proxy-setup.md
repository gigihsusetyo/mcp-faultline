# Proxy Setup

The stdio proxy lets Faultline sit between a real external agent (Cline, Claude Code, Cursor) and a real MCP server. The proxy injects faults into the traffic without the agent knowing.

This is what makes Faultline agent-agnostic. The agent runs normally. Faultline does not run the agent's loop.

## When to use the proxy

Use the proxy when:

- The user wants to test an agent they already use (Cline, Claude Code, etc.).
- The user wants to test a real MCP server, not the mock server Faultline ships.
- The user wants to observe fault handling without modifying the agent.

Do not use the proxy for the embedded suite. The embedded suite uses `node dist/cli.js run`.

## How it works

The proxy plays two roles at once:

1. **Server** facing the agent. Listens on its own stdin/stdout.
2. **Client** facing the real MCP server. Spawns the server as a subprocess.

Every `tools/call` from the agent is intercepted. The fault runtime decides whether to inject or forward. The bridge handles the decision.

    Agent  -->  Proxy Server  -->  Bridge  -->  Fault Runtime
                                     |
                                     v
                              Proxy Client  -->  Real MCP Server

## Basic command

    node dist/cli.js proxy \
      --server "node /path/to/your-mcp-server.js" \
      --task tasks/proxy-only/echo-fault-smoke.yaml

Flags:

- `--server` (required) - the command line to spawn the real MCP server.
- `--task` (optional) - path to a task YAML. Only the `fault_injection` array is used.
- `--cwd` (optional) - working directory for the spawned server.

If `--task` is omitted, the proxy forwards all traffic without injecting faults. This is useful for verifying that the proxy works before adding faults.

## Security posture

The proxy spawns subprocesses. The MCP SDK does this without sanitization. Faultline's approach is to warn, not block.

- A default allowlist covers common commands: `node`, `npx`, `python`, `python3`.
- Commands outside the allowlist still run. They are logged as `command_warned`.
- Every spawn is recorded in the trajectory.

The tool is an evaluator, not a firewall. Blocking unknown commands would lose observability, which is worse.

## Setting up with Cline

Cline is a VS Code extension. It configures MCP servers through a JSON file.

### Step 1: Locate the config file

On macOS:

    ~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json

In VS Code, open Cline, go to MCP Servers, and click Configure MCP Servers. VS Code opens the file.

### Step 2: Add the proxy entry

    {
      "mcpServers": {
        "faultline-proxy": {
          "command": "node",
          "args": [
            "/absolute/path/to/mcp-faultline/dist/cli.js",
            "proxy",
            "--server",
            "node /absolute/path/to/your-mcp-server.js",
            "--task",
            "/absolute/path/to/mcp-faultline/tasks/proxy-only/echo-fault-smoke.yaml"
          ],
          "disabled": false,
          "autoApprove": []
        }
      }
    }

Use absolute paths. The config does not resolve relative paths from the workspace.

If you do not want to inject faults yet, remove the `--task` flag and its value.

### Step 3: Reload VS Code

Run "Developer: Reload Window" from the command palette.

### Step 4: Verify

Open the Cline panel. Under MCP Servers, `faultline-proxy` should show a green dot. This means the proxy is connected.

Ask the agent to use a tool from the server. The tool should work as normal. Faultline forwards the call.

### Step 5: Test fault injection

Add the `--task` flag pointing to a task with `fault_injection`. Reload VS Code. Ask the agent to use the tool again.

The first call should return a synthetic fault. If the agent retries, the second call should pass through to the real server.

## Troubleshooting

### Cannot find module '/Users/.../dist/cli.js'

The path in the config is wrong. Use `pwd` in the terminal to get the absolute path of the repo, then update the config.

### Connection closed immediately

The spawned MCP server failed to start. Run the `--server` command in a terminal to see the real error.

### Server shows connected but no tools appear

The proxy forwards `tools/list` to the real server. If the real server has no tools, none appear. Test the real server directly first.

### VS Code does not show proxy logs

VS Code does not capture stderr from the subprocess. To see logs, run the proxy manually in a terminal and use a different client.

## Reference

The proxy code lives in `src/proxy/`:

- `client.ts` - spawns and connects to the real server.
- `server.ts` - faces the agent on stdin/stdout.
- `bridge.ts` - wires the two sides together and applies faults.
- `fault-runtime.ts` - decides whether to inject.

The security posture is documented in the README under "Design notes".
