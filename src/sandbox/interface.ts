// src/sandbox/interface.ts

/**
 * Sandbox interface — abstraction for isolated execution environments.
 *
 * A sandbox provides:
 * - An isolated workspace directory
 * - Safe path resolution (prevent escaping the workspace)
 * - Setup and cleanup lifecycle
 *
 * Implementations:
 * - TempFolderSandbox — uses OS temp directory (MVP)
 * - DockerSandbox — uses Docker container (v0.2)
 * - ColimaSandbox — uses Colima (v0.2)
 */

export interface SandboxOptions {
    /** Optional prefix for the workspace directory name */
    prefix?: string;
    /** Optional base directory (defaults to OS temp dir) */
    baseDir?: string;
  }
  
  export interface Sandbox {
    /**
     * Unique identifier for this sandbox instance.
     */
    readonly id: string;
  
    /**
     * Absolute path to the workspace root directory.
     */
    readonly workspacePath: string;
  
    /**
     * Initialize the sandbox — create workspace directory,
     * seed initial files, etc.
     */
    setup(): Promise<void>;
  
    /**
     * Resolve a relative path within the workspace.
     * Throws if the resolved path escapes the workspace.
     *
     * @param relativePath - Path relative to workspace root
     * @returns Absolute path within workspace
     */
    resolvePath(relativePath: string): string;
  
    /**
     * Check if a relative path is within the workspace boundary.
     *
     * @param relativePath - Path relative to workspace root
     * @returns True if path is safe
     */
    isPathSafe(relativePath: string): boolean;
  
    /**
     * Clean up the sandbox — remove workspace directory
     * and all its contents.
     */
    cleanup(): Promise<void>;
  }