import type { ReactNode } from 'react';

export interface ActivityBarItem<T extends string = string> {
  id: T;
  label: string;
  shortcutHint?: string;
  icon: ReactNode;
  hasLiveIndicator?: boolean;
}

interface ActivityBarProps<T extends string = string> {
  side: 'left' | 'right';
  items: ActivityBarItem<T>[];
  activeId: T | null;
  onToggle: (id: T) => void;
}

export function ActivityBar<T extends string = string>({
  side,
  items,
  activeId,
  onToggle,
}: ActivityBarProps<T>) {
  return (
    <aside
      className={`activity-bar activity-bar-${side}`}
      data-testid={`${side}-activity-bar`}
      aria-label={side === 'left' ? 'Left activity bar' : 'Right activity bar'}
    >
      <div className="activity-bar-group">
        {items.map((item) => {
          const isActive = activeId === item.id;
          const tooltip = item.shortcutHint
            ? `${item.label} (${item.shortcutHint})`
            : item.label;

          return (
            <button
              key={item.id}
              type="button"
              data-tool-id={item.id}
              className={`activity-bar-btn ${isActive ? 'active' : ''}`}
              onClick={() => onToggle(item.id)}
              title={tooltip}
              aria-label={`Toggle ${item.label}`}
              aria-pressed={isActive}
            >
              {item.icon}
              {item.hasLiveIndicator && !isActive && (
                <span className="activity-live-dot" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
