import { Plus, Trash2 } from 'lucide-react';
import type { ChartRecord, MermaidTemplate } from '../../src/shared/types';

interface SidebarProps {
  open: boolean;
  tab: 'charts' | 'templates';
  onChangeTab: (tab: 'charts' | 'templates') => void;
  search: string;
  onChangeSearch: (q: string) => void;
  charts: ChartRecord[];
  templates: MermaidTemplate[];
  activeChartId: string | null;
  onSelectChart: (id: string) => void;
  onDeleteChart: (id: string) => void;
  onSelectTemplate: (template: MermaidTemplate) => void;
  onNewChart: () => void;
}

export function Sidebar({
  open,
  tab,
  onChangeTab,
  search,
  onChangeSearch,
  charts,
  templates,
  activeChartId,
  onSelectChart,
  onDeleteChart,
  onSelectTemplate,
  onNewChart,
}: SidebarProps) {
  return (
    <aside className={`sidebar ${open ? '' : 'collapsed'}`}>
      <div className="sidebar-inner">
        <div className="sidebar-top">
          <div className="sidebar-header-row">
            <div className="segmented-track compact">
              <span
                className={`segmented-thumb ${tab === 'templates' ? 'right' : ''}`}
              />
              <button
                className={`segmented-btn ${tab === 'charts' ? 'active' : ''}`}
                onClick={() => onChangeTab('charts')}
              >
                Charts
              </button>
              <button
                className={`segmented-btn ${tab === 'templates' ? 'active' : ''}`}
                onClick={() => onChangeTab('templates')}
              >
                Templates
              </button>
            </div>
            <button className="icon-btn" onClick={onNewChart} title="New diagram">
              <Plus size={15} />
            </button>
          </div>

          {tab === 'charts' && (
            <input
              className="search-input"
              placeholder="Filter..."
              value={search}
              onChange={(e) => onChangeSearch(e.target.value)}
            />
          )}
        </div>

        {tab === 'charts' ? (
          <div key="charts-list" className="sidebar-list">
            {charts.map((c) => (
              <div
                key={c.id}
                className={`chart-item ${activeChartId === c.id ? 'selected' : ''}`}
                onClick={() => onSelectChart(c.id)}
              >
                <div className="chart-item-info">
                  <span className="chart-item-title">{c.title}</span>
                  <span className="chart-item-sub">
                    {c.diagramType || 'diagram'} · v{c.version}
                  </span>
                </div>
                <button
                  className="chart-delete-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteChart(c.id);
                  }}
                  title="Delete"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            {charts.length === 0 && (
              <div style={{ padding: 16, color: 'var(--text-muted)', textAlign: 'center' }}>
                No charts found
              </div>
            )}
          </div>
        ) : (
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
        )}
      </div>
    </aside>
  );
}
