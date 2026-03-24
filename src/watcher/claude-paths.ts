import fs from 'node:fs';
import path from 'node:path';
import { getClaudeProjectsDir } from '../platform/paths.js';

/**
 * Resolve a path to its real path (resolving symlinks).
 * On macOS, /var is a symlink to /private/var, which causes
 * @parcel/watcher to return paths that don't match our base dir.
 */
function resolveRealPath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.normalize(p);
  }
}

/**
 * Extract project slug and session filename from a JSONL file path
 * within the Claude projects directory.
 *
 * Expected structure: <projectsDir>/<projectSlug>/<sessionId>.jsonl
 */
export function parseJsonlPath(
  filePath: string,
  projectsDir?: string,
): { projectSlug: string; sessionFile: string } | null {
  const base = projectsDir ?? getClaudeProjectsDir();
  const normalized = resolveRealPath(filePath);
  const normalizedBase = resolveRealPath(base);

  if (!normalized.startsWith(normalizedBase)) {
    return null;
  }

  const relative = path.relative(normalizedBase, normalized);
  const parts = relative.split(path.sep);

  // Expect exactly: <projectSlug>/<file>.jsonl
  if (parts.length !== 2 || !parts[1]!.endsWith('.jsonl')) {
    return null;
  }

  return {
    projectSlug: parts[0]!,
    sessionFile: parts[1]!,
  };
}

/**
 * Check if a file path is a JSONL file within the Claude projects directory.
 */
export function isClaudeJsonlFile(filePath: string, projectsDir?: string): boolean {
  return parseJsonlPath(filePath, projectsDir) !== null;
}
