/**
 * JavaScript SPA Application Controller & Router
 * Security Hardening Phase 1: Authentication state handling
 *
 * Role-Aware Dashboard Routing:
 * The router is driven by the user's role (captured from the login response
 * and persisted in sessionStorage for refresh resilience), not by a hard-coded
 * view key. The Super Admin, teacher, staff, student, and parent branches each
 * resolve to the correct API endpoint and the correct controller.
 */
class AppController {
  constructor() {
    // currentView is kept as an internal UI-state default for the teacher
    // dashboard (it is only consulted AFTER the role has been resolved to
    // 'teacher' or 'staff'). It is intentionally not used as a global default
    // for routing anymore.
    this.currentView = 'teacher-1';

    this.mainContainer = document.getElementById('app-main-content');
    this.rolePills = document.querySelectorAll('[data-role-view]');
    this.controllerInstance = null;

    this.isAuthenticated = false;
    this.currentUser = null;

    // Captured role — set on successful login and on a successful session
    // probe. Used by loadCurrentView() to pick the right API + controller.
    this._cachedRole = null;

    this.landing = new LandingController();
  }

  async init() {
    this.attachNavigationListeners();
    this.setLandingYear();
    await this.checkAuthStatus();
    await this.bootstrapView();
  }

  setLandingYear() {
    const yearEl = document.getElementById('landing-year');
    if (yearEl) {
      yearEl.textContent = new Date().getFullYear();
    }
  }

  /**
   * Try to identify the currently-authenticated user.
   *
   * Two stages:
   *   1. If we have a cached role from a previous login in this session,
   *      probe the role-appropriate endpoint to confirm the session is
   *      still valid. If it works, the user is authenticated.
   *   2. If we have no cached role, no session is recognized, and the
   *      user is treated as a public visitor.
   */
  async checkAuthStatus() {
    this._cachedRole = null;
    this.currentUser = null;
    this.isAuthenticated = false;

    let cachedRole = null;
    try {
      if (typeof sessionStorage !== 'undefined') {
        cachedRole = sessionStorage.getItem('user_role');
      }
    } catch (e) {
      cachedRole = null;
    }

    if (!cachedRole) {
      return;
    }

    const probe = await this._probeForRole(cachedRole);
    if (probe && probe.success) {
      this._cachedRole = cachedRole;
      this.currentUser = probe.user || this.currentUser;
      this.isAuthenticated = true;
    } else {
      // Cached role did not match a live session — clear it.
      this._clearCachedRole();
    }
  }

  /**
   * Hit a single, role-appropriate GET endpoint to confirm the session
   * is alive. Returns the JSON body on success, null on failure.
   * Never throws — all errors are caught.
   */
  async _probeForRole(role) {
    try {
      switch (role) {
        case 'super_admin':
          return await ApiClient.getSuperAdminData();
        case 'teacher':
        case 'staff':
          return await ApiClient.getTeacherData();
        case 'student':
          return await ApiClient.getStudentData();
        case 'parent':
          return await ApiClient.getParentData();
        default:
          return null;
      }
    } catch (e) {
      return null;
    }
  }

  /**
   * Persist the role for the current browser session so a page refresh
   * can route the user to the right dashboard without a fresh login.
   */
  _setCachedRole(role) {
    this._cachedRole = role;
    try {
      if (typeof sessionStorage !== 'undefined' && role) {
        sessionStorage.setItem('user_role', role);
      }
    } catch (e) {
      // sessionStorage unavailable — fall back to in-memory only
    }
  }

  _clearCachedRole() {
    this._cachedRole = null;
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem('user_role');
      }
    } catch (e) {
      // ignore
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

  /**
   * Decide whether to show the public landing page or the authenticated app shell.
   */
  async bootstrapView() {
    if (!this.isAuthenticated) {
      this.landing.show();
      return;
    }

    this.landing.hide();
    await this.loadCurrentView();
  }

  /**
   * Resolve the effective user role for routing purposes.
   * Priority: explicit cached role (set on login or after a successful probe).
   */
  _resolveRole() {
    if (this._cachedRole) {
      return this._cachedRole;
    }
    return null;
  }

  async loadCurrentView() {
    if (!this.mainContainer) return;

    this.mainContainer.innerHTML = `
      <div style="text-align: center; padding: 4rem 1rem;">
        <div style="width: 3rem; height: 3rem; border: 4px solid #e2e8f0; border-top-color: #059669; border-radius: 9999px; margin: 0 auto; animation: spin 1s linear infinite;"></div>
        <h3 style="font-weight: 800; margin-top: 1rem; color: #0f172a;">جاري التحميل...</h3>
      </div>
    `;

    // Re-confirm auth (in case the session expired between views).
    await this.checkAuthStatus();

    if (!this.isAuthenticated) {
      this.showLoginForm();
      return;
    }

    const role = this._resolveRole();

    try {
      let data = null;

      // Role-aware routing. The role comes from the backend (login response)
      // and is the single source of truth for which dashboard to open.
      switch (role) {
        case 'super_admin':
          data = await ApiClient.getSuperAdminData();
          this.controllerInstance = new SuperAdminController(
            this.mainContainer, data, () => this.loadCurrentView()
          );
          break;

        case 'teacher':
        case 'staff':
          data = await ApiClient.getTeacherData();
          this.controllerInstance = new TeacherController(
            this.mainContainer, data, () => this.loadCurrentView()
          );
          break;

        case 'student':
          data = await ApiClient.getStudentData();
          this.controllerInstance = new StudentController(
            this.mainContainer, data
          );
          break;

        case 'parent':
          data = await ApiClient.getParentData();
          this.controllerInstance = new ParentController(
            this.mainContainer, data, async (newChildId) => {
              const newData = await ApiClient.getParentData(null, newChildId);
              this.controllerInstance.data = newData;
              this.controllerInstance.render();
            }
          );
          break;

        default:
          // Unknown / unsupported role: clear the invalid authentication
          // state and return the visitor to the public landing page.
          console.warn('Unknown role for routing:', role);
          this._handleInvalidRole();
          return;
      }

      if (this.controllerInstance) {
        this.controllerInstance.render();
      }

    } catch (error) {
      console.error("View loading error:", error);
      this.mainContainer.innerHTML = `
        <div style="background: #ffe4e6; border: 1px solid #fecdd3; border-radius: 1rem; padding: 2rem; text-align: center; margin-top: 2rem;">
          <h3 style="color: #9f1239; font-weight: 800; font-size: 1.25rem;">تعذر الاتصال بالخادم</h3>
          <p style="color: #e11d48; font-size: 0.85rem; margin-top: 0.5rem;">${error.message}</p>
          <p style="color: #64748b; font-size: 0.75rem; margin-top: 1rem;">يرجى المحاولة مرة أخرى لاحقاً.</p>
          <button class="btn btn-primary" onclick="window.location.reload()" style="margin-top: 1rem;">إعادة المحاولة</button>
        </div>
      `;
    }
  }

  /**
   * Clear any invalid/stale auth state and return the user to the landing page.
   * Used when a logged-in user has a role we cannot route.
   */
  _handleInvalidRole() {
    this._clearCachedRole();
    this.isAuthenticated = false;
    this.currentUser = null;
    this.controllerInstance = null;
    if (this.landing) {
      this.landing.show();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  showLoginForm() {
    if (this.landing) {
      this.landing.hide();
    }
    if (this.mainContainer) {
      this.mainContainer.classList.remove('is-hidden-by-landing');
    }

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
        
        <button type="button" id="back-to-landing-btn" style="width: 100%; padding: 0.65rem; background: #f1f5f9; color: #0f172a; border: 1px solid #e2e8f0; border-radius: 0.5rem; font-size: 0.85rem; font-weight: 700; cursor: pointer;">
          العودة إلى الصفحة الرئيسية
        </button>
        
        <div id="login-error" style="color: #e11d48; font-size: 0.85rem; text-align: center; display: none; margin-top: 1rem;"></div>
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

    const backBtn = document.getElementById('back-to-landing-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        this.logoutAndReturnToLanding();
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
        // Capture the role returned by the backend (single source of truth).
        // The role is the basis for dashboard routing on this load and on
        // any subsequent page refresh in the same browser session.
        const role = (response.user && response.user.role) ? String(response.user.role) : null;
        this._setCachedRole(role);
        if (this.landing) {
          this.landing.hide();
        }
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

  /**
   * Reset the local session state and return the visitor to the public landing page.
   */
  logoutAndReturnToLanding() {
    this._clearCachedRole();
    this.isAuthenticated = false;
    this.currentUser = null;
    this.controllerInstance = null;
    this.currentView = 'teacher-1';
    if (this.landing) {
      this.landing.show();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// Start Application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const app = new AppController();
  window.app = app; // Expose for LandingController cross-talk
  app.init();
});
