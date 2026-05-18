'use client';

import { Card } from 'animal-island-ui';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import type { ToastState, ToastTone } from '@/app/components/useToast';

import './toast-bar.css';

function toneToCardColor(tone: ToastTone): 'app-red' | undefined {
  return tone === 'err' ? 'app-red' : undefined;
}

export function ToastViewport({
  toast,
  onDismiss,
}: {
  toast: ToastState | null;
  onDismiss?: () => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !toast) {
    return null;
  }

  return createPortal(
    <div className="toast-viewport" role="status" aria-live="polite">
      <Card
        color={toneToCardColor(toast.tone)}
        className={`toast-viewport-inner toast-viewport-inner--${toast.tone}`}
        onClick={onDismiss}
      >
        {toast.text}
      </Card>
    </div>,
    document.body,
  );
}
