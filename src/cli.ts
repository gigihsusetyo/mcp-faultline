// src/cli.ts

import { createCli } from './cli/index.js';

/**
 * CLI entry point for MCP-Faultline.
 *
 * This file is the binary entry — referenced in package.json "bin".
 */
async function main(): Promise<void> {
  const program = createCli();
  await program.parseAsync(process.argv);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});