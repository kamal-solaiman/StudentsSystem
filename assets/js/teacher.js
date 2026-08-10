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

        <!-- Method 1: Dynamic QR screen -->
        ${this.attendanceMethod === 'dynamic_qr' ? `
          <div class="dynamic-qr-screen" style="margin-top: 1.5rem;">
            <span class="badge badge-emerald">الطريقة الأولى • شاشة الحضور بالـ QR المتغير</span>
            <h3 style="font-size: 1.5rem; font-weight: 800; margin-top: 0.75rem;">اعرض هذا الكود على شاشة القاعة أو البروجيكتور</h3>
            <p style="font-size: 0.8rem; color: #a7f3d0; margin-top: 0.25rem;">يتغير الكود تلقائياً لضمان حضور الطالب داخل القاعة</p>
            <div class="dynamic-qr-box" id="dynamic-qr-graphic"></div>
            <p style="font-family: monospace; font-size: 1rem; font-weight: 700; color: #a7f3d0;">TOKEN: DYN-QR-992384-AUTO</p>
          </div>
        ` : ''}

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
                  ${(this.data.students || []).map(st => `
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

  renderExams() {
    let qList = '';
    (this.data.questions || []).forEach((q, idx) => {
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
    `;
  }

  renderReports() {
    return `
      <div class="card-table-wrapper" style="margin-top: 1.5rem; padding: 2rem;">
        <h3 style="font-weight: 800; font-size: 1.25rem;">التقارير التفصيلية الشاملة (7 تقارير بيانية)</h3>
        <p style="font-size: 0.8rem; color: #64748b; margin-top: 0.35rem;">تقارير تشمل: الطلاب، الحضور والغياب، الامتحانات، الدرجات، المدفوعات، المجموعات، والصفوف.</p>
        <div class="grid-3" style="margin-top: 1.5rem;">
          <div class="stat-card">
            <span class="stat-card-title">1. تقرير الطلاب</span>
            <div class="stat-card-value">${(this.data.students || []).length} طلاب</div>
            <div class="stat-card-desc">مسجلون في المجموعات</div>
          </div>
          <div class="stat-card">
            <span class="stat-card-title">2. تقرير الحضور والغياب</span>
            <div class="stat-card-value">${this.data.overview?.today_attendance || 1} حضور</div>
            <div class="stat-card-desc">إحصاءات الحضور والتأخير</div>
          </div>
          <div class="stat-card">
            <span class="stat-card-title">5. تقرير المدفوعات والاشتراكات</span>
            <div class="stat-card-value">${Number(this.data.overview?.subscription_monthly || 0).toLocaleString()} ج.م</div>
            <div class="stat-card-desc">عوائد المدرس الشهرية</div>
          </div>
        </div>
      </div>
    `;
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

    return `
      <div class="card-table-wrapper" style="margin-top: 1.5rem;">
        <div class="card-header">
          <div>
            <h3 style="font-weight: 800; font-size: 1.15rem;">المستخدمون والعاملون مع المدرس (Staff)</h3>
            <p style="font-size: 0.8rem; color: #64748b;">إنشاء حسابات للسكرتارية والمساعدين مع تخصيص صلاحيات محددة</p>
          </div>
          <button class="btn btn-primary" id="open-staff-modal">+ إضافة سكرتير / مساعد</button>
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

    // Render Dynamic QR SVG if present
    const qrContainer = document.getElementById('dynamic-qr-graphic');
    if (qrContainer && typeof QrSvgGenerator !== 'undefined') {
      qrContainer.innerHTML = QrSvgGenerator.renderSvg('DYNAMIC-QR-SCREEN-TOKEN', 220);
    }

    // Modal triggers and actions
    const btnScan = document.getElementById('btn-submit-scan');
    if (btnScan) {
      btnScan.addEventListener('click', () => {
        const inputCode = document.getElementById('scanner-input-code')?.value || 'STU-10045';
        alert(`تم تسجيل الحضور بنجاح للطالب ذو الكود: ${inputCode}`);
      });
    }
  }
}
