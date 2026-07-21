'use client';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { isLoggedIn } from '@/lib/auth';
import { uploadResume, getResume, createSession, getSession } from '@/lib/api';
import type { SessionConfig } from '@/lib/api';

type Step = 'resume' | 'config' | 'planning';
type Channel = 'text' | 'video';

const COMPANIES = [
  '네이버', '카카오', '라인플러스', '쿠팡', '배달의민족', '토스', '당근마켓',
  '카카오뱅크', '카카오페이', '야놀자', '마켓컬리', '오늘의집', '무신사',
  '크래프톤', '넥슨', '엔씨소프트', '넷마블', '스마일게이트', '펄어비스',
  'SK하이닉스', '삼성전자', 'LG전자', 'SK텔레콤', 'KT', 'LG유플러스',
  '현대자동차', '기아', 'HD현대',
  'KB국민은행', '신한은행', '하나은행', '우리은행',
  '두나무', '빗썸', '업비트', '코빗',
  '뱅크샐러드', '핀다', '직방', '다방',
  '하이퍼커넥트', '클래스101', '뤼이드', '몰로코',
  '쏘카', '카카오모빌리티', '티맵모빌리티',
  '신세계', 'CJ ENM', 'JYP엔터테인먼트', 'SM엔터테인먼트', 'HYBE',
  '컬리', '에이블씨엔씨', '에이블리', '버킷플레이스', '데브시스터즈',
  '삼성바이오로직스', '셀트리온',
  'Google Korea', 'Meta Korea', 'Amazon Korea', '마이크로소프트 코리아',
  'IBM Korea', 'SAP Korea',
  'POSCO', '현대건설', 'GS건설', '한국전력',
];

const STYLE_PREVIEWS: Record<string, Record<number, string>> = {
  normal: {
    1: '워밍업 면접입니다. 친절하게 진행하며 꼬리질문이 거의 없습니다.',
    2: '표준 면접입니다. 균형 잡힌 질문과 1~2회 꼬리질문이 있습니다.',
    3: '심화 면접입니다. 깊이 있는 기술 질문과 꼬리질문이 이어집니다.',
  },
  pressure: {
    1: '가벼운 압박을 경험합니다. 가끔 근거를 묻는 반문이 있습니다.',
    2: '반박과 재질문이 섞입니다. 논리 방어를 연습하기 좋습니다.',
    3: '말이 길어지면 끊고 근거를 반복 요청합니다. 시간 압박이 있습니다.',
  },
};

function BackIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  );
}

function CompanyAutocomplete({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const filtered = query.trim().length > 0
    ? COMPANIES.filter(c => c.toLowerCase().includes(query.toLowerCase()))
    : COMPANIES;

  const select = (company: string) => {
    setQuery(company);
    onChange(company);
    setOpen(false);
  };

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  return (
    <div className="relative" ref={wrapperRef}>
      <input
        value={query}
        onChange={e => { setQuery(e.target.value); onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="예: 카카오, 쿠팡, 네이버"
        className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-20 top-full mt-1 w-full bg-white border border-stone-200 rounded-xl shadow-lg overflow-y-auto max-h-60">
          {filtered.map(c => (
            <li key={c}>
              <button
                onMouseDown={() => select(c)}
                className="w-full px-3 py-2.5 text-sm text-left text-stone-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
              >
                {c}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function NewSession() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('resume');
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [resumeStatus, setResumeStatus] = useState('');
  const [resumeFileName, setResumeFileName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [role, setRole] = useState('');
  const [jdText, setJdText] = useState('');
  const [style, setStyle] = useState<'normal' | 'pressure'>('normal');
  const [difficulty, setDifficulty] = useState<1 | 2 | 3>(2);
  const [channel, setChannel] = useState<Channel>('text');
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
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
    setResumeFileName(file.name);
    try {
      const result = await uploadResume(file);
      setResumeId(result.id);
      setResumeStatus(result.parse_status);
      if (result.parse_status === 'ok') {
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
    if (!companyName.trim() || !role.trim()) { setError('회사명과 직무를 입력하세요.'); return; }
    setCreating(true);
    setError('');
    try {
      const cfg: SessionConfig = {
        channel,
        style,
        difficulty,
        duration_min: 20,
        interview_type: 'mixed',
        language: 'ko',
      };
      const sess = await createSession({
        resume_id: resumeId ?? undefined,
        company_name: companyName.trim(),
        role: role.trim(),
        jd_text: jdText || undefined,
        config: cfg,
      });

      localStorage.setItem(`session_channel_${sess.id}`, channel);
      setStep('planning');

      const poll = setInterval(async () => {
        const s = await getSession(sess.id);
        if (s.state === 'ready') {
          clearInterval(poll);
          router.push(`/interview/${sess.id}`);
        } else if (s.state === 'failed') {
          clearInterval(poll);
          setError('질문 계획 생성에 실패했습니다. 다시 시도해 주세요.');
          setStep('config');
          setCreating(false);
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
      <header className="bg-white border-b border-stone-200 px-5 h-14 flex items-center gap-3 shrink-0">
        <button
          onClick={() => step === 'config' ? setStep('resume') : router.push('/dashboard')}
          className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-800 transition-colors"
        >
          <BackIcon />
          <span>{step === 'config' ? '이전' : '대시보드'}</span>
        </button>
        <span className="text-stone-200">|</span>
        <span className="text-sm font-semibold text-stone-800">새 면접 설정</span>

        <div className="ml-auto hidden sm:flex items-center gap-1.5 text-xs">
          {(['resume', 'config', 'planning'] as Step[]).map((s, i) => (
            <span key={s} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-stone-300">›</span>}
              <span className={step === s ? 'text-blue-600 font-medium' : 'text-stone-400'}>
                {s === 'resume' ? '이력서' : s === 'config' ? '설정' : '준비 중'}
              </span>
            </span>
          ))}
        </div>
      </header>

      <main className="flex-1 max-w-xl w-full mx-auto px-5 py-8 space-y-4">

        {/* 이력서 단계 */}
        {step === 'resume' && (
          <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-5">
            <div>
              <h2 className="text-base font-semibold text-stone-900">이력서 업로드</h2>
              <p className="text-xs text-stone-400 mt-1">이력서를 첨부하면 맞춤 질문이 생성됩니다. 선택 사항입니다.</p>
            </div>

            <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.hwp" className="hidden" onChange={handleFile} />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="w-full py-10 border-2 border-dashed border-stone-200 rounded-2xl flex flex-col items-center gap-2.5 text-stone-400 hover:border-blue-300 hover:text-blue-500 transition-colors disabled:opacity-60"
            >
              {uploading ? (
                <>
                  <div className="w-5 h-5 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin" />
                  <span className="text-sm">업로드 중...</span>
                </>
              ) : resumeId ? (
                <>
                  <svg className="w-7 h-7 text-green-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-sm font-medium text-green-600">{resumeFileName}</span>
                  <span className="text-xs">다른 파일로 교체</span>
                </>
              ) : (
                <>
                  <svg className="w-9 h-9" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="text-sm font-medium">이력서 파일을 선택하세요</span>
                  <span className="text-xs">PDF, DOCX, TXT, HWP</span>
                </>
              )}
            </button>

            {resumeStatus === 'needs_manual' && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-700">
                이력서 파싱이 어렵습니다. 면접은 계속 진행할 수 있으나 개인화 질문이 줄어들 수 있습니다.
              </div>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              onClick={() => setStep('config')}
              className="w-full py-3 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors"
            >
              다음 — 면접 설정
            </button>
            {!resumeId && (
              <p className="text-center text-xs text-stone-400">이력서 없이도 진행할 수 있습니다</p>
            )}
          </div>
        )}

        {/* 설정 단계 */}
        {step === 'config' && (
          <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-5">
            <h2 className="text-base font-semibold text-stone-900">면접 설정</h2>

            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1.5">
                회사명 <span className="text-red-400">*</span>
              </label>
              <CompanyAutocomplete value={companyName} onChange={setCompanyName} />
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1.5">
                지원 직무 <span className="text-red-400">*</span>
              </label>
              <input
                value={role}
                onChange={e => setRole(e.target.value)}
                placeholder="예: 백엔드 개발자, 프론트엔드 개발자, PM"
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1.5">
                직무기술서 (JD) <span className="font-normal text-stone-400">선택</span>
              </label>
              <textarea
                value={jdText}
                onChange={e => setJdText(e.target.value)}
                rows={3}
                placeholder="채용공고 내용을 붙여넣으면 JD 맞춤 질문이 생성됩니다"
                className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 resize-none"
              />
            </div>

            {/* 면접 형식 */}
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-2">면접 형식</label>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  onClick={() => setChannel('text')}
                  className={`py-3.5 px-4 rounded-xl border text-left transition-all ${
                    channel === 'text' ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-200' : 'border-stone-200 hover:bg-stone-50'
                  }`}
                >
                  <div className={`mb-2 ${channel === 'text' ? 'text-blue-500' : 'text-stone-400'}`}>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-4 4v-4z" />
                    </svg>
                  </div>
                  <p className={`text-sm font-medium ${channel === 'text' ? 'text-blue-700' : 'text-stone-700'}`}>텍스트 면접</p>
                  <p className="text-xs text-stone-400 mt-0.5">채팅으로 답변 입력</p>
                </button>
                <button
                  onClick={() => setChannel('video')}
                  className={`py-3.5 px-4 rounded-xl border text-left transition-all ${
                    channel === 'video' ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-200' : 'border-stone-200 hover:bg-stone-50'
                  }`}
                >
                  <div className={`mb-2 ${channel === 'video' ? 'text-blue-500' : 'text-stone-400'}`}>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.361a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <p className={`text-sm font-medium ${channel === 'video' ? 'text-blue-700' : 'text-stone-700'}`}>화상 면접</p>
                  <p className="text-xs text-stone-400 mt-0.5">카메라 켜고 진행</p>
                </button>
              </div>
              {channel === 'video' && (
                <p className="text-xs text-stone-400 mt-1.5 pl-0.5">카메라 접근 권한이 필요합니다</p>
              )}
            </div>

            {/* 면접 스타일 */}
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-2">면접 스타일</label>
              <div className="grid grid-cols-2 gap-2">
                {(['normal', 'pressure'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setStyle(s)}
                    className={`py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                      style === s ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-stone-200 text-stone-600 hover:bg-stone-50'
                    }`}
                  >
                    {s === 'normal' ? '일반 면접' : '압박 면접'}
                  </button>
                ))}
              </div>
            </div>

            {/* 난이도 */}
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-2">
                난이도
                <span className="font-normal text-stone-400 ml-1.5">
                  {difficulty === 1 ? '— 입문' : difficulty === 2 ? '— 표준' : '— 심화'}
                </span>
              </label>
              <div className="flex gap-2">
                {([1, 2, 3] as const).map(d => (
                  <button
                    key={d}
                    onClick={() => setDifficulty(d)}
                    className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                      difficulty === d ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-stone-200 text-stone-600 hover:bg-stone-50'
                    }`}
                  >
                    {d === 1 ? '입문' : d === 2 ? '표준' : '심화'}
                  </button>
                ))}
              </div>
              <p className="text-xs text-stone-400 mt-2 leading-relaxed pl-0.5">{STYLE_PREVIEWS[style]?.[difficulty]}</p>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              onClick={handleCreate}
              disabled={creating || !companyName.trim() || !role.trim()}
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
          <div className="bg-white rounded-2xl border border-stone-200 p-12 text-center space-y-5">
            <div className="w-12 h-12 border-4 border-blue-100 border-t-blue-500 rounded-full animate-spin mx-auto" />
            <div className="space-y-1.5">
              <p className="text-stone-800 font-semibold">맞춤 질문을 준비하고 있습니다</p>
              <p className="text-sm text-stone-400">회사 정보와 이력서를 분석해 질문 계획을 수립합니다</p>
              <p className="text-xs text-stone-300">보통 10~20초 소요됩니다</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
