'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { isLoggedIn } from '@/lib/auth';
import { uploadResume, getResume, createSession, getSession } from '@/lib/api';
import type { SessionConfig } from '@/lib/api';

type Step = 'resume' | 'config' | 'planning';

const STYLE_PREVIEWS: Record<string, Record<number, string>> = {
  normal: {
    1: '워밍업 면접입니다. 친절하게 진행하며 1번까지 이어서 질문합니다.',
    2: '표준적인 면접입니다. 답변을 끝까지 듣고 2번까지 이어서 질문합니다.',
    3: '심화 기술 면접입니다. 깊이 있는 질문과 꼬리질문이 이어지지만 정중함을 유지합니다.',
  },
  pressure: {
    1: '가벼운 압박을 경험합니다. 가끔 근거를 물어보는 반문이 있습니다.',
    2: '반박과 재질문이 섞입니다. 논리 방어를 연습하기 좋습니다.',
    3: '답변이 길어지면 말을 끊고, 근거를 반복해서 되묻습니다. 시간 압박이 있습니다.',
  },
};

export default function NewSession() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('resume');
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [resumeStatus, setResumeStatus] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [role, setRole] = useState('');
  const [jdText, setJdText] = useState('');
  const [style, setStyle] = useState<'normal' | 'pressure'>('normal');
  const [difficulty, setDifficulty] = useState<1 | 2 | 3>(2);
  const [durationMin, setDurationMin] = useState(20);
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isLoggedIn()) router.push('/login');
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [router]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const result = await uploadResume(file);
      setResumeId(result.id);
      setResumeStatus(result.parse_status);
      if (result.parse_status === 'ok') {
        // 요약 완료 대기
        const poll = setInterval(async () => {
          const status = await getResume(result.id);
          if (status.parse_status === 'ok' && status.summary) {
            setResumeStatus('ok');
            clearInterval(poll);
          }
        }, 2000);
        pollRef.current = poll;
        setTimeout(() => clearInterval(poll), 30000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '업로드 실패');
    } finally {
      setUploading(false);
    }
  };

  const handleCreate = async () => {
    if (!companyName || !role) { setError('회사명과 직무를 입력하세요.'); return; }
    setCreating(true);
    setError('');
    try {
      const cfg: SessionConfig = {
        channel: 'text', style, difficulty,
        duration_min: durationMin, interview_type: 'mixed', language: 'ko',
        company_name: companyName,
      } as SessionConfig & { company_name: string };
      const sess = await createSession({
        resume_id: resumeId ?? undefined,
        company_name: companyName,
        role,
        jd_text: jdText || undefined,
        config: cfg,
      });
      setSessionId(sess.id);
      setStep('planning');

      // 질문 계획 완료 대기
      const poll = setInterval(async () => {
        const s = await getSession(sess.id);
        if (s.state === 'ready') {
          clearInterval(poll);
          router.push(`/interview/${sess.id}`);
        } else if (s.state === 'failed') {
          clearInterval(poll);
          setError('질문 계획 생성에 실패했습니다. 다시 시도해 주세요.');
          setStep('config');
        }
      }, 2000);
      pollRef.current = poll;
    } catch (err) {
      setError(err instanceof Error ? err.message : '세션 생성 실패');
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      <header className="bg-white border-b border-stone-200 px-6 h-14 flex items-center">
        <button onClick={() => router.push('/dashboard')} className="text-sm text-stone-500 hover:text-stone-800 mr-4">
          ← 대시보드
        </button>
        <span className="text-sm font-semibold text-stone-800">새 면접 설정</span>
      </header>

      <main className="flex-1 max-w-xl w-full mx-auto px-6 py-10 space-y-6">

        {/* 이력서 단계 */}
        {step === 'resume' && (
          <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
            <h2 className="text-base font-semibold text-stone-900">이력서 업로드</h2>
            <p className="text-sm text-stone-500">PDF, DOCX, TXT (최대 10MB) · 선택 사항</p>

            <input ref={fileRef} type="file" accept=".pdf,.docx,.txt" className="hidden" onChange={handleFile} />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="w-full py-8 border-2 border-dashed border-stone-200 rounded-xl text-stone-500 hover:border-blue-300 hover:text-blue-600 text-sm transition-colors"
            >
              {uploading ? '업로드 중...' : resumeId ? '✓ 이력서 업로드 완료' : '클릭하여 이력서 선택'}
            </button>

            {resumeStatus === 'needs_manual' && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-700">
                이력서 파싱이 어렵습니다. 면접은 계속 진행할 수 있으나 개인화 질문이 줄어들 수 있습니다.
              </div>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              onClick={() => setStep('config')}
              className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors"
            >
              다음 — 면접 설정
            </button>
          </div>
        )}

        {/* 설정 단계 */}
        {step === 'config' && (
          <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-5">
            <h2 className="text-base font-semibold text-stone-900">면접 설정</h2>

            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">회사명 *</label>
              <input value={companyName} onChange={e => setCompanyName(e.target.value)}
                placeholder="예: 카카오, 쿠팡, 네이버"
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">지원 직무 *</label>
              <input value={role} onChange={e => setRole(e.target.value)}
                placeholder="예: 백엔드 개발자, PM, 마케터"
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1">직무기술서 (JD) <span className="font-normal text-stone-400">선택</span></label>
              <textarea value={jdText} onChange={e => setJdText(e.target.value)}
                rows={4} placeholder="채용공고 내용을 붙여넣으세요"
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 resize-none" />
            </div>

            {/* 면접 스타일 */}
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-2">면접 스타일</label>
              <div className="grid grid-cols-2 gap-2">
                {(['normal', 'pressure'] as const).map(s => (
                  <button key={s} onClick={() => setStyle(s)}
                    className={`py-3 rounded-xl border text-sm font-medium transition-colors ${
                      style === s ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-stone-200 text-stone-600 hover:bg-stone-50'
                    }`}>
                    {s === 'normal' ? '일반 면접' : '압박 면접'}
                  </button>
                ))}
              </div>
            </div>

            {/* 난이도 */}
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-2">
                난이도 <span className="font-normal text-stone-400">· {difficulty}단계</span>
              </label>
              <div className="flex gap-2">
                {([1, 2, 3] as const).map(d => (
                  <button key={d} onClick={() => setDifficulty(d)}
                    className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      difficulty === d ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-stone-200 text-stone-600'
                    }`}>
                    {d === 1 ? '입문' : d === 2 ? '표준' : '심화'}
                  </button>
                ))}
              </div>
              <p className="text-xs text-stone-400 mt-2 leading-relaxed">
                {STYLE_PREVIEWS[style]?.[difficulty]}
              </p>
            </div>

            {/* 시간 */}
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-2">면접 시간</label>
              <div className="flex gap-2">
                {[10, 20, 30].map(m => (
                  <button key={m} onClick={() => setDurationMin(m)}
                    className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      durationMin === m ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-stone-200 text-stone-600'
                    }`}>
                    {m}분
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              onClick={handleCreate}
              disabled={creating || !companyName || !role}
              className="w-full py-3 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {creating ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-blue-300 border-t-white rounded-full animate-spin" />
                  질문 계획 생성 중...
                </span>
              ) : '면접 시작하기'}
            </button>
          </div>
        )}

        {/* 질문 계획 생성 대기 */}
        {step === 'planning' && (
          <div className="bg-white rounded-2xl border border-stone-200 p-10 text-center space-y-4">
            <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto" />
            <p className="text-stone-800 font-medium">맞춤 질문을 준비하고 있습니다</p>
            <p className="text-sm text-stone-400">회사 정보와 이력서를 분석해 질문 계획을 수립합니다 (10~20초)</p>
          </div>
        )}
      </main>
    </div>
  );
}
