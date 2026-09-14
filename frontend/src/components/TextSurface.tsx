import { useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { EditorState, RangeSetBuilder, Transaction } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { headingLevel } from '../lib/headings';

export interface TextSurfaceHandle {
  readonly value: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  setSelectionRange(start: number, end: number): void;
  focus(): void;
}

interface Props {
  value: string;
  headingLevels: Record<string, number>;
  onChange: (next: string) => void;
  onSelect: () => void;
  ref?: React.Ref<TextSurfaceHandle>;
}

const HEADING_DECORATION = [1, 2, 3].map((level) =>
  Decoration.line({ class: `cm-heading cm-h${level}` }),
);

function buildHeadings(view: EditorView, levels: Record<string, number>): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      const level = headingLevel(line.text, levels);
      if (level) builder.add(line.from, line.from, HEADING_DECORATION[level - 1]);
      pos = line.to + 1;
    }
  }

  return builder.finish();
}

const theme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--color-base)',
    color: 'var(--color-ink)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-reader)',
    fontSize: '15px',
    lineHeight: '1.625',
    padding: '20px 24px',
    overflow: 'auto',
  },
  '.cm-content': { padding: '0', caretColor: 'var(--color-ink)' },
  '.cm-line': { padding: '0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-ink)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--color-accent-soft)',
  },
  '.cm-heading': {
    fontWeight: '500',
    lineHeight: '1.375',
    color: 'var(--color-ink)',
  },
  // The blank line above a heading is the paragraph break before it, so the
  // spacing goes on the heading itself rather than on a margin nobody can see.
  '.cm-h1': { fontSize: '29px', paddingTop: '2rem', paddingBottom: '0.5rem' },
  '.cm-h2': { fontSize: '23px', paddingTop: '1.5rem', paddingBottom: '0.5rem' },
  '.cm-h3': { fontSize: '19px', paddingTop: '1rem', paddingBottom: '0.25rem' },
});

export function TextSurface({ value, headingLevels, onChange, onSelect, ref }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Held in refs so a new callback identity or a new heading map never tears
  // down and rebuilds the editor, which would lose the caret and the scroll.
  const onChangeRef = useRef(onChange);
  const onSelectRef = useRef(onSelect);
  const levelsRef = useRef(headingLevels);
  onChangeRef.current = onChange;
  onSelectRef.current = onSelect;
  levelsRef.current = headingLevels;

  useEffect(() => {
    if (!hostRef.current) return undefined;

    const headings = ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = buildHeadings(view, levelsRef.current);
        }

        update(update: ViewUpdate) {
          if (update.docChanged || update.viewportChanged) {
            this.decorations = buildHeadings(update.view, levelsRef.current);
          }
        }
      },
      { decorations: (plugin) => plugin.decorations },
    );

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            'aria-label': 'Book text',
            spellcheck: 'false',
          }),
          headings,
          theme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
            if (update.docChanged || update.selectionSet) onSelectRef.current();
          }),
        ],
      }),
    });

    viewRef.current = view;
    view.focus();

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const current = view.state.doc.toString();
    if (current === value) return;

    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      annotations: Transaction.addToHistory.of(false),
    });
  }, [value]);

  useImperativeHandle(
    ref,
    (): TextSurfaceHandle => ({
      get value() {
        return viewRef.current?.state.doc.toString() ?? '';
      },
      get selectionStart() {
        return viewRef.current?.state.selection.main.from ?? 0;
      },
      get selectionEnd() {
        return viewRef.current?.state.selection.main.to ?? 0;
      },
      setSelectionRange(start: number, end: number) {
        const view = viewRef.current;
        if (!view) return;
        const size = view.state.doc.length;
        const anchor = Math.max(0, Math.min(start, size));
        const head = Math.max(0, Math.min(end, size));
        view.dispatch({ selection: { anchor, head }, scrollIntoView: true });
      },
      focus() {
        viewRef.current?.focus();
      },
    }),
    [],
  );

  return <div ref={hostRef} className="h-full w-full overflow-hidden" />;
}
