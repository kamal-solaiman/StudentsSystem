'use strict';

/**
 * P1-K — Teacher "الطلاب" (Students) module, frontend contract tests.
 *
 * These tests run the REAL assets/js/api.js, assets/js/modal.js and
 * assets/js/teacher.js inside a node:vm sandbox (no browser, no PHP), and
 * additionally assert the presence of the security-critical strings in
 * api/teacher.php by source inspection.
 *
 * Scope reminder (spec):
 *  - one GLOBAL student per platform, `student_code` is the business id;
 *  - teachers never duplicate a student — they only manage their own link;
 *  - search-first add flow, academic class is a hard backend filter;
 *  - one group per teacher per student (transfer = UPDATE, never a 2nd row);
 *  - "delete" = hide/unlink for this teacher only;
 *  - teacher_id is never sent from the client.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

function response(status, body, statusText = '') {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    async text() { return body; }
  };
}

function loadApi(fetchImpl, pathname = '/110/teacher/students') {
  const store = new Map();
  const sessionStorage = {
    getItem: key => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key)
  };
  const sandbox = {
    window: { location: { pathname, origin: 'https://example.test' } },
    sessionStorage,
    fetch: fetchImpl,
    console: { error() {} },
    Error,
    JSON,
    String,
    Number,
    Array,
    Object
  };
  vm.runInNewContext(read('assets/js/api.js') + '\nthis.ApiClient = ApiClient;', sandbox);
  return { ApiClient: sandbox.ApiClient, sessionStorage };
}

function loadStudentHelpers() {
  const sandbox = { Object, String, Array, Number };
  vm.runInNewContext(read('assets/js/teacher.js') + `
    this.helpers = {
      escapeStudentText,
      studentValidationError,
      studentGroupsForClass,
      buildStudentSearchPayload,
      collectStudentPayload,
      STUDENT_GENDER_OPTIONS,
      STUDENT_DEFAULT_PASSWORD,
      STUDENT_LINK_STATE_LABELS,
      TeacherController
    };`, sandbox);
  return sandbox.helpers;
}

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

async function captureApiCall(invoke, pathname = '/110/teacher/students') {
  const calls = [];
  const { ApiClient } = loadApi(async (url, options) => {
    calls.push({ url, options });
    return response(200, '{"success":true}');
  }, pathname);
  ApiClient.setCsrfToken('csrf-test');
  await invoke(ApiClient);
  return calls;
}

const teacherSource = read('assets/js/teacher.js');
const apiSource = read('assets/js/api.js');
const backendSource = read('api/teacher.php');
const reportsSource = read('api/reports.php');
const schemaSource = read('database/schema.sql');
const migrationSource = read('database/migrations/20260815_students_module_p1k.sql');

/** Strip PHP/SQL comment lines so prose about a rule is never mistaken for it. */
function stripComments(source) {
  return source
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      return !(trimmed.startsWith('*')
        || trimmed.startsWith('/*')
        || trimmed.startsWith('//')
        || trimmed.startsWith('--')
        || trimmed.startsWith('#'));
    })
    .join('\n');
}

const backendCode = stripComments(backendSource);
const migrationCode = stripComments(migrationSource);

/**
 * The action DISPATCH block for one student action. The RBAC switch mentions
 * the same action names earlier, so the handler is located from its last
 * occurrence (the `if ($action === '...')` dispatch itself).
 */
function backendActionBlock(action, nextAction) {
  const start = backendSource.lastIndexOf(`$action === '${action}'`);
  const end = nextAction
    ? backendSource.lastIndexOf(`$action === '${nextAction}'`)
    : backendSource.length;
  assert.ok(start > 0, `action ${action} not found`);
  assert.ok(end > start, `block boundaries for ${action} are inverted`);
  return backendSource.slice(start, end);
}

/* ===============================================================
 * A. ApiClient wiring — envelope, prefix, no teacher_id
 * =============================================================== */

test('01 searchStudents posts the search_students envelope without teacher_id', async () => {
  const [call] = await captureApiCall(api => api.searchStudents({ class_id: 3, query: 'يوسف' }));
  const body = JSON.parse(call.options.body);
  assert.equal(call.url, '/110/api/teacher.php');
  assert.equal(call.options.method, 'POST');
  assert.equal(body.action, 'search_students');
  assert.equal(body.payload.class_id, 3);
  assert.equal(body.payload.query, 'يوسف');
  assert.equal(body.payload.teacher_id, undefined);
});

test('02 createStudent posts the create_student envelope without teacher_id', async () => {
  const [call] = await captureApiCall(api => api.createStudent({
    class_id: 1, group_id: 2, name: 'طالب جديد', student_code: '', email: '', phone: '01000000000'
  }));
  const body = JSON.parse(call.options.body);
  assert.equal(call.url, '/110/api/teacher.php');
  assert.equal(body.action, 'create_student');
  assert.equal(body.payload.name, 'طالب جديد');
  assert.equal(body.payload.group_id, 2);
  assert.equal(body.payload.teacher_id, undefined);
});

test('03 enrollExistingStudent posts the enroll_existing_student envelope', async () => {
  const [call] = await captureApiCall(api => api.enrollExistingStudent({
    student_id: 44, class_id: 1, group_id: 2
  }));
  const body = JSON.parse(call.options.body);
  assert.equal(body.action, 'enroll_existing_student');
  assert.equal(body.payload.student_id, 44);
  assert.equal(body.payload.class_id, 1);
  assert.equal(body.payload.group_id, 2);
  assert.equal(body.payload.teacher_id, undefined);
});

test('04 transferStudentGroup posts the transfer_student_group envelope', async () => {
  const [call] = await captureApiCall(api => api.transferStudentGroup({ student_id: 5, group_id: 9 }));
  const body = JSON.parse(call.options.body);
  assert.equal(body.action, 'transfer_student_group');
  assert.equal(body.payload.student_id, 5);
  assert.equal(body.payload.group_id, 9);
  assert.equal(body.payload.teacher_id, undefined);
});

test('05 unlinkStudent posts unlink_student and never issues an HTTP DELETE', async () => {
  const [call] = await captureApiCall(api => api.unlinkStudent(12));
  const body = JSON.parse(call.options.body);
  assert.equal(call.options.method, 'POST');
  assert.notEqual(call.options.method, 'DELETE');
  assert.equal(body.action, 'unlink_student');
  assert.equal(body.payload.student_id, 12);
  assert.equal(body.payload.teacher_id, undefined);
});

test('06 student calls carry the CSRF token in the header and the body', async () => {
  const [call] = await captureApiCall(api => api.createStudent({ class_id: 1, group_id: 1, name: 'س' }));
  assert.equal(call.options.headers['X-CSRF-Token'], 'csrf-test');
  assert.equal(JSON.parse(call.options.body).csrf_token, 'csrf-test');
});

test('07 the ApiClient never exposes a hard-delete student helper', () => {
  assert.ok(!/deleteStudent\s*\(/.test(apiSource), 'no deleteStudent helper may exist');
  assert.ok(/static async unlinkStudent/.test(apiSource));
});

/* ===============================================================
 * B. Client-side payload helpers (UX mirror of backend validation)
 * =============================================================== */

test('08 buildStudentSearchPayload requires class, group and a 2+ char query', () => {
  const { buildStudentSearchPayload } = loadStudentHelpers();
  assert.throws(() => buildStudentSearchPayload({ class_id: 0, group_id: 1, query: 'يوسف' }), /الصف الدراسي/);
  assert.throws(() => buildStudentSearchPayload({ class_id: 1, group_id: 0, query: 'يوسف' }), /المجموعة/);
  assert.throws(() => buildStudentSearchPayload({ class_id: 1, group_id: 2, query: 'ي' }), /حرفين/);
  assert.throws(
    () => buildStudentSearchPayload({ class_id: 1, group_id: 2, query: 'x'.repeat(101) }),
    /طويل/
  );
  const payload = buildStudentSearchPayload({ class_id: '1', group_id: '2', query: '  STU-10045  ' });
  assert.deepEqual(toPlain(payload), { class_id: 1, group_id: 2, query: 'STU-10045' });
  assert.equal(payload.teacher_id, undefined);
});

test('09 a client validation failure is surfaced as a 400 (AppModal shows its message)', () => {
  const { buildStudentSearchPayload } = loadStudentHelpers();
  try {
    buildStudentSearchPayload({ class_id: 1, group_id: 2, query: '' });
    assert.fail('expected a validation error');
  } catch (error) {
    assert.equal(error.status, 400);
  }
});

test('10 collectStudentPayload requires ONLY the name — every profile field is optional', () => {
  const { collectStudentPayload } = loadStudentHelpers();
  assert.throws(() => collectStudentPayload({ class_id: 1, group_id: 2, name: '   ' }), /اسم الطالب مطلوب/);
  const payload = collectStudentPayload({ class_id: 1, group_id: 2, name: 'يوسف محمد' });
  assert.deepEqual(toPlain(payload), {
    class_id: 1,
    group_id: 2,
    name: 'يوسف محمد',
    student_code: '',
    email: '',
    phone: '',
    parent_phone: '',
    gender: '',
    date_of_birth: '',
    address: '',
    notes: ''
  });
  assert.equal(payload.teacher_id, undefined);
});

test('11 collectStudentPayload passes every supported optional field through', () => {
  const { collectStudentPayload } = loadStudentHelpers();
  const payload = collectStudentPayload({
    class_id: 1, group_id: 2, name: ' سارة ', student_code: ' stu-9 ', email: ' A@B.COM ',
    phone: ' 0100 ', parent_phone: ' 0109 ', gender: 'female', date_of_birth: '2008-05-01',
    address: ' القاهرة ', notes: ' ملاحظة '
  });
  assert.equal(payload.name, 'سارة');
  assert.equal(payload.student_code, 'stu-9');
  assert.equal(payload.email, 'A@B.COM');
  assert.equal(payload.gender, 'female');
  assert.equal(payload.date_of_birth, '2008-05-01');
  assert.equal(payload.address, 'القاهرة');
  assert.equal(payload.notes, 'ملاحظة');
});

test('12 the client never sends a password — the default is display-only', () => {
  const { collectStudentPayload, STUDENT_DEFAULT_PASSWORD } = loadStudentHelpers();
  const payload = collectStudentPayload({ class_id: 1, group_id: 1, name: 'ن' });
  assert.equal(payload.password, undefined);
  assert.equal(payload.password_hash, undefined);
  assert.equal(STUDENT_DEFAULT_PASSWORD, '00000000');
});

test('13 studentGroupsForClass keeps the academic class filter in the group selector', () => {
  const { studentGroupsForClass } = loadStudentHelpers();
  const groups = [
    { id: 1, name: 'أ', class_id: 1 },
    { id: 2, name: 'ب', class_id: 2 },
    { id: 3, name: 'ج', class_id: 1 }
  ];
  assert.deepEqual(toPlain(studentGroupsForClass(groups, 1)).map(g => g.id), [1, 3]);
  assert.deepEqual(toPlain(studentGroupsForClass(groups, '2')).map(g => g.id), [2]);
  assert.deepEqual(toPlain(studentGroupsForClass(groups, 99)), []);
  assert.deepEqual(toPlain(studentGroupsForClass(undefined, 1)), []);
});

test('14 gender is optional and limited to the schema ENUM values', () => {
  const { STUDENT_GENDER_OPTIONS } = loadStudentHelpers();
  assert.deepEqual(toPlain(STUDENT_GENDER_OPTIONS).map(o => o.value), ['', 'male', 'female']);
});

test('15 escapeStudentText neutralizes HTML in server-supplied student text', () => {
  const { escapeStudentText } = loadStudentHelpers();
  const escaped = escapeStudentText('<img src=x onerror="alert(1)">');
  assert.ok(!escaped.includes('<img'));
  assert.match(escaped, /&lt;img/);
  assert.equal(escapeStudentText(null), '');
});

/* ===============================================================
 * C. Students tab rendering
 * =============================================================== */

function renderStudentsFixture(state) {
  const helpers = loadStudentHelpers();
  const context = Object.assign({
    data: {},
    studentsMessage: null,
    studentSearch: null,
    renderEmptyRow: (colspan, message) => `<tr><td colspan="${colspan}">${message}</td></tr>`
  }, state);
  context.renderStudentSearchPanel =
    helpers.TeacherController.prototype.renderStudentSearchPanel.bind(context);
  return helpers.TeacherController.prototype.renderStudents.call(context);
}

test('16 the students table renders the required columns plus the actions column', () => {
  const html = renderStudentsFixture({
    data: {
      classes: [{ id: 1, name: 'الصف الثالث الثانوي' }],
      groups: [{ id: 2, name: 'مجموعة السبت', class_id: 1 }],
      students: [{
        id: 77, student_code: 'STU-10045', name: 'يوسف محمد سعيد', grade_level: 'الصف الثالث الثانوي',
        group_id: 2, group_name: 'مجموعة السبت', class_id: 1,
        phone: '01044444441', parent_phone: '01099999999'
      }]
    }
  });
  assert.match(html, /كود الطالب/);
  assert.match(html, /اسم الطالب/);
  assert.match(html, /المجموعة/);
  assert.match(html, /كارنيه الحضور/);
  assert.match(html, /الإجراءات/);
  assert.match(html, /STU-10045/);
  assert.match(html, /يوسف محمد سعيد/);
  assert.match(html, /نقل لمجموعة/);
  assert.match(html, /إزالة من قائمتي/);
  // The destructive wording "حذف الطالب" must never appear: this is unlink only
  assert.ok(!/حذف الطالب/.test(html));
});

test('17 the empty state spans the new 8-column layout', () => {
  const html = renderStudentsFixture({
    data: { classes: [{ id: 1, name: 'ص' }], groups: [{ id: 2, name: 'م', class_id: 1 }], students: [] }
  });
  assert.match(html, /colspan="8"/);
  assert.match(html, /لا يوجد طلاب حاليًا/);
});

test('18 adding a student is blocked until a class and a group exist', () => {
  const noClasses = renderStudentsFixture({ data: { classes: [], groups: [], students: [] } });
  assert.match(noClasses, /يجب إضافة صف دراسي أولاً قبل إضافة الطلاب/);
  assert.ok(!/id="open-student-modal"/.test(noClasses));

  const noGroups = renderStudentsFixture({
    data: { classes: [{ id: 1, name: 'ص' }], groups: [], students: [] }
  });
  assert.match(noGroups, /يجب إضافة مجموعة دراسية أولاً قبل إضافة الطلاب/);
  assert.ok(!/id="open-student-modal"/.test(noGroups));

  const ready = renderStudentsFixture({
    data: { classes: [{ id: 1, name: 'ص' }], groups: [{ id: 2, name: 'م', class_id: 1 }], students: [] }
  });
  assert.match(ready, /data-action="open-student-modal"/);
});

test('19 the students tab renders an inline message banner', () => {
  const ok = renderStudentsFixture({
    data: { classes: [{ id: 1, name: 'ص' }], groups: [{ id: 2, name: 'م', class_id: 1 }], students: [] },
    studentsMessage: { text: 'تم إضافة الطالب إلى المجموعة بنجاح', isError: false }
  });
  assert.match(ok, /id="students-action-message"/);
  assert.match(ok, /تم إضافة الطالب إلى المجموعة بنجاح/);

  const bad = renderStudentsFixture({
    data: { classes: [{ id: 1, name: 'ص' }], groups: [{ id: 2, name: 'م', class_id: 1 }], students: [] },
    studentsMessage: { text: 'فشل', isError: true }
  });
  assert.match(bad, /#b91c1c/);
});

/* ===============================================================
 * D. Search-first flow rendering (scenarios A/B/C of the spec)
 * =============================================================== */

function renderSearchPanel(studentSearch) {
  const helpers = loadStudentHelpers();
  return helpers.TeacherController.prototype.renderStudentSearchPanel.call({ studentSearch });
}

test('20 scenario "not found" offers the new-student form only', () => {
  const html = renderSearchPanel({
    class_id: 1, class_name: 'الصف الثالث الثانوي', group_id: 2, group_name: 'مجموعة السبت',
    query: 'STU-99999', results: []
  });
  assert.match(html, /لا يوجد طالب مطابق في هذا الصف الدراسي/);
  assert.match(html, /data-action="open-new-student-modal"/);
  assert.match(html, /إضافة طالب جديد/);
  assert.ok(!/data-action="link-student"/.test(html));
});

test('21 scenario "exists on the platform but not linked to me" requires an explicit opt-in', () => {
  const html = renderSearchPanel({
    class_id: 1, class_name: 'الصف الثالث الثانوي', group_id: 2, group_name: 'مجموعة السبت',
    query: 'يوسف',
    results: [{
      id: 31, student_code: 'STU-10045', name: 'يوسف محمد', phone: '010••••41', phone_masked: true,
      grade_level: 'الصف الثالث الثانوي', link_state: 'unlinked',
      group_id: null, group_name: null, class_id: null, class_name: null
    }]
  });
  assert.match(html, /الطالب مسجل بالفعل/);
  assert.match(html, /إضافة الطالب إلى المجموعة/);
  assert.match(html, /data-action="link-student" data-id="31"/);
  // No auto-link: the button is the only path, and no create form is implied
  assert.ok(!/data-action="transfer-student"/.test(html));
});

test('22 scenario "already added to me" shows the current class/group and offers a transfer', () => {
  const html = renderSearchPanel({
    class_id: 1, class_name: 'الصف الثالث الثانوي', group_id: 2, group_name: 'مجموعة السبت',
    query: 'يوسف',
    results: [{
      id: 31, student_code: 'STU-10045', name: 'يوسف محمد', phone: '01044444441', phone_masked: false,
      grade_level: 'الصف الثالث الثانوي', link_state: 'linked',
      group_id: 5, group_name: 'مجموعة الأحد', class_id: 1, class_name: 'الصف الثالث الثانوي'
    }]
  });
  assert.match(html, /الطالب مضاف بالفعل/);
  assert.match(html, /مجموعة الأحد/);
  assert.match(html, /data-action="transfer-student" data-id="31"/);
  assert.ok(!/data-action="link-student"/.test(html));
});

test('23 a student hidden by me earlier can be re-linked (no duplicate creation)', () => {
  const html = renderSearchPanel({
    class_id: 1, class_name: 'ص', group_id: 2, group_name: 'م', query: 'يوسف',
    results: [{
      id: 31, student_code: 'STU-10045', name: 'يوسف محمد', phone: '01044444441', phone_masked: false,
      grade_level: 'ص', link_state: 'hidden', group_id: null, group_name: null,
      class_id: null, class_name: null
    }]
  });
  assert.match(html, /الطالب مسجل بالفعل/);
  assert.match(html, /data-action="link-student" data-id="31"/);
});

test('24 search results escape hostile student text and expose no internal ids as text', () => {
  const html = renderSearchPanel({
    class_id: 1, class_name: 'ص', group_id: 2, group_name: 'م', query: '<b>x</b>',
    results: [{
      id: 31, student_code: 'STU-1', name: '<script>alert(1)</script>', phone: '010',
      phone_masked: true, grade_level: 'ص', link_state: 'unlinked',
      group_id: null, group_name: null, class_id: null, class_name: null
    }]
  });
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
  assert.ok(!html.includes('<b>x</b>'));
});

test('25 the search panel can be dismissed', () => {
  const html = renderSearchPanel({
    class_id: 1, class_name: 'ص', group_id: 2, group_name: 'م', query: 'اب', results: []
  });
  assert.match(html, /data-action="clear-student-search"/);
});

/* ===============================================================
 * E. Modal fields & controller wiring (source contracts)
 * =============================================================== */

test('26 the add flow is search-first: class → group → query, then results', () => {
  assert.match(teacherSource, /openStudentModal\(\)\s*{/);
  const modalBody = teacherSource.slice(
    teacherSource.indexOf('openStudentModal() {'),
    teacherSource.indexOf('openNewStudentModal() {')
  );
  // The first modal collects the class, the group and the query, and submits
  // to the SERVER-side search action (never a local list filter).
  assert.match(modalBody, /name: 'class_id'/);
  assert.match(modalBody, /name: 'group_id'/);
  assert.match(modalBody, /name: 'query'/);
  assert.match(modalBody, /ApiClient\.searchStudents/);
  assert.ok(!/ApiClient\.createStudent/.test(modalBody), 'the search step must not create a student');
});

test('27 the new-student modal exposes every spec field and only requires the name', () => {
  const body = teacherSource.slice(
    teacherSource.indexOf('openNewStudentModal() {'),
    teacherSource.indexOf('confirmLinkStudent(studentId) {')
  );
  ['student_code', 'name', 'phone', 'email', 'gender', 'date_of_birth', 'address', 'notes', 'parent_phone']
    .forEach(field => assert.match(body, new RegExp(`name: '${field}'`), `missing field ${field}`));
  const requiredCount = (body.match(/required: true/g) || []).length;
  // class_id, group_id (placement) and name — no profile field is mandatory
  assert.equal(requiredCount, 3);
  assert.match(body, /name: 'name', label: 'اسم الطالب', type: 'text', required: true/);
  assert.match(body, /ApiClient\.createStudent/);
});

test('28 the teacher flow never creates or edits parent credentials', () => {
  const studentsBlock = teacherSource.slice(
    teacherSource.indexOf('openStudentModal() {'),
    teacherSource.indexOf('renderStudents() {')
  );
  assert.ok(!/parent_email/.test(studentsBlock));
  assert.ok(!/parent_password/.test(studentsBlock));
  assert.ok(!/create_parent/.test(teacherSource));
  // Only the parent PHONE (an existing students column) is collected.
  assert.match(studentsBlock, /name: 'parent_phone'/);
});

test('29 every students action is bound in attachEventListeners', () => {
  [
    ['open-student-modal', 'openStudentModal'],
    ['open-new-student-modal', 'openNewStudentModal'],
    ['link-student', 'confirmLinkStudent'],
    ['transfer-student', 'openTransferStudentModal'],
    ['unlink-student', 'confirmUnlinkStudent'],
    ['clear-student-search', 'clearStudentSearch']
  ].forEach(([action, handler]) => {
    assert.match(
      teacherSource,
      new RegExp(`data-action="${action}"[\\s\\S]{0,220}this\\.${handler}\\(`),
      `action ${action} is not wired to ${handler}`
    );
  });
});

test('30 the transfer modal only offers OTHER groups of the SAME academic class', () => {
  const body = teacherSource.slice(
    teacherSource.indexOf('openTransferStudentModal(studentId) {'),
    teacherSource.indexOf('confirmUnlinkStudent(studentId) {')
  );
  assert.match(body, /this\.studentGroupOptions\(student\.class_id\)/);
  assert.match(body, /filter\(option => Number\(option\.value\) !== Number\(student\.group_id\)\)/);
  assert.match(body, /ApiClient\.transferStudentGroup/);
});

test('31 the unlink modal states that the platform account is not deleted', () => {
  const body = teacherSource.slice(
    teacherSource.indexOf('confirmUnlinkStudent(studentId) {'),
    teacherSource.indexOf('clearStudentSearch() {')
  );
  assert.match(body, /من قائمة طلابك فقط/);
  assert.match(body, /لن يتم حذف حساب الطالب من المنصة/);
  assert.match(body, /ApiClient\.unlinkStudent/);
});

test('32 the browser never receives a platform-wide student dump', () => {
  assert.ok(!/all_platform_students/.test(teacherSource), 'teacher.js still references all_platform_students');
  assert.ok(!/all_platform_students/.test(apiSource));
  assert.ok(!/all_platform_students/.test(backendCode), 'api/teacher.php still returns the full dump');
});

/* ===============================================================
 * F. Backend source contracts (static verification)
 * =============================================================== */

test('33 the backend never hard-deletes a student', () => {
  assert.ok(!/DELETE\s+FROM\s+students/i.test(backendCode));
  assert.ok(!/DELETE\s+FROM\s+users/i.test(backendCode));
  assert.match(backendSource, /UPDATE student_enrollments\s*\n\s*SET status = \\'inactive\\'/);
});

test('34 all five student actions exist and take the tenant from the session only', () => {
  ['search_students', 'create_student', 'enroll_existing_student', 'transfer_student_group', 'unlink_student']
    .forEach(action => assert.match(backendSource, new RegExp(`\\$action === '${action}'`)));
  // teacher_id always comes from the resolved session tenant
  assert.ok(!/\$payload\['teacher_id'\]/.test(backendCode));
  assert.match(backendSource, /tenant_teacher_id/);
});

test('35 the academic class is a hard backend filter for search and enrollment', () => {
  assert.match(backendSource, /function teacherStudentClassFilterSql\(\)/);
  const searchBlock = backendActionBlock('search_students', 'create_student');
  assert.match(searchBlock, /teacherRequireOwnedClass/);
  assert.match(searchBlock, /teacherStudentClassFilterSql\(\)/);
  assert.match(searchBlock, /LIMIT 20/);
  const enrollBlock = backendActionBlock('enroll_existing_student', 'transfer_student_group');
  assert.match(enrollBlock, /teacherStudentClassFilterSql\(\)/);
});

test('36 create + enroll and enroll-existing run inside a transaction', () => {
  const createBlock = backendActionBlock('create_student', 'enroll_existing_student');
  assert.match(createBlock, /\$db->beginTransaction\(\)/);
  assert.match(createBlock, /\$db->commit\(\)/);
  assert.match(createBlock, /\$db->rollBack\(\)/);
  // Concurrency: the DB unique index is the real guarantee
  assert.match(createBlock, /'23000', '23505'/);
});

test('37 a transfer UPDATEs the single enrollment and never inserts a second row', () => {
  const block = backendActionBlock('transfer_student_group', 'unlink_student');
  assert.match(block, /UPDATE student_enrollments/);
  assert.ok(!/INSERT INTO student_enrollments/.test(block), 'a transfer must never insert an enrollment');
});

test('38 the default student password is defined server-side only', () => {
  assert.match(backendSource, /function teacherDefaultStudentPassword\(\): string/);
  assert.match(backendSource, /return '00000000';/);
  assert.match(backendSource, /password_hash\(teacherDefaultStudentPassword\(\), PASSWORD_DEFAULT\)/);
  // The credentials of an EXISTING student are never overwritten when linked.
  const enrollBlock = backendActionBlock('enroll_existing_student', 'transfer_student_group');
  assert.ok(!/password_hash/.test(enrollBlock));
  assert.ok(!/UPDATE users/.test(enrollBlock));
});

test('39 the teacher module never writes a parent account', () => {
  assert.ok(!/INSERT INTO users[\s\S]{0,200}'parent'/.test(backendCode));
  assert.ok(!/parent_user_id\s*=/.test(backendCode));
});

test('40 search results are minimal: no hashes, tokens or other-teacher data', () => {
  const block = backendActionBlock('search_students', 'create_student');
  assert.ok(!/password_hash/.test(block));
  assert.ok(!/qr_code_token/.test(block));
  assert.match(block, /teacherMaskStudentPhone/);
  assert.match(block, /'phone_masked'/);
  // group/class of OTHER teachers are nulled out
  assert.match(block, /\$isOurs && \$row\['group_id'\] !== null/);
});

test('41 the teacher students list and the students report only show ACTIVE links', () => {
  assert.match(backendSource, /WHERE se\.teacher_id = :tid AND se\.status = \\'active\\'/);
  assert.match(reportsSource, /se\.status = \\'active\\'/);
});

test('42 staff need the existing students permission for every student action', () => {
  const first = backendSource.indexOf("$action === 'create_student'");
  const rbac = backendSource.slice(first - 400, first + 900);
  ['search_students', 'create_student', 'enroll_existing_student', 'transfer_student_group', 'unlink_student']
    .forEach(action => assert.match(rbac, new RegExp(`\\$action === '${action}'`)));
  assert.match(rbac, /AuthManager::requirePermission\('students'\)/);
});

/* ===============================================================
 * G. Schema & migration contracts
 * =============================================================== */

test('43 one enrollment per (teacher, student) is guaranteed by a UNIQUE key', () => {
  assert.match(schemaSource, /UNIQUE KEY[^\n]*teacher_id[^\n]*student_id/i);
  assert.match(migrationSource, /UNIQUE/i);
  assert.match(migrationSource, /student_enrollments/);
});

test('44 the migration only ADDs nullable columns and indexes (non-destructive)', () => {
  assert.ok(!/DROP\s+TABLE/i.test(migrationCode));
  assert.ok(!/DROP\s+COLUMN/i.test(migrationCode));
  assert.ok(!/DELETE\s+FROM/i.test(migrationCode));
  assert.ok(!/TRUNCATE/i.test(migrationCode));
  assert.ok(!/RENAME/i.test(migrationCode));
  assert.match(migrationCode, /ADD COLUMN/i);
});

test('45 students keeps a single global identity keyed by student_code', () => {
  const table = schemaSource.slice(
    schemaSource.indexOf('CREATE TABLE IF NOT EXISTS `students`'),
    schemaSource.indexOf('CREATE TABLE IF NOT EXISTS `student_enrollments`')
  );
  assert.ok(table.length > 0, 'students table not found in schema.sql');
  assert.match(table, /`student_code` VARCHAR\(50\) NOT NULL UNIQUE/i);
  ['parent_user_id', 'gender', 'date_of_birth', 'address', 'notes']
    .forEach(column => assert.match(table, new RegExp('`' + column + '`')));
  // Every P1-K profile column is nullable — nothing is artificially mandatory.
  ['gender', 'date_of_birth', 'address', 'notes'].forEach(column => {
    assert.match(table, new RegExp('`' + column + '`[^\\n]*NULL'), column + ' must stay optional');
  });
});
