/**
 * Vanilla JavaScript SPA Application Controller & Router
 * Unified Education Platform (PHP 8.3 Native + MySQL + HTML5/CSS3/Vanilla JS)
 * Security Hardening Phase 1: Authentication state handling
 */
class AppController {
  constructor() {
    this.currentView = 'teacher-1';
    this.mainContainer = document.getElementById('app-main-content');
    this.rolePills = document.querySelectorAll('[data-role-view]');
    this.controllerInstance = null;
    this.isAuthenticated = false;
    this.currentUser = null;
  }

  async init() {
    this.attachNavigationListeners();
    await this.checkAuthStatus();
    await this.loadCurrentView();
  }

  async checkAuthStatus() {
    try {
      const response = await ApiClient.getTeacherData();
      if (response.success) {
        this.isAuthenticated = true;
        this.currentUser = response.user || null;
      }
    } catch (error) {
      if (error.message && error.message.includes('Authentication required')) {
        this.isAuthenticated = false;
        this.currentUser = null;
      }
    }
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

    await this.checkAuthStatus();

    if (!this.isAuthenticated) {
      this.showLoginForm();
      return;
    }

    try {
      let data = null;

      if (this.currentView === 'teacher-1' || this.currentView === 'staff') {
        data = await ApiClient.getTeacherData();
        this.controllerInstance = new TeacherController(this.mainContainer, data, () => this.loadCurrentView());
      } else if (this.currentView === 'teacher-2') {
        data = await ApiClient.getTeacherData();
        this.controllerInstance = new TeacherController(this.mainContainer, data, () => this.loadCurrentView());
      } else if (this.currentView === 'student') {
        data = await ApiClient.getStudentData();
        this.controllerInstance = new StudentController(this.mainContainer, data);
      } else if (this.currentView === 'parent') {
        data = await ApiClient.getParentData();
        this.controllerInstance = new ParentController(this.mainContainer, data, async (newChildId) => {
          const newData = await ApiClient.getParentData(null, newChildId);
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

  showLoginForm() {
    this.mainContainer.innerHTML = `
      <div style="max-width: 400px; margin: 4rem auto; padding: 2rem; background: #fff; border-radius: 1rem; box-shadow: 0 10px 25px rgba(0,0,0,0.1);">
        <h2 style="text-align: center; font-weight: 800; color: #0f172a; margin-bottom: 1.5rem;">تسجيل الدخول</h2>
        
        <div style="margin-bottom: 1.5rem;">
          <label style="display: block; font-size: 0.85rem; font-weight: 700; color: #0f172a; margin-bottom: 0.5rem;">البريد الإلكتروني</label>
          <input type="email" id="login-email" placeholder="ادخل البريد الإلكتروني" style="width: 100%; padding: 0.75rem; border: 1px solid #e2e8f0; border-radius: 0.5rem; font-size: 0.9rem;" required>
        </div>
        
        <div style="margin-bottom: 1.5rem;">
          <label style="display: block; font-size: 0.85rem; font-weight: 700; color: #0f172a; margin-bottom: 0.5rem;">كلمة المرور</label>
          <input type="password" id="login-password" placeholder="ادخل كلمة المرور" style="width: 100%; padding: 0.75rem; border: 1px solid #e2e8f0; border-radius: 0.5rem; font-size: 0.9rem;" required>
        </div>
        
        <button id="login-btn" style="width: 100%; padding: 0.75rem; background: #059669; color: #fff; border: none; border-radius: 0.5rem; font-size: 0.9rem; font-weight: 700; cursor: pointer; margin-bottom: 1rem;">
          تسجيل الدخول
        </button>
        
        <div id="login-error" style="color: #e11d48; font-size: 0.85rem; text-align: center; display: none;"></div>
        
        <div style="text-align: center; font-size: 0.8rem; color: #64748b; margin-top: 1.5rem;">
          <p>بيانات تسجيل الدخول:</p>
          <p><strong>البريد:</strong> admin@platform.edu / <strong>كلمة المرور:</strong> password</p>
          <p><strong>البريد:</strong> ahmed@physics.edu / <strong>كلمة المرور:</strong> password</p>
          <p><strong>البريد:</strong> sara@math.edu / <strong>كلمة المرور:</strong> password</p>
        </div>
      </div>
    `;

    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
      loginBtn.addEventListener('click', async () => {
        await this.handleLogin();
      });
    }
    
    const passwordInput = document.getElementById('login-password');
    if (passwordInput) {
      passwordInput.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
          await this.handleLogin();
        }
      });
    }
  }

  async handleLogin() {
    const email = document.getElementById('login-email')?.value || '';
    const password = document.getElementById('login-password')?.value || '';
    const errorDiv = document.getElementById('login-error');

    if (!email || !password) {
      if (errorDiv) {
        errorDiv.textContent = 'الرجاء إدخال البريد الإلكتروني وكلمة المرور';
        errorDiv.style.display = 'block';
      }
      return;
    }

    try {
      const response = await ApiClient.login(email, password);
      if (response.success) {
        this.isAuthenticated = true;
        this.currentUser = response.user;
        await this.loadCurrentView();
      } else {
        if (errorDiv) {
          errorDiv.textContent = response.message || 'Failed to login';
          errorDiv.style.display = 'block';
        }
      }
    } catch (error) {
      if (errorDiv) {
        errorDiv.textContent = error.message || 'حدث خطأ أثناء تسجيل الدخول';
        errorDiv.style.display = 'block';
      }
    }
  }
}

// Start Application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const app = new AppController();
  app.init();
});
