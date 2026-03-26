import { useState } from 'preact/hooks';
import type { StreamBlock } from '../../state/session-state.js';

interface ThinkingBlockProps {
  block: StreamBlock;
}

export function ThinkingBlock({ block }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{
      margin: '4px 0',
      fontSize: '12px',
      color: 'var(--vscode-descriptionForeground)',
    }}>
      <div
        style={{
          cursor: 'pointer',
          userSelect: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          opacity: 0.8,
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
        <span>Thinking</span>
        {!block.complete && <span style={{ opacity: 0.5 }}>...</span>}
      </div>

      {expanded && block.content && (
        <div style={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          marginTop: '4px',
          padding: '4px 8px',
          opacity: 0.7,
          maxHeight: '300px',
          overflow: 'auto',
          fontStyle: 'italic',
          borderLeft: '2px solid var(--vscode-descriptionForeground)',
        }}>
          {block.content}
        </div>
      )}
    </div>
  );
}
