import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getClaudeDataDir } from '../../platform/paths.js';

const SKILL_NAMES = ['recall', 'sessions', 'session-context'];
const MARKER_FILE = '.tessyn';

function getPackageSkillsDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  // dist/cli/commands/skills.js → package root is 3 levels up
  return path.resolve(path.dirname(thisFile), '..', '..', '..', 'skills');
}

function getClaudeSkillsDir(): string {
  return path.join(getClaudeDataDir(), 'skills');
}

function isOwnedByTessyn(skillDir: string): boolean {
  return fs.existsSync(path.join(skillDir, MARKER_FILE));
}

export async function installSkillsCommand(options: {
  uninstall?: boolean;
  force?: boolean;
}): Promise<void> {
  const claudeSkillsDir = getClaudeSkillsDir();

  if (options.uninstall) {
    let removed = 0;
    for (const name of SKILL_NAMES) {
      const target = path.join(claudeSkillsDir, name);
      if (!fs.existsSync(target)) continue;

      if (!isOwnedByTessyn(target)) {
        console.log(`  Skipping /${name} — not owned by Tessyn (no ${MARKER_FILE} marker)`);
        continue;
      }

      fs.rmSync(target, { recursive: true });
      console.log(`  Removed /${name}`);
      removed++;
    }

    if (removed === 0) {
      console.log('No Tessyn skills found to remove.');
    } else {
      console.log(`\nRemoved ${removed} skill(s).`);
    }
    return;
  }

  // Install
  const sourceDir = getPackageSkillsDir();
  if (!fs.existsSync(sourceDir)) {
    console.error(
      'Skills directory not found in the Tessyn package.\n' +
        `Expected at: ${sourceDir}\n` +
        'This may indicate an incomplete installation or unsupported package manager.',
    );
    process.exit(1);
  }

  fs.mkdirSync(claudeSkillsDir, { recursive: true });

  let installed = 0;
  for (const name of SKILL_NAMES) {
    const src = path.join(sourceDir, name, 'SKILL.md');
    const destDir = path.join(claudeSkillsDir, name);
    const dest = path.join(destDir, 'SKILL.md');
    const marker = path.join(destDir, MARKER_FILE);

    // Check for existing non-Tessyn skill
    if (fs.existsSync(destDir) && !isOwnedByTessyn(destDir)) {
      if (!options.force) {
        console.log(`  Skipping /${name} — directory exists and is not owned by Tessyn (use --force to overwrite)`);
        continue;
      }
      console.log(`  Overwriting /${name} (--force)`);
    }

    const updating = fs.existsSync(dest);
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(src, dest);
    fs.writeFileSync(marker, 'installed by tessyn\n');

    console.log(`  ${updating ? 'Updated' : 'Installed'} /${name}`);
    installed++;
  }

  if (installed > 0) {
    console.log(`\n${installed} skill(s) installed. Available in Claude Code: /recall, /sessions, /session-context`);
  } else {
    console.log('\nNo skills were installed.');
  }
}
