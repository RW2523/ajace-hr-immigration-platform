'use client';
import { useEffect, useRef, useState } from 'react';
import { Sparkles, Send, ShieldAlert, FileText, User, Square } from 'lucide-react';

interface Source { content: string; docType: string }
interface Msg { role: 'user' | 'bot'; text: string; sources?: Source[]; counsel?: boolean; tools?: string[]; streaming?: boolean }

const TOOL_LABELS: Record<string, string> = {
  search_knowledge_base: 'Knowledge base', get_my_status: 'Case status',
  get_my_deadlines: 'Deadlines', get_my_documents: 'Documents',
};

function decodeMeta(b64: string | null): { routedToCounsel: boolean; sources: { label: string; detail: string }[]; toolsUsed: string[] } {
  if (!b64) return { routedToCounsel: false, sources: [], toolsUsed: [] };
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { routedToCounsel: false, sources: [], toolsUsed: [] };
  }
}

const SUGGESTIONS = [
  'When does my work authorization expire?',
  'What documents do I still need to submit?',
  'What are my upcoming deadlines?',
  'What is STEM OPT and am I on it?',
];

export function ChatBot({ greeting, endpoint = '/api/assistant' }: { greeting: string; endpoint?: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const send = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    setInput('');
    if (taRef.current) taRef.current.style.height = 'auto';
    setMessages((m) => [...m, { role: 'user', text: question }, { role: 'bot', text: '', streaming: true }]);
    setBusy(true);

    const patchLast = (patch: Partial<Msg>) =>
      setMessages((m) => { const c = [...m]; const cur = c[c.length - 1]; if (cur) c[c.length - 1] = { ...cur, ...patch }; return c; });

    const controller = new AbortController();
    abortRef.current = controller;
    let acc = '';
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question }), signal: controller.signal });
      const meta = decodeMeta(res.headers.get('x-assistant-meta'));
      if (!res.body) { patchLast({ text: "Sorry — I couldn't respond.", streaming: false }); return; }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        patchLast({ text: acc });
      }
      patchLast({
        text: acc || "I'm not sure how to answer that — try rephrasing.",
        streaming: false,
        counsel: meta.routedToCounsel,
        tools: meta.toolsUsed,
        sources: meta.sources.map((s) => ({ content: s.detail, docType: s.label })),
      });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        patchLast({ text: acc ? acc + ' ⏹' : 'Stopped.', streaming: false });
      } else {
        patchLast({ text: 'Sorry — something went wrong. Please try again.', streaming: false });
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  return (
    <div className="chat-wrap">
      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-ic"><Sparkles size={26} /></div>
            <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-.02em' }}>How can I help?</div>
            <div className="muted" style={{ fontSize: 13.5, marginTop: 6, maxWidth: 440, marginLeft: 'auto', marginRight: 'auto' }}>{greeting}</div>
            <div className="chat-suggest" style={{ justifyContent: 'center', marginTop: 20 }}>
              {SUGGESTIONS.map((s) => (
                <button key={s} className="suggest-chip" onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className={`msg-av ${m.role === 'bot' ? 'bot' : 'me'}`}>
              {m.role === 'bot' ? <Sparkles size={16} /> : <User size={16} />}
            </div>
            <div className="bubble">
              {m.counsel && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--warn)', fontWeight: 700, fontSize: 12.5, marginBottom: 6 }}>
                  <ShieldAlert size={14} /> Routed to counsel
                </div>
              )}
              {m.streaming && !m.text
                ? <span className="typing"><span /><span /><span /></span>
                : <>{m.text}{m.streaming && <span className="stream-cursor" />}</>}
              {m.tools && m.tools.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 10 }}>
                  {[...new Set(m.tools)].map((t) => (
                    <span key={t} className="pill pill-brand" style={{ fontSize: 10.5, padding: '2px 8px' }}>{TOOL_LABELS[t] ?? t}</span>
                  ))}
                </div>
              )}
              {m.sources && m.sources.length > 0 && (
                <div className="src">
                  <div style={{ fontWeight: 650, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 5 }}><FileText size={12} /> {m.sources.length} source{m.sources.length > 1 ? 's' : ''} (scoped to you)</div>
                  {m.sources.slice(0, 3).map((s, j) => <div key={j} style={{ opacity: .85 }}>• <span style={{ textTransform: 'capitalize' }}>{s.docType.replace(/_/g, ' ')}</span>: {s.content.slice(0, 90)}{s.content.length > 90 ? '…' : ''}</div>)}
                </div>
              )}
            </div>
          </div>
        ))}

      </div>

      <div className="chat-input">
        <textarea
          ref={taRef}
          value={input}
          placeholder="Ask about your status, deadlines, or documents…"
          rows={1}
          onChange={(e) => {
            setInput(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px';
          }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
        />
        {busy ? (
          <button className="chat-send stop" onClick={stop} title="Stop generating">
            <Square size={15} fill="currentColor" />
          </button>
        ) : (
          <button className="chat-send" disabled={!input.trim()} onClick={() => send(input)} title="Send">
            <Send size={17} />
          </button>
        )}
      </div>
      <div className="muted" style={{ fontSize: 11.5, textAlign: 'center', marginTop: 8 }}>
        This assistant tracks status &amp; deadlines and does not provide legal advice. Legal questions are routed to your firm's immigration counsel.
      </div>
    </div>
  );
}
