import * as vscode from 'vscode';
import type { TessynClient } from '../protocol/client.js';
import type { Message, SessionSummary } from '../protocol/types.js';

export async function exportSession(
  client: TessynClient,
  session: SessionSummary,
  format: 'markdown' | 'json' | 'text' = 'markdown',
): Promise<void> {
  const result = await client.call<{ session: SessionSummary; messages: Message[] }>(
    'sessions.get',
    { externalId: session.externalId },
  );

  if (!result?.messages) {
    vscode.window.showWarningMessage('Tessyn: No messages to export');
    return;
  }

  let content: string;
  let language: string;

  switch (format) {
    case 'json':
      content = JSON.stringify({
        session: {
          title: session.title,
          project: session.projectSlug,
          createdAt: new Date(session.createdAt).toISOString(),
          updatedAt: new Date(session.updatedAt).toISOString(),
          messageCount: session.messageCount,
        },
        messages: result.messages.map(m => ({
          role: m.role,
          content: m.content,
          blockType: m.blockType,
          toolName: m.toolName,
          timestamp: new Date(m.timestamp).toISOString(),
        })),
      }, null, 2);
      language = 'json';
      break;

    case 'text':
      content = formatAsText(session, result.messages);
      language = 'plaintext';
      break;

    case 'markdown':
    default:
      content = formatAsMarkdown(session, result.messages);
      language = 'markdown';
      break;
  }

  const doc = await vscode.workspace.openTextDocument({ content, language });
  await vscode.window.showTextDocument(doc, { preview: false });
}

function formatAsMarkdown(session: SessionSummary, messages: Message[]): string {
  const lines: string[] = [];
  const title = session.title || 'Untitled Session';

  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`**Project:** ${session.projectSlug}`);
  lines.push(`**Created:** ${new Date(session.createdAt).toLocaleString()}`);
  lines.push(`**Messages:** ${session.messageCount}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const msg of messages) {
    if (msg.role === 'system') continue;

    if (msg.blockType === 'tool_use') {
      lines.push(`> **${msg.toolName || 'Tool'}**`);
      if (msg.content) {
        lines.push('> ```');
        lines.push(`> ${msg.content.split('\n').join('\n> ')}`);
        lines.push('> ```');
      }
      lines.push('');
      continue;
    }

    if (msg.blockType === 'tool_result') {
      lines.push(`> \`result\``);
      lines.push('');
      continue;
    }

    if (msg.blockType === 'thinking') {
      lines.push('<details><summary>Thinking...</summary>');
      lines.push('');
      lines.push(msg.content);
      lines.push('');
      lines.push('</details>');
      lines.push('');
      continue;
    }

    const label = msg.role === 'user' ? '## You' : '## Assistant';
    lines.push(label);
    lines.push('');
    lines.push(msg.content);
    lines.push('');
  }

  return lines.join('\n');
}

function formatAsText(session: SessionSummary, messages: Message[]): string {
  const lines: string[] = [];
  const title = session.title || 'Untitled Session';

  lines.push(`=== ${title} ===`);
  lines.push(`Project: ${session.projectSlug}`);
  lines.push(`Created: ${new Date(session.createdAt).toLocaleString()}`);
  lines.push('');

  for (const msg of messages) {
    if (msg.role === 'system') continue;
    if (msg.blockType === 'thinking') continue;
    if (msg.blockType === 'tool_result') continue;

    if (msg.blockType === 'tool_use') {
      lines.push(`[${msg.toolName || 'Tool'}]`);
      lines.push('');
      continue;
    }

    const label = msg.role === 'user' ? 'YOU:' : 'ASSISTANT:';
    lines.push(label);
    lines.push(msg.content);
    lines.push('');
  }

  return lines.join('\n');
}
