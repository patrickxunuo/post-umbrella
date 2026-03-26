/**
 * CodeMirror extension for {{variable}} highlighting and autocomplete
 * in the JSON body editor.
 */
import { EditorView, Decoration, ViewPlugin } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { autocompletion } from '@codemirror/autocomplete';

// Regex to match {{variableName}}
const VAR_REGEX = /\{\{([^}]+)\}\}/g;

/**
 * Creates a decoration plugin that highlights {{variable}} patterns
 * with colored marks based on source (env vs collection).
 */
function createHighlightPlugin(getVariableSource) {
  const envMark = Decoration.mark({ class: 'cm-env-var resolved' });
  const collectionMark = Decoration.mark({ class: 'cm-env-var collection' });
  const unresolvedMark = Decoration.mark({ class: 'cm-env-var unresolved' });

  return ViewPlugin.fromClass(class {
    decorations;

    constructor(view) {
      this.decorations = this.build(view);
    }

    update(update) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = this.build(update.view);
      }
    }

    build(view) {
      const builder = new RangeSetBuilder();
      const doc = view.state.doc.toString();
      let match;
      VAR_REGEX.lastIndex = 0;
      while ((match = VAR_REGEX.exec(doc)) !== null) {
        const from = match.index;
        const to = from + match[0].length;
        const varName = match[1].trim();
        const source = getVariableSource(varName);
        if (source === 'env') {
          builder.add(from, to, envMark);
        } else if (source === 'collection') {
          builder.add(from, to, collectionMark);
        } else {
          builder.add(from, to, unresolvedMark);
        }
      }
      return builder.finish();
    }
  }, {
    decorations: v => v.decorations,
  });
}

/**
 * Creates an autocompletion source that triggers on {{ and suggests variables.
 */
function createAutocompleteSource(getVariables) {
  return (context) => {
    // Look backwards for {{ that isn't closed
    const beforeCursor = context.state.doc.sliceString(0, context.pos);
    const lastOpen = beforeCursor.lastIndexOf('{{');
    if (lastOpen === -1) return null;

    // Check there's no }} between {{ and cursor
    const afterOpen = beforeCursor.slice(lastOpen);
    if (afterOpen.includes('}}')) return null;

    const filterText = beforeCursor.slice(lastOpen + 2);
    // Don't trigger if filter has spaces or special chars
    if (/[^a-zA-Z0-9_-]/.test(filterText)) return null;

    const variables = getVariables();
    if (!variables || variables.length === 0) return null;

    const filter = filterText.toLowerCase();

    // Check if }} exists after cursor and consume it
    const afterCursor = context.state.doc.sliceString(context.pos, Math.min(context.pos + 2, context.state.doc.length));
    const to = afterCursor.startsWith('}}') ? context.pos + 2 : context.pos;

    return {
      from: lastOpen,
      to,
      options: variables
        .filter(v => v.key.toLowerCase().includes(filter))
        .map(v => ({
          label: `{{${v.key}}}`,
          detail: v.source === 'collection' ? 'C' : 'E',
          info: v.value || '(empty)',
          apply: `{{${v.key}}}`,
          boost: v.source === 'env' ? 1 : 0,
        })),
    };
  };
}

/**
 * Theme for variable highlights inside CodeMirror
 */
const envVarTheme = EditorView.baseTheme({
  '.cm-env-var': {
    fontWeight: '600',
    borderRadius: '2px',
    padding: '0 1px',
  },
  '.cm-env-var.resolved': {
    color: 'var(--accent-primary)',
    backgroundColor: 'rgba(var(--accent-primary-rgb), 0.15)',
  },
  '.cm-env-var.collection': {
    color: 'var(--accent-warning)',
    backgroundColor: 'rgba(var(--accent-warning-rgb, 245, 158, 11), 0.15)',
  },
  '.cm-env-var.unresolved': {
    color: 'var(--accent-warning)',
    backgroundColor: 'rgba(var(--accent-warning-rgb, 245, 158, 11), 0.15)',
    textDecoration: 'underline wavy',
  },
  // Autocomplete dropdown styling
  '.cm-tooltip-autocomplete': {
    fontFamily: 'var(--font-mono) !important',
    fontSize: '12px !important',
  },
  '.cm-completionDetail': {
    fontWeight: '700',
    marginLeft: '8px',
    fontSize: '9px',
    opacity: '0.7',
  },
  '.cm-completionInfo': {
    fontSize: '11px',
    color: 'var(--text-tertiary)',
  },
});

/**
 * Creates a hover plugin that detects mouse over {{variable}} and calls onHover callback.
 */
function createHoverPlugin(onHover, onLeave) {
  return EditorView.domEventHandlers({
    mousemove(e, view) {
      if (!onHover) return;
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos === null) return;
      const doc = view.state.doc.toString();
      VAR_REGEX.lastIndex = 0;
      let match;
      while ((match = VAR_REGEX.exec(doc)) !== null) {
        const from = match.index;
        const to = from + match[0].length;
        if (pos >= from && pos <= to) {
          // Get the visual rect of the variable range
          const startCoords = view.coordsAtPos(from);
          const endCoords = view.coordsAtPos(to);
          if (startCoords && endCoords) {
            onHover({
              varName: match[1].trim(),
              rect: { left: startCoords.left, right: endCoords.right, top: startCoords.top, bottom: startCoords.bottom },
            });
          }
          return;
        }
      }
      onLeave?.();
    },
    mouseleave() {
      onLeave?.();
    },
  });
}

/**
 * Creates the full extension array for a CodeMirror editor.
 *
 * @param {Object} options
 * @param {Object} options.activeEnvironment - Active environment with .variables array
 * @param {Array} options.collectionVariables - Collection variables array
 * @param {Function} options.onHover - Callback: ({ varName, rect }) => void
 * @param {Function} options.onLeave - Callback: () => void
 * @returns {Array} CodeMirror extensions
 */
export function createEnvVariableExtensions({ activeEnvironment, collectionVariables, onHover, onLeave }) {
  const getVariableSource = (varName) => {
    if (activeEnvironment?.variables?.some(v => v.key === varName && v.enabled)) return 'env';
    if (collectionVariables?.some(v => v.key === varName && v.enabled)) return 'collection';
    return null;
  };

  const getVariables = () => {
    const result = [];
    const seenKeys = new Set();

    if (activeEnvironment?.variables) {
      for (const v of activeEnvironment.variables) {
        if (v.enabled && v.key) {
          result.push({ key: v.key, value: v.value || v.current_value || v.initial_value || '', source: 'env' });
          seenKeys.add(v.key);
        }
      }
    }
    if (collectionVariables) {
      for (const v of collectionVariables) {
        if (v.enabled && v.key && !seenKeys.has(v.key)) {
          result.push({ key: v.key, value: v.value || v.current_value || v.initial_value || '', source: 'collection' });
        }
      }
    }
    return result;
  };

  return [
    createHighlightPlugin(getVariableSource),
    createHoverPlugin(onHover, onLeave),
    envVarTheme,
    autocompletion({
      override: [createAutocompleteSource(getVariables)],
      activateOnTyping: true,
    }),
  ];
}
