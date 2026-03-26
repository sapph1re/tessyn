import { useRef, useState, useCallback, useEffect } from 'preact/hooks';

interface InputAreaProps {
  onSend: (text: string) => void;
  onCancel?: () => void;
  isStreaming: boolean;
  draft: string;
  onDraftChange: (draft: string) => void;
  disabled: boolean;
}

export function InputArea({ onSend, onCancel, isStreaming, draft, onDraftChange, disabled }: InputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isComposing, setIsComposing] = useState(false);

  // Auto-resize textarea
  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [draft, adjustHeight]);

  const handleKeyDown = (e: KeyboardEvent) => {
    // Don't intercept during IME composition
    if (isComposing) return;

    // Enter to send, Shift+Enter for newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = draft.trim();
      if (text && !disabled) {
        onSend(text);
        onDraftChange('');
      }
    }

    // Escape to cancel active run
    if (e.key === 'Escape' && isStreaming && onCancel) {
      e.preventDefault();
      onCancel();
    }
  };

  const handleInput = (e: Event) => {
    const target = e.target as HTMLTextAreaElement;
    onDraftChange(target.value);
  };

  return (
    <div style={{
      borderTop: '1px solid var(--vscode-panel-border)',
      padding: '8px',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
    }}>
      <div style={{
        display: 'flex',
        gap: '4px',
        alignItems: 'flex-end',
      }}>
        <textarea
          ref={textareaRef}
          value={draft}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          placeholder={isStreaming ? 'Claude is working...' : 'Send a message...'}
          disabled={disabled}
          rows={1}
          style={{
            flex: 1,
            resize: 'none',
            border: '1px solid var(--vscode-input-border)',
            backgroundColor: 'var(--vscode-input-background)',
            color: 'var(--vscode-input-foreground)',
            padding: '6px 8px',
            borderRadius: '4px',
            fontFamily: 'var(--vscode-font-family)',
            fontSize: 'var(--vscode-font-size)',
            lineHeight: '1.4',
            outline: 'none',
            minHeight: '32px',
            maxHeight: '200px',
            overflow: 'auto',
          }}
        />
        {isStreaming ? (
          <button
            onClick={() => onCancel?.()}
            style={{
              padding: '6px 12px',
              backgroundColor: 'var(--vscode-button-secondaryBackground)',
              color: 'var(--vscode-button-secondaryForeground)',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              whiteSpace: 'nowrap',
            }}
          >
            Cancel
          </button>
        ) : (
          <button
            onClick={() => {
              const text = draft.trim();
              if (text && !disabled) {
                onSend(text);
                onDraftChange('');
              }
            }}
            disabled={disabled || !draft.trim()}
            style={{
              padding: '6px 12px',
              backgroundColor: draft.trim() && !disabled
                ? 'var(--vscode-button-background)'
                : 'var(--vscode-button-secondaryBackground)',
              color: draft.trim() && !disabled
                ? 'var(--vscode-button-foreground)'
                : 'var(--vscode-button-secondaryForeground)',
              border: 'none',
              borderRadius: '4px',
              cursor: draft.trim() && !disabled ? 'pointer' : 'default',
              fontSize: '12px',
              whiteSpace: 'nowrap',
              opacity: draft.trim() && !disabled ? 1 : 0.5,
            }}
          >
            Send
          </button>
        )}
      </div>
      <div style={{
        fontSize: '10px',
        color: 'var(--vscode-descriptionForeground)',
        opacity: 0.6,
        textAlign: 'right',
      }}>
        Enter to send, Shift+Enter for newline
      </div>
    </div>
  );
}
