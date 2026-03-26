import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// The skills install logic uses getClaudeDataDir() which reads TESSYN_CLAUDE_DIR.
// We test the install behavior by directly exercising the file operations
// with a temp directory standing in for ~/.claude.

const SKILL_NAMES = ['recall', 'sessions', 'session-context'];
const MARKER_FILE = '.tessyn';

// Resolve the real skills source directory (relative to this test file → repo root)
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const SKILLS_SOURCE = path.join(REPO_ROOT, 'skills');

describe('Skills Install', () => {
  let tempDir: string;
  let skillsTarget: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tessyn-skills-test-'));
    skillsTarget = path.join(tempDir, 'skills');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('source skills', () => {
    it('should have all skill source files in repo', () => {
      for (const name of SKILL_NAMES) {
        const skillFile = path.join(SKILLS_SOURCE, name, 'SKILL.md');
        expect(fs.existsSync(skillFile), `Missing ${skillFile}`).toBe(true);
      }
    });

    it('should have valid YAML frontmatter in each skill', () => {
      for (const name of SKILL_NAMES) {
        const content = fs.readFileSync(path.join(SKILLS_SOURCE, name, 'SKILL.md'), 'utf-8');
        expect(content.startsWith('---\n')).toBe(true);
        expect(content.indexOf('---\n', 4)).toBeGreaterThan(4);
      }
    });
  });

  describe('install behavior', () => {
    function installTo(target: string, options?: { force?: boolean }) {
      fs.mkdirSync(target, { recursive: true });
      let installed = 0;
      for (const name of SKILL_NAMES) {
        const src = path.join(SKILLS_SOURCE, name, 'SKILL.md');
        const destDir = path.join(target, name);
        const dest = path.join(destDir, 'SKILL.md');
        const marker = path.join(destDir, MARKER_FILE);

        if (fs.existsSync(destDir) && !fs.existsSync(marker)) {
          if (!options?.force) continue;
        }

        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(src, dest);
        fs.writeFileSync(marker, 'installed by tessyn\n');
        installed++;
      }
      return installed;
    }

    it('should create correct directory structure', () => {
      installTo(skillsTarget);
      for (const name of SKILL_NAMES) {
        expect(fs.existsSync(path.join(skillsTarget, name, 'SKILL.md'))).toBe(true);
        expect(fs.existsSync(path.join(skillsTarget, name, MARKER_FILE))).toBe(true);
      }
    });

    it('should write .tessyn marker in each skill dir', () => {
      installTo(skillsTarget);
      for (const name of SKILL_NAMES) {
        const content = fs.readFileSync(path.join(skillsTarget, name, MARKER_FILE), 'utf-8');
        expect(content).toBe('installed by tessyn\n');
      }
    });

    it('should be idempotent', () => {
      installTo(skillsTarget);
      const firstContent = fs.readFileSync(path.join(skillsTarget, 'recall', 'SKILL.md'), 'utf-8');

      installTo(skillsTarget);
      const secondContent = fs.readFileSync(path.join(skillsTarget, 'recall', 'SKILL.md'), 'utf-8');

      expect(firstContent).toBe(secondContent);
      // Still 3 skill dirs
      for (const name of SKILL_NAMES) {
        expect(fs.existsSync(path.join(skillsTarget, name, 'SKILL.md'))).toBe(true);
      }
    });

    it('should skip existing dirs without marker', () => {
      // Create a "recall" dir that's not owned by Tessyn
      const existingDir = path.join(skillsTarget, 'recall');
      fs.mkdirSync(existingDir, { recursive: true });
      fs.writeFileSync(path.join(existingDir, 'SKILL.md'), 'user skill');

      const installed = installTo(skillsTarget);

      // recall was skipped, sessions + session-context were installed
      expect(installed).toBe(2);
      // User's skill is untouched
      expect(fs.readFileSync(path.join(existingDir, 'SKILL.md'), 'utf-8')).toBe('user skill');
    });

    it('should overwrite existing dirs without marker when force is true', () => {
      const existingDir = path.join(skillsTarget, 'recall');
      fs.mkdirSync(existingDir, { recursive: true });
      fs.writeFileSync(path.join(existingDir, 'SKILL.md'), 'user skill');

      const installed = installTo(skillsTarget, { force: true });

      expect(installed).toBe(3);
      // Tessyn's skill replaced the user's
      const content = fs.readFileSync(path.join(existingDir, 'SKILL.md'), 'utf-8');
      expect(content).toContain('tessyn-recall');
    });

    it('should overwrite existing dirs with marker', () => {
      installTo(skillsTarget);
      // Modify a skill file
      fs.writeFileSync(path.join(skillsTarget, 'recall', 'SKILL.md'), 'modified');

      installTo(skillsTarget);

      // Should be restored to original
      const content = fs.readFileSync(path.join(skillsTarget, 'recall', 'SKILL.md'), 'utf-8');
      expect(content).toContain('tessyn-recall');
    });
  });

  describe('uninstall behavior', () => {
    function installTo(target: string) {
      fs.mkdirSync(target, { recursive: true });
      for (const name of SKILL_NAMES) {
        const src = path.join(SKILLS_SOURCE, name, 'SKILL.md');
        const destDir = path.join(target, name);
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(src, path.join(destDir, 'SKILL.md'));
        fs.writeFileSync(path.join(destDir, MARKER_FILE), 'installed by tessyn\n');
      }
    }

    function uninstallFrom(target: string) {
      let removed = 0;
      for (const name of SKILL_NAMES) {
        const dir = path.join(target, name);
        if (!fs.existsSync(dir)) continue;
        if (!fs.existsSync(path.join(dir, MARKER_FILE))) continue;
        fs.rmSync(dir, { recursive: true });
        removed++;
      }
      return removed;
    }

    it('should remove only tessyn-owned skill dirs', () => {
      installTo(skillsTarget);

      // Add a non-tessyn skill
      const userDir = path.join(skillsTarget, 'my-custom-skill');
      fs.mkdirSync(userDir, { recursive: true });
      fs.writeFileSync(path.join(userDir, 'SKILL.md'), 'custom');

      const removed = uninstallFrom(skillsTarget);

      expect(removed).toBe(3);
      // User's skill is untouched
      expect(fs.existsSync(userDir)).toBe(true);
    });

    it('should not fail when skills are not installed', () => {
      fs.mkdirSync(skillsTarget, { recursive: true });
      const removed = uninstallFrom(skillsTarget);
      expect(removed).toBe(0);
    });

    it('should skip dirs without .tessyn marker', () => {
      // Create dirs with the right names but no marker
      for (const name of SKILL_NAMES) {
        const dir = path.join(skillsTarget, name);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'SKILL.md'), 'not tessyn');
      }

      const removed = uninstallFrom(skillsTarget);
      expect(removed).toBe(0);

      // All dirs still exist
      for (const name of SKILL_NAMES) {
        expect(fs.existsSync(path.join(skillsTarget, name))).toBe(true);
      }
    });
  });
});
