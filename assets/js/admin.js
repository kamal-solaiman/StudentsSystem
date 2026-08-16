/**
 * JavaScript Controller for Super Admin SaaS Dashboard
 * Formula: number of active students * price_per_student
 */
class SuperAdminController {
  constructor(containerElement, data, onRefreshCallback) {
    this.container = containerElement;
    this.data = data;
    this.onRefresh = onRefreshCallback;
  }

  render() {
    const teachers = this.data.teachers || [];
    const settings = this.data.saas_settings || {};
    const summary = this.data.summary || {};

    let listHtml = '';
    teachers.forEach((t, index) => {
      const statusLabels = { active: 'نشط', pending: 'بانتظار الموافقة', rejected: 'مرفوض' };
      const statusClass = t.account_status === 'active' ? 'admin-status-active' : (t.account_status === 'pending' ? 'admin-status-pending' : 'admin-status-rejected');
      const approvalActions = t.account_status === 'pending'
        ? `<div class="admin-approval-actions">
             <button type="button" class="btn btn-primary" data-teacher-approval="approve" data-teacher-id="${Number(t.id)}">موافقة</button>
             <button type="button" class="btn btn-danger" data-teacher-approval="reject" data-teacher-id="${Number(t.id)}">رفض</button>
           </div>`
        : (t.account_status === 'rejected'
          ? `<button type="button" class="btn btn-secondary" data-teacher-approval="approve" data-teacher-id="${Number(t.id)}">إعادة التفعيل</button>`
          : '—');
      listHtml += `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 1rem; font-weight: 800; color: #64748b;">#${index + 1}</td>
          <td style="padding: 1rem; font-weight: 800;">${t.name}</td>
          <td style="padding: 1rem;">${t.center_name}</td>
          <td style="padding: 1rem;">
            <span style="background: #d1fae5; color: #065f46; padding: 0.25rem 0.65rem; border-radius: 0.5rem; font-size: 0.75rem; font-weight: 700;">
              ${t.subject}
            </span>
          </td>
          <td style="padding: 1rem;">${t.phone}</td>
          <td style="padding: 1rem; font-weight: 800; color: #4f46e5;">${t.active_students} طلاب</td>
          <td style="padding: 1rem; font-weight: 700;">${t.price_per_student} ج.م</td>
          <td style="padding: 1rem; font-weight: 900; color: #059669;">${Number(t.subscription_monthly || 0).toLocaleString()} ج.م</td>
          <td style="padding: 1rem;"><span class="admin-status ${statusClass}">${statusLabels[t.account_status] || 'غير معروف'}</span></td>
          <td style="padding: 1rem;">${approvalActions}</td>
        </tr>
      `;
    });

    // P1-F: Empty state — never leave a silent empty table
    if (teachers.length === 0) {
      listHtml = `
        <tr>
          <td colspan="10" style="padding: 1.5rem; text-align: center; color: #64748b;">
            لا يوجد مدرسون مسجلون في المنصة حاليًا
          </td>
        </tr>
      `;
    }

    this.container.innerHTML = `
      <!-- Super Admin Header -->
      <div class="profile-banner" style="background: linear-gradient(135deg, #881337, #0f172a, #881337);">
        <div class="profile-banner-header">
          <div>
            <span class="badge" style="background: #ffe4e6; color: #9f1239;">Super Admin Panel • الإشراف العام</span>
            <h2 style="font-size: 1.75rem; font-weight: 800; margin-top: 0.35rem;">لوحة إدارة المنصة ونظام الاشتراكات SaaS</h2>
            <p style="font-size: 0.8rem; color: #fecdd3; margin-top: 0.2rem;">احتساب الاشتراك شهرياً بضرب عدد الطلاب النشطين لكل مدرس × سعر الطالب</p>
          </div>
          <div class="banner-stats-box">
            <span style="display: block; font-size: 0.75rem; color: #fecdd3;">إجمالي عوائد الـ SaaS الشهرية</span>
            <span style="font-size: 1.5rem; font-weight: 900; color: #fff;">${Number(summary.total_monthly_revenue || 0).toLocaleString()} ج.م</span>
          </div>
        </div>
      </div>

      <!-- Stats Grid -->
      <div class="grid-4">
        <div class="stat-card">
          <span class="stat-card-title">إجمالي المدرسين (Tenants)</span>
          <div class="stat-card-value">${summary.total_teachers || 0}</div>
          <div class="stat-card-desc">مساحات معزولة لكل مدرس</div>
        </div>
        <div class="stat-card">
          <span class="stat-card-title">الطلاب النشطون (بالمنصة)</span>
          <div class="stat-card-value">${summary.total_active_students || 0}</div>
          <div class="stat-card-desc">حساب طالب موحد عبر المدرسين</div>
        </div>
        <div class="stat-card">
          <span class="stat-card-title">سعر الطالب الافتراضي</span>
          <div class="stat-card-value">${settings.default_price_per_student || 50} ج.م</div>
          <div class="stat-card-desc">قابل للتعديل من الإعدادات</div>
        </div>
        <div class="stat-card">
          <span class="stat-card-title">عوائد الـ SaaS المحتسبة</span>
          <div class="stat-card-value" style="color: #059669;">${Number(summary.total_monthly_revenue || 0).toLocaleString()} ج.م</div>
          <div class="stat-card-desc">مجموع اشتراكات جميع المدرسين</div>
        </div>
      </div>

      <!-- Teachers SaaS Revenue Table -->
      <div class="card-table-wrapper" style="margin-top: 1.5rem;">
        <div class="card-header">
          <div>
            <h3 style="font-weight: 800; font-size: 1.15rem;">قائمة المدرسين واشتراكات الـ SaaS الشهرية</h3>
            <p style="font-size: 0.8rem; color: #64748b;">كل مدرس يمتلك مساحة مستقلة معزولة، ويتم احتساب اشتراكه بناءً على عدد الطلاب المسجلين لديه</p>
          </div>
        </div>
        <p id="admin-approval-message" class="registration-message registration-message-error" aria-live="polite"></p>
        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>اسم المدرس</th>
                <th>اسم السنتر</th>
                <th>المادة الدراسية</th>
                <th>الهاتف</th>
                <th>الطلاب النشطون</th>
                <th>سعر الطالب</th>
                <th>الاشتراك الشهري</th>
                <th>حالة الحساب</th>
                <th>إجراءات الموافقة</th>
              </tr>
            </thead>
            <tbody>${listHtml}</tbody>
          </table>
        </div>
      </div>

      <!-- SaaS Settings Editor -->
      <div class="card-table-wrapper" style="margin-top: 1.5rem; padding: 2rem;">
        <h3 style="font-weight: 800; font-size: 1.25rem;">إعدادات اشتراك المنصة (SaaS Pricing Config)</h3>
        <p style="font-size: 0.8rem; color: #64748b; margin-top: 0.35rem;">تحديث اسم المنصة وسعر الاشتراك الافتراضي للطالب الواحد</p>

        <div class="grid-2" style="margin-top: 1.5rem;">
          <div class="form-group">
            <label class="form-label">اسم المنصة</label>
            <input type="text" value="${settings.platform_name || ''}" class="form-control" id="saas-platform-name">
          </div>
          <div class="form-group">
            <label class="form-label">سعر الاشتراك الشهري الافتراضي للطالب (ج.م)</label>
            <input type="number" value="${settings.default_price_per_student || 50}" class="form-control" id="saas-price-per-student">
          </div>
        </div>

        <div style="margin-top: 1rem;">
          <button class="btn btn-primary" id="btn-save-saas-settings">حفظ التغييرات</button>
        </div>
      </div>
    `;

    this.attachEventListeners();
  }

  attachEventListeners() {
    this.container.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-teacher-approval]');
      if (!button || button.disabled) return;
      const action = button.dataset.teacherApproval === 'approve' ? 'approve_teacher' : 'reject_teacher';
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      try {
        await ApiClient.updateTeacherApproval(Number(button.dataset.teacherId), action);
        if (this.onRefresh) await this.onRefresh();
      } catch (error) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        const message = document.getElementById('admin-approval-message');
        if (message) message.textContent = error.message || 'تعذر تحديث حالة حساب المدرس';
      }
    });

    const btnSave = document.getElementById('btn-save-saas-settings');
    if (btnSave) {
      btnSave.addEventListener('click', async () => {
        const platformName = document.getElementById('saas-platform-name')?.value || '';
        const price = Number(document.getElementById('saas-price-per-student')?.value || 50);

        try {
          await ApiClient.request('super_admin.php', 'POST', {
            action: 'update_saas_settings',
            platform_name: platformName,
            default_price_per_student: price
          });
          alert('تم حفظ الإعدادات بنجاح في قاعدة البيانات');
          if (this.onRefresh) this.onRefresh();
        } catch (error) {
          // P1-F: status-aware safe message — never expose raw error.message
          const status = error && error.status;
          let saveErrorMsg;
          if (status === 401) {
            saveErrorMsg = 'انتهت جلسة تسجيل الدخول، يرجى تسجيل الدخول مرة أخرى';
          } else if (status === 403) {
            saveErrorMsg = 'ليس لديك صلاحية لتنفيذ هذا الإجراء';
          } else if (status === 429) {
            saveErrorMsg = 'تم تجاوز الحد المسموح من المحاولات، يرجى المحاولة لاحقًا';
          } else if (!status) {
            saveErrorMsg = 'تعذر الاتصال بالخادم، تحقق من اتصال الإنترنت وحاول مرة أخرى';
          } else {
            saveErrorMsg = 'حدث خطأ في الخادم، يرجى المحاولة لاحقًا';
          }
          alert('حدث خطأ أثناء حفظ الإعدادات: ' + saveErrorMsg);
        }
      });
    }
  }
}
