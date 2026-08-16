'use strict';

/** P1-M parent authorization regression contracts. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const parentApi = read('api/parent.php');
const studentApi = read('api/student.php');
const registerApi = read('api/register.php');

test('parent dashboard authorization uses explicit parent_user_id only', () => {
  assert.match(parentApi, /WHERE s\.parent_user_id = :puid/);
  assert.match(parentApi, /WHERE parent_user_id = :puid/);
  assert.doesNotMatch(parentApi, /parent_phone\s*=\s*:pphone|OR\s+parent_phone/);
});

test('student API parent access uses explicit parent_user_id only', () => {
  assert.match(studentApi, /WHERE parent_user_id = :puid LIMIT 1/);
  assert.match(studentApi, /WHERE id = :sid AND parent_user_id = :puid LIMIT 1/);
  assert.doesNotMatch(studentApi, /parent_phone\s*=\s*:pphone|OR\s+parent_phone/);
});

test('public parent registration cannot create or infer a child relationship', () => {
  assert.doesNotMatch(registerApi, /INSERT INTO student_enrollments/);
  assert.doesNotMatch(registerApi, /UPDATE\s+students[\s\S]*parent_user_id/i);
  assert.doesNotMatch(registerApi, /(?:INSERT|UPDATE)\s+(?:INTO\s+)?students[\s\S]{0,300}parent_user_id/i);
});

test('matching informational parent_phone is never an authorization predicate', () => {
  const authorizationSource = parentApi + '\n' + studentApi;
  assert.doesNotMatch(authorizationSource, /OR\s+parent_phone/);
});
