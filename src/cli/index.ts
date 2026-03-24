#!/usr/bin/env node

import { Command } from 'commander';
import { startCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';
import { statusCommand } from './commands/status.js';
import { listSessionsCommand, showSessionCommand } from './commands/sessions.js';
import { searchCommand } from './commands/search.js';
import { reindexCommand } from './commands/reindex.js';
import { titlesCommand } from './commands/titles.js';
import { watchCommand } from './commands/watch.js';

const program = new Command();

program
  .name('tessyn')
  .description('The developer workflow operating system')
  .version('0.1.0');

program
  .command('start')
  .description('Start the Tessyn daemon')
  .option('-d, --daemon', 'Run in background')
  .action(async (options) => {
    await startCommand(options);
  });

program
  .command('stop')
  .description('Stop the Tessyn daemon')
  .action(async () => {
    await stopCommand();
  });

program
  .command('status')
  .description('Show daemon status')
  .action(async () => {
    await statusCommand();
  });

const sessions = program
  .command('sessions')
  .description('Manage sessions');

sessions
  .command('list')
  .description('List sessions')
  .option('-p, --project <slug>', 'Filter by project slug')
  .option('-l, --limit <n>', 'Limit results', '20')
  .action(async (options) => {
    await listSessionsCommand({
      project: options.project,
      limit: parseInt(options.limit, 10),
    });
  });

sessions
  .command('show <id>')
  .description('Show session details and messages')
  .action(async (id) => {
    await showSessionCommand(id);
  });

program
  .command('search <query>')
  .description('Search across all sessions')
  .option('-p, --project <slug>', 'Filter by project')
  .option('-r, --role <role>', 'Filter by role (user/assistant/system)')
  .option('-l, --limit <n>', 'Limit results', '20')
  .action(async (query, options) => {
    await searchCommand(query, {
      project: options.project,
      role: options.role,
      limit: parseInt(options.limit, 10),
    });
  });

program
  .command('reindex')
  .description('Trigger a full reindex of all sessions')
  .action(async () => {
    await reindexCommand();
  });

program
  .command('titles')
  .description('Generate titles for untitled sessions (requires claude CLI)')
  .option('-l, --limit <n>', 'Max sessions to process', '50')
  .action(async (options) => {
    await titlesCommand({ limit: parseInt(options.limit, 10) });
  });

program
  .command('watch')
  .description('Stream daemon events in real-time')
  .action(async () => {
    await watchCommand();
  });

program.parse();
