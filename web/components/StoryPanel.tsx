import {
  CheckCircle2,
  ChevronRight,
  GitBranch,
  HelpCircle,
  Terminal,
  Workflow,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { DiagramComprehensionGuide, DiagramWalkthroughFlow } from '../../src/shared/types';
import type { GraphBreadcrumbHop, VfsGraphFile } from '../../src/shared/vfs';
import { graphTitleFromPath } from '../../src/shared/vfsPath';

interface StoryPanelProps {
  chartKey: string;
  activeFile: VfsGraphFile | null;
  minWidth: number;
  guide?: DiagramComprehensionGuide;
  flows: DiagramWalkthroughFlow[];
  currentFlow: DiagramWalkthroughFlow | null;
  activeStepIndex: number | null;
  breadcrumbHops: GraphBreadcrumbHop[];
  graphPanelOpen: boolean;
  onOpenGraphPanel: () => void;
  onChangeFlowId: (flowId: string | null) => void;
  onChangeStepIndex: (next: number | null) => void;
  onJumpToAncestor: (fileId: string) => void;
}

function stripLeadingStepNumber(rawTitle: string): string {
  const cleaned = rawTitle.replace(/^\s*\d+\s*[.):-]\s*/, '').trim();
  return cleaned || rawTitle;
}

export function StoryPanel({
  chartKey,
  activeFile,
  minWidth,
  guide,
  flows,
  currentFlow,
  activeStepIndex,
  breadcrumbHops,
  graphPanelOpen,
  onOpenGraphPanel,
  onChangeFlowId,
  onChangeStepIndex,
  onJumpToAncestor,
}: StoryPanelProps) {
  const [revealedChecks, setRevealedChecks] = useState<Set<string>>(() => new Set());
  const [lastOpenedCheckKey, setLastOpenedCheckKey] = useState<string | null>(null);
  const stepRefs = useRef<Map<number, HTMLElement>>(new Map());
  const checkRefs = useRef<Map<string, HTMLDivElement>>(new Map());

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

  if (!activeFile) {
    return (
      <main
        className="story-panel"
        style={{ minWidth: `${minWidth}px` }}
        data-testid="comprehension-dock"
        aria-label="Reading guide"
      >
        <div className="story-empty-stage">
          <Workflow size={20} className="empty-stage-icon" />
          <div className="empty-stage-watermark">
            Ask your AI agent to explain a concept, paper, codebase, bug, or design tradeoff
          </div>
        </div>
      </main>
    );
  }

  const steps = currentFlow?.steps ?? [];
  const hasMultipleFlows = flows.length > 1;
  const docTitle = activeFile.title?.trim() || graphTitleFromPath(activeFile.path);
  const hasGuideBody = Boolean(guide?.gist || steps.length > 0);

  return (
    <main
      className="story-panel"
      style={{ minWidth: `${minWidth}px` }}
      data-testid="comprehension-dock"
      aria-label="Reading guide"
    >
      <header className="story-title-bar" data-testid="story-title-bar">
        {breadcrumbHops.length > 0 ? (
          <nav
            className="story-breadcrumb"
            data-testid="canvas-breadcrumb"
            aria-label="Diagram breadcrumb"
          >
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
                  >
                    {parentLabel}
                  </button>
                  <ChevronRight size={13} className="crumb-sep" />
                </span>
              );
            })}
            <h1 className="story-doc-title crumb-current">{docTitle}</h1>
          </nav>
        ) : (
          <h1 className="story-doc-title">{docTitle}</h1>
        )}
      </header>

      <div className="story-scroll-container">
        {guide?.gist && (
          <div
            className={`story-overview ${
              !hasMultipleFlows && steps.length > 0 ? 'has-divider' : ''
            } ${activeStepIndex !== null ? 'can-reset' : ''}`}
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

        {!hasGuideBody && (
          <div className="story-empty-guide">
            <p className="story-empty-guide-note">
              No walkthrough steps are attached to this view yet. Ask your AI agent to add a
              step-by-step guide, or inspect the diagram in the Graph panel.
            </p>
            {!graphPanelOpen && (
              <button type="button" className="btn" onClick={onOpenGraphPanel}>
                <Workflow size={14} />
                <span>Open Graph panel</span>
              </button>
            )}
          </div>
        )}

        {(hasMultipleFlows || steps.length > 0) && (
          <section className="story-steps-section" aria-label="Walkthrough steps">
            {hasMultipleFlows && (
              <div
                className="story-flow-tabs"
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
                      title={flow.label}
                      className={`story-flow-tab ${isSelected ? 'active' : ''}`}
                      onClick={() => onChangeFlowId(flow.id)}
                    >
                      <GitBranch size={13} className="story-flow-tab-icon" />
                      <span>{flow.label}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {steps.length > 0 && (
              <ol className="story-steps-list">
                {steps.map((step, idx) => {
                  const isStepActive = activeStepIndex === idx;
                  const isStepDimmed = activeStepIndex !== null && !isStepActive;
                  const cleanTitle = stripLeadingStepNumber(step.title);
                  const checkKey = `${chartKey}::${currentFlow?.id ?? 'default'}::${idx}`;
                  const isCheckOpen = revealedChecks.has(checkKey);

                  return (
                    <li
                      key={`${currentFlow?.id ?? 'flow'}-${idx}`}
                      className="story-step-entry"
                    >
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
                            {idx + 1}.
                          </span>
                          <h2 className="story-step-title">{cleanTitle}</h2>
                        </div>

                        <div className="story-step-body">
                          <p className="story-step-caption">{step.caption}</p>

                          {step.trace && (
                            <div className="story-step-trace" data-testid="story-step-trace">
                              <Terminal size={12} className="story-trace-icon" />
                              <span>{step.trace}</span>
                            </div>
                          )}

                          {step.check && (
                            <div
                              ref={(el) => {
                                if (el) checkRefs.current.set(checkKey, el);
                                else checkRefs.current.delete(checkKey);
                              }}
                              className={`story-check-inline ${isCheckOpen ? 'open' : ''}`}
                              data-testid="story-step-check"
                              onClick={(e) => e.stopPropagation()}
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
                                <ChevronRight size={13} className="story-check-caret" />
                                <HelpCircle size={13} className="story-check-icon" />
                                <span className="story-check-question">
                                  {step.check.question}
                                </span>
                              </button>

                              {isCheckOpen && (
                                <div
                                  className="story-check-answer"
                                  data-testid="story-check-answer"
                                >
                                  <CheckCircle2 size={13} className="story-answer-icon" />
                                  <span>{step.check.answer}</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </article>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
