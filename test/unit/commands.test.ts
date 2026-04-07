import { describe, it, expect } from 'vitest';
import { listCommands, isSlashCommand, parseSlashCommand } from '../../src/commands/index.js';

describe('Commands', () => {
  describe('listCommands', () => {
    it('should return built-in commands', () => {
      const commands = listCommands();
      expect(commands.length).toBeGreaterThan(0);

      const names = commands.map(c => c.name);
      expect(names).toContain('compact');
      expect(names).toContain('clear');
      expect(names).toContain('model');
      expect(names).toContain('help');
      expect(names).toContain('login');
    });

    it('should include type field on all commands', () => {
      const commands = listCommands();
      for (const cmd of commands) {
        expect(['builtin', 'skill']).toContain(cmd.type);
      }
    });

    it('should include model choices on /model command', () => {
      const commands = listCommands();
      const model = commands.find(c => c.name === 'model');
      expect(model).toBeTruthy();
      expect(model!.args.length).toBeGreaterThan(0);
      expect(model!.args[0]!.choices).toContain('opus');
      expect(model!.args[0]!.choices).toContain('sonnet');
    });
  });

  describe('isSlashCommand', () => {
    it('should detect slash commands', () => {
      expect(isSlashCommand('/compact')).toBe(true);
      expect(isSlashCommand('/model opus')).toBe(true);
      expect(isSlashCommand('/help')).toBe(true);
    });

    it('should reject non-commands', () => {
      expect(isSlashCommand('hello')).toBe(false);
      expect(isSlashCommand('')).toBe(false);
      expect(isSlashCommand('/ space')).toBe(false);
      expect(isSlashCommand('/123')).toBe(false);
    });
  });

  describe('parseSlashCommand', () => {
    it('should parse command without args', () => {
      const result = parseSlashCommand('/compact');
      expect(result).toEqual({ command: 'compact', args: '' });
    });

    it('should parse command with args', () => {
      const result = parseSlashCommand('/model opus');
      expect(result).toEqual({ command: 'model', args: 'opus' });
    });

    it('should handle multi-word args', () => {
      const result = parseSlashCommand('/commit fix the auth bug');
      expect(result).toEqual({ command: 'commit', args: 'fix the auth bug' });
    });

    it('should return null for non-commands', () => {
      expect(parseSlashCommand('hello')).toBeNull();
      expect(parseSlashCommand('')).toBeNull();
    });
  });
});
