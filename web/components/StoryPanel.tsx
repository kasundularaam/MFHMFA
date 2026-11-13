import {
  ArrowLeft,
  ArrowUpRight,
  BookOpenText,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  Layers,
  PanelLeftClose,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { DiagramComprehensionGuide, DiagramWalkthroughFlow } from '../../src/shared/types';
import type {
  GraphBreadcrumbHop,
  ParentComponentBranch,
  VfsGraphFile,
} from '../../src/shared/vfs';
import { graphTitleFromPath } from '../../src/shared/vfsPath';
import { useDragResize } from '../hooks/useDragResize';
import { ActionMenu, DropdownItem } from './DropdownMenu';

interface StoryPanelProps {
  chartKey: string;
  activeFile: VfsGraphFile;
  guide?: DiagramComprehensionGuide;
  flows: DiagramWalkthroughFlow[];
  currentFlow: DiagramWalkthroughFlow | null;
  activeStepIndex: number | null;
  breadcrumbHops: GraphBreadcrumbHop[];
  childBranches: ParentComponentBranch[];
  width: number;
  onResizeWidth: (nextWidth: number) => void;
  onCollapse: () => void;
  onChangeFlowId: (flowId: string | null) => void;
  onChangeStepIndex: (next: number | null) => void;
  onJumpToAncestor: (fileId: string) => void;
  onDrillToPath: (targetPath: string) => void;
}

function stripLeadingStepNumber(rawTitle: string): string {
  const cleaned = rawTitle.replace(/^\s*\d+\s*[.):-]\s*/, '').trim();
  return cleaned || rawTitle;
}

export function StoryPanel({
  chartKey,
  activeFile,
  guide,
  flows,
  currentFlow,
  activeStepIndex,
  breadcrumbHops,
  childBranches,
  width,
  onResizeWidth,
  onCollapse,
  onChangeFlowId,
  onChangeStepIndex,
  onJumpToAncestor,
  onDrillToPath,
}: StoryPanelProps) {
  const [revealedChecks, setRevealedChecks] = useState<Set<string>>(() => new Set());
  const [lastOpenedCheckKey, setLastOpenedCheckKey] = useState<string | null>(null);
  const stepRefs = useRef<Map<number, HTMLElement>>(new Map());
  const checkRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const dragOriginWidthRef = useRef(width);

  const startResizeDrag = useDragResize((dx) => {
    onResizeWidth(dragOriginWidthRef.current + dx);
  });

  useEffect(() => {
    if (activeStepIndex === null) return;
    const el = stepRefs.current.get(activeStepIndex);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeStepIndex]);

  useEffect(() => {
    if (!lastOpenedCheckKey) return;
    const checkEl = checkRefs.current.get(lastOpenedCheckKey);
    checkEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [lastOpenedCheckKey]);

  const toggleCheck = (key: string) => {
    setRevealedChecks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        setLastOpenedCheckKey(null);
      } else {
        next.add(key);
        setLastOpenedCheckKey(key);
      }
      return next;
    });
  };

  const steps = currentFlow?.steps ?? [];
  const docTitle = activeFile.title?.trim() || graphTitleFromPath(activeFile.path);
  const lastHop = breadcrumbHops.length > 0 ? breadcrumbHops[breadcrumbHops.length - 1]! : null;
  const siblingBranches = lastHop?.siblingBranches ?? [];

  return (
    <aside
      className="story-panel"
      style={{ width: `${width}px` }}
      data-testid="comprehension-dock"
      aria-label="Reading guide"
    >
      <div className="story-scroll-container">
        {breadcrumbHops.length > 0 && (
          <nav
            className="story-breadcrumb"
            data-testid="canvas-breadcrumb"
            aria-label="Diagram breadcrumb"
          >
            <button
              type="button"
              className="crumb-back-btn"
              onClick={() => onJumpToAncestor(lastHop!.parentFile.id)}
              title="Back to parent view (Alt+Left)"
              aria-label="Back to parent view"
            >
              <ArrowLeft size={13} />
            </button>

            {breadcrumbHops.map((hop) => {
              const parentLabel =
                hop.parentFile.title?.trim() || graphTitleFromPath(hop.parentFile.path);
              return (
                <span
                  key={`${hop.parentFile.id}-${hop.childFile.id}`}
                  className="crumb-hop-group"
                >
                  <button
                    type="button"
                    className="crumb-link"
                    onClick={() => onJumpToAncestor(hop.parentFile.id)}
                    title={hop.parentFile.path}
                  >
                    {parentLabel}
                  </button>
                  <ChevronRight size={13} className="crumb-sep" />
                </span>
              );
            })}

            {siblingBranches.length > 1 ? (
              <ActionMenu
                align="start"
                trigger={
                  <button type="button" className="crumb-current-menu-btn">
                    <span>{docTitle}</span>
                    <ChevronDown size={13} />
                  </button>
                }
              >
                {siblingBranches.map((branch) => {
                  const branchTitle =
                    branch.childFile.title?.trim() ||
                    branch.componentLabel ||
                    graphTitleFromPath(branch.childFile.path);
                  const isCurrent = branch.childFile.id === activeFile.id;
                  return (
                    <DropdownItem
                      key={branch.childFile.id}
                      className={isCurrent ? 'selected' : ''}
                      onSelect={() => {
                        if (!isCurrent) onDrillToPath(branch.childFile.path);
                      }}
                    >
                      <Layers size={14} />
                      <span>{branchTitle}</span>
                    </DropdownItem>
                  );
                })}
              </ActionMenu>
            ) : (
              <span className="crumb-current">{docTitle}</span>
            )}
          </nav>
        )}

        <header className="story-header">
          <div className="story-title-row">
            <h1 className="story-doc-title">{docTitle}</h1>
            <button
              type="button"
              className="icon-btn story-collapse-btn"
              onClick={onCollapse}
              title="Hide reading guide"
              aria-label="Hide reading guide"
            >
              <PanelLeftClose size={16} />
            </button>
          </div>

          {flows.length > 1 && (
            <div
              className="story-flow-selector"
              data-testid="flow-selector"
              role="tablist"
              aria-label="Scenarios"
            >
              {flows.map((flow) => {
                const isSelected = currentFlow?.id === flow.id;
                return (
                  <button
                    key={flow.id}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    data-flow-id={flow.id}
                    className={`story-flow-pill ${isSelected ? 'active' : ''}`}
                    onClick={() => onChangeFlowId(flow.id)}
                  >
                    {flow.label}
                  </button>
                );
              })}
            </div>
          )}

          {guide?.gist && (
            <div
              className={`story-gist-wrap ${
                activeStepIndex !== null ? 'can-reset' : 'is-overview'
              }`}
              onClick={() => {
                if (activeStepIndex !== null) {
                  onChangeStepIndex(null);
                }
              }}
              title={
                activeStepIndex !== null
                  ? 'Click to view full diagram without dimming'
                  : undefined
              }
            >
              <p className="story-gist">{guide.gist}</p>
            </div>
          )}
        </header>

        {steps.length > 0 && (
          <section className="story-steps-section" aria-label="Walkthrough steps">
            <div className="story-section-bar">
              <span className="story-section-label">
                <BookOpenText size={13} />
                <span>
                  {steps.length} {steps.length === 1 ? 'Step' : 'Steps'}
                </span>
              </span>

              {activeStepIndex === null ? (
                <button
                  type="button"
                  data-testid="story-start-btn"
                  className="story-section-action"
                  onClick={() => onChangeStepIndex(0)}
                >
                  Spotlight step 1 →
                </button>
              ) : (
                <button
                  type="button"
                  className="story-section-action"
                  onClick={() => onChangeStepIndex(null)}
                >
                  Show full map
                </button>
              )}
            </div>

            <ol className="story-steps-list">
              {steps.map((step, idx) => {
                const isStepActive = activeStepIndex === idx;
                const isStepDimmed = activeStepIndex !== null && !isStepActive;
                const cleanTitle = stripLeadingStepNumber(step.title);
                const checkKey = `${chartKey}::${currentFlow?.id ?? 'default'}::${idx}`;
                const isCheckOpen = revealedChecks.has(checkKey);

                return (
                  <li key={`${currentFlow?.id ?? 'flow'}-${idx}`} className="story-step-entry">
                    <article
                      ref={(el) => {
                        if (el) stepRefs.current.set(idx, el);
                        else stepRefs.current.delete(idx);
                      }}
                      className={`story-step-card ${isStepActive ? 'active' : ''} ${
                        isStepDimmed ? 'softened' : ''
                      }`}
                      onClick={() => onChangeStepIndex(isStepActive ? null : idx)}
                    >
                      <div className="story-step-head">
                        <span className="story-step-num" aria-hidden="true">
                          {idx + 1}
                        </span>
                        <h2 className="story-step-title">{cleanTitle}</h2>
                      </div>

                      <p className="story-step-caption">{step.caption}</p>

                      {step.trace && (
                        <div className="story-step-trace" data-testid="story-step-trace">
                          {step.trace}
                        </div>
                      )}
                    </article>

                    {step.check && (
                      <div
                        ref={(el) => {
                          if (el) checkRefs.current.set(checkKey, el);
                          else checkRefs.current.delete(checkKey);
                        }}
                        className={`story-check-card ${isCheckOpen ? 'open' : ''}`}
                        data-testid="story-step-check"
                      >
                        <button
                          type="button"
                          className="story-check-trigger"
                          data-testid="story-check-toggle"
                          aria-expanded={isCheckOpen}
                          onClick={() => {
                            if (activeStepIndex !== idx) {
                              onChangeStepIndex(idx);
                            }
                            toggleCheck(checkKey);
                          }}
                        >
                          <div className="story-check-top">
                            <span className="story-check-badge">
                              <HelpCircle size={13} />
                              <span>Quick check</span>
                            </span>
                            <span className="story-check-cta">
                              {isCheckOpen ? 'Hide answer' : 'Tap to reveal'}
                            </span>
                          </div>
                          <div className="story-check-question">{step.check.question}</div>
                        </button>

                        {isCheckOpen && (
                          <div className="story-check-answer" data-testid="story-check-answer">
                            {step.check.answer}
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {childBranches.length > 0 && (
          <section className="story-deeper-section" aria-label="Sub-diagrams">
            <div className="story-section-bar">
              <span className="story-section-label">
                <Layers size={13} />
                <span>Explore Deeper</span>
              </span>
            </div>

            <div className="story-deeper-list">
              {childBranches.map((branch) => {
                const childTitle =
                  branch.childFile.title?.trim() ||
                  branch.componentLabel ||
                  graphTitleFromPath(branch.childFile.path);
                return (
                  <button
                    key={`${branch.nodeId}-${branch.childFile.id}`}
                    type="button"
                    className="story-deeper-card"
                    onClick={() => onDrillToPath(branch.childFile.path)}
                  >
                    <div className="story-deeper-text">
                      <span className="story-deeper-title">{childTitle}</span>
                      {branch.componentLabel && branch.componentLabel !== childTitle && (
                        <span className="story-deeper-sub">Inside {branch.componentLabel}</span>
                      )}
                    </div>
                    <ArrowUpRight size={15} className="story-deeper-arrow" />
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>

      <div
        className="story-resizer"
        onMouseDown={(e) => {
          dragOriginWidthRef.current = width;
          startResizeDrag(e);
        }}
      />
    </aside>
  );
}
