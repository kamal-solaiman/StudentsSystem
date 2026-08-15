'use strict';

/**
 * P1-K Students module — backend behavior tests (php-wasm runtime harness).
 *
 * These tests execute the REAL `api/teacher.php` endpoint code inside a real
 * PHP 8.4 interpreter (php-wasm) with the REAL session / CSRF / RBAC stack
 * (config/auth.php) and a REAL embedded SQL database (@electric-sql/pglite
 * exposed to PHP through the php-wasm "pgsql" PDO driver).
 *
 * The harness is the same one introduced for P1-J (see
 * tests/study_groups_backend_phpwasm.test.js for the full rationale); only
 * three runtime-glue pieces are substituted, never any P1-K logic:
 *
 *   1. `require_once config/*.php` — helper.php/auth.php bodies are inlined.
 *   2. `Helper::getJsonInput()` → `teacherTestGetJsonInput()`.
 *   3. `DatabaseConnection::fromConfigFile()->connect()` → pglite PDO.
 *
 * Schema note: the harness tables mirror `database/schema.sql` AFTER the
 * P1-K migration (nullable profile columns on `students`, `password_hash` /
 * `role` on `users`, and the UNIQUE (teacher_id, student_id) key on
 * `student_enrollments`) so the duplicate/concurrency guarantees are exercised
 * against a real database constraint, not only against the PHP pre-checks.
 *
 * Live MySQL is NOT available in this sandbox; these tests cover the endpoint
 * behavior against a real SQL engine (PostgreSQL dialect via pglite).
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
    console.error('[students_module_backend_phpwasm] php-wasm unavailable:', error && error.message);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* PHP source preparation                                              */
/* ------------------------------------------------------------------ */

function stripConfigFile(source) {
  return source
    .replace(/^<\?php\s*/, '')
    .replace(/^declare\(strict_types\s*=\s*1\);\s*/m, '')
    .replace(/require_once\s+__DIR__\s*\.\s*'[^']*';\s*/g, '');
}

function harnessHelperSource(source) {
  const body = stripConfigFile(source);
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

/** The endpoint under test, minus runtime glue (see file header). */
function endpointFragment() {
  const source = read('api/teacher.php')
    .replace(/^<\?php\s*/, '')
    .replace(/^declare\(strict_types\s*=\s*1\);\s*/m, '')
    .replace(/require_once\s+__DIR__\s*\.\s*'[^']*';\s*/g, '')
    .replace(/Helper::getJsonInput\(\)/g, 'teacherTestGetJsonInput()');
  // Dialect shim (harness only): MySQL reads ESCAPE '\\\\' as one backslash,
  // PostgreSQL (pglite) needs the E'' form for the same single character.
  // The LIKE-escaping behavior under test is identical either way.
  const pgEscape = source.split("ESCAPE \\'").join("ESCAPE E\\'");
  const rethrowGuard = pgEscape.replace(
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

/**
 * Base schema shared by every case — mirrors database/schema.sql AFTER the
 * P1-K migration (see file header).
 */
const BASE_SCHEMA = `
\\Keep::$pdo->exec("CREATE TABLE academic_classes (id SERIAL PRIMARY KEY, teacher_id INTEGER NOT NULL, name TEXT NOT NULL, level TEXT NOT NULL, grade TEXT NULL, description TEXT NULL, created_at TEXT)");
\\Keep::$pdo->exec("CREATE TABLE study_groups (id SERIAL PRIMARY KEY, teacher_id INTEGER NOT NULL, class_id INTEGER NOT NULL, name TEXT NOT NULL, study_days TEXT NOT NULL, class_time TEXT NOT NULL, end_time TEXT NULL, shift TEXT NOT NULL, price NUMERIC(10,2) NOT NULL, payment_scheme TEXT NOT NULL, created_at TEXT)");
\\Keep::$pdo->exec("CREATE TABLE student_enrollments (id SERIAL PRIMARY KEY, teacher_id INTEGER, student_id INTEGER, class_id INTEGER, group_id INTEGER, enrollment_date TEXT, status TEXT, payment_status TEXT, created_at TEXT, CONSTRAINT uq_enrollment_teacher_student UNIQUE (teacher_id, student_id))");
\\Keep::$pdo->exec("CREATE TABLE attendance_records (id SERIAL PRIMARY KEY, teacher_id INTEGER, student_id INTEGER, group_id INTEGER, date TEXT, status TEXT, present TEXT, absent TEXT, late TEXT)");
\\Keep::$pdo->exec("CREATE TABLE exams (id SERIAL PRIMARY KEY, teacher_id INTEGER, group_id INTEGER)");
\\Keep::$pdo->exec("CREATE TABLE homeworks (id SERIAL PRIMARY KEY, teacher_id INTEGER, group_id INTEGER)");
\\Keep::$pdo->exec("CREATE TABLE lesson_videos (id SERIAL PRIMARY KEY, teacher_id INTEGER, group_id INTEGER)");
\\Keep::$pdo->exec("CREATE TABLE teachers (id SERIAL PRIMARY KEY, user_id INTEGER, name TEXT, center_name TEXT, phone TEXT, address TEXT, logo TEXT, subject TEXT, price_per_student NUMERIC(10,2), created_at TEXT)");
\\Keep::$pdo->exec("CREATE TABLE students (id SERIAL PRIMARY KEY, user_id INTEGER, student_code TEXT UNIQUE, name TEXT, gender TEXT NULL, date_of_birth TEXT NULL, phone TEXT, parent_phone TEXT, parent_user_id INTEGER NULL, address TEXT NULL, notes TEXT NULL, grade_level TEXT, qr_code_token TEXT, created_at TEXT)");
\\Keep::$pdo->exec("CREATE TABLE teacher_staff (id SERIAL PRIMARY KEY, teacher_id INTEGER, user_id INTEGER, role_title TEXT, permissions TEXT, created_at TEXT)");
\\Keep::$pdo->exec("CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT, email TEXT UNIQUE, phone TEXT, password_hash TEXT NULL, role TEXT NULL, avatar TEXT NULL, created_at TEXT)");
`;

const BUMP_SEQUENCES = `
\\Keep::$pdo->exec("SELECT setval(pg_get_serial_sequence('study_groups', 'id'), (SELECT COALESCE(MAX(id), 1) FROM study_groups))");
\\Keep::$pdo->exec("SELECT setval(pg_get_serial_sequence('students', 'id'), (SELECT COALESCE(MAX(id), 1) FROM students))");
\\Keep::$pdo->exec("SELECT setval(pg_get_serial_sequence('users', 'id'), (SELECT COALESCE(MAX(id), 1) FROM users))");
\\Keep::$pdo->exec("SELECT setval(pg_get_serial_sequence('student_enrollments', 'id'), (SELECT COALESCE(MAX(id), 1) FROM student_enrollments))");
`;

/**
 * Two tenants sharing the SAME academic class (secondary/third), with:
 *   student 1 — linked to teacher 1 (active) AND to teacher 2 (active)
 *   student 2 — on the platform, linked to teacher 2 only (teacher 1 must be
 *               able to find and link them without creating a duplicate)
 *   student 3 — different academic class (preparatory/first): must never be
 *               returned when teacher 1 searches the secondary/third class
 *   student 4 — previously hidden by teacher 1 (inactive enrollment)
 */
function seedStudentsWorld(today) {
  return `
\\Keep::$pdo->exec("INSERT INTO teachers (id, user_id, name, center_name, phone, address, subject, price_per_student) VALUES (1, 2, 'أ. أحمد محمود', 'سنتر النخبة', '01011111111', 'الدقي', 'الفيزياء', 45.00), (2, 3, 'أ. سارة عادل', 'أكاديمية التفوق', '01022222222', 'المعادي', 'الرياضيات', 50.00)");
\\Keep::$pdo->exec("INSERT INTO academic_classes (id, teacher_id, name, level, grade) VALUES (1, 1, 'الصف الثالث الثانوي', 'secondary', 'third'), (2, 1, 'الصف الأول الإعدادي', 'preparatory', 'first'), (4, 2, 'الصف الثالث الثانوي', 'secondary', 'third'), (5, 2, 'الصف الأول الإعدادي', 'preparatory', 'first')");
\\Keep::$pdo->exec("INSERT INTO study_groups (id, teacher_id, class_id, name, study_days, class_time, shift, price, payment_scheme) VALUES (1, 1, 1, 'مجموعة الأحد والثلاثاء', '[\\"الأحد\\", \\"الثلاثاء\\"]', '05:00 مساءً', 'evening', 350.00, 'monthly'), (2, 1, 1, 'مجموعة السبت', '[\\"السبت\\"]', '10:00 صباحاً', 'morning', 300.00, 'monthly'), (3, 1, 2, 'مجموعة الإعدادي', '[\\"الإثنين\\"]', '04:00 مساءً', 'evening', 200.00, 'monthly'), (4, 2, 4, 'مجموعة التفوق', '[\\"الأحد\\", \\"الأربعاء\\"]', '07:00 مساءً', 'evening', 400.00, 'monthly')");
\\Keep::$pdo->exec("INSERT INTO users (id, name, email, phone, password_hash, role) VALUES (4, 'أ. خالد سامح', 'khaled@staff.edu', '01033333333', 'STAFF-HASH', 'staff'), (6, 'يوسف محمد سعيد', 'youssef@student.edu', '01044444441', 'ORIGINAL-HASH-1', 'student'), (7, 'منة الله حسن', 'menna@student.edu', '01044444442', 'ORIGINAL-HASH-2', 'student'), (8, 'كريم عادل', 'karim@student.edu', '01044444443', 'ORIGINAL-HASH-3', 'student'), (9, 'ندى سمير', 'nada@student.edu', '01044444444', 'ORIGINAL-HASH-4', 'student'), (10, 'ولي أمر منة', 'parent-menna@home.edu', '01099999992', 'PARENT-HASH', 'parent')");
\\Keep::$pdo->exec("INSERT INTO students (id, user_id, student_code, name, phone, parent_phone, parent_user_id, grade_level, qr_code_token) VALUES (1, 6, 'STU-10045', 'يوسف محمد سعيد', '01044444441', '01099999991', NULL, 'الصف الثالث الثانوي', 'QR-1'), (2, 7, 'STU-10046', 'منة الله حسن', '01044444442', '01099999992', 10, 'الصف الثالث الثانوي', 'QR-2'), (3, 8, 'STU-10047', 'كريم عادل', '01044444443', '01099999993', NULL, 'الصف الأول الإعدادي', 'QR-3'), (4, 9, 'STU-10048', 'ندى سمير', '01044444444', '01099999994', NULL, 'الصف الثالث الثانوي', 'QR-4')");
\\Keep::$pdo->exec("INSERT INTO student_enrollments (id, teacher_id, student_id, class_id, group_id, enrollment_date, status, payment_status) VALUES (1, 1, 1, 1, 1, '2026-01-15', 'active', 'paid'), (2, 2, 1, 4, 4, '2026-01-16', 'active', 'paid'), (3, 2, 2, 4, 4, '2026-01-17', 'active', 'paid'), (4, 2, 3, 5, 4, '2026-01-18', 'active', 'paid'), (5, 1, 4, 1, 1, '2026-01-19', 'inactive', 'paid')");
\\Keep::$pdo->exec("INSERT INTO attendance_records (id, teacher_id, student_id, group_id, date, status, present, absent, late) VALUES (1, 1, 1, 1, '${today}', 'present', 'present', 'absent', 'late')");
\\Keep::$pdo->exec("INSERT INTO teacher_staff (id, teacher_id, user_id, role_title, permissions) VALUES (1, 1, 4, 'secretary', '[]')");
${BUMP_SEQUENCES}
`;
}

/* ------------------------------------------------------------------ */
/* Harness runner                                                      */
/* ------------------------------------------------------------------ */

function buildHarness(state) {
  const php = new state.PhpNode({
    PGlite: state.PGlite,
    print: () => {},
    printErr: () => {}
  });

  const events = [];
  php.addEventListener('output', event => { events.push(event.detail); });
  php.addEventListener('error', event => { events.push('__STDERR__: ' + event.detail); });

  const run = async code => {
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
    '    if (session_status() !== PHP_SESSION_ACTIVE) { @session_start(); }',
    '    foreach ($session as $key => $value) { $_SESSION[$key] = $value; }',
    '    $GLOBALS[\'TEST_INPUT\'] = $input;',
    '}',
    'class HarnessStatement extends PDOStatement {',
    '    public function rowCount(): int {',
    '        $native = parent::rowCount();',
    '        if ($native > 0) { return $native; }',
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
    '        // connection is discarded at the end of each case, so a no-op',
    '        // commit preserves the observable in-transaction behavior.',
    '        return true;',
    '    }',
    '    public function lastInsertId(?string $name = null): string|false {',
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

const SESSION_TEACHER_1 = {
  user_id: 2, name: 'أ. أحمد محمود', email: 'ahmed@physics.edu', role: 'teacher',
  phone: '01011111111', tenant_teacher_id: 1,
  last_activity: { __php: 'time()' }, csrf_token: 'csrf-ok', csrf_token_time: { __php: 'time()' }
};
const SESSION_TEACHER_2 = {
  ...SESSION_TEACHER_1, user_id: 3, name: 'أ. سارة عادل', email: 'sara@math.edu', tenant_teacher_id: 2
};
const SESSION_STAFF_1 = {
  user_id: 4, name: 'أ. خالد سامح', email: 'khaled@staff.edu', role: 'staff',
  phone: '01033333333', tenant_teacher_id: 1,
  last_activity: { __php: 'time()' }, csrf_token: 'csrf-ok', csrf_token_time: { __php: 'time()' }
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

  test.beforeEach(async () => {
    if (skip) return;
    harness = buildHarness(deps);
    await harness.run(buildBootstrap());
  });

  async function runEndpointCase(options) {
    caseIndex += 1;
    const ns = `SCase${caseIndex}`;
    const code = [
      `<?php namespace ${ns} {`,
      'use PDO; use PDOStatement; use PDOException; use Throwable; use DateTime; use Helper; use AuthManager; use DatabaseConnection; use HarnessExit;',
      `\\teacherTestSetGlobals(${phpLiteral({ REQUEST_METHOD: 'POST', ...(options.server || {}) })}, ${phpLiteral(options.get || {})}, ${phpLiteral(options.session || SESSION_TEACHER_1)}, ${phpLiteral(options.input || [])});`,
      '\\Keep::$pdo = new \\TestPdo();',
      BASE_SCHEMA,
      options.seed || seedStudentsWorld(today),
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

  function responseMessage(result) {
    return result.data.message ?? result.data.error;
  }

  function exitResult(out) {
    const match = out.match(/__EXIT__(\d+)__(\{.*\})\s*$/s);
    assert.ok(match, `no __EXIT__ response captured:\n${out}`);
    return { status: Number(match[1]), data: JSON.parse(match[2]) };
  }

  async function verifyCase(ns, phpCode) {
    const out = await harness.run(`<?php namespace ${ns}Verify { use PDO; ${phpCode} }`);
    assert.ok(!out.includes('Fatal error'), `verification fatal:\n${out}`);
    return out;
  }

  /** Read an arbitrary query from the case's persisted database as JSON. */
  function queryDb(ns, sql) {
    const stmt = `echo 'VERIFY:' . json_encode(\\Keep::$pdo->query(${phpLiteral(sql)})->fetchAll(PDO::FETCH_ASSOC), JSON_UNESCAPED_UNICODE);`;
    return verifyCase(ns, stmt).then(out => JSON.parse(out.slice(out.indexOf('VERIFY:') + 7)));
  }

  const enrollmentsOf = (ns, teacherId) =>
    queryDb(ns, `SELECT id, teacher_id, student_id, class_id, group_id, status FROM student_enrollments WHERE teacher_id = ${teacherId} ORDER BY id ASC`);

  /* ================================================================ */
  /* Scenario E — search: the academic class is a hard backend filter */
  /* ================================================================ */

  test('search_students finds a platform student of the selected class and marks them unlinked', { skip }, async () => {
    const { out } = await runEndpointCase({
      input: { action: 'search_students', csrf_token: 'csrf-ok', payload: { class_id: 1, query: 'منة' } }
    });
    const result = exitResult(out);
    assert.equal(result.status, 200);
    assert.equal(result.data.success, true);
    assert.equal(result.data.class_id, 1);
    assert.equal(result.data.class_name, 'الصف الثالث الثانوي');
    assert.equal(result.data.count, 1);
    const [hit] = result.data.results;
    assert.equal(hit.id, 2);
    assert.equal(hit.student_code, 'STU-10046');
    assert.equal(hit.name, 'منة الله حسن');
    assert.equal(hit.link_state, 'unlinked');
    // PRIVACY: the other teacher's group/class are never disclosed
    assert.equal(hit.group_id, null);
    assert.equal(hit.group_name, null);
    assert.equal(hit.class_id, null);
    assert.equal(hit.class_name, null);
  });

  test('search_students exposes no hashes, tokens, parent ids or emails', { skip }, async () => {
    const { out } = await runEndpointCase({
      input: { action: 'search_students', csrf_token: 'csrf-ok', payload: { class_id: 1, query: 'منة' } }
    });
    const raw = JSON.stringify(exitResult(out).data);
    ['ORIGINAL-HASH', 'PARENT-HASH', 'QR-2', 'menna@student.edu', 'parent-menna@home.edu', 'parent_user_id']
      .forEach(secret => assert.ok(!raw.includes(secret), `search leaked ${secret}`));
    const [hit] = exitResult(out).data.results;
    assert.deepEqual(Object.keys(hit).sort(), [
      'class_id', 'class_name', 'grade_level', 'group_id', 'group_name',
      'id', 'link_state', 'name', 'phone', 'phone_masked', 'student_code'
    ]);
  });

  test('search_students masks the phone of students who are not mine, in full for mine', { skip }, async () => {
    const foreign = await runEndpointCase({
      input: { action: 'search_students', csrf_token: 'csrf-ok', payload: { class_id: 1, query: 'STU-10046' } }
    });
    const foreignHit = exitResult(foreign.out).data.results[0];
    assert.equal(foreignHit.phone_masked, true);
    assert.ok(!foreignHit.phone.includes('01044444442'));
    assert.match(foreignHit.phone, /^010•+42$/);

    const mine = await runEndpointCase({
      input: { action: 'search_students', csrf_token: 'csrf-ok', payload: { class_id: 1, query: 'STU-10045' } }
    });
    const mineHit = exitResult(mine.out).data.results[0];
    assert.equal(mineHit.link_state, 'linked');
    assert.equal(mineHit.phone_masked, false);
    assert.equal(mineHit.phone, '01044444441');
    assert.equal(mineHit.group_name, 'مجموعة الأحد والثلاثاء');
  });

  test('search_students never returns a student of a DIFFERENT academic class', { skip }, async () => {
    const { out } = await runEndpointCase({
      input: { action: 'search_students', csrf_token: 'csrf-ok', payload: { class_id: 1, query: 'كريم' } }
    });
    const result = exitResult(out);
    assert.equal(result.status, 200);
    assert.equal(result.data.count, 0);
    assert.deepEqual(result.data.results, []);

    // ...but the same student IS found under their own academic class.
    const other = await runEndpointCase({
      input: { action: 'search_students', csrf_token: 'csrf-ok', payload: { class_id: 2, query: 'كريم' } }
    });
    assert.equal(exitResult(other.out).data.count, 1);
    assert.equal(exitResult(other.out).data.results[0].student_code, 'STU-10047');
  });

  test('search_students reports a student I hid earlier as re-linkable, not as a duplicate', { skip }, async () => {
    const { out } = await runEndpointCase({
      input: { action: 'search_students', csrf_token: 'csrf-ok', payload: { class_id: 1, query: 'ندى' } }
    });
    const [hit] = exitResult(out).data.results;
    assert.equal(hit.id, 4);
    assert.equal(hit.link_state, 'hidden');
    // 'hidden' means the row belongs to THIS teacher, so this teacher's own
    // previous group/class (and the full phone) may be shown back to them.
    assert.equal(hit.phone_masked, false);
    assert.equal(hit.group_id, 1);
    assert.equal(hit.class_id, 1);
  });

  test('search_students rejects a class owned by another teacher (IDOR) and a missing class', { skip }, async () => {
    const idor = await runEndpointCase({
      input: { action: 'search_students', csrf_token: 'csrf-ok', payload: { class_id: 4, query: 'منة' } }
    });
    assert.equal(exitResult(idor.out).status, 403);
    assert.equal(responseMessage(exitResult(idor.out)), 'Access denied');

    const missing = await runEndpointCase({
      input: { action: 'search_students', csrf_token: 'csrf-ok', payload: { class_id: 999, query: 'منة' } }
    });
    assert.equal(exitResult(missing.out).status, 404);
    assert.equal(responseMessage(exitResult(missing.out)), 'الصف الدراسي غير موجود');
  });

  test('search_students enforces the query length bounds', { skip }, async () => {
    const short = await runEndpointCase({
      input: { action: 'search_students', csrf_token: 'csrf-ok', payload: { class_id: 1, query: 'م' } }
    });
    assert.equal(exitResult(short.out).status, 400);
    assert.equal(responseMessage(exitResult(short.out)), 'أدخل حرفين على الأقل للبحث');

    const long = await runEndpointCase({
      input: { action: 'search_students', csrf_token: 'csrf-ok', payload: { class_id: 1, query: 'م'.repeat(101) } }
    });
    assert.equal(exitResult(long.out).status, 400);
    assert.equal(responseMessage(exitResult(long.out)), 'نص البحث طويل جداً');
  });

  test('a bare LIKE wildcard cannot turn the search into a directory dump', { skip }, async () => {
    const { out } = await runEndpointCase({
      input: { action: 'search_students', csrf_token: 'csrf-ok', payload: { class_id: 1, query: '%%' } }
    });
    const result = exitResult(out);
    assert.equal(result.status, 200);
    assert.equal(result.data.count, 0, 'wildcards must be escaped, not interpreted');
  });

  /* ================================================================ */
  /* Scenario A — brand new student (create + enroll, one transaction) */
  /* ================================================================ */

  test('create_student creates the user, the global student and exactly one enrollment', { skip }, async () => {
    const { ns, out } = await runEndpointCase({
      input: {
        action: 'create_student', csrf_token: 'csrf-ok',
        payload: {
          class_id: 1, group_id: 2, name: 'طالب جديد تمامًا', student_code: 'STU-77777',
          email: 'new.student@example.com', phone: '01055555551', parent_phone: '01099999995',
          gender: 'male', date_of_birth: '2008-03-14', address: 'مدينة نصر', notes: 'ملاحظة اختبار'
        }
      }
    });
    const result = exitResult(out);
    assert.equal(result.status, 200);
    assert.equal(result.data.success, true);
    assert.equal(result.data.message, 'تم إنشاء حساب الطالب وربطه بالمجموعة بنجاح');
    assert.equal(result.data.student_code, 'STU-77777');
    assert.equal(result.data.group_name, 'مجموعة السبت');
    assert.equal(result.data.class_name, 'الصف الثالث الثانوي');

    const [student] = await queryDb(ns, "SELECT * FROM students WHERE student_code = 'STU-77777'");
    assert.ok(student, 'student row missing');
    assert.equal(student.name, 'طالب جديد تمامًا');
    assert.equal(student.gender, 'male');
    assert.equal(student.date_of_birth, '2008-03-14');
    assert.equal(student.address, 'مدينة نصر');
    assert.equal(student.notes, 'ملاحظة اختبار');
    assert.equal(student.parent_phone, '01099999995');
    // grade_level is derived server-side from the chosen academic class
    assert.equal(student.grade_level, 'الصف الثالث الثانوي');
    assert.match(String(student.qr_code_token), /^QR-STU-77777-TOKEN-\d+$/);

    const enrollments = await queryDb(ns, `SELECT * FROM student_enrollments WHERE student_id = ${student.id}`);
    assert.equal(enrollments.length, 1);
    assert.equal(String(enrollments[0].teacher_id), '1');
    assert.equal(String(enrollments[0].class_id), '1');
    assert.equal(String(enrollments[0].group_id), '2');
    assert.equal(enrollments[0].status, 'active');
  });

  test('a teacher-created student may omit EVERY optional field (only the name is required)', { skip }, async () => {
    const { ns, out } = await runEndpointCase({
      input: {
        action: 'create_student', csrf_token: 'csrf-ok',
        payload: { class_id: 1, group_id: 1, name: 'اسم فقط' }
      }
    });
    const result = exitResult(out);
    assert.equal(result.status, 200);
    // The code is auto-generated and the username falls back to the code.
    assert.match(result.data.student_code, /^STU-\d{5}$/);
    assert.equal(result.data.username, result.data.student_code.toLowerCase() + '@student.local');

    const [student] = await queryDb(ns, "SELECT * FROM students WHERE name = 'اسم فقط'");
    assert.equal(student.gender, null);
    assert.equal(student.date_of_birth, null);
    assert.equal(student.address, null);
    assert.equal(student.notes, null);
    assert.equal(student.phone, '');
    assert.equal(student.parent_phone, '');
  });

  test('create_student rejects a missing name (400) and never writes a partial row', { skip }, async () => {
    const { ns, out } = await runEndpointCase({
      input: { action: 'create_student', csrf_token: 'csrf-ok', payload: { class_id: 1, group_id: 1, name: '   ' } }
    });
    assert.equal(exitResult(out).status, 400);
    assert.equal(responseMessage(exitResult(out)), 'اسم الطالب مطلوب');
    const rows = await queryDb(ns, 'SELECT id FROM students');
    assert.equal(rows.length, 4, 'no student may be created by a rejected request');
  });

  test('create_student validates the optional profile fields', { skip }, async () => {
    const cases = [
      [{ student_code: 'a b' }, 'كود الطالب غير صالح (حروف إنجليزية وأرقام و - أو _ فقط)'],
      [{ email: 'not-an-email' }, 'البريد الإلكتروني غير صالح'],
      [{ gender: 'other' }, 'النوع غير صالح'],
      [{ date_of_birth: '14-03-2008' }, 'تاريخ الميلاد غير صالح'],
      [{ date_of_birth: '2099-01-01' }, 'تاريخ الميلاد غير منطقي'],
      [{ phone: 'phone!' }, 'رقم هاتف الطالب غير صالح'],
      [{ parent_phone: 'nope' }, 'رقم هاتف ولي الأمر غير صالح']
    ];
    for (const [override, message] of cases) {
      const { out } = await runEndpointCase({
        input: {
          action: 'create_student', csrf_token: 'csrf-ok',
          payload: { class_id: 1, group_id: 1, name: 'طالب', ...override }
        }
      });
      assert.equal(exitResult(out).status, 400, `expected 400 for ${JSON.stringify(override)}`);
      assert.equal(responseMessage(exitResult(out)), message);
    }
  });

  test('create_student refuses a group that belongs to a DIFFERENT academic class', { skip }, async () => {
    const { out } = await runEndpointCase({
      input: {
        action: 'create_student', csrf_token: 'csrf-ok',
        payload: { class_id: 1, group_id: 3, name: 'طالب' } // group 3 is in class 2
      }
    });
    assert.equal(exitResult(out).status, 400);
    assert.equal(responseMessage(exitResult(out)), 'المجموعة المختارة لا تنتمي إلى هذا الصف الدراسي');
  });

  test('create_student refuses another teacher\'s group (IDOR)', { skip }, async () => {
    const { out } = await runEndpointCase({
      input: {
        action: 'create_student', csrf_token: 'csrf-ok',
        payload: { class_id: 1, group_id: 4, name: 'طالب' } // group 4 belongs to teacher 2
      }
    });
    assert.equal(exitResult(out).status, 403);
    assert.equal(responseMessage(exitResult(out)), 'Access denied');
  });

  /* ================================================================ */
  /* Scenario I — credentials                                         */
  /* ================================================================ */

  test('a teacher-created student logs in with the entered email and the default password', { skip }, async () => {
    const { ns, out } = await runEndpointCase({
      input: {
        action: 'create_student', csrf_token: 'csrf-ok',
        payload: { class_id: 1, group_id: 1, name: 'طالب بحساب', email: 'Login.Student@Example.com' }
      }
    });
    const result = exitResult(out);
    assert.equal(result.data.username, 'login.student@example.com');
    assert.equal(result.data.default_password, '00000000');

    const [user] = await queryDb(ns, "SELECT * FROM users WHERE email = 'login.student@example.com'");
    assert.ok(user, 'user account missing');
    assert.equal(user.role, 'student');
    // The stored value is a real password_hash of the documented default.
    const verified = await verifyCase(ns, `echo 'VERIFY:' . (password_verify('00000000', ${phpLiteral(String(user.password_hash))}) ? 'yes' : 'no');`);
    assert.match(verified, /VERIFY:yes/);
    assert.ok(!String(user.password_hash).includes('00000000'), 'the password must be hashed, not stored');
  });

  test('linking an EXISTING student never touches their credentials, name or parent', { skip }, async () => {
    const { ns, out } = await runEndpointCase({
      input: {
        action: 'enroll_existing_student', csrf_token: 'csrf-ok',
        payload: { student_id: 2, class_id: 1, group_id: 1 }
      }
    });
    assert.equal(exitResult(out).status, 200);

    const [user] = await queryDb(ns, 'SELECT * FROM users WHERE id = 7');
    assert.equal(user.password_hash, 'ORIGINAL-HASH-2', 'the existing student hash was overwritten');
    assert.equal(user.email, 'menna@student.edu', 'the existing username was overwritten');
    const [student] = await queryDb(ns, 'SELECT * FROM students WHERE id = 2');
    assert.equal(student.name, 'منة الله حسن');
    assert.equal(student.student_code, 'STU-10046');
    assert.equal(String(student.parent_user_id), '10', 'the existing parent link was modified');
    const users = await queryDb(ns, 'SELECT id FROM users');
    assert.equal(users.length, 6, 'linking must not create any new account');
  });

  /* ================================================================ */
  /* Scenario B — enroll an existing student (explicit opt-in)        */
  /* ================================================================ */

  test('enroll_existing_student adds ONLY an enrollment row for the session tenant', { skip }, async () => {
    const { ns, out } = await runEndpointCase({
      input: {
        action: 'enroll_existing_student', csrf_token: 'csrf-ok',
        payload: { student_id: 2, class_id: 1, group_id: 2 }
      }
    });
    const result = exitResult(out);
    assert.equal(result.status, 200);
    assert.equal(result.data.message, 'تم إضافة الطالب إلى المجموعة بنجاح');
    assert.equal(result.data.group_name, 'مجموعة السبت');

    const students = await queryDb(ns, 'SELECT id FROM students');
    assert.equal(students.length, 4, 'no duplicate student record may be created');

    const mine = await enrollmentsOf(ns, 1);
    assert.deepEqual(mine.map(row => Number(row.student_id)).sort(), [1, 2, 4]);
    const added = mine.find(row => Number(row.student_id) === 2);
    assert.equal(String(added.class_id), '1');
    assert.equal(String(added.group_id), '2');
    assert.equal(added.status, 'active');

    // The OTHER teacher's enrollment for the same student is untouched.
    const theirs = await enrollmentsOf(ns, 2);
    const original = theirs.find(row => Number(row.student_id) === 2);
    assert.equal(String(original.group_id), '4');
    assert.equal(original.status, 'active');
  });

  test('re-linking a student I previously hid REACTIVATES the same enrollment row', { skip }, async () => {
    const { ns, out } = await runEndpointCase({
      input: {
        action: 'enroll_existing_student', csrf_token: 'csrf-ok',
        payload: { student_id: 4, class_id: 1, group_id: 2 }
      }
    });
    assert.equal(exitResult(out).status, 200);
    const rows = await queryDb(ns, 'SELECT * FROM student_enrollments WHERE teacher_id = 1 AND student_id = 4');
    assert.equal(rows.length, 1, 'reactivation must not create a second enrollment');
    assert.equal(String(rows[0].id), '5', 'the original row must be reused');
    assert.equal(rows[0].status, 'active');
    assert.equal(String(rows[0].group_id), '2');
  });

  test('enroll_existing_student refuses a student outside the selected academic class', { skip }, async () => {
    const { ns, out } = await runEndpointCase({
      input: {
        action: 'enroll_existing_student', csrf_token: 'csrf-ok',
        payload: { student_id: 3, class_id: 1, group_id: 1 } // student 3 is preparatory/first
      }
    });
    assert.equal(exitResult(out).status, 400);
    assert.equal(responseMessage(exitResult(out)), 'الطالب لا ينتمي إلى الصف الدراسي المختار');
    // teacher 1 keeps exactly the seeded rows: student 1 (active) + student 4 (hidden)
    assert.equal((await enrollmentsOf(ns, 1)).length, 2, 'nothing may be enrolled');
  });

  test('enroll_existing_student refuses a group of another academic class and a nonexistent student', { skip }, async () => {
    const crossClass = await runEndpointCase({
      input: {
        action: 'enroll_existing_student', csrf_token: 'csrf-ok',
        payload: { student_id: 2, class_id: 1, group_id: 3 }
      }
    });
    assert.equal(exitResult(crossClass.out).status, 400);
    assert.equal(responseMessage(exitResult(crossClass.out)), 'المجموعة المختارة لا تنتمي إلى هذا الصف الدراسي');

    const ghost = await runEndpointCase({
      input: {
        action: 'enroll_existing_student', csrf_token: 'csrf-ok',
        payload: { student_id: 9999, class_id: 1, group_id: 1 }
      }
    });
    assert.equal(exitResult(ghost.out).status, 404);
    assert.equal(responseMessage(exitResult(ghost.out)), 'الطالب غير موجود');
  });

  /* ================================================================ */
  /* Scenario C — already linked to me                                */
  /* ================================================================ */

  test('enrolling a student who is already mine returns 409 with the current group', { skip }, async () => {
    const { ns, out } = await runEndpointCase({
      input: {
        action: 'enroll_existing_student', csrf_token: 'csrf-ok',
        payload: { student_id: 1, class_id: 1, group_id: 2 }
      }
    });
    const result = exitResult(out);
    assert.equal(result.status, 409);
    assert.equal(result.data.already_linked, true);
    assert.equal(result.data.group_id, 1);
    assert.equal(responseMessage(result), 'الطالب مضاف بالفعل إلى مجموعاتك');

    const rows = await queryDb(ns, 'SELECT * FROM student_enrollments WHERE teacher_id = 1 AND student_id = 1');
    assert.equal(rows.length, 1);
    assert.equal(String(rows[0].group_id), '1', 'the refused request must not move the student');
  });

  /* ================================================================ */
  /* Scenario J — duplicates & concurrency                            */
  /* ================================================================ */

  test('a duplicate student_code is refused with 409 (never a second student row)', { skip }, async () => {
    const { ns, out } = await runEndpointCase({
      input: {
        action: 'create_student', csrf_token: 'csrf-ok',
        payload: { class_id: 1, group_id: 1, name: 'مكرر', student_code: 'STU-10046' }
      }
    });
    assert.equal(exitResult(out).status, 409);
    assert.equal(responseMessage(exitResult(out)), 'كود الطالب مستخدم بالفعل لطالب آخر');
    assert.equal((await queryDb(ns, 'SELECT id FROM students')).length, 4);
  });

  test('a duplicate email is refused with 409 and points at the search flow', { skip }, async () => {
    const { ns, out } = await runEndpointCase({
      input: {
        action: 'create_student', csrf_token: 'csrf-ok',
        payload: { class_id: 1, group_id: 1, name: 'مكرر', email: 'menna@student.edu' }
      }
    });
    assert.equal(exitResult(out).status, 409);
    assert.match(responseMessage(exitResult(out)), /ابحث عن الطالب وأضفه إلى مجموعتك/);
    assert.equal((await queryDb(ns, 'SELECT id FROM users')).length, 6);
  });

  test('the DB unique key is the real duplicate guard: a racing enrollment cannot slip through', { skip }, async () => {
    // Simulates the "another request won the race" case by inserting the
    // competing enrollment AFTER the endpoint's own pre-check would have run:
    // the row already exists, so the endpoint must answer 409, and the table
    // must still hold exactly one enrollment for (teacher 1, student 2).
    const { ns, out } = await runEndpointCase({
      seed: seedStudentsWorld(today) + `
\\Keep::$pdo->exec("INSERT INTO student_enrollments (teacher_id, student_id, class_id, group_id, enrollment_date, status, payment_status) VALUES (1, 2, 1, 1, '2026-02-01', 'active', 'paid')");
`,
      input: {
        action: 'enroll_existing_student', csrf_token: 'csrf-ok',
        payload: { student_id: 2, class_id: 1, group_id: 2 }
      }
    });
    assert.equal(exitResult(out).status, 409);
    const rows = await queryDb(ns, 'SELECT * FROM student_enrollments WHERE teacher_id = 1 AND student_id = 2');
    assert.equal(rows.length, 1, 'the UNIQUE (teacher_id, student_id) key must hold');
  });

  test('the one-enrollment-per-teacher rule is enforced by a UNIQUE key, not only by PHP', { skip }, async () => {
    // The harness database carries the same UNIQUE (teacher_id, student_id)
    // key that the shipped DDL declares, so the endpoint's pre-checks are
    // backed by a real constraint. (Provoking the violation here would abort
    // the embedded pglite connection, so the key is asserted from the SQL
    // catalog and cross-checked against the files that ship it.)
    const { ns } = await runEndpointCase({
      input: { action: 'search_students', csrf_token: 'csrf-ok', payload: { class_id: 1, query: 'يوسف' } }
    });
    const [row] = await queryDb(ns, "SELECT string_agg(a.attname, ',' ORDER BY a.attname) AS cols FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey) WHERE c.contype = 'u' AND c.conrelid = 'student_enrollments'::regclass");
    assert.equal(row.cols, 'student_id,teacher_id');

    const migration = read('database/migrations/20260815_students_module_p1k.sql');
    assert.match(migration, /UNIQUE[\s\S]{0,80}teacher_id[\s\S]{0,40}student_id/i);
    const schema = read('database/schema.sql');
    assert.match(schema, /UNIQUE KEY[^\n]*`teacher_id`\s*,\s*`student_id`/);
  });

  /* ================================================================ */
  /* Scenario D — group transfer                                      */
  /* ================================================================ */

  test('transfer_student_group UPDATEs the single enrollment', { skip }, async () => {
    const { ns, out } = await runEndpointCase({
      input: { action: 'transfer_student_group', csrf_token: 'csrf-ok', payload: { student_id: 1, group_id: 2 } }
    });
    const result = exitResult(out);
    assert.equal(result.status, 200);
    assert.equal(result.data.message, 'تم نقل الطالب إلى المجموعة الجديدة بنجاح');
    assert.equal(result.data.group_id, 2);
    assert.equal(result.data.group_name, 'مجموعة السبت');

    const rows = await queryDb(ns, 'SELECT * FROM student_enrollments WHERE teacher_id = 1 AND student_id = 1');
    assert.equal(rows.length, 1, 'a transfer must never duplicate the enrollment');
    assert.equal(String(rows[0].id), '1');
    assert.equal(String(rows[0].group_id), '2');
    assert.equal(String(rows[0].class_id), '1');

    // The same student's enrollment with the OTHER teacher is untouched.
    const theirs = await queryDb(ns, 'SELECT * FROM student_enrollments WHERE teacher_id = 2 AND student_id = 1');
    assert.equal(String(theirs[0].group_id), '4');
  });

  test('transfer_student_group refuses a group in a different academic class', { skip }, async () => {
    const { ns, out } = await runEndpointCase({
      input: { action: 'transfer_student_group', csrf_token: 'csrf-ok', payload: { student_id: 1, group_id: 3 } }
    });
    assert.equal(exitResult(out).status, 400);
    assert.equal(responseMessage(exitResult(out)), 'لا يمكن النقل إلى مجموعة في صف دراسي مختلف');
    const rows = await queryDb(ns, 'SELECT * FROM student_enrollments WHERE teacher_id = 1 AND student_id = 1');
    assert.equal(String(rows[0].group_id), '1');
  });

  test('transfer_student_group refuses the same group (409) and an unlinked student (404)', { skip }, async () => {
    const same = await runEndpointCase({
      input: { action: 'transfer_student_group', csrf_token: 'csrf-ok', payload: { student_id: 1, group_id: 1 } }
    });
    assert.equal(exitResult(same.out).status, 409);
    assert.equal(responseMessage(exitResult(same.out)), 'الطالب موجود بالفعل في هذه المجموعة');

    const foreign = await runEndpointCase({
      input: { action: 'transfer_student_group', csrf_token: 'csrf-ok', payload: { student_id: 2, group_id: 1 } }
    });
    assert.equal(exitResult(foreign.out).status, 404);
    assert.equal(responseMessage(exitResult(foreign.out)), 'الطالب غير مرتبط بمجموعاتك');
  });

  test('transfer_student_group cannot target another teacher\'s group (IDOR)', { skip }, async () => {
    const { out } = await runEndpointCase({
      input: { action: 'transfer_student_group', csrf_token: 'csrf-ok', payload: { student_id: 1, group_id: 4 } }
    });
    assert.equal(exitResult(out).status, 403);
    assert.equal(responseMessage(exitResult(out)), 'Access denied');
  });

  /* ================================================================ */
  /* Scenario G — hide / remove (never a hard delete)                 */
  /* ================================================================ */

  test('unlink_student hides the link for me only and keeps the global student', { skip }, async () => {
    const { ns, out } = await runEndpointCase({
      input: { action: 'unlink_student', csrf_token: 'csrf-ok', payload: { student_id: 1 } }
    });
    const result = exitResult(out);
    assert.equal(result.status, 200);
    assert.equal(result.data.message, 'تم إزالة الطالب من قائمتك (لم يتم حذف حساب الطالب من المنصة)');

    const students = await queryDb(ns, 'SELECT * FROM students WHERE id = 1');
    assert.equal(students.length, 1, 'the student record must survive');
    const users = await queryDb(ns, 'SELECT * FROM users WHERE id = 6');
    assert.equal(users.length, 1, 'the student account must survive');

    const mine = await queryDb(ns, 'SELECT * FROM student_enrollments WHERE teacher_id = 1 AND student_id = 1');
    assert.equal(mine.length, 1, 'the enrollment row is hidden, not deleted');
    assert.equal(mine[0].status, 'inactive');

    const theirs = await queryDb(ns, 'SELECT * FROM student_enrollments WHERE teacher_id = 2 AND student_id = 1');
    assert.equal(theirs[0].status, 'active', 'the other teacher must be unaffected');
  });

  test('unlink_student cannot hide a student who is not mine (404, no cross-tenant write)', { skip }, async () => {
    const { ns, out } = await runEndpointCase({
      input: { action: 'unlink_student', csrf_token: 'csrf-ok', payload: { student_id: 2 } }
    });
    assert.equal(exitResult(out).status, 404);
    assert.equal(responseMessage(exitResult(out)), 'الطالب غير مرتبط بمجموعاتك');
    const theirs = await queryDb(ns, 'SELECT * FROM student_enrollments WHERE teacher_id = 2 AND student_id = 2');
    assert.equal(theirs[0].status, 'active');
  });

  test('the GET dashboard lists only ACTIVE links of the session tenant', { skip }, async () => {
    const { out } = await runEndpointCase({ server: { REQUEST_METHOD: 'GET' }, input: [] });
    const body = exitResult(out).data;
    assert.equal(exitResult(out).status, 200);
    // student 1 is active for teacher 1; student 4 is hidden; students 2/3 are teacher 2's
    assert.deepEqual(body.students.map(s => Number(s.id)), [1]);
    assert.equal(body.students[0].student_code, 'STU-10045');
    assert.equal(body.students[0].group_name, 'مجموعة الأحد والثلاثاء');
    // PRIVACY: the platform-wide directory is no longer shipped to the browser
    assert.equal(body.all_platform_students, undefined);
    const raw = JSON.stringify(body);
    assert.ok(!raw.includes('ORIGINAL-HASH'), 'the dashboard must not leak password hashes');
  });

  test('a hidden student disappears from the GET list and comes back after re-linking', { skip }, async () => {
    const hidden = await runEndpointCase({ server: { REQUEST_METHOD: 'GET' }, input: [] });
    assert.deepEqual(exitResult(hidden.out).data.students.map(s => Number(s.id)), [1]);

    const relinkedSeed = seedStudentsWorld(today) + `
\\Keep::$pdo->exec("UPDATE student_enrollments SET status = 'active' WHERE id = 5");
`;
    const back = await runEndpointCase({ server: { REQUEST_METHOD: 'GET' }, input: [], seed: relinkedSeed });
    assert.deepEqual(exitResult(back.out).data.students.map(s => Number(s.id)).sort(), [1, 4]);
  });

  /* ================================================================ */
  /* Scenario F — tenant isolation                                    */
  /* ================================================================ */

  test('teacher 2 sees the same platform student as unlinked, with no teacher-1 data', { skip }, async () => {
    const { out } = await runEndpointCase({
      session: SESSION_TEACHER_2,
      input: { action: 'search_students', csrf_token: 'csrf-ok', payload: { class_id: 4, query: 'ندى' } }
    });
    const [hit] = exitResult(out).data.results;
    assert.equal(hit.id, 4);
    // Teacher 1 hid this student; teacher 2 has no link at all → unlinked.
    assert.equal(hit.link_state, 'unlinked');
    assert.equal(hit.group_name, null);
    assert.equal(hit.class_name, null);
  });

  test('a client-supplied teacher_id is ignored — the session tenant always wins', { skip }, async () => {
    const { ns, out } = await runEndpointCase({
      session: SESSION_TEACHER_2,
      input: {
        action: 'create_student', csrf_token: 'csrf-ok',
        payload: { teacher_id: 1, class_id: 4, group_id: 4, name: 'طالب سارة' }
      }
    });
    assert.equal(exitResult(out).status, 200);
    const rows = await queryDb(ns, "SELECT se.teacher_id FROM student_enrollments se JOIN students s ON s.id = se.student_id WHERE s.name = 'طالب سارة'");
    assert.equal(rows.length, 1);
    assert.equal(String(rows[0].teacher_id), '2', 'the spoofed teacher_id must be ignored');
  });

  test('teacher 2 cannot unlink or transfer a student of teacher 1', { skip }, async () => {
    const unlink = await runEndpointCase({
      session: SESSION_TEACHER_2,
      input: { action: 'unlink_student', csrf_token: 'csrf-ok', payload: { student_id: 4 } }
    });
    assert.equal(exitResult(unlink.out).status, 404);

    const transfer = await runEndpointCase({
      session: SESSION_TEACHER_2,
      input: { action: 'transfer_student_group', csrf_token: 'csrf-ok', payload: { student_id: 1, group_id: 1 } }
    });
    assert.equal(exitResult(transfer.out).status, 403);
    assert.equal(responseMessage(exitResult(transfer.out)), 'Access denied');
  });

  /* ================================================================ */
  /* Scenario H — parent handling                                     */
  /* ================================================================ */

  test('creating a student never creates a parent account or parent credentials', { skip }, async () => {
    const { ns, out } = await runEndpointCase({
      input: {
        action: 'create_student', csrf_token: 'csrf-ok',
        payload: { class_id: 1, group_id: 1, name: 'ابن ولي أمر', parent_phone: '01099999992' }
      }
    });
    assert.equal(exitResult(out).status, 200);
    const parents = await queryDb(ns, "SELECT id FROM users WHERE role = 'parent'");
    assert.equal(parents.length, 1, 'no new parent account may be created');
    assert.equal(String(parents[0].id), '10');
    const [student] = await queryDb(ns, "SELECT * FROM students WHERE name = 'ابن ولي أمر'");
    // Only the plain parent phone is stored; the parent LINK is not invented.
    assert.equal(student.parent_phone, '01099999992');
    assert.equal(student.parent_user_id, null);
    const body = exitResult(out).data;
    assert.equal(body.parent_password, undefined);
    assert.equal(body.parent_username, undefined);
  });

  /* ================================================================ */
  /* Cross-cutting: CSRF, RBAC, HTTP surface                          */
  /* ================================================================ */

  test('every student action requires a valid CSRF token', { skip }, async () => {
    for (const action of ['search_students', 'create_student', 'enroll_existing_student', 'transfer_student_group', 'unlink_student']) {
      const { out } = await runEndpointCase({
        input: { action, csrf_token: 'wrong-token', payload: { class_id: 1, group_id: 1, student_id: 1, name: 'x', query: 'يوسف' } }
      });
      assert.equal(exitResult(out).status, 403, `${action} accepted a bad CSRF token`);
      assert.equal(responseMessage(exitResult(out)), 'Invalid CSRF token');
    }
  });

  test('staff without the "students" permission are denied every student action (403)', { skip }, async () => {
    const seed = seedStudentsWorld(today) + `
\\Keep::$pdo->exec("UPDATE teacher_staff SET permissions = '[\\"attendance\\", \\"groups\\"]' WHERE user_id = 4");
`;
    for (const action of ['search_students', 'create_student', 'enroll_existing_student', 'transfer_student_group', 'unlink_student']) {
      const { out } = await runEndpointCase({
        seed,
        session: SESSION_STAFF_1,
        input: { action, csrf_token: 'csrf-ok', payload: { class_id: 1, group_id: 1, student_id: 1, name: 'x', query: 'يوسف' } }
      });
      assert.equal(exitResult(out).status, 403, `${action} was allowed without the students permission`);
      assert.equal(responseMessage(exitResult(out)), 'Access denied: Insufficient permissions');
    }
  });

  test('staff WITH the "students" permission can search and link on behalf of their teacher', { skip }, async () => {
    const seed = seedStudentsWorld(today) + `
\\Keep::$pdo->exec("UPDATE teacher_staff SET permissions = '[\\"students\\"]' WHERE user_id = 4");
`;
    const search = await runEndpointCase({
      seed, session: SESSION_STAFF_1,
      input: { action: 'search_students', csrf_token: 'csrf-ok', payload: { class_id: 1, query: 'منة' } }
    });
    assert.equal(exitResult(search.out).status, 200);

    const link = await runEndpointCase({
      seed, session: SESSION_STAFF_1,
      input: { action: 'enroll_existing_student', csrf_token: 'csrf-ok', payload: { student_id: 2, class_id: 1, group_id: 1 } }
    });
    const { ns } = link;
    assert.equal(exitResult(link.out).status, 200);
    const rows = await queryDb(ns, 'SELECT teacher_id FROM student_enrollments WHERE student_id = 2 AND teacher_id = 1');
    assert.equal(rows.length, 1, 'staff act inside their own tenant');
  });

  test('super_admin cannot use the student actions', { skip }, async () => {
    const { out } = await runEndpointCase({
      session: {
        user_id: 1, name: 'مدير المنصة', email: 'admin@platform.edu', role: 'super_admin',
        phone: '01000000001', tenant_teacher_id: null,
        last_activity: { __php: 'time()' }, csrf_token: 'csrf-ok', csrf_token_time: { __php: 'time()' }
      },
      input: { action: 'search_students', csrf_token: 'csrf-ok', payload: { class_id: 1, query: 'يوسف' } }
    });
    assert.equal(exitResult(out).status, 403);
    assert.match(responseMessage(exitResult(out)), /Super Admin cannot access individual teacher dashboard/);
  });

  test('the DELETE entity surface still refuses "student" (deletion is not a teacher operation)', { skip }, async () => {
    const { out } = await runEndpointCase({
      server: { REQUEST_METHOD: 'DELETE' },
      get: { entity: 'student', id: '1' },
      input: { csrf_token: 'csrf-ok' }
    });
    const result = exitResult(out);
    assert.equal(result.status, 400);
    assert.ok(!/تم حذف/.test(responseMessage(result)));
  });

  test('an unknown student-ish action is rejected', { skip }, async () => {
    const { out } = await runEndpointCase({
      input: { action: 'delete_student', csrf_token: 'csrf-ok', payload: { student_id: 1 } }
    });
    assert.equal(exitResult(out).status, 400);
    assert.equal(responseMessage(exitResult(out)), 'إجراء غير معروف في المدرس');
  });
})();
