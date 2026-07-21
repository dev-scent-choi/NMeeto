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
      {/* 헤더 */}
      <header className="bg-white border-b border-stone-200 px-6 h-14 flex items-center justify-between shrink-0">
        <span className="text-lg font-bold text-stone-900">NMeeto</span>
        <div className="flex items-center gap-3">
          <Link href="/session/new"
            className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 font-semibold transition-colors">
            + 새 면접
          </Link>
          <button onClick={logout} className="text-sm text-stone-500 hover:text-stone-800 transition-colors">
            로그아웃
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-6 py-8">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-stone-900 mb-1">면접 기록</h1>
            <p className="text-sm text-stone-500">지난 면접을 다시 보거나 새 면접을 시작하세요.</p>
          </div>
          {usage && (
            <div className="text-right text-xs text-stone-500 bg-white border border-stone-200 rounded-xl px-4 py-2.5">
              <p>오늘 남은 면접</p>
              <p className={`text-lg font-bold mt-0.5 ${usage.sessions_left === 0 ? 'text-red-500' : 'text-stone-800'}`}>
                {usage.sessions_left} / {usage.daily_limit}
              </p>
            </div>
          )}
        </div>

        {loading ? (
          <div className="text-center py-12 text-stone-400 text-sm">불러오는 중...</div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-stone-200">
            <p className="text-stone-500 mb-4">아직 면접 기록이 없습니다.</p>
            <Link href="/session/new"
              className="inline-flex px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors">
              첫 면접 시작하기
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {sessions.map(s => {
              const meta = STATE_LABELS[s.state] ?? { label: s.state, color: 'bg-stone-100 text-stone-600' };
              const date = new Date(s.created_at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
              return (
                <div key={s.id} className="bg-white rounded-2xl border border-stone-200 px-5 py-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-stone-800">{s.role_key}</p>
                    <p className="text-xs text-stone-400 mt-0.5">{date}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${meta.color}`}>{meta.label}</span>
                    {s.state === 'completed' && (
                      <Link href={`/report/${s.id}`} className="text-xs text-blue-600 hover:underline">
                        리포트 보기
                      </Link>
                    )}
                    {s.state === 'ready' && (
                      <Link href={`/interview/${s.id}`} className="text-xs text-blue-600 hover:underline">
                        면접 시작
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
