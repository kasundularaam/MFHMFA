import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

export type AppearanceMode = 'dark' | 'light';

export function getMermaidComfortConfig(mode: AppearanceMode) {
  const isDark = mode === 'dark';

  return {
    startOnLoad: false,
    theme: 'base' as const,
    look: 'classic' as const,
    securityLevel: 'antiscript' as const,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif',
    flowchart: {
      htmlLabels: true,
      curve: 'basis' as const,
    },
    themeVariables: {
      darkMode: isDark,
      background: isDark ? '#191918' : '#f5f3ee',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif',
      fontSize: '15px',

      primaryColor: isDark ? '#232321' : '#fcfbf8',
      primaryTextColor: isDark ? '#dedbd3' : '#201f1c',
      primaryBorderColor: isDark ? '#4a4943' : '#b8b2a6',

      secondaryColor: isDark ? '#1f1f1d' : '#edeae2',
      secondaryTextColor: isDark ? '#cfccc4' : '#2e2c28',
      secondaryBorderColor: isDark ? '#3d3c37' : '#c2bdb1',

      tertiaryColor: isDark ? '#1d1d1b' : '#ece9e1',
      tertiaryTextColor: isDark ? '#cfccc4' : '#2e2c28',
      tertiaryBorderColor: isDark ? '#383732' : '#c8c2b6',

      lineColor: isDark ? '#87847b' : '#666259',
      textColor: isDark ? '#dedbd3' : '#201f1c',
      mainBkg: isDark ? '#232321' : '#fcfbf8',
      nodeBorder: isDark ? '#4a4943' : '#b8b2a6',
      clusterBkg: isDark ? '#1d1d1b' : '#eae6dd',
      clusterBorder: isDark ? '#383732' : '#c8c2b6',
      defaultLinkColor: isDark ? '#87847b' : '#666259',
      titleColor: isDark ? '#dedbd3' : '#201f1c',
      edgeLabelBackground: isDark ? '#191918' : '#f5f3ee',

      // Sequence diagrams
      actorBkg: isDark ? '#232321' : '#fcfbf8',
      actorBorder: isDark ? '#45443e' : '#c2bdb2',
      actorTextColor: isDark ? '#d6d3cb' : '#282724',
      actorLineColor: isDark ? '#4f4d47' : '#a6a196',
      signalColor: isDark ? '#8f8c83' : '#5e5b53',
      signalTextColor: isDark ? '#d6d3cb' : '#282724',
      labelBoxBkgColor: isDark ? '#21211f' : '#edeae2',
      labelBoxBorderColor: isDark ? '#3a3934' : '#cbc6bb',
      labelTextColor: isDark ? '#d6d3cb' : '#282724',
      loopTextColor: isDark ? '#b5b2aa' : '#4a4842',
      noteBkgColor: isDark ? '#27251f' : '#f2ede0',
      noteTextColor: isDark ? '#d1ccbf' : '#3d392e',
      noteBorderColor: isDark ? '#454033' : '#d5ccb6',
      activationBkgColor: isDark ? '#2d2d2a' : '#e3dfd5',
      activationBorderColor: isDark ? '#4d4b45' : '#b5b0a3',

      // ER & categorical subtle scales
      attributeBackgroundColorOdd: isDark ? '#222220' : '#fcfbf8',
      attributeBackgroundColorEven: isDark ? '#1d1d1b' : '#f0ede6',
      cScale0: isDark ? '#252926' : '#e6ebe6',
      cScale1: isDark ? '#2a2822' : '#eee9de',
      cScale2: isDark ? '#24272b' : '#e4e8ec',
      cScale3: isDark ? '#2b2525' : '#ece3e2',
    },
  };
}

export function createComfortEditorExtension(mode: AppearanceMode): Extension {
  const isDark = mode === 'dark';

  const bg = isDark ? '#191918' : '#f5f3ee';
  const fg = isDark ? '#d4d1c9' : '#2b2a27';
  const gutterFg = isDark ? '#595751' : '#9c978d';
  const activeLineBg = isDark ? '#20201e' : '#ece9e1';
  const selectionBg = isDark ? '#2f322e' : '#dedad0';
  const cursorColor = isDark ? '#c4c0b6' : '#3d3b36';

  const baseTheme = EditorView.theme(
    {
      '&': {
        backgroundColor: bg,
        color: fg,
      },
      '.cm-content': {
        caretColor: cursorColor,
        padding: '20px 0',
        lineHeight: '1.68',
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: cursorColor,
      },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
        {
          backgroundColor: selectionBg,
        },
      '.cm-panels': {
        backgroundColor: bg,
        color: fg,
      },
      '.cm-activeLine': {
        backgroundColor: activeLineBg,
      },
      '.cm-gutters': {
        backgroundColor: bg,
        color: gutterFg,
        border: 'none',
        paddingLeft: '12px',
        paddingRight: '8px',
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'transparent',
        color: isDark ? '#8f8c83' : '#5e5b53',
      },
      '.cm-foldPlaceholder': {
        backgroundColor: activeLineBg,
        border: 'none',
        color: gutterFg,
      },
    },
    { dark: isDark }
  );

  const highlight = HighlightStyle.define([
    { tag: [t.keyword, t.operatorKeyword, t.modifier], color: isDark ? '#a3b39b' : '#486142' },
    { tag: [t.string, t.special(t.string)], color: isDark ? '#c4ad88' : '#7a5c2e' },
    { tag: [t.number, t.bool, t.null], color: isDark ? '#b89f8d' : '#7c4f38' },
    {
      tag: [t.comment, t.lineComment],
      color: isDark ? '#6c6a63' : '#8d887e',
      fontStyle: 'italic',
    },
    { tag: [t.heading, t.strong], color: isDark ? '#e0ddd5' : '#1c1b19', fontWeight: '600' },
    { tag: [t.punctuation, t.bracket, t.separator], color: isDark ? '#858279' : '#78736a' },
    {
      tag: [t.variableName, t.propertyName, t.typeName],
      color: isDark ? '#9eb0b8' : '#385663',
    },
  ]);

  return [baseTheme, syntaxHighlighting(highlight)];
}
