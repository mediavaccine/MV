/* Table assignment strategies (spec v1 §4.3, §5.3).
 *
 * Every strategy takes the guests parsed from a CSV and returns the same list
 * with `table_number` filled in. None of them mutate the input.
 */

/** Guests keep whatever the CSV already said. */
export function assignFromCsv(guests) {
  return guests.map(function (guest) {
    return Object.assign({}, guest, {
      table_number: guest.table_number || null,
    });
  });
}

/**
 * Pack whole groups onto tables, keeping table sizes as even as possible.
 *
 * A party that booked together must sit together — splitting a family across
 * two tables is the one outcome worth avoiding, so groups are placed largest
 * first onto whichever table currently has the fewest people. A single group
 * larger than a table's fair share still lands whole rather than being split.
 */
export function assignBalancedByGroup(guests, tableCount, options) {
  var labeller = (options && options.label) || defaultLabel;
  if (!(tableCount > 0)) throw new RangeError('tableCount must be a positive integer');

  var groups = groupGuests(guests);

  // Largest first: placing big parties while every table is still empty is what
  // keeps the final sizes close together.
  groups.sort(function (a, b) {
    if (b.members.length !== a.members.length) return b.members.length - a.members.length;
    return String(a.key).localeCompare(String(b.key));   // stable across runs
  });

  var tables = [];
  for (var t = 0; t < tableCount; t++) tables.push({ index: t, count: 0 });

  var assignment = new Map();

  groups.forEach(function (group) {
    var target = tables.reduce(function (best, table) {
      if (table.count !== best.count) return table.count < best.count ? table : best;
      return table.index < best.index ? table : best;   // ties go left
    }, tables[0]);

    target.count += group.members.length;
    group.members.forEach(function (guest) {
      assignment.set(guest, labeller(target.index));
    });
  });

  return guests.map(function (guest) {
    return Object.assign({}, guest, { table_number: assignment.get(guest) });
  });
}

/**
 * Spread guests across tables with no grouping information, round robin so the
 * tables come out within one of each other.
 */
export function assignRoundRobin(guests, tableCount, options) {
  var labeller = (options && options.label) || defaultLabel;
  if (!(tableCount > 0)) throw new RangeError('tableCount must be a positive integer');

  return guests.map(function (guest, i) {
    return Object.assign({}, guest, { table_number: labeller(i % tableCount) });
  });
}

/** Import with nothing assigned; the admin fills tables in by hand afterwards. */
export function assignManually(guests) {
  return guests.map(function (guest) {
    return Object.assign({}, guest, { table_number: null });
  });
}

export function applyStrategy(strategy, guests, options) {
  var settings = options || {};
  switch (strategy) {
    case 'provided-in-csv': return assignFromCsv(guests);
    case 'auto-balanced':   return assignBalancedByGroup(guests, settings.tableCount, settings);
    case 'auto-random':     return assignRoundRobin(guests, settings.tableCount, settings);
    case 'manual':          return assignManually(guests);
    default: throw new RangeError('unknown assignment strategy: ' + strategy);
  }
}

/** Table sizes, for showing the admin what a strategy actually produced. */
export function summariseTables(guests) {
  var counts = new Map();
  guests.forEach(function (guest) {
    var key = guest.table_number || '(unassigned)';
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return Array.from(counts, function (entry) {
    return { table: entry[0], count: entry[1] };
  }).sort(function (a, b) {
    return a.table.localeCompare(b.table, undefined, { numeric: true });
  });
}

function defaultLabel(index) {
  return 'Table ' + (index + 1);
}

/* Guests with no group id are each their own party of one, so they fill the
 * gaps that the real groups leave behind. */
function groupGuests(guests) {
  var byKey = new Map();

  guests.forEach(function (guest, i) {
    var key = guest.group_id ? 'g:' + guest.group_id : 'solo:' + i;
    if (!byKey.has(key)) byKey.set(key, { key: key, members: [] });
    byKey.get(key).members.push(guest);
  });

  return Array.from(byKey.values());
}
