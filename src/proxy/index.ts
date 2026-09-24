// src/proxy/index.ts

/**
 * Public surface of the proxy module.
 *
 * Consumers (CLI, tests) should import from here rather than
 * reaching into individual files. Keeps the internal file layout
 * free to change without breaking callers.
 */

// Types
export type {
  ProxyConfig,
  ProxyEvent,
  ProxyEventType,
  ProxyActor,
  ProxyFaultRecord,
  ProxyResult,
} from './types.js';

export {
  DEFAULT_ALLOWED_COMMANDS,
  createProxyConfig,
  resolveAllowedCommands,
  checkCommandAllowed,
} from './types.js';

// Client (spawn real MCP server)
export type {
  ProxyClientOptions,
  ProxyClientHandle,
  ProxyClientEvent,
} from './client.js';
export { createProxyClient } from './client.js';

// Server (face the external agent)
export type {
  ProxyServerOptions,
  ProxyServerHandle,
  ProxyServerEvent,
} from './server.js';
export { createProxyServer } from './server.js';

// Fault runtime (decision engine)
export type {
  FaultRuntimeHandle,
  FaultRuntimeOptions,
  FaultRuntimeDecision, 
  FaultDecisionInput,
  FaultSchedule,
} from './fault-runtime.js';
export { createFaultRuntime } from './fault-runtime.js';

// Bridge (wire it all together)
export type {
  BridgeOptions,
  BridgeHandle,
  BridgeEvent,
} from './bridge.js';
export { createBridge } from './bridge.js';