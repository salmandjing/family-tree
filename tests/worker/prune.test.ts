import { describe, it, expect } from 'vitest';
import { selectForPrune, type BackupFile } from '../../worker/src/prune';

function file(id: string, timestamp: string): BackupFile {
  return { id, timestamp };
}

describe('selectForPrune', () => {
  it('keeps everything when there are 10 or fewer', () => {
    const files = Array.from({ length: 8 }, (_, i) =>
      file(`f${i}`, `2026-07-${String(i + 1).padStart(2, '0')}T10:00:00Z`),
    );
    const plan = selectForPrune(files);
    expect(plan.delete).toHaveLength(0);
    expect(plan.keep).toHaveLength(8);
  });

  it('keeps the newest 10 and deletes older same-month extras', () => {
    // 15 backups all within July 2026.
    const files = Array.from({ length: 15 }, (_, i) =>
      file(`f${i}`, `2026-07-${String(i + 1).padStart(2, '0')}T10:00:00Z`),
    );
    const plan = selectForPrune(files);
    // Newest 10 kept + the monthly keep is already among them → 10 kept.
    expect(plan.keep.length).toBe(10);
    expect(plan.delete.length).toBe(5);
    // The oldest 5 are deleted.
    expect(plan.delete.sort()).toEqual(['f0', 'f1', 'f2', 'f3', 'f4'].sort());
  });

  it('keeps one per calendar month beyond the recent window', () => {
    // 12 recent in July + one each in prior months.
    const recent = Array.from({ length: 12 }, (_, i) =>
      file(`jul${i}`, `2026-07-${String(i + 1).padStart(2, '0')}T10:00:00Z`),
    );
    const older = [
      file('jun', '2026-06-15T10:00:00Z'),
      file('may', '2026-05-15T10:00:00Z'),
    ];
    const plan = selectForPrune([...recent, ...older]);
    // June and May are each the only one in their month → kept forever.
    expect(plan.keep).toContain('jun');
    expect(plan.keep).toContain('may');
    // Older July copies beyond the newest 10 get deleted.
    expect(plan.delete.length).toBeGreaterThan(0);
    expect(plan.delete).not.toContain('jun');
    expect(plan.delete).not.toContain('may');
  });

  it('deletes older duplicates within a past month but keeps the newest of it', () => {
    const recent = Array.from({ length: 10 }, (_, i) =>
      file(`jul${i}`, `2026-07-${String(i + 1).padStart(2, '0')}T10:00:00Z`),
    );
    const june = [
      file('jun-old', '2026-06-01T10:00:00Z'),
      file('jun-new', '2026-06-28T10:00:00Z'),
    ];
    const plan = selectForPrune([...recent, ...june]);
    expect(plan.keep).toContain('jun-new'); // newest of June kept
    expect(plan.delete).toContain('jun-old'); // older June pruned
  });

  it('never deletes files with unparseable timestamps', () => {
    const files = [
      ...Array.from({ length: 12 }, (_, i) =>
        file(`f${i}`, `2026-07-${String(i + 1).padStart(2, '0')}T10:00:00Z`),
      ),
      file('weird', 'not-a-date'),
    ];
    const plan = selectForPrune(files);
    expect(plan.keep).toContain('weird');
    expect(plan.delete).not.toContain('weird');
  });
});
