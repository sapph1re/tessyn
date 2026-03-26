import { useState, useEffect } from 'preact/hooks';
import { rpc, onMessage } from '../api.js';
import type { Message } from '../../protocol/types.js';

/**
 * Hook to fetch and subscribe to messages for a session.
 */
export function useMessages(externalId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch messages when session changes
  useEffect(() => {
    if (!externalId) {
      setMessages([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    rpc<{ session: unknown; messages: Message[]; meta: unknown }>('sessions.get', { externalId })
      .then(result => {
        if (!cancelled) setMessages(result?.messages ?? []);
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [externalId]);

  // Refetch when session is updated (new messages from external sources)
  useEffect(() => {
    if (!externalId) return;

    const unsubscribe = onMessage((msg) => {
      if (msg.type === 'state.sessions') {
        // Session list updated — could mean new messages. Refetch.
        rpc<{ session: unknown; messages: Message[]; meta: unknown }>('sessions.get', { externalId })
          .then(result => {
            setMessages(result?.messages ?? []);
          })
          .catch(() => {});
      }
    });

    return unsubscribe;
  }, [externalId]);

  return { messages, loading };
}
