import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ConnectionStatus } from './game/useRoomConnection';

interface Props {
  status: ConnectionStatus;
  /** Where 'lost' sends the player - the pregame menu. */
  onExit: () => void;
}

const MESSAGES: Record<ConnectionStatus, string> = {
  connected: '',
  reconnecting: 'Connection lost. Reconnecting…',
  lost: 'Could not get back into the game. It may have ended while you were away.',
};

/**
 * Covers the screen while an online seat is dropped. A scrim rather than a strip: every tap on
 * the board underneath would be sent down a closed socket and silently vanish, which reads as
 * the game ignoring you. Nothing is lost by blocking it - the server's turn clock is the only
 * thing that can act for a dropped seat anyway.
 *
 * Portalled to <body>, and the app root made inert while it's up. The portal is load-bearing:
 * .lobby__screen keeps a transform from its entrance animation, which makes it the containing
 * block for anything position: fixed inside it - rendered in place, the waiting room's scrim
 * would be clipped to that panel and leave the identity strip above it clickable. Inert on
 * #root (which the portal sits outside of) is what keeps Tab and a screen reader's cursor off
 * the dead board, not just the mouse.
 *
 * 'reconnecting' usually clears in a second or two, so focus is parked and handed back to
 * whatever held it rather than lost to <body> by the inert root. 'lost' is final and its only
 * control is the way out, so focus goes straight there.
 */
export function ConnectionBanner({ status, onExit }: Props) {
  const exitRef = useRef<HTMLButtonElement>(null);
  const textId = useId();
  const dropped = status !== 'connected';

  useEffect(() => {
    if (!dropped) return;
    const root = document.getElementById('root');
    const previousFocus = document.activeElement as HTMLElement | null;
    root?.setAttribute('inert', '');
    return () => {
      root?.removeAttribute('inert');
      previousFocus?.focus?.();
    };
  }, [dropped]);

  useEffect(() => {
    if (status === 'lost') exitRef.current?.focus();
  }, [status]);

  return createPortal(
    <>
      {/* Always mounted, text swapped in: a live region that appears already holding its
          message is often not announced at all (same reason as WaitingRoom's announcement).
          Silent for 'lost', which the alertdialog and its focused button already speak. */}
      <p role="status" className="visually-hidden">{status === 'reconnecting' ? MESSAGES.reconnecting : ''}</p>
      {dropped && (
        <div className="connection-scrim">
          <div
            className="cp-panel connection-banner"
            role={status === 'lost' ? 'alertdialog' : undefined}
            aria-modal={status === 'lost' ? true : undefined}
            aria-labelledby={status === 'lost' ? textId : undefined}
          >
            {/* aria-hidden while reconnecting: the live region above already speaks it. */}
            <p id={textId} className="connection-banner__text" aria-hidden={status === 'reconnecting' ? true : undefined}>
              {MESSAGES[status]}
            </p>
            {status === 'lost' && (
              <button type="button" className="cp-button" ref={exitRef} aria-describedby={textId} onClick={onExit}>
                Back to Menu
              </button>
            )}
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
