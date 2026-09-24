// src/sandbox/temp-folder.ts

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, normalize, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Sandbox, SandboxOptions } from './interface.js';

/**
 * TempFolderSandbox — isolated workspace in the OS temp directory.
 *
 * MVP implementation. Uses OS temp dir (e.g., /tmp on Unix).
 * Provides path safety checks to prevent escaping the workspace.
 *
 * Trade-offs:
 * - (+) Zero setup, zero cost, works everywhere
 * - (-) Weak isolation (not a real container)
 * - (-) Path safety is enforced in userland, not by the OS
 *
 * Future: replace with DockerSandbox or ColimaSandbox.
 */
export class TempFolderSandbox implements Sandbox {
  readonly id: string;
  readonly workspacePath: string;
  private setupDone = false;

  constructor(options: SandboxOptions = {}) {
    this.id = randomUUID();
    const prefix = options.prefix ?? 'mcp-faultline-';
    const baseDir = options.baseDir ?? tmpdir();
    // Note: mkdtemp appends random suffix; we use a placeholder
    // that will be replaced during setup().
    this.workspacePath = join(baseDir, `${prefix}${this.id}`);
  }

  async setup(): Promise<void> {
    if (this.setupDone) {
      return;
    }

    await mkdir(this.workspacePath, { recursive: true });
    this.setupDone = true;
  }

  resolvePath(relativePath: string): string {
    const normalized = normalize(relativePath);
    const absolute = resolve(this.workspacePath, normalized);

    if (!this.isPathSafe(relativePath)) {
      throw new Error(
        `Path "${relativePath}" escapes sandbox workspace "${this.workspacePath}"`
      );
    }

    return absolute;
  }

  isPathSafe(relativePath: string): boolean {
    const normalized = normalize(relativePath);
    const absolute = resolve(this.workspacePath, normalized);
    const workspaceWithSep = this.workspacePath.endsWith(sep)
      ? this.workspacePath
      : this.workspacePath + sep;

    return absolute === this.workspacePath || absolute.startsWith(workspaceWithSep);
  }

  async cleanup(): Promise<void> {
    if (!this.setupDone) {
      return;
    }

    try {
      await rm(this.workspacePath, { recursive: true, force: true });
    } catch (error) {
      // Log but do not throw — cleanup failures should not break the run
      console.error(
        `[TempFolderSandbox] Cleanup failed for "${this.workspacePath}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      this.setupDone = false;
    }
  }

  /**
   * Seed the workspace with initial files.
   * Convenience method for test setup.
   *
   * @param files - Map of relative path → content
   */
  async seed(files: Record<string, string>): Promise<void> {
    for (const [relativePath, content] of Object.entries(files)) {
      const absolutePath = this.resolvePath(relativePath);
      const dir = absolutePath.substring(0, absolutePath.lastIndexOf(sep));
      await mkdir(dir, { recursive: true });
      await writeFile(absolutePath, content, 'utf-8');
    }
  }
}