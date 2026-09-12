import { resolveDrop } from '../core/reorder.js';

const INDENT = 14;
const THRESHOLD = 4;
const EDGE = 24;
const SCROLL_STEP = 12;

/**
 * Drag rows around a list. Rows are handed in by whatever drew them, each carrying the element
 * to move and what it stands for; the layer only reads the geometry back from the DOM.
 *
 * @param {object} options
 * @param {HTMLElement} options.list the element the rows are drawn in
 * @param {Document} options.document
 * @param {(change: object) => void} options.onDrop the row, and where it was let go
 * @returns {{ setRows: (rows: object[]) => void, cancel: () => void }}
 */
export function createDragLayer({ list, document: doc, onDrop }) {
  let rows = [];
  let drag = null;
  let swallowClick = false;

  const setRows = (next) => {
    rows = next;
  };

  list.addEventListener('dragstart', (event) => event.preventDefault());

  list.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || drag) return;

    const row = rows.find((candidate) => candidate.element === event.target.closest('li'));
    if (!row || row.section) return;

    const started = { x: event.clientX, y: event.clientY };
    const onMove = (move) => {
      if (!drag) {
        const far = Math.hypot(move.clientX - started.x, move.clientY - started.y);
        if (far < THRESHOLD) return;
        begin(row, move);
      }
      follow(move);
    };
    const onDone = () => {
      list.removeEventListener('pointermove', onMove);
      list.removeEventListener('pointerup', onDone);
      list.removeEventListener('pointercancel', onDone);
      finish();
    };

    list.addEventListener('pointermove', onMove);
    list.addEventListener('pointerup', onDone);
    list.addEventListener('pointercancel', onDone);
  });

  doc.addEventListener('keydown', (event) => {
    if (drag && event.key === 'Escape') cancel();
  });

  list.addEventListener(
    'click',
    (event) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );

  /**
   * @param {object} row
   * @param {PointerEvent} move
   */
  function begin(row, move) {
    const rect = row.element.getBoundingClientRect();
    const ghost = doc.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.style.width = `${rect.width}px`;
    ghost.append(row.element.cloneNode(true));
    doc.body.append(ghost);

    const placeholder = doc.createElement('li');
    placeholder.className = 'drop-placeholder';
    placeholder.style.height = `${rect.height}px`;
    placeholder.style.setProperty('--depth', String(row.depth));

    drag = { row, ghost, placeholder, held: rect.top - move.clientY };
    swallowClick = true;
    row.element.classList.add('dragging');
    list.classList.add('dragging');
    list.setPointerCapture(move.pointerId);
  }

  /** @param {PointerEvent} move */
  function follow(move) {
    const { row, ghost, placeholder } = drag;
    ghost.style.transform = `translate(${move.clientX}px, ${move.clientY + drag.held}px)`;
    scroll(move.clientY);

    placeholder.remove();
    const measured = rows.map((candidate) => {
      const rect = candidate.element.getBoundingClientRect();
      return { ...candidate, top: rect.top, bottom: rect.bottom };
    });
    const target = resolveDrop(measured, {
      kind: row.kind,
      x: move.clientX,
      y: move.clientY,
      listLeft: list.getBoundingClientRect().left,
      indent: INDENT,
      draggedPath: row.path ?? [],
    });

    drag.target = target;
    if (!target) return;

    placeholder.style.setProperty('--depth', String(target.depth));
    list.insertBefore(placeholder, target.placeBefore?.element ?? null);
  }

  /** @param {number} y */
  function scroll(y) {
    const view = doc.scrollingElement ?? doc.documentElement;
    if (y < EDGE) view.scrollTop -= SCROLL_STEP;
    else if (y > view.clientHeight - EDGE) view.scrollTop += SCROLL_STEP;
  }

  function finish() {
    if (!drag) return;

    const { row, target, ghost, placeholder } = drag;
    drag = null;
    ghost.remove();
    placeholder.remove();
    row.element.classList.remove('dragging');
    list.classList.remove('dragging');
    if (!target) return;

    onDrop({
      kind: row.kind,
      url: row.url,
      name: row.name,
      path: row.path,
      to: { parentPath: target.parentPath, before: beforeOf(row, target.placeBefore) },
    });
  }

  /**
   * @param {object} row what is being dragged
   * @param {object | null} placed the row it will sit above, if any
   * @returns {string | string[] | null} that row's own name, or null for the end of the list
   */
  function beforeOf(row, placed) {
    if (placed === null) return null;
    if (row.kind === 'group') return placed.kind === 'group' ? placed.path : null;
    return placed.kind === 'group' ? null : placed.url;
  }

  function cancel() {
    if (!drag) return;
    drag.target = null;
    finish();
  }

  return { setRows, cancel };
}
