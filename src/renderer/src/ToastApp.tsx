import { useCallback, useEffect, useRef, useState } from 'react';
import { ipc, type IslandView } from '@/lib/ipc';
import { VoiceIsland } from '@/components/voice-island';

/*
 * The voice island window. The main process decides what to show and sends
 * it as an IslandView; every button press goes back as a named action.
 *
 * The window is larger than the island and click-through by default. While
 * the pointer is over the island we capture the mouse so its buttons work.
 */

// Where the island sits inside the window, matching the screen edge it is on.
const ANCHOR: Record<IslandView['placement'], string> = {
  bottom: 'inset-x-0 bottom-4 justify-center items-end',
  left: 'inset-y-0 left-2 items-center justify-start',
  right: 'inset-y-0 right-2 items-center justify-end',
};

export default function ToastApp() {
  const [view, setView] = useState<IslandView>({ state: 'none', placement: 'bottom', material: 'translucent' });
  const releaseTimer = useRef<number | null>(null);

  useEffect(() => ipc.onIslandUpdate((next) => setView(next)), []);

  const capture = useCallback(() => {
    if (releaseTimer.current !== null) { window.clearTimeout(releaseTimer.current); releaseTimer.current = null; }
    ipc.setToastInteractive(true);
    // Clicking the island must not bring Tellaflow's main window forward.
    ipc.suppressToastActivation();
    // Hovering the idle dot: remember the app the user is in before the click
    // activates Tellaflow, so dictation pastes back into it.
    if (view.state === 'idle') ipc.recordFrontmostApp();
  }, [view.state]);

  const release = useCallback(() => {
    if (releaseTimer.current !== null) window.clearTimeout(releaseTimer.current);
    releaseTimer.current = window.setTimeout(() => {
      releaseTimer.current = null;
      ipc.setToastInteractive(false);
    }, 80);
  }, []);

  // Once the island leaves, make sure the window stops catching clicks.
  useEffect(() => { if (view.state === 'none') ipc.setToastInteractive(false); }, [view.state]);

  return (
    <div className={`fixed flex ${ANCHOR[view.placement] ?? ANCHOR.bottom}`}>
      <div onPointerEnter={capture} onPointerLeave={release} onPointerDown={() => ipc.suppressToastActivation()}>
        <VoiceIsland
          state={view.state}
          answerKind={view.answerKind}
          material={view.material}
          placement={view.placement}
          correctedWord={view.correctedWord}
          content={view.content}
          onAction={(action) => ipc.islandAction(action)}
        />
      </div>
    </div>
  );
}
