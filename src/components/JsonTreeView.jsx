import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, ChevronDown, ChevronRight, Copy } from 'lucide-react';
import { findRowIndex, flattenVisibleRows, nodeToJsonText } from '../utils/jsonTree';
import { nodeSearchText } from '../utils/jsonSearch';

const ROW_HEIGHT = 20;
const OVERSCAN = 20;
const BODY_PADDING = 8;
const COPIED_FEEDBACK_MS = 1500;
const ELLIPSIS = '…';
const NO_ROWS = [];

function escapeInner(text) {
  return JSON.stringify(text).slice(1, -1);
}

function identity(text) {
  return text;
}

function splitMatches(text, query) {
  const q = query.toLowerCase();
  if (!q) return null;
  const lower = text.toLowerCase();
  if (!lower.includes(q)) return null;
  const parts = [];
  let cursor = 0;
  let ordinal = 0;
  let idx;
  while ((idx = lower.indexOf(q, cursor)) !== -1) {
    if (idx > cursor) parts.push({ text: text.slice(cursor, idx), hit: false, ordinal: -1 });
    parts.push({ text: text.slice(idx, idx + q.length), hit: true, ordinal: ordinal++ });
    cursor = idx + q.length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false, ordinal: -1 });
  return parts;
}

// Renders `text` with search hits wrapped in <mark>. For quoted (string) text
// the raw value is matched and each part is escaped afterwards, so ordinals
// stay relative to the raw value while the displayed token remains the JSON form.
function HighlightedText({ text, query, activeOrdinal, quoted }) {
  const parts = query ? splitMatches(text, query) : null;
  if (!parts) return quoted ? JSON.stringify(text) : text;
  const render = quoted ? escapeInner : identity;
  return (
    <>
      {quoted ? '"' : null}
      {parts.map((part, i) =>
        part.hit ? (
          <mark
            key={i}
            className={
              part.ordinal === activeOrdinal
                ? 'response-search-highlight response-search-highlight--active'
                : 'response-search-highlight'
            }
            data-search-hit="true"
          >
            {render(part.text)}
          </mark>
        ) : (
          <Fragment key={i}>{render(part.text)}</Fragment>
        )
      )}
      {quoted ? '"' : null}
    </>
  );
}

function CopyControl({ node }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(nodeToJsonText(node));
    } catch {
      return;
    }
    setCopied(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
  };

  return (
    <button
      type="button"
      className="json-tree-copy"
      data-testid="json-tree-copy"
      data-copied={copied ? 'true' : 'false'}
      aria-label="Copy"
      title="Copy"
      onClick={handleClick}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

const Row = memo(function Row({ row, index, start, measureRef, highlightQuery, activeMatch, onToggle }) {
  const { kind, node, depth, expanded } = row;
  const isArray = node.type === 'array';
  const openBracket = isArray ? '[' : '{';
  const closeBracket = isArray ? ']' : '}';
  const showComma = !node.isLast && (kind !== 'open' || !expanded);
  const activeKeyOrdinal = activeMatch && activeMatch.kind === 'key' ? activeMatch.ordinal : -1;
  const activeValueOrdinal = activeMatch && activeMatch.kind === 'value' ? activeMatch.ordinal : -1;

  return (
    <div
      ref={measureRef}
      data-index={index}
      className="json-tree-row"
      data-testid="json-tree-row"
      data-path={node.id}
      data-depth={depth}
      data-kind={kind}
      data-expanded={kind === 'open' ? (expanded ? 'true' : 'false') : undefined}
      style={{ transform: `translateY(${start}px)`, paddingLeft: `${12 + depth * 16}px` }}
    >
      {kind === 'open' ? (
        <button
          type="button"
          className="json-tree-arrow"
          data-testid="json-tree-arrow"
          aria-expanded={expanded ? 'true' : 'false'}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          onClick={() => onToggle(node.id)}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
      ) : (
        <span className="json-tree-arrow-spacer" aria-hidden="true" />
      )}
      {kind !== 'close' && node.keyKind === 'object' && (
        <>
          <span className="json-tree-key" data-testid="json-tree-key">
            <HighlightedText text={String(node.key)} query={highlightQuery} activeOrdinal={activeKeyOrdinal} quoted />
          </span>
          <span className="json-tree-colon">: </span>
        </>
      )}
      {kind !== 'close' && node.keyKind === 'array' && (
        <>
          <span className="json-tree-index" data-testid="json-tree-index">{node.key}</span>
          <span className="json-tree-colon json-tree-colon--index">: </span>
        </>
      )}
      {kind === 'open' && (
        <>
          <span className="json-tree-bracket">{openBracket}</span>
          {!expanded && (
            <>
              <span className="json-tree-ellipsis">{ELLIPSIS}</span>
              <span className="json-tree-bracket">{closeBracket}</span>
            </>
          )}
          <span className="json-tree-count" data-testid="json-tree-count">
            {node.childCount === 1 ? '1 item' : `${node.childCount} items`}
          </span>
        </>
      )}
      {kind === 'leaf' && (
        <span className="json-tree-value" data-testid="json-tree-value" data-type={node.type}>
          <HighlightedText
            text={nodeSearchText(node)}
            query={highlightQuery}
            activeOrdinal={activeValueOrdinal}
            quoted={node.type === 'string'}
          />
        </span>
      )}
      {kind === 'empty' && <span className="json-tree-bracket">{openBracket + closeBracket}</span>}
      {kind === 'close' && <span className="json-tree-bracket">{closeBracket}</span>}
      {showComma && <span className="json-tree-comma">,</span>}
      {kind !== 'close' && <CopyControl node={node} />}
    </div>
  );
});

export function JsonTreeView({ tree, expansion, onToggleNode, forcedIds, highlightQuery, activeMatch, onCopy }) {
  const scrollRef = useRef(null);
  const rows = useMemo(
    () => (tree ? flattenVisibleRows(tree, expansion, forcedIds) : NO_ROWS),
    [tree, expansion, forcedIds]
  );
  const activeIndex = useMemo(() => (activeMatch ? findRowIndex(rows, activeMatch.id) : -1), [rows, activeMatch]);

  const toggleRef = useRef(onToggleNode);
  useEffect(() => {
    toggleRef.current = onToggleNode;
  }, [onToggleNode]);
  const handleToggle = useCallback((id) => {
    toggleRef.current?.(id);
  }, []);

  // The virtualizer memoizes its measurements on this callback's identity, so
  // it must only change when the rows do.
  const getItemKey = useCallback((index) => rows[index].rowId, [rows]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    paddingStart: BODY_PADDING,
    paddingEnd: BODY_PADDING,
    getItemKey,
  });

  // A new body starts at the top; the scroll element itself is reused.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [tree]);

  // Bring the active search match into view. Re-run when its row index moves
  // (rows above it toggled), but not when unrelated rows change.
  const lastScrollRef = useRef(null);
  useEffect(() => {
    if (!activeMatch) {
      lastScrollRef.current = null;
      return;
    }
    if (activeIndex < 0) return;
    const last = lastScrollRef.current;
    if (last && last.match === activeMatch && last.index === activeIndex) return;
    lastScrollRef.current = { match: activeMatch, index: activeIndex };
    virtualizer.scrollToIndex(activeIndex, { align: 'center' });
    // Second pass once the newly mounted rows have been measured.
    requestAnimationFrame(() => {
      if (scrollRef.current) virtualizer.scrollToIndex(activeIndex, { align: 'center' });
    });
  }, [activeMatch, activeIndex, virtualizer]);

  const items = virtualizer.getVirtualItems();
  const query = highlightQuery || '';

  return (
    <div
      ref={scrollRef}
      className="json-view-wrapper"
      data-testid="json-tree"
      data-total-rows={rows.length}
      onCopy={onCopy}
    >
      <div className="json-tree-body" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {items.map((item) => {
          const row = rows[item.index];
          const rowActive =
            activeMatch && row.kind !== 'close' && activeMatch.id === row.node.id ? activeMatch : null;
          return (
            <Row
              key={item.key}
              row={row}
              index={item.index}
              start={item.start}
              measureRef={virtualizer.measureElement}
              highlightQuery={query}
              activeMatch={rowActive}
              onToggle={handleToggle}
            />
          );
        })}
      </div>
    </div>
  );
}
