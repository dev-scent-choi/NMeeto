'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { isLoggedIn } from '@/lib/auth';
import { getReport, getTranscript, type Report, type QuestionReport, type SubScores } from '@/lib/api';
import Link from 'next/link';

function BackIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  );
}

function ScoreRing({ score }: { score: number }) {
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 80 ? '#16a34a' : score >= 60 ? '#2563eb' : score >= 40 ? '#d97706' : '#dc2626';
  return (
    <div className="relative w-28 h-28">
      <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="#e7e5e4" strokeWidth="8" />
        <circle cx="50" cy="50" r={radius} fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1s ease' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-stone-900">{score}</span>
        <span className="text-xs text-stone-400">/ 100</span>
      </div>
    </div>
  );
}

function StarBadge({ label, active }: { label: string; active: boolean }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
      active ? 'bg-blue-100 text-blue-700' : 'bg-stone-100 text-stone-400 line-through'
    }`}>{label}</span>
  );
}

/* ── 세부 점수 바 ── */
const DIM_LABELS: Record<keyof SubScores, string> = {
  logic: '논리성',
  specificity: '구체성',
  communication: '전달력',
  star: 'STAR 구조',
};

function SubScorePanel({ sub_scores, per_dimension }: {
  sub_scores: SubScores;
  per_dimension?: { logic: string; specificity: string; communication: string; star: string } | null;
}) {
  const dims: (keyof SubScores)[] = ['logic', 'specificity', 'communication', 'star'];
  return (
    <div className="space-y-2.5">
      {dims.map(dim => {
        const v = sub_scores[dim] ?? 0;
        const pct = (v / 5) * 100;
        const color = v >= 4 ? 'bg-green-500' : v >= 3 ? 'bg-blue-500' : v >= 2 ? 'bg-amber-500' : 'bg-red-400';
        return (
          <div key={dim}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-stone-600">{DIM_LABELS[dim]}</span>
              <span className="text-xs font-semibold text-stone-700">{v}/5</span>
            </div>
            <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
            </div>
            {per_dimension?.[dim] && (
              <p className="text-xs text-stone-400 mt-0.5 leading-relaxed">{per_dimension[dim]}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── 레이더 차트 (SVG) ── */
function RadarChart({ sub_scores }: { sub_scores: SubScores }) {
  const dims: (keyof SubScores)[] = ['logic', 'specificity', 'communication', 'star'];
  const labels = ['논리성', '구체성', '전달력', 'STAR'];
  const cx = 80; const cy = 80; const R = 60;
  const n = dims.length;
  const toXY = (i: number, v: number) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const r = (v / 5) * R;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  };
  const pts = dims.map((d, i) => toXY(i, sub_scores[d] ?? 0));
  const polygon = pts.map(p => `${p.x},${p.y}`).join(' ');
  const rings = [1, 2, 3, 4, 5].map(v =>
    dims.map((_, i) => toXY(i, v)).map(p => `${p.x},${p.y}`).join(' ')
  );

  return (
    <svg viewBox="0 0 160 160" className="w-40 h-40">
      {rings.map((r, i) => (
        <polygon key={i} points={r} fill="none" stroke="#e7e5e4" strokeWidth="0.8" />
      ))}
      {dims.map((_, i) => {
        const p = toXY(i, 5);
        return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="#e7e5e4" strokeWidth="0.8" />;
      })}
      <polygon points={polygon} fill="#3b82f680" stroke="#3b82f6" strokeWidth="1.5" strokeLinejoin="round" />
      {dims.map((d, i) => {
        const lp = toXY(i, 5.8);
        return (
          <text key={i} x={lp.x} y={lp.y} fontSize="9" fill="#78716c"
            textAnchor={lp.x < cx - 2 ? 'end' : lp.x > cx + 2 ? 'start' : 'middle'}
            dominantBaseline="middle">
            {labels[i]}
          </text>
        );
      })}
    </svg>
  );
}

function QuestionCard({ q, i }: { q: QuestionReport; i: number }) {
  const [expanded, setExpanded] = useState(i === 0);
  const hasSubScores = q.sub_scores &&
    Object.values(q.sub_scores).some(v => typeof v === 'number' && v > 0);

  return (
    <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
      <button onClick={() => setExpanded(v => !v)}
        className="w-full px-5 py-4 text-left flex items-center gap-3">
        <span className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white ${
          q.score >= 80 ? 'bg-green-500' : q.score >= 60 ? 'bg-blue-500' : q.score >= 40 ? 'bg-amber-500' : 'bg-red-500'
        }`}>{q.score}</span>
        <span className="text-sm font-medium text-stone-800 flex-1 text-left line-clamp-2">{q.question}</span>
        <span className="text-stone-300 shrink-0">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-4 border-t border-stone-100">

          {/* 세부 점수 */}
          {hasSubScores && q.sub_scores && (
            <div className="pt-4">
              <p className="text-xs font-semibold text-stone-500 mb-3">세부 평가</p>
              <div className="flex gap-4 items-start">
                <div className="shrink-0">
                  <RadarChart sub_scores={q.sub_scores} />
                </div>
                <div className="flex-1 min-w-0 mt-2">
                  <SubScorePanel sub_scores={q.sub_scores} per_dimension={q.per_dimension} />
                </div>
              </div>
            </div>
          )}

          {/* STAR 커버리지 */}
          {q.star_coverage && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-stone-400 mr-1">STAR</span>
              <StarBadge label="S(상황)" active={q.star_coverage.situation} />
              <StarBadge label="T(과제)" active={q.star_coverage.task} />
              <StarBadge label="A(행동)" active={q.star_coverage.action} />
              <StarBadge label="R(결과)" active={q.star_coverage.result} />
              {q.jd_coverage != null && (
                <span className="ml-2 text-xs text-stone-400">JD 적합도 {Math.round(q.jd_coverage * 100)}%</span>
              )}
            </div>
          )}

          {/* 종합 피드백 */}
          <div>
            <p className="text-xs font-semibold text-stone-500 mb-1.5">종합 피드백</p>
            <p className="text-sm text-stone-700 leading-relaxed">{q.feedback}</p>
          </div>

          {/* 개선 답변 */}
          {q.improved_answer && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
              <p className="text-xs font-semibold text-blue-600 mb-1.5">모범 답변 예시</p>
              <p className="text-sm text-blue-900 leading-relaxed whitespace-pre-line">{q.improved_answer}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── 평균 sub_scores 종합 차트 ── */
function OverallSubScores({ questions }: { questions: QuestionReport[] }) {
  const withScores = questions.filter(q => q.sub_scores);
  if (withScores.length === 0) return null;
  const dims: (keyof SubScores)[] = ['logic', 'specificity', 'communication', 'star'];
  const avgs = Object.fromEntries(dims.map(d => [
    d,
    Math.round((withScores.reduce((sum, q) => sum + (q.sub_scores?.[d] ?? 0), 0) / withScores.length) * 10) / 10,
  ])) as SubScores;

  return (
    <div className="bg-white rounded-2xl border border-stone-200 p-6">
      <h2 className="text-sm font-semibold text-stone-500 mb-4">역량 분석 요약</h2>
      <div className="flex gap-6 items-center">
        <RadarChart sub_scores={avgs} />
        <div className="flex-1">
          <SubScorePanel sub_scores={avgs} />
        </div>
      </div>
    </div>
  );
}

export default function ReportPage() {
  const router = useRouter();
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;

  const [report, setReport] = useState<Report | null>(null);
  const [status, setStatus] = useState<'loading' | 'pending' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [transcript, setTranscript] = useState<Array<{ seq: number; speaker: string; turn_type: string; text: string }>>([]);
  const [showTranscript, setShowTranscript] = useState(false);

  const poll = useCallback(async () => {
    try {
      const data = await getReport(sessionId);
      if ('status' in data && data.status === 'pending') {
        setStatus('pending');
      } else {
        setReport(data as Report);
        setStatus('ready');
        getTranscript(sessionId).then(d => setTranscript(d.turns ?? [])).catch(() => {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '리포트를 불러올 수 없습니다.');
      setStatus('error');
    }
  }, [sessionId]);

  useEffect(() => {
    if (!isLoggedIn()) { router.push('/login'); return; }
    poll();
    const interval = setInterval(async () => {
      if (status !== 'pending') { clearInterval(interval); return; }
      await poll();
    }, 3000);
    return () => clearInterval(interval);
  }, [sessionId, router, poll, status]);

  if (status === 'loading' || status === 'pending') {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center flex-col gap-4">
        <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
        <p className="text-sm text-stone-500">
          {status === 'loading' ? '리포트를 불러오는 중...' : 'AI가 면접 피드백을 생성하고 있습니다...'}
        </p>
        {status === 'pending' && <p className="text-xs text-stone-400">보통 1~2분 소요됩니다</p>}
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center flex-col gap-4">
        <p className="text-red-600">{error}</p>
        <Link href="/dashboard" className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline">
          <BackIcon />대시보드로 돌아가기
        </Link>
      </div>
    );
  }
  if (!report) return null;

  const date = new Date(report.generated_at).toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white border-b border-stone-200 px-6 h-14 flex items-center justify-between sticky top-0 z-10">
        <Link href="/dashboard" className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-800 transition-colors">
          <BackIcon />대시보드
        </Link>
        <span className="text-sm font-semibold text-stone-900">면접 리포트</span>
        <span className="text-xs text-stone-400">{date}</span>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        {/* 종합 점수 */}
        <div className="bg-white rounded-2xl border border-stone-200 px-6 py-6">
          <h2 className="text-sm font-semibold text-stone-500 mb-4">종합 점수</h2>
          <div className="flex items-center gap-6">
            <ScoreRing score={report.overall_score} />
            <div className="flex-1 space-y-3">
              {report.strengths?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-green-700 mb-1">강점</p>
                  <ul className="space-y-0.5">
                    {report.strengths.map((s, i) => (
                      <li key={i} className="text-sm text-stone-700 flex gap-1.5">
                        <span className="text-green-500 mt-0.5">✓</span> {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {report.improvements?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-amber-700 mb-1">개선 포인트</p>
                  <ul className="space-y-0.5">
                    {report.improvements.map((s, i) => (
                      <li key={i} className="text-sm text-stone-700 flex gap-1.5">
                        <span className="text-amber-500 mt-0.5">!</span> {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
          {report.jd_coverage_summary && (
            <div className="mt-4 bg-stone-50 rounded-xl px-4 py-3">
              <p className="text-xs font-semibold text-stone-500 mb-1">JD 키워드 커버리지</p>
              <p className="text-sm text-stone-700 leading-relaxed">{report.jd_coverage_summary}</p>
            </div>
          )}
        </div>

        {/* 역량 분석 레이더 */}
        <OverallSubScores questions={report.per_question} />

        {/* 질문별 피드백 */}
        <div>
          <h2 className="text-sm font-semibold text-stone-500 mb-3">질문별 피드백</h2>
          <div className="space-y-3">
            {report.per_question.map((q, i) => (
              <QuestionCard key={i} q={q} i={i} />
            ))}
          </div>
        </div>

        {/* 대화 기록 */}
        {transcript.length > 0 && (
          <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
            <button onClick={() => setShowTranscript(v => !v)}
              className="w-full px-6 py-4 flex items-center justify-between text-left">
              <div>
                <h2 className="text-sm font-semibold text-stone-800">대화 기록</h2>
                <p className="text-xs text-stone-400 mt-0.5">면접 중 나눈 전체 대화 — {transcript.length}개 발화</p>
              </div>
              <span className="text-stone-300 shrink-0 ml-4">{showTranscript ? '▲' : '▼'}</span>
            </button>
            {showTranscript && (
              <div className="border-t border-stone-100 px-6 py-5 space-y-3 max-h-[600px] overflow-y-auto">
                {transcript.map((turn) => {
                  const isAI = turn.speaker !== '지원자' && turn.speaker !== 'candidate';
                  return (
                    <div key={turn.seq} className={`flex ${isAI ? 'justify-start' : 'justify-end'}`}>
                      {isAI && (
                        <div className="w-6 h-6 rounded-full bg-stone-500 flex items-center justify-center text-white text-xs font-bold shrink-0 mr-2 mt-1">
                          AI
                        </div>
                      )}
                      <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                        isAI ? 'bg-stone-100 text-stone-800 rounded-tl-sm' : 'bg-blue-600 text-white rounded-tr-sm'
                      }`}>
                        {(turn.turn_type === 'ask_question' || turn.turn_type === 'question') && isAI && (
                          <p className="text-xs font-semibold mb-1 text-stone-500">질문</p>
                        )}
                        {(turn.turn_type === 'followup' || turn.turn_type === 'follow_up') && isAI && (
                          <p className="text-xs font-semibold mb-1 text-stone-400">꼬리질문</p>
                        )}
                        {turn.text}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 다시 면접 */}
        <div className="text-center pb-8">
          <Link href="/session/new"
            className="inline-flex px-8 py-3 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors">
            새 면접 시작하기
          </Link>
        </div>
      </main>
    </div>
  );
}
