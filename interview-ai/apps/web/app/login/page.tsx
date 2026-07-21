'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { login, signup } from '@/lib/api';
import { saveTokens } from '@/lib/auth';

type Mode = 'login' | 'signup';
type Status = 'idle' | 'loading' | 'error';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    setError('');
    try {
      const fn = mode === 'login' ? login : signup;
      const { access_token, refresh_token } = await fn(email, password);
      saveTokens(access_token, refresh_token);
      router.push('/dashboard');
    } catch (err: unknown) {
      setStatus('error');
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    }
  };

  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-stone-200 shadow-sm p-8">
        <h1 className="text-2xl font-bold text-stone-900 mb-1">NMeeto</h1>
        <p className="text-sm text-stone-500 mb-6">AI 모의면접 서비스</p>

        <div className="flex mb-6 bg-stone-100 rounded-lg p-1">
          {(['login', 'signup'] as Mode[]).map(m => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(''); setStatus('idle'); }}
              className={`flex-1 py-1.5 text-sm rounded-md transition-colors font-medium ${
                mode === m ? 'bg-white shadow-sm text-stone-900' : 'text-stone-500'
              }`}
            >
              {m === 'login' ? '로그인' : '회원가입'}
            </button>
          ))}
        </div>

        <form onSubmit={handle} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1">이메일</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="name@example.com"
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1">비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={8}
              placeholder="8자 이상"
              className="w-full border border-stone-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {status === 'error' && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={status === 'loading'}
            className="w-full py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {status === 'loading' ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-blue-300 border-t-white rounded-full animate-spin" />
                처리 중...
              </span>
            ) : mode === 'login' ? '로그인' : '가입하기'}
          </button>
        </form>
      </div>
    </div>
  );
}
