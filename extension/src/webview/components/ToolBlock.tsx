import { useState } from 'preact/hooks';
import type { StreamBlock } from '../../state/session-state.js';

interface ToolBlockProps {
  block: StreamBlock;
}

export function ToolBlock({ block }: ToolBlockProps) {
  const [expanded, setExpanded] = useState(false);

  const toolName = block.toolName || 'Tool';
  const hasInput = block.toolInput && Object.keys(block.toolInput).length > 0;
  const hasOutput = block.content.length > 0;

  return (
    <div style={{
      borderLeft: '2px solid var(--vscode-textLink-foreground)',
      margin: '4px 0',
      padding: '4px 8px',
      fontSize: '12px',
    }}>
      <div
        style={{
          cursor: 'pointer',
          userSelect: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          color: 'var(--vscode-descriptionForeground)',
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <span style={{
          display: 'inline-block',
          transform: expanded ? 'rotate(90deg)' : 'none',
          transition: 'transform 0.1s',
          fontSize: '10px',
        }}>
          &#9654;
        </span>
        <span style={{ fontWeight: 600 }}>{toolName}</span>
        {!block.complete && (
          <span style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            backgroundColor: 'var(--vscode-textLink-foreground)',
            display: 'inline-block',
            animation: 'pulse 1s infinite',
          }} />
        )}
      </div>

      {expanded && (
        <div style={{ marginTop: '4px' }}>
          {hasInput && (
            <pre style={{
              margin: '2px 0',
              fontSize: '11px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: '200px',
              overflow: 'auto',
              backgroundColor: 'var(--vscode-textCodeBlock-background)',
              padding: '4px 8px',
              borderRadius: '3px',
              color: 'var(--vscode-foreground)',
            }}>
              {JSON.stringify(block.toolInput, null, 2)}
            </pre>
          )}
          {hasOutput && (
            <pre style={{
              margin: '2px 0',
              fontSize: '11px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: '200px',
              overflow: 'auto',
              backgroundColor: 'var(--vscode-textCodeBlock-background)',
              padding: '4px 8px',
              borderRadius: '3px',
              color: 'var(--vscode-foreground)',
            }}>
              {block.content}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
