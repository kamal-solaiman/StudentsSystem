/**
 * JavaScript SPA Application Controller & History API Router Integration
 * Security Hardening Phase 1: Authentication state handling & RBAC
 *
 * Client-Side URL Routing Architecture:
 * - HTML5 History API (pushState, replaceState, popstate)
 * - Base path: /110/ (cPanel production) or / (root environments)
 * - Role-Aware Routing: backend response.user.role drives dashboard selection
 * - Inner Dashboard Tabs: parameterized routes (/teacher/:tab, /student/:tab, /parent/:tab)
 */
class AppController {
  constructor() {
    this.currentView = 'teacher-1';

    this.mainContainer = document.getElementById('app-main-content');
    this.rolePills = document.querySelectorAll('[data-role-view]');
    this.controllerInstance = null;

    this.isAuthenticated = false;
    this.currentUser = null;
    this._cachedRole = null;
    this.isLoggingOut = false;

    this.landing = new LandingController();
    this.router = new AppRouter();
  }

  async init() {
    this.attachNavigationListeners();
    this.attachLogoutListener();
    this.setLandingYear();
    this.setupRouter();
    await this.router.init();
  }

  setLandingYear() {
    const yearEl = document.getElementById('landing-year');
    if (yearEl) {
      yearEl.textContent = new Date().getFullYear();
    }
  }

  /**
   * Configure all application routes, guards, and handlers
   */
  setupRouter() {
    // Global Navigation Guard (Auth & Role Check)
    this.router.beforeEach(async (to) => {
      // Confirm auth status with session probe
      await this.checkAuthStatus();

      const isPublic = to.route.meta && to.route.meta.public === true;
      const requiredRole = to.route.meta && to.route.meta.role;

      // 1. Unauthenticated user trying to access protected route -> redirect to /login
      if (!isPublic && !this.isAuthenticated) {
        return '/login';
      }

      // 2. Authenticated user visiting /login -> redirect to their role dashboard
      if (this.isAuthenticated && to.path === '/login') {
        return this.getDashboardRouteForRole(this._resolveRole());
      }

      // 3. Role authorization check for protected dashboard routes
      if (this.isAuthenticated && requiredRole) {
        const userRole = this._resolveRole();
        const isAllowed = Array.isArray(requiredRole)
          ? requiredRole.includes(userRole)
          : (requiredRole === userRole || (requiredRole === 'teacher' && userRole === 'staff') || (requiredRole === 'staff' && userRole === 'teacher'));

        if (!isAllowed) {
          console.warn(`Role mismatch: user role '${userRole}' cannot access route requiring '${requiredRole}'`);
          return this.getDashboardRouteForRole(userRole);
        }
      }

      return true; // proceed with navigation
    });

    // Public Routes
    this.router.addRoute('/', async () => {
      this.controllerInstance = null;
      this.setLogoutButtonVisibility(false);
      if (this.landing) {
        this.landing.show();
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, { public: true });

    this.router.addRoute('/login', async () => {
      this.controllerInstance = null;
      this.setLogoutButtonVisibility(false);
      this.showLoginForm();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, { public: true });

    // Super Admin Dashboard Route
    this.router.addRoute('/super-admin', async () => {
      await this.loadSuperAdminDashboard();
    }, { role: 'super_admin' });

    // Teacher Dashboard Routes (with inner tabs)
    this.router.addRoute('/teacher', async () => {
      await this.loadTeacherDashboard('overview');
    }, { role: ['teacher', 'staff'] });

    this.router.addRoute('/teacher/:tab', async (params) => {
      await this.loadTeacherDashboard(params.tab || 'overview');
    }, { role: ['teacher', 'staff'] });

    // Staff Dashboard Routes (aliases to Teacher Dashboard with staff role permissions)
    this.router.addRoute('/staff', async () => {
      await this.loadTeacherDashboard('overview');
    }, { role: ['staff', 'teacher'] });

    this.router.addRoute('/staff/:tab', async (params) => {
      await this.loadTeacherDashboard(params.tab || 'overview');
    }, { role: ['staff', 'teacher'] });

    // Student Dashboard Routes (with inner tabs)
    this.router.addRoute('/student', async () => {
      await this.loadStudentDashboard('overview');
    }, { role: 'student' });

    this.router.addRoute('/student/:tab', async (params) => {
      await this.loadStudentDashboard(params.tab || 'overview');
    }, { role: 'student' });

    // Parent Dashboard Routes (with inner tabs)
    this.router.addRoute('/parent', async () => {
      await this.loadParentDashboard('overview');
    }, { role: 'parent' });

    this.router.addRoute('/parent/:tab', async (params) => {
      await this.loadParentDashboard(params.tab || 'overview');
    }, { role: 'parent' });

    // Fallback handler for invalid / unknown routes
    this.router.onNotFound(async (path) => {
      console.warn('Route not found:', path);
      if (this.isAuthenticated) {
        await this.router.replace(this.getDashboardRouteForRole(this._resolveRole()));
      } else {
        await this.router.replace('/');
      }
    });
  }

  /**
   * Determine default dashboard route for a given user role
   */
  getDashboardRouteForRole(role) {
    switch (role) {
      case 'super_admin':
        return '/super-admin';
      case 'teacher':
      case 'staff':
        return '/teacher';
      case 'student':
        return '/student';
      case 'parent':
        return '/parent';
      default:
        return '/';
    }
  }

  /**
   * Identify currently-authenticated user via cached role + session probe
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
      // Cached role did not match a live backend session — clear it
      this._clearCachedRole();
    }
  }

  /**
   * Probe role-appropriate endpoint to verify active session
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

  _setCachedRole(role) {
    this._cachedRole = role;
    try {
      if (typeof sessionStorage !== 'undefined' && role) {
        sessionStorage.setItem('user_role', role);
      }
    } catch (e) {
      // ignore
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

  _resolveRole() {
    return this._cachedRole || (this.currentUser && this.currentUser.role) || null;
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

  setLogoutButtonVisibility(visible) {
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.hidden = !visible;
      // NOTE: `.btn { display: inline-flex }` in style.css overrides the
      // `hidden` attribute's UA default of `display: none`, so the attribute
      // alone does NOT hide the button (stale label stayed visible on /login).
      // Force the display state explicitly to guarantee it is hidden/shown.
      logoutBtn.style.display = visible ? '' : 'none';
    }
  }

  /**
   * Set the logout button idle / busy UI state.
   * Single source of truth so the button can never be left stuck in
   * 'جارٍ تسجيل الخروج...' regardless of how the request finishes.
   */
  setLogoutButtonState(btn, busy) {
    const label = btn ? btn.querySelector('[data-logout-label]') : null;
    btn.disabled = busy;
    if (busy) {
      btn.setAttribute('aria-busy', 'true');
      if (label) {
        label.textContent = 'جارٍ تسجيل الخروج...';
      }
    } else {
      btn.removeAttribute('aria-busy');
      if (label) {
        label.textContent = 'تسجيل الخروج';
      }
    }
  }

  attachLogoutListener() {
    const logoutBtn = document.getElementById('logout-btn');
    // Idempotent guard: never attach a second click handler to the same button.
    if (!logoutBtn || logoutBtn.dataset.logoutListenerAttached === 'true') {
      return;
    }
    logoutBtn.dataset.logoutListenerAttached = 'true';
    logoutBtn.addEventListener('click', async () => {
      await this.handleLogout(logoutBtn);
    });
  }

  async handleLogout(logoutBtn) {
    // Re-entrancy guard: no second logout request while one is in flight.
    if (this.isLoggingOut) return;

    this.isLoggingOut = true;
    this.setLogoutButtonState(logoutBtn, true);

    try {
      const response = await ApiClient.logout();
      if (!response || response.success !== true) {
        throw new Error(response && response.message ? response.message : 'فشل تسجيل الخروج');
      }

      // Only clear the browser state after the server confirms session destruction.
      await this.logoutAndReturnToLanding();
    } catch (error) {
      // Failure path (server error, HTTP error, network error, exception):
      // surface a message and leave the button usable again.
      console.error('Logout error:', error);
      alert('تعذر تسجيل الخروج: ' + (error.message || 'يرجى المحاولة مرة أخرى'));
    } finally {
      // ALWAYS restore the button to its idle state — success, failure,
      // HTTP error, network error or unexpected exception alike.
      // (On success logoutAndReturnToLanding() also hides the button, so the
      // restored label is never visible until the next dashboard visit.)
      this.setLogoutButtonState(logoutBtn, false);
      this.isLoggingOut = false;
    }
  }

  showLoadingSpinner() {
    if (!this.mainContainer) return;
    this.mainContainer.innerHTML = `
      <div style="text-align: center; padding: 4rem 1rem;">
        <div style="width: 3rem; height: 3rem; border: 4px solid #e2e8f0; border-top-color: #059669; border-radius: 9999px; margin: 0 auto; animation: spin 1s linear infinite;"></div>
        <h3 style="font-weight: 800; margin-top: 1rem; color: #0f172a;">جاري التحميل...</h3>
      </div>
    `;
  }

  renderError(error) {
    if (!this.mainContainer) return;
    this.mainContainer.innerHTML = `
      <div style="background: #ffe4e6; border: 1px solid #fecdd3; border-radius: 1rem; padding: 2rem; text-align: center; margin-top: 2rem;">
        <h3 style="color: #9f1239; font-weight: 800; font-size: 1.25rem;">تعذر الاتصال بالخادم</h3>
        <p style="color: #e11d48; font-size: 0.85rem; margin-top: 0.5rem;">${error.message || 'حدث خطأ أثناء تحميل البيانات'}</p>
        <p style="color: #64748b; font-size: 0.75rem; margin-top: 1rem;">يرجى المحاولة مرة أخرى لاحقاً.</p>
        <button class="btn btn-primary" onclick="window.location.reload()" style="margin-top: 1rem;">إعادة المحاولة</button>
      </div>
    `;
  }

  /**
   * Load and render Super Admin Dashboard
   */
  async loadSuperAdminDashboard() {
    if (this.landing) this.landing.hide();
    this.setLogoutButtonVisibility(true);
    this.showLoadingSpinner();
    try {
      const data = await ApiClient.getSuperAdminData();
      this.controllerInstance = new SuperAdminController(
        this.mainContainer, data, () => this.loadSuperAdminDashboard()
      );
      this.controllerInstance.render();
    } catch (error) {
      console.error('Super Admin loading error:', error);
      this.renderError(error);
    }
  }

  /**
   * Load and render Teacher Dashboard with tab activation
   */
  async loadTeacherDashboard(tab = 'overview') {
    if (this.landing) this.landing.hide();
    this.setLogoutButtonVisibility(true);

    const validTabs = ['overview', 'classes', 'groups', 'students', 'attendance', 'exams', 'reports', 'staff', 'settings'];
    const activeTab = validTabs.includes(tab) ? tab : 'overview';

    // If controller instance is already active and holding data, switch tab smoothly without reloading data
    if (this.controllerInstance instanceof TeacherController && this.controllerInstance.data) {
      this.controllerInstance.activeTab = activeTab;
      this.controllerInstance.render();
      return;
    }

    this.showLoadingSpinner();
    try {
      const data = await ApiClient.getTeacherData();
      this.controllerInstance = new TeacherController(
        this.mainContainer, data, () => this.loadTeacherDashboard(activeTab)
      );
      this.controllerInstance.activeTab = activeTab;
      this.controllerInstance.render();
    } catch (error) {
      console.error('Teacher loading error:', error);
      this.renderError(error);
    }
  }

  /**
   * Load and render Student Dashboard with tab activation
   */
  async loadStudentDashboard(tab = 'overview') {
    if (this.landing) this.landing.hide();
    this.setLogoutButtonVisibility(true);

    const validTabs = ['overview', 'schedule', 'homeworks', 'exams', 'lessons', 'subscriptions', 'settings'];
    const activeTab = validTabs.includes(tab) ? tab : 'overview';

    if (this.controllerInstance instanceof StudentController && this.controllerInstance.data) {
      this.controllerInstance.activeTab = activeTab;
      this.controllerInstance.render();
      return;
    }

    this.showLoadingSpinner();
    try {
      const data = await ApiClient.getStudentData();
      this.controllerInstance = new StudentController(
        this.mainContainer, data
      );
      this.controllerInstance.activeTab = activeTab;
      this.controllerInstance.render();
    } catch (error) {
      console.error('Student loading error:', error);
      this.renderError(error);
    }
  }

  /**
   * Load and render Parent Dashboard with tab activation
   */
  async loadParentDashboard(tab = 'overview') {
    if (this.landing) this.landing.hide();
    this.setLogoutButtonVisibility(true);

    const validTabs = ['overview', 'homeworks', 'attendance', 'exams', 'teachers'];
    const activeTab = validTabs.includes(tab) ? tab : 'overview';

    if (this.controllerInstance instanceof ParentController && this.controllerInstance.data) {
      this.controllerInstance.activeTab = activeTab;
      this.controllerInstance.render();
      return;
    }

    this.showLoadingSpinner();
    try {
      const data = await ApiClient.getParentData();
      this.controllerInstance = new ParentController(
        this.mainContainer, data, async (newChildId) => {
          const newData = await ApiClient.getParentData(null, newChildId);
          this.controllerInstance.data = newData;
          this.controllerInstance.selectedChildId = newChildId;
          this.controllerInstance.render();
        }
      );
      this.controllerInstance.activeTab = activeTab;
      this.controllerInstance.render();
    } catch (error) {
      console.error('Parent loading error:', error);
      this.renderError(error);
    }
  }

  /**
   * Compatibility method: navigate to the dashboard route of the current role
   */
  async loadCurrentView() {
    const role = this._resolveRole();
    const targetRoute = this.getDashboardRouteForRole(role);
    if (this.router) {
      await this.router.navigate(targetRoute);
    }
  }

  showLoginForm() {
    if (this.landing) {
      this.landing.hide();
    }
    this.setLogoutButtonVisibility(false);
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
        if (this.router) {
          this.router.navigate('/');
        } else {
          this.logoutAndReturnToLanding();
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
        const role = (response.user && response.user.role) ? String(response.user.role) : null;
        this._setCachedRole(role);

        const targetRoute = this.getDashboardRouteForRole(role);
        if (this.router) {
          await this.router.navigate(targetRoute);
        } else {
          if (this.landing) this.landing.hide();
          await this.loadCurrentView();
        }
      } else {
        if (errorDiv) {
          errorDiv.textContent = response.message || 'فشل تسجيل الدخول';
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
   * Reset browser authentication state after the logout endpoint has destroyed the PHP session.
   */
  async logoutAndReturnToLanding() {
    this._clearCachedRole();
    this.isAuthenticated = false;
    this.currentUser = null;
    this.controllerInstance = null;
    this.currentView = 'teacher-1';
    this.setLogoutButtonVisibility(false);

    // The CSRF token is also cached in memory by ApiClient.
    if (typeof ApiClient !== 'undefined') {
      ApiClient.csrfToken = '';
    }

    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem('csrf_token');
        sessionStorage.removeItem('user_role');
      }
    } catch (e) {
      // ignore
    }

    if (this.mainContainer) {
      this.mainContainer.innerHTML = '';
    }

    if (this.router) {
      // Discard the dashboard route before replacing the current history entry with the landing route.
      this.router.currentRoute = null;
      return await this.router.replace('/');
    }

    if (this.landing) {
      this.landing.show();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

// Start Application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const app = new AppController();
  window.app = app;
  window.router = app.router;
  app.init();
});
