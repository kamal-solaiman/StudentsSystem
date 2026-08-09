/**
 * Vanilla JavaScript Controller for the 7 Mandatory Student Unified Account Pages
 */
class StudentController {
  constructor(containerElement, data) {
    this.container = containerElement;
    this.data = data;
    this.activeTab = 'overview';
  }

  render() {
    const st = this.data.student || {};
    let html = `
      <!-- Student Header Banner -->
      <div class="profile-banner">
        <div class="profile-banner-header">
          <div style="display: flex; align-items: center; gap: 1rem;">
            <div style="width: 4rem; height: 4rem; border-radius: 1rem; background-color: #4f46e5; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; font-weight: 900;">
              ${st.name ? st.name.charAt(0) : 'ي'}
            </div>
            <div>
              <span class="badge badge-emerald">حساب طالب موحد (Unified Account)</span>
              <h2 style="font-size: 1.75rem; font-weight: 800; margin-top: 0.35rem;">${st.name || 'يوسف محمد سعيد'}</h2>
              <p style="font-size: 0.8rem; color: #e0e7ff; margin-top: 0.2rem;">كود الطالب: <strong style="font-family: monospace;">${st.student_code}</strong> • متابعة جميع المدرسين من مكان واحد</p>
            </div>
          </div>

          <button class="btn btn-primary" id="btn-show-student-qr" data-code="${st.student_code}" data-name="${st.name}">
            عرض كارنيه الـ QR كود
          </button>
        </div>

        <!-- 7 Mandatory Student Pages Tabs -->
        <div class="tabs-row">
          <button class="tab-btn ${this.activeTab === 'overview' ? 'active' : ''}" data-tab="overview">1. الرئيسية</button>
          <button class="tab-btn ${this.activeTab === 'schedule' ? 'active' : ''}" data-tab="schedule">2. مواعيدي</button>
          <button class="tab-btn ${this.activeTab === 'homeworks' ? 'active' : ''}" data-tab="homeworks">3. واجباتي</button>
          <button class="tab-btn ${this.activeTab === 'exams' ? 'active' : ''}" data-tab="exams">4. الامتحانات / الاختبارات</button>
          <button class="tab-btn ${this.activeTab === 'lessons' ? 'active' : ''}" data-tab="lessons">5. الدروس المسجلة</button>
          <button class="tab-btn ${this.activeTab === 'subscriptions' ? 'active' : ''}" data-tab="subscriptions">6. اشتراكاتي والمدرسون</button>
          <button class="tab-btn ${this.activeTab === 'settings' ? 'active' : ''}" data-tab="settings">7. الإعدادات</button>
        </div>
      </div>
    `;

    if (this.activeTab === 'overview') {
      html += this.renderOverview();
    } else if (this.activeTab === 'schedule') {
      html += this.renderSchedule();
    } else if (this.activeTab === 'homeworks') {
      html += this.renderHomeworks();
    } else if (this.activeTab === 'exams') {
      html += this.renderExams();
    } else if (this.activeTab === 'lessons') {
      html += this.renderLessons();
    } else if (this.activeTab === 'subscriptions') {
      html += this.renderSubscriptions();
    } else if (this.activeTab === 'settings') {
      html += this.renderSettings();
    }

    this.container.innerHTML = html;
    this.attachEventListeners();
  }

  renderOverview() {
    const subs = this.data.subscriptions || [];
    return `
      <div class="grid-4">
        <div class="stat-card">
          <span class="stat-card-title">الدرس القادم</span>
          <div class="stat-card-value" style="font-size: 1.25rem;">الفيزياء (أ. أحمد محمود)</div>
          <div class="stat-card-desc">الأحد القادم الساعة 05:00 مساءً</div>
        </div>
        <div class="stat-card">
          <span class="stat-card-title">الامتحان القادم</span>
          <div class="stat-card-value" style="font-size: 1.25rem;">امتحان شهر مارس الشامل</div>
          <div class="stat-card-desc">31 مارس • 90 دقيقة</div>
        </div>
        <div class="stat-card">
          <span class="stat-card-title">آخر الواجبات</span>
          <div class="stat-card-value" style="font-size: 1.25rem;">مسائل قانون أوم</div>
          <div class="stat-card-desc">تم التسليم • 19.5/20</div>
        </div>
        <div class="stat-card">
          <span class="stat-card-title">المدرسون المشترك معهم</span>
          <div class="stat-card-value">${subs.length || 2} مدرسين</div>
          <div class="stat-card-desc">بدون الحاجة لتعدد الحسابات</div>
        </div>
      </div>

      <div class="card-table-wrapper" style="margin-top: 1.5rem; padding: 1.5rem;">
        <h3 style="font-weight: 800; font-size: 1.15rem;">المدرسون المشترك معهم حالياً:</h3>
        <div class="grid-2" style="margin-top: 1rem;">
          ${(subs.length ? subs : [
            { teacher_name: 'أ. أحمد محمود', subject: 'الفيزياء', group_name: 'مجموعة الأحد والثلاثاء' },
            { teacher_name: 'أ. سارة عادل', subject: 'الرياضيات', group_name: 'مجموعة التفوق' }
          ]).map(s => `
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 0.75rem; padding: 1rem;">
              <h4 style="font-weight: 800;">${s.teacher_name}</h4>
              <p style="font-size: 0.8rem; color: #64748b;">${s.subject} • ${s.group_name}</p>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  renderSchedule() {
    let listHtml = '';
    (this.data.subscriptions || []).forEach(s => {
      listHtml += `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 1rem; font-weight: 800;">${s.subject}</td>
          <td style="padding: 1rem;">${s.teacher_name}</td>
          <td style="padding: 1rem; font-weight: 800;">${s.group_name}</td>
          <td style="padding: 1rem;">${(s.study_days || []).join('، ')}</td>
          <td style="padding: 1rem; font-family: monospace; font-weight: 800; color: #059669;">${s.class_time}</td>
        </tr>
      `;
    });

    return `
      <div class="card-table-wrapper" style="margin-top: 1.5rem;">
        <div class="card-header">
          <h3 style="font-weight: 800; font-size: 1.15rem;">جدول الحصص والمواعيد لجميع المدرسين</h3>
        </div>
        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th>المادة</th>
                <th>المدرس</th>
                <th>المجموعة</th>
                <th>الأيام</th>
                <th>الوقت</th>
              </tr>
            </thead>
            <tbody>${listHtml}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  renderHomeworks() {
    let listHtml = '';
    (this.data.homeworks || []).forEach(h => {
      listHtml += `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 1rem; font-weight: 800;">${h.title}</td>
          <td style="padding: 1rem;">${h.teacher_name}</td>
          <td style="padding: 1rem;">${h.due_date}</td>
          <td style="padding: 1rem;">
            <span style="background: #d1fae5; color: #065f46; padding: 0.25rem 0.65rem; border-radius: 0.5rem; font-size: 0.75rem; font-weight: 700;">
              ${h.submission_status === 'graded' ? 'تم التقييم' : 'تم التسليم'}
            </span>
          </td>
          <td style="padding: 1rem; font-weight: 800; color: #059669;">${h.grade || 19.5} / ${h.max_grade || 20}</td>
          <td style="padding: 1rem;">${h.feedback || '—'}</td>
        </tr>
      `;
    });

    return `
      <div class="card-table-wrapper" style="margin-top: 1.5rem;">
        <div class="card-header">
          <h3 style="font-weight: 800; font-size: 1.15rem;">واجباتي وحالة كل واجب</h3>
        </div>
        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th>عنوان الواجب</th>
                <th>المدرس</th>
                <th>موعد التسليم</th>
                <th>الحالة</th>
                <th>الدرجة</th>
                <th>ملاحظات</th>
              </tr>
            </thead>
            <tbody>${listHtml}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  renderExams() {
    let listHtml = '';
    (this.data.exams || []).forEach(e => {
      listHtml += `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 1rem; font-weight: 800;">${e.title}</td>
          <td style="padding: 1rem;">${e.teacher_name}</td>
          <td style="padding: 1rem;">${e.date} (${e.time})</td>
          <td style="padding: 1rem;">${e.duration_minutes} دقيقة</td>
          <td style="padding: 1rem; font-weight: 800; color: #059669;">${e.score || 11} / ${e.max_score || 12}</td>
        </tr>
      `;
    });

    return `
      <div class="card-table-wrapper" style="margin-top: 1.5rem;">
        <div class="card-header">
          <h3 style="font-weight: 800; font-size: 1.15rem;">الامتحانات والاختبارات القادمة والسابقة</h3>
        </div>
        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th>الامتحان</th>
                <th>المدرس</th>
                <th>التاريخ</th>
                <th>المدة</th>
                <th>الدرجة</th>
              </tr>
            </thead>
            <tbody>${listHtml}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  renderLessons() {
    return `
      <div class="card-table-wrapper" style="margin-top: 1.5rem; padding: 1.5rem;">
        <h3 style="font-weight: 800; font-size: 1.15rem;">الفيديوهات والدروس المسجلة لكل مدرس</h3>
        <div class="grid-2" style="margin-top: 1rem;">
          ${(this.data.lessons || []).map(l => `
            <div style="border: 1px solid #e2e8f0; border-radius: 0.75rem; padding: 1.25rem;">
              <span class="badge badge-emerald" style="background: #e0e7ff; color: #4f46e5;">${l.subject}</span>
              <h4 style="font-weight: 800; margin-top: 0.5rem;">${l.title}</h4>
              <p style="font-size: 0.8rem; color: #64748b;">المدرس: ${l.teacher_name} • المدة: ${l.duration}</p>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  renderSubscriptions() {
    return `
      <div class="card-table-wrapper" style="margin-top: 1.5rem; padding: 1.5rem;">
        <h3 style="font-weight: 800; font-size: 1.15rem;">اشتراكاتي والمدرسون (حالة الاشتراك والدفع)</h3>
        <div class="grid-2" style="margin-top: 1rem;">
          ${(this.data.subscriptions || []).map(s => `
            <div style="border: 1px solid #e2e8f0; border-radius: 0.75rem; padding: 1.25rem;">
              <h4 style="font-weight: 800;">${s.teacher_name} (${s.subject})</h4>
              <p style="font-size: 0.8rem; color: #64748b;">${s.center_name}</p>
              <div style="margin-top: 0.75rem; display: flex; justify-content: space-between; align-items: center;">
                <span style="font-weight: 800;">${s.group_name}</span>
                <span class="badge badge-emerald" style="background: #d1fae5; color: #065f46;">${s.payment_scheme === 'monthly' ? 'شهري' : 'بالحصة'} (${s.price} ج.م)</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  renderSettings() {
    const st = this.data.student || {};
    return `
      <div class="card-table-wrapper" style="margin-top: 1.5rem; padding: 2rem;">
        <h3 style="font-weight: 800; font-size: 1.25rem;">إعدادات الطالب والملف الشخصي</h3>
        <div class="grid-2" style="margin-top: 1.5rem;">
          <div class="form-group">
            <label class="form-label">اسم الطالب</label>
            <input type="text" value="${st.name || ''}" disabled class="form-control" style="background: #f8fafc;">
          </div>
          <div class="form-group">
            <label class="form-label">كود الطالب</label>
            <input type="text" value="${st.student_code || ''}" disabled class="form-control" style="font-family: monospace; font-weight: 800; color: #059669; background: #f8fafc;">
          </div>
        </div>
      </div>
    `;
  }

  attachEventListeners() {
    this.container.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.activeTab = e.target.getAttribute('data-tab');
        this.render();
      });
    });
  }
}
