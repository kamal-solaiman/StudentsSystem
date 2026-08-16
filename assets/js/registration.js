/** Public P1-M registration screen. All writes go through ApiClient/register.php. */
class RegistrationController {
  constructor(container, router) {
    this.container = container;
    this.router = router;
    this.subjects = [];
    this.accountType = null;
    this.submitting = false;
  }

  static escape(value) {
    const node = document.createElement('div');
    node.textContent = String(value ?? '');
    return node.innerHTML;
  }

  async init() {
    this.renderLoading();
    try {
      const response = await ApiClient.getRegistrationOptions();
      this.subjects = Array.isArray(response.subjects) ? response.subjects : [];
      this.renderTypeChooser();
    } catch (error) {
      this.renderFatal(error.message || 'تعذر تحميل بيانات التسجيل. يرجى المحاولة مرة أخرى.');
    }
  }

  renderLoading() {
    this.container.innerHTML = '<div class="registration-shell"><div class="registration-card registration-loading">جارٍ تجهيز نموذج التسجيل...</div></div>';
  }

  renderFatal(message) {
    this.container.innerHTML = `
      <div class="registration-shell"><section class="registration-card registration-state" role="alert">
        <div class="registration-state-icon">!</div>
        <h2>تعذر فتح التسجيل</h2>
        <p>${RegistrationController.escape(message)}</p>
        <button type="button" class="btn btn-primary" data-registration-retry>إعادة المحاولة</button>
        <button type="button" class="btn btn-secondary" data-registration-home>العودة للرئيسية</button>
      </section></div>`;
    this.container.querySelector('[data-registration-retry]')?.addEventListener('click', () => this.init());
    this.container.querySelector('[data-registration-home]')?.addEventListener('click', () => this.router.navigate('/'));
  }

  renderTypeChooser() {
    this.accountType = null;
    this.container.innerHTML = `
      <div class="registration-shell">
        <section class="registration-card" aria-labelledby="registration-title">
          <header class="registration-header">
            <span class="registration-eyebrow">انضم إلى المنصة</span>
            <h2 id="registration-title">إنشاء حساب جديد</h2>
            <p>اختر نوع الحساب</p>
          </header>
          <div class="registration-types">
            <button type="button" class="registration-type" data-account-type="teacher"><span>👨‍🏫</span><strong>مدرس</strong><small>إنشاء حساب مدرس</small></button>
            <button type="button" class="registration-type" data-account-type="student"><span>🎓</span><strong>طالب</strong><small>إنشاء حساب طالب</small></button>
            <button type="button" class="registration-type" data-account-type="parent"><span>👨‍👩‍👧</span><strong>ولي أمر</strong><small>إنشاء حساب ولي أمر</small></button>
          </div>
          <div class="registration-footer-links">
            <span>لديك حساب بالفعل؟</span> <button type="button" class="registration-link" data-registration-login>تسجيل الدخول</button>
            <button type="button" class="registration-link" data-registration-home>العودة للرئيسية</button>
          </div>
        </section>
      </div>`;
    this.container.querySelectorAll('[data-account-type]').forEach(button => {
      button.addEventListener('click', () => this.renderForm(button.dataset.accountType));
    });
    this.container.querySelector('[data-registration-login]')?.addEventListener('click', () => this.router.navigate('/login'));
    this.container.querySelector('[data-registration-home]')?.addEventListener('click', () => this.router.navigate('/'));
  }

  field(name, label, type = 'text', options = {}) {
    const required = options.required ? 'required aria-required="true"' : '';
    const autocomplete = options.autocomplete ? ` autocomplete="${options.autocomplete}"` : '';
    const placeholder = options.placeholder ? ` placeholder="${RegistrationController.escape(options.placeholder)}"` : '';
    return `<div class="form-group registration-field">
      <label class="form-label" for="register-${name}">${label}${options.required ? ' <span class="required-mark">*</span>' : ' <span class="optional-mark">(اختياري)</span>'}</label>
      <input class="form-control" id="register-${name}" name="${name}" type="${type}" ${required}${autocomplete}${placeholder}>
    </div>`;
  }

  select(name, label, choices, required = false) {
    return `<div class="form-group registration-field">
      <label class="form-label" for="register-${name}">${label}${required ? ' <span class="required-mark">*</span>' : ' <span class="optional-mark">(اختياري)</span>'}</label>
      <select class="form-control" id="register-${name}" name="${name}" ${required ? 'required aria-required="true"' : ''}>
        <option value="">اختر</option>${choices.map(item => `<option value="${RegistrationController.escape(item.value)}">${RegistrationController.escape(item.label)}</option>`).join('')}
      </select>
    </div>`;
  }

  renderForm(accountType) {
    if (!['student', 'teacher', 'parent'].includes(accountType)) return;
    this.accountType = accountType;
    const labels = { student: 'طالب', teacher: 'مدرس', parent: 'ولي أمر' };
    const sharedPersonal = `
      ${this.field('name', 'الاسم بالكامل', 'text', { required: true, autocomplete: 'name' })}
      ${this.field('phone', 'رقم الموبايل', 'tel', { required: true, autocomplete: 'tel' })}
      ${this.field('email', 'البريد الإلكتروني', 'email', { required: true, autocomplete: 'email' })}
      ${this.field('date_of_birth', 'تاريخ الميلاد', 'date')}
      ${this.select('gender', 'النوع', [{ value: 'male', label: 'ذكر' }, { value: 'female', label: 'أنثى' }])}
      ${this.field('address', 'العنوان', 'text', { autocomplete: 'street-address' })}
      ${accountType === 'student' ? this.field('parent_phone', 'رقم هاتف ولي الأمر', 'tel', { autocomplete: 'tel' }) : ''}
      ${accountType === 'student' ? this.field('student_code', 'كود الطالب إن كان لديك حساب سابق', 'text', { placeholder: 'اتركه فارغاً عند إنشاء حساب جديد' }) : ''}`;

    let professional = '';
    if (accountType === 'teacher') {
      const subjectOptions = this.subjects.map(subject => ({ value: subject.id, label: subject.name }));
      professional = `<fieldset class="registration-section"><legend>البيانات المهنية</legend>
        ${subjectOptions.length ? this.select('subject_id', 'المادة', subjectOptions, true) : '<p class="registration-message registration-message-warning">لا توجد مواد متاحة للتسجيل حالياً. يرجى التواصل مع إدارة المنصة.</p>'}
        <div class="form-group registration-field registration-field-wide"><label class="form-label" for="register-bio">نبذة عن المدرس <span class="optional-mark">(اختياري)</span></label><textarea class="form-control" id="register-bio" name="bio" rows="4" maxlength="2000"></textarea></div>
      </fieldset>`;
    }

    const subjectsUnavailable = accountType === 'teacher' && this.subjects.length === 0;
    this.container.innerHTML = `
      <div class="registration-shell">
        <section class="registration-card registration-form-card" aria-labelledby="registration-title">
          <button type="button" class="registration-back" data-registration-back>→ تغيير نوع الحساب</button>
          <header class="registration-header registration-header-compact">
            <h2 id="registration-title">إنشاء حساب ${labels[accountType]}</h2>
            <p>الحقول المميزة بعلامة * مطلوبة لإنشاء الحساب</p>
          </header>
          <form id="registration-form" novalidate>
            <fieldset class="registration-section"><legend>البيانات الشخصية</legend><div class="registration-grid">${sharedPersonal}</div></fieldset>
            ${professional}
            <fieldset class="registration-section"><legend>بيانات الدخول</legend><div class="registration-grid">
              ${this.field('username', 'اسم المستخدم', 'text', { required: true, autocomplete: 'username', placeholder: 'حروف إنجليزية وأرقام' })}
              ${this.field('password', 'كلمة المرور', 'password', { required: true, autocomplete: 'new-password' })}
              ${this.field('password_confirmation', 'تأكيد كلمة المرور', 'password', { required: true, autocomplete: 'new-password' })}
            </div><p class="registration-password-hint">8 أحرف على الأقل، وتحتوي على حرف ورقم.</p></fieldset>
            <p id="registration-message" class="registration-message" role="alert" aria-live="polite"></p>
            <button type="submit" class="btn btn-primary registration-submit" ${subjectsUnavailable ? 'disabled' : ''}>إنشاء الحساب</button>
          </form>
          <div class="registration-footer-links"><button type="button" class="registration-link" data-registration-login>لديك حساب؟ تسجيل الدخول</button></div>
        </section>
      </div>`;
    this.container.querySelector('[data-registration-back]')?.addEventListener('click', () => this.renderTypeChooser());
    this.container.querySelector('[data-registration-login]')?.addEventListener('click', () => this.router.navigate('/login'));
    this.container.querySelector('#registration-form')?.addEventListener('submit', event => this.submit(event));
  }

  async submit(event) {
    event.preventDefault();
    if (this.submitting) return;
    const form = event.currentTarget;
    const message = form.querySelector('#registration-message');
    const submit = form.querySelector('[type="submit"]');
    message.className = 'registration-message';
    message.textContent = '';

    if (!form.checkValidity()) {
      form.reportValidity();
      message.className = 'registration-message registration-message-error';
      message.textContent = 'يرجى استكمال جميع البيانات المطلوبة بشكل صحيح.';
      return;
    }
    const values = Object.fromEntries(new FormData(form).entries());
    if (values.password !== values.password_confirmation) {
      message.className = 'registration-message registration-message-error';
      message.textContent = 'كلمتا المرور غير متطابقتين.';
      return;
    }

    this.submitting = true;
    submit.disabled = true;
    submit.textContent = 'جارٍ إنشاء الحساب...';
    try {
      const response = await ApiClient.register({ account_type: this.accountType, ...values });
      this.renderSuccess(response.message);
    } catch (error) {
      message.className = 'registration-message registration-message-error';
      message.textContent = error.message || 'تعذر إنشاء الحساب. يرجى المحاولة مرة أخرى.';
      submit.disabled = false;
      submit.textContent = 'إنشاء الحساب';
    } finally {
      this.submitting = false;
    }
  }

  renderSuccess(message) {
    this.container.innerHTML = `<div class="registration-shell"><section class="registration-card registration-state" role="status">
      <div class="registration-state-icon registration-state-success">✓</div>
      <h2>تم إنشاء الحساب</h2><p>${RegistrationController.escape(message)}</p>
      <button type="button" class="btn btn-primary" data-registration-login>الانتقال إلى تسجيل الدخول</button>
      <button type="button" class="btn btn-secondary" data-registration-home>العودة للرئيسية</button>
    </section></div>`;
    this.container.querySelector('[data-registration-login]')?.addEventListener('click', () => this.router.navigate('/login'));
    this.container.querySelector('[data-registration-home]')?.addEventListener('click', () => this.router.navigate('/'));
  }
}

window.RegistrationController = RegistrationController;
