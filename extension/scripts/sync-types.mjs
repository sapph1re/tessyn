/**
 * Sync protocol types from daemon source to extension.
 * Reads the daemon's type files and extracts interface/type/const definitions.
 * Run: node scripts/sync-types.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const sourceFiles = [
  'src/shared/types.ts',
  'src/protocol/types.ts',
  'src/run/types.ts',
];

const outputPath = path.join(__dirname, '..', 'src', 'protocol', 'types.ts');

function extractTypes(content) {
  const lines = content.split('\n');
  const output = [];
  let inBlock = false;
  let braceDepth = 0;

  for (const line of lines) {
    // Skip import lines
    if (line.trimStart().startsWith('import ')) continue;
    // Skip re-export lines
    if (line.trimStart().startsWith('export {')) continue;
    // Skip function implementations
    if (line.trimStart().startsWith('export function ')) continue;

    // Track interface/type/const/enum blocks
    if (/^export\s+(interface|type|const|enum)\s/.test(line.trimStart())) {
      inBlock = true;
    }

    if (inBlock || line.trim() === '' || line.trim().startsWith('//')) {
      output.push(line);
    }

    if (inBlock) {
      braceDepth += (line.match(/{/g) || []).length;
      braceDepth -= (line.match(/}/g) || []).length;
      if (braceDepth <= 0) {
        inBlock = false;
        braceDepth = 0;
      }
    }
  }

  return output.join('\n');
}

const header = `// AUTO-GENERATED from daemon types — do not edit manually
// Source: ${sourceFiles.join(', ')}
// Run \`npm run sync-types\` to regenerate
`;

const parts = [header];

for (const file of sourceFiles) {
  const fullPath = path.join(repoRoot, file);
  if (!fs.existsSync(fullPath)) {
    console.error(`Source file not found: ${fullPath}`);
    process.exit(1);
  }
  const content = fs.readFileSync(fullPath, 'utf-8');
  const extracted = extractTypes(content);
  if (extracted.trim()) {
    parts.push(`// === From ${file} ===\n`);
    parts.push(extracted);
    parts.push('');
  }
}

const output = parts.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';

fs.writeFileSync(outputPath, output, 'utf-8');
console.log(`Synced types to ${path.relative(process.cwd(), outputPath)}`);
