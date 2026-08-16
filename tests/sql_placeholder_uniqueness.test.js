'use strict';

/**
 * Regression guard: named PDO placeholders must be unique within a statement.
 *
 * config/database.php connects with PDO::ATTR_EMULATE_PREPARES => false, so all
 * statements are prepared natively by MySQL. The PHP manual (PDO::prepare) is
 * explicit:
 *
 *   "You cannot use a named parameter marker of the same name more than once in
 *    a prepared statement, unless emulation mode is on."
 *
 * Reusing a marker therefore makes MySQL reject the statement at execute() time
 * with SQLSTATE[HY093] "Invalid parameter number". In api/login.php that
 * exception was swallowed by the endpoint's catch-all and surfaced to users as
 * HTTP 500 "A system error occurred during login" on EVERY login attempt.
 *
 * This defect is invisible to the php-wasm/PGlite backend suites because the
 * PostgreSQL driver happily rewrites a repeated marker, so it is asserted
 * statically here against the real production sources.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function phpSources() {
  const dirs = ['api', 'config', '.'];
  const files = [];
  for (const dir of dirs) {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.php')) {
        files.push(path.posix.join(dir === '.' ? '' : dir, entry.name));
      }
    }
  }
  return files;
}

/** Extract the argument text of every `prepare( ... )` call, brace-balanced. */
function preparedStatements(source) {
  const statements = [];
  const marker = /prepare\(/g;
  let match;
  while ((match = marker.exec(source)) !== null) {
    let index = match.index + match[0].length;
    let depth = 1;
    while (index < source.length && depth > 0) {
      if (source[index] === '(') depth += 1;
      else if (source[index] === ')') depth -= 1;
      index += 1;
    }
    statements.push({
      sql: source.slice(match.index + match[0].length, index - 1),
      line: source.slice(0, match.index).split('\n').length
    });
  }
  return statements;
}

function duplicateMarkers(sql) {
  const names = [...sql.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)].map(hit => hit[1]);
  return [...new Set(names.filter(name => names.filter(other => other === name).length > 1))];
}

test('native prepared statements are enabled, so markers must be unique', () => {
  assert.match(read('config/database.php'), /PDO::ATTR_EMULATE_PREPARES\s*=>\s*false/);
});

test('no prepared statement reuses a named placeholder', () => {
  const offenders = [];
  for (const file of phpSources()) {
    for (const { sql, line } of preparedStatements(read(file))) {
      const duplicates = duplicateMarkers(sql);
      if (duplicates.length > 0) offenders.push(`${file}:${line} reuses ${duplicates.join(', ')}`);
    }
  }
  assert.deepEqual(offenders, [], `Duplicate named placeholders break native prepares:\n${offenders.join('\n')}`);
});

test('login resolves email and username through two distinct markers', () => {
  const login = read('api/login.php');
  assert.match(login, /u\.email = :identifier_email OR u\.username = :identifier_username/);
  assert.match(login, /'identifier_email'\s*=>\s*\$identifier/);
  assert.match(login, /'identifier_username'\s*=>\s*\$identifier/);
  // The single-marker form that produced the HY093 login outage must not return.
  for (const { sql } of preparedStatements(login)) {
    assert.doesNotMatch(sql, /:identifier\b(?!_)/);
  }
});

test('student and parent homework lookups bind separate markers', () => {
  for (const file of ['api/student.php', 'api/parent.php']) {
    const source = read(file);
    assert.match(source, /sub\.student_id = :sid_submission/, file);
    assert.match(source, /WHERE se\.student_id = :sid_enrollment/, file);
  }
});
