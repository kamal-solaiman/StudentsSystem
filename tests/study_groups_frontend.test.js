'use strict';

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

function loadApi(fetchImpl, pathname = '/110/teacher/groups') {
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

function loadGroupHelpers() {
  const sandbox = { Object, String, Array, Number };
  vm.runInNewContext(read('assets/js/teacher.js') + `
    this.helpers = {
      buildGroupClassTime,
      parseGroupClassTime,
      formatGroupClassTime,
      normalizeStudyDays,
      STUDY_DAY_OPTIONS,
      STUDY_DAY_VALUES,
      GROUP_PAYMENT_OPTIONS,
      GROUP_HOUR_OPTIONS,
      GROUP_MINUTE_OPTIONS,
      GROUP_PERIOD_OPTIONS,
      TeacherController
    };`, sandbox);
  return sandbox.helpers;
}

// Values created inside the vm sandbox carry the sandbox realm's prototypes;
// normalize them before structural comparison with host-realm literals.
function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

async function captureApiCall(invoke, pathname = '/110/teacher/groups') {
  const calls = [];
  const { ApiClient } = loadApi(async (url, options) => {
    calls.push({ url, options });
    return response(200, '{"success":true}');
  }, pathname);
  ApiClient.setCsrfToken('csrf-test');
  await invoke(ApiClient);
  return calls;
}

// ---------------------------------------------------------------
// ApiClient wiring
// ---------------------------------------------------------------

test('01 createGroup uses prefixed POST and the create_group envelope', async () => {
  const [call] = await captureApiCall(api => api.createGroup({
    name: 'مجموعة الفيزياء',
    class_id: 3,
    study_days: ['الأحد', 'الثلاثاء'],
    class_time: '17:00',
    shift: 'evening',
    price: 350,
    payment_scheme: 'monthly'
  }));
  const body = JSON.parse(call.options.body);
  assert.equal(call.url, '/110/api/teacher.php');
  assert.equal(call.options.method, 'POST');
  assert.equal(body.action, 'create_group');
  assert.equal(body.payload.name, 'مجموعة الفيزياء');
  assert.equal(body.payload.class_id, 3);
  assert.deepEqual(body.payload.study_days, ['الأحد', 'الثلاثاء']);
  assert.equal(body.payload.class_time, '17:00');
  assert.equal(body.payload.teacher_id, undefined);
});

test('02 updateGroup uses prefixed POST and the update_group envelope', async () => {
  const [call] = await captureApiCall(api => api.updateGroup({
    id: 7,
    name: 'مجموعة معدلة',
    class_id: 2,
    study_days: ['السبت'],
    class_time: '10:00',
    shift: 'morning',
    price: 60,
    payment_scheme: 'per_session'
  }));
  const body = JSON.parse(call.options.body);
  assert.equal(call.url, '/110/api/teacher.php');
  assert.equal(call.options.method, 'POST');
  assert.equal(body.action, 'update_group');
  assert.equal(body.payload.id, 7);
  assert.equal(body.payload.teacher_id, undefined);
});

test('03 deleteGroup uses prefixed DELETE with an encoded group id', async () => {
  const [call] = await captureApiCall(api => api.deleteGroup('7&entity=class'));
  assert.equal(call.url, '/110/api/teacher.php?entity=group&id=7%26entity%3Dclass');
  assert.equal(call.options.method, 'DELETE');
});

test('04 a root deployment resolves group delete to /api rather than /110/api', async () => {
  const [call] = await captureApiCall(api => api.deleteGroup(9), '/teacher/groups');
  assert.equal(call.url, '/api/teacher.php?entity=group&id=9');
});

test('05 every group CRUD request preserves session cookies with credentials include', async () => {
  const calls = [];
  const { ApiClient } = loadApi(async (url, options) => {
    calls.push({ url, options });
    return response(200, '{"success":true}');
  });
  await ApiClient.createGroup({ name: 'a', class_id: 1 });
  await ApiClient.updateGroup({ id: 1, name: 'b', class_id: 1 });
  await ApiClient.deleteGroup(1);
  assert.deepEqual(calls.map(call => call.options.credentials), ['include', 'include', 'include']);
});

test('06 group create sends CSRF in header/body without mutating the caller payload', async () => {
  const payload = { action: 'create_group', payload: { name: 'x', class_id: 1 } };
  let call;
  const { ApiClient } = loadApi(async (url, options) => {
    call = { url, options };
    return response(200, '{"success":true}');
  });
  ApiClient.setCsrfToken('csrf-test');
  await ApiClient.request('teacher.php', 'POST', payload);
  assert.equal(call.options.headers['X-CSRF-Token'], 'csrf-test');
  assert.equal(JSON.parse(call.options.body).csrf_token, 'csrf-test');
  assert.equal(payload.csrf_token, undefined);
});

test('07 group delete sends the CSRF header (no JSON body for DELETE)', async () => {
  let call;
  const { ApiClient } = loadApi(async (url, options) => {
    call = { url, options };
    return response(200, '{"success":true}');
  });
  ApiClient.setCsrfToken('csrf-delete');
  await ApiClient.deleteGroup(4);
  assert.equal(call.options.headers['X-CSRF-Token'], 'csrf-delete');
  assert.equal(call.options.body, undefined);
});

// ---------------------------------------------------------------
// Time / day helpers
// ---------------------------------------------------------------

test('08 buildGroupClassTime stores canonical 24h HH:MM (never Arabic strings)', () => {
  const helpers = loadGroupHelpers();
  assert.equal(helpers.buildGroupClassTime(5, 0, 'evening'), '17:00');
  assert.equal(helpers.buildGroupClassTime(10, 30, 'morning'), '10:30');
  assert.equal(helpers.buildGroupClassTime(12, 45, 'evening'), '12:45');
  assert.equal(helpers.buildGroupClassTime(12, 5, 'morning'), '00:05');
  assert.equal(helpers.buildGroupClassTime(1, 59, 'morning'), '01:59');
});

test('09 formatGroupClassTime renders canonical HH:MM as 12h Arabic', () => {
  const helpers = loadGroupHelpers();
  assert.equal(helpers.formatGroupClassTime('17:00'), '05:00 مساءً');
  assert.equal(helpers.formatGroupClassTime('10:00'), '10:00 صباحاً');
  assert.equal(helpers.formatGroupClassTime('00:30'), '12:30 صباحاً');
  assert.equal(helpers.formatGroupClassTime('12:30'), '12:30 مساءً');
  assert.equal(helpers.formatGroupClassTime(''), '—');
});

test('10 legacy Arabic class_time strings pass through unchanged', () => {
  const helpers = loadGroupHelpers();
  assert.equal(helpers.formatGroupClassTime('05:00 مساءً'), '05:00 مساءً');
  assert.equal(helpers.formatGroupClassTime('10:00 صباحاً'), '10:00 صباحاً');
});

test('11 parseGroupClassTime converts canonical 24h back to hour/minute/period', () => {
  const helpers = loadGroupHelpers();
  assert.deepEqual(toPlain(helpers.parseGroupClassTime('17:00', 'evening')),
    { hour: '05', minute: '00', period: 'evening' });
  assert.deepEqual(toPlain(helpers.parseGroupClassTime('10:30', 'morning')),
    { hour: '10', minute: '30', period: 'morning' });
  assert.deepEqual(toPlain(helpers.parseGroupClassTime('00:05', 'evening')),
    { hour: '12', minute: '05', period: 'morning' });
});

test('12 parseGroupClassTime reads legacy Arabic display strings', () => {
  const helpers = loadGroupHelpers();
  assert.deepEqual(toPlain(helpers.parseGroupClassTime('05:00 مساءً', 'evening')),
    { hour: '05', minute: '00', period: 'evening' });
  assert.deepEqual(toPlain(helpers.parseGroupClassTime('10:00 صباحاً', 'morning')),
    { hour: '10', minute: '00', period: 'morning' });
});

test('13 parseGroupClassTime falls back to 05:00 and the stored shift for unknown formats', () => {
  const helpers = loadGroupHelpers();
  assert.deepEqual(toPlain(helpers.parseGroupClassTime('مجهول', 'morning')),
    { hour: '05', minute: '00', period: 'morning' });
  assert.deepEqual(toPlain(helpers.parseGroupClassTime('', 'evening')),
    { hour: '05', minute: '00', period: 'evening' });
});

test('14 normalizeStudyDays dedupes, keeps canonical week order and drops invalid days', () => {
  const helpers = loadGroupHelpers();
  assert.deepEqual(
    toPlain(helpers.normalizeStudyDays(['الأربعاء', 'السبت', 'الأربعاء', 'x', 42])),
    ['السبت', 'الأربعاء']
  );
  assert.deepEqual(toPlain(helpers.normalizeStudyDays([])), []);
  assert.deepEqual(toPlain(helpers.normalizeStudyDays('not-an-array')), []);
  assert.deepEqual(toPlain(helpers.normalizeStudyDays(['الجمعة', 'السبت'])), ['السبت', 'الجمعة']);
});

test('15 collectGroupPayload rejects an empty day selection with a validation error', () => {
  const helpers = loadGroupHelpers();
  assert.throws(
    () => helpers.TeacherController.prototype.collectGroupPayload.call(
      {},
      {
        name: 'مجموعة', class_id: '1', study_days: [],
        hour: '05', minute: '00', period: 'evening',
        price: 100, payment_scheme: 'monthly'
      }
    ),
    error => error.status === 400 && /يوم دراسة/.test(error.message)
  );
});

test('16 collectGroupPayload builds the canonical create payload', () => {
  const helpers = loadGroupHelpers();
  const payload = helpers.TeacherController.prototype.collectGroupPayload.call(
    {},
    {
      name: '  مجموعة الأحد  ', class_id: '3',
      study_days: ['الثلاثاء', 'الأحد'],
      hour: '05', minute: '30', period: 'evening',
      price: 350, payment_scheme: 'monthly'
    }
  );
  assert.deepEqual(toPlain(payload), {
    class_id: 3,
    name: 'مجموعة الأحد',
    study_days: ['الأحد', 'الثلاثاء'],
    class_time: '17:30',
    shift: 'evening',
    price: 350,
    payment_scheme: 'monthly'
  });
});

// ---------------------------------------------------------------
// Groups tab rendering behavior
// ---------------------------------------------------------------

function renderGroupsFixture(data) {
  const helpers = loadGroupHelpers();
  return helpers.TeacherController.prototype.renderGroups.call({
    data,
    renderEmptyRow: (colspan, message) =>
      `<tr><td colspan="${colspan}">${message}</td></tr>`
  });
}

test('17 the groups table shows every required column and no internal ids', () => {
  const html = renderGroupsFixture({
    classes: [{ id: 1, name: 'الصف الثالث الثانوي' }],
    groups: [{
      id: 9,
      name: 'مجموعة الأحد والثلاثاء',
      class_name: 'الصف الثالث الثانوي',
      study_days: ['الأحد', 'الثلاثاء'],
      class_time: '17:00',
      shift: 'evening',
      price: 350,
      payment_scheme: 'monthly',
      student_count: 4
    }]
  });
  assert.match(html, /اسم المجموعة/);
  assert.match(html, /الصف الدراسي/);
  assert.match(html, /أيام الدراسة/);
  assert.match(html, /موعد الحصة/);
  assert.match(html, /سعر الدرس/);
  assert.match(html, /نظام الدفع/);
  assert.match(html, /عدد الطلاب/);
  assert.match(html, /الإجراءات/);
  assert.match(html, /تعديل/);
  assert.match(html, /حذف/);
  assert.match(html, /مجموعة الأحد والثلاثاء/);
  assert.match(html, /الأحد، الثلاثاء/);
  assert.match(html, /05:00 مساءً/);
  assert.match(html, /شهري/);
  assert.match(html, />4<\/td>/); // student count cell
  // Group id 9 must never be rendered as visible text
  assert.doesNotMatch(html, />\s*9\s*</);
});

test('18 empty groups render "لا توجد مجموعات دراسية" plus an add CTA when classes exist', () => {
  const html = renderGroupsFixture({
    classes: [{ id: 1, name: 'الصف الأول الإعدادي' }],
    groups: []
  });
  assert.match(html, /لا توجد مجموعات دراسية/);
  assert.match(html, /\+ إضافة مجموعة/);
  assert.doesNotMatch(html, /يجب إضافة صف دراسي أولاً/);
});

test('19 with no academic classes the tab shows the classes-first message, never a group form', () => {
  const html = renderGroupsFixture({ classes: [], groups: [] });
  assert.match(html, /يجب إضافة صف دراسي أولاً قبل إنشاء مجموعة\./);
  assert.match(html, /إضافة صف دراسي/);
  assert.doesNotMatch(html, /open-group-modal/);
});

test('20 delete confirmation asks "هل أنت متأكد من حذف هذه المجموعة؟"', () => {
  const source = read('assets/js/teacher.js');
  assert.match(source, /هل أنت متأكد من حذف هذه المجموعة؟/);
  assert.match(source, /confirmDeleteGroup\(groupId\)/);
  // The delete flow refreshes data in place — never a full page reload.
  assert.match(source, /ApiClient\.deleteGroup\(groupId\)/);
  assert.match(source, /await this\.refreshGroups\(\)/);
});

test('21 group modals reuse AppModal, keep "إلغاء" and a busy state, and show Arabic success messages', () => {
  const source = read('assets/js/teacher.js');
  assert.match(source, /AppModal\.open\(\{\s*\n\s*title: 'إضافة مجموعة دراسية جديدة'/);
  assert.match(source, /submitLabel: 'حفظ المجموعة'/);
  assert.match(source, /cancelLabel: 'إلغاء'/);
  assert.match(source, /loadingLabel: 'جارٍ الحفظ\.\.\.'/);
  assert.match(source, /تم إضافة المجموعة الدراسية بنجاح/);
  assert.match(source, /تم تحديث المجموعة الدراسية بنجاح/);
  assert.match(source, /تم حذف المجموعة بنجاح/);
});

// ---------------------------------------------------------------
// Backend static verification (no PHP/MySQL runtime in this sandbox)
// ---------------------------------------------------------------

test('22 backend keeps teacher identity exclusively on the session tenant', () => {
  const php = read('api/teacher.php');
  assert.match(php, /\$teacherId = \(int\)\$user\['tenant_teacher_id'\]/);
  const validator = php.slice(php.indexOf('function teacherValidateStudyGroupPayload'), php.indexOf('Helper::handleCorsOptions'));
  assert.doesNotMatch(validator, /\$payload\['teacher_id'\]/);
});

test('23 backend validates class ownership before create/update (never another teacher\'s class)', () => {
  const php = read('api/teacher.php');
  assert.match(php, /SELECT id FROM academic_classes WHERE id = :cid AND teacher_id = :tid LIMIT 1/);
  assert.match(php, /sendNotFound\('الصف الدراسي غير موجود'\)/);
  assert.match(php, /sendForbidden\('Access denied'\)/);
});

test('24 backend update_group distinguishes 404 from cross-tenant 403 and scopes the UPDATE by owner', () => {
  const php = read('api/teacher.php');
  const updateBlock = php.slice(php.indexOf("if ($action === 'update_group')"), php.indexOf('// Create New Student'));
  assert.match(updateBlock, /SELECT id FROM study_groups WHERE id = :gid LIMIT 1/);
  assert.match(updateBlock, /sendNotFound\('المجموعة غير موجودة'\)/);
  assert.match(updateBlock, /SELECT id FROM study_groups WHERE id = :gid AND teacher_id = :tid LIMIT 1/);
  assert.match(updateBlock, /UPDATE study_groups/);
  assert.match(updateBlock, /WHERE id = :gid AND teacher_id = :tid/);
});

test('25 backend group delete locks the row, checks all five dependencies, and refuses with 409', () => {
  const php = read('api/teacher.php');
  const deleteBlock = php.slice(php.indexOf("if ($entity === 'group' && $id > 0)"), php.indexOf("Helper::sendJson(['success' => false, 'error' => 'فشل الحذف"));
  for (const table of ['student_enrollments', 'attendance_records', 'exams', 'homeworks', 'lesson_videos']) {
    assert.match(deleteBlock, new RegExp(`SELECT COUNT\\(\\*\\) FROM ${table} WHERE group_id`));
  }
  assert.match(deleteBlock, /LIMIT 1 FOR UPDATE/);
  assert.match(deleteBlock, /sendNotFound\('المجموعة غير موجودة'\)/);
  assert.match(deleteBlock, /sendForbidden\('Access denied'\)/);
  assert.match(deleteBlock, /لا يمكن حذف المجموعة لارتباطها ببيانات أخرى/);
  assert.match(deleteBlock, /DELETE FROM study_groups WHERE id = :id AND teacher_id = :tid/);
  assert.match(deleteBlock, /409/);
});

test('26 backend enforces the schema ENUM values for shift and payment scheme', () => {
  const php = read('api/teacher.php');
  assert.match(php, /in_array\(\$shiftRaw, \['morning', 'evening'\], true\)/);
  assert.match(php, /in_array\(\$schemeRaw, \['monthly', 'per_session'\], true\)/);
});

test('27 backend rejects negative and over-precision prices (DECIMAL(10,2))', () => {
  const php = read('api/teacher.php');
  assert.match(php, /سعر الدرس لا يمكن أن يكون سالبًا/);
  assert.match(php, /سعر الدرس يجب ألا يتضمن أكثر من رقمين عشريين/);
  assert.match(php, /round\(\$price, 2\) !== \$price/);
  assert.match(php, /\$price > 99999999\.99/);
});

test('28 backend requires a valid name, at least one canonical day, and canonical HH:MM time', () => {
  const php = read('api/teacher.php');
  assert.match(php, /اسم المجموعة مطلوب/);
  assert.match(php, /الحد الأقصى 150 حرفاً/);
  assert.match(php, /يرجى اختيار يوم دراسة واحد على الأقل/);
  assert.match(php, /أيام الدراسة غير صالحة/);
  assert.match(php, /\/\^\(\?:\[01\]\\d\|2\[0-3\]\):\[0-5\]\\d\$\//);
  assert.match(php, /موعد الحصة غير صالح/);
  assert.match(php, /sprintf\('%02d:%02d'/);
});

test('29 backend keeps the Arabic week catalog as the only accepted day representation', () => {
  const php = read('api/teacher.php');
  assert.match(php, /return \['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'\];/);
  assert.match(php, /json_encode\(\$group\['study_days'\], JSON_UNESCAPED_UNICODE\)/);
});

test('30 staff RBAC requires the existing "groups" permission for create/update/delete', () => {
  const php = read('api/teacher.php');
  assert.match(php, /\$action === 'create_group' \|\| \$action === 'update_group' \|\| \$action === 'delete-group'/);
  assert.match(php, /AuthManager::requirePermission\('groups'\)/);
  assert.match(php, /if \(\$entity === 'group'\) \{\s*\n\s*AuthManager::requirePermission\('groups'\);/);
});

test('31 the GET groups list is tenant-scoped and exposes a safe student count', () => {
  const php = read('api/teacher.php');
  assert.match(php, /SELECT COUNT\(\*\) FROM student_enrollments se\s+WHERE se\.group_id = sg\.id AND se\.teacher_id = sg\.teacher_id/);
  assert.match(php, /WHERE sg\.teacher_id = :tid/);
  assert.match(php, /'student_count' => \(int\)\$row\['student_count'\]/);
  assert.match(php, /ORDER BY sg\.id ASC/);
});

test('32 no group id is displayed as a column value in the groups list', () => {
  const source = read('assets/js/teacher.js');
  const renderBlock = source.slice(source.indexOf('renderGroups()'), source.indexOf('showGroupsMessage(message'));
  // ids appear only inside data-id attributes for the action buttons
  const columnCells = renderBlock
    .replace(/data-id="\$\{g\.id\}"/g, '')
    .replace(/data-action="[^"]+"/g, '');
  assert.doesNotMatch(columnCells, />\$\{g\.id\}</);
});
