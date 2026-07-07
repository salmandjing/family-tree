/**
 * Thin, typed wrapper around the `family-chart` library so the rest of the app
 * touches exactly one integration point (spec §2: renderer swappable). The
 * library mutates the DOM directly; React only owns the container element.
 */

import { createChart } from 'family-chart';
import 'family-chart/styles/family-chart.css';
import type { RenderDatum } from './adapter';

export interface ChartHandle {
  update(data: RenderDatum[], mainId?: string): void;
  focus(id: string): void;
  /** Zoom/pan to show the whole tree in the viewport. */
  fit(): void;
  destroy(): void;
}

export interface ChartCallbacks {
  /** Called when the user taps a card. */
  onSelect: (id: string) => void;
}

/**
 * The subset of family-chart's TreeDatum we read. `d.data` is the full datum
 * (our RenderDatum), which is where family-chart stamps its synthetic flags.
 */
interface TreeDatumLike {
  data?: RenderDatum & {
    to_add?: boolean;
    _new_rel_data?: unknown;
  };
}

/**
 * Create a chart inside `container`. Returns a handle for updates/teardown.
 * `data` must be non-empty (family-chart needs at least one node).
 */
export function createFamilyChart(
  container: HTMLElement,
  data: RenderDatum[],
  callbacks: ChartCallbacks,
): ChartHandle {
  const f3Chart = createChart(container, data as never)
    .setTransitionTime(600)
    .setCardXSpacing(250)
    .setCardYSpacing(150)
    .setOrientationVertical()
    // We manage adding relatives through our own PersonCard, so suppress
    // family-chart's built-in empty "add" cards.
    .setSingleParentEmptyCard(false);

  const f3Card = f3Chart
    .setCardHtml()
    .setCardDisplay([['first name', 'last name'], ['birthday']])
    .setCardDim({})
    .setMiniTree(true)
    .setStyle('imageRect');

  // family-chart synthesizes placeholder nodes for layout: `to_add` spouse
  // cards (a co-parent stand-in when a child has one linked parent) and
  // `_new_rel_data` empty cards. These carry generated ids that are NOT real
  // people, so ignore clicks on them — otherwise the person card opens on a
  // non-existent id ("this person no longer exists").
  f3Card.setOnCardClick((_e: MouseEvent, d: TreeDatumLike) => {
    if (!d?.data || d.data.to_add || d.data._new_rel_data) return;
    if (typeof d.data.id === 'string') callbacks.onSelect(d.data.id);
  });

  // Fit the whole family in view on first render (rather than centering on one
  // person, which can leave the tree off-screen).
  f3Chart.updateTree({ initial: true, tree_position: 'fit' });

  return {
    update(next: RenderDatum[], mainId?: string) {
      f3Chart.updateData(next as never);
      if (mainId) f3Chart.updateMainId(mainId);
      f3Chart.updateTree({ tree_position: 'inherit' });
    },
    focus(id: string) {
      f3Chart.updateMainId(id);
      f3Chart.updateTree({ tree_position: 'main_to_middle' });
    },
    fit() {
      f3Chart.updateTree({ tree_position: 'fit' });
    },
    destroy() {
      container.innerHTML = '';
    },
  };
}
