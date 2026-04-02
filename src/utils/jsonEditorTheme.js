import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

export const baseTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--bg-input)',
    color: 'var(--text-primary)',
    fontSize: '13px',
    fontFamily: 'var(--font-mono)',
  },
  '.cm-content': {
    caretColor: 'var(--accent-primary)',
    padding: '12px 4px',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--accent-primary)',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
  },
  '.cm-activeLine': {
    backgroundColor: 'transparent',
  },
  '&.cm-focused .cm-activeLine': {
    backgroundColor: 'rgba(128, 128, 128, 0.08)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-input)',
    color: 'var(--text-tertiary)',
    border: 'none',
    borderRight: '1px solid var(--border-subtle)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
  },
  '&.cm-focused .cm-activeLineGutter': {
    backgroundColor: 'rgba(128, 128, 128, 0.08)',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 8px 0 12px',
    minWidth: '32px',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.6',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--bg-tertiary)',
    border: '1px solid var(--border-primary)',
    color: 'var(--text-tertiary)',
  },
  '.cm-matchingBracket': {
    backgroundColor: 'var(--accent-primary-subtle)',
    outline: '1px solid var(--accent-primary)',
  },
  '.cm-placeholder': {
    color: 'var(--text-tertiary)',
    fontStyle: 'italic',
  },
  '.cm-lintRange-error': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--accent-danger)',
    textDecorationSkipInk: 'none',
    textUnderlineOffset: '2px',
  },
  '.cm-tooltip.cm-tooltip-lint': {
    backgroundColor: 'var(--bg-elevated)',
    border: '1px solid var(--border-primary)',
    borderRadius: 'var(--radius-sm)',
    boxShadow: 'var(--shadow-lg)',
    fontFamily: 'var(--font-sans)',
    fontSize: '12px',
    padding: '0',
  },
  '.cm-diagnostic-error': {
    color: 'var(--accent-danger)',
    borderLeft: '3px solid var(--accent-danger)',
    padding: '6px 10px',
    margin: '0',
  },
  '.cm-gutter-lint': {
    width: '14px',
  },
  '.cm-gutter-lint .cm-gutterElement': {
    padding: '0',
  },
});

export const lightSyntaxHighlight = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.string, color: '#16a34a' },
  { tag: tags.number, color: '#d97706' },
  { tag: tags.bool, color: '#7c3aed' },
  { tag: tags.null, color: '#dc2626' },
  { tag: tags.propertyName, color: '#0284c7' },
  { tag: tags.punctuation, color: '#64748b' },
  { tag: tags.brace, color: '#64748b' },
  { tag: tags.squareBracket, color: '#64748b' },
]));

export const lightSelection = EditorView.theme({
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgba(37, 99, 235, 0.4) !important',
  },
  '.cm-line ::selection': {
    backgroundColor: 'rgba(37, 99, 235, 0.45) !important',
    color: '#1e293b !important',
  },
  '.cm-content': {
    caretColor: 'var(--accent-primary)',
  },
});

export const darkSyntaxHighlight = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.string, color: '#4ade80' },
  { tag: tags.number, color: '#fbbf24' },
  { tag: tags.bool, color: '#a78bfa' },
  { tag: tags.null, color: '#f87171' },
  { tag: tags.propertyName, color: '#38bdf8' },
  { tag: tags.punctuation, color: '#94a3b8' },
  { tag: tags.brace, color: '#94a3b8' },
  { tag: tags.squareBracket, color: '#94a3b8' },
]));

export const darkSelection = EditorView.theme({
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgba(96, 165, 250, 0.45) !important',
  },
  '.cm-line ::selection': {
    backgroundColor: 'rgba(96, 165, 250, 0.5) !important',
    color: '#f1f5f9 !important',
  },
});
