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

  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!isLoggedIn()) { router.push('/login'); return; }

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
        ws.onclose = (e) => {
          if (e.code !== 1000) setWsState('error');
        };

        ws.onmessage = (event) => {
          const msg = JSON.parse(event.data);
          handleMessage(msg);
        };
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
  }, [sessionId, router]);

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
      <header className="shrink-0 bg-white border-b border-stone-200 px-5 h-13 flex items-center gap-4">
        <div className="flex items-center gap-3">
          {/* 면접관 아바타 */}
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white ${
            wsState === 'speaking' ? 'bg-blue-600 animate-pulse' : 'bg-stone-300'
          }`}>
            {interviewer?.name?.[0] ?? 'I'}
          </div>
          <div>
            <p className="text-xs font-semibold text-stone-800">{interviewer?.name ?? '면접관'}</p>
            <p className="text-xs text-stone-400">{interviewer?.title ?? ''}</p>
          </div>
        </div>

        {/* 상태 */}
        <div className="ml-4">
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
              답변 입력 대기
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-3">
          {/* 진행률 */}
          {progress && (
            <div className="hidden sm:flex items-center gap-3 text-xs text-stone-500">
              <span>{progress.q_index + 1} / {progress.total}</span>
              <span className={`font-mono ${progress.remaining_sec < 120 ? 'text-red-500' : ''}`}>
                {formatSec(progress.remaining_sec)}
              </span>
            </div>
          )}
          <button onClick={togglePause}
            className="px-3 py-1.5 text-xs rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50">
            {paused ? '재개' : '일시정지'}
          </button>
          <button onClick={handleEnd}
            className="px-3 py-1.5 text-xs rounded-lg bg-red-50 border border-red-200 text-red-600 hover:bg-red-100">
            면접 종료
          </button>
        </div>
      </header>

      {/* 연결 중 / 오류 / 완료 오버레이 */}
      {wsState === 'connecting' && (
        <div className="flex-1 flex items-center justify-center flex-col gap-3">
          <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
          <p className="text-sm text-stone-500">면접관과 연결하는 중...</p>
        </div>
      )}

      {wsState === 'error' && (
        <div className="flex-1 flex items-center justify-center flex-col gap-4">
          <p className="text-red-600">{error || '연결 오류가 발생했습니다.'}</p>
          <button onClick={() => router.push('/dashboard')}
            className="px-4 py-2 bg-stone-100 rounded-lg text-sm text-stone-700">
            대시보드로 돌아가기
          </button>
        </div>
      )}

      {wsState === 'completed' && (
        <div className="flex-1 flex items-center justify-center flex-col gap-3">
          <p className="text-stone-800 font-medium">면접이 완료되었습니다!</p>
          <p className="text-sm text-stone-400">리포트를 생성하고 있습니다...</p>
        </div>
      )}

      {/* 대화 영역 */}
      {!['connecting', 'error', 'completed'].includes(wsState) && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* 대화록 */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {turns.map((turn, i) => (
              <div key={i} className={`flex ${turn.speaker === 'candidate' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  turn.speaker === 'interviewer'
                    ? 'bg-white border border-stone-200 text-stone-800 rounded-tl-sm'
                    : 'bg-blue-600 text-white rounded-tr-sm'
                }`}>
                  {turn.text}
                </div>
              </div>
            ))}

            {/* 스트리밍 중 텍스트 */}
            {(wsState === 'speaking' || wsState === 'thinking') && currentText && (
              <div className="flex justify-start">
                <div className="max-w-[75%] rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed bg-white border border-stone-200 text-stone-800">
                  {currentText}
                  <span className="inline-block w-1 h-4 bg-stone-400 ml-0.5 animate-pulse align-middle" />
                </div>
              </div>
            )}

            {wsState === 'thinking' && !currentText && (
              <div className="flex justify-start">
                <div className="bg-white border border-stone-200 rounded-2xl rounded-tl-sm px-4 py-3">
                  <span className="flex gap-1">
                    {[0, 0.2, 0.4].map((d, i) => (
                      <span key={i} className="w-1.5 h-1.5 bg-stone-300 rounded-full animate-bounce"
                        style={{ animationDelay: `${d}s` }} />
                    ))}
                  </span>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* 답변 입력 */}
          <div className="shrink-0 bg-white border-t border-stone-200 px-5 py-3">
            <div className="flex gap-2 items-end">
              <textarea
                value={answer}
                onChange={e => setAnswer(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={wsState !== 'listening'}
                rows={2}
                placeholder={wsState === 'listening' ? '답변을 입력하세요 (Enter로 전송, Shift+Enter로 줄바꿈)' : '면접관이 말하는 중...'}
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
            <p className="text-xs text-stone-400 mt-1.5 text-right">
              <button onClick={() => send('control.skip')} className="hover:text-stone-600 mr-3">질문 건너뛰기</button>
              <button onClick={() => send('control.repeat')} className="hover:text-stone-600">질문 다시 보기</button>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
