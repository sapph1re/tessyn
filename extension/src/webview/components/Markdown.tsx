import { useMemo } from 'preact/hooks';
import { Marked } from 'marked';

const marked = new Marked({
  breaks: true, // GFM line breaks
  gfm: true,
});

// Sanitize HTML to prevent XSS in webview
function sanitize(html: string): string {
  // Strip script tags and event handlers
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]*/gi, '')
    .replace(/javascript\s*:/gi, '');
}

interface MarkdownProps {
  content: string;
  className?: string;
}

export function Markdown({ content, className }: MarkdownProps) {
  const html = useMemo(() => {
    const raw = marked.parse(content);
    // marked.parse can return string or Promise<string> — we only use sync
    if (typeof raw !== 'string') return '';
    return sanitize(raw);
  }, [content]);

  return (
    <div
      class={className}
      dangerouslySetInnerHTML={{ __html: html }}
      style={{
        lineHeight: '1.5',
        wordBreak: 'break-word',
      }}
    />
  );
}
