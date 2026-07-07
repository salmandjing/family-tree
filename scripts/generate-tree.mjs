#!/usr/bin/env node
// Generate a realistic large family tree (polygamy + multiple generations) as an
// export JSON, for performance/repro testing. Usage:
//   node scripts/generate-tree.mjs [wives] [childrenPerUnion] [gen2ChildrenPerCouple] > tree.json
let counter = 0;
const id = (p) => `${p}-${counter++}`;
const persons = [];
const unions = [];

function person(given, sex = 'unknown') {
  const p = {
    id: id('p'),
    name: { given, family: 'Kemkada', nicknames: [] },
    sex,
    birth: { date: '1950', approx: true, place: '' },
    death: { date: null, approx: false, place: '' },
    living: true,
    notes: '',
    photos: [],
    deletedAt: null,
  };
  persons.push(p);
  return p;
}
function union(partners, children = []) {
  const u = {
    id: id('u'),
    partners: partners.map((p) => p.id),
    status: 'married',
    children: children.map((c) => ({ personId: c.id, relation: 'biological' })),
  };
  unions.push(u);
  return u;
}

const WIVES = Number(process.argv[2] ?? 3);
const KIDS = Number(process.argv[3] ?? 4);
const GKIDS = Number(process.argv[4] ?? 3);

const patriarch = person('Patriarch', 'M');
for (let w = 0; w < WIVES; w++) {
  const wife = person(`Wife${w + 1}`, 'F');
  const kids = [];
  for (let k = 0; k < KIDS; k++) {
    const kid = person(`G1_${w}_${k}`, k % 2 ? 'F' : 'M');
    kids.push(kid);
    // each gen1 kid gets a spouse and gen2 kids
    const spouse = person(`Sp_${w}_${k}`, k % 2 ? 'M' : 'F');
    const gkids = [];
    for (let g = 0; g < GKIDS; g++) gkids.push(person(`G2_${w}_${k}_${g}`, g % 2 ? 'M' : 'F'));
    union([kid, spouse], gkids);
  }
  union([patriarch, wife], kids);
}

const tree = {
  schemaVersion: 1,
  revision: 1,
  deviceId: 'generator',
  savedAt: '2026-07-06T00:00:00.000Z',
  persons,
  unions,
  photos: [],
};
process.stderr.write(`Generated ${persons.length} persons, ${unions.length} unions\n`);
process.stdout.write(JSON.stringify(tree));
