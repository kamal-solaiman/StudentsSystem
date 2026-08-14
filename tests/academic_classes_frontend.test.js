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

function loadApi(fetchImpl, pathname = '/110/teacher/classes') {
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

function loadModal() {
  const sandbox = { window: {} };
  vm.runInNewContext(read('assets/js/modal.js') + '\nthis.ModalClass = AppModal;', sandbox);
  return sandbox.ModalClass;
}

function loadTeacherHelpers() {
  const sandbox = { Object, String, Array, Number };
  vm.runInNewContext(read('assets/js/teacher.js') + `
    this.helpers = {
      getClassGradeOptions,
      getAcademicClassName,
      getAcademicClassParts,
      CLASS_STAGE_OPTIONS,
      CLASS_GRADE_OPTIONS,
      CLASS_ALLOWED_GRADES
    };`, sandbox);
  return sandbox.helpers;
}

async function captureApiCall(invoke, pathname = '/110/teacher/classes') {
  const calls = [];
  const { ApiClient } = loadApi(async (url, options) => {
    calls.push({ url, options });
    return response(200, '{"success":true,"classes":[]}');
  }, pathname);
  ApiClient.setCsrfToken('csrf-test');
  await invoke(ApiClient);
  return calls;
}

async function expectHttpError(status) {
  const { ApiClient } = loadApi(async () => response(
    status,
    JSON.stringify({ success: false, message: `safe-${status}` })
  ));
  await assert.rejects(ApiClient.request('teacher.php', 'GET'), error => {
    assert.equal(error.status, status);
    assert.equal(error.message, `safe-${status}`);
    assert.notEqual(error.isNetworkError, true);
    assert.equal(error.responseReceived, true);
    return true;
  });
}

function describeModalError(error) {
  return loadModal().prototype._describeError.call({}, error);
}

// The requested API/URL/error/UI/security matrix is deliberately represented
// as 39 individually named cases so the TAP output is an auditable result.

test('01 GET uses /110/api/teacher.php from a nested teacher route', async () => {
  const [call] = await captureApiCall(api => api.getTeacherData());
  assert.equal(call.url, '/110/api/teacher.php');
  assert.equal(call.options.method, 'GET');
});

test('02 create uses prefixed POST and the create_class envelope', async () => {
  const [call] = await captureApiCall(api => api.createClass({
    educational_stage: 'preparatory', grade: 'first', description: ''
  }));
  const body = JSON.parse(call.options.body);
  assert.equal(call.url, '/110/api/teacher.php');
  assert.equal(call.options.method, 'POST');
  assert.equal(body.action, 'create_class');
  assert.equal(body.payload.educational_stage, 'preparatory');
  assert.equal(body.payload.grade, 'first');
  assert.equal(body.payload.name, undefined);
  assert.equal(body.payload.teacher_id, undefined);
});

test('03 update uses prefixed POST and the update_class envelope', async () => {
  const [call] = await captureApiCall(api => api.updateClass({
    id: 7, educational_stage: 'secondary', grade: 'second', description: 'x'
  }));
  const body = JSON.parse(call.options.body);
  assert.equal(call.url, '/110/api/teacher.php');
  assert.equal(call.options.method, 'POST');
  assert.equal(body.action, 'update_class');
  assert.equal(body.payload.id, 7);
  assert.equal(body.payload.name, undefined);
  assert.equal(body.payload.teacher_id, undefined);
});

test('04 delete uses prefixed DELETE with an encoded class id', async () => {
  const [call] = await captureApiCall(api => api.deleteClass('7&entity=group'));
  assert.equal(call.url, '/110/api/teacher.php?entity=class&id=7%26entity%3Dgroup');
  assert.equal(call.options.method, 'DELETE');
});

test('05 a root deployment resolves to /api rather than /110/api', async () => {
  const [call] = await captureApiCall(api => api.getTeacherData(), '/teacher/classes');
  assert.equal(call.url, '/api/teacher.php');
});

test('06 every CRUD request preserves session cookies with credentials include', async () => {
  const calls = [];
  const { ApiClient } = loadApi(async (url, options) => {
    calls.push({ url, options });
    return response(200, '{"success":true}');
  });
  await ApiClient.getTeacherData();
  await ApiClient.createClass({ educational_stage: 'primary', grade: 'first' });
  await ApiClient.updateClass({ id: 1, educational_stage: 'primary', grade: 'second' });
  await ApiClient.deleteClass(1);
  assert.deepEqual(calls.map(call => call.options.credentials), ['include', 'include', 'include', 'include']);
});

test('07 state-changing JSON sends CSRF in header/body without mutating the caller payload', async () => {
  const payload = { action: 'create_class', payload: { educational_stage: 'primary', grade: 'first' } };
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

test('08 backend statically retains authentication, staff RBAC, and tenant scoping', () => {
  const php = read('api/teacher.php');
  assert.match(php, /AuthManager::requireRole\(\['super_admin', 'teacher', 'staff'\]\)/);
  assert.match(php, /AuthManager::requirePermission\('classes'\)/);
  assert.match(php, /\$teacherId = \(int\)\$user\['tenant_teacher_id'\]/);
  assert.match(php, /WHERE ac\.teacher_id = :tid/);
});

test('09 backend statically ignores client name/teacher_id and derives both authoritatively', () => {
  const php = read('api/teacher.php');
  const classBlock = php.slice(php.indexOf('$validateClassPayload'), php.indexOf('// Create Study Group'));
  assert.match(classBlock, /teacherAcademicClassName\(\$stage, \$grade\)/);
  assert.match(classBlock, /'tid' => \$teacherId/);
  assert.doesNotMatch(classBlock, /\$classPayload\['name'\]/);
  assert.doesNotMatch(classBlock, /\$classPayload\['teacher_id'\]/);
});

test('10 backend statically protects all four dependencies before delete', () => {
  const php = read('api/teacher.php');
  for (const table of ['study_groups', 'student_enrollments', 'exams', 'question_bank']) {
    assert.match(php, new RegExp(`SELECT COUNT\\(\\*\\) FROM ${table} WHERE class_id`));
  }
  assert.match(php, /LIMIT 1 FOR UPDATE/);
  assert.match(php, /\$idIsValid = is_string\(\$idRaw\).*ctype_digit\(\$idRaw\)/s);
  assert.match(php, /DELETE FROM academic_classes WHERE id = :id AND teacher_id = :tid/);
  assert.match(php, /\], 409\)/);
});

test('11 HTTP 400 retains status and is not a network failure', () => expectHttpError(400));
test('12 HTTP 401 retains status, is not network, and clears stale CSRF state', async () => {
  const { ApiClient, sessionStorage } = loadApi(async () => response(
    401, JSON.stringify({ success: false, message: 'safe-401' })
  ));
  ApiClient.setCsrfToken('stale');
  await assert.rejects(ApiClient.request('teacher.php', 'GET'), error => {
    assert.equal(error.status, 401);
    assert.notEqual(error.isNetworkError, true);
    return true;
  });
  assert.equal(ApiClient.getCsrfToken(), '');
  assert.equal(sessionStorage.getItem('csrf_token'), null);
});
test('13 HTTP 403 retains status and is not a network failure', () => expectHttpError(403));
test('14 HTTP 404 retains status and is not a network failure', () => expectHttpError(404));
test('15 HTTP 409 retains status and is not a network failure', () => expectHttpError(409));
test('16 HTTP 429 retains status and is not a network failure', () => expectHttpError(429));
test('17 HTTP 500 retains status and is not a network failure', () => expectHttpError(500));

test('18 non-JSON HTTP 500 retains HTTP classification', async () => {
  const { ApiClient } = loadApi(async () => response(500, '<html>PHP/Apache error</html>'));
  await assert.rejects(ApiClient.request('teacher.php', 'POST', {}), error => {
    assert.equal(error.status, 500);
    assert.equal(error.code, 'INVALID_JSON_RESPONSE');
    assert.equal(error.responseReceived, true);
    assert.notEqual(error.isNetworkError, true);
    return true;
  });
});

test('19 malformed JSON on HTTP 200 is an application response error, not a network failure', async () => {
  const { ApiClient } = loadApi(async () => response(200, '{broken'));
  await assert.rejects(ApiClient.request('teacher.php', 'GET'), error => {
    assert.equal(error.status, 200);
    assert.equal(error.code, 'INVALID_JSON_RESPONSE');
    assert.notEqual(error.isNetworkError, true);
    return true;
  });
});

test('20 an empty successful body is accepted', async () => {
  const { ApiClient } = loadApi(async () => response(204, ''));
  const data = await ApiClient.request('teacher.php', 'GET');
  assert.equal(Object.keys(data).length, 0);
});

test('21 only a rejected fetch is marked as a network failure', async () => {
  const { ApiClient } = loadApi(async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(ApiClient.request('teacher.php', 'GET'), error => {
    assert.equal(error.isNetworkError, true);
    assert.equal(error.name, 'NetworkError');
    assert.equal(error.status, undefined);
    return true;
  });
});

test('22 a body-stream transport failure is marked network while retaining received status', async () => {
  const { ApiClient } = loadApi(async () => ({
    ok: true,
    status: 200,
    async text() { throw new TypeError('terminated'); }
  }));
  await assert.rejects(ApiClient.request('teacher.php', 'GET'), error => {
    assert.equal(error.isNetworkError, true);
    assert.equal(error.status, 200);
    assert.equal(error.responseReceived, true);
    return true;
  });
});

test('23 modal maps HTTP 400 to the safe backend validation message', () => {
  assert.equal(describeModalError({ status: 400, message: 'تفاصيل آمنة' }), 'تفاصيل آمنة');
});

test('24 modal maps HTTP 401 to session expiry', () => {
  assert.equal(describeModalError({ status: 401 }), 'انتهت جلسة تسجيل الدخول');
});

test('25 modal maps HTTP 403 to permission denial', () => {
  assert.equal(describeModalError({ status: 403 }), 'ليس لديك صلاحية');
});

test('26 modal maps HTTP 404 to missing resource', () => {
  assert.equal(describeModalError({ status: 404 }), 'المورد المطلوب غير موجود');
});

test('27 modal maps HTTP 409 to the safe dependency-conflict message', () => {
  assert.equal(describeModalError({ status: 409, message: 'توجد بيانات مرتبطة' }), 'توجد بيانات مرتبطة');
});

test('28 modal maps HTTP 429 to throttling', () => {
  assert.equal(describeModalError({ status: 429 }), 'محاولات كثيرة — حاول بعد قليل');
});

test('29 modal maps HTTP 500 to a generic server error', () => {
  assert.match(describeModalError({ status: 500 }), /خطأ في الخادم/);
});

test('30 modal uses the connection message only for the explicit network marker', () => {
  assert.equal(
    describeModalError({ isNetworkError: true }),
    'تعذر الاتصال بالخادم — تحقق من اتصالك بالإنترنت'
  );
});

test('31 a statusless parser/application exception is not called a network outage', () => {
  assert.equal(describeModalError(new SyntaxError('unexpected')), 'حدث خطأ غير متوقع');
});

test('32 primary stage offers grades first through sixth', () => {
  const helpers = loadTeacherHelpers();
  assert.deepEqual(
    Array.from(helpers.getClassGradeOptions('primary'), option => option.value),
    ['first', 'second', 'third', 'fourth', 'fifth', 'sixth']
  );
});

test('33 preparatory stage offers grades first through third only', () => {
  const helpers = loadTeacherHelpers();
  assert.deepEqual(
    Array.from(helpers.getClassGradeOptions('preparatory'), option => option.value),
    ['first', 'second', 'third']
  );
});

test('34 secondary stage offers grades first through third only', () => {
  const helpers = loadTeacherHelpers();
  assert.deepEqual(
    Array.from(helpers.getClassGradeOptions('secondary'), option => option.value),
    ['first', 'second', 'third']
  );
});

test('35 general stage retains grades first through sixth', () => {
  const helpers = loadTeacherHelpers();
  assert.deepEqual(
    Array.from(helpers.getClassGradeOptions('general'), option => option.value),
    ['first', 'second', 'third', 'fourth', 'fifth', 'sixth']
  );
});

test('36 canonical Arabic names are deterministic and invalid combinations are rejected', () => {
  const helpers = loadTeacherHelpers();
  assert.equal(helpers.getAcademicClassName('preparatory', 'first'), 'الصف الأول الإعدادي');
  assert.equal(helpers.getAcademicClassName('secondary', 'third'), 'الصف الثالث الثانوي');
  assert.equal(helpers.getAcademicClassName('general', 'sixth'), 'الصف السادس العام');
  assert.equal(helpers.getAcademicClassName('secondary', 'sixth'), '');
});

test('37 recognized legacy prep/sec levels prefill structured stage and grade', () => {
  const helpers = loadTeacherHelpers();
  const prep = helpers.getAcademicClassParts({ level: 'prep_1' });
  const secondary = helpers.getAcademicClassParts({ level: 'sec_3' });
  assert.equal(prep.educational_stage, 'preparatory');
  assert.equal(prep.grade, 'first');
  assert.equal(secondary.educational_stage, 'secondary');
  assert.equal(secondary.grade, 'third');
});

test('38 dependent select resets an invalid grade and preview writes textContent only', () => {
  const AppModal = loadModal();
  const helpers = loadTeacherHelpers();
  const stageControl = { value: 'secondary' };
  const gradeControl = { value: 'sixth' };
  const fakeModal = {
    fields: [
      { spec: { name: 'educational_stage', type: 'select', options: [] }, control: stageControl },
      {
        spec: {
          name: 'grade', type: 'select',
          options: values => helpers.getClassGradeOptions(values.educational_stage)
        },
        control: gradeControl
      }
    ],
    _collect() {
      return { educational_stage: stageControl.value, grade: gradeControl.value };
    },
    _getSelectOptions: AppModal.prototype._getSelectOptions,
    _setSelectOptions(control, options, preferred) {
      control.renderedOptions = Array.from(options, option => option.value);
      control.value = String(preferred);
    }
  };
  AppModal.prototype._refreshDynamicFields.call(fakeModal);
  assert.deepEqual(gradeControl.renderedOptions, ['first', 'second', 'third']);
  assert.equal(gradeControl.value, 'first');

  const preview = { textContent: '' };
  AppModal.prototype._updatePreview.call({
    previewValue: preview,
    options: { preview: { render: () => '<img src=x onerror=alert(1)>' } },
    _collect: () => ({})
  });
  assert.equal(preview.textContent, '<img src=x onerror=alert(1)>');
  assert.doesNotMatch(AppModal.prototype._updatePreview.toString(), /innerHTML/);
});

test('39 AppModal prevents a second submit while the first is pending', async () => {
  const AppModal = loadModal();
  let submitCount = 0;
  let resolveSubmit;
  const pending = new Promise(resolve => { resolveSubmit = resolve; });
  const fakeModal = {
    busy: false,
    closed: false,
    _validate: () => ({ ok: true, values: { grade: 'first' } }),
    _showError() {},
    submitBtn: { disabled: false, setAttribute() {}, removeAttribute() {} },
    cancelBtn: { disabled: false },
    submitBtnLabel: { textContent: '' },
    options: {
      submitLabel: 'حفظ',
      loadingLabel: 'جارٍ الحفظ...',
      async onSubmit() {
        submitCount += 1;
        await pending;
      }
    },
    close() { this.closed = true; }
  };

  const first = AppModal.prototype._submit.call(fakeModal);
  const second = AppModal.prototype._submit.call(fakeModal);
  assert.equal(submitCount, 1);
  assert.equal(fakeModal.submitBtn.disabled, true);
  resolveSubmit();
  await Promise.all([first, second]);
  assert.equal(fakeModal.closed, true);
});
