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

function AIAvatar({ wsState, name }: { wsState: WsState; name: string }) {
  const isSpeaking = wsState === 'speaking';
  const isThinking = wsState === 'thinking';

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        <div className={`w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-2xl font-bold text-white shadow-lg transition-transform ${
          isSpeaking ? 'scale-105' : ''
        }`}>
          {name?.[0] ?? 'AI'}
        </div>
        {isSpeaking && (
          <span className="absolute -bottom-1 -right-1 w-5 h-5 bg-green-500 rounded-full border-2 border-white flex items-center justify-center">
            <span className="w-2 h-2 bg-white rounded-full animate-ping" />
          </span>
        )}
        {isThinking && (
          <span className="absolute -bottom-1 -right-1 w-5 h-5 bg-amber-400 rounded-full border-2 border-white" />
        )}
      </div>
      {/* 음성 파형 애니메이션 */}
      {isSpeaking && (
        <div className="flex items-end gap-0.5 h-6">
          {[0, 0.1, 0.2, 0.15, 0.05, 0.2, 0.1].map((delay, i) => (
            <span
              key={i}
              className="w-1 bg-blue-400 rounded-full animate-bounce"
              style={{
                height: `${8 + Math.random() * 14}px`,
                animationDelay: `${delay}s`,
                animationDuration: '0.6s',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CameraPreview() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camError, setCamError] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      .then(s => {
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
        }
      })
      .catch(() => setCamError(true));

    return () => {
      stream?.getTracks().forEach(t => t.stop());
    };
  }, []);

  if (camError) {
    return (
      <div className="w-full h-full bg-stone-800 flex items-center justify-center rounded-xl">
        <div className="text-center text-stone-500">
          <svg className="w-6 h-6 mx-auto mb-1" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.361a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18" />
          </svg>
          <p className="text-xs">카메라 없음</p>
        </div>
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      className="w-full h-full object-cover rounded-xl scale-x-[-1]"
    />
  );
}

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

  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!isLoggedIn()) { router.push('/login'); return; }
    const ch = localStorage.getItem(`session_channel_${sessionId}`);
    setIsVideo(ch === 'video');
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
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '연결 실패');
          setWsState('error');
        }
      }
    };

    connect();
    return () => {
      cancelled = true;
      ws?.close(1000, 'unmount');
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const handleMessage = useCallback((msg: { type: string; data: Record<string, unknown> }) => {
    const { type, data } = msg;
    switch (type) {
      case 'session.ready':
        setWsState('thinking');
        setInterviewers((data.interviewers as Array<{ name: string; title: string }>) ?? []);
        break;
      case 'state.thinking':
        setWsState('thinking');
        setThinkingReason(String(data.reason ?? ''));
        break;
      case 'interviewer.speaking_start':
        setWsState('speaking');
        setCurrentText('');
        break;
      case 'interviewer.text_delta':
        setCurrentText(prev => prev + String(data.delta ?? ''));
        break;
      case 'interviewer.speaking_end': {
        const text = String(data.full_text ?? '');
        setTurns(prev => [...prev, { speaker: 'interviewer', text, type: String(data.turn_type ?? 'question') }]);
        setCurrentText('');
        setWsState('listening');
        break;
      }
      case 'state.progress':
        setProgress({
          q_index: Number(data.q_index ?? 0),
          total: Number(data.total ?? 0),
          remaining_sec: Number(data.remaining_sec ?? 0),
        });
        break;
      case 'session.paused':
        setPaused(true);
        setWsState('paused');
        break;
      case 'session.completed':
        setWsState('completed');
        setTimeout(() => router.push(`/report/${sessionId}`), 2000);
        break;
      case 'error':
        setError(String(data.message ?? '오류가 발생했습니다.'));
        setWsState('error');
        break;
      default:
        break;
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
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitAnswer();
    }
  };

  const handleEnd = async () => {
    send('control.end');
    await endSession(sessionId).catch(() => {});
  };

  const togglePause = () => {
    if (paused) {
      send('control.resume');
      setPaused(false);
      setWsState('thinking');
    } else {
      send('control.pause');
    }
  };

  const interviewer = interviewers[0];

  return (
    <div className="h-screen bg-stone-50 flex flex-col overflow-hidden">
      {/* 헤더 */}
      <header className="shrink-0 bg-white border-b border-stone-200 px-5 h-14 flex items-center gap-3">
        <button
          onClick={() => router.push('/dashboard')}
          className="flex items-center gap-1 text-stone-400 hover:text-stone-700 transition-colors"
          title="대시보드로 이동"
        >
          <BackIcon />
        </button>

        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0 ${
            wsState === 'speaking' ? 'bg-blue-600 animate-pulse' : 'bg-stone-400'
          }`}>
            {interviewer?.name?.[0] ?? 'AI'}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-stone-800 truncate">{interviewer?.name ?? '면접관'}</p>
            <p className="text-xs text-stone-400 truncate">{interviewer?.title ?? ''}</p>
          </div>
        </div>

        <div className="ml-3">
          {wsState === 'thinking' && (
            <span className="text-xs text-stone-400 flex items-center gap-1.5">
              <span className="w-3 h-3 border border-stone-300 border-t-stone-600 rounded-full animate-spin" />
              {thinkingReason || '생각하는 중'}
            </span>
          )}
          {wsState === 'speaking' && (
            <span className="text-xs text-blue-600 flex items-center gap-1.5">
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              말하는 중
            </span>
          )}
          {wsState === 'listening' && (
            <span className="text-xs text-green-600 flex items-center gap-1.5">
              <span className="w-2 h-2 bg-green-500 rounded-full" />
              답변 대기
            </span>
          )}
          {wsState === 'paused' && (
            <span className="text-xs text-amber-600 flex items-center gap-1.5">
              <span className="w-2 h-2 bg-amber-500 rounded-full" />
              일시정지
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {progress && (
            <div className="hidden sm:flex items-center gap-3 text-xs text-stone-500">
              <span className="font-medium">{progress.q_index + 1} / {progress.total}</span>
              <span className={`font-mono ${progress.remaining_sec < 120 ? 'text-red-500 font-semibold' : ''}`}>
                {formatSec(progress.remaining_sec)}
              </span>
            </div>
          )}
          <button
            onClick={togglePause}
            className="px-3 py-1.5 text-xs rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors"
          >
            {paused ? '재개' : '일시정지'}
          </button>
          <button
            onClick={handleEnd}
            className="px-3 py-1.5 text-xs rounded-lg bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 transition-colors"
          >
            면접 종료
          </button>
        </div>
      </header>

      {/* 연결 중 */}
      {wsState === 'connecting' && (
        <div className="flex-1 flex items-center justify-center flex-col gap-4">
          <div className="w-10 h-10 border-4 border-blue-100 border-t-blue-500 rounded-full animate-spin" />
          <p className="text-sm text-stone-500">면접관과 연결하는 중...</p>
        </div>
      )}

      {/* 오류 */}
      {wsState === 'error' && (
        <div className="flex-1 flex items-center justify-center flex-col gap-4">
          <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center">
            <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <p className="text-stone-700 font-medium">{error || '연결 오류가 발생했습니다.'}</p>
          <button
            onClick={() => router.push('/dashboard')}
            className="flex items-center gap-2 px-4 py-2 bg-stone-100 rounded-xl text-sm text-stone-700 hover:bg-stone-200 transition-colors"
          >
            <BackIcon />
            대시보드로 돌아가기
          </button>
        </div>
      )}

      {/* 완료 */}
      {wsState === 'completed' && (
        <div className="flex-1 flex items-center justify-center flex-col gap-3">
          <div className="w-14 h-14 rounded-full bg-green-50 flex items-center justify-center">
            <svg className="w-7 h-7 text-green-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-stone-800 font-semibold">면접이 완료되었습니다!</p>
          <p className="text-sm text-stone-400">리포트를 생성하고 있습니다...</p>
        </div>
      )}

      {/* 면접 영역 */}
      {!['connecting', 'error', 'completed'].includes(wsState) && (
        isVideo ? (
          /* ── 화상 면접 레이아웃 ── */
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* 비디오 영역 */}
            <div className="shrink-0 bg-stone-900 px-5 py-4 flex gap-4 items-end" style={{ height: '280px' }}>
              {/* AI 면접관 패널 */}
              <div className="flex-1 h-full bg-stone-800 rounded-2xl flex flex-col items-center justify-center gap-3 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-900/30 to-stone-900/60" />
                <div className="relative">
                  <AIAvatar wsState={wsState} name={interviewer?.name ?? 'AI'} />
                </div>
                <div className="relative text-center">
                  <p className="text-white font-medium text-sm">{interviewer?.name ?? '면접관'}</p>
                  <p className="text-stone-400 text-xs mt-0.5">{interviewer?.title ?? 'AI 면접관'}</p>
                </div>
                {/* 상태 표시줄 */}
                <div className="absolute bottom-3 left-0 right-0 flex justify-center">
                  {wsState === 'speaking' && (
                    <div className="flex items-center gap-1.5 bg-black/40 px-3 py-1 rounded-full">
                      <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                      <span className="text-xs text-green-300">발화 중</span>
                    </div>
                  )}
                  {wsState === 'thinking' && (
                    <div className="flex items-center gap-1.5 bg-black/40 px-3 py-1 rounded-full">
                      <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
                      <span className="text-xs text-amber-300">생각 중</span>
                    </div>
                  )}
                  {wsState === 'listening' && (
                    <div className="flex items-center gap-1.5 bg-black/40 px-3 py-1 rounded-full">
                      <span className="w-1.5 h-1.5 bg-blue-400 rounded-full" />
                      <span className="text-xs text-blue-300">답변 대기</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 내 카메라 (작은 PiP) */}
              <div className="w-36 h-full bg-stone-800 rounded-2xl overflow-hidden relative shrink-0">
                <CameraPreview />
                <div className="absolute bottom-2 left-0 right-0 text-center">
                  <span className="text-xs text-white/70 bg-black/40 px-2 py-0.5 rounded-full">나</span>
                </div>
              </div>
            </div>

            {/* 채팅 + 입력 */}
            <div className="flex-1 flex flex-col overflow-hidden bg-white">
              <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
                {turns.map((turn, i) => (
                  <div key={i} className={`flex ${turn.speaker === 'candidate' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      turn.speaker === 'interviewer'
                        ? 'bg-stone-100 text-stone-800 rounded-tl-sm'
                        : 'bg-blue-600 text-white rounded-tr-sm'
                    }`}>
                      {turn.text}
                    </div>
                  </div>
                ))}
                {(wsState === 'speaking' || wsState === 'thinking') && currentText && (
                  <div className="flex justify-start">
                    <div className="max-w-[80%] rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm bg-stone-100 text-stone-800">
                      {currentText}
                      <span className="inline-block w-0.5 h-4 bg-stone-400 ml-0.5 animate-pulse align-middle" />
                    </div>
                  </div>
                )}
                {wsState === 'thinking' && !currentText && (
                  <div className="flex justify-start">
                    <div className="bg-stone-100 rounded-2xl rounded-tl-sm px-4 py-3">
                      <span className="flex gap-1">
                        {[0, 0.2, 0.4].map((d, i) => (
                          <span key={i} className="w-1.5 h-1.5 bg-stone-400 rounded-full animate-bounce" style={{ animationDelay: `${d}s` }} />
                        ))}
                      </span>
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
              <div className="shrink-0 border-t border-stone-100 px-5 py-3">
                <div className="flex gap-2 items-end">
                  <textarea
                    value={answer}
                    onChange={e => setAnswer(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={wsState !== 'listening'}
                    rows={2}
                    placeholder={wsState === 'listening' ? '답변을 입력하세요 (Enter 전송, Shift+Enter 줄바꿈)' : '면접관 발화 중...'}
                    className="flex-1 resize-none border border-stone-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-stone-50 disabled:text-stone-400"
                  />
                  <button
                    onClick={submitAnswer}
                    disabled={wsState !== 'listening' || !answer.trim()}
                    className="px-5 py-2.5 bg-blue-600 text-white text-sm rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-40 transition-colors"
                  >
                    전송
                  </button>
                </div>
                <div className="flex justify-end gap-4 mt-1.5 text-xs text-stone-400">
                  <button onClick={() => send('control.skip')} className="hover:text-stone-600 transition-colors">질문 건너뛰기</button>
                  <button onClick={() => send('control.repeat')} className="hover:text-stone-600 transition-colors">질문 다시 보기</button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ── 텍스트 면접 레이아웃 ── */
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
              {turns.map((turn, i) => (
                <div key={i} className={`flex ${turn.speaker === 'candidate' ? 'justify-end' : 'justify-start'}`}>
                  {turn.speaker === 'interviewer' && (
                    <div className="w-7 h-7 rounded-full bg-stone-400 flex items-center justify-center text-xs font-bold text-white shrink-0 mr-2 mt-1">
                      {interviewer?.name?.[0] ?? 'AI'}
                    </div>
                  )}
                  <div className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    turn.speaker === 'interviewer'
                      ? 'bg-white border border-stone-200 text-stone-800 rounded-tl-sm shadow-sm'
                      : 'bg-blue-600 text-white rounded-tr-sm'
                  }`}>
                    {turn.text}
                  </div>
                </div>
              ))}

              {(wsState === 'speaking' || wsState === 'thinking') && currentText && (
                <div className="flex justify-start">
                  <div className="w-7 h-7 rounded-full bg-stone-400 flex items-center justify-center text-xs font-bold text-white shrink-0 mr-2 mt-1">
                    {interviewer?.name?.[0] ?? 'AI'}
                  </div>
                  <div className="max-w-[75%] rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed bg-white border border-stone-200 text-stone-800 shadow-sm">
                    {currentText}
                    <span className="inline-block w-0.5 h-4 bg-stone-400 ml-0.5 animate-pulse align-middle" />
                  </div>
                </div>
              )}

              {wsState === 'thinking' && !currentText && (
                <div className="flex justify-start">
                  <div className="w-7 h-7 rounded-full bg-stone-400 flex items-center justify-center text-xs font-bold text-white shrink-0 mr-2">
                    {interviewer?.name?.[0] ?? 'AI'}
                  </div>
                  <div className="bg-white border border-stone-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                    <span className="flex gap-1.5 items-center">
                      {[0, 0.2, 0.4].map((d, i) => (
                        <span key={i} className="w-1.5 h-1.5 bg-stone-300 rounded-full animate-bounce" style={{ animationDelay: `${d}s` }} />
                      ))}
                    </span>
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            <div className="shrink-0 bg-white border-t border-stone-200 px-5 py-3.5">
              <div className="flex gap-2.5 items-end">
                <textarea
                  value={answer}
                  onChange={e => setAnswer(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={wsState !== 'listening'}
                  rows={2}
                  placeholder={wsState === 'listening' ? '답변을 입력하세요 (Enter 전송, Shift+Enter 줄바꿈)' : '면접관이 말하는 중...'}
                  className="flex-1 resize-none border border-stone-200 rounded-xl px-4 py-2.5 text-sm leading-relaxed focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-stone-50 disabled:text-stone-400"
                />
                <button
                  onClick={submitAnswer}
                  disabled={wsState !== 'listening' || !answer.trim()}
                  className="px-5 py-2.5 bg-blue-600 text-white text-sm rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-40 transition-colors"
                >
                  전송
                </button>
              </div>
              <div className="flex justify-end gap-4 mt-1.5 text-xs text-stone-400">
                <button onClick={() => send('control.skip')} className="hover:text-stone-600 transition-colors">질문 건너뛰기</button>
                <button onClick={() => send('control.repeat')} className="hover:text-stone-600 transition-colors">질문 다시 보기</button>
              </div>
            </div>
          </div>
        )
      )}
    </div>
  );
}
