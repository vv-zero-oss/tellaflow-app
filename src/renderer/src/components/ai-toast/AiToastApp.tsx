import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { IdleState } from './states/IdleState';
import { ListeningState } from './states/ListeningState';
import { ThinkingState } from './states/ThinkingState';
import { SpeakingState } from './states/SpeakingState';
import { ActingState } from './states/ActingState';
import { ConfirmState } from './states/ConfirmState';
import { SuccessState } from './states/SuccessState';
import { ErrorState } from './states/ErrorState';

type ToastState =
  | 'idle' | 'listening' | 'thinking' | 'speaking' | 'acting'
  | 'confirm' | 'choice' | 'permission' | 'notify' | 'typing'
  | 'background' | 'success' | 'error' | 'offline'
  | 'live-transcript' | 'tts-reading' | 'summary'
  | 'dictation-review' | 'attachment' | 'context' | 'handoff';

interface ToastStateData {
  state: ToastState;
  data: Record<string, unknown>;
}

declare global {
  interface Window {
    aiToast: {
      onStateChange: (cb: (state: ToastStateData) => void) => void;
      sendAction: (action: { type: string; payload?: unknown }) => void;
      getState: () => Promise<ToastStateData>;
    };
  }
}

export function AiToastApp() {
  const [state, setState] = useState<ToastState>('idle');
  const [data, setData] = useState<Record<string, unknown>>({});

  useEffect(() => {
    // Listen for state changes from main process
    window.aiToast?.onStateChange(({ state: s, data: d }) => {
      setState(s);
      setData(d || {});
    });

    // Get initial state
    window.aiToast?.getState().then(({ state: s, data: d }) => {
      setState(s);
      setData(d || {});
    });
  }, []);

  const sendAction = (type: string, payload?: unknown) => {
    window.aiToast?.sendAction({ type, payload });
  };

  const isLarge = ['live-transcript', 'tts-reading', 'summary', 'dictation-review'].includes(state);

  return (
    <div className="flex items-end justify-center w-full h-full p-4">
      <AnimatePresence mode="wait">
        <motion.div
          key={state}
          initial={{ opacity: 0, y: 8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.98 }}
          transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          className={`island ${state} ${isLarge ? 'large' : ''}`}
          style={{
            display: 'inline-flex',
            alignItems: isLarge ? 'stretch' : 'center',
            flexDirection: isLarge ? 'column' : 'row',
            gap: isLarge ? '8px' : '8px',
            padding: isLarge ? '12px 16px' : '8px 14px',
            borderRadius: isLarge ? '18px' : '9999px',
            background: 'rgba(15,15,15,0.92)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            maxWidth: '620px',
            fontFamily: "'Geist', system-ui, sans-serif",
            fontSize: '12px',
            fontWeight: 500,
          }}
        >
          {renderState(state, data, sendAction)}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function renderState(
  state: ToastState,
  data: Record<string, unknown>,
  sendAction: (type: string, payload?: unknown) => void
) {
  switch (state) {
    case 'idle':
      return <IdleState />;
    case 'listening':
      return <ListeningState onStop={() => sendAction('stop')} />;
    case 'thinking':
      return <ThinkingState onCancel={() => sendAction('cancel')} />;
    case 'speaking':
      return <SpeakingState text={data.text as string} onSkip={() => sendAction('skip')} onRepeat={() => sendAction('repeat')} />;
    case 'acting':
      return <ActingState label={data.label as string} onCancel={() => sendAction('cancel')} />;
    case 'confirm':
      return <ConfirmState question={data.question as string} onYes={() => sendAction('confirm-yes')} onNo={() => sendAction('confirm-no')} />;
    case 'success':
      return <SuccessState message={data.message as string} />;
    case 'error':
      return <ErrorState message={data.message as string} onRetry={() => sendAction('retry')} />;
    default:
      return <IdleState />;
  }
}
