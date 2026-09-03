import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyStrategy, assignBalancedByGroup, assignFromCsv, assignManually,
  assignRoundRobin, summariseTables,
} from '../assignment.js';

const guest = (name, group, table) => ({ full_name: name, group_id: group || null, table_number: table || null, extra: {} });

test('provided-in-csv keeps what the file said', () => {
  const out = assignFromCsv([guest('Ada', null, 'Head Table')]);
  assert.equal(out[0].table_number, 'Head Table');
});

test('manual clears every table', () => {
  const out = assignManually([guest('Ada', null, '5')]);
  assert.equal(out[0].table_number, null);
});

test('round robin spreads guests evenly', () => {
  const out = assignRoundRobin([1, 2, 3, 4, 5].map((n) => guest('G' + n)), 2);
  assert.deepEqual(out.map((g) => g.table_number),
    ['Table 1', 'Table 2', 'Table 1', 'Table 2', 'Table 1']);
});

test('a group is never split across tables', () => {
  const guests = [
    guest('A', 'smith'), guest('B', 'smith'), guest('C', 'smith'),
    guest('D', 'obi'), guest('E', 'obi'),
    guest('F'), guest('G'),
  ];
  const out = assignBalancedByGroup(guests, 3);
  const tablesFor = (g) => new Set(out.filter((x) => x.group_id === g).map((x) => x.table_number));
  assert.equal(tablesFor('smith').size, 1, 'smith party was split');
  assert.equal(tablesFor('obi').size, 1, 'obi party was split');
});

test('balanced assignment keeps table sizes close', () => {
  const guests = [];
  for (let i = 0; i < 4; i++) guests.push(guest('fam' + i, 'family'));   // one party of 4
  for (let i = 0; i < 8; i++) guests.push(guest('solo' + i));            // eight singles
  const out = assignBalancedByGroup(guests, 3);
  const sizes = summariseTables(out).map((t) => t.count);
  assert.equal(sizes.reduce((a, b) => a + b, 0), 12);
  assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `uneven: ${sizes}`);
});

test('a party larger than a fair share still lands whole', () => {
  const guests = [];
  for (let i = 0; i < 7; i++) guests.push(guest('big' + i, 'bigparty'));
  for (let i = 0; i < 3; i++) guests.push(guest('solo' + i));
  const out = assignBalancedByGroup(guests, 4);
  const tables = new Set(out.filter((g) => g.group_id === 'bigparty').map((g) => g.table_number));
  assert.equal(tables.size, 1);
});

test('assignment is deterministic across runs', () => {
  const build = () => [guest('A', 'x'), guest('B', 'x'), guest('C', 'y'), guest('D')];
  const first = assignBalancedByGroup(build(), 2).map((g) => g.table_number);
  const second = assignBalancedByGroup(build(), 2).map((g) => g.table_number);
  assert.deepEqual(first, second);
});

test('the input list is never mutated', () => {
  const original = [guest('Ada', null, 'keep me')];
  assignRoundRobin(original, 2);
  assert.equal(original[0].table_number, 'keep me');
});

test('a custom label function is honoured', () => {
  const out = assignRoundRobin([guest('A'), guest('B')], 2, { label: (i) => `VIP-${i + 1}` });
  assert.deepEqual(out.map((g) => g.table_number), ['VIP-1', 'VIP-2']);
});

test('a table count of zero or less is rejected', () => {
  assert.throws(() => assignRoundRobin([guest('A')], 0), RangeError);
  assert.throws(() => assignBalancedByGroup([guest('A')], -1), RangeError);
});

test('applyStrategy dispatches and rejects unknown strategies', () => {
  assert.equal(applyStrategy('manual', [guest('A', null, '3')])[0].table_number, null);
  assert.equal(applyStrategy('provided-in-csv', [guest('A', null, '3')])[0].table_number, '3');
  assert.equal(applyStrategy('auto-random', [guest('A')], { tableCount: 1 })[0].table_number, 'Table 1');
  assert.throws(() => applyStrategy('nonsense', []), RangeError);
});

test('summary sorts tables naturally and counts unassigned', () => {
  const out = summariseTables([guest('A', null, 'Table 2'), guest('B', null, 'Table 10'), guest('C')]);
  assert.deepEqual(out, [
    { table: '(unassigned)', count: 1 },
    { table: 'Table 2', count: 1 },
    { table: 'Table 10', count: 1 },
  ]);
});
