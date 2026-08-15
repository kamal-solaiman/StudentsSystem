'use strict';

/**
 * P1-J Study Groups — backend behavior tests (php-wasm runtime harness).
 *
 * These tests execute the REAL `api/teacher.php` endpoint code inside a real
 * PHP 8.4 interpreter (php-wasm) with the REAL session / CSRF / RBAC stack
 * (config/auth.php) and a REAL embedded SQL database (@electric-sql/pglite
 * exposed to PHP through the php-wasm "pgsql" PDO driver). Only three things
 * are substituted, and all of them are test doubles for the runtime glue,
 * never for the P1-J logic:
 *
 *   1. `require_once config/*.php` — helper.php/auth.php bodies are inlined
 *      verbatim instead (there is no /config directory in the WASM filesystem).
 *   2. `Helper::getJsonInput()` — replaced by `teacherTestGetJsonInput()`,
 *      which returns a test-supplied request body (php://input cannot be
 *      injected in the embed SAPI).
 *   3. `DatabaseConnection::fromConfigFile()->connect()` — returns a PDO
 *      connection to an in-memory pglite database instead of MySQL.
 *
 * Known pglite-driver quirks that the harness compensates for (documented
 * here so the compensations are auditable):
 *   - `PDO::lastInsertId()` throws in this driver build → `TestPdo` re-reads
 *     `SELECT LASTVAL()`.
 *   - `PDOStatement::rowCount()` returns 0 for successful UPDATE/DELETE in
 *     this driver build (MySQL returns the affected-row count) →
 *     `HarnessStatement` reports 1 when the endpoint deleted/updated a row it
 *     already locked with FOR UPDATE in the same transaction (which is the
 *     only scenario the endpoint's rowCount check can legitimately hit).
 *   - MySQL accepts double-quoted string literals ("present"); PostgreSQL
 *     treats them as identifiers. The pre-existing (non-P1-J) attendance
 *     queries in the GET flow use them, so the harness attendance table adds
 *     `present`/`absent`/`late` columns whose values make those two queries
 *     evaluate identically to MySQL. P1-J code uses only single quotes.
 *   - `PDO::commit()` crashes this driver build → `TestPdo::commit()` is a
 *     documented no-op (the connection is discarded at the end of each case,
 *     so durability is irrelevant to the assertions); `rollBack()` stays real
 *     because the 409 dependency-refusal paths depend on it.
 *
 * Live MySQL is NOT available in this sandbox; these tests cover the endpoint
 * behavior with a real SQL engine, and MySQL-specific dialect differences are
 * limited to the pre-existing queries noted above.
 *
 * Requirements: `npm install --no-save php-wasm @electric-sql/pglite`
 * (node_modules is git-ignored). Without them every test here is skipped.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

/* ------------------------------------------------------------------ */
/* Dependency loading                                                  */
/* ------------------------------------------------------------------ */

async function loadPhpWasm() {
  const base = path.join(root, 'node_modules', 'php-wasm');
  const pgliteEntry = path.join(root, 'node_modules', '@electric-sql', 'pglite', 'dist', 'index.js');
  if (!fs.existsSync(path.join(base, 'PhpNode.mjs')) || !fs.existsSync(pgliteEntry)) {
    return null;
  }
  try {
    const [{ PhpNode }, { PGlite }] = await Promise.all([
      import(pathToFileURL(path.join(base, 'PhpNode.mjs')).href),
      import(pathToFileURL(pgliteEntry).href)
    ]);
    return { PhpNode, PGlite };
  } catch (error) {
    console.error('[study_groups_backend_phpwasm] php-wasm unavailable:', error && error.message);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* PHP source preparation                                              */
/* ------------------------------------------------------------------ */

/**
 * config/helper.php for the harness: sendJson() THROWS HarnessExit instead of
 * calling exit(), because exit() terminates the whole php-wasm runtime and
 * would make every subsequent run() in the same PhpNode produce no output.
 */
function harnessHelperSource(source) {
  const body = stripConfigFile(source);
  // Whitespace-tolerant so minor re-indentation of helper.php does not break
  // the harness; the OPTIONS path is never taken by these tests.
  const sendJsonRe = /echo json_encode\(\$data, JSON_UNESCAPED_UNICODE \| JSON_PRETTY_PRINT\);\s*\n\s*exit;/;
  const optionsRe = /'message' => 'Origin not allowed'\s*\n\s*\], JSON_UNESCAPED_UNICODE\);\s*\n\s*exit;/;
  if (!sendJsonRe.test(body) || !optionsRe.test(body)) {
    throw new Error('config/helper.php shape changed — update the harness transforms');
  }
  return body
    .replace(sendJsonRe, 'throw new HarnessExit($data, $statusCode);')
    .replace(
      optionsRe,
      "'message' => 'Origin not allowed'\n            ], JSON_UNESCAPED_UNICODE);\n            throw new HarnessExit(['success' => false, 'message' => 'Origin not allowed'], $statusCode);"
    );
}

function stripConfigFile(source) {
  return source
    .replace(/^<\?php\s*/, '')
    .replace(/^declare\(strict_types\s*=\s*1\);\s*/m, '')
    .replace(/require_once\s+__DIR__\s*\.\s*'[^']*';\s*/g, '');
}

/** The endpoint under test, minus runtime glue (see file header). */
function endpointFragment() {
  const source = read('api/teacher.php')
    .replace(/^<\?php\s*/, '')
    .replace(/^declare\(strict_types\s*=\s*1\);\s*/m, '')
    .replace(/require_once\s+__DIR__\s*\.\s*'[^']*';\s*/g, '')
    .replace(/Helper::getJsonInput\(\)/g, 'teacherTestGetJsonInput()');
  // Harness-only patch (documented in the file header): the endpoint's own
  // catch(Throwable) must not swallow the harness control-flow exception —
  // genuine exceptions still take the original 500 path.
  const rethrowGuard = source.replace(
    /(\} catch \(Throwable \$exception\) \{\n\s*)(\/\/ SECURITY \(P1-I\): log full details)/,
    '$1if ($exception instanceof \\HarnessExit) { throw $exception; }\n            $2'
  );
  return 'function endpointMain(): void {\n' + rethrowGuard + '\n}';
}

/* ------------------------------------------------------------------ */
/* PHP literal / schema builders                                       */
/* ------------------------------------------------------------------ */

function phpLiteral(value) {
  if (value && typeof value === 'object' && value.__php) return value.__php;
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    return "'" + value
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n') + "'";
  }
  if (Array.isArray(value)) {
    return 'array(' + value.map(phpLiteral).join(', ') + ')';
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).map(([key, item]) => `${phpLiteral(key)} => ${phpLiteral(item)}`);
    return 'array(' + entries.join(', ') + ')';
  }
  throw new Error('Cannot serialize value to a PHP literal: ' + typeof value);
}

/** Base schema shared by every case. */
const BASE_SCHEMA = `
\\Keep::$pdo->exec("CREATE TABLE academic_classes (id SERIAL PRIMARY KEY, teacher_id INTEGER NOT NULL, name TEXT NOT NULL, level TEXT NOT NULL, grade TEXT NULL, description TEXT NULL, created_at TEXT)");
\\Keep::$pdo->exec("CREATE TABLE study_groups (id SERIAL PRIMARY KEY, teacher_id INTEGER NOT NULL, class_id INTEGER NOT NULL, name TEXT NOT NULL, study_days TEXT NOT NULL, class_time TEXT NOT NULL, end_time TEXT NULL, shift TEXT NOT NULL, price NUMERIC(10,2) NOT NULL, payment_scheme TEXT NOT NULL, created_at TEXT)");
\\Keep::$pdo->exec("CREATE TABLE student_enrollments (id SERIAL PRIMARY KEY, teacher_id INTEGER, student_id INTEGER, class_id INTEGER, group_id INTEGER, enrollment_date TEXT, status TEXT, payment_status TEXT, created_at TEXT)");
\\Keep::$pdo->exec("CREATE TABLE attendance_records (id SERIAL PRIMARY KEY, teacher_id INTEGER, student_id INTEGER, group_id INTEGER, date TEXT, status TEXT, present TEXT, absent TEXT, late TEXT)");
\\Keep::$pdo->exec("CREATE TABLE exams (id SERIAL PRIMARY KEY, teacher_id INTEGER, group_id INTEGER)");
\\Keep::$pdo->exec("CREATE TABLE homeworks (id SERIAL PRIMARY KEY, teacher_id INTEGER, group_id INTEGER)");
\\Keep::$pdo->exec("CREATE TABLE lesson_videos (id SERIAL PRIMARY KEY, teacher_id INTEGER, group_id INTEGER)");
\\Keep::$pdo->exec("CREATE TABLE teachers (id SERIAL PRIMARY KEY, user_id INTEGER, name TEXT, center_name TEXT, phone TEXT, address TEXT, logo TEXT, subject TEXT, price_per_student NUMERIC(10,2), created_at TEXT)");
\\Keep::$pdo->exec("CREATE TABLE students (id SERIAL PRIMARY KEY, user_id INTEGER, student_code TEXT, name TEXT, phone TEXT, parent_phone TEXT, parent_user_id INTEGER, grade_level TEXT, qr_code_token TEXT, created_at TEXT)");
\\Keep::$pdo->exec("CREATE TABLE teacher_staff (id SERIAL PRIMARY KEY, teacher_id INTEGER, user_id INTEGER, role_title TEXT, permissions TEXT, created_at TEXT)");
\\Keep::$pdo->exec("CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT, email TEXT, phone TEXT)");
`;

/**
 * In PostgreSQL SERIAL sequences ignore explicitly inserted ids, so the next
 * auto id would collide with the seeded rows. Bump the sequence (the endpoint
 * only auto-inserts into study_groups in these cases).
 */
const BUMP_SEQUENCE = `
\\Keep::$pdo->exec("SELECT setval(pg_get_serial_sequence('study_groups', 'id'), (SELECT COALESCE(MAX(id), 1) FROM study_groups))");
`;

/** Seed two tenants (classes + groups) and a dependency set for group 1. */
function seedTwoTenants(today) {
  return `
\\Keep::$pdo->exec("INSERT INTO teachers (id, user_id, name, center_name, phone, address, subject, price_per_student) VALUES (1, 2, 'أ. أحمد محمود', 'سنتر النخبة', '01011111111', 'الدقي', 'الفيزياء', 45.00), (2, 3, 'أ. سارة عادل', 'أكاديمية التفوق', '01022222222', 'المعادي', 'الرياضيات', 50.00)");
\\Keep::$pdo->exec("INSERT INTO academic_classes (id, teacher_id, name, level, grade) VALUES (1, 1, 'الصف الثالث الثانوي', 'secondary', 'third'), (4, 2, 'الصف الثالث الثانوي', 'secondary', 'third')");
\\Keep::$pdo->exec("INSERT INTO study_groups (id, teacher_id, class_id, name, study_days, class_time, shift, price, payment_scheme) VALUES (1, 1, 1, 'مجموعة الأحد والثلاثاء', '[\\"الأحد\\", \\"الثلاثاء\\"]', '05:00 مساءً', 'evening', 350.00, 'monthly'), (2, 1, 1, 'مجموعة السبت', '[\\"السبت\\"]', '10:00 صباحاً', 'morning', 300.00, 'monthly'), (4, 2, 4, 'مجموعة التفوق', '[\\"الأحد\\", \\"الأربعاء\\"]', '07:00 مساءً', 'evening', 400.00, 'monthly')");
\\Keep::$pdo->exec("INSERT INTO student_enrollments (id, teacher_id, student_id, class_id, group_id, enrollment_date, status, payment_status) VALUES (1, 1, 1, 1, 1, '2026-01-15', 'active', 'paid')");
\\Keep::$pdo->exec("INSERT INTO attendance_records (id, teacher_id, student_id, group_id, date, status, present, absent, late) VALUES (1, 1, 1, 1, '${today}', 'present', 'present', 'absent', 'late')");
\\Keep::$pdo->exec("INSERT INTO exams (id, teacher_id, group_id) VALUES (1, 1, 1)");
\\Keep::$pdo->exec("INSERT INTO homeworks (id, teacher_id, group_id) VALUES (1, 1, 1)");
\\Keep::$pdo->exec("INSERT INTO lesson_videos (id, teacher_id, group_id) VALUES (1, 1, 1)");
\\Keep::$pdo->exec("INSERT INTO students (id, user_id, student_code, name, phone, parent_phone, grade_level, qr_code_token) VALUES (1, 6, 'STU-10045', 'يوسف محمد سعيد', '01044444441', '01099999999', 'ثالثة ثانوي', 'QR-1')");
\\Keep::$pdo->exec("INSERT INTO users (id, name, email, phone) VALUES (4, 'أ. خالد سامح', 'khaled@staff.edu', '01033333333')");
\\Keep::$pdo->exec("INSERT INTO teacher_staff (id, teacher_id, user_id, role_title, permissions) VALUES (1, 1, 4, 'secretary', '[]')");
${BUMP_SEQUENCE}
`;
}

/* ------------------------------------------------------------------ */
/* Harness runner                                                      */
/* ------------------------------------------------------------------ */

function buildHarness(state) {
  const php = new state.PhpNode({
    PGlite: state.PGlite,
    // The pglite PDO bridge logs every statement to the host console;
    // silence it so the node:test TAP stream stays parseable.
    print: () => {},
    printErr: () => {}
  });

  const events = [];
  php.addEventListener('output', event => { events.push(event.detail); });
  php.addEventListener('error', event => { events.push('__STDERR__: ' + event.detail); });

  const run = async code => {
    // The pglite PDO bridge prints every SQL statement through console.log;
    // silence the host console while PHP runs so the TAP stream stays clean.
    const originalLog = console.log;
    const originalError = console.error;
    console.log = () => {};
    console.error = () => {};
    try {
      events.length = 0;
      await php.run(code);
      return events.join('');
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
  };

  return { php, run };
}

function buildBootstrap() {
  return [
    '<?php',
    'function teacherTestGetJsonInput(): array {',
    '    return isset($GLOBALS[\'TEST_INPUT\']) && is_array($GLOBALS[\'TEST_INPUT\']) ? $GLOBALS[\'TEST_INPUT\'] : [];',
    '}',
    'function teacherTestSetGlobals(array $server, array $get, array $session, array $input): void {',
    '    $_SERVER = array_merge($_SERVER ?? [], $server);',
    '    $_GET = $get;',
    '    // Every run() is a fresh PHP request: open the session FIRST (before',
    '    // any output) so AuthManager::startSession() finds it active and',
    '    // header-related warnings cannot fire.',
    '    if (session_status() !== PHP_SESSION_ACTIVE) { @session_start(); }',
    '    foreach ($session as $key => $value) { $_SESSION[$key] = $value; }',
    '    $GLOBALS[\'TEST_INPUT\'] = $input;',
    '}',
    'class HarnessStatement extends PDOStatement {',
    '    public function rowCount(): int {',
    '        $native = parent::rowCount();',
    '        if ($native > 0) { return $native; }',
    '        // pglite driver quirk: successful UPDATE/DELETE reports 0 affected',
    '        // rows. MySQL reports 1, so mirror that for the endpoint\\\'s',
    '        // defensive rowCount check (the row was already FOR UPDATE-locked',
    '        // in the same transaction, so it cannot have vanished).',
    '        $head = strtoupper(substr(ltrim((string)$this->queryString), 0, 12));',
    '        return (str_starts_with($head, \'UPDATE\') || str_starts_with($head, \'DELETE\')) ? 1 : $native;',
    '    }',
    '}',
    'class TestPdo extends PDO {',
    '    public function __construct() {',
    '        parent::__construct(\'pgsql:\');',
    '        $this->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);',
    '        $this->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);',
    '        $this->setAttribute(PDO::ATTR_STATEMENT_CLASS, [\'HarnessStatement\']);',
    '    }',
    '    public function commit(): bool {',
    '        // pglite driver quirk: COMMIT crashes the embedded runtime. The',
    '        // connection is thrown away at the end of each case, so a no-op',
    '        // commit preserves observable in-transaction behavior. rollBack()',
    '        // stays real (needed by the 409 dependency-refusal paths).',
    '        return true;',
    '    }',
    '    public function lastInsertId(?string $name = null): string|false {',
    '        // pglite driver quirk: native lastInsertId() throws; re-read LASTVAL().',
    '        $st = $this->query(\'SELECT LASTVAL()\');',
    '        $row = $st->fetch(PDO::FETCH_NUM);',
    '        return $row === false ? false : (string)$row[0];',
    '    }',
    '}',
    'final class DatabaseConnection {',
    '    public static function fromConfigFile(): DatabaseConnection { return new self(); }',
    '    public function connect(): PDO {',
    '        if (\\Keep::$pdo === null) { throw new RuntimeException(\'no test connection\'); }',
    '        return \\Keep::$pdo;',
    '    }',
    '}',
    'final class Keep { public static ?PDO $pdo = null; }',
    'final class HarnessExit extends Exception {',
    '    public array $data;',
    '    public int $status;',
    '    public function __construct(array $data, int $status) {',
    '        parent::__construct(\'harness response\');',
    '        $this->data = $data;',
    '        $this->status = $status;',
    '    }',
    '}',
    harnessHelperSource(read('config/helper.php')),
    stripConfigFile(read('config/auth.php')),
  ].join('\n');
}

// last_activity is a far-future timestamp so the 30-minute idle timeout never
// fires inside the harness (the endpoint refreshes it on every request).
const SESSION_TEACHER_1 = {
  user_id: 2, name: 'أ. أحمد محمود', email: 'ahmed@physics.edu', role: 'teacher',
  phone: '01011111111', tenant_teacher_id: 1, last_activity: { __php: 'time()' }, csrf_token: 'csrf-ok', csrf_token_time: { __php: 'time()' }
};
const SESSION_TEACHER_2 = { ...SESSION_TEACHER_1, user_id: 3, name: 'أ. سارة عادل', email: 'sara@math.edu', tenant_teacher_id: 2 };

const VALID_CREATE_PAYLOAD = {
  name: 'مجموعة الفيزياء الجديدة',
  class_id: 1,
  study_days: ['الثلاثاء', 'الأحد', 'الثلاثاء'], // duplicate + out-of-order: must normalize
  start_time: '17:30',
  end_time: '18:30',
  shift: 'evening',
  price: 350,
  payment_scheme: 'monthly'
};

/* ------------------------------------------------------------------ */
/* Test runtime                                                        */
/* ------------------------------------------------------------------ */

(async () => {
  const deps = await loadPhpWasm();
  const skip = deps
    ? false
    : 'php-wasm / @electric-sql/pglite not installed — run: npm install --no-save php-wasm @electric-sql/pglite';

  let harness;
  let caseIndex = 0;
  const today = new Date().toISOString().slice(0, 10);

  // A fresh PHP runtime per TEST, not per case: every case allocates a PGlite
  // database inside the WASM heap and long-lived instances accumulate memory
  // until the sandbox OOM-kills the process. Recreating the (cheap) runtime
  // per test bounds the footprint while the shared HarnessExit design keeps
  // every case inside one surviving runtime.
  test.beforeEach(async () => {
    if (skip) return;
    harness = buildHarness(deps);
    await harness.run(buildBootstrap());
  });

  /**
   * Run one endpoint request inside its own PHP namespace with a fresh
   * in-memory database, then return the captured output.
   */
  async function runEndpointCase(options) {
    caseIndex += 1;
    const ns = `Case${caseIndex}`;
    const code = [
      `<?php namespace ${ns} {`,
      // Unqualified global classes must be imported: php-wasm resolves
      // unqualified class references inside a namespace at compile time.
      'use PDO; use PDOStatement; use Throwable; use Helper; use AuthManager; use DatabaseConnection; use HarnessExit;',
      `\\teacherTestSetGlobals(${phpLiteral({ REQUEST_METHOD: 'POST', ...(options.server || {}) })}, ${phpLiteral(options.get || {})}, ${phpLiteral(options.session || SESSION_TEACHER_1)}, ${phpLiteral(options.input || [])});`,
      '\\Keep::$pdo = new \\TestPdo();',
      BASE_SCHEMA,
      options.seed || seedTwoTenants(today),
      endpointFragment(),
      'try {',
      '    endpointMain();',
      '    echo "\\n__NO_EXIT__\\n";',
      '} catch (HarnessExit $response) {',
      '    echo "\\n__EXIT__" . $response->status . "__" . json_encode($response->data, JSON_UNESCAPED_UNICODE) . "\\n";',
      '}',
      '}',
    ].join('\n');
    const out = await harness.run(code);
    if (process.env.HARNESS_DEBUG) {
      console.error('=== RAW OUT for ' + ns + ' ===');
      console.error(JSON.stringify(out));
    }
    assert.ok(!out.includes('__NO_EXIT__'), `endpoint did not exit (missing terminal response):\n${out}`);
    assert.ok(!out.includes('Fatal error'), `PHP fatal during case:\n${out}`);
    return { ns, out };
  }

  /** Validation errors arrive under `error`; safe errors under `message`. */
  function responseMessage(result) {
    return result.data.message ?? result.data.error;
  }

  /** Parse the harness response marker emitted by the case driver. */
  function exitResult(out) {
    const match = out.match(/__EXIT__(\d+)__(\{.*\})\s*$/s);
    assert.ok(match, `no __EXIT__ response captured:\n${out}`);
    return { status: Number(match[1]), data: JSON.parse(match[2]) };
  }

  /** Run a small verification script against the case's persisted database. */
  async function verifyCase(ns, phpCode) {
    const out = await harness.run(`<?php namespace ${ns}Verify { use PDO; ${phpCode} }`);
    assert.ok(!out.includes('Fatal error'), `verification fatal:\n${out}`);
    return out;
  }

  function groupsFromDb(ns) {
    const stmt = `echo 'VERIFY:' . json_encode(array_map(static function (array $row): array {
        return ['id' => $row['id'], 'teacher_id' => $row['teacher_id'], 'class_id' => $row['class_id'],
                'name' => $row['name'], 'study_days' => $row['study_days'], 'class_time' => $row['class_time'], 'end_time' => $row['end_time'],
                'shift' => $row['shift'], 'price' => $row['price'], 'payment_scheme' => $row['payment_scheme']];
    }, \\Keep::$pdo->query('SELECT * FROM study_groups ORDER BY id ASC')->fetchAll(PDO::FETCH_ASSOC)));`;
    return verifyCase(ns, stmt).then(out => JSON.parse(out.slice(out.indexOf('VERIFY:') + 7)));
  }

  /* ================================================================ */
  /* create_group                                                     */
  /* ================================================================ */

  test('create_group persists canonical normalized values (POST, teacher 1)', { skip }, async () => {
    const { ns, out } = await runEndpointCase({
      input: { action: 'create_group', csrf_token: 'csrf-ok', payload: VALID_CREATE_PAYLOAD }
    });
    const result = exitResult(out);
    const body = result.data;
    assert.equal(result.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.message, 'تم إضافة المجموعة الدراسية بنجاح');
    assert.equal(body.id, 5); // seeded ids 1,2,4 → sequence bumped to MAX(id)=4 → next id is 5

    const rows = await groupsFromDb(ns);
    const created = rows.find(row => Number(row.id) === 5);
    assert.ok(created, 'created group missing from the database, rows=' + JSON.stringify(rows));
    assert.equal(String(created.teacher_id), '1');
    assert.equal(String(created.class_id), '1');
    assert.equal(created.name, 'مجموعة الفيزياء الجديدة');
    // duplicate day dropped, canonical Arabic week order applied
    assert.deepEqual(JSON.parse(created.study_days), ['الأحد', 'الثلاثاء']);
    assert.equal(created.class_time, '17:30');
    assert.equal(created.end_time, '18:30');
    assert.equal(created.shift, 'evening');
    assert.equal(created.price, '350.00');
    assert.equal(created.payment_scheme, 'monthly');
  });

  test('create_group rejects a class owned by another teacher (403)', { skip }, async () => {
    const { out } = await runEndpointCase({
      input: { action: 'create_group', csrf_token: 'csrf-ok', payload: { ...VALID_CREATE_PAYLOAD, class_id: 4 } }
    });
    const result = exitResult(out);
    const body = result.data;
    assert.equal(body.success, false);
    assert.equal(body.message, 'Access denied');
  });

  test('create_group rejects a nonexistent class (404)', { skip }, async () => {
    const { out } = await runEndpointCase({
      input: { action: 'create_group', csrf_token: 'csrf-ok', payload: { ...VALID_CREATE_PAYLOAD, class_id: 99 } }
    });
    const result = exitResult(out);
    const body = result.data;
    assert.equal(body.success, false);
    assert.equal(body.message, 'الصف الدراسي غير موجود');
  });

  test('create_group rejects an empty or non-string name (400)', { skip }, async () => {
    for (const name of ['', '   ']) {
      const { out } = await runEndpointCase({
        input: { action: 'create_group', csrf_token: 'csrf-ok', payload: { ...VALID_CREATE_PAYLOAD, name } }
      });
      assert.equal(exitResult(out).status, 400);
    assert.equal(responseMessage(exitResult(out)), 'اسم المجموعة مطلوب');
    }
    const { out } = await runEndpointCase({
      input: { action: 'create_group', csrf_token: 'csrf-ok', payload: { ...VALID_CREATE_PAYLOAD, name: ['x'] } }
    });
    assert.equal(exitResult(out).status, 400);
    assert.equal(responseMessage(exitResult(out)), 'اسم المجموعة مطلوب');
  });

  test('create_group rejects an overlong name (>150 chars, 400)', { skip }, async () => {
    const { out } = await runEndpointCase({
      input: { action: 'create_group', csrf_token: 'csrf-ok', payload: { ...VALID_CREATE_PAYLOAD, name: 'م'.repeat(151) } }
    });
    assert.equal(exitResult(out).status, 400);
    assert.match(responseMessage(exitResult(out)), /الحد الأقصى 150 حرفاً/);
  });

  test('create_group rejects a missing or malformed class id (400)', { skip }, async () => {
    for (const classId of [undefined, 0, -3, 'abc', '1.5']) {
      const payload = { ...VALID_CREATE_PAYLOAD };
      delete payload.class_id;
      if (classId !== undefined) payload.class_id = classId;
      const { out } = await runEndpointCase({
        input: { action: 'create_group', csrf_token: 'csrf-ok', payload }
      });
      assert.equal(exitResult(out).status, 400, `class_id=${JSON.stringify(classId)}`);
      assert.equal(responseMessage(exitResult(out)), 'الصف الدراسي مطلوب', `class_id=${JSON.stringify(classId)}`);
    }
  });

  test('create_group rejects empty / invalid / all-invalid day selections (400)', { skip }, async () => {
    const cases = [
      { days: [], expected: 'يرجى اختيار يوم دراسة واحد على الأقل' },
      { days: 'الأحد', expected: 'يرجى اختيار يوم دراسة واحد على الأقل' },
      { days: ['الاثنين', 'nope', 42], expected: 'أيام الدراسة غير صالحة' },
      { days: [null, false], expected: 'أيام الدراسة غير صالحة' }
    ];
    for (const item of cases) {
      const { out } = await runEndpointCase({
        input: { action: 'create_group', csrf_token: 'csrf-ok', payload: { ...VALID_CREATE_PAYLOAD, study_days: item.days } }
      });
      assert.equal(exitResult(out).status, 400, JSON.stringify(item.days));
      assert.equal(responseMessage(exitResult(out)), item.expected, JSON.stringify(item.days));
    }
  });

  test('create_group rejects malformed or localized lesson START times (400)', { skip }, async () => {
    for (const startTime of ['25:00', '5:30', '05:60', '17:30:00', '05:00 مساءً', '', 1730]) {
      const { out } = await runEndpointCase({
        input: { action: 'create_group', csrf_token: 'csrf-ok', payload: { ...VALID_CREATE_PAYLOAD, start_time: startTime } }
      });
      assert.equal(exitResult(out).status, 400, `start_time=${JSON.stringify(startTime)}`);
      assert.equal(responseMessage(exitResult(out)), 'موعد بداية الحصة غير صالح', `start_time=${JSON.stringify(startTime)}`);
    }
  });

  test('create_group rejects malformed or missing lesson END times (400)', { skip }, async () => {
    for (const endTime of ['25:00', '5:30', '05:60', '18:30:00', '06:30 مساءً', '', 1830, undefined]) {
      const payload = { ...VALID_CREATE_PAYLOAD };
      if (endTime === undefined) { delete payload.end_time; } else { payload.end_time = endTime; }
      const { out } = await runEndpointCase({
        input: { action: 'create_group', csrf_token: 'csrf-ok', payload }
      });
      assert.equal(exitResult(out).status, 400, `end_time=${JSON.stringify(endTime)}`);
      assert.equal(responseMessage(exitResult(out)), 'موعد نهاية الحصة غير صالح', `end_time=${JSON.stringify(endTime)}`);
    }
  });

  test('create_group rejects an inverted or zero-length time range (400)', { skip }, async () => {
    for (const range of [{ start_time: '10:00', end_time: '10:00' }, { start_time: '11:00', end_time: '10:30' }]) {
      const { out } = await runEndpointCase({
        input: { action: 'create_group', csrf_token: 'csrf-ok', payload: { ...VALID_CREATE_PAYLOAD, ...range } }
      });
      assert.equal(exitResult(out).status, 400, JSON.stringify(range));
      assert.equal(responseMessage(exitResult(out)), 'وقت نهاية الحصة يجب أن يكون بعد وقت بدايتها', JSON.stringify(range));
    }
  });

  test('create_group accepts valid ranges (09:00→10:30, 17:30→18:30)', { skip }, async () => {
    for (const range of [{ start_time: '09:00', end_time: '10:30' }, { start_time: '17:30', end_time: '18:30' }]) {
      const { out } = await runEndpointCase({
        input: { action: 'create_group', csrf_token: 'csrf-ok', payload: { ...VALID_CREATE_PAYLOAD, ...range } }
      });
      const result = exitResult(out);
      assert.equal(result.status, 200, JSON.stringify(range));
      assert.equal(result.data.success, true, JSON.stringify(range));
    }
  });

  test('create_group rejects an invalid shift (400)', { skip }, async () => {
    const { out } = await runEndpointCase({
      input: { action: 'create_group', csrf_token: 'csrf-ok', payload: { ...VALID_CREATE_PAYLOAD, shift: 'صباحي' } }
    });
    assert.equal(exitResult(out).status, 400);
    assert.equal(responseMessage(exitResult(out)), 'الفترة غير صالحة (صباحي أو مسائي)');
  });

  test('create_group rejects negative / over-precision / oversized prices (400)', { skip }, async () => {
    const cases = [
      { price: -1, expected: 'سعر الدرس لا يمكن أن يكون سالبًا' },
      { price: 12.345, expected: 'سعر الدرس يجب ألا يتضمن أكثر من رقمين عشريين' },
      { price: 100000000, expected: 'سعر الدرس يتجاوز الحد الأقصى المسموح' },
      { price: 'abc', expected: 'سعر الدرس مطلوب ويجب أن يكون رقمًا' },
      { price: undefined, expected: 'سعر الدرس مطلوب ويجب أن يكون رقمًا' }
    ];
    for (const item of cases) {
      const payload = { ...VALID_CREATE_PAYLOAD };
      delete payload.price;
      if (item.price !== undefined) payload.price = item.price;
      const { out } = await runEndpointCase({
        input: { action: 'create_group', csrf_token: 'csrf-ok', payload }
      });
      assert.equal(exitResult(out).status, 400, `price=${JSON.stringify(item.price)}`);
      assert.equal(responseMessage(exitResult(out)), item.expected, `price=${JSON.stringify(item.price)}`);
    }
  });

  test('create_group rejects payment schemes outside the schema ENUM (400)', { skip }, async () => {
    for (const scheme of ['daily', 'weekly', 'سنوي', '']) {
      const { out } = await runEndpointCase({
        input: { action: 'create_group', csrf_token: 'csrf-ok', payload: { ...VALID_CREATE_PAYLOAD, payment_scheme: scheme } }
      });
      assert.equal(exitResult(out).status, 400, `scheme=${JSON.stringify(scheme)}`);
      assert.equal(responseMessage(exitResult(out)), 'نظام الدفع غير صالح', `scheme=${JSON.stringify(scheme)}`);
    }
  });

  test('create_group accepts per_session and stores the canonical database value', { skip }, async () => {
    const { ns, out } = await runEndpointCase({
      input: {
        action: 'create_group', csrf_token: 'csrf-ok',
        payload: { ...VALID_CREATE_PAYLOAD, name: 'مجموعة بالحصة', payment_scheme: 'per_session', price: 60 }
      }
    });
    assert.equal(exitResult(out).status, 200);
    assert.equal(exitResult(out).data.success, true);
    const rows = await groupsFromDb(ns);
    assert.equal(rows.find(row => row.name === 'مجموعة بالحصة').payment_scheme, 'per_session');
  });

  test('create_group without a valid CSRF token is rejected', { skip }, async () => {
    const missing = await runEndpointCase({
      input: { action: 'create_group', payload: VALID_CREATE_PAYLOAD } // no csrf_token
    });
    assert.equal(exitResult(missing.out).status, 403);
    assert.equal(responseMessage(exitResult(missing.out)), 'Invalid CSRF token');

    const wrong = await runEndpointCase({
      input: { action: 'create_group', csrf_token: 'tampered', payload: VALID_CREATE_PAYLOAD }
    });
    assert.equal(exitResult(wrong.out).status, 403);
    assert.equal(responseMessage(exitResult(wrong.out)), 'Invalid CSRF token');
  });

  /* ================================================================ */
  /* update_group                                                     */
  /* ================================================================ */

  test('update_group updates only the owner\'s group and persists every field', { skip }, async () => {
    const { ns, out } = await runEndpointCase({
      input: {
        action: 'update_group', csrf_token: 'csrf-ok',
        payload: {
          id: 1, name: 'مجموعة محدثة', class_id: 1,
          study_days: ['الخميس', 'السبت', 'السبت'], start_time: '09:00',
          end_time: '10:30', shift: 'morning', price: 250, payment_scheme: 'monthly'
        }
      }
    });
    const result = exitResult(out);
    const body = result.data;
    assert.equal(result.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.message, 'تم تحديث المجموعة الدراسية بنجاح');

    const rows = await groupsFromDb(ns);
    const updated = rows.find(row => Number(row.id) === 1);
    assert.equal(updated.name, 'مجموعة محدثة');
    assert.equal(String(updated.teacher_id), '1');
    assert.deepEqual(JSON.parse(updated.study_days), ['السبت', 'الخميس']);
    assert.equal(updated.class_time, '09:00');
    assert.equal(updated.end_time, '10:30');
    assert.equal(updated.shift, 'morning');
    assert.equal(updated.price, '250.00');
    // other tenants / groups untouched
    assert.equal(rows.find(row => Number(row.id) === 4).name, 'مجموعة التفوق');
  });

  test('update_group rejects another teacher\'s group (403) and a missing one (404)', { skip }, async () => {
    const foreign = await runEndpointCase({
      input: { action: 'update_group', csrf_token: 'csrf-ok', payload: { id: 4, ...VALID_CREATE_PAYLOAD, class_id: 4 } }
    });
    assert.equal(exitResult(foreign.out).status, 403);
    assert.equal(responseMessage(exitResult(foreign.out)), 'Access denied');

    const missing = await runEndpointCase({
      input: { action: 'update_group', csrf_token: 'csrf-ok', payload: { id: 999, ...VALID_CREATE_PAYLOAD } }
    });
    assert.equal(exitResult(missing.out).status, 404);
    assert.equal(responseMessage(exitResult(missing.out)), 'المجموعة غير موجودة');

    const badId = await runEndpointCase({
      input: { action: 'update_group', csrf_token: 'csrf-ok', payload: { id: 'abc', ...VALID_CREATE_PAYLOAD } }
    });
    assert.equal(exitResult(badId.out).status, 400);
    assert.equal(responseMessage(exitResult(badId.out)), 'معرف المجموعة غير صالح');
  });

  test('update_group runs the same payload validation as create (400)', { skip }, async () => {
    const { out } = await runEndpointCase({
      input: { action: 'update_group', csrf_token: 'csrf-ok', payload: { id: 1, ...VALID_CREATE_PAYLOAD, payment_scheme: 'daily' } }
    });
    assert.equal(exitResult(out).status, 400);
    assert.equal(responseMessage(exitResult(out)), 'نظام الدفع غير صالح');
  });

  /* ================================================================ */
  /* delete_group                                                     */
  /* ================================================================ */

  test('delete_group refuses groups with dependent data (409, row survives)', { skip }, async () => {
    const { ns, out } = await runEndpointCase({
      server: { REQUEST_METHOD: 'DELETE', HTTP_X_CSRF_TOKEN: 'csrf-ok' },
      get: { entity: 'group', id: '1' },
      input: [] // DELETE has no JSON body; CSRF arrives via the header
    });
    const result = exitResult(out);
    const body = result.data;
    assert.equal(result.status, 409);
    assert.equal(body.success, false);
    assert.match(body.message, /لا يمكن حذف المجموعة لارتباطها ببيانات أخرى/);

    const rows = await groupsFromDb(ns);
    assert.ok(rows.find(row => Number(row.id) === 1), 'group 1 must survive the 409');
  });

  test('delete_group deletes a clean group owned by the session tenant', { skip }, async () => {
    const { ns, out } = await runEndpointCase({
      server: { REQUEST_METHOD: 'DELETE', HTTP_X_CSRF_TOKEN: 'csrf-ok' },
      get: { entity: 'group', id: '2' },
      input: []
    });
    const result = exitResult(out);
    const body = result.data;
    assert.equal(result.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.message, 'تم حذف المجموعة بنجاح');

    const rows = await groupsFromDb(ns);
    assert.equal(rows.some(row => Number(row.id) === 2), false);
    assert.equal(rows.some(row => Number(row.id) === 1), true);
  });

  test('delete_group returns 403 for another tenant and 404 for a missing group', { skip }, async () => {
    const foreign = await runEndpointCase({
      server: { REQUEST_METHOD: 'DELETE', HTTP_X_CSRF_TOKEN: 'csrf-ok' },
      get: { entity: 'group', id: '4' },
      input: []
    });
    assert.equal(exitResult(foreign.out).status, 403);
    assert.equal(responseMessage(exitResult(foreign.out)), 'Access denied');

    const missing = await runEndpointCase({
      server: { REQUEST_METHOD: 'DELETE', HTTP_X_CSRF_TOKEN: 'csrf-ok' },
      get: { entity: 'group', id: '999' },
      input: []
    });
    assert.equal(exitResult(missing.out).status, 404);
    assert.equal(responseMessage(exitResult(missing.out)), 'المجموعة غير موجودة');
  });

  test('delete_group without a CSRF token is rejected', { skip }, async () => {
    const { out } = await runEndpointCase({
      server: { REQUEST_METHOD: 'DELETE' },
      get: { entity: 'group', id: '2' },
      input: []
    });
    assert.equal(exitResult(out).status, 403);
    assert.equal(responseMessage(exitResult(out)), 'Invalid CSRF token');
  });

  /* ================================================================ */
  /* GET list / tenant isolation / RBAC                               */
  /* ================================================================ */

  test('GET dashboard lists only the session tenant\'s groups with safe counts', { skip }, async () => {
    const { out } = await runEndpointCase({
      server: { REQUEST_METHOD: 'GET' },
      session: SESSION_TEACHER_1,
      input: []
    });
    const result = exitResult(out);
    const body = result.data;
    assert.equal(result.status, 200);
    assert.equal(body.success, true);

    const groups = body.groups;
    assert.deepEqual(groups.map(g => g.id), [1, 2]);
    const group1 = groups[0];
    assert.equal(group1.name, 'مجموعة الأحد والثلاثاء');
    assert.equal(group1.class_name, 'الصف الثالث الثانوي');
    assert.deepEqual(group1.study_days, ['الأحد', 'الثلاثاء']);
    assert.equal(group1.class_time, '05:00 مساءً'); // legacy row passes through
    assert.equal(group1.end_time, null); // legacy rows have no stored end time
    assert.equal(group1.shift, 'evening');
    assert.equal(group1.price, 350);
    assert.equal(group1.payment_scheme, 'monthly');
    assert.equal(group1.student_count, 1);
    assert.equal(groups[1].student_count, 0);

    assert.equal(body.overview.total_groups, 2);
    assert.equal(body.overview.total_classes, 1);
    assert.equal(body.overview.today_attendance, 1);
  });

  test('GET dashboard as teacher 2 shows only teacher 2\'s group', { skip }, async () => {
    const { out } = await runEndpointCase({
      server: { REQUEST_METHOD: 'GET' },
      session: SESSION_TEACHER_2,
      input: []
    });
    const result = exitResult(out);
    const body = result.data;
    assert.equal(result.status, 200);
    assert.deepEqual(body.groups.map(g => g.id), [4]);
    assert.equal(body.overview.total_groups, 1);
  });

  test('staff without the "groups" permission is denied create_group (403 RBAC)', { skip }, async () => {
    const { out } = await runEndpointCase({
      seed: seedTwoTenants(today) + `
\\Keep::$pdo->exec("UPDATE teacher_staff SET permissions = '[\\"attendance\\", \\"students\\"]' WHERE user_id = 4");
`,
      session: {
        user_id: 4, name: 'أ. خالد سامح', email: 'khaled@staff.edu', role: 'staff',
        phone: '01033333333', tenant_teacher_id: 1, last_activity: { __php: 'time()' }, csrf_token: 'csrf-ok', csrf_token_time: { __php: 'time()' }
      },
      input: { action: 'create_group', csrf_token: 'csrf-ok', payload: VALID_CREATE_PAYLOAD }
    });
    assert.equal(exitResult(out).status, 403);
    assert.equal(responseMessage(exitResult(out)), 'Access denied: Insufficient permissions');
  });

  test('staff WITH the "groups" permission can create a group', { skip }, async () => {
    const { out } = await runEndpointCase({
      seed: seedTwoTenants(today) + `
\\Keep::$pdo->exec("UPDATE teacher_staff SET permissions = '[\\"groups\\"]' WHERE user_id = 4");
`,
      session: {
        user_id: 4, name: 'أ. خالد سامح', email: 'khaled@staff.edu', role: 'staff',
        phone: '01033333333', tenant_teacher_id: 1, last_activity: { __php: 'time()' }, csrf_token: 'csrf-ok', csrf_token_time: { __php: 'time()' }
      },
      input: { action: 'create_group', csrf_token: 'csrf-ok', payload: VALID_CREATE_PAYLOAD }
    });
    assert.equal(exitResult(out).status, 200);
    assert.equal(exitResult(out).data.success, true);
  });

  test('super_admin cannot use the teacher dashboard endpoints', { skip }, async () => {
    const { out } = await runEndpointCase({
      server: { REQUEST_METHOD: 'GET' },
      session: {
        user_id: 1, name: 'مدير المنصة', email: 'admin@platform.edu', role: 'super_admin',
        phone: '01000000001', tenant_teacher_id: null, last_activity: { __php: 'time()' }, csrf_token: 'csrf-ok', csrf_token_time: { __php: 'time()' }
      },
      input: []
    });
    assert.equal(exitResult(out).status, 403);
    assert.match(responseMessage(exitResult(out)), /Super Admin cannot access individual teacher dashboard/);
  });
})();
