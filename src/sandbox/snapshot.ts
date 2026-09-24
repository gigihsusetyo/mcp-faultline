// src/sandbox/snapshot.ts

import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

/**
 * Snapshot — a hash map of file paths to content hashes.
 *
 * Used to detect whether files changed during a run.
 * Before the run: take a snapshot.
 * After the run: take another snapshot.
 * Compare: if a file's hash differs, it changed.
 */
export interface Snapshot {
  /** Map of relative path → SHA-256 hex digest of file content */
  files: Record<string, string>;
  /** Timestamp when the snapshot was taken */
  takenAt: number;
}

/**
 * Take a snapshot of a workspace directory.
 *
 * Walks the directory recursively, hashes every file's content.
 * Skips directories starting with "." (hidden folders).
 *
 * @param workspacePath - Absolute path to workspace root
 * @returns Snapshot object
 */
export async function takeSnapshot(workspacePath: string): Promise<Snapshot> {
  const files: Record<string, string> = {};

  await walk(workspacePath, workspacePath, files);

  return {
    files,
    takenAt: Date.now(),
  };
}

/**
 * Recursively walk a directory, hashing files.
 */
async function walk(
  rootPath: string,
  currentPath: string,
  files: Record<string, string>
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(currentPath);
  } catch {
    return;
  }

  for (const entry of entries) {
    // Skip hidden files/folders
    if (entry.startsWith('.')) {
      continue;
    }

    const absolute = join(currentPath, entry);
    let stats;
    try {
      stats = await stat(absolute);
    } catch {
      continue;
    }

    if (stats.isDirectory()) {
      await walk(rootPath, absolute, files);
    } else if (stats.isFile()) {
      try {
        const content = await readFile(absolute);
        const hash = createHash('sha256').update(content).digest('hex');
        const relativePath = relative(rootPath, absolute).split(sep).join('/');
        files[relativePath] = hash;
      } catch {
        // Skip files that cannot be read
      }
    }
  }
}

/**
 * Compare two snapshots to detect changes.
 *
 * @returns Object with added, removed, and changed file lists
 */
export function compareSnapshots(
  before: Snapshot,
  after: Snapshot
): {
  added: string[];
  removed: string[];
  changed: string[];
} {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];

  const beforeFiles = before.files;
  const afterFiles = after.files;

  // Added or changed
  for (const [path, hash] of Object.entries(afterFiles)) {
    if (!(path in beforeFiles)) {
      added.push(path);
    } else if (beforeFiles[path] !== hash) {
      changed.push(path);
    }
  }

  // Removed
  for (const path of Object.keys(beforeFiles)) {
    if (!(path in afterFiles)) {
      removed.push(path);
    }
  }

  return { added, removed, changed };
}

/**
 * Check if a specific file changed between snapshots.
 *
 * Returns:
 * - true if the file's content differs
 * - false if the file is unchanged
 * - null if the file doesn't exist in one or both snapshots
 */
export function didFileChange(
  before: Snapshot,
  after: Snapshot,
  relativePath: string
): boolean | null {
  const normalized = relativePath.replace(/^\.\//, '');
  const beforeHash = before.files[normalized];
  const afterHash = after.files[normalized];

  if (beforeHash === undefined && afterHash === undefined) {
    return null; // file doesn't exist in either
  }
  if (beforeHash === undefined) {
    return true; // file was added
  }
  if (afterHash === undefined) {
    return true; // file was removed (consider it "changed")
  }
  return beforeHash !== afterHash;
}