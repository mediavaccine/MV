import assert from 'node:assert/strict';
import test from 'node:test';

import { detectDelimiter, parseCsv, rowsToGuests, suggestMapping } from '../csv.js';

test('parses a plain file', () => {
  assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
});

test('handles quoted fields containing the delimiter', () => {
  assert.deepEqual(parseCsv('name,note\n"Smith, Ada",vip'), [['name', 'note'], ['Smith, Ada', 'vip']]);
});

test('handles escaped quotes', () => {
  assert.deepEqual(parseCsv('a\n"say ""hi"""'), [['a'], ['say "hi"']]);
});

test('handles newlines inside quoted fields', () => {
  assert.deepEqual(parseCsv('a,b\n"line1\nline2",x'), [['a', 'b'], ['line1\nline2', 'x']]);
});

test('handles CRLF and lone CR line endings', () => {
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a,b\r1,2'), [['a', 'b'], ['1', '2']]);
});

test('strips the byte-order mark Excel writes', () => {
  // Left in place, the BOM becomes part of the first header and mapping fails.
  assert.deepEqual(parseCsv('﻿name,table\nAda,1')[0], ['name', 'table']);
});

test('does not invent a row from a trailing newline', () => {
  assert.equal(parseCsv('a,b\n1,2\n').length, 2);
});

test('keeps empty fields', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,,3'), [['a', 'b', 'c'], ['1', '', '3']]);
});

test('detects semicolon and tab delimited files', () => {
  assert.equal(detectDelimiter('name;table\nAda;1'), ';');
  assert.equal(detectDelimiter('name\ttable\nAda\t1'), '\t');
  assert.equal(detectDelimiter('name,table\nAda,1'), ',');
});

test('a comma inside quotes does not fool delimiter detection', () => {
  assert.equal(detectDelimiter('name;note\n"Smith, Ada";vip\n"Obi, Emeka";none'), ';');
});

test('suggests a mapping for common header spellings', () => {
  const roles = suggestMapping(['Full Name', 'Table No', 'Meal']).map((m) => m.role);
  assert.deepEqual(roles, ['full_name', 'table_number', 'extra']);
});

test('recognises a split first/last name pair', () => {
  const roles = suggestMapping(['First Name', 'Surname', 'Party']).map((m) => m.role);
  assert.deepEqual(roles, ['first_name', 'last_name', 'group_id']);
});

test('a full-name column wins over first/last halves', () => {
  // Both mapped would double-count; the halves become extra data instead.
  const roles = suggestMapping(['Guest Name', 'First Name', 'Last Name']).map((m) => m.role);
  assert.deepEqual(roles, ['full_name', 'extra', 'extra']);
});

test('never assigns the same role to two columns', () => {
  const roles = suggestMapping(['Name', 'Guest Name', 'Attendee']).map((m) => m.role);
  assert.deepEqual(roles.filter((r) => r === 'full_name').length, 1);
});

test('unknown columns fall through to extra', () => {
  assert.deepEqual(suggestMapping(['Dietary', 'Notes']).map((m) => m.role), ['extra', 'extra']);
});

test('builds guests from rows and a mapping', () => {
  const rows = parseCsv('Name,Table,Meal\nAda Smith,5,Fish\nEmeka Obi,VIP-A,Beef');
  const guests = rowsToGuests(rows, suggestMapping(rows[0]));
  assert.deepEqual(guests, [
    { full_name: 'Ada Smith', table_number: '5', group_id: null, extra: { Meal: 'Fish' } },
    { full_name: 'Emeka Obi', table_number: 'VIP-A', group_id: null, extra: { Meal: 'Beef' } },
  ]);
});

test('joins split names', () => {
  const rows = parseCsv('First,Last\nAda,Smith');
  assert.equal(rowsToGuests(rows, suggestMapping(rows[0]))[0].full_name, 'Ada Smith');
});

test('skips rows with no name at all', () => {
  const rows = parseCsv('Name,Table\nAda,1\n,2\n   ,3');
  assert.equal(rowsToGuests(rows, suggestMapping(rows[0])).length, 1);
});

test('skips entirely blank rows', () => {
  const rows = parseCsv('Name,Table\nAda,1\n,\nEmeka,2');
  assert.equal(rowsToGuests(rows, suggestMapping(rows[0])).length, 2);
});

test('an empty table cell becomes null, not an empty string', () => {
  const rows = parseCsv('Name,Table\nAda,');
  assert.equal(rowsToGuests(rows, suggestMapping(rows[0]))[0].table_number, null);
});

test('empty extra values are dropped rather than stored blank', () => {
  const rows = parseCsv('Name,Meal\nAda,');
  assert.deepEqual(rowsToGuests(rows, suggestMapping(rows[0]))[0].extra, {});
});

test('a header-only file produces no guests', () => {
  assert.deepEqual(rowsToGuests(parseCsv('Name,Table'), [{ header: 'Name', role: 'full_name' }]), []);
});
