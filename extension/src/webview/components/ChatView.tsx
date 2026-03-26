import { useRef, useEffect } from 'preact/hooks';
import type { Message } from '../../protocol/types.js';
import type { StreamBlock } from '../../state/session-state.js';
import { MessageBubble } from './MessageBubble.js';
import { ToolBlock } from './ToolBlock.js';
import { ThinkingBlock } from './ThinkingBlock.js';

interface ChatViewProps {
  messages: Message[];
  streamBlocks: StreamBlock[];
  isStreaming: boolean;
  streamError: string | null;
}

export function ChatView({ messages, streamBlocks, isStreaming, streamError }: ChatViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Only auto-scroll if already near the bottom
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    if (isNearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, streamBlocks.length, streamBlocks[streamBlocks.length - 1]?.content.length]);

  return (
    <div ref={containerRef} style={{
      flex: 1,
      overflow: 'auto',
      padding: '8px 0',
    }}>
      {messages.map((msg) => (
        <MessageBubble key={`${msg.sessionId}-${msg.sequence}`} message={msg} />
      ))}

      {streamBlocks.length > 0 && (
        <div style={{ padding: '8px 12px' }}>
          {streamBlocks.map((block) => {
            if (block.blockType === 'thinking') {
              return <ThinkingBlock key={block.blockIndex} block={block} />;
            }
            if (block.blockType === 'tool_use') {
              return <ToolBlock key={block.blockIndex} block={block} />;
            }
            // Text blocks
            if (block.content) {
              return (
                <div key={block.blockIndex} style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  lineHeight: '1.5',
                  color: 'var(--vscode-foreground)',
                }}>
                  {block.content}
                  {!block.complete && <span style={{ opacity: 0.5 }}>|</span>}
                </div>
              );
            }
            return null;
          })}
        </div>
      )}

      {isStreaming && streamBlocks.length === 0 && (
        <div style={{
          padding: '8px 12px',
          color: 'var(--vscode-descriptionForeground)',
          fontStyle: 'italic',
        }}>
          Working...
        </div>
      )}

      {streamError && (
        <div style={{
          padding: '8px 12px',
          color: 'var(--vscode-errorForeground)',
          backgroundColor: 'var(--vscode-inputValidation-errorBackground)',
          borderRadius: '4px',
          margin: '4px 12px',
          fontSize: '12px',
        }}>
          {streamError}
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
