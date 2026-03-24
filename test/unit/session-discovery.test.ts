import { describe, it, expect } from 'vitest';
import { computeProjectSlug, slugToPath } from '../../src/indexer/session-discovery.js';

describe('Session Discovery', () => {
  describe('computeProjectSlug', () => {
    it('should replace slashes with dashes', () => {
      expect(computeProjectSlug('/Users/alice/Projects/my_app')).toBe('-Users-alice-Projects-my-app');
    });

    it('should replace underscores with dashes', () => {
      expect(computeProjectSlug('/path/to/my_project')).toBe('-path-to-my-project');
    });

    it('should preserve alphanumeric chars and dashes', () => {
      expect(computeProjectSlug('simple-name')).toBe('simple-name');
    });

    it('should handle Windows paths', () => {
      expect(computeProjectSlug('C:\\Users\\Bob\\Projects\\app')).toBe('C--Users-Bob-Projects-app');
    });

    it('should handle spaces', () => {
      expect(computeProjectSlug('/path/to/my project')).toBe('-path-to-my-project');
    });

    it('should handle dots', () => {
      expect(computeProjectSlug('/path/to/node.js/app')).toBe('-path-to-node-js-app');
    });
  });

  describe('slugToPath', () => {
    it('should convert Unix slug back to path', () => {
      if (process.platform !== 'win32') {
        const result = slugToPath('-Users-alice-Projects-app');
        expect(result).toBe('/Users/alice/Projects/app');
      }
    });
  });
});
