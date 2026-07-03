/** Persistent backup status indicator (spec §8). Colour + plain words. */

import { statusLine, type SyncStatus } from '../sync/status';

interface StatusBarProps {
  status: SyncStatus;
  onRetry?: () => void;
}

const STATE_CLASS: Record<SyncStatus['state'], string> = {
  'local-only': 'neutral',
  idle: 'good',
  pending: 'amber',
  'backing-up': 'amber',
  offline: 'amber',
  error: 'bad',
};

export function StatusBar({ status, onRetry }: StatusBarProps) {
  return (
    <footer className={`status-bar ${STATE_CLASS[status.state]}`} role="status">
      <span className="status-text">{statusLine(status)}</span>
      {status.state === 'error' && onRetry && (
        <button className="retry" onClick={onRetry}>
          Try again
        </button>
      )}
    </footer>
  );
}
