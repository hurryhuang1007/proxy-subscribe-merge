'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type ToastTone = 'ok' | 'err';

export type ToastState = {
  tone: ToastTone;
  text: string;
};

const DEFAULT_DURATION_MS = 3200;

export function useToast(defaultDurationMs = DEFAULT_DURATION_MS) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismissToast = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setToast(null);
  }, []);

  const showToast = useCallback(
    (tone: ToastTone, text: string, durationMs = defaultDurationMs) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      setToast({ tone, text });
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setToast(null);
      }, durationMs);
    },
    [defaultDurationMs],
  );

  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );

  return { toast, showToast, dismissToast };
}
