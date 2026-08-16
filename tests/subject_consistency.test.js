'use strict';

/** P1-M canonical subject and migration/seed consistency contracts. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const teacher = read('api/teacher.php');
const student = read('api/student.php');
const parent = read('api/parent.php');
const admin = read('api/super_admin.php');
const migration = read('database/migrations/20260816_public_registration.sql');
const seed = read('database/seed.sql');
const schema = read('database/schema.sql');

function catalog(sql) {
  const block = sql.match(/INSERT INTO `subjects`[^;]+;/s)?.[0] || '';
  return [...block.matchAll(/\((\d+),\s*'([^']+)',\s*'([^']+)',\s*'active'\)/g)]
    .map(match => ({ id: Number(match[1]), name: match[2], normalized: match[3] }));
}

test('migration and seed use the exact same deterministic subject IDs and names', () => {
  assert.deepEqual(catalog(migration), catalog(seed));
  assert.equal(catalog(migration).length, 10);
  assert.doesNotMatch(migration, /INSERT INTO `subjects` \(`name`/);
});

test('legacy backfill is explicit and never wildcard/ambiguous', () => {
  assert.match(migration, /CASE TRIM\(`subject`\)/);
  assert.doesNotMatch(migration, /LIKE\s+CONCAT|LIKE\s+'%/i);
  assert.match(migration, /ELSE NULL/);
});

test('subject_id is authoritative and legacy text is synchronized on settings update', () => {
  const settings = teacher.slice(teacher.indexOf("if ($action === 'update_teacher_settings')"), teacher.indexOf("Helper::sendJson(['success' => false, 'error' => 'إجراء غير معروف في المدرس']"));
  assert.match(settings, /subject_id/);
  assert.match(settings, /status = 'active'/);
  assert.match(settings, /subject = :subject_compat/);
  assert.doesNotMatch(settings, /\$payload\['subject'\]/);
});

test('all teacher-subject dashboard readers resolve catalog name with safe legacy fallback', () => {
  assert.match(teacher, /COALESCE\(s\.name, t\.subject\) AS resolved_subject/);
  assert.match(student, /COALESCE\(su\.name, t\.subject\) AS subject/);
  assert.match(parent, /COALESCE\(su\.name, t\.subject\) AS subject/);
  assert.match(admin, /COALESCE\(su\.name, t\.subject\) AS subject/);
});

test('schema enforces catalog uniqueness, FK, account/profile uniqueness and phone reservation', () => {
  assert.match(schema, /UNIQUE KEY `uq_subjects_normalized_name`/);
  assert.match(schema, /CONSTRAINT `fk_teacher_subject`/);
  assert.match(schema, /UNIQUE KEY `uq_students_user_id`/);
  assert.match(schema, /UNIQUE KEY `uq_users_registration_phone_key`/);
});

test('migration documents MySQL preflight and partial-DDL recovery', () => {
  assert.match(migration, /MySQL DDL implicitly commits/);
  assert.match(migration, /PRE-FLIGHT/);
  assert.match(migration, /rerun this whole file/);
  assert.match(migration, /SHOW CREATE TABLE/);
});
