import { getPrincipal, db } from '@/lib/session';
import { ChatBot } from '@/components/ChatBot';

export default async function AssistantPage() {
  const principal = (await getPrincipal())!;
  const [u] = await db()<{ full_name: string }[]>`select full_name from app.users where id = ${principal.userId}`;
  const first = (u?.full_name ?? 'there').split(' ')[0];

  return (
    <div className="assistant-page">
      <div className="page-head">
        <div className="page-title">Assistant</div>
        <div className="page-sub">A retrieval-augmented guide to your status, deadlines, documents, and policy.</div>
      </div>
      <ChatBot greeting={`Hi ${first} — I answer from your own records and AJACE's policy & immigration knowledge base. I can only see your data, never anyone else's. Ask me anything.`} />
    </div>
  );
}
