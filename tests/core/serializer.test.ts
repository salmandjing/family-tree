import { describe, it, expect } from 'vitest';
import { createEmptyTree } from '@/core/factories';
import { addPerson, addUnion, addChildToUnion, attachPhotoToPerson } from '@/core/operations';
import {
  serializeTree,
  serializeToJson,
  deserializeTree,
  deserializeFromJson,
  inspectImport,
} from '@/core/serializer';
import { blobToBase64, base64ToBlob } from '@/core/photo-codec';
import type { FamilyTree } from '@/core/types';

function sampleBytes(): Uint8Array<ArrayBuffer> {
  // A deterministic, non-trivial byte pattern including 0x00 and 0xff.
  const arr = new Uint8Array(256);
  for (let i = 0; i < 256; i++) arr[i] = i;
  return arr;
}

async function treeWithPhoto(): Promise<{ tree: FamilyTree; personId: string }> {
  const a = addPerson(createEmptyTree('d'), { given: 'A', family: 'Diallo' });
  const b = addPerson(a.tree, { given: 'B' });
  const u = addUnion(b.tree, [a.person.id, b.person.id], 'married');
  const c = addPerson(u.tree, { given: 'C' });
  let tree = addChildToUnion(c.tree, u.union.id, c.person.id);
  const blob = new Blob([sampleBytes()], { type: 'image/jpeg' });
  tree = {
    ...tree,
    photos: [{ id: 'ph1', personId: a.person.id, mime: 'image/jpeg', blob }],
  };
  tree = attachPhotoToPerson(tree, a.person.id, 'ph1');
  return { tree, personId: a.person.id };
}

describe('photo-codec', () => {
  it('round-trips arbitrary bytes through base64', async () => {
    const bytes = sampleBytes();
    const blob = new Blob([bytes], { type: 'image/jpeg' });
    const b64 = await blobToBase64(blob);
    const back = base64ToBlob(b64, 'image/jpeg');
    const outBytes = new Uint8Array(await back.arrayBuffer());
    expect(outBytes).toEqual(bytes);
  });

  it('handles lengths with each padding remainder (0,1,2)', async () => {
    for (const len of [3, 4, 5]) {
      const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(len).map(
        (_, i) => (i * 37) % 256,
      );
      const blob = new Blob([bytes], { type: 'application/octet-stream' });
      const back = base64ToBlob(await blobToBase64(blob), 'application/octet-stream');
      expect(new Uint8Array(await back.arrayBuffer())).toEqual(bytes);
    }
  });

  it('handles empty blob', async () => {
    const blob = new Blob([], { type: 'image/jpeg' });
    const b64 = await blobToBase64(blob);
    expect(b64).toBe('');
    const back = base64ToBlob(b64, 'image/jpeg');
    expect(back.size).toBe(0);
  });
});

describe('serializer round-trip', () => {
  it('serializes photos to base64 and back to identical bytes', async () => {
    const { tree } = await treeWithPhoto();
    const serialized = await serializeTree(tree);

    // Serialized form has data, no blob.
    expect(serialized.photos[0].data.length).toBeGreaterThan(0);
    expect('blob' in serialized.photos[0]).toBe(false);
    expect(JSON.stringify(serialized)).toContain('"data"');

    const restored = await deserializeTree(serialized);
    expect(restored.photos[0].blob).toBeInstanceOf(Blob);
    const original = new Uint8Array(await tree.photos[0].blob!.arrayBuffer());
    const roundtripped = new Uint8Array(await restored.photos[0].blob!.arrayBuffer());
    expect(roundtripped).toEqual(original);
  });

  it('preserves persons, unions, revision and deviceId exactly', async () => {
    const { tree } = await treeWithPhoto();
    const json = await serializeToJson(tree);
    const restored = await deserializeFromJson(json);
    expect(restored.persons).toEqual(tree.persons);
    expect(restored.unions).toEqual(tree.unions);
    expect(restored.revision).toBe(tree.revision);
    expect(restored.deviceId).toBe(tree.deviceId);
    expect(restored.schemaVersion).toBe(tree.schemaVersion);
  });

  it('produces pretty JSON when requested', async () => {
    const { tree } = await treeWithPhoto();
    const pretty = await serializeToJson(tree, true);
    expect(pretty).toContain('\n');
  });

  it('handles a tree with no photos', async () => {
    const a = addPerson(createEmptyTree('d'), { given: 'Solo' });
    const restored = await deserializeFromJson(await serializeToJson(a.tree));
    expect(restored.photos).toEqual([]);
    expect(restored.persons).toHaveLength(1);
  });
});

describe('deserialize error handling', () => {
  it('rejects non-JSON text with a clear message', async () => {
    await expect(deserializeFromJson('{not json')).rejects.toThrow(/not valid JSON/);
  });

  it('rejects structurally invalid trees', async () => {
    await expect(deserializeFromJson('{"schemaVersion": 1}')).rejects.toThrow(
      /Invalid family tree/,
    );
  });

  it('inspectImport reports problems without throwing', () => {
    const r = inspectImport({ schemaVersion: 1, revision: 0, persons: 'x', unions: [] });
    expect(r.ok).toBe(false);
  });
});
