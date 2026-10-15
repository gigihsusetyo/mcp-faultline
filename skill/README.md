# MCP-Faultline Agent Skill

Agent skill wrapper for MCP-Faultline, distributed through Agensi.io.

## What this skill is

A SKILL.md package that tells an AI agent how to use the MCP-Faultline CLI. The agent reads the SKILL.md, installs MCP-Faultline if needed, and runs it on the user's behalf.

The skill does not contain the engine. The engine lives in the GitHub repo. This package is instructions plus templates.

## What this skill is not

- Not a standalone tool. It requires the user to install MCP-Faultline.
- Not a general MCP server. Faultline is an evaluator, not a server.
- Not a fix for broken agents. It measures, it does not repair.

## Folder structure

    skill/
    |-- SKILL.md                          Main instructions for the agent
    |-- README.md                         This file
    |-- references/
    |   |-- task-format.md                YAML task schema
    |   |-- fault-taxonomy.md             18 fault types across 6 categories
    |   |-- proxy-setup.md                How to configure the stdio proxy
    |   |-- report-reading.md             How to read the JSON and Markdown reports
    |-- examples/
    |   |-- basic-run.md                  Simplest walkthrough
    |   |-- custom-task.md                Write your own task
    |   |-- proxy-with-cline.md           Test a real agent (Cline)
    |-- templates/
        |-- task-template.yaml            Starter task YAML
        |-- fault-injection-template.yaml Fault injection snippets

## How the skill works

1. User installs the skill through their agent (Claude Code, Cursor, etc.).
2. Agent reads SKILL.md.
3. Skill's frontmatter tells the agent when to trigger: when the user wants to test agent resilience under fault.
4. Agent follows the instructions: verify MCP-Faultline is installed, run it, read the report, explain the results.

The agent never sees the engine code. It only sees the skill files and runs the CLI.

## Prerequisites for users

- Node.js 20 or newer.
- Git and npm available.
- MCP-Faultline installed locally.

The skill walks the user through installation if needed.

## Publishing to Agensi.io

To publish:

1. Enable creator mode on Agensi.
2. Zip the `skill/` folder contents. The `SKILL.md` must be at the root of the zip, not inside a nested folder.
3. Upload the zip through the Submit a Skill button.
4. Fill in the description. Add a link to the GitHub repo.
5. Set a price or leave it free.
6. Wait for the automated security scan and manual review.

Do not include `node_modules/`, `dist/`, `.git/`, `.DS_Store`, or any local file in the zip. Agensi's preflight strips some of these automatically, but the package should be clean to start.

## How to test before publishing

Use Agensi's preflight skill if available, or verify manually:

1. Unzip the package in a temp folder.
2. Confirm `SKILL.md` is at the root.
3. Read `SKILL.md` and make sure it does not reference paths outside the package.
4. Check that no file contains a credential, API key, or local filesystem path.
5. Confirm the frontmatter is valid YAML: `name` and `description` are set.
6. Load the skill in a test agent (Cline is a good target) and follow the instructions.
7. If the instructions mention installing MCP-Faultline, verify that step works on a fresh machine.

## Security considerations

The skill instructs the agent to:

- Clone a public GitHub repo (`github.com/gigihsusetyo/mcp-faultline`).
- Run `npm ci` and `npm run build` in that repo.
- Run `node dist/cli.js` with various subcommands.
- Optionally spawn a subprocess for the stdio proxy.

The agent does not:

- Access the network beyond the initial git clone and npm install.
- Read files outside the cloned repo and the user's workspace.
- Write files outside the workspace and the report folder.
- Use API keys or credentials of any kind.

The stdio proxy is opt-in. It only runs if the user explicitly configures it. The proxy logs every subprocess it spawns.

## Updating the skill

When MCP-Faultline gets a new version:

1. Update the CLI commands in `SKILL.md` if any changed.
2. Update `references/task-format.md` if the task schema changed.
3. Update `references/fault-taxonomy.md` if fault types were added or renamed.
4. Bump the version in `SKILL.md` frontmatter if the format supports it.
5. Re-zip and re-upload.

## Known limitations

See the "Known limitations" section in `SKILL.md`. The same list applies to the skill package.

Additional limitations specific to the skill:

- The skill cannot install MCP-Faultline without the user's permission. The agent will ask.
- The skill assumes the user has Node.js 20 or newer. If not, the agent should stop and explain.
- The skill does not cover the case where the user wants to test their own MCP server with the proxy. That requires manual configuration (see `references/proxy-setup.md`).

## Links

- MCP-Faultline repo: https://github.com/gigihsusetyo/mcp-faultline
- Agensi.io: https://www.agensi.io/
- License: MIT
