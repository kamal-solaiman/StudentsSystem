/**
 * Public Landing Page Controller
 * Handles smooth scroll, FAQ accordion, mobile menu,
 * Login/Register button wiring, and visibility management.
 */
class LandingController {
  constructor() {
    this.landingEl = document.getElementById('landing-page');
    this.appContentEl = document.getElementById('app-main-content');
    this.appNavbarEl = document.getElementById('app-navbar');
  }

  /**
   * Show the landing page and hide the authenticated app shell.
   */
  show() {
    if (this.landingEl) {
      this.landingEl.classList.remove('is-hidden');
    }
    if (this.appContentEl) {
      this.appContentEl.classList.add('is-hidden-by-landing');
    }
    if (this.appNavbarEl) {
      this.appNavbarEl.style.display = 'none';
    }
    document.body.classList.add('landing-active');
    this.attachListeners();
  }

  /**
   * Hide the landing page and reveal the authenticated app shell.
   */
  hide() {
    if (this.landingEl) {
      this.landingEl.classList.add('is-hidden');
    }
    if (this.appContentEl) {
      this.appContentEl.classList.remove('is-hidden-by-landing');
    }
    if (this.appNavbarEl) {
      this.appNavbarEl.style.display = '';
    }
    document.body.classList.remove('landing-active');
  }

  attachListeners() {
    if (this._listenersAttached) return;
    this._listenersAttached = true;

    this.attachSmoothScroll();
    this.attachFaqAccordion();
    this.attachMobileMenu();
    this.attachAuthButtons();
    this.attachScrollSpy();
  }

  attachSmoothScroll() {
    const links = document.querySelectorAll('.landing-nav-link, .landing-footer-col a[href^="#"]');
    links.forEach(link => {
      link.addEventListener('click', (e) => {
        const href = link.getAttribute('href') || '';
        if (!href.startsWith('#')) return;
        const target = document.querySelector(href);
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        this.closeMobileMenu();
      });
    });
  }

  attachFaqAccordion() {
    const items = document.querySelectorAll('.landing-faq-item');
    items.forEach(item => {
      const q = item.querySelector('.landing-faq-q');
      if (!q) return;
      q.addEventListener('click', () => {
        const isOpen = item.classList.contains('is-open');
        // Close all
        items.forEach(i => i.classList.remove('is-open'));
        // Open the clicked one if it was closed
        if (!isOpen) {
          item.classList.add('is-open');
        }
      });
    });
  }

  attachMobileMenu() {
    const toggle = document.getElementById('landing-mobile-toggle');
    const menu = document.getElementById('landing-mobile-menu');
    if (!toggle || !menu) return;
    toggle.addEventListener('click', () => {
      menu.classList.toggle('is-open');
    });
  }

  closeMobileMenu() {
    const menu = document.getElementById('landing-mobile-menu');
    if (menu) menu.classList.remove('is-open');
  }

  attachAuthButtons() {
    // All buttons that should trigger the login form (anywhere on the landing page)
    const loginBtns = document.querySelectorAll('[data-landing-action="login"]');
    loginBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.router) {
          window.router.navigate('/login');
        } else {
          this.hide();
          if (window.app && typeof window.app.showLoginForm === 'function') {
            window.app.showLoginForm();
          }
          // Scroll to top to make sure the login form is in view
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    });

    // Public registration has its own direct/refresh-safe SPA route.
    const registerBtns = document.querySelectorAll('[data-landing-action="register"]');
    registerBtns.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        if (window.router) {
          await window.router.navigate('/register');
        } else if (window.app && typeof window.app.showRegistration === 'function') {
          await window.app.showRegistration();
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  }

  attachScrollSpy() {
    const sections = document.querySelectorAll('.landing-section[id]');
    const navLinks = document.querySelectorAll('.landing-nav-link');
    if (!sections.length || !navLinks.length) return;

    const onScroll = () => {
      const scrollY = window.scrollY + 120;
      let current = '';
      sections.forEach(sec => {
        if (sec.offsetTop <= scrollY) {
          current = sec.id;
        }
      });
      navLinks.forEach(link => {
        link.classList.toggle('is-active', link.getAttribute('href') === '#' + current);
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
}

// Expose globally so the AppController can call into it after a successful login
window.LandingController = LandingController;
