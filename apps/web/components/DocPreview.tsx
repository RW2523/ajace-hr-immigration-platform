'use client';
import { useState } from 'react';
import { Eye, Download, X, Loader2, FileText, ExternalLink } from 'lucide-react';

type SignFn = (documentId: string) => Promise<{ url: string | null; contentType: string | null; filename: string | null }>;

export function DocPreview({
  documentId, filename, compact, sign,
}: { documentId: string; filename: string | null; compact?: boolean; sign: SignFn }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [ctype, setCtype] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(filename);
  const [err, setErr] = useState(false);

  const openModal = async () => {
    setOpen(true); setLoading(true); setErr(false);
    try {
      const res = await sign(documentId);
      if (!res.url) { setErr(true); } else { setUrl(res.url); setCtype(res.contentType); setName(res.filename ?? filename); }
    } catch { setErr(true); } finally { setLoading(false); }
  };
  const close = () => { setOpen(false); setUrl(null); };

  const isImage = (ctype ?? '').startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(name ?? '');
  const isPdf = (ctype ?? '').includes('pdf') || /\.pdf$/i.test(name ?? '');

  return (
    <>
      <button className={`file-chip-act${compact ? ' sm' : ''}`} onClick={openModal} title="Preview">
        <Eye size={compact ? 15 : 16} />{!compact && <span>View</span>}
      </button>

      {open && (
        <div className="modal-overlay" onClick={close}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div className="row" style={{ minWidth: 0 }}>
                <FileText size={17} color="var(--brand-600)" />
                <span style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name ?? 'Document'}</span>
              </div>
              <div className="row" style={{ gap: 6 }}>
                {url && <a className="icon-btn" href={url} target="_blank" rel="noreferrer" title="Open in new tab" style={{ width: 34, height: 34 }}><ExternalLink size={15} /></a>}
                {url && <a className="icon-btn" href={url} download={name ?? true} title="Download" style={{ width: 34, height: 34 }}><Download size={15} /></a>}
                <button className="icon-btn" onClick={close} title="Close" style={{ width: 34, height: 34 }}><X size={16} /></button>
              </div>
            </div>
            <div className="modal-body">
              {loading ? (
                <div className="modal-center"><Loader2 size={26} className="spin" color="var(--brand-500)" /><div className="muted" style={{ marginTop: 10 }}>Loading preview…</div></div>
              ) : err || !url ? (
                <div className="modal-center">
                  <div style={{ width: 52, height: 52, borderRadius: 14, background: 'var(--bg-soft)', display: 'grid', placeItems: 'center', margin: '0 auto 12px' }}><FileText size={24} color="var(--muted-2)" /></div>
                  <div style={{ fontWeight: 700 }}>Preview unavailable</div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>This file can't be previewed. Try downloading it instead.</div>
                </div>
              ) : isImage ? (
                <img src={url} alt={name ?? 'document'} style={{ maxWidth: '100%', maxHeight: '100%', margin: 'auto', display: 'block', borderRadius: 8 }} />
              ) : isPdf ? (
                <iframe src={url} title={name ?? 'document'} style={{ width: '100%', height: '100%', border: 0, borderRadius: 8, background: '#fff' }} />
              ) : (
                <div className="modal-center">
                  <div style={{ fontWeight: 700 }}>Ready to download</div>
                  <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>This document type opens outside the preview.</div>
                  <a className="btn btn-primary" href={url} download style={{ marginTop: 14 }}><Download size={15} /> Download</a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
