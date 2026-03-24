import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '../shared/logger.js';
import { getClaudeProjectsDir } from '../platform/paths.js';

const log = createLogger('session-discovery');

/**
 * Discovered session info from the filesystem.
 */
export interface DiscoveredSession {
  /** Session ID extracted from filename (UUID format) */
  externalId: string;
  /** Project slug (directory name under projects/) */
  projectSlug: string;
  /** Absolute path to the JSONL file */
  jsonlPath: string;
  /** File size in bytes */
  fileSize: number;
}

/**
 * Compute project slug matching Claude Code's encoding.
 * Rule: replace all non-alphanumeric chars (except '-') with '-'.
 *
 * Example: /Users/alice/Projects/my_app → -Users-alice-Projects-my-app
 */
export function computeProjectSlug(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9-]/g, '-');
}

/**
 * Reverse a project slug back to a likely project path.
 * This is imperfect (lossy transformation) but useful for display.
 */
export function slugToPath(slug: string): string {
  // Replace leading dash and convert dashes that look like separators
  // This is a best-effort heuristic
  if (process.platform === 'win32') {
    // Windows: -C-Users-Name-Projects → C:\Users\Name\Projects
    const parts = slug.replace(/^-/, '').split('-');
    if (parts.length >= 1 && parts[0]!.length === 1) {
      // Looks like a drive letter
      return parts[0]! + ':\\' + parts.slice(1).join('\\');
    }
    return parts.join('\\');
  }
  // Unix: -Users-alice-Projects → /Users/alice/Projects
  return slug.replace(/-/g, '/');
}

/**
 * Scan the Claude Code projects directory and discover all JSONL session files.
 */
export function discoverSessions(projectsDir?: string): DiscoveredSession[] {
  const dir = projectsDir ?? getClaudeProjectsDir();
  const sessions: DiscoveredSession[] = [];

  if (!fs.existsSync(dir)) {
    log.warn('Claude projects directory does not exist', { path: dir });
    return sessions;
  }

  let projectDirs: string[];
  try {
    projectDirs = fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch (err) {
    log.error('Failed to read projects directory', {
      path: dir,
      error: err instanceof Error ? err.message : String(err),
    });
    return sessions;
  }

  for (const projectSlug of projectDirs) {
    const projectDir = path.join(dir, projectSlug);
    let files: string[];
    try {
      files = fs.readdirSync(projectDir)
        .filter(f => f.endsWith('.jsonl'));
    } catch (err) {
      log.warn('Failed to read project directory', {
        path: projectDir,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    for (const file of files) {
      const jsonlPath = path.join(projectDir, file);
      const externalId = path.basename(file, '.jsonl');

      try {
        const stat = fs.statSync(jsonlPath);
        sessions.push({
          externalId,
          projectSlug,
          jsonlPath,
          fileSize: stat.size,
        });
      } catch (err) {
        log.warn('Failed to stat JSONL file', {
          path: jsonlPath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  log.info(`Discovered ${sessions.length} sessions across ${projectDirs.length} projects`);
  return sessions;
}
