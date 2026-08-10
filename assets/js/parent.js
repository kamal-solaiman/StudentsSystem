/**
 * JavaScript Controller for the 5 Mandatory Parent Portal Pages
 * Includes multiple children switcher
 */
class ParentController {
  constructor(containerElement, data, onChildSwitchCallback) {
    this.container = containerElement;
    this.data = data;
    this.onChildSwitch = onChildSwitchCallback;
    this.activeTab = 'overview';
    this.selectedChildId = (this.data.selected_child || {}).id || (this.data.children || [])[0]?.id || 1;
  }

  render() {
    const parent = this.data.parent || {};
    const selectedChild = this.data.selected_child || (this.data.children || [])[0] || {};
    const attReport = this.data.attendance_report || {};

    let html = `
      <!-- Parent Header Banner -->
      <div class="profile-banner" style="background: linear-gradient(135deg, #3b0764, #0f172a, #3b0764);">
        <div class="profile-banner-header">
          <div style="display: flex; align-items: center; gap: 1rem;">
            <div style="width: 4rem; height: 4rem; border-radius: 1rem; background-color: #9333ea; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; font-weight: 900;">
              ${parent.name ? parent.name.charAt(2) : 'م'}
            </div>
            <div>
              <span class="badge badge-emerald">لوحة ولي الأمر (Parent Portal)</span>
              <h2 style="font-size: 1.75rem; font-weight: 800; margin-top: 0.35rem;">${parent.name || ''}</h2>
              <p style="font-size: 0.8rem; color: #e9d5ff; margin-top: 0.2rem;">متابعة الحضور، الواجبات، الدرجات، والمدفوعات لجميع الأبناء بسهولة</p>
            </div>
          </div>

          <!-- Multiple Children Switcher -->
          <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 0.35rem;">
            <span style="font-size: 0.75rem; font-weight: 700; color: #e9d5ff;">اختر الابن / الطالب للمتابعة:</span>
            <div style="display: flex; flex-wrap: wrap; gap: 0.4rem;">
              ${(this.data.children || []).map(ch => `
                <button class="btn ${Number(ch.id) === Number(this.selectedChildId) ? 'btn-primary' : 'btn-secondary'}" 
                        style="padding: 0.35rem 0.85rem; font-size: 0.75rem;"
                        data-action="switch-child" data-child-id="${ch.id}">
                  ${ch.name} (${ch.grade_level})
                </button>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- Selected Child Summary -->
        <div style="background: rgba(255, 255, 255, 0.1); border-radius: 0.75rem; padding: 0.75rem 1rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap;">
          <span style="font-weight: 800; color: #fff;">الطالب النشط: ${selectedChild.name || ''} (${selectedChild.grade_level || ''})</span>
          <span style="font-family: monospace; color: #a7f3d0; font-weight: 700;">CODE: ${selectedChild.student_code || ''}</span>
        </div>

        <!-- 5 Mandatory Parent Pages Tabs -->
        <div class="tabs-row">
          <button class="tab-btn ${this.activeTab === 'overview' ? 'active' : ''}" data-tab="overview">1. الرئيسية</button>
          <button class="tab-btn ${this.activeTab === 'homeworks' ? 'active' : ''}" data-tab="homeworks">2. الواجبات</button>
          <button class="tab-btn ${this.activeTab === 'attendance' ? 'active' : ''}" data-tab="attendance">3. الحضور والغياب (تقرير شهري)</button>
          <button class="tab-btn ${this.activeTab === 'exams' ? 'active' : ''}" data-tab="exams">4. الامتحانات</button>
          <button class="tab-btn ${this.activeTab === 'teachers' ? 'active' : ''}" data-tab="teachers">5. المدرسون والاشتراكات</button>
        </div>
      </div>
    `;

    if (this.activeTab === 'overview') {
      html += this.renderOverview();
    } else if (this.activeTab === 'homeworks') {
      html += this.renderHomeworks();
    } else if (this.activeTab === 'attendance') {
      html += this.renderAttendance();
    } else if (this.activeTab === 'exams') {
      html += this.renderExams();
    } else if (this.activeTab === 'teachers') {
      html += this.renderTeachers();
    }

    this.container.innerHTML = html;
    this.attachEventListeners();
  }

  renderOverview() {
    const att = this.data.attendance_report || {};
    return `
      <div class="grid-4">
        <div class="stat-card">
          <span class="stat-card-title">أيام الحضور شهرياً</span>
          <div class="stat-card-value" style="color: #059669;">${att.total_present || 0} يوم</div>
          <div class="stat-card-desc">حضور منتظم</div>
        </div>
        <div class="stat-card">
          <span class="stat-card-title">أيام الغياب</span>
          <div class="stat-card-value" style="color: #e11d48;">${att.total_absent || 0} يوم</div>
          <div class="stat-card-desc">التأخير المسجل: ${att.total_late || 0} مرة</div>
        </div>
        <div class="stat-card">
          <span class="stat-card-title">متوسط درجات الامتحانات</span>
          <div class="stat-card-value">—</div>
          <div class="stat-card-desc">لا توجد درجات مسجلة</div>
        </div>
        <div class="stat-card">
          <span class="stat-card-title">المدرسون المشترك معهم</span>
          <div class="stat-card-value">${(this.data.teachers || []).length} مدرسين</div>
          <div class="stat-card-desc">جميع الاشتراكات مدفوعة ونشطة</div>
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
          <td style="padding: 1rem; font-weight: 800; color: #059669;">${h.grade || 0} / ${h.max_grade || 0}</td>
        </tr>
      `;
    });

    return `
      <div class="card-table-wrapper" style="margin-top: 1.5rem;">
        <div class="card-header">
          <h3 style="font-weight: 800; font-size: 1.15rem;">الواجبات المدرسية ودرجة كل واجب</h3>
        </div>
        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th>عنوان الواجب</th>
                <th>المدرس</th>
                <th>تاريخ الاستحقاق</th>
                <th>الدرجة</th>
              </tr>
            </thead>
            <tbody>${listHtml}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  renderAttendance() {
    const att = this.data.attendance_report || {};
    let listHtml = '';
    (att.records || []).forEach(r => {
      listHtml += `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 1rem; font-family: monospace; font-weight: 800;">${r.date}</td>
          <td style="padding: 1rem;">
            <span style="background: #d1fae5; color: #065f46; padding: 0.25rem 0.65rem; border-radius: 0.5rem; font-size: 0.75rem; font-weight: 700;">
              ${r.status === 'present' ? 'حاضر' : (r.status === 'late' ? 'متأخر' : 'غائب')}
            </span>
          </td>
          <td style="padding: 1rem; font-family: monospace;">${r.arrival_time || '—'}</td>
          <td style="padding: 1rem; font-family: monospace;">${r.departure_time || '—'}</td>
          <td style="padding: 1rem; color: #d97706; font-weight: 800;">${r.late_minutes || 0} دقيقة</td>
        </tr>
      `;
    });

    return `
      <div class="card-table-wrapper" style="margin-top: 1.5rem;">
        <div class="card-header">
          <div>
            <h3 style="font-weight: 800; font-size: 1.15rem;">تقرير الحضور والغياب الشهري للطالب</h3>
            <p style="font-size: 0.8rem; color: #64748b;">أيام الحضور، أيام الغياب، وقت الحضور، وقت الانصراف، وأوقات التأخير</p>
          </div>
        </div>
        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>الحالة</th>
                <th>وقت الحضور</th>
                <th>وقت الانصراف</th>
                <th>أوقات التأخير</th>
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
          <td style="padding: 1rem; font-weight: 800; color: #059669;">${e.score || 0} / ${e.max_score || 0}</td>
        </tr>
      `;
    });

    return `
      <div class="card-table-wrapper" style="margin-top: 1.5rem;">
        <div class="card-header">
          <h3 style="font-weight: 800; font-size: 1.15rem;">الامتحانات الشهرية والدرجات الحاصل عليها</h3>
        </div>
        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th>اسم الامتحان</th>
                <th>المدرس</th>
                <th>التاريخ والوقت</th>
                <th>الدرجة</th>
              </tr>
            </thead>
            <tbody>${listHtml}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  renderTeachers() {
    return `
      <div class="card-table-wrapper" style="margin-top: 1.5rem; padding: 1.5rem;">
        <h3 style="font-weight: 800; font-size: 1.15rem;">المدرسون المشترك معهم الابن وحالة الدفع والاشتراك</h3>
        <div class="grid-2" style="margin-top: 1rem;">
          ${(this.data.teachers || []).map(t => `
            <div style="border: 1px solid #e2e8f0; border-radius: 0.75rem; padding: 1.25rem;">
              <span class="badge badge-emerald" style="background: #f3e8ff; color: #6b21a8;">${t.subject}</span>
              <h4 style="font-weight: 800; margin-top: 0.5rem;">${t.teacher_name}</h4>
              <p style="font-size: 0.8rem; color: #64748b;">${t.center_name} • هاتف: ${t.phone}</p>
              <div style="margin-top: 0.75rem; display: flex; justify-content: space-between; align-items: center;">
                <span style="font-weight: 800;">${t.group_name}</span>
                <span class="badge badge-emerald" style="background: #d1fae5; color: #065f46;">مدفوع • ${t.payment_scheme === 'monthly' ? 'شهري' : 'بالحصة'}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  attachEventListeners() {
    this.container.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.target.getAttribute('data-tab');
        if (window.router) {
          window.router.navigate('/parent/' + tab);
        } else {
          this.activeTab = tab;
          this.render();
        }
      });
    });

    this.container.querySelectorAll('[data-action="switch-child"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const childId = e.target.getAttribute('data-child-id');
        if (this.onChildSwitch && childId) {
          this.onChildSwitch(Number(childId));
        }
      });
    });
  }
}
