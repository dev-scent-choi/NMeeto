'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isLoggedIn } from '@/lib/auth';
import { listSessions, getUsage, type UsageInfo } from '@/lib/api';
import Link from 'next/link';
import AppShell from '@/components/AppShell';

interface SessionItem {
  id: string;
  state: string;
  role_key: string;
  created_at: string;
}

const STATE_META: Record<string, { label: string; dot: string; text: string }> = {
  completed:   { label: '완료',     dot: 'bg-emerald-400', text: 'text-emerald-700' },
  in_progress: { label: '진행 중',  dot: 'bg-blue-400',    text: 'text-blue-700'    },
  planning:    { label: '준비 중',  dot: 'bg-amber-400',   text: 'text-amber-700'   },
  ready:       { label: '시작 대기',dot: 'bg-stone-400',   text: 'text-stone-600'   },
  abandoned:   { label: '중단',     dot: 'bg-red-400',     text: 'text-red-600'     },
};

function StatCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-stone-200 px-6 py-5">
      <p className="text-xs font-medium text-stone-400 uppercase tracking-wider">{label}</p>
      <p className="mt-2 text-3xl font-bold text-stone-900">{value}</p>
      {sub && <p className="mt-1 text-xs text-stone-400">{sub}</p>}
    </div>
  );
}

const IconArrow = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
  </svg>
);

const IconEmpty = () => (
  <svg className="w-10 h-10 text-stone-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);

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

  const completed = sessions.filter(s => s.state === 'completed').length;
  const inProgress = sessions.filter(s => s.state === 'in_progress' || s.state === 'ready').length;

  return (
    <AppShell>
      <div className="flex-1 px-10 py-8 max-w-5xl w-full">
        {/* 페이지 헤더 */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-stone-900">대시보드</h1>
            <p className="text-sm text-stone-400 mt-0.5">면접 기록과 진행 상황을 확인하세요</p>
          </div>
          <Link
            href="/session/new"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            새 면접 시작
          </Link>
        </div>

        {/* 통계 카드 */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <StatCard
            label="오늘 남은 면접"
            value={
              usage ? (
                <span className={usage.sessions_left === 0 ? 'text-red-500' : 'text-stone-900'}>
                  {usage.sessions_left}
                  <span className="text-lg font-normal text-stone-400 ml-1">/ {usage.daily_limit}</span>
                </span>
              ) : '—'
            }
            sub="매일 자정 초기화"
          />
          <StatCard label="총 면접 횟수" value={sessions.length} sub="전체 기간" />
          <StatCard label="완료 면접" value={completed} sub={inProgress > 0 ? `${inProgress}개 진행 중` : '완료됨'} />
        </div>

        {/* 면접 목록 */}
        <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between">
            <h2 className="font-semibold text-stone-900 text-sm">면접 기록</h2>
            <span className="text-xs text-stone-400">{sessions.length}건</span>
          </div>

          {loading ? (
            <div className="py-20 flex flex-col items-center gap-3 text-stone-400">
              <div className="w-6 h-6 border-2 border-stone-200 border-t-stone-400 rounded-full animate-spin" />
              <span className="text-sm">불러오는 중...</span>
            </div>
          ) : sessions.length === 0 ? (
            <div className="py-20 flex flex-col items-center gap-4 text-stone-400">
              <IconEmpty />
              <div className="text-center">
                <p className="text-stone-600 font-medium">아직 면접 기록이 없습니다</p>
                <p className="text-sm text-stone-400 mt-1">첫 AI 모의면접을 시작해 보세요</p>
              </div>
              <Link
                href="/session/new"
                className="mt-2 inline-flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors"
              >
                첫 면접 시작하기 <IconArrow />
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-stone-50">
              {/* 테이블 헤더 */}
              <div className="grid grid-cols-[1fr_140px_120px_160px] px-6 py-2.5 text-xs font-medium text-stone-400 uppercase tracking-wider bg-stone-50/50">
                <span>직무</span>
                <span>날짜</span>
                <span>상태</span>
                <span className="text-right">액션</span>
              </div>
              {sessions.map(s => {
                const meta = STATE_META[s.state] ?? { label: s.state, dot: 'bg-stone-300', text: 'text-stone-500' };
                const dt = new Date(s.created_at);
                const date = dt.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
                const time = dt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
                return (
                  <div
                    key={s.id}
                    className="grid grid-cols-[1fr_140px_120px_160px] px-6 py-4 items-center hover:bg-stone-50 transition-colors"
                  >
                    <div>
                      <p className="text-sm font-medium text-stone-800">{s.role_key}</p>
                    </div>
                    <div>
                      <p className="text-sm text-stone-600">{date}</p>
                      <p className="text-xs text-stone-400">{time}</p>
                    </div>
                    <div>
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${meta.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                        {meta.label}
                      </span>
                    </div>
                    <div className="flex justify-end gap-3">
                      {s.state === 'completed' && (
                        <Link
                          href={`/report/${s.id}`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
                        >
                          리포트 보기 <IconArrow />
                        </Link>
                      )}
                      {(s.state === 'ready' || s.state === 'in_progress') && (
                        <Link
                          href={`/interview/${s.id}`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
                        >
                          면접 계속하기 <IconArrow />
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
