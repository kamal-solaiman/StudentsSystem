/**
 * JavaScript Controller for the 9 Mandatory Teacher Dashboard Pages
 */

// Academic-class vocabulary mirrors api/teacher.php. `level` is retained in
// MySQL as the educational-stage storage column; `grade` is the only new field.
const CLASS_STAGE_OPTIONS = [
  { value: 'primary', label: 'ابتدائي' },
  { value: 'preparatory', label: 'إعدادي' },
  { value: 'secondary', label: 'ثانوي' },
  { value: 'general', label: 'عام' }
];
const CLASS_GRADE_OPTIONS = [
  { value: 'first', label: 'الأول' },
  { value: 'second', label: 'الثاني' },
  { value: 'third', label: 'الثالث' },
  { value: 'fourth', label: 'الرابع' },
  { value: 'fifth', label: 'الخامس' },
  { value: 'sixth', label: 'السادس' }
];
const CLASS_STAGE_LABELS = Object.fromEntries(CLASS_STAGE_OPTIONS.map(o => [o.value, o.label]));
const CLASS_GRADE_LABELS = Object.fromEntries(CLASS_GRADE_OPTIONS.map(o => [o.value, o.label]));
const CLASS_STAGE_ADJECTIVES = {
  primary: 'الابتدائي',
  preparatory: 'الإعدادي',
  secondary: 'الثانوي',
  general: 'العام'
};
const CLASS_ALLOWED_GRADES = {
  primary: ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'],
  preparatory: ['first', 'second', 'third'],
  secondary: ['first', 'second', 'third'],
  // The existing "عام" category is not tied to a three- or six-year cycle,
  // so it keeps the complete grade vocabulary instead of inventing a category.
  general: ['first', 'second', 'third', 'fourth', 'fifth', 'sixth']
};
const LEGACY_CLASS_LEVELS = {
  prep_1: { educational_stage: 'preparatory', grade: 'first' },
  prep_2: { educational_stage: 'preparatory', grade: 'second' },
  prep_3: { educational_stage: 'preparatory', grade: 'third' },
  sec_1: { educational_stage: 'secondary', grade: 'first' },
  sec_2: { educational_stage: 'secondary', grade: 'second' },
  sec_3: { educational_stage: 'secondary', grade: 'third' }
};

function getClassGradeOptions(educationalStage) {
  const allowed = CLASS_ALLOWED_GRADES[educationalStage] || [];
  return CLASS_GRADE_OPTIONS.filter(option => allowed.includes(option.value));
}

function getAcademicClassName(educationalStage, grade) {
  const allowed = CLASS_ALLOWED_GRADES[educationalStage] || [];
  const gradeLabel = CLASS_GRADE_LABELS[grade];
  const stageAdjective = CLASS_STAGE_ADJECTIVES[educationalStage];
  return allowed.includes(grade) && gradeLabel && stageAdjective
    ? `الصف ${gradeLabel} ${stageAdjective}`
    : '';
}

function getAcademicClassParts(cls) {
  const level = String((cls && (cls.educational_stage || cls.level)) || '');
  if (CLASS_ALLOWED_GRADES[level]) {
    return { educational_stage: level, grade: String((cls && cls.grade) || '') };
  }
  return LEGACY_CLASS_LEVELS[level] || { educational_stage: '', grade: '' };
}

/* ================================================================
 * P1-J: Study Groups vocabulary & time helpers.
 * The Arabic day list matches the backend catalog (api/teacher.php)
 * and the existing study_groups.study_days JSON convention.
 * class_time is stored canonically as 24h "HH:MM"; legacy rows may
 * still hold Arabic display strings, which pass through untouched.
 * ================================================================ */

const STUDY_DAY_OPTIONS = [
  { value: 'السبت', label: 'السبت' },
  { value: 'الأحد', label: 'الأحد' },
  { value: 'الإثنين', label: 'الإثنين' },
  { value: 'الثلاثاء', label: 'الثلاثاء' },
  { value: 'الأربعاء', label: 'الأربعاء' },
  { value: 'الخميس', label: 'الخميس' },
  { value: 'الجمعة', label: 'الجمعة' }
];
const STUDY_DAY_VALUES = STUDY_DAY_OPTIONS.map(option => option.value);

// Database ENUM('monthly','per_session') — the ONLY values the schema allows.
const GROUP_PAYMENT_OPTIONS = [
  { value: 'monthly', label: 'شهري' },
  { value: 'per_session', label: 'لكل حصة' }
];
const GROUP_PAYMENT_LABELS = Object.fromEntries(
  GROUP_PAYMENT_OPTIONS.map(option => [option.value, option.label])
);

const GROUP_HOUR_OPTIONS = Array.from({ length: 12 }, (_, index) => {
  const hour = String(index + 1).padStart(2, '0');
  return { value: hour, label: hour };
});
const GROUP_MINUTE_OPTIONS = Array.from({ length: 12 }, (_, index) => {
  const minute = String(index * 5).padStart(2, '0');
  return { value: minute, label: minute };
});
const GROUP_PERIOD_OPTIONS = [
  { value: 'morning', label: 'صباحاً' },
  { value: 'evening', label: 'مساءً' }
];

/**
 * Canonical 24h "HH:MM" from the modal's hour (1-12) / minute / period
 * selection — no localized strings ever reach the database.
 */
function buildGroupClassTime(hour, minute, period) {
  let h = Number(hour);
  const m = Number(minute);
  if (!Number.isInteger(h) || h < 1 || h > 12) h = 5;
  if (!Number.isInteger(m) || m < 0 || m > 59) m = 0;
  if (period === 'evening') {
    if (h !== 12) h += 12;
  } else if (h === 12) {
    h = 0;
  }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Pre-fill values for the edit modal from a stored group.
 * Accepts the canonical "HH:MM" (24h), legacy Arabic strings such as
 * "05:00 مساءً", and falls back to 05:00 + the stored shift.
 */
function parseGroupClassTime(classTime, shift) {
  const raw = String(classTime || '').trim();
  const fallbackPeriod = String(shift || '') === 'morning' ? 'morning' : 'evening';
  const toTwelveHour = (h) => {
    if (h === 0) return { hour: '12', period: 'morning' };
    if (h > 12) return { hour: String(h - 12).padStart(2, '0'), period: 'evening' };
    return { hour: String(h).padStart(2, '0'), period: h === 12 ? 'evening' : 'morning' };
  };

  const legacy = raw.match(/^(\d{1,2}):(\d{2})\s*(صباحاً|مساءً|ص|م)?\s*$/);
  if (legacy) {
    let h = Number(legacy[1]);
    const suffix = legacy[3] ? String(legacy[3]).trim() : '';
    let period = fallbackPeriod;
    if (suffix) {
      period = suffix === 'ص' || suffix.startsWith('ص') ? 'morning' : 'evening';
    } else {
      const converted = toTwelveHour(h);
      return { hour: converted.hour, minute: legacy[2], period: converted.period };
    }
    if (period === 'evening' && h !== 12) h += 12;
    if (period === 'morning' && h === 12) h = 0;
    const converted = toTwelveHour(h);
    return { hour: converted.hour, minute: legacy[2], period };
  }

  const canonical = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (canonical) {
    const converted = toTwelveHour(Number(canonical[1]));
    return { hour: converted.hour, minute: canonical[2], period: converted.period };
  }

  return { hour: '05', minute: '00', period: fallbackPeriod };
}

/**
 * Arabic display of a stored class_time for the groups table.
 * Canonical "HH:MM" is rendered as 12h + صباحاً/مساءً; legacy Arabic
 * display strings (e.g. "05:00 مساءً") pass through unchanged.
 */
function formatGroupClassTime(classTime) {
  const raw = String(classTime || '').trim();
  if (raw === '') return '—';
  if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(raw)) {
    return raw; // legacy display string — show as stored
  }
  const hour24 = Number(raw.split(':')[0]);
  const minute = raw.split(':')[1];
  const period = hour24 >= 12 ? 'مساءً' : 'صباحاً';
  const hour12 = hour24 === 0 ? 12 : (hour24 > 12 ? hour24 - 12 : hour24);
  return `${String(hour12).padStart(2, '0')}:${minute} ${period}`;
}

/**
 * P1-J-FIX: display of the lesson time range for the groups table.
 * "من HH:MM إلى HH:MM" (12h Arabic) when a canonical end_time exists;
 * legacy rows without end_time keep showing only the start time.
 */
function formatGroupTimeRange(group) {
  const start = formatGroupClassTime(group && group.class_time);
  const end = String((group && group.end_time) || '').trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(end)) {
    return start;
  }
  return `${start} — ${formatGroupClassTime(end)}`;
}

/**
 * P1-J-FIX: minutes-since-midnight for a canonical "HH:MM" string, or NaN
 * for anything else. Used only to compare start/end client-side (UX);
 * the backend re-validates the range authoritatively.
 */
function groupTimeToMinutes(time) {
  const match = String(time || '').trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * P1-J-FIX: default end-of-lesson prefill = start + 1 hour (wrapping at
 * midnight is irrelevant for a prefill; the teacher can change it and the
 * backend enforces end > start). Input/output: {hour, minute, period}.
 */
function defaultGroupEndParts(startParts) {
  const start24 = buildGroupClassTime(startParts.hour, startParts.minute, startParts.period);
  const startMinutes = groupTimeToMinutes(start24);
  if (!Number.isFinite(startMinutes)) {
    return { hour: '06', minute: '00', period: 'evening' };
  }
  const endMinutes = Math.min(startMinutes + 60, 23 * 60 + 55);
  const h24 = Math.floor(endMinutes / 60);
  const m = endMinutes % 60;
  return parseGroupClassTime(
    `${String(h24).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
    startParts.period
  );
}

/**
 * Deduplicate client-selected days and order them by the canonical Arabic
 * week. Invalid values never reach the payload (backend is authoritative).
 */
function normalizeStudyDays(days) {
  const list = Array.isArray(days) ? days.map(day => String(day).trim()) : [];
  return STUDY_DAY_VALUES.filter(day => list.includes(day));
}

/** Tag an error as a validation failure so AppModal surfaces the Arabic text. */
function groupValidationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

/* ================================================================
 * P1-K: Students module vocabulary & helpers.
 *
 * The student identity is GLOBAL: one record per platform, keyed by the
 * authoritative business id `student_code`. The teacher dashboard never
 * duplicates a student — it only manages THIS teacher's link (enrollment)
 * to an existing global student. Every rule below is duplicated
 * server-side in api/teacher.php; the client-side copies are UX only.
 * ================================================================ */

// students.gender is ENUM('male','female') and NULLABLE — "غير محدد" maps to
// an empty value, so the field is never artificially mandatory.
const STUDENT_GENDER_OPTIONS = [
  { value: '', label: 'غير محدد' },
  { value: 'male', label: 'ذكر' },
  { value: 'female', label: 'أنثى' }
];

// Documented default password for teacher-created student accounts. It is
// only DISPLAYED here; the hash is generated server-side and an existing
// student's credentials are never overwritten when another teacher links them.
const STUDENT_DEFAULT_PASSWORD = '00000000';

// Search result states returned by the backend `search_students` action.
const STUDENT_LINK_STATE_LABELS = {
  linked: 'الطالب مضاف بالفعل',
  hidden: 'الطالب مسجل بالفعل',
  unlinked: 'الطالب مسجل بالفعل'
};

/** Escape untrusted student text before it is interpolated into innerHTML. */
function escapeStudentText(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Validation failure surfaced by AppModal exactly like a 400 from the API. */
function studentValidationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

/** Groups belonging to one academic class (the class is a hard filter). */
function studentGroupsForClass(groups, classId) {
  const wanted = Number(classId);
  return (Array.isArray(groups) ? groups : []).filter(g => Number(g.class_id) === wanted);
}

/**
 * Search payload. The academic class must be chosen first (the backend
 * re-applies it as a hard filter and ignores anything else the client sends).
 */
function buildStudentSearchPayload(values) {
  const classId = Number(values.class_id);
  const groupId = Number(values.group_id);
  const query = String(values.query || '').trim();
  if (!Number.isInteger(classId) || classId <= 0) {
    throw studentValidationError('يجب اختيار الصف الدراسي أولاً');
  }
  if (!Number.isInteger(groupId) || groupId <= 0) {
    throw studentValidationError('يجب اختيار المجموعة أولاً');
  }
  if (query.length < 2) {
    throw studentValidationError('أدخل حرفين على الأقل للبحث');
  }
  if (query.length > 100) {
    throw studentValidationError('نص البحث طويل جداً');
  }
  // teacher_id is NEVER sent: the backend derives the tenant from the session.
  return { class_id: classId, group_id: groupId, query };
}

/**
 * New-student payload. Only the name is required (students.name is NOT NULL);
 * every other profile field is optional and omitted when left blank.
 */
function collectStudentPayload(values) {
  const name = String(values.name || '').trim();
  if (name === '') {
    throw studentValidationError('اسم الطالب مطلوب');
  }
  const classId = Number(values.class_id);
  const groupId = Number(values.group_id);
  if (!Number.isInteger(classId) || classId <= 0) {
    throw studentValidationError('يجب اختيار الصف الدراسي أولاً');
  }
  if (!Number.isInteger(groupId) || groupId <= 0) {
    throw studentValidationError('يجب اختيار المجموعة أولاً');
  }
  return {
    class_id: classId,
    group_id: groupId,
    name,
    student_code: String(values.student_code || '').trim(),
    email: String(values.email || '').trim(),
    phone: String(values.phone || '').trim(),
    parent_phone: String(values.parent_phone || '').trim(),
    gender: String(values.gender || '').trim(),
    date_of_birth: String(values.date_of_birth || '').trim(),
    address: String(values.address || '').trim(),
    notes: String(values.notes || '').trim()
  };
}

class TeacherController {
  constructor(containerElement, data, onRefreshCallback) {
    this.container = containerElement;
    this.data = data;
    this.onRefresh = onRefreshCallback;
    this.activeTab = 'overview';
    this.examSubTab = 'questions';
    this.attendanceMethod = 'dynamic_qr';

    // P1-I: inline message banner for the Academic Classes tab.
    this.classesMessage = null;
    // P1-J: inline message banner for the Study Groups tab.
    this.groupsMessage = null;
    // P1-K: inline message banner + last server-side search for the Students tab.
    // `studentSearch` only ever holds what the SERVER returned for the current
    // class-scoped query — the browser never receives a platform-wide dump.
    this.studentsMessage = null;
    this.studentSearch = null;
    // P1-K-FIX: the open student QR card modal (so a rapid double-click never
    // stacks multiple backdrops). null when no card is open.
    this._studentQrCard = null;

    // P1-G: dynamic QR broadcast screen state. The token is signed server-side;
    // the frontend only displays it, counts down, and auto-refreshes. No HMAC,
    // secret, or validity decision ever exists in JavaScript.
    this.qrState = { status: 'idle', token: '', exp: 0, groupId: '', message: '' };
    this._qrTimer = null;
    this._qrPresentation = null;
    // P1-G async guard: monotonically increasing request sequence + the group
    // of the request currently in flight. A delayed response whose seq no
    // longer matches the latest generation is discarded, so a stale response
    // can never overwrite a newer group selection (A→B→C rapid switching).
    this._qrRequestSeq = 0;
    this._qrPendingGroup = '';

    // P1-E: independent async data states for the Reports & Exams tabs
    this.reportsState = 'idle'; // idle | loading | ready | error
    this.reportsData = null;
    this.reportsError = null;
    this.examsState = 'idle';   // idle | loading | ready | error
    this.examsData = null;
    this.examsError = null;
  }

  render() {
    if (this.activeTab !== 'attendance' || this.attendanceMethod !== 'dynamic_qr') {
      this.closeQrPresentation();
    }

    const teacher = this.data.teacher || {};
    const overview = this.data.overview || {};

    let html = `
      <!-- Teacher Header Banner -->
      <div class="profile-banner">
        <div class="profile-banner-header">
          <div style="display: flex; align-items: center; gap: 1rem;">
            <div style="width: 4rem; height: 4rem; border-radius: 1rem; background-color: #059669; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; font-weight: 900;">
              ${teacher.name ? teacher.name.charAt(2) : 'م'}
            </div>
            <div>
              <span class="badge badge-emerald">لوحة تحكم المدرس</span>
              <h2 style="font-size: 1.75rem; font-weight: 800; margin-top: 0.35rem;">${teacher.name} — ${teacher.subject}</h2>
              <p style="font-size: 0.8rem; color: #a7f3d0; margin-top: 0.2rem;">${teacher.center_name} • ${teacher.address}</p>
            </div>
          </div>

          <div class="banner-stats-box">
            <span style="display: block; font-size: 0.75rem; color: #a7f3d0;">قيمة الاشتراك الشهري (SaaS)</span>
            <span style="font-size: 1.25rem; font-weight: 800; color: #fff;">${Number(overview.subscription_monthly || 0).toLocaleString()} ج.م</span>
          </div>
        </div>

        <!-- 9 Mandatory Pages Tabs -->
        <div class="tabs-row">
          <button class="tab-btn ${this.activeTab === 'overview' ? 'active' : ''}" data-tab="overview">1. الرئيسية</button>
          <button class="tab-btn ${this.activeTab === 'classes' ? 'active' : ''}" data-tab="classes">2. الصفوف الدراسية</button>
          <button class="tab-btn ${this.activeTab === 'groups' ? 'active' : ''}" data-tab="groups">3. المجموعات</button>
          <button class="tab-btn ${this.activeTab === 'students' ? 'active' : ''}" data-tab="students">4. الطلاب</button>
          <button class="tab-btn ${this.activeTab === 'attendance' ? 'active' : ''}" data-tab="attendance">5. الحضور والغياب (3 طرق)</button>
          <button class="tab-btn ${this.activeTab === 'exams' ? 'active' : ''}" data-tab="exams">6. الامتحانات وبنك الأسئلة</button>
          <button class="tab-btn ${this.activeTab === 'reports' ? 'active' : ''}" data-tab="reports">7. التقارير (7 تقارير)</button>
          <button class="tab-btn ${this.activeTab === 'staff' ? 'active' : ''}" data-tab="staff">8. المستخدمون (مساعد/سكرتير)</button>
          <button class="tab-btn ${this.activeTab === 'settings' ? 'active' : ''}" data-tab="settings">9. الإعدادات</button>
        </div>
      </div>
    `;

    // Render Tab content
    if (this.activeTab === 'overview') {
      html += this.renderOverview();
    } else if (this.activeTab === 'classes') {
      html += this.renderClasses();
    } else if (this.activeTab === 'groups') {
      html += this.renderGroups();
    } else if (this.activeTab === 'students') {
      html += this.renderStudents();
    } else if (this.activeTab === 'attendance') {
      html += this.renderAttendance();
    } else if (this.activeTab === 'exams') {
      html += this.renderExams();
    } else if (this.activeTab === 'reports') {
      html += this.renderReports();
    } else if (this.activeTab === 'staff') {
      html += this.renderStaff();
    } else if (this.activeTab === 'settings') {
      html += this.renderSettings();
    }

    this.container.innerHTML = html;
    this.attachEventListeners();
  }

  renderOverview() {
    const ov = this.data.overview || {};
    return `
      <div class="grid-4">
        <div class="stat-card">
          <span class="stat-card-title">عدد الطلاب النشطين</span>
          <div class="stat-card-value">${ov.total_students || 0}</div>
          <div class="stat-card-desc">مسجلون في مجموعاتك</div>
        </div>
        <div class="stat-card">
          <span class="stat-card-title">عدد الصفوف</span>
          <div class="stat-card-value">${ov.total_classes || 0}</div>
          <div class="stat-card-desc">صفوف دراسية معزولة</div>
        </div>
        <div class="stat-card">
          <span class="stat-card-title">عدد المجموعات</span>
          <div class="stat-card-value">${ov.total_groups || 0}</div>
          <div class="stat-card-desc">صباحي / مسائي</div>
        </div>
        <div class="stat-card">
          <span class="stat-card-title">حضور اليوم</span>
          <div class="stat-card-value" style="color: #059669;">${ov.today_attendance || 0}</div>
          <div class="stat-card-desc">سجلات حضور مسجلة اليوم</div>
        </div>
        <div class="stat-card">
          <span class="stat-card-title">غياب اليوم</span>
          <div class="stat-card-value" style="color: #e11d48;">${ov.today_absence || 0}</div>
          <div class="stat-card-desc">بما في ذلك التأخير</div>
        </div>
        <div class="stat-card">
          <span class="stat-card-title">الامتحانات القادمة</span>
          <div class="stat-card-value">${ov.upcoming_exams_count || 0}</div>
          <div class="stat-card-desc">امتحانات مبرمجة في الجدول</div>
        </div>
      </div>
    `;
  }

  renderClasses() {
    const classes = this.data.classes || [];

    let listHtml = '';
    classes.forEach(c => {
      const parts = getAcademicClassParts(c);
      const stageLabel = CLASS_STAGE_LABELS[parts.educational_stage] || '—';
      const gradeLabel = CLASS_GRADE_LABELS[parts.grade] || '—';
      const canonicalName = getAcademicClassName(parts.educational_stage, parts.grade);
      listHtml += `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 1rem; font-weight: 800;">${canonicalName || c.name}</td>
          <td style="padding: 1rem;">${stageLabel}</td>
          <td style="padding: 1rem;">${gradeLabel}</td>
          <td style="padding: 1rem;">${c.description || '—'}</td>
          <td style="padding: 1rem; font-weight: 800; color: #059669;">${c.groups_count || 0} مجموعات</td>
          <td style="padding: 1rem;">
            <div style="display: flex; gap: 0.5rem;">
              <button class="btn btn-secondary btn-sm" data-action="edit-class" data-id="${c.id}">تعديل</button>
              <button class="btn btn-danger btn-sm" data-action="delete-class" data-id="${c.id}">حذف الصف</button>
            </div>
          </td>
        </tr>
      `;
    });

    // P1-F: Empty state (distinct from Loading / Error) with a clear CTA
    if (classes.length === 0) {
      listHtml = this.renderEmptyRow(6, 'لا يوجد صفوف دراسية');
    }

    // P1-I: inline success/error message banner (no page reload required)
    const messageBox = this.classesMessage ? `
      <div id="classes-action-message" style="margin: 1rem 1rem 0; padding: 0.75rem 1rem; border-radius: 0.5rem; font-size: 0.85rem; font-weight: 700; ${this.classesMessage.isError
        ? 'background:#fef2f2; color:#b91c1c; border:1px solid #fecdd3;'
        : 'background:#ecfdf5; color:#047857; border:1px solid #a7f3d0;'}">
        ${this.classesMessage.text}
      </div>
    ` : '';

    // P1-I: empty-state CTA so teachers can add their first class in-place
    const emptyCta = classes.length === 0 ? `
      <div style="text-align: center; padding: 0.25rem 0 1.5rem;">
        <button class="btn btn-primary" data-action="open-class-modal">+ إضافة صف دراسي</button>
      </div>
    ` : '';

    return `
      <div class="card-table-wrapper" style="margin-top: 1.5rem;">
        <div class="card-header">
          <div>
            <h3 style="font-weight: 800; font-size: 1.15rem;">الصفوف الدراسية (Academic Classes)</h3>
            <p style="font-size: 0.8rem; color: #64748b;">إضافة، تعديل، أو حذف صف مع عرض عدد المجموعات المرتبطة بالصف</p>
          </div>
          <button class="btn btn-primary" data-action="open-class-modal">+ إضافة صف دراسي</button>
        </div>
        ${messageBox}
        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th>اسم الصف الدراسي</th>
                <th>المرحلة التعليمية</th>
                <th>الصف الدراسي</th>
                <th>الوصف</th>
                <th>عدد المجموعات</th>
                <th>الإجراءات</th>
              </tr>
            </thead>
            <tbody>${listHtml}</tbody>
          </table>
        </div>
        ${emptyCta}
      </div>
    `;
  }

  /* ================================================================
   * P1-I: Academic Classes CRUD — add / edit / delete via the
   * existing central modal helper (AppModal). All authorization and
   * ownership (session tenant teacher_id) is enforced server-side;
   * client-side validation here is UX only.
   * ================================================================ */

  /** Show an inline success/error banner in the classes tab. */
  showClassesMessage(message, isError = false) {
    this.classesMessage = { text: message, isError: !!isError };
    if (this.activeTab === 'classes') this.render();
    // Auto-dismiss after 6s (DOM-only removal — no full re-render).
    setTimeout(() => {
      if (this.classesMessage && this.classesMessage.text === message) {
        this.classesMessage = null;
        const box = document.getElementById('classes-action-message');
        if (box && box.parentNode) box.parentNode.removeChild(box);
      }
    }, 6000);
  }

  /** Re-fetch the teacher dashboard and re-render (keeps counts in sync). */
  async refreshClasses() {
    const data = await ApiClient.getTeacherData();
    this.data = data;
    if (this.activeTab === 'classes') this.render();
  }

  classModalFields(educationalStage = 'primary', grade = 'first', description = '') {
    return [
      {
        name: 'educational_stage', label: 'المرحلة التعليمية', type: 'select', required: true,
        value: educationalStage, options: CLASS_STAGE_OPTIONS
      },
      {
        name: 'grade', label: 'الصف الدراسي', type: 'select', required: true,
        value: grade,
        options: values => getClassGradeOptions(values.educational_stage)
      },
      {
        name: 'description', label: 'الوصف (اختياري)', type: 'textarea', rows: 3,
        maxlength: 1000, value: description, placeholder: 'وصف مختصر للمنهج أو محتوى الصف'
      }
    ];
  }

  classNamePreview() {
    return {
      label: 'اسم الصف الدراسي (يُنشأ تلقائيًا)',
      render: values => getAcademicClassName(values.educational_stage, values.grade)
    };
  }

  /** Add-class modal — name is derived from stage + grade by the backend. */
  openClassModal() {
    AppModal.open({
      title: 'إضافة صف دراسي جديد',
      description: 'اختر المرحلة والصف؛ سيُنشئ الخادم اسم الصف الدراسي تلقائيًا.',
      fields: this.classModalFields(),
      preview: this.classNamePreview(),
      submitLabel: 'إضافة الصف',
      loadingLabel: 'جارٍ الإضافة...',
      onSubmit: async (values) => {
        await ApiClient.createClass({
          educational_stage: values.educational_stage,
          grade: values.grade,
          description: String(values.description || '').trim()
        });
        await this.refreshClasses();
        this.showClassesMessage('تم إضافة الصف الدراسي بنجاح');
      }
    });
  }

  /** Edit-class modal — prefilled with normalized legacy/current values. */
  openEditClassModal(classId) {
    const cls = (this.data.classes || []).find(c => Number(c.id) === classId);
    if (!cls) {
      this.showClassesMessage('الصف الدراسي غير موجود', true);
      return;
    }

    const parts = getAcademicClassParts(cls);
    const currentStage = CLASS_ALLOWED_GRADES[parts.educational_stage]
      ? parts.educational_stage
      : 'general';
    const stageGrades = CLASS_ALLOWED_GRADES[currentStage];
    const currentGrade = stageGrades.includes(parts.grade) ? parts.grade : stageGrades[0];

    AppModal.open({
      title: 'تعديل الصف الدراسي',
      description: 'يُشتق اسم الصف تلقائيًا من المرحلة التعليمية والصف الدراسي، ويتحقق الخادم من الاختيار.',
      fields: this.classModalFields(currentStage, currentGrade, cls.description || ''),
      preview: this.classNamePreview(),
      submitLabel: 'حفظ التعديلات',
      loadingLabel: 'جارٍ الحفظ...',
      onSubmit: async (values) => {
        await ApiClient.updateClass({
          id: Number(cls.id),
          educational_stage: values.educational_stage,
          grade: values.grade,
          description: String(values.description || '').trim()
        });
        await this.refreshClasses();
        this.showClassesMessage('تم تحديث الصف الدراسي بنجاح');
      }
    });
  }

  /**
   * Delete-class confirmation modal. On 409 the backend's safe Arabic
   * conflict message is shown (via AppModal). 403 → 'ليس لديك صلاحية',
   * 401 → 'انتهت جلسة تسجيل الدخول', 500 → generic server error.
   */
  confirmDeleteClass(classId) {
    const cls = (this.data.classes || []).find(c => Number(c.id) === classId);
    AppModal.open({
      title: 'تأكيد حذف الصف الدراسي',
      description: cls
        ? `هل أنت متأكد من حذف هذا الصف الدراسي؟ سيتم حذف "${cls.name}" نهائيًا.`
        : 'هل أنت متأكد من حذف هذا الصف الدراسي؟',
      fields: [],
      submitLabel: 'حذف',
      cancelLabel: 'إلغاء',
      loadingLabel: 'جارٍ الحذف...',
      onSubmit: async () => {
        await ApiClient.deleteClass(classId);
        await this.refreshClasses();
        this.showClassesMessage('تم حذف الصف الدراسي بنجاح');
      }
    });
  }

  renderGroups() {
    const groups = this.data.groups || [];
    const classes = this.data.classes || [];

    let listHtml = '';
    groups.forEach(g => {
      const days = Array.isArray(g.study_days) ? g.study_days : [];
      const price = Number.isFinite(Number(g.price)) ? Number(g.price).toFixed(2) : '0.00';
      const schemeLabel = GROUP_PAYMENT_LABELS[g.payment_scheme] || '—';
      listHtml += `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 1rem; font-weight: 800;">${g.name}</td>
          <td style="padding: 1rem;">${g.class_name || 'عام'}</td>
          <td style="padding: 1rem;">${days.join('، ') || '—'}</td>
          <td style="padding: 1rem;">${formatGroupTimeRange(g)}</td>
          <td style="padding: 1rem; font-weight: 800;">${price} ج.م</td>
          <td style="padding: 1rem;">
            <span style="background: #e0e7ff; color: #4f46e5; padding: 0.25rem 0.65rem; border-radius: 0.5rem; font-size: 0.75rem; font-weight: 700;">
              ${schemeLabel}
            </span>
          </td>
          <td style="padding: 1rem; font-weight: 800; color: #059669;">${Number(g.student_count) || 0}</td>
          <td style="padding: 1rem;">
            <div style="display: flex; gap: 0.5rem;">
              <button class="btn btn-secondary btn-sm" data-action="edit-group" data-id="${g.id}">تعديل</button>
              <button class="btn btn-danger btn-sm" data-action="delete-group" data-id="${g.id}">حذف</button>
            </div>
          </td>
        </tr>
      `;
    });

    // P1-F: Empty state (distinct from Loading / Error) with the required text
    if (groups.length === 0) {
      listHtml = this.renderEmptyRow(8, 'لا توجد مجموعات دراسية');
    }

    // P1-J: group creation requires at least one academic class (the selector
    // is populated exclusively from the authenticated teacher's classes).
    const needClassNotice = classes.length === 0 ? `
      <div style="margin: 1rem 1rem 0; padding: 0.9rem 1rem; border-radius: 0.5rem; font-size: 0.85rem; font-weight: 700; background: #fffbeb; color: #92400e; border: 1px solid #fde68a;">
        يجب إضافة صف دراسي أولاً قبل إنشاء مجموعة.
        <button class="btn btn-secondary btn-sm" data-action="goto-classes" style="margin-inline-start: 0.75rem;">إضافة صف دراسي</button>
      </div>
    ` : '';

    // P1-J: inline success/error message banner (no page reload required)
    const messageBox = this.groupsMessage ? `
      <div id="groups-action-message" style="margin: 1rem 1rem 0; padding: 0.75rem 1rem; border-radius: 0.5rem; font-size: 0.85rem; font-weight: 700; ${this.groupsMessage.isError
        ? 'background:#fef2f2; color:#b91c1c; border:1px solid #fecdd3;'
        : 'background:#ecfdf5; color:#047857; border:1px solid #a7f3d0;'}">
        ${this.groupsMessage.text}
      </div>
    ` : '';

    // P1-F: empty-state CTA so teachers can add their first group in-place
    const emptyCta = groups.length === 0 && classes.length > 0 ? `
      <div style="text-align: center; padding: 0.25rem 0 1.5rem;">
        <button class="btn btn-primary" data-action="open-group-modal">+ إضافة مجموعة</button>
      </div>
    ` : '';

    const headerButton = classes.length > 0
      ? '<button class="btn btn-primary" data-action="open-group-modal">+ إضافة مجموعة</button>'
      : '<button class="btn btn-primary" data-action="goto-classes">إضافة صف دراسي</button>';

    return `
      <div class="card-table-wrapper" style="margin-top: 1.5rem;">
        <div class="card-header">
          <div>
            <h3 style="font-weight: 800; font-size: 1.15rem;">المجموعات الدراسية (Study Groups)</h3>
            <p style="font-size: 0.8rem; color: #64748b;">تحديد أيام الدراسة، موعد الحصة، السعر، ونظام الدفع (شهري / لكل حصة)</p>
          </div>
          ${headerButton}
        </div>
        ${needClassNotice}
        ${messageBox}
        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th>اسم المجموعة</th>
                <th>الصف الدراسي</th>
                <th>أيام الدراسة</th>
                <th>موعد الحصة</th>
                <th>سعر الدرس</th>
                <th>نظام الدفع</th>
                <th>عدد الطلاب</th>
                <th>الإجراءات</th>
              </tr>
            </thead>
            <tbody>${listHtml}</tbody>
          </table>
        </div>
        ${emptyCta}
      </div>
    `;
  }

  /* ================================================================
   * P1-J: Study Groups CRUD — add / edit / delete via the existing
   * central modal helper (AppModal). All authorization, ownership
   * (session tenant teacher_id) and validation are enforced
   * server-side; client-side checks here are UX only.
   * ================================================================ */

  /** Show an inline success/error banner in the groups tab. */
  showGroupsMessage(message, isError = false) {
    this.groupsMessage = { text: message, isError: !!isError };
    if (this.activeTab === 'groups') this.render();
    // Auto-dismiss after 6s (DOM-only removal — no full re-render).
    setTimeout(() => {
      if (this.groupsMessage && this.groupsMessage.text === message) {
        this.groupsMessage = null;
        const box = document.getElementById('groups-action-message');
        if (box && box.parentNode) box.parentNode.removeChild(box);
      }
    }, 6000);
  }

  /** Re-fetch the teacher dashboard and re-render (keeps counts in sync). */
  async refreshGroups() {
    const data = await ApiClient.getTeacherData();
    this.data = data;
    if (this.activeTab === 'groups') this.render();
  }

  /**
   * P1-J: create/edit modal fields. class_id options come exclusively from
   * the authenticated teacher's classes (server re-verifies ownership).
   */
  groupModalFields(group = null) {
    const classes = this.data.classes || [];
    // P1-J-FIX: start time comes from class_time (canonical or legacy),
    // end time from end_time when the row has one, otherwise start + 1h.
    const startParts = group
      ? parseGroupClassTime(group.class_time, group.shift)
      : { hour: '05', minute: '00', period: 'evening' };
    const endParts = group && /^([01]\d|2[0-3]):[0-5]\d$/.test(String(group.end_time || '').trim())
      ? parseGroupClassTime(group.end_time, group.shift)
      : defaultGroupEndParts(startParts);
    const selectedDays = group && Array.isArray(group.study_days)
      ? group.study_days.map(String)
      : [];

    return [
      {
        name: 'name', label: 'اسم المجموعة', type: 'text', required: true,
        maxlength: 150, value: group ? group.name : '',
        placeholder: 'مثال: مجموعة الأحد والثلاثاء'
      },
      {
        name: 'class_id', label: 'الصف الدراسي', type: 'select', required: true,
        value: group ? group.class_id : (classes.length ? classes[0].id : ''),
        options: classes.map(c => ({ value: c.id, label: c.name }))
      },
      {
        name: 'study_days', label: 'أيام الدراسة', type: 'checklist',
        options: STUDY_DAY_OPTIONS.map(day => ({
          value: day.value,
          label: day.label,
          checked: selectedDays.includes(day.value)
        })),
        emptyText: 'لا توجد أيام متاحة'
      },
      // P1-J-FIX: وقت الحصة as TWO stacked rows — "من:" ABOVE "إلى:", with
      // hour/minute/period selects INLINE on each row (never <input type="time">).
      {
        name: 'start_parts', label: 'وقت الحصة', type: 'timerow',
        inlineLabel: 'من:', value: startParts,
        hourOptions: GROUP_HOUR_OPTIONS,
        minuteOptions: GROUP_MINUTE_OPTIONS,
        periodOptions: GROUP_PERIOD_OPTIONS
      },
      {
        name: 'end_parts', label: '', type: 'timerow',
        inlineLabel: 'إلى:', value: endParts,
        hourOptions: GROUP_HOUR_OPTIONS,
        minuteOptions: GROUP_MINUTE_OPTIONS,
        periodOptions: GROUP_PERIOD_OPTIONS
      },
      {
        name: 'price', label: 'سعر الدرس (ج.م)', type: 'number', required: true,
        min: 0, step: '0.01', value: group ? Number(group.price) : ''
      },
      {
        name: 'payment_scheme', label: 'نظام الدفع', type: 'select', required: true,
        value: group ? group.payment_scheme : 'monthly', options: GROUP_PAYMENT_OPTIONS
      }
    ];
  }

  /** Collect + validate the group payload shared by create and edit modals. */
  collectGroupPayload(values) {
    const days = normalizeStudyDays(values.study_days);
    if (days.length === 0) {
      throw groupValidationError('يرجى اختيار يوم دراسة واحد على الأقل');
    }
    // P1-J-FIX: convert both من/إلى selections to canonical 24h HH:MM and
    // reject an empty or inverted range client-side (UX only — the backend
    // re-validates the same rule authoritatively).
    const startParts = values.start_parts || {};
    const endParts = values.end_parts || {};
    const startTime = buildGroupClassTime(startParts.hour, startParts.minute, startParts.period);
    const endTime = buildGroupClassTime(endParts.hour, endParts.minute, endParts.period);
    if (groupTimeToMinutes(endTime) <= groupTimeToMinutes(startTime)) {
      throw groupValidationError('وقت نهاية الحصة يجب أن يكون بعد وقت بدايتها');
    }
    return {
      class_id: Number(values.class_id),
      name: String(values.name || '').trim(),
      study_days: days,
      start_time: startTime,
      end_time: endTime,
      shift: startParts.period,
      price: Number(values.price),
      payment_scheme: values.payment_scheme
    };
  }

  /** Add-group modal — class selector lists only this teacher's classes. */
  openGroupModal() {
    const classes = this.data.classes || [];
    if (classes.length === 0) {
      this.showGroupsMessage('يجب إضافة صف دراسي أولاً قبل إنشاء مجموعة.', true);
      return;
    }

    AppModal.open({
      title: 'إضافة مجموعة دراسية جديدة',
      description: 'أدخل اسم المجموعة، اختر الصف الدراسي، أيام الدراسة، موعد الحصة، السعر ونظام الدفع.',
      fields: this.groupModalFields(),
      submitLabel: 'حفظ المجموعة',
      cancelLabel: 'إلغاء',
      loadingLabel: 'جارٍ الحفظ...',
      onSubmit: async (values) => {
        await ApiClient.createGroup(this.collectGroupPayload(values));
        await this.refreshGroups();
        this.showGroupsMessage('تم إضافة المجموعة الدراسية بنجاح');
      }
    });
  }

  /** Edit-group modal — prefilled with the stored group's values. */
  openEditGroupModal(groupId) {
    const group = (this.data.groups || []).find(g => Number(g.id) === groupId);
    if (!group) {
      this.showGroupsMessage('المجموعة غير موجودة', true);
      return;
    }

    AppModal.open({
      title: 'تعديل المجموعة الدراسية',
      description: 'سيتم تحديث المجموعة داخل مساحة المدرس الحالية فقط (عزل المستأجرين مفروض من الخادم).',
      fields: this.groupModalFields(group),
      submitLabel: 'حفظ التعديلات',
      cancelLabel: 'إلغاء',
      loadingLabel: 'جارٍ الحفظ...',
      onSubmit: async (values) => {
        await ApiClient.updateGroup({ id: Number(group.id), ...this.collectGroupPayload(values) });
        await this.refreshGroups();
        this.showGroupsMessage('تم تحديث المجموعة الدراسية بنجاح');
      }
    });
  }

  /**
   * Delete-group confirmation modal. On 409 the backend's safe Arabic
   * dependency message is shown (via AppModal); 403/401/500 map to the
   * standard safe messages. The server refuses deletion whenever the
   * group still has enrollments, attendance, exams, homeworks or videos.
   */
  confirmDeleteGroup(groupId) {
    const group = (this.data.groups || []).find(g => Number(g.id) === groupId);
    AppModal.open({
      title: 'تأكيد حذف المجموعة الدراسية',
      description: group
        ? `هل أنت متأكد من حذف هذه المجموعة؟ سيتم حذف "${group.name}" نهائيًا.`
        : 'هل أنت متأكد من حذف هذه المجموعة؟',
      fields: [],
      submitLabel: 'حذف',
      cancelLabel: 'إلغاء',
      loadingLabel: 'جارٍ الحذف...',
      onSubmit: async () => {
        await ApiClient.deleteGroup(groupId);
        await this.refreshGroups();
        this.showGroupsMessage('تم حذف المجموعة بنجاح');
      }
    });
  }

  /* ================================================================
   * P1-K: Students module — search-first add/link flow.
   *
   * The student identity is GLOBAL. This tab NEVER creates a duplicate
   * student and NEVER deletes one: it only manages the current teacher's
   * enrollment link. Ownership (tenant), the academic-class filter and
   * every duplicate check are enforced server-side; the code below is UX.
   * ================================================================ */

  /** Show an inline success/error banner in the students tab. */
  showStudentsMessage(message, isError = false) {
    this.studentsMessage = { text: message, isError: !!isError };
    if (this.activeTab === 'students') this.render();
    // Auto-dismiss after 6s (DOM-only removal — no full re-render).
    setTimeout(() => {
      if (this.studentsMessage && this.studentsMessage.text === message) {
        this.studentsMessage = null;
        const box = document.getElementById('students-action-message');
        if (box && box.parentNode) box.parentNode.removeChild(box);
      }
    }, 6000);
  }

  /** Re-fetch the teacher dashboard and re-render (keeps the list in sync). */
  async refreshStudents() {
    const data = await ApiClient.getTeacherData();
    this.data = data;
    if (this.activeTab === 'students') this.render();
  }

  /** Groups of one academic class, as modal <select> options. */
  studentGroupOptions(classId) {
    return studentGroupsForClass(this.data.groups || [], classId)
      .map(g => ({ value: g.id, label: g.name }));
  }

  /**
   * Step 1 of the add flow: choose academic class → choose group → search.
   * The search is executed by the SERVER (class-scoped, limited, minimum
   * fields). No platform-wide student list is ever loaded into the browser.
   */
  openStudentModal() {
    const classes = this.data.classes || [];
    const groups = this.data.groups || [];
    if (classes.length === 0) {
      this.showStudentsMessage('يجب إضافة صف دراسي أولاً قبل إضافة الطلاب.', true);
      return;
    }
    if (groups.length === 0) {
      this.showStudentsMessage('يجب إضافة مجموعة دراسية أولاً قبل إضافة الطلاب.', true);
      return;
    }

    const firstClassId = classes[0].id;
    AppModal.open({
      title: 'إضافة / ربط طالب',
      description: 'اختر الصف الدراسي ثم المجموعة، وابحث عن الطالب بالكود أو الاسم أو رقم الهاتف. إذا لم يكن مسجلاً يمكنك إضافته كطالب جديد.',
      fields: [
        {
          name: 'class_id', label: 'الصف الدراسي', type: 'select', required: true,
          value: firstClassId,
          options: classes.map(c => ({ value: c.id, label: c.name }))
        },
        {
          name: 'group_id', label: 'المجموعة', type: 'select', required: true,
          // Dynamic: only groups of the selected academic class (the backend
          // rejects any group that belongs to another class anyway).
          options: (values) => this.studentGroupOptions(values.class_id)
        },
        {
          name: 'query', label: 'بحث عن الطالب (كود / اسم / هاتف)', type: 'text',
          required: true, maxlength: 100, placeholder: 'مثال: STU-10045 أو يوسف محمد'
        }
      ],
      submitLabel: 'بحث',
      cancelLabel: 'إلغاء',
      loadingLabel: 'جارٍ البحث...',
      onSubmit: async (values) => {
        const payload = buildStudentSearchPayload(values);
        const selectedClass = classes.find(c => Number(c.id) === payload.class_id);
        const selectedGroup = groups.find(g => Number(g.id) === payload.group_id);
        if (!selectedGroup || Number(selectedGroup.class_id) !== payload.class_id) {
          throw studentValidationError('المجموعة المختارة لا تنتمي إلى هذا الصف الدراسي');
        }
        const response = await ApiClient.searchStudents({
          class_id: payload.class_id,
          query: payload.query
        });
        this.studentSearch = {
          class_id: payload.class_id,
          class_name: (response && response.class_name) || (selectedClass ? selectedClass.name : ''),
          group_id: payload.group_id,
          group_name: selectedGroup.name,
          query: payload.query,
          results: Array.isArray(response && response.results) ? response.results : []
        };
        if (this.activeTab === 'students') this.render();
      }
    });
  }

  /**
   * Step 2b: the student does not exist on the platform → create a brand-new
   * global student and enroll them, in one server-side transaction.
   * Only the name is required; nothing else is artificially mandatory.
   */
  openNewStudentModal() {
    const context = this.studentSearch;
    if (!context) {
      this.showStudentsMessage('ابدأ بالبحث عن الطالب أولاً', true);
      return;
    }
    const classes = this.data.classes || [];
    const prefillName = /^[A-Za-z0-9_-]+$/.test(context.query) ? '' : context.query;
    const prefillCode = /^[A-Za-z0-9][A-Za-z0-9_-]{2,49}$/.test(context.query)
      ? context.query.toUpperCase()
      : '';

    AppModal.open({
      title: 'إضافة طالب جديد',
      description: `سيتم إنشاء حساب طالب جديد وربطه بمجموعة "${context.group_name}" في ${context.class_name}. اسم المستخدم هو البريد الإلكتروني وكلمة المرور الافتراضية ${STUDENT_DEFAULT_PASSWORD}.`,
      fields: [
        {
          name: 'class_id', label: 'الصف الدراسي', type: 'select', required: true,
          value: context.class_id,
          options: classes.map(c => ({ value: c.id, label: c.name }))
        },
        {
          name: 'group_id', label: 'المجموعة', type: 'select', required: true,
          value: context.group_id,
          options: (values) => this.studentGroupOptions(values.class_id)
        },
        { name: 'name', label: 'اسم الطالب', type: 'text', required: true, maxlength: 150, value: prefillName },
        { name: 'student_code', label: 'كود الطالب (اختياري — يُولَّد تلقائياً)', type: 'text', maxlength: 50, value: prefillCode },
        { name: 'phone', label: 'هاتف الطالب (اختياري)', type: 'text', maxlength: 30 },
        { name: 'parent_phone', label: 'هاتف ولي الأمر (اختياري)', type: 'text', maxlength: 30 },
        { name: 'email', label: 'البريد الإلكتروني (اسم المستخدم — اختياري)', type: 'text', maxlength: 150 },
        { name: 'gender', label: 'النوع (اختياري)', type: 'select', value: '', options: STUDENT_GENDER_OPTIONS },
        { name: 'date_of_birth', label: 'تاريخ الميلاد (اختياري)', type: 'date' },
        { name: 'address', label: 'العنوان (اختياري)', type: 'text', maxlength: 255 },
        { name: 'notes', label: 'ملاحظات (اختياري)', type: 'textarea', maxlength: 2000, rows: 3 }
      ],
      submitLabel: 'حفظ الطالب',
      cancelLabel: 'إلغاء',
      loadingLabel: 'جارٍ الحفظ...',
      onSubmit: async (values) => {
        const response = await ApiClient.createStudent(collectStudentPayload(values));
        this.studentSearch = null;
        await this.refreshStudents();
        const username = response && response.username ? ` — اسم المستخدم: ${response.username}` : '';
        const password = response && response.default_password
          ? ` وكلمة المرور الافتراضية: ${response.default_password}`
          : '';
        this.showStudentsMessage(`تم إنشاء حساب الطالب وربطه بالمجموعة بنجاح${username}${password}`);
      }
    });
  }

  /**
   * Step 2a: the student already exists on the platform → EXPLICIT opt-in
   * link. Nothing about the student's profile, credentials or parent is
   * modified; only an enrollment for THIS teacher is created/reactivated.
   */
  confirmLinkStudent(studentId) {
    const context = this.studentSearch;
    if (!context) {
      this.showStudentsMessage('ابدأ بالبحث عن الطالب أولاً', true);
      return;
    }
    const student = (context.results || []).find(r => Number(r.id) === Number(studentId));
    AppModal.open({
      title: 'إضافة الطالب إلى المجموعة',
      description: student
        ? `الطالب "${student.name}" مسجل بالفعل على المنصة. سيتم ربطه بمجموعة "${context.group_name}" فقط، دون إنشاء حساب جديد أو تعديل بياناته.`
        : `سيتم ربط الطالب بمجموعة "${context.group_name}" دون إنشاء حساب جديد.`,
      fields: [],
      submitLabel: 'إضافة الطالب إلى المجموعة',
      cancelLabel: 'إلغاء',
      loadingLabel: 'جارٍ الإضافة...',
      onSubmit: async () => {
        await ApiClient.enrollExistingStudent({
          student_id: Number(studentId),
          class_id: context.class_id,
          group_id: context.group_id
        });
        this.studentSearch = null;
        await this.refreshStudents();
        this.showStudentsMessage('تم إضافة الطالب إلى المجموعة بنجاح');
      }
    });
  }

  /**
   * Move a student between MY groups of the SAME academic class. The backend
   * UPDATEs the single existing enrollment — a transfer can never create a
   * second row (one group per teacher per student).
   */
  openTransferStudentModal(studentId) {
    const student = (this.data.students || []).find(s => Number(s.id) === Number(studentId));
    if (!student) {
      this.showStudentsMessage('الطالب غير موجود في قائمتك', true);
      return;
    }
    const options = this.studentGroupOptions(student.class_id)
      .filter(option => Number(option.value) !== Number(student.group_id));
    if (options.length === 0) {
      this.showStudentsMessage('لا توجد مجموعة أخرى في نفس الصف الدراسي للنقل إليها', true);
      return;
    }

    AppModal.open({
      title: 'نقل الطالب إلى مجموعة أخرى',
      description: `الطالب "${student.name}" مسجل حاليًا في مجموعة "${student.group_name || 'عام'}". النقل متاح فقط بين مجموعاتك داخل نفس الصف الدراسي.`,
      fields: [
        {
          name: 'group_id', label: 'المجموعة الجديدة', type: 'select', required: true,
          value: options[0].value, options
        }
      ],
      submitLabel: 'نقل الطالب',
      cancelLabel: 'إلغاء',
      loadingLabel: 'جارٍ النقل...',
      onSubmit: async (values) => {
        const groupId = Number(values.group_id);
        if (!Number.isInteger(groupId) || groupId <= 0) {
          throw studentValidationError('يجب اختيار المجموعة الجديدة');
        }
        await ApiClient.transferStudentGroup({ student_id: Number(studentId), group_id: groupId });
        await this.refreshStudents();
        this.showStudentsMessage('تم نقل الطالب إلى المجموعة الجديدة بنجاح');
      }
    });
  }

  /**
   * "Delete" in this module = HIDE/UNLINK for this teacher only. The global
   * student record, their account, their parent and every other teacher's
   * link stay intact (there is no DELETE FROM students anywhere).
   */
  confirmUnlinkStudent(studentId) {
    const student = (this.data.students || []).find(s => Number(s.id) === Number(studentId));
    AppModal.open({
      title: 'إزالة الطالب من قائمتك',
      description: student
        ? `سيتم إزالة "${student.name}" من قائمة طلابك فقط. لن يتم حذف حساب الطالب من المنصة ولن يتأثر أي مدرس آخر.`
        : 'سيتم إزالة الطالب من قائمتك فقط دون حذف حسابه من المنصة.',
      fields: [],
      submitLabel: 'إزالة من قائمتي',
      cancelLabel: 'إلغاء',
      loadingLabel: 'جارٍ الإزالة...',
      onSubmit: async () => {
        await ApiClient.unlinkStudent(Number(studentId));
        await this.refreshStudents();
        this.showStudentsMessage('تم إزالة الطالب من قائمتك (لم يتم حذف حساب الطالب من المنصة)');
      }
    });
  }

  /**
   * P1-K-FIX: "عرض كارنيه QR" — open a printable Student ID card.
   *
   * End-to-end path: click → this handler → look up the student BY ID from
   * `this.data.students` (the ALREADY server-scoped list of THIS teacher's
   * active enrollments) → render a card (name / code / class / group) with a
   * real, scannable QR encoding the `student_code` → visible modal.
   *
   * SECURITY:
   *  - No teacher_id is ever read from the DOM or sent anywhere; the student
   *    record is resolved from the already-loaded tenant-scoped list, so a
   *    forged `data-id` simply falls back to a clear Arabic error.
   *  - The QR encodes ONLY the student_code (the same public business id the
   *    Method-2 scanner attendance reads from the card). No secrets, tokens,
   *    emails or cross-tenant data are embedded.
   *  - The card is built with textContent (XSS-safe) like AppModal.
   */
  openStudentQrCard(studentId) {
    const student = (this.data.students || [])
      .find(s => Number(s.id) === Number(studentId));
    if (!student) {
      this.showStudentsMessage('الطالب غير موجود في قائمتك', true);
      return;
    }

    const code = String(student.student_code || '').trim();
    if (!code) {
      this.showStudentsMessage('لا يمكن عرض الكارنيه: كود الطالب غير متوفر', true);
      return;
    }

    // Rapid double-click protection: reuse/close any existing card first so
    // multiple backdrops are never stacked.
    this.closeStudentQrCard();

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop student-qr-card-backdrop';
    backdrop.dir = 'rtl';

    const content = document.createElement('div');
    content.className = 'modal-content';
    content.setAttribute('role', 'dialog');
    content.setAttribute('aria-modal', 'true');
    content.setAttribute('aria-label', 'كارنيه الطالب');

    const header = document.createElement('div');
    header.className = 'modal-header';
    const title = document.createElement('h3');
    title.className = 'modal-title';
    title.textContent = 'كارنيه الطالب';
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'modal-close';
    closeButton.setAttribute('aria-label', 'إغلاق');
    closeButton.textContent = '✕';
    header.append(title, closeButton);

    const body = document.createElement('div');
    body.className = 'modal-body';

    const card = document.createElement('div');
    card.className = 'qr-card-box';

    const nameEl = document.createElement('h3');
    nameEl.style.cssText = 'margin:0;font-weight:800;font-size:1.2rem;color:#0f172a;';
    nameEl.textContent = student.name || '—';

    const classEl = document.createElement('p');
    classEl.style.cssText = 'margin:0.35rem 0 0;font-size:0.85rem;color:#64748b;';
    classEl.textContent = 'الصف الدراسي: ' + (student.grade_level || '—');

    const groupEl = document.createElement('p');
    groupEl.style.cssText = 'margin:0.2rem 0 0;font-size:0.85rem;color:#64748b;';
    groupEl.textContent = 'المجموعة: ' + (student.group_name || '—');

    const codeEl = document.createElement('div');
    codeEl.className = 'qr-student-code';
    codeEl.textContent = code;

    const qrWrapper = document.createElement('div');
    qrWrapper.className = 'qr-svg-wrapper';
    qrWrapper.setAttribute('aria-label', 'كود QR الخاص بالطالب');

    card.append(nameEl, classEl, groupEl, qrWrapper, codeEl);
    body.appendChild(card);
    content.append(header, body);
    backdrop.appendChild(content);
    document.body.appendChild(backdrop);

    const onKeyDown = (event) => {
      if (event.key === 'Escape') this.closeStudentQrCard();
    };
    this._studentQrCard = { backdrop, onKeyDown };
    closeButton.addEventListener('click', () => this.closeStudentQrCard());
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) this.closeStudentQrCard();
    });
    document.addEventListener('keydown', onKeyDown);

    this.renderStudentQrSvg(qrWrapper, code);
    closeButton.focus();
  }

  /** Close (and detach) the open student QR card, if any. Safe to call always. */
  closeStudentQrCard() {
    const card = this._studentQrCard;
    if (!card) return;
    document.removeEventListener('keydown', card.onKeyDown);
    if (card.backdrop && card.backdrop.parentNode) {
      card.backdrop.parentNode.removeChild(card.backdrop);
    }
    this._studentQrCard = null;
  }

  /**
   * Draw a real, scannable QR into `container` using the project's vendored
   * encoder (assets/js/qr-encoder.js, the same `qrcode` global the dynamic
   * attendance QR uses). The decorative `QrSvgGenerator` (qr-generator.js)
   * is intentionally NOT used: it produces a non-scannable pattern.
   */
  renderStudentQrSvg(container, value) {
    if (!container) return;
    try {
      if (typeof qrcode === 'function') {
        const qr = qrcode(0, 'M');
        qr.addData(String(value));
        qr.make();
        container.innerHTML = qr.createSvgTag(4, 4);
      } else {
        container.textContent = 'تعذر توليد رمز QR';
      }
    } catch (e) {
      container.textContent = 'تعذر توليد رمز QR';
    }
  }

  /** Dismiss the current server-side search results panel. */
  clearStudentSearch() {
    this.studentSearch = null;
    if (this.activeTab === 'students') this.render();
  }

  /**
   * Server-side search results panel (step 2 of the search-first flow).
   * Renders ONLY what the backend returned for the selected academic class.
   */
  renderStudentSearchPanel() {
    const context = this.studentSearch;
    if (!context) return '';

    const results = Array.isArray(context.results) ? context.results : [];
    const heading = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:1rem; flex-wrap:wrap;">
        <div>
          <h4 style="font-weight:800; font-size:1rem;">نتائج البحث عن "${escapeStudentText(context.query)}"</h4>
          <p style="font-size:0.78rem; color:#64748b;">${escapeStudentText(context.class_name)} • المجموعة المختارة: ${escapeStudentText(context.group_name)}</p>
        </div>
        <button class="btn btn-secondary btn-sm" data-action="clear-student-search">إغلاق النتائج</button>
      </div>
    `;

    if (results.length === 0) {
      return `
        <div id="student-search-panel" style="margin:1rem; padding:1rem; border:1px solid #e2e8f0; border-radius:0.75rem; background:#f8fafc;">
          ${heading}
          <p style="margin-top:0.85rem; font-size:0.85rem; color:#0f172a; font-weight:700;">لا يوجد طالب مطابق في هذا الصف الدراسي.</p>
          <button class="btn btn-primary btn-sm" style="margin-top:0.75rem;" data-action="open-new-student-modal">إضافة طالب جديد</button>
        </div>
      `;
    }

    let rows = '';
    results.forEach(result => {
      const state = String(result.link_state || 'unlinked');
      const stateLabel = STUDENT_LINK_STATE_LABELS[state] || STUDENT_LINK_STATE_LABELS.unlinked;
      const stateStyle = state === 'linked'
        ? 'background:#e0e7ff; color:#4338ca;'
        : 'background:#ecfdf5; color:#047857;';
      // "الطالب مضاف بالفعل" also shows the CURRENT class/group of THIS teacher.
      const currentPlacement = state === 'linked'
        ? `<span style="font-size:0.75rem; color:#64748b;">${escapeStudentText(result.class_name || '')} • ${escapeStudentText(result.group_name || 'عام')}</span>`
        : '';
      const action = state === 'linked'
        ? `<button class="btn btn-secondary btn-sm" data-action="transfer-student" data-id="${result.id}">نقل إلى مجموعة أخرى</button>`
        : `<button class="btn btn-primary btn-sm" data-action="link-student" data-id="${result.id}">إضافة الطالب إلى المجموعة</button>`;

      rows += `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:1rem; flex-wrap:wrap; padding:0.75rem 0; border-top:1px solid #e2e8f0;">
          <div>
            <span style="font-family:monospace; font-weight:800; color:#059669;">${escapeStudentText(result.student_code)}</span>
            <span style="font-weight:800; margin-inline-start:0.5rem;">${escapeStudentText(result.name)}</span>
            <div style="margin-top:0.2rem; display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
              <span style="padding:0.15rem 0.55rem; border-radius:0.5rem; font-size:0.72rem; font-weight:700; ${stateStyle}">${stateLabel}</span>
              <span style="font-size:0.75rem; color:#64748b;">${escapeStudentText(result.grade_level || '')}</span>
              <span style="font-size:0.75rem; color:#64748b;">${escapeStudentText(result.phone || '')}</span>
              ${currentPlacement}
            </div>
          </div>
          <div>${action}</div>
        </div>
      `;
    });

    return `
      <div id="student-search-panel" style="margin:1rem; padding:1rem; border:1px solid #e2e8f0; border-radius:0.75rem; background:#f8fafc;">
        ${heading}
        ${rows}
        <p style="margin-top:0.85rem; font-size:0.78rem; color:#64748b;">لم تجد الطالب؟</p>
        <button class="btn btn-secondary btn-sm" style="margin-top:0.35rem;" data-action="open-new-student-modal">إضافة طالب جديد</button>
      </div>
    `;
  }

  renderStudents() {
    let listHtml = '';
    (this.data.students || []).forEach(s => {
      listHtml += `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 1rem; font-family: monospace; font-weight: 800; color: #059669;">${s.student_code}</td>
          <td style="padding: 1rem; font-weight: 800;">${s.name}</td>
          <td style="padding: 1rem;">${s.grade_level}</td>
          <td style="padding: 1rem;">${s.group_name || 'عام'}</td>
          <td style="padding: 1rem;">${s.phone}</td>
          <td style="padding: 1rem;">${s.parent_phone}</td>
          <td style="padding: 1rem;">
            <button class="btn btn-primary btn-sm" data-action="show-qr" data-id="${s.id}">عرض كارنيه QR</button>
          </td>
          <td style="padding: 1rem;">
            <div style="display: flex; gap: 0.5rem;">
              <button class="btn btn-secondary btn-sm" data-action="transfer-student" data-id="${s.id}">نقل لمجموعة</button>
              <button class="btn btn-danger btn-sm" data-action="unlink-student" data-id="${s.id}">إزالة من قائمتي</button>
            </div>
          </td>
        </tr>
      `;
    });

    // P1-F: Empty state (distinct from Loading / Error)
    if ((this.data.students || []).length === 0) {
      listHtml = this.renderEmptyRow(8, 'لا يوجد طلاب حاليًا');
    }

    const classes = this.data.classes || [];
    const groups = this.data.groups || [];

    // P1-K: adding a student requires an academic class AND a group, because
    // the class is a hard backend filter and the enrollment needs a group.
    let prerequisiteNotice = '';
    if (classes.length === 0) {
      prerequisiteNotice = `
        <div style="margin: 1rem 1rem 0; padding: 0.9rem 1rem; border-radius: 0.5rem; font-size: 0.85rem; font-weight: 700; background: #fffbeb; color: #92400e; border: 1px solid #fde68a;">
          يجب إضافة صف دراسي أولاً قبل إضافة الطلاب.
          <button class="btn btn-secondary btn-sm" data-action="goto-classes" style="margin-inline-start: 0.75rem;">إضافة صف دراسي</button>
        </div>
      `;
    } else if (groups.length === 0) {
      prerequisiteNotice = `
        <div style="margin: 1rem 1rem 0; padding: 0.9rem 1rem; border-radius: 0.5rem; font-size: 0.85rem; font-weight: 700; background: #fffbeb; color: #92400e; border: 1px solid #fde68a;">
          يجب إضافة مجموعة دراسية أولاً قبل إضافة الطلاب.
          <button class="btn btn-secondary btn-sm" data-action="goto-groups" style="margin-inline-start: 0.75rem;">إضافة مجموعة</button>
        </div>
      `;
    }

    // P1-K: inline success/error message banner (no page reload required)
    const messageBox = this.studentsMessage ? `
      <div id="students-action-message" style="margin: 1rem 1rem 0; padding: 0.75rem 1rem; border-radius: 0.5rem; font-size: 0.85rem; font-weight: 700; ${this.studentsMessage.isError
        ? 'background:#fef2f2; color:#b91c1c; border:1px solid #fecdd3;'
        : 'background:#ecfdf5; color:#047857; border:1px solid #a7f3d0;'}">
        ${escapeStudentText(this.studentsMessage.text)}
      </div>
    ` : '';

    const canAdd = classes.length > 0 && groups.length > 0;
    const headerButton = canAdd
      ? '<button class="btn btn-primary" id="open-student-modal" data-action="open-student-modal">+ إضافة / ربط طالب</button>'
      : '<button class="btn btn-primary" data-action="goto-classes">إضافة صف دراسي</button>';

    return `
      <div class="card-table-wrapper" style="margin-top: 1.5rem;">
        <div class="card-header">
          <div>
            <h3 style="font-weight: 800; font-size: 1.15rem;">الطلاب المسجلون وحساب الطالب الموحد</h3>
            <p style="font-size: 0.8rem; color: #64748b;">ابحث عن الطالب أولاً (كود / اسم / هاتف) داخل الصف الدراسي، ثم أضفه إلى مجموعتك أو أنشئ حساباً جديداً إذا لم يكن مسجلاً</p>
          </div>
          ${headerButton}
        </div>
        ${prerequisiteNotice}
        ${messageBox}
        ${this.renderStudentSearchPanel()}
        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th>كود الطالب</th>
                <th>اسم الطالب</th>
                <th>الصف الدراسي</th>
                <th>المجموعة</th>
                <th>هاتف الطالب</th>
                <th>هاتف ولي الأمر</th>
                <th>كارنيه الحضور</th>
                <th>الإجراءات</th>
              </tr>
            </thead>
            <tbody>${listHtml}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  renderAttendance() {
    return `
      <div style="margin-top: 1.5rem;">
        <!-- 3 Mandatory Attendance Methods Selector -->
        <div class="grid-3" style="margin-top: 0;">
          <div class="stat-card" style="border-color: ${this.attendanceMethod === 'dynamic_qr' ? '#059669' : '#e2e8f0'}; cursor: pointer;" data-att-method="dynamic_qr">
            <span style="font-size: 0.75rem; font-weight: 700; color: #059669;">الطريقة الأولى</span>
            <h4 style="font-size: 1rem; font-weight: 800; margin-top: 0.35rem;">QR Code متغير لشاشة الدرس</h4>
            <p style="font-size: 0.75rem; color: #64748b; margin-top: 0.2rem;">يقوم الطالب بمسحه بكاميرا الهاتف</p>
          </div>
          <div class="stat-card" style="border-color: ${this.attendanceMethod === 'id_scanner' ? '#059669' : '#e2e8f0'}; cursor: pointer;" data-att-method="id_scanner">
            <span style="font-size: 0.75rem; font-weight: 700; color: #059669;">الطريقة الثانية</span>
            <h4 style="font-size: 1rem; font-weight: 800; margin-top: 0.35rem;">مسح QR كارنيه الطالب</h4>
            <p style="font-size: 0.75rem; color: #64748b; margin-top: 0.2rem;">بواسطة Scanner أو باركود</p>
          </div>
          <div class="stat-card" style="border-color: ${this.attendanceMethod === 'manual' ? '#059669' : '#e2e8f0'}; cursor: pointer;" data-att-method="manual">
            <span style="font-size: 0.75rem; font-weight: 700; color: #059669;">الطريقة الثالثة</span>
            <h4 style="font-size: 1rem; font-weight: 800; margin-top: 0.35rem;">تسجيل يدوي بواسطة المدرس</h4>
            <p style="font-size: 0.75rem; color: #64748b; margin-top: 0.2rem;">البحث عن الطالب بالاسم</p>
          </div>
        </div>

        <!-- Method 1: Dynamic QR screen (P1-G: server-signed 45s broadcast QR) -->
        ${this.attendanceMethod === 'dynamic_qr' ? this.renderDynamicQrScreen() : ''}

        <!-- Method 2: Scanner input -->
        ${this.attendanceMethod === 'id_scanner' ? `
          <div class="stat-card" style="margin-top: 1.5rem; text-align: center; padding: 2rem;">
            <h3 style="font-size: 1.25rem; font-weight: 800;">الطريقة الثانية: مسح QR كارنيه الطالب بواسطة Scanner</h3>
            <p style="font-size: 0.8rem; color: #64748b; margin-top: 0.35rem;">قم بتوصيل جهاز الـ Scanner أو أدخل كود الطالب يدوياً من الكارنيه (مثال: STU-10045)</p>
            <div style="max-width: 420px; margin: 1.5rem auto; display: flex; gap: 0.5rem;">
              <input type="text" id="scanner-input-code" placeholder="امسح الباركود أو أدخل STU-10045" class="form-control" style="text-align: center; font-family: monospace; font-weight: 800;">
              <button class="btn btn-primary" id="btn-submit-scan">تسجيل الحضور</button>
            </div>
          </div>
        ` : ''}

        <!-- Method 3: Manual search table -->
        ${this.attendanceMethod === 'manual' ? `
          <div class="card-table-wrapper" style="margin-top: 1.5rem;">
            <div class="card-header">
              <h3 style="font-weight: 800; font-size: 1.15rem;">الطريقة الثالثة: تسجيل يدوي بواسطة المدرس</h3>
            </div>
            <div class="table-responsive">
              <table>
                <thead>
                  <tr>
                    <th>كود الطالب</th>
                    <th>اسم الطالب</th>
                    <th>المجموعة</th>
                    <th>تسجيل فوري</th>
                  </tr>
                </thead>
                <tbody>
                  ${(this.data.students || []).length === 0
                    ? this.renderEmptyRow(4, 'لا يوجد طلاب حاليًا لتسجيل الحضور')
                    : (this.data.students || []).map(st => `
                    <tr>
                      <td style="font-family: monospace; font-weight: 800; color: #059669;">${st.student_code}</td>
                      <td style="font-weight: 800;">${st.name}</td>
                      <td>${st.group_name}</td>
                      <td>
                        <button class="btn btn-primary btn-sm" data-action="record-att-manual" data-student-id="${st.id}">حاضر الآن</button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  /* ================================================================
   * P1-E: Shared tab helpers (loading / error / empty states)
   * Error titles are status-aware (401/403/404/500/network) so the UI
   * never mislabels an authorization failure as a connectivity problem.
   * ================================================================ */

  renderTabLoading(message) {
    return `
      <div class="card-table-wrapper" style="margin-top: 1.5rem; padding: 3rem 2rem; text-align: center;">
        <div style="width: 3rem; height: 3rem; border: 4px solid #e2e8f0; border-top-color: #059669; border-radius: 9999px; margin: 0 auto; animation: spin 1s linear infinite;"></div>
        <p style="margin-top: 1rem; color: #64748b; font-size: 0.9rem;">${message}</p>
      </div>
    `;
  }

  describeApiError(error) {
    const status = error && error.status;
    if (status === 400) return { title: 'بيانات غير صالحة', message: (error && error.message) || 'تحقق من البيانات المدخلة.' };
    if (status === 401) return { title: 'انتهت الجلسة', message: 'يرجى تسجيل الدخول مجددًا للمتابعة.' };
    if (status === 403) return { title: 'غير مصرح بهذا الإجراء', message: 'لا تملك صلاحية الوصول إلى هذه البيانات.' };
    if (status === 404) return { title: 'البيانات غير موجودة', message: 'المورد المطلوب غير موجود.' };
    if (status === 409) return { title: 'تعذر إتمام العملية', message: (error && error.message) || 'توجد بيانات متعارضة أو مرتبطة.' };
    if (status === 429) return { title: 'محاولات كثيرة', message: 'يرجى الانتظار قليلًا ثم المحاولة مجددًا.' };
    if (status && status >= 500) return { title: 'خطأ في الخادم', message: 'حدث خطأ أثناء معالجة الطلب — حاول مرة أخرى لاحقًا.' };
    if (error && error.isNetworkError === true) {
      return { title: 'تعذر الاتصال بالخادم', message: 'تحقق من اتصالك بالإنترنت ثم حاول مجددًا.' };
    }
    return { title: 'حدث خطأ', message: 'خطأ غير متوقع — حاول مرة أخرى.' };
  }

  renderTabError(tab, error) {
    const info = this.describeApiError(error);
    const loginBtn = error && error.status === 401
      ? '<button class="btn btn-secondary" data-action="goto-login">تسجيل الدخول</button>'
      : '';
    return `
      <div class="card-table-wrapper" style="margin-top: 1.5rem; padding: 2.5rem 2rem; text-align: center;">
        <h3 style="color: #9f1239; font-weight: 800; font-size: 1.15rem;">${info.title}</h3>
        <p style="color: #64748b; font-size: 0.85rem; margin-top: 0.5rem;">${info.message}</p>
        <div style="display: flex; gap: 0.75rem; justify-content: center; margin-top: 1.25rem;">
          <button class="btn btn-primary" data-action="retry-tab" data-tab="${tab}">إعادة المحاولة</button>
          ${loginBtn}
        </div>
      </div>
    `;
  }

  /** P1-E/F: shared empty-state table row (distinct from Loading and Error) */
  renderEmptyRow(colspan, message) {
    const text = message || 'لا توجد بيانات متاحة حاليًا';
    return `<tr><td colspan="${colspan}" style="padding: 1.5rem; text-align: center; color: #64748b;">${text}</td></tr>`;
  }

  /** P1-F: shared empty-state block for card grids */
  renderEmptyText(message) {
    return `<p style="color: #64748b; text-align: center; padding: 1.5rem; font-size: 0.9rem;">${message}</p>`;
  }

  /* ================================================================
   * P1-E: Exams tab — REAL data from api/exams.php (GET), with
   * loading / empty / error states. Tenant scoping + ownership checks
   * remain enforced server-side (session tenant + P1-B).
   * ================================================================ */

  renderExams() {
    if (this.examsState !== 'ready' || !this.examsData) {
      if (this.examsState === 'error') {
        return this.renderTabError('exams', this.examsError);
      }
      if (this.examsState !== 'loading') {
        this.loadExamsData();
      }
      return this.renderTabLoading('جاري تحميل الامتحانات وبنك الأسئلة...');
    }

    const questions = this.examsData.questions;
    const exams = this.examsData.exams;

    let qList = '';
    questions.forEach((q, idx) => {
      qList += `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 1rem;">${idx + 1}</td>
          <td style="padding: 1rem; font-weight: 800;">${q.subject}</td>
          <td style="padding: 1rem;">
            <span style="background: #d1fae5; color: #065f46; padding: 0.25rem 0.65rem; border-radius: 0.5rem; font-size: 0.75rem; font-weight: 700;">
              ${q.question_type === 'mcq' ? 'اختيار من متعدد' : (q.question_type === 'true_false' ? 'صح وخطأ' : (q.question_type === 'bubble_sheet' ? 'Bubble Sheet' : 'سؤال مقالي'))}
            </span>
          </td>
          <td style="padding: 1rem; font-weight: 700;">${q.question_text}</td>
          <td style="padding: 1rem; color: #059669; font-weight: 800;">${q.correct_option}</td>
          <td style="padding: 1rem; font-weight: 800;">${q.points}</td>
        </tr>
      `;
    });
    if (questions.length === 0) {
      qList = this.renderEmptyRow(6, 'لا توجد أسئلة في البنك حاليًا');
    }

    let exList = '';
    exams.forEach(e => {
      exList += `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 1rem; font-weight: 800;">${e.title}</td>
          <td style="padding: 1rem;">${e.date} (${e.time})</td>
          <td style="padding: 1rem;">${e.duration_minutes} دقيقة</td>
          <td style="padding: 1rem;">
            <span style="background: #e0e7ff; color: #4f46e5; padding: 0.25rem 0.65rem; border-radius: 0.5rem; font-size: 0.75rem; font-weight: 700;">
              ${e.exam_type === 'quiz' ? 'اختبار سريع' : (e.exam_type === 'monthly' ? 'شهري' : (e.exam_type === 'midterm' ? 'نصف الفصل' : 'نهائي'))}
            </span>
          </td>
          <td style="padding: 1rem; font-weight: 800; color: #059669;">${e.total_points} نقطة</td>
          <td style="padding: 1rem;">${Number(e.is_published) === 1 ? 'منشور' : 'مسودة'}</td>
        </tr>
      `;
    });
    if (exams.length === 0) {
      exList = this.renderEmptyRow(6, 'لا توجد امتحانات حاليًا');
    }

    return `
      <div class="card-table-wrapper" style="margin-top: 1.5rem;">
        <div class="card-header">
          <div>
            <h3 style="font-weight: 800; font-size: 1.15rem;">بنك الأسئلة الشامل (4 أنواع أسئلة)</h3>
            <p style="font-size: 0.8rem; color: #64748b;">اختيار من متعدد (MCQ)، صح وخطأ (True/False)، سؤال مقالي (Essay)، و Bubble Sheet</p>
          </div>
          <button class="btn btn-primary" id="open-qb-modal">+ إضافة سؤال للبنك</button>
        </div>
        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>الموضوع</th>
                <th>نوع السؤال</th>
                <th>نص السؤال</th>
                <th>الإجابة الصحيحة</th>
                <th>الدرجة</th>
              </tr>
            </thead>
            <tbody>${qList}</tbody>
          </table>
        </div>
      </div>

      <div class="card-table-wrapper" style="margin-top: 1.5rem;">
        <div class="card-header">
          <div>
            <h3 style="font-weight: 800; font-size: 1.15rem;">الامتحانات</h3>
            <p style="font-size: 0.8rem; color: #64748b;">الامتحانات المنشورة لطلاب مجموعاتك</p>
          </div>
          <button class="btn btn-primary" id="open-exam-modal">+ إنشاء امتحان</button>
        </div>
        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th>عنوان الامتحان</th>
                <th>التاريخ والوقت</th>
                <th>المدة</th>
                <th>النوع</th>
                <th>الدرجة الكلية</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>${exList}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  /** P1-E: Fetch exams + question bank for the authenticated teacher's tenant */
  async loadExamsData() {
    if (this.examsState === 'loading') return;
    this.examsState = 'loading';
    this.examsError = null;
    if (this.activeTab === 'exams') this.render();

    try {
      const data = await ApiClient.getExamsData();
      this.examsData = {
        questions: Array.isArray(data.questions) ? data.questions : [],
        exams: Array.isArray(data.exams) ? data.exams : []
      };
      this.examsState = 'ready';
    } catch (error) {
      this.examsState = 'error';
      this.examsError = error;
    }

    if (this.activeTab === 'exams') this.render();
  }

  /** P1-E: Create-question modal — uses the EXISTING exams.php create_question action */
  openQuestionModal() {
    const teacher = this.data.teacher || {};
    const classes = this.data.classes || [];

    AppModal.open({
      title: 'إضافة سؤال جديد إلى بنك الأسئلة',
      description: 'سيُحفظ السؤال داخل مساحة المدرس الحالية فقط (عزل المستأجرين مفروض من الخادم).',
      fields: [
        { name: 'subject', label: 'الموضوع', type: 'text', required: true, value: teacher.subject || '', placeholder: 'مثال: الفصل الأول — التيار الكهربي' },
        {
          name: 'question_type', label: 'نوع السؤال', type: 'select', required: true, value: 'mcq',
          options: [
            { value: 'mcq', label: 'اختيار من متعدد (MCQ)' },
            { value: 'true_false', label: 'صح وخطأ' },
            { value: 'essay', label: 'سؤال مقالي' },
            { value: 'bubble_sheet', label: 'Bubble Sheet' }
          ]
        },
        {
          name: 'class_id', label: 'الصف الدراسي', type: 'select', required: true,
          value: classes.length ? classes[0].id : '',
          options: classes.map(c => ({ value: c.id, label: c.name }))
        },
        { name: 'question_text', label: 'نص السؤال', type: 'textarea', required: true, rows: 3 },
        { name: 'options', label: 'الاختيارات (مفصولة بفاصلة — لـ MCQ / Bubble Sheet)', type: 'textarea', rows: 2, placeholder: 'أ: الخيار الأول، ب: الخيار الثاني، ...' },
        { name: 'correct_option', label: 'الإجابة الصحيحة', type: 'text', placeholder: 'الاختيار الصحيح أو الإجابة النموذجية' },
        { name: 'points', label: 'الدرجة', type: 'number', required: true, min: 0.5, value: 2 }
      ],
      submitLabel: 'حفظ السؤال',
      onSubmit: async (values) => {
        const optionsList = String(values.options || '')
          .split(/[،,]/)
          .map(s => s.trim())
          .filter(Boolean);

        await ApiClient.createQuestion({
          action: 'create_question',
          payload: {
            class_id: Number(values.class_id),
            subject: values.subject,
            question_type: values.question_type,
            question_text: values.question_text,
            options: optionsList,
            correct_option: values.correct_option || '',
            points: Number(values.points)
          }
        });
        await this.loadExamsData();
      }
    });
  }

  /** P1-E: Create-exam modal — uses the EXISTING exams.php create_exam action */
  openExamModal() {
    const classes = this.data.classes || [];
    const groups = this.data.groups || [];
    const questions = (this.examsData && this.examsData.questions) || [];

    AppModal.open({
      title: 'إنشاء امتحان جديد',
      description: 'سيُنشأ الامتحان منشورًا لطلابك، مع إمكانية ربط أسئلة من بنك أسئلتك فقط.',
      fields: [
        { name: 'title', label: 'عنوان الامتحان', type: 'text', required: true },
        {
          name: 'class_id', label: 'الصف الدراسي', type: 'select', required: true,
          value: classes.length ? classes[0].id : '',
          options: classes.map(c => ({ value: c.id, label: c.name }))
        },
        {
          name: 'group_id', label: 'المجموعة (اختياري)', type: 'select', value: '',
          options: [{ value: '', label: 'عام — بدون مجموعة محددة' }]
            .concat(groups.map(g => ({ value: g.id, label: g.name })))
        },
        { name: 'date', label: 'تاريخ الامتحان', type: 'date', required: true, value: new Date().toISOString().slice(0, 10) },
        { name: 'time', label: 'وقت الامتحان', type: 'text', required: true, value: '05:00 مساءً' },
        { name: 'duration_minutes', label: 'المدة بالدقائق', type: 'number', required: true, min: 5, value: 60 },
        {
          name: 'exam_type', label: 'نوع الامتحان', type: 'select', required: true, value: 'monthly',
          options: [
            { value: 'quiz', label: 'اختبار سريع' },
            { value: 'monthly', label: 'شهري' },
            { value: 'midterm', label: 'نصف الفصل' },
            { value: 'final', label: 'نهائي' }
          ]
        },
        { name: 'total_points', label: 'الدرجة الكلية', type: 'number', required: true, min: 1, value: 100 },
        {
          name: 'question_ids', label: 'أسئلة الامتحان (من بنك أسئلتك)', type: 'checklist',
          options: questions.map(q => ({
            value: q.id,
            label: `#${q.id} — ${q.subject} — ${String(q.question_text).slice(0, 60)}`
          })),
          emptyText: 'لا توجد أسئلة في البنك بعد — أضف أسئلة أولًا ثم أنشئ الامتحان'
        }
      ],
      submitLabel: 'إنشاء الامتحان',
      onSubmit: async (values) => {
        await ApiClient.createExam({
          action: 'create_exam',
          payload: {
            title: values.title,
            class_id: Number(values.class_id),
            group_id: values.group_id === '' ? null : Number(values.group_id),
            date: values.date,
            time: values.time,
            duration_minutes: Number(values.duration_minutes),
            exam_type: values.exam_type,
            total_points: Number(values.total_points),
            question_ids: (values.question_ids || []).map(Number)
          }
        });
        await this.loadExamsData();
      }
    });
  }

  /* ================================================================
   * P1-E: Reports tab — REAL data from api/reports.php (GET), with
   * loading / empty / error states. All seven reports are scoped to the
   * session tenant server-side; staff still needs the 'reports' permission.
   * ================================================================ */

  renderReports() {
    if (this.reportsState !== 'ready' || !this.reportsData) {
      if (this.reportsState === 'error') {
        return this.renderTabError('reports', this.reportsError);
      }
      if (this.reportsState !== 'loading') {
        this.loadReportsData();
      }
      return this.renderTabLoading('جاري تحميل التقارير السبعة...');
    }

    const r = this.reportsData;
    const att = r.attendance || {};
    const summary = att.summary || {};

    const paymentLabel = (s) => (s === 'paid' ? 'مدفوع' : (s === 'pending' ? 'قيد الانتظار' : 'متأخر'));
    const attLabel = (s) => (s === 'present' ? 'حاضر' : (s === 'late' ? 'متأخر' : 'غائب'));

    /* 1. Students report */
    let studentsRows = '';
    (r.students || []).forEach(s => {
      studentsRows += `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 1rem; font-family: monospace; font-weight: 800; color: #059669;">${s.student_code}</td>
          <td style="padding: 1rem; font-weight: 800;">${s.name}</td>
          <td style="padding: 1rem;">${s.grade_level}</td>
          <td style="padding: 1rem;">${s.group_name || '—'}</td>
          <td style="padding: 1rem;">${s.enrollment_date}</td>
          <td style="padding: 1rem;"><span class="badge badge-emerald" style="background: ${s.payment_status === 'paid' ? '#d1fae5' : '#fee2e2'}; color: ${s.payment_status === 'paid' ? '#065f46' : '#991b1b'};">${paymentLabel(s.payment_status)}</span></td>
        </tr>
      `;
    });
    if ((r.students || []).length === 0) studentsRows = this.renderEmptyRow(6);

    /* 2. Attendance records */
    let attRows = '';
    (att.records || []).forEach(a => {
      attRows += `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 1rem; font-family: monospace;">${a.date}</td>
          <td style="padding: 1rem; font-weight: 800;">${a.student_name}</td>
          <td style="padding: 1rem;">${a.group_name || '—'}</td>
          <td style="padding: 1rem;"><span class="badge badge-emerald" style="background: ${a.status === 'absent' ? '#fee2e2' : '#d1fae5'}; color: ${a.status === 'absent' ? '#991b1b' : '#065f46'};">${attLabel(a.status)}</span></td>
          <td style="padding: 1rem;">${a.arrival_time || '—'}</td>
          <td style="padding: 1rem;">${a.late_minutes || 0} دقيقة</td>
        </tr>
      `;
    });
    if ((att.records || []).length === 0) attRows = this.renderEmptyRow(6);

    /* 3. Exams report */
    let examsRows = '';
    (r.exams || []).forEach(e => {
      examsRows += `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 1rem; font-weight: 800;">${e.title}</td>
          <td style="padding: 1rem;">${e.date} (${e.time})</td>
          <td style="padding: 1rem;">${e.exam_type}</td>
          <td style="padding: 1rem; font-weight: 800; color: #059669;">${e.total_points} نقطة</td>
          <td style="padding: 1rem;">${e.total_questions || 0} أسئلة</td>
        </tr>
      `;
    });
    if ((r.exams || []).length === 0) examsRows = this.renderEmptyRow(5);

    /* 4. Grades report */
    let gradesRows = '';
    (r.grades || []).forEach(g => {
      gradesRows += `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 1rem; font-weight: 800;">${g.student_name}</td>
          <td style="padding: 1rem;">${g.exam_title}</td>
          <td style="padding: 1rem; font-weight: 800; color: #059669;">${g.score} / ${g.max_score}</td>
          <td style="padding: 1rem;">${g.status}</td>
          <td style="padding: 1rem;">${g.submitted_at}</td>
        </tr>
      `;
    });
    if ((r.grades || []).length === 0) gradesRows = this.renderEmptyRow(5);

    /* 5. Payments report */
    let paymentsRows = '';
    (r.payments || []).forEach(p => {
      paymentsRows += `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 1rem;"><span class="badge badge-emerald" style="background: ${p.payment_status === 'paid' ? '#d1fae5' : '#fee2e2'}; color: ${p.payment_status === 'paid' ? '#065f46' : '#991b1b'};">${paymentLabel(p.payment_status)}</span></td>
          <td style="padding: 1rem;">${p.payment_scheme === 'monthly' ? 'شهري' : 'بالحصة'}</td>
          <td style="padding: 1rem; font-weight: 800;">${p.price} ج.م</td>
          <td style="padding: 1rem;">${p.students_count} طلاب</td>
          <td style="padding: 1rem; font-weight: 800; color: #059669;">${Number(p.total_expected_revenue || 0).toLocaleString()} ج.م</td>
        </tr>
      `;
    });
    if ((r.payments || []).length === 0) paymentsRows = this.renderEmptyRow(5);

    /* 6. Groups report */
    let groupsRows = '';
    (r.groups || []).forEach(g => {
      groupsRows += `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 1rem; font-weight: 800;">${g.name}</td>
          <td style="padding: 1rem;">${g.class_name || 'عام'}</td>
          <td style="padding: 1rem; font-weight: 800;">${g.price} ج.م (${g.payment_scheme === 'monthly' ? 'شهري' : 'بالحصة'})</td>
          <td style="padding: 1rem;">${g.enrolled_students || 0} طلاب</td>
        </tr>
      `;
    });
    if ((r.groups || []).length === 0) groupsRows = this.renderEmptyRow(4);

    /* 7. Classes report */
    let classesRows = '';
    (r.classes || []).forEach(c => {
      classesRows += `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 1rem; font-weight: 800;">${c.name}</td>
          <td style="padding: 1rem;">${c.level}</td>
          <td style="padding: 1rem;">${c.groups_count || 0} مجموعات</td>
          <td style="padding: 1rem;">${c.total_students || 0} طلاب</td>
        </tr>
      `;
    });
    if ((r.classes || []).length === 0) classesRows = this.renderEmptyRow(4);

    return `
      <div class="card-table-wrapper" style="margin-top: 1.5rem; padding: 2rem;">
        <h3 style="font-weight: 800; font-size: 1.25rem;">التقارير التفصيلية الشاملة (7 تقارير)</h3>
        <p style="font-size: 0.8rem; color: #64748b; margin-top: 0.35rem;">تقارير تشمل: الطلاب، الحضور والغياب، الامتحانات، الدرجات، المدفوعات، المجموعات، والصفوف.</p>

        <div class="grid-4" style="margin-top: 1.5rem;">
          <div class="stat-card">
            <span class="stat-card-title">حضور</span>
            <div class="stat-card-value" style="color: #059669;">${summary.present_count || 0}</div>
          </div>
          <div class="stat-card">
            <span class="stat-card-title">تأخير</span>
            <div class="stat-card-value" style="color: #d97706;">${summary.late_count || 0}</div>
            <div class="stat-card-desc">${summary.total_late_minutes || 0} دقيقة تأخير</div>
          </div>
          <div class="stat-card">
            <span class="stat-card-title">غياب</span>
            <div class="stat-card-value" style="color: #e11d48;">${summary.absent_count || 0}</div>
          </div>
          <div class="stat-card">
            <span class="stat-card-title">إجمالي الطلاب</span>
            <div class="stat-card-value">${(r.students || []).length}</div>
          </div>
        </div>
      </div>

      <div class="card-table-wrapper" style="margin-top: 1.5rem;">
        <div class="card-header"><h3 style="font-weight: 800; font-size: 1.05rem;">1. تقرير الطلاب</h3></div>
        <div class="table-responsive">
          <table>
            <thead><tr><th>الكود</th><th>الاسم</th><th>الصف</th><th>المجموعة</th><th>تاريخ التسجيل</th><th>حالة الدفع</th></tr></thead>
            <tbody>${studentsRows}</tbody>
          </table>
        </div>
      </div>

      <div class="card-table-wrapper" style="margin-top: 1.5rem;">
        <div class="card-header"><h3 style="font-weight: 800; font-size: 1.05rem;">2. تقرير الحضور والغياب</h3></div>
        <div class="table-responsive">
          <table>
            <thead><tr><th>التاريخ</th><th>الطالب</th><th>المجموعة</th><th>الحالة</th><th>وقت الحضور</th><th>التأخير</th></tr></thead>
            <tbody>${attRows}</tbody>
          </table>
        </div>
      </div>

      <div class="card-table-wrapper" style="margin-top: 1.5rem;">
        <div class="card-header"><h3 style="font-weight: 800; font-size: 1.05rem;">3. تقرير الامتحانات</h3></div>
        <div class="table-responsive">
          <table>
            <thead><tr><th>الامتحان</th><th>التاريخ والوقت</th><th>النوع</th><th>الدرجة</th><th>الأسئلة</th></tr></thead>
            <tbody>${examsRows}</tbody>
          </table>
        </div>
      </div>

      <div class="card-table-wrapper" style="margin-top: 1.5rem;">
        <div class="card-header"><h3 style="font-weight: 800; font-size: 1.05rem;">4. تقرير الدرجات</h3></div>
        <div class="table-responsive">
          <table>
            <thead><tr><th>الطالب</th><th>الامتحان</th><th>الدرجة</th><th>الحالة</th><th>تاريخ التسجيل</th></tr></thead>
            <tbody>${gradesRows}</tbody>
          </table>
        </div>
      </div>

      <div class="card-table-wrapper" style="margin-top: 1.5rem;">
        <div class="card-header"><h3 style="font-weight: 800; font-size: 1.05rem;">5. تقرير المدفوعات والاشتراكات</h3></div>
        <div class="table-responsive">
          <table>
            <thead><tr><th>حالة الدفع</th><th>النظام</th><th>السعر</th><th>عدد الطلاب</th><th>الإيراد المتوقع</th></tr></thead>
            <tbody>${paymentsRows}</tbody>
          </table>
        </div>
      </div>

      <div class="card-table-wrapper" style="margin-top: 1.5rem;">
        <div class="card-header"><h3 style="font-weight: 800; font-size: 1.05rem;">6. تقرير المجموعات</h3></div>
        <div class="table-responsive">
          <table>
            <thead><tr><th>المجموعة</th><th>الصف</th><th>السعر</th><th>الطلاب المسجلون</th></tr></thead>
            <tbody>${groupsRows}</tbody>
          </table>
        </div>
      </div>

      <div class="card-table-wrapper" style="margin-top: 1.5rem;">
        <div class="card-header"><h3 style="font-weight: 800; font-size: 1.05rem;">7. تقرير الصفوف</h3></div>
        <div class="table-responsive">
          <table>
            <thead><tr><th>الصف</th><th>المرحلة</th><th>المجموعات</th><th>الطلاب</th></tr></thead>
            <tbody>${classesRows}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  /** P1-E: Fetch the seven reports for the authenticated teacher's tenant */
  async loadReportsData() {
    if (this.reportsState === 'loading') return;
    this.reportsState = 'loading';
    this.reportsError = null;
    if (this.activeTab === 'reports') this.render();

    try {
      const data = await ApiClient.getReportsData();
      this.reportsData = data && data.reports ? data.reports : {};
      this.reportsState = 'ready';
    } catch (error) {
      this.reportsState = 'error';
      this.reportsError = error;
    }

    if (this.activeTab === 'reports') this.render();
  }

  renderStaff() {
    let listHtml = '';
    (this.data.staff || []).forEach(stf => {
      listHtml += `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 1rem; font-weight: 800;">${stf.name}</td>
          <td style="padding: 1rem;">${stf.phone}</td>
          <td style="padding: 1rem;">${stf.role_title === 'secretary' ? 'سكرتير (Secretary)' : 'مساعد مدرس (Assistant)'}</td>
          <td style="padding: 1rem;">${(stf.permissions || []).join('، ')}</td>
        </tr>
      `;
    });

    // P1-F: Empty state (distinct from Loading / Error)
    if ((this.data.staff || []).length === 0) {
      listHtml = this.renderEmptyRow(4, 'لا يوجد موظفون (سكرتير / مساعد) حاليًا');
    }

    // P1-F: The "إضافة سكرتير / مساعد" button is intentionally NOT rendered:
    // no backend endpoint/capability exists for staff creation, so the button
    // is hidden instead of offering an action that cannot work. This is a UX
    // decision only — backend authorization remains the source of truth.

    return `
      <div class="card-table-wrapper" style="margin-top: 1.5rem;">
        <div class="card-header">
          <div>
            <h3 style="font-weight: 800; font-size: 1.15rem;">المستخدمون والعاملون مع المدرس (Staff)</h3>
            <p style="font-size: 0.8rem; color: #64748b;">عرض حسابات السكرتارية والمساعدين وصلاحياتهم</p>
          </div>
        </div>
        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th>الاسم</th>
                <th>رقم الهاتف</th>
                <th>الدور الوظيفي</th>
                <th>الصلاحيات الممنوحة</th>
              </tr>
            </thead>
            <tbody>${listHtml}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  renderSettings() {
    const t = this.data.teacher || {};
    return `
      <div class="card-table-wrapper" style="margin-top: 1.5rem; padding: 2rem;">
        <h3 style="font-weight: 800; font-size: 1.25rem;">إعدادات المدرس والسنتر (Teacher Settings)</h3>
        <p style="font-size: 0.8rem; color: #64748b; margin-top: 0.35rem;">اسم المدرس، اسم السنتر، الشعار، رقم الهاتف، العنوان، وإحصاءات الاشتراك.</p>

        <div class="grid-2" style="margin-top: 1.5rem;">
          <div class="form-group">
            <label class="form-label">اسم المدرس</label>
            <input type="text" value="${t.name || ''}" class="form-control" id="set-teacher-name">
          </div>
          <div class="form-group">
            <label class="form-label">اسم السنتر / المؤسسة</label>
            <input type="text" value="${t.center_name || ''}" class="form-control" id="set-center-name">
          </div>
          <div class="form-group">
            <label class="form-label">رقم الهاتف</label>
            <input type="text" value="${t.phone || ''}" class="form-control" id="set-phone">
          </div>
          <div class="form-group">
            <label class="form-label">العنوان التفصيلي</label>
            <input type="text" value="${t.address || ''}" class="form-control" id="set-address">
          </div>
        </div>

        <div style="margin-top: 1rem;">
          <button class="btn btn-primary" id="btn-save-settings">حفظ التعديلات</button>
        </div>
      </div>
    `;
  }

  /* ================================================================
   * P1-G: Dynamic QR broadcast screen — the token is signed server-side
   * (HMAC-SHA256, 45s TTL). The frontend only displays, counts down and
   * auto-refreshes. It never computes HMAC, never sees the secret, and
   * never decides whether a QR is valid.
   * ================================================================ */

  renderDynamicQrScreen() {
    const st = this.qrState;
    const groups = this.data.groups || [];
    const selector = this._qrGroupSelectorHtml(groups, st.groupId);

    if (st.status === 'loading') {
      return `
        <div class="dynamic-qr-screen" style="margin-top: 1.5rem;">
          <span class="badge badge-emerald">الطريقة الأولى • شاشة الحضور بالـ QR المتغير</span>
          <p style="margin-top: 1rem; font-size: 0.9rem; color: #a7f3d0;">جاري توليد رمز الحضور...</p>
          <div style="max-width: 420px; margin: 1.25rem auto 0;">
            ${selector}
          </div>
		</div>
      `;
    }

    if (st.status === 'active' || st.status === 'expired') {
      const expired = st.status === 'expired';
      return `
        <div class="dynamic-qr-screen" style="margin-top: 1.5rem;">
          <span class="badge badge-emerald">الطريقة الأولى • شاشة الحضور بالـ QR المتغير</span>
          <h3 style="font-size: 1.5rem; font-weight: 800; margin-top: 0.75rem;">اعرض هذا الكود على شاشة القاعة أو البروجيكتور</h3>
          <p style="font-size: 0.8rem; color: #a7f3d0; margin-top: 0.25rem;">الرمز موقّع من الخادم وتنتهي صلاحيته تلقائيًا خلال ثوانٍ</p>
          <div style="max-width: 420px; margin: 1rem auto 0;">
            ${selector}
          </div>
		  <div class="dynamic-qr-box"${expired ? ' style="opacity: 0.25; filter: grayscale(1);"' : ''}>
            <div class="dynamic-qr-graphic" id="dynamic-qr-graphic"></div>
          </div>
          ${expired
            ? '<p class="dynamic-qr-countdown dynamic-qr-countdown-expired">انتهت صلاحية الرمز — جاري توليد رمز جديد...</p>'
            : '<p class="dynamic-qr-countdown">ينتهي خلال <span id="qr-countdown">--</span> ثانية</p>'}
          <div class="dynamic-qr-controls">
            <button class="btn btn-secondary" id="btn-refresh-qr">تجديد الرمز الآن</button>
            ${expired ? '' : '<button class="btn btn-secondary" id="btn-enlarge-qr">تكبير QR</button>'}
          </div>
        </div>
      `;
    }

    if (st.status === 'error') {
      return `
        <div class="dynamic-qr-screen" style="margin-top: 1.5rem;">
          <span class="badge badge-emerald">الطريقة الأولى • شاشة الحضور بالـ QR المتغير</span>
          <div style="max-width: 420px; margin: 1.25rem auto 0;">
            ${selector}
          </div>
		  <p style="margin-top: 1rem; font-size: 0.9rem; color: #fecaca;">${st.message || 'تعذر توليد رمز الحضور'}</p>
          <button class="btn btn-secondary" id="btn-retry-qr" style="margin-top: 0.75rem;">إعادة المحاولة</button>
        </div>
      `;
    }

    // idle: choose one of the teacher's OWN groups, then generate
    if (groups.length === 0) {
      return `
        <div class="dynamic-qr-screen" style="margin-top: 1.5rem;">
          <span class="badge badge-emerald">الطريقة الأولى • شاشة الحضور بالـ QR المتغير</span>
          <p style="margin-top: 1rem; font-size: 0.9rem; color: #a7f3d0;">لا توجد مجموعات دراسية — أضف مجموعة أولاً من تبويب المجموعات</p>
        </div>
      `;
    }

    // When a validation message is showing and no group is chosen, keep the
    // "— اختر مجموعة —" placeholder selected so the no-group state stays
    // visually represented (and توليد keeps validating instead of defaulting
    // to the first group).
    const selected = (!st.groupId && st.message) ? '' : (st.groupId || groups[0].id);
    return `
      <div class="dynamic-qr-screen" style="margin-top: 1.5rem;">
        <span class="badge badge-emerald">الطريقة الأولى • شاشة الحضور بالـ QR المتغير</span>
        <h3 style="font-size: 1.35rem; font-weight: 800; margin-top: 0.75rem;">اختر المجموعة ثم ولّد رمز الحضور</h3>
        <p style="font-size: 0.8rem; color: #a7f3d0; margin-top: 0.25rem;">الرمز موقّع من الخادم (HMAC) وصلاحية كل رمز 45 ثانية فقط</p>
        <div style="max-width: 420px; margin: 1.25rem auto 0;">
          ${this._qrGroupSelectorHtml(groups, selected)}
          <button class="btn btn-primary" id="btn-generate-qr" style="margin-top: 0.75rem; width: 100%;">توليد رمز الحضور</button>
          ${st.message ? `<p style="color: #fecaca; font-size: 0.85rem; font-weight: 700; margin-top: 0.75rem;">${st.message}</p>` : ''}
		</div>
      </div>
    `;
  }


  /**
   * Group selector shared by every Dynamic QR screen state so the teacher can
   * switch groups at ANY time — idle, loading, active, expired or error —
   * without reloading the page. The empty placeholder option enables the
   * "no group selected" validation path.
   */
  _qrGroupSelectorHtml(groups, selectedId) {
    const options = ['<option value="">— اختر مجموعة —</option>'].concat(
      groups.map(g =>
        `<option value="${g.id}" ${String(g.id) === String(selectedId || '') ? 'selected' : ''}>${g.name} — ${g.class_name || 'عام'}</option>`
      )
    ).join('');
    return `<select id="qr-group-select" class="form-control" aria-label="اختيار المجموعة">${options}</select>`;
  }

  attendanceActionMessage(message, isError = false) {
    let box = document.getElementById('attendance-action-message');
    if (!box) {
      box = document.createElement('div');
      box.id = 'attendance-action-message';
      box.style.cssText = 'margin:1rem auto 0;max-width:620px;padding:.75rem;border-radius:.5rem;text-align:center;font-size:.85rem;';
      const target = this.container.querySelector('[data-att-method="manual"]')?.parentElement || this.container;
      target.prepend(box);
    }
    box.textContent = message;
    box.style.background = isError ? '#fef2f2' : '#ecfdf5';
    box.style.color = isError ? '#b91c1c' : '#047857';
  }

  /**
   * P1-G: request a signed broadcast QR from the backend (client never signs).
   * @param {string|number} [groupId] optional explicit target group; when
   * omitted, the currently selected group (qrState.groupId) is used.
   */
  async generateQr(groupId) {
    const groups = this.data.groups || [];
    const explicit = groupId !== undefined && groupId !== null && String(groupId) !== '';
    // Prefer the value currently shown in the selector so the button/refresh/
    // auto-renew always acts on the group the teacher actually sees selected —
    // including the "— اختر مجموعة —" placeholder, which must NOT generate.
    let selectValue = '';
    const select = document.getElementById('qr-group-select');
    if (select) selectValue = String(select.value || '');
    const target = explicit
      ? String(groupId)
      : (selectValue !== ''
          ? selectValue
          : (this.qrState.groupId ? String(this.qrState.groupId) : ''));

    if (!target) {
      // No group selected — never call the API. Invalidate any in-flight
      // request and show a clear Arabic validation message.
      this._qrRequestSeq += 1;
      this._qrPendingGroup = '';
      this.stopQrCountdown();
      this.closeQrPresentation();
      this.qrState = { status: 'idle', token: '', exp: 0, groupId: '', message: 'يرجى اختيار مجموعة أولاً' };
      if (this.activeTab === 'attendance' && this.attendanceMethod === 'dynamic_qr') this.render();
      return;
    }
	
    // Duplicate-request guard: the SAME group is already loading — ignore the
    // extra click. A DIFFERENT group is allowed to start immediately even while
    // the previous request is in flight (the seq guard discards the stale one).
    if (this.qrState.status === 'loading' && this._qrPendingGroup === target) return;

    // Version guard: any response whose seq is no longer the latest is dropped,
    // so a delayed response for an older group can never overwrite the current
    // selection (A → B → C rapid switching).
    const seq = ++this._qrRequestSeq;
    this._qrPendingGroup = target;

    // Stop the old countdown, close any enlarged view of the OLD token, clear
    // the old token/SVG, then show the loading state.
    this.stopQrCountdown();
    this.closeQrPresentation();
    this.qrState = { status: 'loading', token: '', exp: 0, groupId: target, message: '' };
    if (this.activeTab === 'attendance' && this.attendanceMethod === 'dynamic_qr') this.render();

    try {
      const data = await ApiClient.generateAttendanceQr(Number(target));
      if (seq !== this._qrRequestSeq) return; // stale response — newer selection exists
       this.qrState = {
        status: 'active',
        token: data.qr_token || '',
        exp: Number(data.exp || 0),
        groupId: target,
        message: ''
      };
    } catch (error) {
      if (seq !== this._qrRequestSeq) return; // stale error — ignore
      this.qrState = { status: 'error', token: '', exp: 0, groupId: target, message: this.describeApiError(error).message };
    }

    if (this.activeTab === 'attendance' && this.attendanceMethod === 'dynamic_qr') this.render();
  }

  /**
   * P1-G: group switch handler (fires on the shared selector's change event).
   * Stops the old countdown, closes the enlarged view, clears the old QR, then
   * immediately generates a fresh 45s QR for the newly selected group. The
   * selector stays usable in every screen state — no page reload required.
   */
  handleQrGroupChange(value) {
    const groups = this.data.groups || [];
    const valid = value !== '' && value !== null && value !== undefined &&
      groups.some(g => String(g.id) === String(value));

    if (!valid) {
      // No group selected — never call the API; invalidate any in-flight
      // request so it cannot land afterwards.
      this._qrRequestSeq += 1;
      this._qrPendingGroup = '';
      this.stopQrCountdown();
      this.closeQrPresentation();
      this.qrState = { status: 'idle', token: '', exp: 0, groupId: '', message: 'يرجى اختيار مجموعة أولاً' };
      if (this.activeTab === 'attendance' && this.attendanceMethod === 'dynamic_qr') this.render();
      return;
    }

    if (this.qrState.status === 'idle') {
      // Idle flow: just store the selection — the "توليد رمز الحضور" button
      // starts generation (and clears any previous validation message).
      this.qrState.groupId = String(value);
      if (this.qrState.message) {
        this.qrState.message = '';
        if (this.activeTab === 'attendance' && this.attendanceMethod === 'dynamic_qr') this.render();
      }
      return;
    }

    // Active/expired/error/loading: switching the group immediately stops the
    // old countdown, clears the old QR and generates a fresh 45s QR for the
    // newly selected group — no page reload.
    this.stopQrCountdown();
    this.closeQrPresentation();
    this.generateQr(String(value));
  }

  /** P1-G: stop the countdown timer (safe to call when no timer is running). */
  stopQrCountdown() {
    if (this._qrTimer) {
      clearInterval(this._qrTimer);
      this._qrTimer = null;
    }
  }

  /** P1-G: countdown from the server `exp` + auto-renew while the screen is open */
  startQrCountdown() {
    this.stopQrCountdown();
    if (this.qrState.status !== 'active') return;

    const tick = () => {
      const el = document.getElementById('qr-countdown');
      if (!el) { // screen closed / tab changed — stop the timer
        clearInterval(this._qrTimer);
        this._qrTimer = null;
        return;
      }
      const remaining = this.qrState.exp - Math.floor(Date.now() / 1000);
      if (remaining <= 0) {
        clearInterval(this._qrTimer);
        this._qrTimer = null;
        this.qrState.status = 'expired';
        if (this.activeTab === 'attendance' && this.attendanceMethod === 'dynamic_qr') {
          this.render();
          this.generateQr(); // auto-generate a fresh QR while the screen is open
        }
        return;
      }
      el.textContent = String(remaining);
    };

    this._qrTimer = setInterval(tick, 1000);
    tick();
  }

  /** P1-G: draw the REAL scannable QR from the signed token (vendored encoder) */
  renderQrInto(qrContainer) {
    if (!qrContainer) return;
    if (this.qrState.status !== 'active' && this.qrState.status !== 'expired') return;
    if (typeof qrcode === 'undefined' || !this.qrState.token) return;
    try {
      const qr = qrcode(0, 'M');
      qr.addData(this.qrState.token);
      qr.make();

      const avail = this._qrAvailableSize(qrContainer);
      qrContainer.__qrAvail = avail;

      // Target rendered size: the wrapper's available square when measurable.
      // If the wrapper (or the whole layout) measures 0/unknown — e.g. an older
      // stylesheet is cached, layout hasn't run, or the element is hidden — fall
      // back to ~90% of the outer white box (which has explicit dimensions in
      // EVERY shipped CSS version). The QR can therefore never collapse to a
      // tiny intrinsic size again.
      let renderSize = avail;
      if (renderSize < 65) {
        const box = qrContainer.parentElement;
        const boxW = box ? box.clientWidth : 0;
        renderSize = Math.max(0, Math.round((boxW > 0 ? boxW : 240) * 0.9));
      }

      const moduleCount = qr.getModuleCount();
      const quietModules = 4; // QR spec minimum quiet zone — never cropped
      const cellSize = Math.max(1, Math.floor(renderSize / (moduleCount + quietModules * 2)));
      // Use ALL leftover space as extra quiet-zone margin so the SVG's natural
      // size matches the target (~90% of the box) — zero scaling, integer
      // module pixels, crisp at every device-pixel ratio and decodable by
      // every scanner.
      const margin = Math.max(
        cellSize * quietModules,
        Math.floor((renderSize - cellSize * moduleCount) / 2)
      );
      const naturalSize = cellSize * moduleCount + margin * 2;

      qrContainer.innerHTML = qr.createSvgTag(cellSize, margin);

      const svg = qrContainer.querySelector('svg');
      if (svg) {
        // Presentation-critical sizing/centering is applied INLINE (inline
        // styles beat any stylesheet) so the QR stays LARGE and centered even
        // when a cached/older stylesheet is served, another rule overrides
        // qr.css, or a browser fails to resolve percentage heights on inline
        // SVGs.
        qrContainer.style.display = 'flex';
        qrContainer.style.alignItems = 'center';
        qrContainer.style.justifyContent = 'center';
        const box = qrContainer.parentElement;
        if (box && box.classList && box.classList.contains('dynamic-qr-box')) {
          qrContainer.style.height = '100%'; // only the fixed-height QR box
        }

        svg.style.display = 'block';
        svg.style.margin = '0 auto';
        svg.style.maxWidth = '100%';
        svg.style.maxHeight = '100%';
        if (naturalSize >= 65) {
          // Render at the SVG's NATURAL size (its own viewBox dimensions):
          // every module lands on an integer pixel boundary — sharp, square,
          // never scaled/cropped, and the whole QR (quiet zone included) fits
          // the available square. Falls back to the target size in the rare
          // case the natural size would exceed the available area.
          const px = Math.min(naturalSize, renderSize);
          svg.style.width = px + 'px';
          svg.style.height = px + 'px';
        }
      }

      this._observeQrContainer(qrContainer);
    } catch (e) {
      qrContainer.textContent = '';
    }
  }

  /**
   * Available square area (content box) for the QR inside its wrapper.
   * The wrapper may be an empty auto-height element at render time when an
   * older stylesheet is served (or layout hasn't run yet) — in that case its
   * clientHeight is 0, which previously collapsed the QR to 65px. Fall back
   * to the outer box, which has explicit dimensions in every shipped CSS
   * version, so the QR can never become tiny.
   */
  _qrAvailableSize(qrContainer) {
    const contentBox = (el) => {
      if (!el) return 0;
      const cs = window.getComputedStyle(el);
      const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      return Math.min(
        Math.max(0, el.clientWidth - padX),
        Math.max(0, el.clientHeight - padY)
      );
    };
    let avail = contentBox(qrContainer);
    if (avail < 65 && qrContainer.parentElement) {
      const parentAvail = contentBox(qrContainer.parentElement);
      if (parentAvail >= 65) avail = parentAvail;
    }
    // Never exceed the wrapper's own width (caps the parent fallback when the
    // wrapper is narrower than the outer box, e.g. the box's padding).
    const wrapperW = qrContainer.clientWidth || 0;
    if (wrapperW > 0 && avail > wrapperW) avail = wrapperW;
    return avail;
  }

  /** Re-fit the QR inside `qrContainer` whenever its box size changes. */
  _observeQrContainer(qrContainer) {
    const box = qrContainer.parentElement || qrContainer;
    const reflow = () => {
      if (!box.isConnected || !qrContainer.isConnected) return;
      const avail = this._qrAvailableSize(qrContainer);
      if (avail === qrContainer.__qrAvail) return; // size unchanged
      this.renderQrInto(qrContainer);
    };
    try {
      if (typeof ResizeObserver !== 'undefined') {
        if (qrContainer.__qrObserver) qrContainer.__qrObserver.disconnect();
        const observer = new ResizeObserver(reflow);
        qrContainer.__qrObserver = observer;
        observer.observe(box);
      } else if (qrContainer.__qrResizeHandler !== reflow) {
        if (qrContainer.__qrResizeHandler) {
          window.removeEventListener('resize', qrContainer.__qrResizeHandler);
        }
        qrContainer.__qrResizeHandler = reflow;
        window.addEventListener('resize', reflow);
      }
    } catch (e) { /* no-op */ }
  }

  renderQrGraphic() {
    this.renderQrInto(document.getElementById('dynamic-qr-graphic'));
    if (this._qrPresentation) {
      this.renderQrInto(this._qrPresentation.graphic);
    }
  }

  /** Presentation-only view: reuses the active signed token and never requests one. */
  openQrPresentation() {
    if (this._qrPresentation || this.qrState.status !== 'active' || !this.qrState.token) return;

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop dynamic-qr-presentation';
    backdrop.dir = 'rtl';
    const content = document.createElement('div');
    content.className = 'modal-content dynamic-qr-presentation-content';
    content.setAttribute('role', 'dialog');
    content.setAttribute('aria-modal', 'true');
    content.setAttribute('aria-label', 'تكبير رمز الحضور');

    const header = document.createElement('div');
    header.className = 'modal-header';
    const title = document.createElement('h3');
    title.className = 'modal-title';
    title.textContent = 'رمز الحضور';
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'modal-close';
    closeButton.setAttribute('aria-label', 'إغلاق');
    closeButton.textContent = '×';
    header.append(title, closeButton);

    const body = document.createElement('div');
    body.className = 'modal-body dynamic-qr-presentation-body';
    const graphic = document.createElement('div');
    graphic.className = 'dynamic-qr-presentation-graphic';
    const hint = document.createElement('p');
    hint.className = 'dynamic-qr-presentation-hint';
    hint.textContent = 'امسح الرمز بالكاميرا قبل انتهاء العد التنازلي';
    const closeAction = document.createElement('button');
    closeAction.type = 'button';
    closeAction.className = 'btn btn-secondary';
    closeAction.textContent = 'إغلاق';
    body.append(graphic, hint, closeAction);
    content.append(header, body);
    backdrop.appendChild(content);
    document.body.appendChild(backdrop);

    const onKeyDown = (event) => {
      if (event.key === 'Escape') this.closeQrPresentation();
    };
    this._qrPresentation = { backdrop, graphic, onKeyDown };
    closeButton.addEventListener('click', () => this.closeQrPresentation());
    closeAction.addEventListener('click', () => this.closeQrPresentation());
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) this.closeQrPresentation();
    });
    document.addEventListener('keydown', onKeyDown);
    this.renderQrInto(graphic);
    closeButton.focus();
  }

  closeQrPresentation() {
    const presentation = this._qrPresentation;
    if (!presentation) return;
    document.removeEventListener('keydown', presentation.onKeyDown);
    if (presentation.backdrop.parentNode) presentation.backdrop.parentNode.removeChild(presentation.backdrop);
    this._qrPresentation = null;
  }

  attachEventListeners() {
    // Tabs switching via Router
    this.container.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.target.getAttribute('data-tab');
        if (window.router) {
          window.router.navigate('/teacher/' + tab);
        } else {
          this.activeTab = tab;
          this.render();
        }
      });
    });

    // Attendance methods switcher
    this.container.querySelectorAll('[data-att-method]').forEach(card => {
      card.addEventListener('click', (e) => {
        this.attendanceMethod = card.getAttribute('data-att-method');
        this.render();
      });
    });

    // P1-G: dynamic QR screen wiring (generate / refresh / retry / countdown).
    // The selector is present in every screen state; changing the group stops
    // the old countdown, clears the old QR and generates a fresh one for the
    // newly selected group (no page reload).
    const qrGroupSelect = document.getElementById('qr-group-select');
    if (qrGroupSelect) {
      qrGroupSelect.addEventListener('change', (e) => {
         this.handleQrGroupChange(e.target.value);
      });
    }
    const btnGenerateQr = document.getElementById('btn-generate-qr');
    if (btnGenerateQr) {
      btnGenerateQr.addEventListener('click', () => this.generateQr());
    }
    const btnRefreshQr = document.getElementById('btn-refresh-qr');
    if (btnRefreshQr) {
      btnRefreshQr.addEventListener('click', () => this.generateQr());
    }
    const btnEnlargeQr = document.getElementById('btn-enlarge-qr');
    if (btnEnlargeQr) {
      btnEnlargeQr.addEventListener('click', () => this.openQrPresentation());
    }
    const btnRetryQr = document.getElementById('btn-retry-qr');
    if (btnRetryQr) {
      btnRetryQr.addEventListener('click', () => this.generateQr());
    }
    this.renderQrGraphic();
    this.startQrCountdown();

    // Modal triggers and actions
    const btnScan = document.getElementById('btn-submit-scan');
    if (btnScan) {
      btnScan.addEventListener('click', async () => {
        const input = document.getElementById('scanner-input-code');
        const inputCode = input?.value.trim() || '';
        if (!inputCode) {
          this.attendanceActionMessage('يرجى مسح QR كارنيه الطالب أو إدخال الكود أولاً', true);
          return;
        }
        btnScan.disabled = true;
        try {
          const response = await ApiClient.recordAttendance({
            student_code: inputCode,
            method: 'id_scanner',
            status: 'present'
          });
          this.attendanceActionMessage(response.message || 'تم تسجيل الحضور بنجاح', false);
          if (input) input.value = '';
        } catch (error) {
          this.attendanceActionMessage(error.message || 'تعذر تسجيل الحضور', true);
        } finally {
          btnScan.disabled = false;
        }
      });
    }

    this.container.querySelectorAll('[data-action="record-att-manual"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const response = await ApiClient.recordAttendance({
            student_id: Number(btn.dataset.studentId),
            method: 'manual',
            status: 'present'
          });
          this.attendanceActionMessage(response.message || 'تم تسجيل الحضور بنجاح', false);
        } catch (error) {
          this.attendanceActionMessage(error.message || 'تعذر تسجيل الحضور', true);
        } finally {
          btn.disabled = false;
        }
      });
    });

    // P1-E: Reports / Exams error panels — retry & login redirect
    this.container.querySelectorAll('[data-action="retry-tab"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        if (tab === 'reports') this.loadReportsData();
        else if (tab === 'exams') this.loadExamsData();
      });
    });
    const gotoLoginBtn = this.container.querySelector('[data-action="goto-login"]');
    if (gotoLoginBtn) {
      gotoLoginBtn.addEventListener('click', () => {
        if (window.router) window.router.navigate('/login');
      });
    }

    // P1-E: Question bank & exam creation modals (existing exams.php actions)
    const btnQbModal = document.getElementById('open-qb-modal');
    if (btnQbModal) {
      btnQbModal.addEventListener('click', () => this.openQuestionModal());
    }
    const btnExamModal = document.getElementById('open-exam-modal');
    if (btnExamModal) {
      btnExamModal.addEventListener('click', () => this.openExamModal());
    }

    // P1-I: Academic Classes CRUD — add / edit / delete (real API data,
    // no page reload; ownership enforced server-side).
    this.container.querySelectorAll('[data-action="open-class-modal"]').forEach(btn => {
      btn.addEventListener('click', () => this.openClassModal());
    });
    this.container.querySelectorAll('[data-action="edit-class"]').forEach(btn => {
      btn.addEventListener('click', () => this.openEditClassModal(Number(btn.dataset.id)));
    });
    this.container.querySelectorAll('[data-action="delete-class"]').forEach(btn => {
      btn.addEventListener('click', () => this.confirmDeleteClass(Number(btn.dataset.id)));
    });

    // P1-J: Study Groups CRUD — add / edit / delete (real API data,
    // no page reload; ownership enforced server-side).
    this.container.querySelectorAll('[data-action="open-group-modal"]').forEach(btn => {
      btn.addEventListener('click', () => this.openGroupModal());
    });
    this.container.querySelectorAll('[data-action="edit-group"]').forEach(btn => {
      btn.addEventListener('click', () => this.openEditGroupModal(Number(btn.dataset.id)));
    });
    this.container.querySelectorAll('[data-action="delete-group"]').forEach(btn => {
      btn.addEventListener('click', () => this.confirmDeleteGroup(Number(btn.dataset.id)));
    });
    // P1-K: Students module — search-first add/link, group transfer and
    // hide/unlink. The student identity is global; nothing here deletes a
    // student or touches another teacher's data (all enforced server-side).
    this.container.querySelectorAll('[data-action="open-student-modal"]').forEach(btn => {
      btn.addEventListener('click', () => this.openStudentModal());
    });
    this.container.querySelectorAll('[data-action="open-new-student-modal"]').forEach(btn => {
      btn.addEventListener('click', () => this.openNewStudentModal());
    });
    this.container.querySelectorAll('[data-action="link-student"]').forEach(btn => {
      btn.addEventListener('click', () => this.confirmLinkStudent(Number(btn.dataset.id)));
    });
    this.container.querySelectorAll('[data-action="transfer-student"]').forEach(btn => {
      btn.addEventListener('click', () => this.openTransferStudentModal(Number(btn.dataset.id)));
    });
    this.container.querySelectorAll('[data-action="unlink-student"]').forEach(btn => {
      btn.addEventListener('click', () => this.confirmUnlinkStudent(Number(btn.dataset.id)));
    });
    this.container.querySelectorAll('[data-action="clear-student-search"]').forEach(btn => {
      btn.addEventListener('click', () => this.clearStudentSearch());
    });
    // P1-K-FIX: "عرض كارنيه QR" — open the student ID card. The student is
    // resolved BY ID from the server-scoped list (never from arbitrary DOM
    // data and never by any teacher_id).
    this.container.querySelectorAll('[data-action="show-qr"]').forEach(btn => {
      btn.addEventListener('click', () => this.openStudentQrCard(Number(btn.dataset.id)));
    });
    // "إضافة مجموعة" CTA shown on the students tab when the teacher has
    // classes but no study group yet.
    this.container.querySelectorAll('[data-action="goto-groups"]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (window.router) {
          window.router.navigate('/teacher/groups');
        } else {
          this.activeTab = 'groups';
          this.render();
        }
      });
    });

    // "إضافة صف دراسي" CTA shown on the groups tab when the teacher has no
    // academic classes yet — navigates to the existing Academic Classes screen.
    this.container.querySelectorAll('[data-action="goto-classes"]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (window.router) {
          window.router.navigate('/teacher/classes');
        } else {
          this.activeTab = 'classes';
          this.render();
        }
      });
    });
  }
}
