import type { Message } from '../../protocol/types.js';
import { Markdown } from './Markdown.js';

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  if (isSystem) return null; // Don't render system messages

  // Tool use blocks get special rendering
  if (message.blockType === 'tool_use') {
    return (
      <div style={{
        padding: '4px 12px',
        fontSize: '12px',
        color: 'var(--vscode-descriptionForeground)',
        borderLeft: '2px solid var(--vscode-textLink-foreground)',
        margin: '4px 12px',
      }}>
        <span style={{ fontWeight: 600 }}>{message.toolName || 'Tool'}</span>
        {message.content && (
          <pre style={{
            margin: '4px 0 0',
            fontSize: '11px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: '200px',
            overflow: 'auto',
            backgroundColor: 'var(--vscode-textCodeBlock-background)',
            padding: '4px 8px',
            borderRadius: '3px',
          }}>
            {truncate(message.content, 500)}
          </pre>
        )}
      </div>
    );
  }

  // Tool result blocks
  if (message.blockType === 'tool_result') {
    return (
      <div style={{
        padding: '4px 12px',
        fontSize: '11px',
        color: 'var(--vscode-descriptionForeground)',
        margin: '2px 12px',
        maxHeight: '150px',
        overflow: 'auto',
      }}>
        <pre style={{
          margin: 0,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          backgroundColor: 'var(--vscode-textCodeBlock-background)',
          padding: '4px 8px',
          borderRadius: '3px',
        }}>
          {truncate(message.content, 300)}
        </pre>
      </div>
    );
  }

  // Thinking blocks
  if (message.blockType === 'thinking') {
    return (
      <details style={{
        padding: '4px 12px',
        margin: '4px 12px',
        fontSize: '12px',
        color: 'var(--vscode-descriptionForeground)',
      }}>
        <summary style={{ cursor: 'pointer', userSelect: 'none' }}>Thinking...</summary>
        <div style={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          marginTop: '4px',
          opacity: 0.7,
          maxHeight: '200px',
          overflow: 'auto',
        }}>
          {message.content}
        </div>
      </details>
    );
  }

  // Regular text messages (user or assistant)
  return (
    <div style={{
      padding: '8px 12px',
      borderBottom: isUser ? '1px solid var(--vscode-panel-border)' : undefined,
    }}>
      <div style={{
        fontSize: '11px',
        fontWeight: 600,
        color: isUser ? 'var(--vscode-textLink-foreground)' : 'var(--vscode-descriptionForeground)',
        marginBottom: '4px',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
      }}>
        {isUser ? 'You' : 'Assistant'}
      </div>
      <Markdown content={message.content} className="markdown-content" />
    </div>
  );
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}
