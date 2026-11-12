import * as RadixDropdown from '@radix-ui/react-dropdown-menu';
import {
  cloneElement,
  isValidElement,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

export function ActionMenu({
  trigger,
  children,
  contentClassName = '',
  align = 'end',
  sideOffset = 5,
  onOpenChange,
}: {
  trigger: ReactElement<{
    onPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void;
    onClick?: (e: ReactMouseEvent<HTMLElement>) => void;
  }>;
  children: ReactNode;
  contentClassName?: string;
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const pointerDownHandledRef = useRef(false);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  const enhancedTrigger = isValidElement(trigger)
    ? cloneElement(trigger, {
        onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
          pointerDownHandledRef.current = true;
          e.stopPropagation();
          trigger.props.onPointerDown?.(e);
        },
        onClick: (e: ReactMouseEvent<HTMLElement>) => {
          e.stopPropagation();
          trigger.props.onClick?.(e);
          // Support programmatic `element.click()` (which skips pointerdown)
          if (!pointerDownHandledRef.current) {
            handleOpenChange(!open);
          }
          pointerDownHandledRef.current = false;
        },
      })
    : trigger;

  return (
    <RadixDropdown.Root modal={false} open={open} onOpenChange={handleOpenChange}>
      <RadixDropdown.Trigger asChild>{enhancedTrigger}</RadixDropdown.Trigger>
      <RadixDropdown.Portal>
        <RadixDropdown.Content
          align={align}
          sideOffset={sideOffset}
          collisionPadding={8}
          className={`dropdown-menu radix-dropdown-content ${contentClassName}`.trim()}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </RadixDropdown.Content>
      </RadixDropdown.Portal>
    </RadixDropdown.Root>
  );
}

export function DropdownItem({
  children,
  onSelect,
  danger = false,
  className = '',
}: {
  children: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  className?: string;
}) {
  return (
    <RadixDropdown.Item
      className={`dropdown-item ${danger ? 'danger' : ''} ${className}`.trim()}
      onSelect={() => onSelect()}
    >
      {children}
    </RadixDropdown.Item>
  );
}

export function DropdownSeparator() {
  return <RadixDropdown.Separator className="dropdown-divider" />;
}
