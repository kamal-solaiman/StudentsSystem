/**
 * Unified Education Platform - SPA Router (HTML5 History API)
 * Pure Vanilla JavaScript Client-Side Router
 *
 * Supports:
 * - Dynamic Base Path resolution (/110/ in production cPanel or / in root environments)
 * - HTML5 History API (pushState, replaceState, window.onpopstate)
 * - Navigation Guards (beforeEach for Authentication & RBAC Role checks)
 * - Parameterized inner dashboard routes (/teacher/:tab, /student/:tab, /parent/:tab)
 * - Graceful 404 / Invalid Route Fallback
 */
class AppRouter {
  constructor(options = {}) {
    this.routes = [];
    this.currentRoute = null;
    this.beforeHooks = [];
    this.notFoundHandler = null;
    this._navId = 0;

    // Detect base path: if running in /110/ subfolder on cPanel, use '/110', else ''
    this.basePath = options.basePath !== undefined
      ? options.basePath
      : (window.location.pathname.startsWith('/110') ? '/110' : '');

    this._onPopState = this._onPopState.bind(this);
  }

  /**
   * Register a route pattern and its handler.
   * Pattern can be exact: '/', '/login', '/super-admin'
   * Or parameterized: '/teacher/:tab', '/student/:tab', '/parent/:tab', '/staff/:tab'
   */
  addRoute(pattern, handler, meta = {}) {
    const paramNames = [];
    const cleanPattern = pattern.trim().replace(/\/+$/, '') || '';

    const regexPattern = cleanPattern === ''
      ? ''
      : cleanPattern.replace(/:([a-zA-Z0-9_]+)/g, (_, name) => {
          paramNames.push(name);
          return '([^/]+)';
        });

    const regex = new RegExp(`^${regexPattern === '' ? '' : regexPattern}/?$`);

    this.routes.push({
      pattern,
      regex,
      paramNames,
      handler,
      meta
    });
    return this;
  }

  /**
   * Register a global navigation guard executed before route resolution.
   * Returning a string redirects to that route. Returning false cancels navigation.
   */
  beforeEach(hook) {
    this.beforeHooks.push(hook);
    return this;
  }

  /**
   * Register fallback 404 handler for unknown routes.
   */
  onNotFound(handler) {
    this.notFoundHandler = handler;
    return this;
  }

  /**
   * Initialize the router and attach browser popstate listener.
   */
  async init() {
    window.removeEventListener('popstate', this._onPopState);
    window.addEventListener('popstate', this._onPopState);
    return await this.resolve();
  }

  /**
   * Clean up event listeners.
   */
  destroy() {
    window.removeEventListener('popstate', this._onPopState);
  }

  /**
   * Convert an internal route path (e.g. '/teacher/exams') to full browser path (e.g. '/110/teacher/exams')
   */
  toFullPath(path) {
    let clean = (path || '/').trim();
    if (!clean.startsWith('/')) clean = '/' + clean;
    return (this.basePath + clean).replace(/\/+/g, '/') || '/';
  }

  /**
   * Extract internal route path from full browser pathname.
   * Example: '/110/teacher/exams' -> '/teacher/exams'
   */
  toRoutePath(fullPath) {
    let path = fullPath !== undefined ? fullPath : window.location.pathname;
    if (this.basePath && path.startsWith(this.basePath)) {
      path = path.slice(this.basePath.length);
    }
    if (!path.startsWith('/')) path = '/' + path;
    // Normalize trailing slash except for root '/'
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }
    return path || '/';
  }

  /**
   * Navigate to a new route using History API pushState/replaceState
   */
  async navigate(path, options = {}) {
    const routePath = this.toRoutePath(path);
    const fullPath = this.toFullPath(routePath);
    const replace = options.replace === true;

    if (replace) {
      window.history.replaceState({ path: routePath }, '', fullPath);
    } else {
      window.history.pushState({ path: routePath }, '', fullPath);
    }

    if (options.trigger !== false) {
      return await this.resolve(routePath);
    }
  }

  /**
   * Convenience shortcut for replaceState navigation
   */
  async replace(path, options = {}) {
    return await this.navigate(path, { ...options, replace: true });
  }

  /**
   * Popstate handler for browser Back / Forward buttons
   */
  async _onPopState() {
    const routePath = this.toRoutePath(window.location.pathname);
    await this.resolve(routePath);
  }

  /**
   * Match a route path against registered routes
   */
  match(routePath) {
    const normalized = routePath === '' ? '/' : routePath;
    for (const route of this.routes) {
      const match = normalized.match(route.regex);
      if (match) {
        const params = {};
        route.paramNames.forEach((name, index) => {
          params[name] = match[index + 1];
        });
        return {
          route,
          params,
          path: normalized
        };
      }
    }
    return null;
  }

  /**
   * Resolve and execute the handler for the current or given route path
   */
  async resolve(routePath) {
    const currentNavId = ++this._navId;

    try {
      const path = routePath !== undefined ? this.toRoutePath(routePath) : this.toRoutePath(window.location.pathname);
      const matchResult = this.match(path);

      if (!matchResult) {
        if (this.notFoundHandler) {
          await this.notFoundHandler(path);
        } else {
          await this.replace('/');
        }
        return;
      }

      // Execute global beforeEach navigation guards
      for (const hook of this.beforeHooks) {
        const redirect = await hook(matchResult);
        if (currentNavId !== this._navId) return; // Superseded by a newer navigation

        if (typeof redirect === 'string') {
          return await this.replace(redirect);
        }
        if (redirect === false) {
          return;
        }
      }

      if (currentNavId !== this._navId) return; // Superseded

      this.currentRoute = matchResult;
      await matchResult.route.handler(matchResult.params, matchResult);

    } catch (err) {
      console.error('AppRouter resolve error:', err);
    }
  }
}

// Expose globally
window.AppRouter = AppRouter;
