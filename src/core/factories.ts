import { newId } from './ids';
import {
  SCHEMA_VERSION,
  type FamilyTree,
  type LifeEvent,
  type Person,
  type Sex,
  type Union,
  type UnionStatus,
} from './types';

/** An empty, unknown life event. */
export function emptyLifeEvent(): LifeEvent {
  return { date: null, approx: false, place: '' };
}

export interface NewPersonInput {
  given?: string;
  family?: string;
  nicknames?: string[];
  sex?: Sex;
  birth?: Partial<LifeEvent>;
  death?: Partial<LifeEvent>;
  notes?: string;
}

/**
 * Create a new Person. Only a name is meaningfully required by the UI, but even
 * that is optional here — everything defaults to empty (spec §9: "name only").
 */
export function createPerson(input: NewPersonInput = {}): Person {
  return {
    id: newId(),
    name: {
      given: input.given ?? '',
      family: input.family ?? '',
      nicknames: input.nicknames ? [...input.nicknames] : [],
    },
    sex: input.sex ?? 'unknown',
    birth: { ...emptyLifeEvent(), ...input.birth },
    death: { ...emptyLifeEvent(), ...input.death },
    living: input.death?.date == null,
    notes: input.notes ?? '',
    photos: [],
    deletedAt: null,
  };
}

export interface NewUnionInput {
  partners?: string[];
  status?: UnionStatus;
}

export function createUnion(input: NewUnionInput = {}): Union {
  return {
    id: newId(),
    partners: input.partners ? [...input.partners] : [],
    status: input.status ?? 'unknown',
    children: [],
  };
}

/** A fresh, empty tree for first run. */
export function createEmptyTree(deviceId: string): FamilyTree {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    deviceId,
    savedAt: new Date(0).toISOString(),
    persons: [],
    unions: [],
    photos: [],
  };
}
