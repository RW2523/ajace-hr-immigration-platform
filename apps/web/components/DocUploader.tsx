'use client';
import { useRef, useState } from 'react';
import { UploadCloud, Loader2 } from 'lucide-react';

export function DocUploader({
  docType, action, compact,
}: { docType: string; action: (fd: FormData) => Promise<void>; compact?: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = () => {
    if (inputRef.current?.files?.length) {
      setBusy(true);
      formRef.current?.requestSubmit();
    }
  };

  return (
    <form ref={formRef} action={action}>
      <input type="hidden" name="document_type" value={docType} />
      <input
        ref={inputRef} type="file" name="file" hidden
        onChange={submit}
        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
      />
      <div
        className={`dropzone${drag ? ' drag' : ''}`}
        style={compact ? { padding: 16 } : undefined}
        onClick={() => !busy && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault(); setDrag(false);
          if (inputRef.current && e.dataTransfer.files.length) {
            inputRef.current.files = e.dataTransfer.files;
            submit();
          }
        }}
      >
        <div className="dropzone-ic" style={compact ? { width: 36, height: 36, marginBottom: 8 } : undefined}>
          {busy ? <Loader2 size={compact ? 18 : 22} className="spin" /> : <UploadCloud size={compact ? 18 : 22} />}
        </div>
        {busy ? (
          <div style={{ fontWeight: 650, fontSize: 13 }}>Uploading…</div>
        ) : (
          <>
            <div style={{ fontWeight: 650, fontSize: compact ? 13 : 14 }}>
              {compact ? 'Drop a file, or ' : 'Drag & drop your document here, or '}<span style={{ color: 'var(--brand-600)' }}>browse</span>
            </div>
            {!compact && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>PDF, JPG, PNG, DOC · max 12 MB</div>}
          </>
        )}
      </div>
    </form>
  );
}
