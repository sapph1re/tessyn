import { describe, it, expect } from 'vitest';
import { buildInstructions } from '../../src/run/instructions.js';

describe('Instruction Builder', () => {
  it('should return null when no toggles are active', () => {
    const result = buildInstructions({
      autoCommit: null,
      autoBranch: null,
      autoDocument: null,
      autoCompact: null,
    });
    expect(result).toBeNull();
  });

  it('should return null when all toggles are false', () => {
    const result = buildInstructions({
      autoCommit: false,
      autoBranch: false,
      autoDocument: false,
      autoCompact: false,
    });
    expect(result).toBeNull();
  });

  it('should include auto-commit instruction', () => {
    const result = buildInstructions({
      autoCommit: true,
      autoBranch: null,
      autoDocument: null,
      autoCompact: null,
    });
    expect(result).toBeTruthy();
    expect(result).toContain('commit');
    expect(result).toContain('do not acknowledge');
  });

  it('should include multiple active toggles', () => {
    const result = buildInstructions({
      autoCommit: true,
      autoBranch: true,
      autoDocument: false,
      autoCompact: null,
    });
    expect(result).toContain('commit');
    expect(result).toContain('branch');
    expect(result).not.toContain('documentation');
  });

  it('should include custom instructions', () => {
    const result = buildInstructions({
      autoCommit: null,
      autoBranch: null,
      autoDocument: null,
      autoCompact: null,
    }, 'Always use TypeScript strict mode');
    expect(result).toBeTruthy();
    expect(result).toContain('TypeScript strict mode');
  });

  it('should combine toggles and custom instructions', () => {
    const result = buildInstructions({
      autoCommit: true,
      autoBranch: null,
      autoDocument: null,
      autoCompact: null,
    }, 'Use vitest for tests');
    expect(result).toContain('commit');
    expect(result).toContain('vitest');
  });

  it('should ignore empty custom instructions', () => {
    const result = buildInstructions({
      autoCommit: null,
      autoBranch: null,
      autoDocument: null,
      autoCompact: null,
    }, '   ');
    expect(result).toBeNull();
  });
});
