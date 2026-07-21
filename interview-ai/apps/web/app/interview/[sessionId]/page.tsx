'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { isLoggedIn } from '@/lib/auth';
import { startSession, endSession } from '@/lib/api';

type WsState = 'connecting' | 'ready' | 'thinking' | 'speaking' | 'listening' | 'paused' | 'completed' | 'error';

interface Turn {
  speaker: 'interviewer' | 'candidate' | 'system';
  text: string;
  type: string;
}

interface Progress {
  q_index: number;
  total: number;
  remaining_sec: number;
}

function formatSec(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function BackIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  );
}

/* ──────────────────────────────────────────────────────────────
   AI 면접관 아바타
────────────────────────────────────────────────────────────── */
function AIAvatar({ wsState, name }: { wsState: WsState; name: string }) {
  const isSpeaking = wsState === 'speaking';
  const isThinking = wsState === 'thinking';

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        {isSpeaking && (
          <span className="absolute inset-0 rounded-full bg-blue-400 opacity-25 animate-ping" style={{ animationDuration: '1.2s' }} />
        )}
        <div className={`relative w-28 h-28 rounded-full overflow-hidden border-4 shadow-xl transition-all duration-300 ${
          isSpeaking ? 'border-blue-400' : 'border-stone-600'
        }`}>
          <div className="absolute inset-0 bg-gradient-to-b from-stone-600 to-stone-800" />
          <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full">
            <circle cx="50" cy="42" r="28" fill="#FBBF9A" />
            <ellipse cx="50" cy="18" rx="28" ry="14" fill="#374151" />
            <rect x="22" y="18" width="56" height="10" fill="#374151" />
            <ellipse cx="38" cy="40" rx="4" ry="4.5" fill="white" />
            <ellipse cx="62" cy="40" rx="4" ry="4.5" fill="white" />
            <circle cx="39" cy="41" r="2.5" fill="#1e293b" />
            <circle cx="63" cy="41" r="2.5" fill="#1e293b" />
            <circle cx="39.8" cy="39.5" r="0.8" fill="white" />
            <circle cx="63.8" cy="39.5" r="0.8" fill="white" />
            <path d="M33 34 Q38 31 43 34" stroke="#374151" strokeWidth="1.8" fill="none" strokeLinecap="round" />
            <path d="M57 34 Q62 31 67 34" stroke="#374151" strokeWidth="1.8" fill="none" strokeLinecap="round" />
            <path d="M48 46 Q50 50 52 46" stroke="#d4906a" strokeWidth="1.2" fill="none" strokeLinecap="round" />
            {isSpeaking ? (
              <>
                <ellipse cx="50" cy="57" rx="7" ry="4" fill="#c0392b" />
                <ellipse cx="50" cy="56" rx="5" ry="2.5" fill="white" />
              </>
            ) : isThinking ? (
              <path d="M43 56 Q50 55 57 56" stroke="#c0392b" strokeWidth="2" fill="none" strokeLinecap="round" />
            ) : (
              <path d="M43 56 Q50 60 57 56" stroke="#c0392b" strokeWidth="2" fill="none" strokeLinecap="round" />
            )}
            <ellipse cx="22" cy="44" rx="4" ry="5" fill="#FBBF9A" />
            <ellipse cx="78" cy="44" rx="4" ry="5" fill="#FBBF9A" />
            <rect x="34" y="68" width="32" height="32" rx="4" fill="#1e3a5f" />
            <path d="M50 68 L44 80 L50 76 L56 80 Z" fill="white" />
          </svg>
        </div>
      </div>

      {isSpeaking && (
        <div className="flex items-center gap-0.5 h-7">
          {[3,7,11,14,10,13,8,11,6,9,4,8,12,5,8].map((h, i) => (
            <span key={i} className="w-1 bg-blue-400 rounded-full"
              style={{ height: `${h}px`, animation: 'waveBar 0.5s ease-in-out infinite alternate', animationDelay: `${i * 0.05}s` }} />
          ))}
        </div>
      )}
      {isThinking && (
        <div className="flex gap-1.5">
          {[0, 0.15, 0.3].map((d, i) => (
            <span key={i} className="w-2 h-2 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: `${d}s` }} />
          ))}
        </div>
      )}
      <style>{`
        @keyframes waveBar { from { transform: scaleY(0.4); } to { transform: scaleY(1.2); } }
        @keyframes jawOpen { 0%,100% { transform: scaleY(1); } 50% { transform: scaleY(1.12); } }
        @keyframes headBob  { 0%,100% { transform: translateY(0px); } 50% { transform: translateY(-3px); } }
        @keyframes blink    { 0%,90%,100% { transform: scaleY(1); } 95% { transform: scaleY(0.1); } }
      `}</style>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   사용자 아바타 — 본인 사진 업로드 or 기본 실루엣
   isTalking=true 이면 입 벌리기 + 고개 움직임 CSS 애니메이션
────────────────────────────────────────────────────────────── */
function UserAvatar({ isTalking, photoUrl, onPhotoChange }: {
  isTalking: boolean;
  photoUrl: string | null;
  onPhotoChange: (url: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const url = ev.target?.result as string;
      onPhotoChange(url);
      localStorage.setItem('user_avatar', url);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="w-full h-full relative group">
      <div className={`w-full h-full rounded-xl overflow-hidden ${isTalking ? 'shadow-[0_0_0_3px_#4ade80]' : ''}`}
        style={{ animation: isTalking ? 'headBob 0.4s ease-in-out infinite' : 'none' }}>

        {photoUrl ? (
          <img src={photoUrl} alt="나" className="w-full h-full object-cover object-top" />
        ) : (
          /* 사진 없음 — 업로드 유도 */
          <div className="w-full h-full bg-stone-800 flex flex-col items-center justify-center gap-3 text-stone-400">
            <svg className="w-10 h-10 opacity-50" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <circle cx="12" cy="13" r="3" />
            </svg>
            <p className="text-xs text-center px-2 leading-relaxed">사진을 업로드하면<br/>화상 면접이 더 실감납니다</p>
          </div>
        )}
      </div>

      {/* 말하는 중 표시 */}
      {isTalking && (
        <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/60 px-2 py-0.5 rounded-full">
          <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
          <span className="text-xs text-green-300">답변 중</span>
        </div>
      )}

      {/* 사진 변경 버튼 (호버 시 표시) */}
      <button
        onClick={() => fileRef.current?.click()}
        className="absolute bottom-2 right-2 bg-black/60 hover:bg-black/80 text-white text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1"
        title="사진 변경"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
          <circle cx="12" cy="13" r="3" />
        </svg>
        사진
      </button>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />

      <div className="absolute bottom-2 left-0 right-0 flex justify-center pointer-events-none">
        <span className="text-xs text-white/70 bg-black/50 px-2 py-0.5 rounded-full">나</span>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   마이크 버튼 — Web Speech API (STT, ko-KR)
────────────────────────────────────────────────────────────── */

// Web Speech API 타입 선언 (브라우저 내장, TypeScript 기본 lib에 없음)
interface ISpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: ISpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}
interface ISpeechRecognitionEvent {
  results: ISpeechRecognitionResultList;
}
interface ISpeechRecognitionResultList {
  length: number;
  [index: number]: ISpeechRecognitionResult;
}
interface ISpeechRecognitionResult {
  0: { transcript: string };
}
type SpeechRecognitionCtor = new () => ISpeechRecognition;

function MicButton({ onTranscript, disabled }: { onTranscript: (text: string) => void; disabled: boolean }) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const recogRef = useRef<ISpeechRecognition | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) { setSupported(false); return; }

    const r = new SR();
    r.lang = 'ko-KR';
    r.continuous = false;
    r.interimResults = true;
    r.onresult = (e: ISpeechRecognitionEvent) => {
      const t = Array.from({ length: e.results.length }, (_, i) => e.results[i][0].transcript).join('');
      onTranscript(t);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recogRef.current = r;
  }, [onTranscript]);

  if (!supported) return null;

  const toggle = () => {
    if (listening) {
      recogRef.current?.stop();
      setListening(false);
    } else {
      recogRef.current?.start();
      setListening(true);
    }
  };

  return (
    <button
      onClick={toggle}
      disabled={disabled}
      title={listening ? '녹음 중지' : '마이크로 답변 입력 (한국어)'}
      className={`shrink-0 w-11 h-11 rounded-xl flex items-center justify-center transition-all ${
        listening
          ? 'bg-red-500 text-white shadow-lg shadow-red-200 animate-pulse'
          : disabled
            ? 'bg-stone-100 text-stone-300 cursor-not-allowed'
            : 'bg-stone-100 text-stone-500 hover:bg-blue-50 hover:text-blue-600'
      }`}
    >
      {listening ? (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      ) : (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
        </svg>
      )}
    </button>
  );
}

/* ──────────────────────────────────────────────────────────────
   메인 페이지
────────────────────────────────────────────────────────────── */
export default function InterviewPage() {
  const router = useRouter();
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;

  const [wsState, setWsState] = useState<WsState>('connecting');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [currentText, setCurrentText] = useState('');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [thinkingReason, setThinkingReason] = useState('');
  const [interviewers, setInterviewers] = useState<Array<{ name: string; title: string }>>([]);
  const [error, setError] = useState('');
  const [paused, setPaused] = useState(false);
  const [answer, setAnswer] = useState('');
  const [isVideo, setIsVideo] = useState(false);
  const [isTalking, setIsTalking] = useState(false);
  const [userPhotoUrl, setUserPhotoUrl] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const talkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isLoggedIn()) { router.push('/login'); return; }
    const ch = localStorage.getItem(`session_channel_${sessionId}`);
    setIsVideo(ch === 'video');
    const saved = localStorage.getItem('user_avatar');
    if (saved) setUserPhotoUrl(saved);
  }, [sessionId, router]);

  useEffect(() => {
    if (!isLoggedIn()) return;
    let ws: WebSocket;
    let cancelled = false;
    const connect = async () => {
      try {
        const { ws_url } = await startSession(sessionId);
        if (cancelled) return;
        ws = new WebSocket(ws_url);
        wsRef.current = ws;
        ws.onopen = () => setWsState('ready');
        ws.onerror = () => setWsState('error');
        ws.onclose = (e) => { if (e.code !== 1000) setWsState('error'); };
        ws.onmessage = (event) => handleMessage(JSON.parse(event.data));
      } catch (err) {
        if (!cancelled) { setError(err instanceof Error ? err.message : '연결 실패'); setWsState('error'); }
      }
    };
    connect();
    return () => { cancelled = true; ws?.close(1000, 'unmount'); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const handleMessage = useCallback((msg: { type: string; data: Record<string, unknown> }) => {
    const { type, data } = msg;
    switch (type) {
      case 'session.ready':
        setWsState('thinking');
        setInterviewers((data.interviewers as Array<{ name: string; title: string }>) ?? []);
        break;
      case 'state.thinking':  setWsState('thinking'); setThinkingReason(String(data.reason ?? '')); break;
      case 'interviewer.speaking_start': setWsState('speaking'); setCurrentText(''); break;
      case 'interviewer.text_delta': setCurrentText(prev => prev + String(data.delta ?? '')); break;
      case 'interviewer.speaking_end': {
        const text = String(data.full_text ?? '');
        setTurns(prev => [...prev, { speaker: 'interviewer', text, type: String(data.turn_type ?? 'question') }]);
        setCurrentText('');
        setWsState('listening');
        break;
      }
      case 'state.progress':
        setProgress({ q_index: Number(data.q_index ?? 0), total: Number(data.total ?? 0), remaining_sec: Number(data.remaining_sec ?? 0) });
        break;
      case 'hint.text': {
        const text = String(data.text ?? '');
        if (text) {
          setHint(text);
          if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
          hintTimerRef.current = setTimeout(() => setHint(null), 8000);
        }
        break;
      }
      case 'session.paused':  setPaused(true); setWsState('paused'); break;
      case 'session.completed': setWsState('completed'); setTimeout(() => router.push(`/report/${sessionId}`), 2000); break;
      case 'error': setError(String(data.message ?? '오류가 발생했습니다.')); setWsState('error'); break;
      default: break;
    }
  }, [sessionId, router]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, currentText]);

  const send = (type: string, data: Record<string, unknown> = {}) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, seq: seq.current++, data }));
    }
  };

  const submitAnswer = () => {
    if (!answer.trim() || wsState !== 'listening') return;
    setTurns(prev => [...prev, { speaker: 'candidate', text: answer.trim(), type: 'answer' }]);
    send('text.answer', { text: answer.trim() });
    setAnswer('');
    setWsState('thinking');
    // 아바타 "말하는 중" 애니메이션 — 글자 수 기준 시간
    const duration = Math.max(1500, answer.trim().length * 60);
    setIsTalking(true);
    if (talkTimerRef.current) clearTimeout(talkTimerRef.current);
    talkTimerRef.current = setTimeout(() => setIsTalking(false), duration);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitAnswer(); }
  };

  const handleEnd = async () => { send('control.end'); await endSession(sessionId).catch(() => {}); };
  const togglePause = () => {
    if (paused) { send('control.resume'); setPaused(false); setWsState('thinking'); }
    else send('control.pause');
  };

  const interviewer = interviewers[0];

  const HintBanner = hint ? (
    <div className="shrink-0 mx-4 mb-2">
      <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 shadow-sm">
        <span className="text-amber-500 text-base mt-0.5 shrink-0">💡</span>
        <p className="text-sm text-amber-800 leading-relaxed flex-1">{hint}</p>
        <button onClick={() => setHint(null)} className="text-amber-400 hover:text-amber-600 shrink-0 mt-0.5">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  ) : null;

  const AnswerInput = (
    <div className="shrink-0 bg-white border-t border-stone-200 px-5 py-3.5">
      <div className="flex gap-2 items-end">
        <MicButton disabled={wsState !== 'listening'} onTranscript={(t) => setAnswer(t)} />
        <textarea
          value={answer}
          onChange={e => setAnswer(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={wsState !== 'listening'}
          rows={2}
          placeholder={wsState === 'listening' ? '답변 입력 또는 🎤 마이크 버튼 클릭' : '면접관이 말하는 중...'}
          className="flex-1 resize-none border border-stone-200 rounded-xl px-4 py-2.5 text-sm leading-relaxed focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-stone-50 disabled:text-stone-400"
        />
        <button
          onClick={submitAnswer}
          disabled={wsState !== 'listening' || !answer.trim()}
          className="shrink-0 px-5 py-2.5 bg-blue-600 text-white text-sm rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-40 transition-colors"
        >
          전송
        </button>
      </div>
      <div className="flex justify-end gap-4 mt-1.5 text-xs text-stone-400">
        <button onClick={() => send('control.skip')} className="hover:text-stone-600 transition-colors">질문 건너뛰기</button>
        <button onClick={() => send('control.repeat')} className="hover:text-stone-600 transition-colors">질문 다시 보기</button>
      </div>
    </div>
  );

  return (
    <div className="h-screen bg-stone-50 flex flex-col overflow-hidden">
      {/* 헤더 */}
      <header className="shrink-0 bg-white border-b border-stone-200 px-5 h-14 flex items-center gap-3">
        <button onClick={() => router.push('/dashboard')} className="text-stone-400 hover:text-stone-700 transition-colors" title="대시보드">
          <BackIcon />
        </button>
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 ${wsState === 'speaking' ? 'bg-blue-500 animate-pulse' : 'bg-stone-500'}`}>
            {interviewer?.name?.[0] ?? 'AI'}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-stone-800 truncate">{interviewer?.name ?? '면접관'}</p>
            <p className="text-xs text-stone-400 truncate">{interviewer?.title ?? ''}</p>
          </div>
        </div>
        <div className="ml-3 hidden sm:block">
          {wsState === 'thinking' && <span className="text-xs text-stone-400 flex items-center gap-1.5"><span className="w-3 h-3 border border-stone-300 border-t-stone-500 rounded-full animate-spin" />{thinkingReason || '생각 중'}</span>}
          {wsState === 'speaking' && <span className="text-xs text-blue-600 flex items-center gap-1.5"><span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />발화 중</span>}
          {wsState === 'listening' && <span className="text-xs text-green-600 flex items-center gap-1.5"><span className="w-2 h-2 bg-green-500 rounded-full" />답변 대기</span>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {progress && (
            <div className="hidden sm:flex items-center gap-3 text-xs text-stone-500">
              <span className="font-medium">{progress.q_index + 1} / {progress.total}</span>
              <span className={`font-mono tabular-nums ${progress.remaining_sec < 120 ? 'text-red-500 font-semibold' : ''}`}>{formatSec(progress.remaining_sec)}</span>
            </div>
          )}
          <button onClick={togglePause} className="px-3 py-1.5 text-xs rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors">{paused ? '재개' : '일시정지'}</button>
          <button onClick={handleEnd} className="px-3 py-1.5 text-xs rounded-lg bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 transition-colors">종료</button>
        </div>
      </header>

      {wsState === 'connecting' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="w-10 h-10 border-4 border-blue-100 border-t-blue-500 rounded-full animate-spin" />
          <p className="text-sm text-stone-500">면접관과 연결하는 중...</p>
        </div>
      )}
      {wsState === 'error' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center">
            <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <p className="text-stone-700 font-medium">{error || '연결 오류'}</p>
          <button onClick={() => router.push('/dashboard')} className="flex items-center gap-2 px-4 py-2 bg-stone-100 rounded-xl text-sm text-stone-700 hover:bg-stone-200 transition-colors">
            <BackIcon />대시보드
          </button>
        </div>
      )}
      {wsState === 'completed' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <div className="w-14 h-14 rounded-full bg-green-50 flex items-center justify-center">
            <svg className="w-7 h-7 text-green-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-stone-800 font-semibold">면접이 완료되었습니다!</p>
          <p className="text-sm text-stone-400">리포트를 생성하고 있습니다...</p>
        </div>
      )}

      {!['connecting', 'error', 'completed'].includes(wsState) && (
        isVideo ? (
          /* ── 화상 면접 ── */
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* 영상 패널 */}
            <div className="shrink-0 bg-stone-900 p-4" style={{ height: '300px' }}>
              <div className="h-full flex gap-3">
                {/* AI 면접관 */}
                <div className="flex-1 h-full bg-stone-800 rounded-2xl relative overflow-hidden flex flex-col items-center justify-center">
                  <div className="absolute inset-0 bg-gradient-to-b from-blue-950/60 to-stone-900/80" />
                  <div className="relative z-10">
                    <AIAvatar wsState={wsState} name={interviewer?.name ?? 'AI'} />
                  </div>
                  <div className="relative z-10 mt-2 text-center">
                    <p className="text-white font-semibold text-sm">{interviewer?.name ?? '면접관'}</p>
                    <p className="text-stone-400 text-xs">{interviewer?.title ?? 'AI 면접관'}</p>
                  </div>
                  <div className="absolute bottom-3 left-0 right-0 flex justify-center">
                    {wsState === 'speaking' && <span className="flex items-center gap-1.5 bg-black/50 text-xs text-green-300 px-3 py-1 rounded-full"><span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />발화 중</span>}
                    {wsState === 'thinking' && <span className="flex items-center gap-1.5 bg-black/50 text-xs text-amber-300 px-3 py-1 rounded-full"><span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />생각 중</span>}
                    {wsState === 'listening' && <span className="flex items-center gap-1.5 bg-black/50 text-xs text-blue-300 px-3 py-1 rounded-full"><span className="w-1.5 h-1.5 bg-blue-400 rounded-full" />답변 대기</span>}
                  </div>
                </div>

                {/* 사용자 아바타 (사진 or 기본) */}
                <div className="w-44 h-full rounded-2xl overflow-hidden relative shrink-0 bg-stone-800">
                  <UserAvatar
                    isTalking={isTalking}
                    photoUrl={userPhotoUrl}
                    onPhotoChange={setUserPhotoUrl}
                  />
                  {!userPhotoUrl && (
                    <div className="absolute top-2 right-2">
                      <span className="text-xs bg-blue-600/80 text-white px-2 py-0.5 rounded-full">사진 추가</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 자막 */}
            <div className="flex-1 overflow-y-auto bg-white px-5 py-3 space-y-3">
              {turns.map((turn, i) => (
                <div key={i} className={`flex ${turn.speaker === 'candidate' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${turn.speaker === 'interviewer' ? 'bg-stone-100 text-stone-800 rounded-tl-sm' : 'bg-blue-600 text-white rounded-tr-sm'}`}>
                    {turn.text}
                  </div>
                </div>
              ))}
              {(wsState === 'speaking' || wsState === 'thinking') && currentText && (
                <div className="flex justify-start">
                  <div className="max-w-[80%] bg-stone-100 rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm text-stone-800">
                    {currentText}<span className="inline-block w-0.5 h-4 bg-stone-400 ml-0.5 animate-pulse align-middle" />
                  </div>
                </div>
              )}
              {wsState === 'thinking' && !currentText && (
                <div className="flex justify-start">
                  <div className="bg-stone-100 rounded-2xl rounded-tl-sm px-4 py-3">
                    <span className="flex gap-1.5">{[0,0.2,0.4].map((d,i)=><span key={i} className="w-1.5 h-1.5 bg-stone-400 rounded-full animate-bounce" style={{animationDelay:`${d}s`}}/>)}</span>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
            {HintBanner}
            {AnswerInput}
          </div>
        ) : (
          /* ── 텍스트 면접 ── */
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
              {turns.map((turn, i) => (
                <div key={i} className={`flex ${turn.speaker === 'candidate' ? 'justify-end' : 'justify-start'}`}>
                  {turn.speaker === 'interviewer' && (
                    <div className="w-7 h-7 rounded-full bg-stone-500 flex items-center justify-center text-xs font-bold text-white shrink-0 mr-2 mt-1">
                      {interviewer?.name?.[0] ?? 'AI'}
                    </div>
                  )}
                  <div className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${turn.speaker === 'interviewer' ? 'bg-white border border-stone-200 text-stone-800 rounded-tl-sm shadow-sm' : 'bg-blue-600 text-white rounded-tr-sm'}`}>
                    {turn.text}
                  </div>
                </div>
              ))}
              {(wsState === 'speaking' || wsState === 'thinking') && currentText && (
                <div className="flex justify-start">
                  <div className="w-7 h-7 rounded-full bg-stone-500 flex items-center justify-center text-xs font-bold text-white shrink-0 mr-2 mt-1">{interviewer?.name?.[0] ?? 'AI'}</div>
                  <div className="max-w-[75%] rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed bg-white border border-stone-200 text-stone-800 shadow-sm">
                    {currentText}<span className="inline-block w-0.5 h-4 bg-stone-400 ml-0.5 animate-pulse align-middle" />
                  </div>
                </div>
              )}
              {wsState === 'thinking' && !currentText && (
                <div className="flex justify-start">
                  <div className="w-7 h-7 rounded-full bg-stone-500 flex items-center justify-center text-xs font-bold text-white shrink-0 mr-2">{interviewer?.name?.[0] ?? 'AI'}</div>
                  <div className="bg-white border border-stone-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                    <span className="flex gap-1.5">{[0,0.2,0.4].map((d,i)=><span key={i} className="w-1.5 h-1.5 bg-stone-300 rounded-full animate-bounce" style={{animationDelay:`${d}s`}}/>)}</span>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
            {HintBanner}
            {AnswerInput}
          </div>
        )
      )}
    </div>
  );
}
