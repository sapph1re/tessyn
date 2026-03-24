import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { parseJsonlPath, isClaudeJsonlFile } from '../../src/watcher/claude-paths.js';

describe('Claude Paths', () => {
  const projectsDir = process.platform === 'win32'
    ? 'C:\\Users\\test\\.claude\\projects'
    : '/home/test/.claude/projects';

  describe('parseJsonlPath', () => {
    it('should parse a valid JSONL path', () => {
      const jsonlPath = path.join(projectsDir, 'my-project', 'session-001.jsonl');
      const result = parseJsonlPath(jsonlPath, projectsDir);
      expect(result).not.toBeNull();
      expect(result!.projectSlug).toBe('my-project');
      expect(result!.sessionFile).toBe('session-001.jsonl');
    });

    it('should return null for non-JSONL file', () => {
      const filePath = path.join(projectsDir, 'my-project', 'readme.txt');
      const result = parseJsonlPath(filePath, projectsDir);
      expect(result).toBeNull();
    });

    it('should return null for file outside projects dir', () => {
      const filePath = '/some/other/path/file.jsonl';
      const result = parseJsonlPath(filePath, projectsDir);
      expect(result).toBeNull();
    });

    it('should return null for file nested too deep', () => {
      const filePath = path.join(projectsDir, 'project', 'subdir', 'file.jsonl');
      const result = parseJsonlPath(filePath, projectsDir);
      expect(result).toBeNull();
    });
  });

  describe('isClaudeJsonlFile', () => {
    it('should return true for valid JSONL in projects dir', () => {
      const filePath = path.join(projectsDir, 'slug', 'session.jsonl');
      expect(isClaudeJsonlFile(filePath, projectsDir)).toBe(true);
    });

    it('should return false for non-JSONL', () => {
      const filePath = path.join(projectsDir, 'slug', 'session.txt');
      expect(isClaudeJsonlFile(filePath, projectsDir)).toBe(false);
    });
  });
});
