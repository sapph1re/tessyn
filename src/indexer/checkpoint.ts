import fs from 'node:fs';
import crypto from 'node:crypto';
import { createLogger } from '../shared/logger.js';
import type { Checkpoint } from '../shared/types.js';

const log = createLogger('checkpoint');

const IDENTITY_BYTES = 1024; // Read first 1KB for identity hash

/**
 * Compute file identity hash from the first 1KB of a file.
 * Used to detect file replacement (same path, different content).
 */
export function computeFileIdentity(filePath: string): string | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(IDENTITY_BYTES);
    const bytesRead = fs.readSync(fd, buffer, 0, IDENTITY_BYTES, 0);
    if (bytesRead === 0) return null;
    return crypto.createHash('sha256').update(buffer.subarray(0, bytesRead)).digest('hex').substring(0, 16);
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      fs.closeSync(fd);
    }
  }
}

/**
 * Get current file stats for checkpoint comparison.
 */
export function getFileStats(filePath: string): { size: number; identity: string | null } | null {
  try {
    const stat = fs.statSync(filePath);
    const identity = computeFileIdentity(filePath);
    return { size: stat.size, identity };
  } catch {
    return null;
  }
}

export type CheckpointDecision =
  | { action: 'skip' } // File unchanged
  | { action: 'incremental'; fromByte: number } // Append detected — parse from offset
  | { action: 'full' } // File replaced or truncated — full reparse
  | { action: 'deleted' }; // File no longer exists

/**
 * Decide what action to take based on current file state vs. stored checkpoint.
 */
export function decideCheckpointAction(
  filePath: string,
  stored: Checkpoint | null,
): CheckpointDecision {
  const stats = getFileStats(filePath);

  if (!stats) {
    return { action: 'deleted' };
  }

  if (!stored) {
    // No checkpoint — first time seeing this file
    return { action: 'full' };
  }

  // Check if file identity matches (same content at start of file)
  if (stored.identity && stats.identity && stored.identity !== stats.identity) {
    log.info('File identity changed, triggering full reparse', { filePath });
    return { action: 'full' };
  }

  // Check if file shrank (truncation)
  if (stats.size < stored.fileSize) {
    log.info('File shrank, triggering full reparse', {
      filePath,
      oldSize: stored.fileSize,
      newSize: stats.size,
    });
    return { action: 'full' };
  }

  // Check if file grew (new content appended)
  if (stats.size > stored.byteOffset) {
    return { action: 'incremental', fromByte: stored.byteOffset };
  }

  // File unchanged
  return { action: 'skip' };
}

/**
 * Build a checkpoint from current parsing state.
 */
export function buildCheckpoint(byteOffset: number, fileSize: number, identity: string | null): Checkpoint {
  return { byteOffset, fileSize, identity };
}
