'use strict';

/**
 * P1-M registration backend runtime tests.
 *
 * Executes the REAL api/register.php validation/transaction code, the REAL
 * Helper and AuthManager CSRF implementation under PHP 8.4 WASM, and a REAL
 * embedded PostgreSQL database through PDO/PGlite. Only the MySQL-specific
 * rate-limit UPSERT is replaced with its PostgreSQL equivalent; production
 * source presence/shape is asserted before replacement.
 *
 * This is REAL PHP + REAL SQL, but NOT MySQL, a browser, or production.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

async function dependencies() {
  const phpEntry = path.join(root, 'node_modules/php-wasm/PhpNode.mjs');
  const pgEntry = path.join(root, 'node_modules/@electric-sql/pglite/dist/index.js');
  if (!fs.existsSync(phpEntry) || !fs.existsSync(pgEntry)) return null;
  const [{ PhpNode }, { PGlite }] = await Promise.all([
    import(pathToFileURL(phpEntry).href), import(pathToFileURL(pgEntry).href)
  ]);
  return { PhpNode, PGlite };
}

function strip(source) {
  return source.replace(/^<\?php\s*/, '')
    .replace(/^declare\(strict_types\s*=\s*1\);\s*/m, '')
    .replace(/require_once\s+__DIR__\s*\.\s*'[^']*';\s*/g, '');
}

function helperSource() {
  const source = strip(read('config/helper.php'));
  return source
    .replace(/echo json_encode\(\$data, JSON_UNESCAPED_UNICODE \| JSON_PRETTY_PRINT\);\s*exit;/,
      'throw new HarnessExit($data, $statusCode);')
    .replace(/'message' => 'Origin not allowed'\s*\], JSON_UNESCAPED_UNICODE\);\s*exit;/,
      "'message' => 'Origin not allowed'], JSON_UNESCAPED_UNICODE); throw new HarnessExit(['success' => false, 'message' => 'Origin not allowed'], $statusCode);");
}

function endpointSource() {
  let source = strip(read('api/register.php')).replace(/Helper::getJsonInput\(\)/g, 'registrationTestInput()');
  const mysqlLimiter = /function registrationConsumeRateLimit\(PDO \$db\): void\s*\{[\s\S]*?\n\}\n\n\$method/;
  assert.match(source, mysqlLimiter, 'register limiter shape changed');
  source = source.replace(mysqlLimiter, `function registrationConsumeRateLimit(PDO $db): void
{
    $key = 'register:' . hash('sha256', (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
    $stmt = $db->prepare('SELECT attempts, first_attempt_at FROM login_attempts WHERE identifier = :identifier LIMIT 1');
    $stmt->execute(['identifier' => $key]);
    $row = $stmt->fetch();
    if ($row !== false && (int)$row['attempts'] >= 5) {
        Helper::sendJson(['success' => false, 'message' => 'تم تجاوز عدد محاولات التسجيل المسموح. يرجى المحاولة لاحقاً.'], 429);
    }
    $stmt = $db->prepare("INSERT INTO login_attempts (identifier, ip_hash, attempts, first_attempt_at, last_attempt_at)
      VALUES (:identifier, :ip_hash, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(identifier) DO UPDATE SET attempts = login_attempts.attempts + 1, last_attempt_at = CURRENT_TIMESTAMP");
    $stmt->execute(['identifier' => $key, 'ip_hash' => hash('sha256', $key)]);
}

$method`);
  source = source.replace(
    /\} catch \(Throwable \$exception\) \{\n\s*error_log\('register\.php failure:/,
    "} catch (Throwable $exception) {\n    if ($exception instanceof \\HarnessExit) { throw $exception; }\n    error_log('register.php failure:"
  );
  return `function registrationEndpoint(): void {\n${source}\n}`;
}

function parentEndpointSource() {
  // Harness-only dialect shim: MySQL accepts double-quoted string literals;
  // PostgreSQL/PGlite treats them as identifiers.
  let source = strip(read('api/parent.php')).replace('role = "parent"', String.raw`role = \'parent\'`);
  source = source.replace(
    /\} catch \(Throwable \$exception\) \{\n\s*\/\/ Keep actionable details/,
    '} catch (Throwable $exception) {\n    if ($exception instanceof \\HarnessExit) { throw $exception; }\n    throw $exception; // Harness: surface unexpected SQL/runtime defects.\n    // Keep actionable details'
  );
  return `function parentEndpoint(): void {\n${source}\n}`;
}

function loginEndpointSource() {
  let source = strip(read('api/login.php')).replace(/Helper::getJsonInput\(\)/g, 'registrationTestInput()');
  source = source.replace(
    /\} catch \(Throwable \$exception\) \{\n\s*\/\/ Production-safe diagnostic/,
    '} catch (Throwable $exception) {\n    if ($exception instanceof \\HarnessExit) { throw $exception; }\n    // Production-safe diagnostic'
  );
  return `function loginEndpoint(): void {\n${source}\n}`;
}

function php(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
  if (Array.isArray(value)) return `array(${value.map(php).join(',')})`;
  return `array(${Object.entries(value).map(([key, item]) => `${php(key)}=>${php(item)}`).join(',')})`;
}

const SCHEMA = String.raw`
\Keep::$pdo->exec("CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE, phone TEXT NOT NULL, registration_phone_key TEXT UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL, account_status TEXT NOT NULL DEFAULT 'active', avatar TEXT, date_of_birth TEXT, gender TEXT, address TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)");
\Keep::$pdo->exec("CREATE TABLE subjects (id SERIAL PRIMARY KEY, name TEXT NOT NULL, normalized_name TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'active')");
\Keep::$pdo->exec("CREATE TABLE teachers (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, name TEXT NOT NULL, center_name TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL, subject TEXT NOT NULL, subject_id INTEGER, bio TEXT CHECK (bio IS NULL OR bio <> 'ROLLBACK_TEST'), price_per_student NUMERIC DEFAULT 50, created_at TEXT DEFAULT CURRENT_TIMESTAMP)");
\Keep::$pdo->exec("CREATE TABLE teacher_staff (id SERIAL PRIMARY KEY, teacher_id INTEGER NOT NULL, user_id INTEGER NOT NULL, permissions TEXT)");
\Keep::$pdo->exec("CREATE TABLE students (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE, student_code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, gender TEXT, date_of_birth TEXT, phone TEXT NOT NULL, parent_phone TEXT NOT NULL, parent_user_id INTEGER, address TEXT, notes TEXT, grade_level TEXT NOT NULL, qr_code_token TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)");
\Keep::$pdo->exec("CREATE TABLE student_enrollments (id SERIAL PRIMARY KEY, teacher_id INTEGER, student_id INTEGER, class_id INTEGER, group_id INTEGER, status TEXT, payment_status TEXT)");
\Keep::$pdo->exec("CREATE TABLE study_groups (id SERIAL PRIMARY KEY, name TEXT, price NUMERIC, payment_scheme TEXT)");
\Keep::$pdo->exec("CREATE TABLE attendance_records (id SERIAL PRIMARY KEY, student_id INTEGER, date TEXT, status TEXT)");
\Keep::$pdo->exec("CREATE TABLE homeworks (id SERIAL PRIMARY KEY, teacher_id INTEGER, group_id INTEGER, title TEXT, due_date TEXT)");
\Keep::$pdo->exec("CREATE TABLE student_homework_submissions (id SERIAL PRIMARY KEY, homework_id INTEGER, student_id INTEGER, status TEXT, grade NUMERIC, feedback TEXT)");
\Keep::$pdo->exec("CREATE TABLE exams (id SERIAL PRIMARY KEY, teacher_id INTEGER, title TEXT, date TEXT)");
\Keep::$pdo->exec("CREATE TABLE student_exam_results (id SERIAL PRIMARY KEY, exam_id INTEGER, student_id INTEGER, score NUMERIC, max_score NUMERIC, feedback TEXT)");
\Keep::$pdo->exec("CREATE TABLE login_attempts (id SERIAL PRIMARY KEY, identifier TEXT NOT NULL UNIQUE, ip_hash TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 1, first_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
\Keep::$pdo->exec("INSERT INTO subjects (id,name,normalized_name,status) VALUES (1,'رياضيات','رياضيات','active'),(2,'الفيزياء','الفيزياء','active'),(3,'مادة متوقفة','ماده متوقفه','inactive')");
`;

function bootstrap() {
  return `<?php
function registrationTestInput(): array { return $GLOBALS['REG_INPUT'] ?? []; }
class TestPdo extends PDO {
  public function __construct() { parent::__construct('pgsql:'); $this->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION); $this->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC); }
  public function lastInsertId(?string $name = null): string|false { $row=$this->query('SELECT LASTVAL()')->fetch(PDO::FETCH_NUM); return $row === false ? false : (string)$row[0]; }
  public function commit(): bool { return true; }
}
final class Keep { public static ?PDO $pdo = null; }
final class DatabaseConnection { public static function fromConfigFile(): self { return new self(); } public function connect(): PDO { return Keep::$pdo; } }
final class HarnessExit extends Exception { public function __construct(public array $data, public int $status) { parent::__construct('response'); } }
${helperSource()}
${strip(read('config/auth.php'))}`;
}

(async () => {
  const deps = await dependencies();
  const skip = deps ? false : 'php-wasm / @electric-sql/pglite not installed';
  let runtime;
  let sequence = 0;

  test.beforeEach(async () => {
    if (skip) return;
    const output = [];
    const machine = new deps.PhpNode({ PGlite: deps.PGlite, print: () => {}, printErr: () => {} });
    machine.addEventListener('output', event => output.push(event.detail));
    machine.addEventListener('error', event => output.push('__ERR__' + event.detail));
    runtime = {
      machine, output,
      async run(code) {
        output.length = 0;
        const oldLog = console.log, oldError = console.error;
        console.log = console.error = () => {};
        try { await machine.run(code); return output.join(''); }
        finally { console.log = oldLog; console.error = oldError; }
      }
    };
    await runtime.run(bootstrap());
  });

  async function request(input, { method = 'POST', csrf = 'csrf-ok', seed = '' } = {}) {
    const ns = `RegCase${++sequence}`;
    const code = `<?php namespace ${ns} {
use PDO; use PDOException; use Throwable; use DateTime; use Helper; use AuthManager; use DatabaseConnection; use HarnessExit;
$_SERVER=['REQUEST_METHOD'=>${php(method)},'REMOTE_ADDR'=>'192.0.2.10']; $_GET=[];
if (session_status() !== PHP_SESSION_ACTIVE) { @session_start(); }
$_SESSION=[]; ${csrf === null ? '' : `$_SESSION['csrf_token']=${php(csrf)}; $_SESSION['csrf_token_time']=time();`}
$GLOBALS['REG_INPUT']=${php(input)};
\\Keep::$pdo=new \\TestPdo(); ${SCHEMA} ${seed}
${endpointSource()}
try { registrationEndpoint(); echo '__NO_RESPONSE__'; }
catch (HarnessExit $response) { echo '__RESPONSE__'.$response->status.'__'.json_encode($response->data, JSON_UNESCAPED_UNICODE); }
}`;
    const out = await runtime.run(code);
    assert.doesNotMatch(out, /Fatal error|Parse error|__NO_RESPONSE__/);
    const match = out.match(/__RESPONSE__(\d+)__(\{.*\})$/s);
    assert.ok(match, out);
    return { ns, status: Number(match[1]), body: JSON.parse(match[2]) };
  }

  async function login(identifier, password, status = 'active', role = 'teacher') {
    const ns = `LoginCase${++sequence}`;
    const teacherRow = role === 'teacher'
      ? `\\Keep::$pdo->exec("INSERT INTO teachers (user_id,name,center_name,phone,address,subject) VALUES (1,'مدرس','مساحة مدرس','01012345678','','رياضيات')");`
      : '';
    const code = `<?php namespace ${ns} {
use PDO; use PDOException; use Throwable; use DateTime; use Helper; use AuthManager; use DatabaseConnection; use HarnessExit;
$_SERVER=['REQUEST_METHOD'=>'POST','REMOTE_ADDR'=>'192.0.2.20']; $_GET=[];
if (session_status() !== PHP_SESSION_ACTIVE) { @session_start(); } $_SESSION=[];
$GLOBALS['REG_INPUT']=['email'=>${php(identifier)},'password'=>${php(password)}];
\\Keep::$pdo=new \\TestPdo(); ${SCHEMA}
$hash=password_hash('Secure123', PASSWORD_DEFAULT);
$stmt=\\Keep::$pdo->prepare("INSERT INTO users (id,name,username,email,phone,password_hash,role,account_status) VALUES (1,'مستخدم','login_user','login@example.test','01012345678',:hash,${php(role)},${php(status)})"); $stmt->execute(['hash'=>$hash]);
${teacherRow}
${loginEndpointSource()}
try { loginEndpoint(); echo '__NO_RESPONSE__'; }
catch (HarnessExit $response) { echo '__RESPONSE__'.$response->status.'__'.json_encode($response->data, JSON_UNESCAPED_UNICODE); }
}`;
    const out = await runtime.run(code);
    assert.doesNotMatch(out, /Fatal error|Parse error|__NO_RESPONSE__/);
    const match = out.match(/__RESPONSE__(\d+)__(\{.*\})$/s);
    assert.ok(match, out);
    return { status: Number(match[1]), body: JSON.parse(match[2]) };
  }

  async function parentDashboard({ explicitParentId = null, requestedStudentId = 0 } = {}) {
    const ns = `ParentCase${++sequence}`;
    const code = `<?php namespace ${ns} {
use PDO; use PDOException; use Throwable; use DateTime; use Helper; use AuthManager; use DatabaseConnection; use HarnessExit;
$_SERVER=['REQUEST_METHOD'=>'GET','REMOTE_ADDR'=>'192.0.2.30']; $_GET=${php(requestedStudentId ? { student_id: requestedStudentId } : {})};
if (session_status() !== PHP_SESSION_ACTIVE) { @session_start(); }
$_SESSION=['user_id'=>1,'name'=>'ولي أمر','email'=>'parent@example.test','role'=>'parent','phone'=>'01099999999','tenant_teacher_id'=>null,'last_activity'=>time(),'csrf_token'=>'csrf-ok','csrf_token_time'=>time()];
\\Keep::$pdo=new \\TestPdo(); ${SCHEMA}
$hash=password_hash('Secure123', PASSWORD_DEFAULT);
$stmt=\\Keep::$pdo->prepare("INSERT INTO users (id,name,username,email,phone,password_hash,role,account_status) VALUES (1,'ولي أمر','parent','parent@example.test','01099999999',:hash1,'parent','active'),(2,'طالب','student','student@example.test','01022222222',:hash2,'student','active')"); $stmt->execute(['hash1'=>$hash,'hash2'=>$hash]);
$stmt=\\Keep::$pdo->prepare("INSERT INTO students (id,user_id,student_code,name,phone,parent_phone,parent_user_id,grade_level,qr_code_token) VALUES (1,2,'STU-1','طالب','01022222222','01099999999',:parent_id,'','token')"); $stmt->execute(['parent_id'=>${explicitParentId === null ? 'null' : Number(explicitParentId)}]);
${parentEndpointSource()}
try { parentEndpoint(); echo '__NO_RESPONSE__'; }
catch (HarnessExit $response) { echo '__RESPONSE__'.$response->status.'__'.json_encode($response->data, JSON_UNESCAPED_UNICODE); }
}`;
    const out = await runtime.run(code);
    assert.doesNotMatch(out, /Fatal error|Parse error|__NO_RESPONSE__/);
    const match = out.match(/__RESPONSE__(\d+)__(\{.*\})$/s);
    assert.ok(match, out);
    return { status: Number(match[1]), body: JSON.parse(match[2]) };
  }

  async function teacherOrStaffParentAccess({ role = 'teacher', explicitParentId = 1, enrolled = true } = {}) {
    const ns = `ParentStaffCase${++sequence}`;
    const actorId = role === 'staff' ? 4 : 3;
    const code = `<?php namespace ${ns} {
use PDO; use PDOException; use Throwable; use DateTime; use Helper; use AuthManager; use DatabaseConnection; use HarnessExit;
$_SERVER=['REQUEST_METHOD'=>'GET','REMOTE_ADDR'=>'192.0.2.31']; $_GET=['parent_id'=>1];
if (session_status() !== PHP_SESSION_ACTIVE) { @session_start(); }
$_SESSION=['user_id'=>${actorId},'name'=>'مستخدم','email'=>'actor@example.test','role'=>${php(role)},'phone'=>'01033333333','tenant_teacher_id'=>1,'last_activity'=>time(),'csrf_token'=>'csrf-ok','csrf_token_time'=>time()];
\\Keep::$pdo=new \\TestPdo(); ${SCHEMA}
$hash=password_hash('Secure123', PASSWORD_DEFAULT);
$stmt=\\Keep::$pdo->prepare("INSERT INTO users (id,name,username,email,phone,password_hash,role,account_status) VALUES (1,'ولي أمر','parent','parent@example.test','01099999999',:h1,'parent','active'),(2,'طالب','student','student@example.test','01022222222',:h2,'student','active'),(3,'مدرس','teacher','teacher@example.test','01033333333',:h3,'teacher','active'),(4,'موظف','staff','staff@example.test','01044444444',:h4,'staff','active')"); $stmt->execute(['h1'=>$hash,'h2'=>$hash,'h3'=>$hash,'h4'=>$hash]);
\\Keep::$pdo->exec("INSERT INTO teachers (id,user_id,name,center_name,phone,address,subject,subject_id) VALUES (1,3,'مدرس','سنتر','01033333333','','رياضيات',1)");
\\Keep::$pdo->exec("INSERT INTO teacher_staff (id,teacher_id,user_id,permissions) VALUES (1,1,4,'[\\"parent\\"]')");
$stmt=\\Keep::$pdo->prepare("INSERT INTO students (id,user_id,student_code,name,phone,parent_phone,parent_user_id,grade_level,qr_code_token) VALUES (1,2,'STU-1','طالب','01022222222','01099999999',:parent_id,'','token')"); $stmt->execute(['parent_id'=>${Number(explicitParentId)}]);
${enrolled ? `\\Keep::$pdo->exec("INSERT INTO student_enrollments (id,teacher_id,student_id,class_id,group_id,status,payment_status) VALUES (1,1,1,1,1,'active','paid')"); \\Keep::$pdo->exec("INSERT INTO study_groups (id,name,price,payment_scheme) VALUES (1,'مجموعة',100,'monthly')");` : ''}
${parentEndpointSource()}
try { parentEndpoint(); echo '__NO_RESPONSE__'; }
catch (HarnessExit $response) { echo '__RESPONSE__'.$response->status.'__'.json_encode($response->data, JSON_UNESCAPED_UNICODE); }
}`;
    const out = await runtime.run(code);
    assert.doesNotMatch(out, /Fatal error|Parse error|__NO_RESPONSE__|HY093|Invalid parameter number/);
    const match = out.match(/__RESPONSE__(\d+)__(\{.*\})$/s);
    assert.ok(match, out);
    return { status: Number(match[1]), body: JSON.parse(match[2]) };
  }

  async function query(ns, sql) {
    const out = await runtime.run(`<?php namespace ${ns}Verify { use PDO; echo '__Q__'.json_encode(\\Keep::$pdo->query(${php(sql)})->fetchAll(PDO::FETCH_ASSOC), JSON_UNESCAPED_UNICODE); }`);
    return JSON.parse(out.slice(out.indexOf('__Q__') + 5));
  }

  const base = type => ({ account_type: type, name: `مستخدم ${type}`, username: `user_${type}`, email: `${type}@example.test`, phone: `01000000${type === 'student' ? '101' : type === 'teacher' ? '102' : '103'}`, password: 'Secure123', password_confirmation: 'Secure123', csrf_token: 'csrf-ok' });

  test('student registration creates one global account/entity, no enrollment, and accepts missing optional fields', { skip }, async () => {
    const result = await request(base('student'));
    assert.equal(result.status, 201);
    assert.equal(result.body.message, 'تم إنشاء حساب الطالب بنجاح.');
    const users = await query(result.ns, "SELECT role,account_status,password_hash FROM users");
    const students = await query(result.ns, 'SELECT student_code,parent_user_id,parent_phone FROM students');
    assert.equal(users[0].role, 'student'); assert.equal(users[0].account_status, 'active');
    assert.notEqual(users[0].password_hash, 'Secure123');
    assert.match(students[0].student_code, /^STU-/); assert.equal(students[0].parent_user_id, null); assert.equal(students[0].parent_phone, '');
    assert.equal((await query(result.ns, 'SELECT * FROM student_enrollments')).length, 0);
  });

  test('parent registration creates only the existing unified parent account', { skip }, async () => {
    const result = await request({ ...base('parent'), date_of_birth: '1980-05-05', gender: 'female', address: 'كفر الشيخ' });
    assert.equal(result.status, 201); assert.equal(result.body.message, 'تم إنشاء حساب ولي الأمر بنجاح.');
    const users = await query(result.ns, 'SELECT role,date_of_birth,gender,address FROM users');
    assert.deepEqual(users, [{ role: 'parent', date_of_birth: '1980-05-05', gender: 'female', address: 'كفر الشيخ' }]);
    assert.equal((await query(result.ns, 'SELECT * FROM students')).length, 0);
  });

  test('parent authorization requires explicit parent_user_id and never trusts matching phone', { skip }, async () => {
    const phoneOnly = await parentDashboard({ explicitParentId: null });
    assert.equal(phoneOnly.status, 200);
    assert.deepEqual(phoneOnly.body.children, []);

    const explicit = await parentDashboard({ explicitParentId: 1 });
    assert.equal(explicit.status, 200);
    assert.equal(explicit.body.children.length, 1);
    assert.equal(explicit.body.children[0].student_code, 'STU-1');

    const otherParent = await parentDashboard({ explicitParentId: 99, requestedStudentId: 1 });
    assert.equal(otherParent.status, 200);
    assert.deepEqual(otherParent.body.children, []);
  });

  test('teacher/staff parent access executes exact PDO parameters and preserves authorization', { skip }, async () => {
    for (const role of ['teacher', 'staff']) {
      const authorized = await teacherOrStaffParentAccess({ role, explicitParentId: 1, enrolled: true });
      assert.equal(authorized.status, 200);
      assert.equal(authorized.body.children.length, 1);
      assert.equal(authorized.body.children[0].student_code, 'STU-1');
    }

    const unauthorized = await teacherOrStaffParentAccess({ role: 'teacher', explicitParentId: 1, enrolled: false });
    assert.equal(unauthorized.status, 403);

    const phoneOnly = await teacherOrStaffParentAccess({ role: 'teacher', explicitParentId: 99, enrolled: true });
    assert.equal(phoneOnly.status, 403);
  });

  test('teacher registration uses active DB subject and starts pending without a session', { skip }, async () => {
    const result = await request({ ...base('teacher'), subject_id: 2, bio: 'مدرس فيزياء' });
    assert.equal(result.status, 201); assert.match(result.body.message, /موافقة الإدارة/);
    const users = await query(result.ns, 'SELECT role,account_status FROM users');
    const teachers = await query(result.ns, 'SELECT subject,subject_id,bio FROM teachers');
    assert.deepEqual(users, [{ role: 'teacher', account_status: 'pending' }]);
    assert.deepEqual(teachers, [{ subject: 'الفيزياء', subject_id: 2, bio: 'مدرس فيزياء' }]);
  });

  test('role escalation and forged ownership/status fields cannot override server decisions', { skip }, async () => {
    const invalid = await request({ ...base('teacher'), account_type: 'super_admin', role: 'super_admin', subject_id: 1 });
    assert.equal(invalid.status, 422);
    const teacher = await request({ ...base('teacher'), subject_id: 1, role: 'super_admin', account_status: 'active', teacher_id: 99, student_id: 88, parent_id: 77, tenant_teacher_id: 66 });
    assert.equal(teacher.status, 201);
    assert.deepEqual(await query(teacher.ns, 'SELECT role,account_status FROM users'), [{ role: 'teacher', account_status: 'pending' }]);
    assert.equal((await query(teacher.ns, 'SELECT * FROM student_enrollments')).length, 0);
  });

  test('duplicate email, username, and phone each return a safe conflict', { skip }, async () => {
    const seed = `\\Keep::$pdo->exec("INSERT INTO users (name,username,email,phone,password_hash,role,account_status) VALUES ('قديم','taken','taken@example.test','01099999999','hash','parent','active')");`;
    const messages = [];
    for (const [field, value] of [['email','taken@example.test'],['username','taken'],['phone','01099999999']]) {
      const payload = { ...base('parent'), [field]: value };
      const result = await request(payload, { seed });
      assert.equal(result.status, 409);
      messages.push(result.body.message);
    }
    assert.equal(new Set(messages).size, 1);
    assert.match(messages[0], /بيانات التسجيل مستخدمة بالفعل أو تتعارض مع حساب موجود/);
  });

  test('invalid/inactive subject, weak password, mismatch, and invalid account type are rejected', { skip }, async () => {
    const cases = [
      [{ ...base('teacher'), subject_id: 999 }, /غير متاحة/],
      [{ ...base('teacher'), subject_id: 3 }, /غير متاحة/],
      [{ ...base('parent'), password: 'short1', password_confirmation: 'short1' }, /8 أحرف/],
      [{ ...base('parent'), password_confirmation: 'Different123' }, /غير متطابقتين/],
      [{ ...base('parent'), account_type: 'staff' }, /نوع الحساب/]
    ];
    for (const [payload, message] of cases) { const result = await request(payload); assert.equal(result.status, 422); assert.match(result.body.message, message); }
  });

  test('existing student code produces a generic no-disclosure duplicate response', { skip }, async () => {
    const seed = `\\Keep::$pdo->exec("INSERT INTO users (name,username,email,phone,password_hash,role,account_status) VALUES ('طالب قديم','old','old@example.test','01077777777','hash','student','active')"); \\Keep::$pdo->exec("INSERT INTO students (user_id,student_code,name,date_of_birth,phone,parent_phone,grade_level,qr_code_token) VALUES (1,'STU-EXISTING','طالب قديم','2008-03-14','01077777777','','','secret')");`;
    const result = await request({ ...base('student'), student_code: 'STU-EXISTING' }, { seed });
    const unknown = await request({ ...base('student'), student_code: 'STU-NOT-THERE' });
    assert.equal(result.status, 409); assert.equal(unknown.status, 409);
    assert.equal(result.body.message, unknown.body.message);
    assert.match(result.body.message, /بيانات التسجيل مستخدمة بالفعل أو تتعارض مع حساب موجود/);
    assert.equal(result.body.student_id, undefined); assert.equal(result.body.email, undefined);

    // Ambiguous same-name/same-DOB evidence must not merge or disclose a
    // different student; unique account identity creates a distinct profile.
    const ambiguous = await request({ ...base('student'), name: 'طالب قديم', date_of_birth: '2008-03-14' }, { seed });
    assert.equal(ambiguous.status, 201);
  });

  test('CSRF and database-backed rate limiting reject unsafe requests', { skip }, async () => {
    const csrf = await request({ ...base('parent'), csrf_token: 'wrong' });
    assert.equal(csrf.status, 403);
    const key = 'register:' + require('node:crypto').createHash('sha256').update('192.0.2.10').digest('hex');
    const seed = `\\Keep::$pdo->exec("INSERT INTO login_attempts (identifier,ip_hash,attempts) VALUES (${php(key)},'hash',5)");`;
    const limited = await request(base('parent'), { seed });
    assert.equal(limited.status, 429);
  });

  test('login accepts active student/parent/approved teacher and blocks pending/rejected teacher and bad credentials', { skip }, async () => {
    for (const role of ['student', 'parent', 'teacher']) {
      const active = await login(role === 'student' ? 'login_user' : 'login@example.test', 'Secure123', 'active', role);
      assert.equal(active.status, 200); assert.equal(active.body.user.role, role);
      if (role === 'teacher') assert.equal(active.body.user.teacher_id, 1);
    }
    const pending = await login('login_user', 'Secure123', 'pending', 'teacher');
    assert.equal(pending.status, 403); assert.match(pending.body.message, /انتظار موافقة الإدارة/);
    const rejected = await login('login_user', 'Secure123', 'rejected', 'teacher');
    assert.equal(rejected.status, 403); assert.match(rejected.body.message, /التواصل مع إدارة المنصة/);
    const invalid = await login('login_user', 'wrong-password', 'active', 'parent');
    const missingEmail = await login('missing@example.test', 'wrong-password', 'active', 'parent');
    const missingUsername = await login('missing_user', 'wrong-password', 'active', 'parent');
    assert.equal(invalid.status, 401); assert.equal(missingEmail.status, 401); assert.equal(missingUsername.status, 401);
    assert.equal(invalid.body.message, missingEmail.body.message);
    assert.equal(invalid.body.message, missingUsername.body.message);
    assert.match(invalid.body.message, /غير صحيحة/);
  });

  test('a related-entity SQL failure rolls the user insert back', { skip }, async () => {
    const result = await request({ ...base('teacher'), subject_id: 1, bio: 'ROLLBACK_TEST' });
    assert.equal(result.status, 500);
    assert.equal((await query(result.ns, 'SELECT * FROM users')).length, 0);
    assert.equal((await query(result.ns, 'SELECT * FROM teachers')).length, 0);
  });
})();
