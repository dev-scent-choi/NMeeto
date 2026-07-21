'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { isLoggedIn } from '@/lib/auth';
import { uploadResume, getResume, createSession, getSession } from '@/lib/api';
import type { SessionConfig } from '@/lib/api';

type Step = 'resume' | 'config' | 'planning';
type Channel = 'text' | 'video';

// 직무 목록 — 회사 선택 후 제안
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
      '법무', '총무', '구매·조달', '물류·SCM',
      '전략기획', '경영지원',
    ],
  },
  {
    label: '분석·연구',
    roles: [
      '데이터 분석가', '비즈니스 분석가', '컨설턴트',
      '연구원', '정책 분석가', 'BI 분석가',
    ],
  },
  {
    label: '금융',
    roles: [
      '투자 분석가', '리스크 관리', '자산운용', '펀드매니저',
      'IB(투자은행)', '컴플라이언스', '보험계리', 'PB(프라이빗 뱅킹)',
    ],
  },
  {
    label: '제조·기술',
    roles: [
      '기계공학', '전기·전자', '화학공학', '반도체 공정',
      '제조 관리', '품질 관리(QC)', '생산 기술', 'R&D 연구원',
    ],
  },
];

const ALL_ROLES = ROLE_GROUPS.flatMap(g => g.roles);

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

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
}

// 회사 검색 (DART API → 백엔드 프록시)
function CompanySearch({
  value,
  onChange,
  onSelect,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (name: string) => void;
}) {
  const [query, setQuery] = useState(value);
  const [items, setItems] = useState<{ name: string; type: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [noKey, setNoKey] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setItems([]); setNoKey(false); return; }
    setLoading(true);
    try {
      const res = await fetch(
        `${BASE}/v1/companies/search?q=${encodeURIComponent(q)}&limit=30`,
        { headers: { Authorization: `Bearer ${getToken()}` } },
      );
      const data = await res.json();
      if (data.source === 'no_key') {
        setNoKey(true);
        setItems([]);
      } else {
        setNoKey(false);
        setItems(data.items ?? []);
      }
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
          placeholder="회사명을 입력하세요"
          className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 pr-8"
        />
        {loading && (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
            <span className="w-3.5 h-3.5 border border-stone-300 border-t-stone-500 rounded-full animate-spin block" />
          </span>
        )}
      </div>

      {open && (
        <div className="absolute z-20 top-full mt-1 w-full bg-white border border-stone-200 rounded-xl shadow-lg overflow-hidden">
          {noKey && (
            <div className="px-3 py-3 text-xs text-amber-700 bg-amber-50 border-b border-amber-100">
              <p className="font-medium">DART API 키가 없습니다</p>
              <p className="mt-0.5 text-amber-600">
                <a href="https://opendart.fss.or.kr" target="_blank" rel="noreferrer" className="underline">opendart.fss.or.kr</a>에서 무료 발급 후 <code>.env</code>에 <code>DART_API_KEY=</code> 설정
              </p>
              <p className="mt-1 text-amber-600">직접 입력도 가능합니다.</p>
            </div>
          )}
          {!noKey && items.length === 0 && query.trim() && !loading && (
            <div className="px-3 py-3 text-xs text-stone-400">검색 결과 없음 — 직접 입력해도 됩니다</div>
          )}
          {items.length > 0 && (
            <ul className="overflow-y-auto max-h-64">
              {items.map(c => (
                <li key={c.name + c.type}>
                  <button
                    onMouseDown={() => select(c.name)}
                    className="w-full px-3 py-2.5 text-left hover:bg-blue-50 transition-colors flex items-baseline justify-between gap-2"
                  >
                    <span className="text-sm text-stone-800">{c.name}</span>
                    <span className="text-xs text-stone-400 shrink-0">{c.type}</span>
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

// 직무 선택 — 회사 선택 후 열림
function RoleInput({
  value,
  onChange,
  active,
}: {
  value: string;
  onChange: (v: string) => void;
  active: boolean;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const filtered = query.trim()
    ? ALL_ROLES.filter(r => r.toLowerCase().includes(query.toLowerCase()))
    : ALL_ROLES;

  const select = (r: string) => {
    setQuery(r);
    onChange(r);
    setOpen(false);
  };

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
        placeholder={active ? '직무를 선택하거나 직접 입력하세요' : '먼저 회사명을 입력하세요'}
        className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none transition-colors ${
          active
            ? 'border-blue-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100'
            : 'border-stone-200 bg-stone-50 text-stone-400 cursor-pointer'
        }`}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-20 top-full mt-1 w-full bg-white border border-stone-200 rounded-xl shadow-lg overflow-y-auto max-h-72">
          {ROLE_GROUPS.map(group => {
            const groupItems = query.trim()
              ? group.roles.filter(r => r.toLowerCase().includes(query.toLowerCase()))
              : group.roles;
            if (groupItems.length === 0) return null;
            return (
              <div key={group.label}>
                <div className="px-3 py-1.5 text-xs font-semibold text-stone-400 bg-stone-50 border-b border-stone-100">
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
                <><div className="w-5 h-5 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin" /><span className="text-sm">업로드 중...</span></>
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
            <button onClick={() => setStep('config')} className="w-full py-3 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors">
              다음 — 면접 설정
            </button>
            {!resumeId && <p className="text-center text-xs text-stone-400">이력서 없이도 진행할 수 있습니다</p>}
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
              <CompanySearch
                value={companyName}
                onChange={v => { setCompanyName(v); if (!v) setCompanySelected(false); }}
                onSelect={name => { setCompanyName(name); setCompanySelected(true); }}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1.5">
                지원 직무 <span className="text-red-400">*</span>
                {companySelected && <span className="ml-2 text-blue-500 font-normal">↓ 아래에서 선택하세요</span>}
              </label>
              <RoleInput
                value={role}
                onChange={setRole}
                active={!!companyName.trim()}
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
                <button onClick={() => setChannel('text')} className={`py-3.5 px-4 rounded-xl border text-left transition-all ${channel === 'text' ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-200' : 'border-stone-200 hover:bg-stone-50'}`}>
                  <div className={`mb-2 ${channel === 'text' ? 'text-blue-500' : 'text-stone-400'}`}>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-4 4v-4z" />
                    </svg>
                  </div>
                  <p className={`text-sm font-medium ${channel === 'text' ? 'text-blue-700' : 'text-stone-700'}`}>텍스트 면접</p>
                  <p className="text-xs text-stone-400 mt-0.5">채팅으로 답변 입력</p>
                </button>
                <button onClick={() => setChannel('video')} className={`py-3.5 px-4 rounded-xl border text-left transition-all ${channel === 'video' ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-200' : 'border-stone-200 hover:bg-stone-50'}`}>
                  <div className={`mb-2 ${channel === 'video' ? 'text-blue-500' : 'text-stone-400'}`}>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.361a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <p className={`text-sm font-medium ${channel === 'video' ? 'text-blue-700' : 'text-stone-700'}`}>화상 면접</p>
                  <p className="text-xs text-stone-400 mt-0.5">사진 + 마이크로 진행</p>
                </button>
              </div>
            </div>

            {/* 면접 스타일 */}
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-2">면접 스타일</label>
              <div className="grid grid-cols-2 gap-2">
                {(['normal', 'pressure'] as const).map(s => (
                  <button key={s} onClick={() => setStyle(s)} className={`py-2.5 rounded-xl border text-sm font-medium transition-colors ${style === s ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-stone-200 text-stone-600 hover:bg-stone-50'}`}>
                    {s === 'normal' ? '일반 면접' : '압박 면접'}
                  </button>
                ))}
              </div>
            </div>

            {/* 난이도 */}
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-2">
                난이도 <span className="font-normal text-stone-400 ml-1">{difficulty === 1 ? '— 입문' : difficulty === 2 ? '— 표준' : '— 심화'}</span>
              </label>
              <div className="flex gap-2">
                {([1, 2, 3] as const).map(d => (
                  <button key={d} onClick={() => setDifficulty(d)} className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition-colors ${difficulty === d ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-stone-200 text-stone-600 hover:bg-stone-50'}`}>
                    {d === 1 ? '입문' : d === 2 ? '표준' : '심화'}
                  </button>
                ))}
              </div>
              <p className="text-xs text-stone-400 mt-2 leading-relaxed">{STYLE_PREVIEWS[style]?.[difficulty]}</p>
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

        {/* 질문 계획 대기 */}
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
