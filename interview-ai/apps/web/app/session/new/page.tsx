'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { isLoggedIn } from '@/lib/auth';
import { uploadResume, getResume, createSession, getSession } from '@/lib/api';
import type { SessionConfig } from '@/lib/api';
import AppShell from '@/components/AppShell';

type Step = 'resume' | 'config' | 'planning';
type Channel = 'text' | 'video';

const ROLE_GROUPS: { label: string; roles: string[] }[] = [
  {
    label: '개발',
    roles: [
      '백엔드 개발자', '프론트엔드 개발자', '풀스택 개발자',
      'iOS 개발자', 'Android 개발자', '모바일 개발자',
      '데이터 엔지니어', 'ML/AI 엔지니어', 'DevOps 엔지니어',
      '보안 엔지니어', 'QA 엔지니어', '임베디드 개발자',
      '클라우드 아키텍트', 'DBA', '블록체인 개발자',
    ],
  },
  {
    label: '기획·디자인',
    roles: [
      'PM(프로덕트 매니저)', '서비스 기획자', '프로젝트 매니저',
      'UX 디자이너', 'UI 디자이너', 'UX 리서처',
      '그래픽 디자이너', '브랜드 디자이너', '영상 편집자',
    ],
  },
  {
    label: '마케팅·영업',
    roles: [
      '퍼포먼스 마케터', '콘텐츠 마케터', 'CRM 마케터',
      '그로스 마케터', 'SNS 마케터', '브랜드 마케터',
      '영업(B2B)', '영업(B2C)', '사업개발(BD)', '파트너십 매니저',
      '기술영업', 'CS(고객 성공)',
    ],
  },
  {
    label: '경영·지원',
    roles: [
      '재무', '회계', '세무', '인사(HR)', 'IR(투자자 관계)',
      '법무', '총무', '구매·조달', '물류·SCM', '전략기획', '경영지원',
    ],
  },
  {
    label: '분석·연구',
    roles: ['데이터 분석가', '비즈니스 분석가', '컨설턴트', '연구원', '정책 분석가', 'BI 분석가'],
  },
  {
    label: '금융',
    roles: ['투자 분석가', '리스크 관리', '자산운용', '펀드매니저', 'IB(투자은행)', '컴플라이언스', '보험계리', 'PB(프라이빗 뱅킹)'],
  },
  {
    label: '제조·기술',
    roles: ['기계공학', '전기·전자', '화학공학', '반도체 공정', '제조 관리', '품질 관리(QC)', '생산 기술', 'R&D 연구원'],
  },
];

const ALL_ROLES = ROLE_GROUPS.flatMap(g => g.roles);

const STYLE_PREVIEWS: Record<string, Record<number, string>> = {
  normal: {
    1: '친절하고 편안한 분위기. 꼬리질문이 거의 없습니다.',
    2: '균형 잡힌 표준 면접. 1~2회 꼬리질문이 있습니다.',
    3: '깊이 있는 기술 질문과 꼬리질문이 이어집니다.',
  },
  pressure: {
    1: '가끔 근거를 묻는 반문이 있습니다.',
    2: '반박과 재질문이 섞입니다. 논리 방어 연습에 좋습니다.',
    3: '시간 압박과 반복 반문. 고강도 압박 면접입니다.',
  },
};

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

// 회사 검색
function CompanySearch({
  value, onChange, onSelect,
}: { value: string; onChange: (v: string) => void; onSelect: (name: string) => void }) {
  const [query, setQuery] = useState(value);
  const [items, setItems] = useState<{ name: string; type: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setItems([]); return; }
    setLoading(true);
    try {
      const res = await fetch(
        `${BASE}/v1/companies/search?q=${encodeURIComponent(q)}&limit=30`,
        { headers: { Authorization: `Bearer ${getToken()}` } },
      );
      const data = await res.json();
      setItems(data.items ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (v: string) => {
    setQuery(v);
    onChange(v);
    setOpen(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => search(v), 300);
  };

  const select = (name: string) => {
    setQuery(name);
    onChange(name);
    onSelect(name);
    setOpen(false);
  };

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  return (
    <div className="relative" ref={wrapperRef}>
      <div className="relative">
        <input
          value={query}
          onChange={e => handleChange(e.target.value)}
          onFocus={() => { setOpen(true); if (query.trim()) search(query); }}
          placeholder="회사명을 검색하세요"
          className="w-full border border-stone-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 pr-9 bg-white"
        />
        {loading ? (
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            <span className="w-3.5 h-3.5 border border-stone-300 border-t-stone-500 rounded-full animate-spin block" />
          </span>
        ) : (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-300">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </span>
        )}
      </div>

      {open && query.trim() && (
        <div className="absolute z-20 top-full mt-1.5 w-full bg-white border border-stone-200 rounded-xl shadow-xl overflow-hidden">
          {items.length === 0 && !loading && (
            <div className="px-4 py-4 text-sm text-stone-400 text-center">
              <p>검색 결과 없음</p>
              <p className="text-xs mt-0.5 text-stone-300">회사명을 직접 입력해도 됩니다</p>
            </div>
          )}
          {items.length > 0 && (
            <ul className="overflow-y-auto max-h-64 py-1">
              {items.map(c => (
                <li key={c.name + c.type}>
                  <button
                    onMouseDown={() => select(c.name)}
                    className="w-full px-4 py-2.5 text-left hover:bg-blue-50 transition-colors flex items-center justify-between gap-3"
                  >
                    <span className="text-sm text-stone-800 font-medium">{c.name}</span>
                    <span className="text-xs text-stone-400 shrink-0 bg-stone-100 px-2 py-0.5 rounded-full">{c.type}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// 직무 선택
function RoleInput({ value, onChange, active }: { value: string; onChange: (v: string) => void; active: boolean }) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const filtered = query.trim() ? ALL_ROLES.filter(r => r.toLowerCase().includes(query.toLowerCase())) : ALL_ROLES;

  const select = (r: string) => { setQuery(r); onChange(r); setOpen(false); };

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  useEffect(() => {
    if (active && !open) setOpen(true);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative" ref={wrapperRef}>
      <input
        value={query}
        onChange={e => { setQuery(e.target.value); onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={active ? '직무를 선택하거나 직접 입력' : '먼저 회사명을 입력하세요'}
        className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none transition-colors bg-white ${
          active
            ? 'border-stone-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100'
            : 'border-stone-200 bg-stone-50 text-stone-400 cursor-not-allowed'
        }`}
        disabled={!active}
      />
      {open && filtered.length > 0 && active && (
        <div className="absolute z-20 top-full mt-1.5 w-full bg-white border border-stone-200 rounded-xl shadow-xl overflow-y-auto max-h-72 py-1">
          {ROLE_GROUPS.map(group => {
            const groupItems = query.trim()
              ? group.roles.filter(r => r.toLowerCase().includes(query.toLowerCase()))
              : group.roles;
            if (groupItems.length === 0) return null;
            return (
              <div key={group.label}>
                <div className="px-4 py-1.5 text-[10px] font-semibold text-stone-400 uppercase tracking-wider bg-stone-50/80">
                  {group.label}
                </div>
                {groupItems.map(r => (
                  <button
                    key={r}
                    onMouseDown={() => select(r)}
                    className="w-full px-4 py-2 text-sm text-left text-stone-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                  >
                    {r}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
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
  const [companySelected, setCompanySelected] = useState(false);
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
      if (result.parse_status !== 'ok') {
        const poll = setInterval(async () => {
          const status = await getResume(result.id);
          if (status.parse_status === 'ok') {
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
      const cfg: SessionConfig = { channel, style, difficulty, duration_min: 20, interview_type: 'mixed', language: 'ko' };
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

  // 스텝 표시
  const steps: { key: Step; label: string }[] = [
    { key: 'resume', label: '이력서' },
    { key: 'config', label: '면접 설정' },
    { key: 'planning', label: '준비 중' },
  ];

  return (
    <AppShell>
      <div className="flex-1 px-10 py-8 max-w-5xl w-full">
        {/* 페이지 헤더 + 스텝 */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-stone-900">새 면접 시작</h1>
            <p className="text-sm text-stone-400 mt-0.5">설정을 완료하면 AI가 맞춤 질문을 생성합니다</p>
          </div>
          <div className="flex items-center gap-2">
            {steps.map((s, i) => (
              <div key={s.key} className="flex items-center gap-2">
                {i > 0 && <div className="w-8 h-px bg-stone-200" />}
                <div className={`flex items-center gap-1.5 text-xs font-medium ${
                  step === s.key ? 'text-blue-600' : steps.indexOf(steps.find(x => x.key === step)!) > i ? 'text-stone-400' : 'text-stone-300'
                }`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    step === s.key ? 'bg-blue-600 text-white' :
                    steps.indexOf(steps.find(x => x.key === step)!) > i ? 'bg-stone-300 text-white' : 'border border-stone-200 text-stone-300'
                  }`}>{i + 1}</span>
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 이력서 단계 */}
        {step === 'resume' && (
          <div className="grid grid-cols-[1fr_300px] gap-6 items-start">
            <div className="bg-white rounded-2xl border border-stone-200 p-7 space-y-6">
              <div>
                <h2 className="text-base font-semibold text-stone-900">이력서 업로드</h2>
                <p className="text-sm text-stone-400 mt-1">이력서를 첨부하면 경험 기반 맞춤 질문이 생성됩니다.</p>
              </div>
              <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.hwp" className="hidden" onChange={handleFile} />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="w-full py-12 border-2 border-dashed border-stone-200 rounded-2xl flex flex-col items-center gap-3 text-stone-400 hover:border-blue-300 hover:text-blue-500 hover:bg-blue-50/30 transition-all disabled:opacity-60"
              >
                {uploading ? (
                  <><div className="w-6 h-6 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin" /><span className="text-sm">업로드 중...</span></>
                ) : resumeId ? (
                  <>
                    <svg className="w-8 h-8 text-emerald-500" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-sm font-medium text-emerald-600">{resumeFileName}</span>
                    <span className="text-xs text-stone-400">클릭하여 파일 교체</span>
                  </>
                ) : (
                  <>
                    <svg className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth={1.2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <div className="text-center">
                      <p className="text-sm font-medium">이력서 파일을 선택하세요</p>
                      <p className="text-xs text-stone-300 mt-0.5">PDF, DOCX, TXT, HWP 지원</p>
                    </div>
                  </>
                )}
              </button>

              {resumeStatus === 'needs_manual' && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-700">
                  이력서 파싱이 어렵습니다. 면접은 계속 진행되지만 개인화 질문이 줄어들 수 있습니다.
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
                <button
                  onClick={() => setStep('config')}
                  className="w-full text-center text-xs text-stone-400 hover:text-stone-600 transition-colors"
                >
                  이력서 없이 계속하기
                </button>
              )}
            </div>

            {/* 사이드 가이드 */}
            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-6 space-y-4">
              <h3 className="text-sm font-semibold text-blue-900">이력서를 올리면 좋은 점</h3>
              <ul className="space-y-3">
                {[
                  '경험 기반 맞춤 질문 생성',
                  '직무 경력에 맞는 난이도 자동 조정',
                  'JD와 이력서 교차 분석으로 더 정확한 피드백',
                  'STAR 구조 기반 모범 답변 제공',
                ].map(t => (
                  <li key={t} className="flex items-start gap-2.5 text-sm text-blue-700">
                    <svg className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* 설정 단계 — 2컬럼 */}
        {step === 'config' && (
          <div className="grid grid-cols-[1fr_280px] gap-6 items-start">
            {/* 왼쪽: 기본 정보 */}
            <div className="space-y-5">
              <div className="bg-white rounded-2xl border border-stone-200 p-7 space-y-5">
                <h2 className="text-base font-semibold text-stone-900">기본 정보</h2>

                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1.5">
                    회사명 <span className="text-red-400">*</span>
                  </label>
                  <CompanySearch
                    value={companyName}
                    onChange={v => { setCompanyName(v); if (!v) setCompanySelected(false); }}
                    onSelect={name => { setCompanyName(name); setCompanySelected(true); }}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1.5">
                    지원 직무 <span className="text-red-400">*</span>
                    {companySelected && <span className="ml-2 text-blue-500 font-normal text-[11px]">↓ 아래에서 선택하세요</span>}
                  </label>
                  <RoleInput value={role} onChange={setRole} active={!!companyName.trim()} />
                </div>

                <div>
                  <label className="block text-xs font-medium text-stone-500 mb-1.5">
                    직무기술서 (JD) <span className="font-normal text-stone-300">— 선택</span>
                  </label>
                  <textarea
                    value={jdText}
                    onChange={e => setJdText(e.target.value)}
                    rows={4}
                    placeholder="채용공고 내용을 붙여넣으면 JD 맞춤 질문이 생성됩니다"
                    className="w-full border border-stone-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 resize-none bg-white"
                  />
                </div>
              </div>

              {/* 면접 형식 */}
              <div className="bg-white rounded-2xl border border-stone-200 p-7 space-y-4">
                <h2 className="text-base font-semibold text-stone-900">면접 형식</h2>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { key: 'text' as Channel, title: '텍스트 면접', desc: '채팅으로 답변 입력', icon: (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-4 4v-4z" />
                      </svg>
                    )},
                    { key: 'video' as Channel, title: '화상 면접', desc: '사진 + 마이크로 진행', icon: (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.361a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )},
                  ] as const).map(({ key, title, desc, icon }) => (
                    <button
                      key={key}
                      onClick={() => setChannel(key)}
                      className={`p-4 rounded-xl border text-left transition-all ${
                        channel === key
                          ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-200'
                          : 'border-stone-200 hover:border-stone-300 hover:bg-stone-50'
                      }`}
                    >
                      <div className={`mb-2.5 ${channel === key ? 'text-blue-500' : 'text-stone-400'}`}>{icon}</div>
                      <p className={`text-sm font-semibold ${channel === key ? 'text-blue-700' : 'text-stone-700'}`}>{title}</p>
                      <p className="text-xs text-stone-400 mt-0.5">{desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</p>}

              <button
                onClick={handleCreate}
                disabled={creating || !companyName.trim() || !role.trim()}
                className="w-full py-3.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
              >
                {creating ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-blue-300 border-t-white rounded-full animate-spin" />
                    질문 계획 생성 중...
                  </span>
                ) : '면접 시작하기'}
              </button>
            </div>

            {/* 오른쪽: 스타일 / 난이도 설정 */}
            <div className="space-y-5">
              <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-5">
                <h3 className="text-sm font-semibold text-stone-900">면접 스타일</h3>
                <div className="space-y-2">
                  {([
                    { key: 'normal', label: '일반 면접', desc: '표준적인 면접 분위기' },
                    { key: 'pressure', label: '압박 면접', desc: '논리·순발력 강화 훈련' },
                  ] as const).map(({ key, label, desc }) => (
                    <button
                      key={key}
                      onClick={() => setStyle(key)}
                      className={`w-full px-4 py-3 rounded-xl border text-left transition-all ${
                        style === key ? 'border-blue-400 bg-blue-50' : 'border-stone-200 hover:bg-stone-50'
                      }`}
                    >
                      <p className={`text-sm font-medium ${style === key ? 'text-blue-700' : 'text-stone-700'}`}>{label}</p>
                      <p className="text-xs text-stone-400 mt-0.5">{desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-stone-200 p-6 space-y-4">
                <h3 className="text-sm font-semibold text-stone-900">
                  난이도
                  <span className="ml-2 font-normal text-stone-400">
                    {difficulty === 1 ? '입문' : difficulty === 2 ? '표준' : '심화'}
                  </span>
                </h3>
                <div className="flex gap-2">
                  {([1, 2, 3] as const).map(d => (
                    <button
                      key={d}
                      onClick={() => setDifficulty(d)}
                      className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                        difficulty === d ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-stone-200 text-stone-600 hover:bg-stone-50'
                      }`}
                    >
                      {d === 1 ? 'Lv.1' : d === 2 ? 'Lv.2' : 'Lv.3'}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-stone-400 leading-relaxed">{STYLE_PREVIEWS[style]?.[difficulty]}</p>
              </div>

              <button
                onClick={() => setStep('resume')}
                className="w-full text-center text-xs text-stone-400 hover:text-stone-600 transition-colors py-2"
              >
                ← 이력서 단계로 돌아가기
              </button>
            </div>
          </div>
        )}

        {/* 질문 계획 대기 */}
        {step === 'planning' && (
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="bg-white rounded-2xl border border-stone-200 p-16 text-center space-y-6 max-w-md w-full">
              <div className="relative mx-auto w-16 h-16">
                <div className="w-16 h-16 border-4 border-blue-100 border-t-blue-500 rounded-full animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-stone-800 font-semibold text-lg">맞춤 질문을 준비하고 있습니다</p>
                <p className="text-sm text-stone-400">회사 정보와 이력서를 분석해<br />질문 계획을 수립합니다</p>
                <p className="text-xs text-stone-300 mt-1">보통 10~20초 소요됩니다</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
