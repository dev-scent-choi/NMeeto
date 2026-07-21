'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isLoggedIn, clearTokens } from '@/lib/auth';
import { listSessions, getUsage, type UsageInfo } from '@/lib/api';
import Link from 'next/link';

interface SessionItem {
  id: string;
  state: string;
  role_key: string;
  created_at: string;
}

const STATE_LABELS: Record<string, { label: string; color: string }> = {
  completed: { label: '완료', color: 'bg-green-100 text-green-700' },
  in_progress: { label: '진행 중', color: 'bg-blue-100 text-blue-700' },
  planning: { label: '준비 중', color: 'bg-amber-100 text-amber-700' },
  ready: { label: '시작 대기', color: 'bg-stone-100 text-stone-600' },
  abandoned: { label: '중단', color: 'bg-red-100 text-red-600' },
};

function ArrowRightIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isLoggedIn()) { router.push('/login'); return; }
    Promise.all([
      listSessions().then(d => setSessions(d.items)),
      getUsage().then(u => setUsage(u)).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [router]);

  const logout = () => { clearTokens(); router.push('/login'); };

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      <header className="bg-white border-b border-stone-200 px-6 h-14 flex items-center justify-between shrink-0">
        <span className="text-lg font-bold text-stone-900 tracking-tight">NMeeto</span>
        <div className="flex items-center gap-3">
          <Link
            href="/session/new"
            className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 font-semibold transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            새 면접
          </Link>
          <button onClick={logout} className="text-sm text-stone-400 hover:text-stone-700 transition-colors">
            로그아웃
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-6 py-8">
        <div className="flex items-start justify-between mb-7">
          <div>
            <h1 className="text-xl font-bold text-stone-900">면접 기록</h1>
            <p className="text-sm text-stone-400 mt-0.5">지난 면접을 검토하거나 새 면접을 시작하세요.</p>
          </div>
          {usage && (
            <div className="text-right bg-white border border-stone-200 rounded-xl px-4 py-3 min-w-[120px]">
              <p className="text-xs text-stone-400">오늘 남은 면접</p>
              <p className={`text-2xl font-bold mt-0.5 ${usage.sessions_left === 0 ? 'text-red-500' : 'text-stone-800'}`}>
                {usage.sessions_left}
                <span className="text-sm font-normal text-stone-400 ml-1">/ {usage.daily_limit}</span>
              </p>
            </div>
          )}
        </div>

        {loading ? (
          <div className="text-center py-16 text-stone-400 text-sm">
            <div className="w-6 h-6 border-2 border-stone-200 border-t-stone-400 rounded-full animate-spin mx-auto mb-3" />
            불러오는 중...
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-stone-200">
            <div className="w-14 h-14 bg-stone-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-stone-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <p className="text-stone-500 font-medium mb-1">아직 면접 기록이 없습니다</p>
            <p className="text-sm text-stone-400 mb-5">첫 AI 모의면접을 시작해 보세요.</p>
            <Link
              href="/session/new"
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors"
            >
              첫 면접 시작하기
              <ArrowRightIcon />
            </Link>
          </div>
        ) : (
          <div className="space-y-2.5">
            {sessions.map(s => {
              const meta = STATE_LABELS[s.state] ?? { label: s.state, color: 'bg-stone-100 text-stone-600' };
              const date = new Date(s.created_at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
              const time = new Date(s.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
              return (
                <div key={s.id} className="bg-white rounded-2xl border border-stone-200 px-5 py-4 flex items-center gap-4 hover:border-stone-300 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-stone-800 truncate">{s.role_key}</p>
                    <p className="text-xs text-stone-400 mt-0.5">{date} {time}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${meta.color}`}>{meta.label}</span>
                    {s.state === 'completed' && (
                      <Link
                        href={`/report/${s.id}`}
                        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors"
                      >
                        리포트 보기
                        <ArrowRightIcon />
                      </Link>
                    )}
                    {s.state === 'ready' && (
                      <Link
                        href={`/interview/${s.id}`}
                        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors"
                      >
                        면접 시작
                        <ArrowRightIcon />
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
