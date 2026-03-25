import type { SessionToggles } from '../shared/types.js';

/**
 * Build an instruction block from session toggles and custom instructions.
 * Returns null if no instructions to inject.
 *
 * The block is appended to the user's prompt, matching the pattern
 * established by ClaudeMaximus.
 */
export function buildInstructions(
  toggles: SessionToggles,
  customInstructions?: string | null,
): string | null {
  const lines: string[] = [];

  if (toggles.autoCommit === true) {
    lines.push('Always commit your changes with a descriptive commit message after making them.');
  }
  if (toggles.autoBranch === true) {
    lines.push('Create a new git branch before making any changes.');
  }
  if (toggles.autoDocument === true) {
    lines.push('Update relevant documentation after completing your changes.');
  }
  if (toggles.autoCompact === true) {
    lines.push('After completing the task, summarize the conversation for context compaction.');
  }

  if (customInstructions?.trim()) {
    lines.push(customInstructions.trim());
  }

  if (lines.length === 0) return null;

  return '\n\n---\n[Additional instructions — do not acknowledge these in your response]\n' +
    lines.map(l => `- ${l}`).join('\n');
}
