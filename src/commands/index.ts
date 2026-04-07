import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '../shared/logger.js';
import { getClaudeDataDir } from '../platform/paths.js';

const log = createLogger('commands');

// === Types ===

export interface CommandArg {
  name: string;
  description: string;
  required: boolean;
  choices?: string[];
}

export interface CommandInfo {
  name: string;
  description: string;
  type: 'builtin' | 'skill';
  source?: string; // file path for skills
  args: CommandArg[];
}

// === Built-in Commands ===

// These are Claude CLI slash commands available in interactive mode.
// The daemon sends them as prompt text via `claude -p "/command"` within
// a resumed session, and Claude CLI interprets them natively.

const BUILTIN_COMMANDS: CommandInfo[] = [
  { name: 'compact', description: 'Compact the conversation to reduce context usage', type: 'builtin', args: [] },
  { name: 'clear', description: 'Clear conversation context and start fresh', type: 'builtin', args: [] },
  { name: 'model', description: 'Switch the AI model for this session', type: 'builtin',
    args: [{ name: 'model', description: 'Model name', required: false, choices: ['opus', 'sonnet', 'haiku'] }] },
  { name: 'help', description: 'Show available commands and help', type: 'builtin', args: [] },
  { name: 'login', description: 'Authenticate with Claude', type: 'builtin', args: [] },
  { name: 'cost', description: 'Show token usage and cost for this session', type: 'builtin', args: [] },
  { name: 'context', description: 'Show current context window usage', type: 'builtin', args: [] },
  { name: 'status', description: 'Show session status and active tools', type: 'builtin', args: [] },
  { name: 'usage', description: 'Show API usage and rate limit info', type: 'builtin', args: [] },
  { name: 'mcp', description: 'Manage MCP servers', type: 'builtin', args: [] },
  { name: 'init', description: 'Initialize CLAUDE.md in the current project', type: 'builtin', args: [] },
  { name: 'review', description: 'Review code changes', type: 'builtin', args: [] },
  { name: 'debug', description: 'Toggle debug mode', type: 'builtin', args: [] },
];

// === Skill Discovery ===

/**
 * Parse a SKILL.md file's YAML frontmatter to extract metadata.
 */
function parseSkillFrontmatter(content: string): { name?: string; description?: string } {
  // Handle both LF and CRLF line endings
  const normalized = content.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const frontmatter = match[1]!;
  const result: Record<string, string> = {};
  for (const line of frontmatter.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.substring(0, colonIdx).trim();
      let value = line.substring(colonIdx + 1).trim();
      // Strip surrounding quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      result[key] = value;
    }
  }
  return { name: result['name'], description: result['description'] };
}

/**
 * Scan skill directories for installed skills.
 * Skills can be in:
 * - ~/.claude/skills/<name>/SKILL.md (global user skills)
 * - <project>/.claude/skills/<name>/SKILL.md (project-level skills)
 */
function discoverSkills(projectPath?: string): CommandInfo[] {
  const skills: CommandInfo[] = [];
  const seen = new Set<string>();

  // Global user skills
  const globalSkillsDir = path.join(getClaudeDataDir(), 'skills');
  scanSkillsDir(globalSkillsDir, skills, seen);

  // Project-level skills
  if (projectPath) {
    const projectSkillsDir = path.join(projectPath, '.claude', 'skills');
    scanSkillsDir(projectSkillsDir, skills, seen);
  }

  return skills;
}

function scanSkillsDir(dir: string, skills: CommandInfo[], seen: Set<string>): void {
  if (!fs.existsSync(dir)) return;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillFile = path.join(dir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;

      try {
        const content = fs.readFileSync(skillFile, 'utf-8');
        const meta = parseSkillFrontmatter(content);
        const name = meta.name ?? entry.name;

        if (seen.has(name)) continue;
        seen.add(name);

        skills.push({
          name,
          description: meta.description ?? `Skill: ${name}`,
          type: 'skill',
          source: skillFile,
          args: [
            { name: 'args', description: 'Arguments for the skill', required: false },
          ],
        });
      } catch (err) {
        log.warn('Failed to read skill file', { path: skillFile, error: err instanceof Error ? err.message : String(err) });
      }
    }
  } catch (err) {
    log.warn('Failed to scan skills directory', { dir, error: err instanceof Error ? err.message : String(err) });
  }
}

// === Public API ===

/**
 * List all available commands (built-in + skills).
 */
export function listCommands(projectPath?: string): CommandInfo[] {
  const builtins = [...BUILTIN_COMMANDS];
  const skills = discoverSkills(projectPath);
  return [...builtins, ...skills];
}

/**
 * Check if a string starts with a slash command.
 */
export function isSlashCommand(text: string): boolean {
  return text.startsWith('/') && /^\/[a-zA-Z]/.test(text);
}

/**
 * Parse a slash command string into command name and args.
 */
export function parseSlashCommand(text: string): { command: string; args: string } | null {
  if (!isSlashCommand(text)) return null;
  const trimmed = text.substring(1); // remove leading /
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) {
    return { command: trimmed, args: '' };
  }
  return {
    command: trimmed.substring(0, spaceIdx),
    args: trimmed.substring(spaceIdx + 1).trim(),
  };
}
