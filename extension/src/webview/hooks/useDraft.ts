import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { rpc } from '../api.js';

const SAVE_DEBOUNCE_MS = 1_000;

/**
 * Hook for draft text persistence. Saves draft to daemon with debounce.
 * Restores draft on session load.
 */
export function useDraft(externalId: string | null) {
  const [draft, setDraft] = useState('');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef('');

  // Load draft when session changes
  useEffect(() => {
    if (!externalId) {
      setDraft('');
      return;
    }

    let cancelled = false;
    rpc<{ draft: string | null }>('sessions.draft.get', { externalId })
      .then(result => {
        if (cancelled) return;
        const restored = result?.draft ?? '';
        setDraft(restored);
        lastSavedRef.current = restored;
      })
      .catch(() => {
        // Ignore — draft is nice-to-have
      });

    return () => { cancelled = true; };
  }, [externalId]);

  // Save draft with debounce
  const updateDraft = useCallback((text: string) => {
    setDraft(text);

    if (!externalId) return;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(() => {
      if (text !== lastSavedRef.current) {
        lastSavedRef.current = text;
        rpc('sessions.draft.save', { externalId, content: text }).catch(() => {});
      }
    }, SAVE_DEBOUNCE_MS);
  }, [externalId]);

  // Clear draft (on send)
  const clearDraft = useCallback(() => {
    setDraft('');
    if (externalId) {
      lastSavedRef.current = '';
      rpc('sessions.draft.save', { externalId, content: '' }).catch(() => {});
    }
  }, [externalId]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  return { draft, updateDraft, clearDraft };
}
