/**
 * JavaScript Controller for the 9 Mandatory Teacher Dashboard Pages
 */
class TeacherController {
  constructor(containerElement, data, onRefreshCallback) {
    this.container = containerElement;
    this.data = data;
    this.onRefresh = onRefreshCallback;
    this.activeTab = 'overview';
    this.examSubTab = 'questions';
    this.attendanceMethod = 'dynamic_qr';

    // P1-G: dynamic QR broadcast screen state. The token is signed server-side;
    // the frontend only displays it, counts down, and auto-refreshes. No HMAC,
    // secret, or validity decision ever exists in JavaScript.
    this.qrState = { status: 'idle', token: '', exp: 0, groupId: '', message: '' };
    this._qrTimer = null;

    // P1-E: independent async data states for the Reports & Exams tabs
    this.reportsState = 'idle'; // idle | loading | ready | error
    this.reportsData = null;
    this.reportsError = null;
    this.examsState = 'idle';   // idle | loading | ready | error
    this.examsData = null;
    this.examsError = null;
  }

  render() {
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
    let listHtml = '';
    (this.data.classes || []).forEach(c => {
      listHtml += `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 1rem; font-weight: 800;">${c.name}</td>
          <td style="padding: 1rem;">${c.level}</td>
          <td style="padding: 1rem;">${c.description || '—'}</td>
          <td style="padding: 1rem; font-weight: 800; color: #059669;">${c.groups_count || 0} مجموعات</td>
          <td style="padding: 1rem;">
            <button class="btn btn-danger btn-sm" data-action="delete-class" data-id="${c.id}">حذف الصف</button>
          </td>
        </tr>
      `;
    });

    // P1-F: Empty state (distinct from Loading / Error)
    if ((this.data.classes || []).length === 0) {
      listHtml = this.renderEmptyRow(5, 'لا توجد فصول دراسية حاليًا');
    }

    return `
      <div class="card-table-wrapper" style="margin-top: 1.5rem;">
        <div class="card-header">
          <div>
            <h3 style="font-weight: 800; font-size: 1.15rem;">الصفوف الدراسية (Academic Classes)</h3>
            <p style="font-size: 0.8rem; color: #64748b;">إضافة، تعديل، أو حذف صف مع عرض عدد المجموعات المرتبطة بالصف</p>
          </div>
          <button class="btn btn-primary" id="open-class-modal">+ إضافة صف دراسي</button>
        </div>
        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th>اسم الصف</th>
                <th>المرحلة</th>
                <th>الوصف</th>
                <th>المجموعات المرتبطة</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>${listHtml}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  renderGroups() {
    let listHtml = '';
    (this.data.groups || []).forEach(g => {
      listHtml += `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 1rem; font-weight: 800;">${g.name}</td>
          <td style="padding: 1rem;">${g.class_name || 'عام'}</td>
          <td style="padding: 1rem;">${(g.study_days || []).join('، ')}</td>
          <td style="padding: 1rem;">${g.class_time}</td>
          <td style="padding: 1rem;">${g.shift === 'morning' ? 'صباحي' : 'مسائي'}</td>
          <td style="padding: 1rem; font-weight: 800;">${g.price} ج.م</td>
          <td style="padding: 1rem;">
            <span style="background: #e0e7ff; color: #4f46e5; padding: 0.25rem 0.65rem; border-radius: 0.5rem; font-size: 0.75rem; font-weight: 700;">
              ${g.payment_scheme === 'monthly' ? 'شهري' : 'بالحصة'}
            </span>
          </td>
          <td style="padding: 1rem;">
            <button class="btn btn-danger btn-sm" data-action="delete-group" data-id="${g.id}">حذف</button>
          </td>
        </tr>
      `;
    });

    // P1-F: Empty state (distinct from Loading / Error)
    if ((this.data.groups || []).length === 0) {
      listHtml = this.renderEmptyRow(8, 'لا توجد مجموعات دراسية حاليًا');
    }

    return `
      <div class="card-table-wrapper" style="margin-top: 1.5rem;">
        <div class="card-header">
          <div>
            <h3 style="font-weight: 800; font-size: 1.15rem;">المجموعات الدراسية (Study Groups)</h3>
            <p style="font-size: 0.8rem; color: #64748b;">تحديد أيام الدراسة، وقت الحصة، صباحي/مسائي، السعر، ونظام الدفع (شهري / بالحصة)</p>
          </div>
          <button class="btn btn-primary" id="open-group-modal">+ إضافة مجموعة جديدة</button>
        </div>
        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th>اسم المجموعة</th>
                <th>الصف الدراسي</th>
                <th>أيام الدراسة</th>
                <th>وقت الحصة</th>
                <th>الشفت</th>
                <th>السعر</th>
                <th>نظام الدفع</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>${listHtml}</tbody>
          </table>
        </div>
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
            <button class="btn btn-primary btn-sm" data-action="show-qr" data-code="${s.student_code}" data-name="${s.name}">عرض كارنيه QR</button>
          </td>
        </tr>
      `;
    });

    // P1-F: Empty state (distinct from Loading / Error)
    if ((this.data.students || []).length === 0) {
      listHtml = this.renderEmptyRow(7, 'لا يوجد طلاب حاليًا');
    }

    return `
      <div class="card-table-wrapper" style="margin-top: 1.5rem;">
        <div class="card-header">
          <div>
            <h3 style="font-weight: 800; font-size: 1.15rem;">الطلاب المسجلون وحساب الطالب الموحد</h3>
            <p style="font-size: 0.8rem; color: #64748b;">إضافة طالب جديد، اختيار طالب موجود، إضافة عبر QR Code، أو ربط الطالب بمجموعة</p>
          </div>
          <button class="btn btn-primary" id="open-student-modal">+ إضافة / ربط طالب</button>
        </div>
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
    if (status === 401) return { title: 'انتهت الجلسة', message: 'يرجى تسجيل الدخول مجددًا للمتابعة.' };
    if (status === 403) return { title: 'غير مصرح بهذا الإجراء', message: 'لا تملك صلاحية الوصول إلى هذه البيانات.' };
    if (status === 404) return { title: 'البيانات غير موجودة', message: 'المورد المطلوب غير موجود.' };
    if (status === 429) return { title: 'محاولات كثيرة', message: 'يرجى الانتظار قليلًا ثم المحاولة مجددًا.' };
    if (status && status >= 500) return { title: 'خطأ في الخادم', message: 'حدث خطأ أثناء معالجة الطلب — حاول مرة أخرى لاحقًا.' };
    if (!status) return { title: 'تعذر الاتصال بالخادم', message: 'تحقق من اتصالك بالإنترنت ثم حاول مجددًا.' };
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

    if (st.status === 'loading') {
      return `
        <div class="dynamic-qr-screen" style="margin-top: 1.5rem;">
          <span class="badge badge-emerald">الطريقة الأولى • شاشة الحضور بالـ QR المتغير</span>
          <p style="margin-top: 1rem; font-size: 0.9rem; color: #a7f3d0;">جاري توليد رمز الحضور...</p>
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
          <div class="dynamic-qr-box" id="dynamic-qr-graphic"${expired ? ' style="opacity: 0.25; filter: grayscale(1);"' : ''}></div>
          ${expired
            ? '<p style="font-weight: 800; color: #fecaca;">انتهت صلاحية الرمز — جاري توليد رمز جديد...</p>'
            : '<p style="font-family: monospace; font-size: 2rem; font-weight: 900; color: #a7f3d0;"><span id="qr-countdown">--</span> ث</p>'}
          <button class="btn btn-secondary" id="btn-refresh-qr" style="margin-top: 0.75rem;">تجديد الرمز الآن</button>
        </div>
      `;
    }

    if (st.status === 'error') {
      return `
        <div class="dynamic-qr-screen" style="margin-top: 1.5rem;">
          <span class="badge badge-emerald">الطريقة الأولى • شاشة الحضور بالـ QR المتغير</span>
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

    const selected = st.groupId || groups[0].id;
    return `
      <div class="dynamic-qr-screen" style="margin-top: 1.5rem;">
        <span class="badge badge-emerald">الطريقة الأولى • شاشة الحضور بالـ QR المتغير</span>
        <h3 style="font-size: 1.35rem; font-weight: 800; margin-top: 0.75rem;">اختر المجموعة ثم ولّد رمز الحضور</h3>
        <p style="font-size: 0.8rem; color: #a7f3d0; margin-top: 0.25rem;">الرمز موقّع من الخادم (HMAC) وصلاحية كل رمز 45 ثانية فقط</p>
        <div style="max-width: 420px; margin: 1.25rem auto 0;">
          <select id="qr-group-select" class="form-control">
            ${groups.map(g => `<option value="${g.id}" ${String(g.id) === String(selected) ? 'selected' : ''}>${g.name} — ${g.class_name || 'عام'}</option>`).join('')}
          </select>
          <button class="btn btn-primary" id="btn-generate-qr" style="margin-top: 0.75rem; width: 100%;">توليد رمز الحضور</button>
        </div>
      </div>
    `;
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

  /** P1-G: request a signed broadcast QR from the backend (client never signs) */
  async generateQr() {
    if (this.qrState.status === 'loading') return; // double-click guard
    const groups = this.data.groups || [];
    const groupId = this.qrState.groupId || (groups.length ? groups[0].id : null);
    if (!groupId) return;

    this.qrState.status = 'loading';
    this.qrState.message = '';
    if (this.activeTab === 'attendance' && this.attendanceMethod === 'dynamic_qr') this.render();

    try {
      const data = await ApiClient.generateAttendanceQr(groupId);
      this.qrState = {
        status: 'active',
        token: data.qr_token || '',
        exp: Number(data.exp || 0),
        groupId: String(groupId),
        message: ''
      };
    } catch (error) {
      this.qrState.status = 'error';
      this.qrState.message = this.describeApiError(error).message;
    }

    if (this.activeTab === 'attendance' && this.attendanceMethod === 'dynamic_qr') this.render();
  }

  /** P1-G: countdown from the server `exp` + auto-renew while the screen is open */
  startQrCountdown() {
    if (this._qrTimer) {
      clearInterval(this._qrTimer);
      this._qrTimer = null;
    }
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
  renderQrGraphic() {
    const qrContainer = document.getElementById('dynamic-qr-graphic');
    if (!qrContainer) return;
    if (this.qrState.status !== 'active' && this.qrState.status !== 'expired') return;
    if (typeof qrcode === 'undefined' || !this.qrState.token) return;
    try {
      const qr = qrcode(0, 'M');
      qr.addData(this.qrState.token);
      qr.make();
      qrContainer.innerHTML = qr.createSvgTag(5, 2);
    } catch (e) {
      qrContainer.textContent = '';
    }
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

    // P1-G: dynamic QR screen wiring (generate / refresh / retry / countdown)
    const qrGroupSelect = document.getElementById('qr-group-select');
    if (qrGroupSelect) {
      qrGroupSelect.addEventListener('change', (e) => {
        this.qrState.groupId = e.target.value;
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
  }
}
