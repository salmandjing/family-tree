/**
 * Drive prune policy (spec §5): keep the last 10 timestamped copies PLUS one
 * per calendar month forever; delete the rest. Pure function over file metadata
 * so it is fully unit-testable. The `latest` pointer file is never passed here.
 */

export interface BackupFile {
  id: string;
  /** ISO timestamp used for ordering and monthly bucketing. */
  timestamp: string;
}

export interface PrunePlan {
  keep: string[];
  delete: string[];
}

const RECENT_KEEP = 10;

/** Bucket key for "one per calendar month" (UTC). */
function monthKey(iso: string): string {
  return iso.slice(0, 7); // YYYY-MM
}

/**
 * Decide which timestamped backups to keep and which to delete.
 * Files with an unparseable timestamp are conservatively KEPT (never delete
 * something we can't reason about).
 */
export function selectForPrune(files: BackupFile[]): PrunePlan {
  const dated = files.filter((f) => !Number.isNaN(Date.parse(f.timestamp)));
  const undatable = files.filter((f) => Number.isNaN(Date.parse(f.timestamp)));

  const sorted = [...dated].sort(
    (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp),
  );

  const keep = new Set<string>();

  // Keep the most recent N.
  for (const f of sorted.slice(0, RECENT_KEEP)) keep.add(f.id);

  // Keep the most recent one in each calendar month (list is desc, so the
  // first seen per month is the newest).
  const seenMonths = new Set<string>();
  for (const f of sorted) {
    const key = monthKey(f.timestamp);
    if (!seenMonths.has(key)) {
      seenMonths.add(key);
      keep.add(f.id);
    }
  }

  // Undatable files are always kept.
  for (const f of undatable) keep.add(f.id);

  const del = files.filter((f) => !keep.has(f.id)).map((f) => f.id);
  return { keep: [...keep], delete: del };
}
