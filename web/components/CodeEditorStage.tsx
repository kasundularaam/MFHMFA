import { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { AlertCircle } from 'lucide-react';
import type { ParseErrorDetail } from '../../src/shared/types';
import {
  createComfortEditorExtension,
  type AppearanceMode,
} from '../theme/comfortTheme';

interface CodeEditorStageProps {
  code: string;
  appearanceMode: AppearanceMode;
  diagramType: string | null;
  parseError: ParseErrorDetail | null;
  onChangeCode: (nextCode: string) => void;
}

export function CodeEditorStage({
  code,
  appearanceMode,
  diagramType,
  parseError,
  onChangeCode,
}: CodeEditorStageProps) {
  const extensions = useMemo(
    () => [markdown(), createComfortEditorExtension(appearanceMode)],
    [appearanceMode]
  );

  return (
    <div className="editor-full">
      <div className="codemirror-wrap">
        <CodeMirror
          value={code}
          height="100%"
          theme="none"
          extensions={extensions}
          onChange={onChangeCode}
          basicSetup={{
            lineNumbers: true,
            highlightActiveLine: true,
            bracketMatching: true,
            foldGutter: false,
          }}
        />
      </div>

      {!parseError && (
        <div className="editor-status-quiet">{diagramType || 'mermaid'} · valid</div>
      )}

      {parseError && (
        <div className="diagnostics-drawer">
          <div
            style={{
              fontWeight: 550,
              color: 'var(--danger-fg)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <AlertCircle size={14} />
            <span>
              {parseError.line
                ? `Line ${parseError.line}${parseError.column ? `:${parseError.column}` : ''} — `
                : ''}
              {parseError.message}
            </span>
          </div>
          {parseError.snippet && <pre className="error-snippet">{parseError.snippet}</pre>}
          {parseError.suggestion && <div className="fix-hint">{parseError.suggestion}</div>}
        </div>
      )}
    </div>
  );
}
