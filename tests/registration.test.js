'use strict';

/** P1-M focused STATIC + SIMULATED frontend registration contracts.
 * Real PHP/MySQL/browser availability is reported separately; these tests do
 * not claim production execution.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const register = read('api/register.php');
const login = read('api/login.php');
const schema = read('database/schema.sql');
const migration = read('database/migrations/20260816_public_registration.sql');
const app = read('assets/js/app.js');
const ui = read('assets/js/registration.js');
const admin = read('api/super_admin.php');
const teacher = read('api/teacher.php');

function loadApi(fetchImpl, pathname = '/110/register') {
  const values = new Map();
  const sandbox = {
    window: { location: { pathname, origin: 'https://example.test' } },
    sessionStorage: {
      getItem: key => values.get(key) || null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: key => values.delete(key)
    },
    fetch: fetchImpl,
    console: { error() {} }, Error, JSON, String, Number, Array, Object
  };
  vm.runInNewContext(read('assets/js/api.js') + '\nthis.ApiClient = ApiClient;', sandbox);
  return sandbox.ApiClient;
}

function response(status, value) {
  return { ok: status >= 200 && status < 300, status, async text() { return JSON.stringify(value); } };
}

test('A/B/C registration API creates student, parent and teacher roles', () => {
  assert.match(register, /\['student', 'teacher', 'parent'\]/);
  assert.match(register, /INSERT INTO students/);
  assert.match(register, /INSERT INTO teachers/);
  assert.match(register, /Parent profiles are intentionally represented by the existing unified/);
});

test('D/E/S teacher is pending and login blocks it before a session exists', () => {
  assert.match(register, /\$status = \$accountType === 'teacher' \? 'pending' : 'active'/);
  assert.ok(login.indexOf("account_status'] ?? 'active') === 'pending'") < login.indexOf('AuthManager::loginUser'));
  assert.match(login, /في انتظار موافقة الإدارة/);
});

test('F admin approval activates a teacher and uses the existing admin CSRF/RBAC endpoint', () => {
  assert.match(admin, /approve_teacher/);
  assert.match(admin, /SET u\.account_status = :status/);
  assert.match(admin, /AuthManager::requireRole\(\['super_admin'\]\)/);
  assert.match(admin, /validateCsrfToken/);
});

test('G/H/I all public identity conflicts use one generic response and race-safe keys', () => {
  assert.match(register, /registrationConflict\(\)/);
  assert.match(register, /بيانات التسجيل مستخدمة بالفعل أو تتعارض مع حساب موجود/);
  assert.doesNotMatch(register, /البريد الإلكتروني مستخدم بالفعل|اسم المستخدم مستخدم بالفعل|رقم الموبايل مستخدم بالفعل/);
  assert.match(schema, /UNIQUE KEY `uq_users_registration_phone_key`/);
  assert.match(schema, /UNIQUE KEY `uq_students_user_id`/);
});

test('J/K/L/M/N validation covers type, email, password policy/mismatch and required fields', () => {
  assert.match(register, /نوع الحساب غير صالح/);
  assert.match(register, /FILTER_VALIDATE_EMAIL/);
  assert.match(register, /registrationLength\(\$password\) < 8/);
  assert.match(register, /كلمتا المرور غير متطابقتين/);
  assert.match(register, /يرجى استكمال جميع البيانات المطلوبة/);
});

test('O prepared statements keep injection-style values out of SQL construction', () => {
  const inserts = [...register.matchAll(/\$db->prepare\(([^;]+);/gs)];
  assert.ok(inserts.length >= 5);
  assert.doesNotMatch(register, /INSERT INTO users[^;]*\.\s*\$name/s);
  assert.match(register, /'name' => \$name/);
});

test('P every multi-record registration is atomic and rolls back on failure', () => {
  assert.match(register, /\$db->beginTransaction\(\)/);
  assert.match(register, /\$db->commit\(\)/);
  assert.match(register, /\$db->rollBack\(\)/);
  assert.ok(register.indexOf('beginTransaction') < register.indexOf('INSERT INTO users'));
});

test('Q/R login supports newly registered username or email with existing password_verify', () => {
  assert.match(login, /u\.email = :identifier OR u\.username = :identifier/);
  assert.match(login, /password_verify/);
  assert.match(login, /AuthManager::loginUser/);
  assert.equal((login.match(/بيانات تسجيل الدخول غير صحيحة/g) || []).length, 2);
  assert.doesNotMatch(login, /Invalid credentials/);
});

test('T existing users migrate active and usernames backfill from email', () => {
  assert.match(migration, /DEFAULT 'active'/);
  assert.match(migration, /UPDATE `users` SET `username` = `email`/);
});

test('U/V parent one-to-many and global student architecture remain reused', () => {
  assert.match(schema, /`parent_user_id` INT UNSIGNED NULL/);
  assert.match(schema, /fk_student_parent/);
  assert.match(schema, /UNIQUE KEY `uq_enrollment_teacher_student`/);
  assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS `students`/g) || []).length, 1);
  assert.equal((schema.match(/CREATE TABLE IF NOT EXISTS `users`/g) || []).length, 1);
});

test('W teacher-created student default stays hashed and is not returned', () => {
  assert.match(teacher, /password_hash\(teacherDefaultStudentPassword\(\), PASSWORD_DEFAULT\)/);
  const responseBlock = teacher.slice(teacher.indexOf("'message' => 'تم إنشاء حساب الطالب وربطه"), teacher.indexOf("if ($action === 'enroll_existing_student')"));
  assert.doesNotMatch(responseBlock, /default_password/);
});

test('X/Y public CSRF bootstrap and database-backed registration rate limiting exist', () => {
  assert.match(register, /AuthManager::getCsrfToken/);
  assert.match(register, /AuthManager::validateCsrfToken/);
  assert.match(register, /registrationConsumeRateLimit/);
  assert.match(register, /login_attempts/);
});

test('controlled active subjects and pending teacher fields are schema-backed', () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS `subjects`/);
  assert.match(schema, /UNIQUE KEY `uq_subjects_normalized_name`/);
  assert.match(schema, /`subject_id` INT UNSIGNED NULL/);
  assert.match(register, /WHERE id = :id AND status = 'active'/);
  assert.match(migration, /الدراسات الاجتماعية/);
  assert.match(migration, /العلوم/);
});

test('student code is a non-enumerating recovery signal and weak name/DOB merging is absent', () => {
  assert.match(register, /A supplied code means/);
  assert.doesNotMatch(register, /WHERE student_code = :student_code/);
  assert.doesNotMatch(register, /WHERE name = :name AND date_of_birth = :date_of_birth/);
  assert.doesNotMatch(register, /يوجد حساب طالب مسجل بهذا الكود|قد يكون للطالب حساب مسجل بالفعل/);
  assert.doesNotMatch(register, /'student_id'\s*=>\s*\$studentId/);
});

test('public payload cannot forge role, status, ownership, enrollment, or parent relationships', () => {
  assert.doesNotMatch(register, /\$input\[['"](?:role|account_status|teacher_id|tenant_teacher_id|student_id|parent_id|group_id)['"]\]/);
  assert.match(register, /\$status = \$accountType === 'teacher' \? 'pending' : 'active'/);
  assert.doesNotMatch(register, /INSERT INTO student_enrollments/);
  assert.doesNotMatch(register, /parent_user_id\).*VALUES/s);
});

test('ApiClient registration GET stores CSRF and POST resolves under /110/', async () => {
  const calls = [];
  const ApiClient = loadApi(async (url, options) => {
    calls.push({ url, options });
    return response(calls.length === 1 ? 200 : 201, calls.length === 1
      ? { success: true, subjects: [], csrf_token: 'registration-csrf' }
      : { success: true, message: 'ok' });
  });
  await ApiClient.getRegistrationOptions();
  await ApiClient.register({ account_type: 'parent' });
  assert.equal(calls[0].url, '/110/api/register.php');
  assert.equal(calls[1].options.headers['X-CSRF-Token'], 'registration-csrf');
  assert.equal(JSON.parse(calls[1].options.body).csrf_token, 'registration-csrf');
});

test('/register direct route is public and registration buttons navigate to it', () => {
  assert.match(app, /addRoute\('\/register'/);
  assert.match(app, /\{ public: true \}/);
  assert.match(read('assets/js/landing.js'), /navigate\('\/register'\)/);
  assert.match(read('.htaccess'), /RewriteRule \^ index\.html/);
});

test('registration UI has three choices, role-specific fields, back navigation and submit lock', () => {
  for (const type of ['teacher', 'student', 'parent']) assert.match(ui, new RegExp(`data-account-type="${type}"`));
  for (const field of ['subject_id', 'parent_phone', 'student_code', 'date_of_birth', 'gender', 'bio', 'password_confirmation']) assert.match(ui, new RegExp(field));
  assert.match(ui, /تغيير نوع الحساب/);
  assert.match(ui, /if \(this\.submitting\) return/);
  assert.match(ui, /submit\.disabled = true/);
  assert.match(ui, /لا توجد مواد متاحة للتسجيل حالياً/);
});
