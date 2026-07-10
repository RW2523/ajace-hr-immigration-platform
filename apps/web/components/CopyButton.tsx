'use client';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

export function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <span
      className="copy-btn"
      title="Copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          /* ignore */
        }
      }}
    >
      {done ? <Check size={14} color="var(--ok)" /> : <Copy size={14} />}
    </span>
  );
}
