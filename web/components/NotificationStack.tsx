import { AlertTriangle, CheckCircle2, CircleX, Info, X } from 'lucide-react';
import type { NotificationKind, StudioNotification } from '../store/uiStore';

interface NotificationStackProps {
  notifications: StudioNotification[];
  onDismiss: (id: string) => void;
}

function renderKindIcon(kind: NotificationKind) {
  switch (kind) {
    case 'error':
      return <CircleX size={15} />;
    case 'warning':
      return <AlertTriangle size={15} />;
    case 'success':
      return <CheckCircle2 size={15} />;
    default:
      return <Info size={15} />;
  }
}

export function NotificationStack({ notifications, onDismiss }: NotificationStackProps) {
  if (notifications.length === 0) return null;

  return (
    <div
      className="vscode-notification-stack"
      data-testid="vscode-notifications"
      aria-live="polite"
    >
      {notifications.map((item) => (
        <div
          key={item.id}
          className={`vscode-notification kind-${item.kind}`}
          role={item.kind === 'error' ? 'alert' : 'status'}
        >
          <div className="vscode-notification-main">
            <span className={`vscode-notification-icon kind-${item.kind}`} aria-hidden="true">
              {renderKindIcon(item.kind)}
            </span>
            <span className="vscode-notification-message">{item.message}</span>
            <button
              type="button"
              className="vscode-notification-close"
              onClick={() => onDismiss(item.id)}
              title="Clear Notification"
              aria-label="Clear notification"
            >
              <X size={14} />
            </button>
          </div>

          {(item.source || item.action) && (
            <div className="vscode-notification-footer">
              <span className="vscode-notification-source">
                {item.source ? `Source: ${item.source}` : ''}
              </span>
              {item.action && (
                <button
                  type="button"
                  className="vscode-notification-action toast-action-btn"
                  onClick={item.action.onClick}
                >
                  {item.action.label}
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
