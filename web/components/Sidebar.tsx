import { useEffect, useRef, useState } from 'react';
import {
  LayoutTemplate,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { ChartRecord, MermaidTemplate } from '../../src/shared/types';

interface SidebarProps {
  open: boolean;
  onToggleOpen: () => void;
  onExpandOpen: () => void;
  tab: 'charts' | 'templates';
  onChangeTab: (tab: 'charts' | 'templates') => void;
  search: string;
  onChangeSearch: (q: string) => void;
  charts: ChartRecord[];
  templates: MermaidTemplate[];
  activeChartId: string | null;
  onSelectChart: (id: string) => void;
  onRenameChart: (id: string, nextTitle: string) => Promise<void> | void;
  onDeleteChart: (id: string) => void;
  onSelectTemplate: (template: MermaidTemplate) => void;
  onNewChart: () => void;
}

interface ItemMenuState {
  chartId: string;
  top: number;
  left: number;
}

export function Sidebar({
  open,
  onToggleOpen,
  onExpandOpen,
  tab,
  onChangeTab,
  search,
  onChangeSearch,
  charts,
  templates,
  activeChartId,
  onSelectChart,
  onRenameChart,
  onDeleteChart,
  onSelectTemplate,
  onNewChart,
}: SidebarProps) {
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [itemMenu, setItemMenu] = useState<ItemMenuState | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  // Close item menu on outside click or Escape
  useEffect(() => {
    if (!itemMenu) return;
    const close = () => setItemMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [itemMenu]);

  // Focus inline rename input when activated
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const handleClickSearchAction = () => {
    if (!open) {
      onExpandOpen();
      onChangeTab('charts');
      setSearchExpanded(true);
      setTimeout(() => searchInputRef.current?.focus(), 120);
      return;
    }

    onChangeTab('charts');
    if (searchExpanded && !search) {
      setSearchExpanded(false);
    } else {
      setSearchExpanded(true);
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  };

  const handleClickTemplatesAction = () => {
    if (!open) {
      onExpandOpen();
      onChangeTab('templates');
      return;
    }
    onChangeTab(tab === 'templates' ? 'charts' : 'templates');
  };

  const commitRename = async (id: string) => {
    const trimmed = renameDraft.trim();
    setRenamingId(null);
    if (!trimmed) return;
    const original = charts.find((c) => c.id === id)?.title;
    if (trimmed !== original) {
      await onRenameChart(id, trimmed);
    }
  };

  return (
    <aside className={`sidebar ${open ? '' : 'collapsed'}`}>
      {/* Vertical Navigation & Actions */}
      <div className="sidebar-nav">
        <div className="sidebar-toggle-row">
          <button
            className="sidebar-action-btn icon-only-collapse"
            onClick={onToggleOpen}
            title={`${open ? 'Collapse' : 'Expand'} sidebar (Ctrl+B)`}
          >
            <span className="sidebar-action-icon">
              {open ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
            </span>
          </button>
        </div>

        <button
          className="sidebar-action-btn"
          onClick={onNewChart}
          title="New chart"
        >
          <span className="sidebar-action-icon">
            <Plus size={16} />
          </span>
          <span className="sidebar-action-label">New chart</span>
        </button>

        <button
          className={`sidebar-action-btn ${open && tab === 'templates' ? 'active' : ''}`}
          onClick={handleClickTemplatesAction}
          title="Templates"
        >
          <span className="sidebar-action-icon">
            <LayoutTemplate size={15} />
          </span>
          <span className="sidebar-action-label">Templates</span>
        </button>

        <button
          className={`sidebar-action-btn ${
            open && (searchExpanded || Boolean(search)) ? 'active' : ''
          }`}
          onClick={handleClickSearchAction}
          title="Search charts"
        >
          <span className="sidebar-action-icon">
            <Search size={15} />
          </span>
          <span className="sidebar-action-label">Search</span>
        </button>

        {open && (searchExpanded || Boolean(search)) && (
          <div className="sidebar-search-box">
            <input
              ref={searchInputRef}
              className="search-input"
              placeholder="Search history..."
              value={search}
              onChange={(e) => {
                onChangeTab('charts');
                onChangeSearch(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  onChangeSearch('');
                  setSearchExpanded(false);
                }
              }}
            />
            {search && (
              <button
                className="search-clear-btn"
                onClick={() => {
                  onChangeSearch('');
                  searchInputRef.current?.focus();
                }}
                title="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Expandable History / Templates Body */}
      <div className="sidebar-body">
        {tab === 'charts' ? (
          <>
            <div className="sidebar-section-header">
              <span>History</span>
            </div>

            <div
              key="charts-list"
              className="sidebar-list"
              onScroll={() => itemMenu && setItemMenu(null)}
            >
              {charts.map((c) => {
                const isRenaming = renamingId === c.id;
                const isMenuOpen = itemMenu?.chartId === c.id;

                return (
                  <div
                    key={c.id}
                    className={`chart-item ${activeChartId === c.id ? 'selected' : ''} ${
                      isMenuOpen ? 'menu-open' : ''
                    }`}
                    onClick={() => {
                      if (!isRenaming) onSelectChart(c.id);
                    }}
                  >
                    <div className="chart-item-info">
                      {isRenaming ? (
                        <input
                          ref={renameInputRef}
                          className="inline-rename-input"
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={() => commitRename(c.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitRename(c.id);
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              setRenamingId(null);
                            }
                          }}
                        />
                      ) : (
                        <span className="chart-item-title">{c.title}</span>
                      )}
                      <span className="chart-item-sub">
                        {c.diagramType || 'diagram'} · v{c.version}
                      </span>
                    </div>

                    {!isRenaming && (
                      <button
                        className={`chart-menu-btn ${isMenuOpen ? 'active' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isMenuOpen) {
                            setItemMenu(null);
                            return;
                          }
                          const rect = e.currentTarget.getBoundingClientRect();
                          const menuHeight = 76;
                          const fitsBelow = rect.bottom + menuHeight + 12 < window.innerHeight;
                          setItemMenu({
                            chartId: c.id,
                            top: fitsBelow ? rect.bottom + 4 : rect.top - menuHeight - 4,
                            left: Math.min(rect.left, window.innerWidth - 156),
                          });
                        }}
                        title="Chart options"
                      >
                        <Menu size={14} />
                      </button>
                    )}
                  </div>
                );
              })}

              {charts.length === 0 && (
                <div style={{ padding: 16, color: 'var(--text-muted)', textAlign: 'center' }}>
                  No charts found
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="sidebar-section-header">
              <span>Templates</span>
              <button
                className="sidebar-section-link"
                onClick={() => onChangeTab('charts')}
              >
                History
              </button>
            </div>

            <div key="templates-list" className="sidebar-list">
              {templates.map((tpl) => (
                <div
                  key={tpl.id}
                  className="chart-item"
                  onClick={() => onSelectTemplate(tpl)}
                >
                  <div className="chart-item-info">
                    <span className="chart-item-title">{tpl.name}</span>
                    <span className="chart-item-sub">{tpl.category}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Floating Item Hamburger Menu (Rename / Delete) */}
      {itemMenu && (
        <div
          className="dropdown-menu item-context-menu"
          style={{
            position: 'fixed',
            top: itemMenu.top,
            left: itemMenu.left,
            right: 'auto',
            minWidth: 144,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="dropdown-item"
            onClick={() => {
              const target = charts.find((c) => c.id === itemMenu.chartId);
              if (target) {
                setRenameDraft(target.title);
                setRenamingId(target.id);
              }
              setItemMenu(null);
            }}
          >
            <Pencil size={13} /> Rename
          </button>
          <button
            className="dropdown-item danger"
            onClick={() => {
              const idToDelete = itemMenu.chartId;
              setItemMenu(null);
              onDeleteChart(idToDelete);
            }}
          >
            <Trash2 size={13} /> Delete
          </button>
        </div>
      )}
    </aside>
  );
}
