import * as vscode from 'vscode';

export interface EditorContext {
  filePath: string | null;
  fileName: string | null;
  selectedText: string | null;
  selectionRange: { startLine: number; endLine: number } | null;
  language: string | null;
}

/**
 * Get context from the active editor: current file, selection, language.
 */
export function getEditorContext(): EditorContext {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return { filePath: null, fileName: null, selectedText: null, selectionRange: null, language: null };
  }

  const document = editor.document;
  const selection = editor.selection;
  const hasSelection = !selection.isEmpty;

  return {
    filePath: document.uri.fsPath,
    fileName: document.uri.fsPath.split('/').pop() ?? null,
    selectedText: hasSelection ? document.getText(selection) : null,
    selectionRange: hasSelection
      ? { startLine: selection.start.line + 1, endLine: selection.end.line + 1 }
      : null,
    language: document.languageId,
  };
}

/**
 * Format editor context as a prompt prefix for Claude.
 */
export function formatContextForPrompt(ctx: EditorContext): string {
  const parts: string[] = [];

  if (ctx.selectedText && ctx.filePath) {
    const range = ctx.selectionRange
      ? ` (lines ${ctx.selectionRange.startLine}-${ctx.selectionRange.endLine})`
      : '';
    parts.push(`Selected code from ${ctx.filePath}${range}:`);
    parts.push('```' + (ctx.language || ''));
    parts.push(ctx.selectedText);
    parts.push('```');
    parts.push('');
  } else if (ctx.filePath) {
    parts.push(`Current file: ${ctx.filePath}`);
    parts.push('');
  }

  return parts.join('\n');
}
