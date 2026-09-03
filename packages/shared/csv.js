/* CSV parsing and column detection.
 *
 * Hand-written rather than pulled from a package: the admin app has no build
 * step, and the subset of CSV that matters here — quoted fields, escaped
 * quotes, embedded newlines, the three common line endings, a BOM from Excel —
 * is small enough to own and test outright.
 */

/**
 * Parse CSV text into an array of rows, each an array of cell strings.
 * Follows RFC 4180: fields may be quoted, "" is a literal quote inside a
 * quoted field, and quoted fields may contain commas and newlines.
 */
export function parseCsv(text, options) {
  var delimiter = (options && options.delimiter) || ',';
  var rows = [];
  var row = [];
  var field = '';
  var inQuotes = false;
  var i = 0;

  // Excel writes a byte-order mark; left in place it becomes part of the first
  // header name and every column mapping silently misses.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  function endField() { row.push(field); field = ''; }
  function endRow() {
    endField();
    // A trailing newline should not produce a phantom empty row.
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  }

  while (i < text.length) {
    var char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += char; i++; continue;
    }

    if (char === '"') { inQuotes = true; i++; continue; }
    if (char === delimiter) { endField(); i++; continue; }
    if (char === '\r') { endRow(); i += text[i + 1] === '\n' ? 2 : 1; continue; }
    if (char === '\n') { endRow(); i++; continue; }

    field += char; i++;
  }

  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/** Guess the delimiter by seeing which one yields a consistent column count. */
export function detectDelimiter(text) {
  var sample = text.split(/\r?\n/).slice(0, 5).join('\n');
  var best = { delimiter: ',', score: -1 };

  [',', ';', '\t', '|'].forEach(function (delimiter) {
    var rows = parseCsv(sample, { delimiter: delimiter });
    if (rows.length === 0) return;
    var width = rows[0].length;
    if (width < 2) return;
    // Consistent width across rows is the signal; ragged rows mean this
    // character is appearing inside the data rather than between fields.
    var consistent = rows.filter(function (r) { return r.length === width; }).length;
    var score = width * consistent;
    if (score > best.score) best = { delimiter: delimiter, score: score };
  });

  return best.delimiter;
}

/* Header names we have actually seen in the wild, most specific first. */
var PATTERNS = {
  full_name: [/^(full[\s_-]*)?name$/i, /^guest([\s_-]*name)?$/i, /^attendee([\s_-]*name)?$/i, /^invitee$/i],
  first_name: [/^first[\s_-]*name$/i, /^given[\s_-]*name$/i, /^forename$/i, /^first$/i],
  last_name: [/^last[\s_-]*name$/i, /^surname$/i, /^family[\s_-]*name$/i, /^last$/i],
  table_number: [/^table([\s_-]*(number|no|#))?$/i, /^seat(ing)?([\s_-]*table)?$/i, /^tbl$/i],
  group_id: [/^(group|party|household|family)([\s_-]*(id|name|no))?$/i, /^booking$/i],
};

/**
 * Suggest a role for each column. Returns one entry per header, in order, with
 * `role` set to a known field or 'extra'. Never assigns the same role twice —
 * a spreadsheet with both "Name" and "Guest Name" must not map both.
 */
export function suggestMapping(headers) {
  var taken = {};
  var mapping = headers.map(function (header) {
    return { header: header, role: 'extra', confidence: 0 };
  });

  Object.keys(PATTERNS).forEach(function (role) {
    PATTERNS[role].forEach(function (pattern, rank) {
      if (taken[role]) return;
      for (var i = 0; i < headers.length; i++) {
        if (mapping[i].role !== 'extra') continue;
        if (!pattern.test(String(headers[i]).trim())) continue;
        mapping[i] = { header: headers[i], role: role, confidence: 1 - rank * 0.1 };
        taken[role] = true;
        return;
      }
    });
  });

  // A split first/last pair beats a single full-name column only when there is
  // no full-name column at all; otherwise the halves are just extra data.
  if (taken.full_name && (taken.first_name || taken.last_name)) {
    mapping.forEach(function (entry) {
      if (entry.role === 'first_name' || entry.role === 'last_name') entry.role = 'extra';
    });
  }

  return mapping;
}

/** Turn parsed rows plus a confirmed mapping into guest records. */
export function rowsToGuests(rows, mapping) {
  if (rows.length < 2) return [];

  var index = {};
  mapping.forEach(function (entry, i) {
    if (entry.role !== 'extra') index[entry.role] = i;
  });

  var guests = [];

  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    if (row.every(function (cell) { return String(cell).trim() === ''; })) continue;

    var name = '';
    if (index.full_name != null) {
      name = String(row[index.full_name] || '').trim();
    } else {
      name = [
        index.first_name != null ? row[index.first_name] : '',
        index.last_name != null ? row[index.last_name] : '',
      ].map(function (part) { return String(part || '').trim(); })
       .filter(Boolean)
       .join(' ');
    }

    if (!name) continue;   // A row with no name is not a guest.

    var extra = {};
    mapping.forEach(function (entry, i) {
      if (entry.role !== 'extra') return;
      var value = String(row[i] == null ? '' : row[i]).trim();
      if (value) extra[entry.header] = value;
    });

    guests.push({
      full_name: name,
      table_number: index.table_number != null
        ? String(row[index.table_number] || '').trim() || null
        : null,
      group_id: index.group_id != null
        ? String(row[index.group_id] || '').trim() || null
        : null,
      extra: extra,
    });
  }

  return guests;
}
