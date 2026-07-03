/**
 * Serializer: converts the runtime FamilyTree (photos held as Blobs) to and
 * from a single portable JSON document with photos embedded as base64 (spec
 * §5). One exported file = the entire tree, importable anywhere.
 *
 * The export shape is exactly the on-disk JSON in spec §3: `photos[].data` is
 * base64 and `blob` is absent. Import reverses this and validates the result.
 */

import { blobToBase64, base64ToBlob } from './photo-codec';
import { assertValidTree, validateTree, type ValidationResult } from './validation';
import type { FamilyTree, Photo } from './types';

/** A photo as it appears in the serialized JSON: base64, no blob. */
export interface SerializedPhoto {
  id: string;
  personId: string;
  data: string;
  mime: string;
}

export interface SerializedTree extends Omit<FamilyTree, 'photos'> {
  photos: SerializedPhoto[];
}

/**
 * Serialize a runtime tree to a portable object (photos → base64).
 * Async because Blob→base64 reads the blob's bytes.
 */
export async function serializeTree(tree: FamilyTree): Promise<SerializedTree> {
  const photos: SerializedPhoto[] = [];
  for (const p of tree.photos) {
    const data = p.blob ? await blobToBase64(p.blob) : p.data ?? '';
    photos.push({ id: p.id, personId: p.personId, data, mime: p.mime });
  }
  const { photos: _omit, ...rest } = tree;
  void _omit;
  return { ...rest, photos };
}

/** Serialize straight to a JSON string, ready to write to a file or upload. */
export async function serializeToJson(
  tree: FamilyTree,
  pretty = false,
): Promise<string> {
  const obj = await serializeTree(tree);
  return JSON.stringify(obj, null, pretty ? 2 : 0);
}

/**
 * Deserialize a portable object back into a runtime tree (base64 → Blob).
 * Validates structure first; throws on hard errors (never trust import data).
 */
export async function deserializeTree(input: unknown): Promise<FamilyTree> {
  assertValidTree(input);
  const serialized = input as SerializedTree;
  const photos: Photo[] = (serialized.photos ?? []).map((p) => ({
    id: p.id,
    personId: p.personId,
    mime: p.mime,
    blob: base64ToBlob(p.data, p.mime),
  }));
  const { photos: _omit, ...rest } = serialized;
  void _omit;
  return { ...rest, photos };
}

/** Parse a JSON string then deserialize. Throws with a clear message on bad JSON. */
export async function deserializeFromJson(json: string): Promise<FamilyTree> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error(`File is not valid JSON: ${(e as Error).message}`);
  }
  return deserializeTree(parsed);
}

/** Validate a parsed import without throwing — used to preview import problems. */
export function inspectImport(input: unknown): ValidationResult {
  return validateTree(input);
}
