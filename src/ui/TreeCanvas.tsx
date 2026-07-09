/**
 * TreeCanvas — mounts the family-chart renderer and keeps it in sync with the
 * live tree. React owns only the container div; the chart owns its DOM subtree.
 */

import { useEffect, useRef } from 'react';
import { useTree, useTreeService } from '../app/TreeContext';
import {
  toRenderData,
  hasRenderableData,
  pickRoot,
  type RenderDatum,
} from '../render/adapter';
import {
  createFamilyChart,
  type ChartHandle,
} from '../render/familyChart';

interface TreeCanvasProps {
  onSelect: (id: string) => void;
  focusId?: string;
  /** Increment to request a "fit whole tree" view. */
  fitNonce?: number;
}

export function TreeCanvas({ onSelect, focusId, fitNonce }: TreeCanvasProps) {
  const tree = useTree();
  const service = useTreeService();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ChartHandle | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const renderable = hasRenderableData(tree);

  // Create the chart once we have at least one person and a container.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !renderable || chartRef.current) return;
    let cancelled = false;
    (async () => {
      const data: RenderDatum[] = toRenderData(tree, service.avatarUrlMap());
      // Warm avatar URLs so photos appear on first paint.
      await Promise.all(
        tree.photos.map((p) => service.getAvatarUrl(p.id)),
      );
      if (cancelled || !containerRef.current) return;
      const withAvatars = toRenderData(tree, service.avatarUrlMap());
      chartRef.current = createFamilyChart(containerRef.current, withAvatars || data, {
        onSelect: (id) => onSelectRef.current(id),
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderable]);

  // Push data updates whenever the tree changes.
  useEffect(() => {
    if (!chartRef.current || !renderable) return;
    chartRef.current.update(toRenderData(tree, service.avatarUrlMap()));
  }, [tree, service, renderable]);

  // Center on a requested person (search / navigation).
  useEffect(() => {
    if (chartRef.current && focusId) chartRef.current.focus(focusId);
  }, [focusId]);

  // Show the whole tree when requested: re-root on a top ancestor (so every
  // branch is drawn, not just the currently-focused person's) and fit to view.
  useEffect(() => {
    if (chartRef.current && fitNonce) chartRef.current.fit(pickRoot(tree));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitNonce]);

  // Tear down on unmount.
  useEffect(() => {
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, []);

  if (!renderable) return null;
  return <div ref={containerRef} className="f3 tree-canvas" data-testid="tree-canvas" />;
}
