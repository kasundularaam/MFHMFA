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
      background: isDark ? '#191918' : '#f5f1e9',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif',
      fontSize: '15px',

      // Resting boxes meet WCAG 1.4.11 >= 3.1:1 border contrast without pure-white glare
      primaryColor: isDark ? '#252320' : '#fbf8f3',
      primaryTextColor: isDark ? '#dfdbd3' : '#23201a',
      primaryBorderColor: isDark ? '#6b6761' : '#8d877c',

      secondaryColor: isDark ? '#211f1c' : '#ede8de',
      secondaryTextColor: isDark ? '#d4d0c7' : '#2e2b25',
      secondaryBorderColor: isDark ? '#5d5953' : '#999387',

      tertiaryColor: isDark ? '#1f1d1a' : '#ebe6dc',
      tertiaryTextColor: isDark ? '#d4d0c7' : '#2e2b25',
      tertiaryBorderColor: isDark ? '#54514b' : '#a39d91',

      lineColor: isDark ? '#97938c' : '#5e5950',
      textColor: isDark ? '#dfdbd3' : '#23201a',
      mainBkg: isDark ? '#252320' : '#fbf8f3',
      nodeBorder: isDark ? '#6b6761' : '#8d877c',
      clusterBkg: isDark ? '#1e1d1a' : '#ece7dd',
      clusterBorder: isDark ? '#54514b' : '#a6a094',
      defaultLinkColor: isDark ? '#97938c' : '#5e5950',
      titleColor: isDark ? '#dfdbd3' : '#23201a',
      edgeLabelBackground: isDark ? '#191918' : '#f5f1e9',

      // Sequence diagrams
      actorBkg: isDark ? '#252320' : '#fbf8f3',
      actorBorder: isDark ? '#6b6761' : '#8d877c',
      actorTextColor: isDark ? '#dfdbd3' : '#23201a',
      actorLineColor: isDark ? '#65615b' : '#8f897e',
      signalColor: isDark ? '#9c9890' : '#565249',
      signalTextColor: isDark ? '#dfdbd3' : '#23201a',
      labelBoxBkgColor: isDark ? '#23211e' : '#ede8de',
      labelBoxBorderColor: isDark ? '#54514b' : '#a39d91',
      labelTextColor: isDark ? '#d6d2c9' : '#2b2822',
      loopTextColor: isDark ? '#c4c0b7' : '#434039',
      noteBkgColor: isDark ? '#2a261e' : '#f3ecdc',
      noteTextColor: isDark ? '#dbd4c5' : '#3a3427',
      noteBorderColor: isDark ? '#5c523e' : '#bfae8c',
      activationBkgColor: isDark ? '#302e2a' : '#e3ddd1',
      activationBorderColor: isDark ? '#6b6761' : '#969084',

      // ER & categorical subtle low-chroma scales
      attributeBackgroundColorOdd: isDark ? '#252320' : '#fbf8f3',
      attributeBackgroundColorEven: isDark ? '#1f1d1a' : '#efeae0',
      cScale0: isDark ? '#222b2e' : '#e6eff2',
      cScale1: isDark ? '#2b2820' : '#f0eadc',
      cScale2: isDark ? '#252730' : '#eaeaf2',
      cScale3: isDark ? '#242b26' : '#e8efe9',
    },
  };
}

export function createComfortEditorExtension(mode: AppearanceMode): Extension {
  const isDark = mode === 'dark';

  const bg = isDark ? '#191918' : '#f5f1e9';
  const fg = isDark ? '#dbd7cf' : '#28251f';
  const gutterFg = isDark ? '#7d7971' : '#7f7a70';
  const activeLineBg = isDark ? '#21201d' : '#ece7dd';
  const selectionBg = isDark ? '#28363c' : '#d8e4e9';
  const cursorColor = isDark ? '#81b5ca' : '#296177';

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
        color: isDark ? '#b3afa7' : '#4f4b44',
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
    { tag: [t.keyword, t.operatorKeyword, t.modifier], color: isDark ? '#8ab8c9' : '#265d73' },
    { tag: [t.string, t.special(t.string)], color: isDark ? '#d1b588' : '#73511c' },
    { tag: [t.number, t.bool, t.null], color: isDark ? '#cfa693' : '#7d4630' },
    {
      tag: [t.comment, t.lineComment],
      color: isDark ? '#8d8981' : '#706b62',
      fontStyle: 'italic',
    },
    { tag: [t.heading, t.strong], color: isDark ? '#e6e2da' : '#1c1915', fontWeight: '600' },
    { tag: [t.punctuation, t.bracket, t.separator], color: isDark ? '#9a968e' : '#666158' },
    {
      tag: [t.variableName, t.propertyName, t.typeName],
      color: isDark ? '#a4b5d6' : '#3d4f78',
    },
  ]);

  return [baseTheme, syntaxHighlighting(highlight)];
}
