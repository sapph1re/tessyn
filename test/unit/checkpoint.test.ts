import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeFileIdentity, decideCheckpointAction, buildCheckpoint } from '../../src/indexer/checkpoint.js';

describe('Checkpoint', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tessyn-test-checkpoint-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('computeFileIdentity', () => {
    it('should return a hash for a file with content', () => {
      const filePath = path.join(tmpDir, 'test.jsonl');
      fs.writeFileSync(filePath, '{"type":"user","content":"hello"}\n');
      const identity = computeFileIdentity(filePath);
      expect(identity).toBeTruthy();
      expect(typeof identity).toBe('string');
      expect(identity!.length).toBe(16);
    });

    it('should return null for empty file', () => {
      const filePath = path.join(tmpDir, 'empty.jsonl');
      fs.writeFileSync(filePath, '');
      const identity = computeFileIdentity(filePath);
      expect(identity).toBeNull();
    });

    it('should return null for nonexistent file', () => {
      const identity = computeFileIdentity(path.join(tmpDir, 'nonexistent.jsonl'));
      expect(identity).toBeNull();
    });

    it('should return same hash for same content', () => {
      const file1 = path.join(tmpDir, 'a.jsonl');
      const file2 = path.join(tmpDir, 'b.jsonl');
      const content = '{"type":"user","content":"hello world"}\n';
      fs.writeFileSync(file1, content);
      fs.writeFileSync(file2, content);
      expect(computeFileIdentity(file1)).toBe(computeFileIdentity(file2));
    });

    it('should return different hash for different content', () => {
      const file1 = path.join(tmpDir, 'a.jsonl');
      const file2 = path.join(tmpDir, 'b.jsonl');
      fs.writeFileSync(file1, '{"type":"user","content":"hello"}\n');
      fs.writeFileSync(file2, '{"type":"user","content":"world"}\n');
      expect(computeFileIdentity(file1)).not.toBe(computeFileIdentity(file2));
    });
  });

  describe('decideCheckpointAction', () => {
    it('should return "full" for new file (no stored checkpoint)', () => {
      const filePath = path.join(tmpDir, 'new.jsonl');
      fs.writeFileSync(filePath, '{"type":"user"}\n');
      const decision = decideCheckpointAction(filePath, null);
      expect(decision.action).toBe('full');
    });

    it('should return "deleted" for nonexistent file', () => {
      const decision = decideCheckpointAction(path.join(tmpDir, 'gone.jsonl'), null);
      expect(decision.action).toBe('deleted');
    });

    it('should return "skip" when file unchanged', () => {
      const filePath = path.join(tmpDir, 'unchanged.jsonl');
      const content = '{"type":"user","content":"hello"}\n';
      fs.writeFileSync(filePath, content);
      const identity = computeFileIdentity(filePath)!;
      const size = fs.statSync(filePath).size;

      const checkpoint = buildCheckpoint(size, size, identity);
      const decision = decideCheckpointAction(filePath, checkpoint);
      expect(decision.action).toBe('skip');
    });

    it('should return "incremental" when file grew', () => {
      const filePath = path.join(tmpDir, 'growing.jsonl');
      // Use content > 1KB so appending doesn't change the first-1KB identity hash
      const padding = 'x'.repeat(1100);
      const line1 = `{"type":"user","content":"${padding}"}\n`;
      fs.writeFileSync(filePath, line1);
      const identity = computeFileIdentity(filePath)!;
      const offset = Buffer.byteLength(line1, 'utf-8');

      // Append more content
      fs.appendFileSync(filePath, '{"type":"assistant","content":"world"}\n');

      const checkpoint = buildCheckpoint(offset, offset, identity);
      const decision = decideCheckpointAction(filePath, checkpoint);
      expect(decision.action).toBe('incremental');
      if (decision.action === 'incremental') {
        expect(decision.fromByte).toBe(offset);
      }
    });

    it('should return "full" when file shrank (truncation)', () => {
      const filePath = path.join(tmpDir, 'truncated.jsonl');
      fs.writeFileSync(filePath, '{"type":"user","content":"long content here"}\n');
      const identity = computeFileIdentity(filePath)!;

      const checkpoint = buildCheckpoint(100, 100, identity);

      // Truncate the file
      fs.writeFileSync(filePath, '{"short"}\n');

      const decision = decideCheckpointAction(filePath, checkpoint);
      expect(decision.action).toBe('full');
    });

    it('should return "full" when file identity changed (replacement)', () => {
      const filePath = path.join(tmpDir, 'replaced.jsonl');
      fs.writeFileSync(filePath, '{"type":"user","content":"original content padding"}\n');
      const originalIdentity = computeFileIdentity(filePath)!;

      const checkpoint = buildCheckpoint(50, 50, originalIdentity);

      // Replace with different content (same size approx)
      fs.writeFileSync(filePath, '{"type":"user","content":"REPLACED content padding"}\n');

      const decision = decideCheckpointAction(filePath, checkpoint);
      expect(decision.action).toBe('full');
    });
  });
});
