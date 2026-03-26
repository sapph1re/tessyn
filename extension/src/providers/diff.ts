import * as vscode from 'vscode';
import fs from 'node:fs';
import path from 'node:path';

/**
 * TextDocumentContentProvider for showing inline diffs of Claude's file edits.
 * Registers the `tessyn-diff` URI scheme.
 */
export class TessynDiffProvider implements vscode.TextDocumentContentProvider {
  private contents = new Map<string, string>();
  private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? '';
  }

  /**
   * Show a diff view for a file edit.
   * @param filePath Absolute path to the file
   * @param oldContent Content before edit (or current file content)
   * @param newContent Content after edit
   */
  async showEditDiff(filePath: string, oldContent: string, newContent: string): Promise<void> {
    const fileName = path.basename(filePath);
    const beforeUri = vscode.Uri.parse(`tessyn-diff://before/${encodeURIComponent(filePath)}`);
    const afterUri = vscode.Uri.parse(`tessyn-diff://after/${encodeURIComponent(filePath)}`);

    this.contents.set(beforeUri.toString(), oldContent);
    this.contents.set(afterUri.toString(), newContent);
    this.onDidChangeEmitter.fire(beforeUri);
    this.onDidChangeEmitter.fire(afterUri);

    await vscode.commands.executeCommand(
      'vscode.diff',
      beforeUri,
      afterUri,
      `Claude Edit: ${fileName}`,
    );
  }

  /**
   * Show a diff for a Write tool use (new file or full rewrite).
   * @param filePath Absolute path to the file
   * @param newContent The proposed content
   */
  async showWriteDiff(filePath: string, newContent: string): Promise<void> {
    let currentContent = '';
    try {
      currentContent = fs.readFileSync(filePath, 'utf-8');
    } catch {
      // File doesn't exist yet — that's fine, show empty → new content
    }
    await this.showEditDiff(filePath, currentContent, newContent);
  }

  /**
   * Process a tool_use block and show appropriate diff.
   */
  async showToolDiff(toolName: string, toolInput: Record<string, unknown>): Promise<void> {
    if (toolName === 'Edit' || toolName === 'edit') {
      const filePath = toolInput['file_path'] as string;
      const oldString = toolInput['old_string'] as string;
      const newString = toolInput['new_string'] as string;
      if (!filePath || oldString === undefined || newString === undefined) return;

      try {
        const currentContent = fs.readFileSync(filePath, 'utf-8');
        const newContent = currentContent.replace(oldString, newString);
        await this.showEditDiff(filePath, currentContent, newContent);
      } catch {
        // File not readable — skip
      }
    } else if (toolName === 'Write' || toolName === 'write') {
      const filePath = toolInput['file_path'] as string;
      const content = toolInput['content'] as string;
      if (!filePath || !content) return;

      await this.showWriteDiff(filePath, content);
    }
  }

  dispose(): void {
    this.contents.clear();
    this.onDidChangeEmitter.dispose();
  }
}
