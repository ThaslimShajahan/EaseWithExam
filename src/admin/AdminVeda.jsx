import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { MessageSquare, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { adminGetDoubtChats, adminGetDoubtMessages } from '../lib/supabase';
import { VedaAvatarSm } from '../components/ui/VedaAvatar';

function ChatRow({ chat, messages }) {
  const [open, setOpen] = useState(false);
  const date = new Date(chat.created_at).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className="border-b border-white/5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-4 px-5 py-3 hover:bg-white/5 transition-colors text-left"
      >
        <div className="h-8 w-8 rounded-full overflow-hidden shrink-0">
          <VedaAvatarSm />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white font-medium truncate">Session {chat.id.slice(0, 8)}</p>
          <p className="text-[10px] text-slate-500">{date} · {messages.length} messages</p>
        </div>
        {open ? <ChevronUp size={14} className="text-slate-500 shrink-0" /> : <ChevronDown size={14} className="text-slate-500 shrink-0" />}
      </button>

      {open && messages.length > 0 && (
        <div className="px-5 pb-4 space-y-2">
          {messages.map((m) => (
            <div key={m.id} className={`flex gap-2 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={[
                'max-w-[80%] px-3 py-2 rounded-xl text-xs leading-relaxed',
                m.role === 'user'
                  ? 'bg-primary-700 text-white'
                  : 'bg-slate-700 text-slate-200',
              ].join(' ')}>
                {m.content?.slice(0, 300)}{(m.content?.length || 0) > 300 ? '…' : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminVeda() {
  const [chats,    setChats]    = useState([]);
  const [msgMap,   setMsgMap]   = useState({});
  const [loading,  setLoading]  = useState(true);

  const load = async () => {
    setLoading(true);
    const chatData = await adminGetDoubtChats();
    setChats(chatData || []);

    const msgs = await adminGetDoubtMessages((chatData || []).map((c) => c.id));
    setMsgMap(msgs);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const totalMessages = Object.values(msgMap).reduce((a, m) => a + m.length, 0);

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">EWE Chat Sessions</h1>
          <p className="text-slate-400 text-sm mt-1">
            {chats.length} sessions · {totalMessages} messages total
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 text-sm transition-colors">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Sessions',  value: chats.length    },
          { label: 'Total Messages',  value: totalMessages   },
          { label: 'Avg Msg/Session', value: chats.length ? Math.round(totalMessages / chats.length) : 0 },
        ].map(({ label, value }) => (
          <div key={label} className="bg-slate-800 rounded-2xl p-4 border border-white/5">
            <p className="text-2xl font-bold text-white">{value}</p>
            <p className="text-xs text-slate-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <div className="h-4 w-4 border-2 border-slate-600 border-t-primary-500 rounded-full animate-spin" />
          Loading sessions…
        </div>
      ) : chats.length === 0 ? (
        <div className="flex flex-col items-center py-16 gap-3">
          <MessageSquare size={36} className="text-slate-700" />
          <p className="text-slate-500">No EWE chat sessions yet</p>
        </div>
      ) : (
        <div className="bg-slate-800 rounded-2xl border border-white/5 overflow-hidden">
          {chats.map((c) => (
            <ChatRow key={c.id} chat={c} messages={msgMap[c.id] || []} />
          ))}
        </div>
      )}
    </div>
  );
}
