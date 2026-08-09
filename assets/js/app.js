/**
 * Vanilla JavaScript SPA Application Controller & Router
 * Unified Education Platform (PHP 8.3 Native + MySQL + HTML5/CSS3/Vanilla JS)
 */
class AppController {
  constructor() {
    this.currentView = 'teacher-1';
    this.mainContainer = document.getElementById('app-main-content');
    this.rolePills = document.querySelectorAll('[data-role-view]');
    this.controllerInstance = null;
  }

  async init() {
    this.attachNavigationListeners();
    await this.loadCurrentView();
  }

  attachNavigationListeners() {
    this.rolePills.forEach(pill => {
      pill.addEventListener('click', async (e) => {
        const view = e.currentTarget.getAttribute('data-role-view');
        if (view) {
          this.rolePills.forEach(p => p.classList.remove('active'));
          e.currentTarget.classList.add('active');
          this.currentView = view;
          await this.loadCurrentView();
        }
      });
    });
  }

  async loadCurrentView() {
    if (!this.mainContainer) return;

    this.mainContainer.innerHTML = `
      <div style="text-align: center; padding: 4rem 1rem;">
        <div style="width: 3rem; height: 3rem; border: 4px solid #e2e8f0; border-top-color: #059669; border-radius: 9999px; margin: 0 auto; animation: spin 1s linear infinite;"></div>
        <h3 style="font-weight: 800; margin-top: 1rem; color: #0f172a;">جاري تحميل الواجهة من سيرفر PHP 8.3 Native...</h3>
        <p style="font-size: 0.8rem; color: #64748b; margin-top: 0.25rem;">عزل بيانات كامل للمدرس (Multi-Tenant) • حسابات موحدة للطلاب وأولياء الأمور</p>
      </div>
    `;

    try {
      let data = null;

      if (this.currentView === 'teacher-1' || this.currentView === 'staff') {
        data = await ApiClient.getTeacherData(1);
        this.controllerInstance = new TeacherController(this.mainContainer, data, () => this.loadCurrentView());
      } else if (this.currentView === 'teacher-2') {
        data = await ApiClient.getTeacherData(2);
        this.controllerInstance = new TeacherController(this.mainContainer, data, () => this.loadCurrentView());
      } else if (this.currentView === 'student') {
        data = await ApiClient.getStudentData(1);
        this.controllerInstance = new StudentController(this.mainContainer, data);
      } else if (this.currentView === 'parent') {
        data = await ApiClient.getParentData(5, 1);
        this.controllerInstance = new ParentController(this.mainContainer, data, async (newChildId) => {
          const newData = await ApiClient.getParentData(5, newChildId);
          this.controllerInstance.data = newData;
          this.controllerInstance.render();
        });
      } else if (this.currentView === 'super_admin') {
        data = await ApiClient.getSuperAdminData();
        this.controllerInstance = new SuperAdminController(this.mainContainer, data, () => this.loadCurrentView());
      }

      if (this.controllerInstance) {
        this.controllerInstance.render();
      }

    } catch (error) {
      console.error("View loading error:", error);
      this.mainContainer.innerHTML = `
        <div style="background: #ffe4e6; border: 1px solid #fecdd3; border-radius: 1rem; padding: 2rem; text-align: center; margin-top: 2rem;">
          <h3 style="color: #9f1239; font-weight: 800; font-size: 1.25rem;">تعذر الاتصال بسيرفر PHP في البيئة الحالية</h3>
          <p style="color: #e11d48; font-size: 0.85rem; margin-top: 0.5rem;">${error.message}</p>
          <p style="color: #64748b; font-size: 0.75rem; margin-top: 1rem;">يرجى التأكد من رفع ملفات <strong>cpanel-php-dist/</strong> على سيرفر cPanel المشترك وتشغيل قاعدة بيانات MySQL المرفقة في <code>schema.sql</code>.</p>
          <button class="btn btn-primary" onclick="window.location.reload()" style="margin-top: 1rem;">إعادة المحاولة</button>
        </div>
      `;
    }
  }
}

// Start Application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const app = new AppController();
  app.init();
});
