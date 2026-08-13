/**
 * Central Modal Dialog Helper (P1-E)
 *
 * Reuses the existing design system only:
 *  - .modal-backdrop / .modal-content / .modal-header / .modal-title /
 *    .modal-close / .modal-body  (assets/css/qr.css)
 *  - .form-group / .form-label / .form-control / .btn / .btn-primary /
 *    .btn-secondary (assets/css/style.css)
 *
 * Supports: title, description, dynamic fields (text / number / date /
 * select / textarea / checklist), client-side validation, inline errors,
 * loading state, double-submit prevention, safe close (button / backdrop /
 * Escape) and RTL Arabic UI.
 *
 * XSS-safe: every label and value is inserted through textContent / DOM APIs,
 * never through innerHTML interpolation.
 *
 * Backend remains the source of truth: this helper only collects input;
 * authorization/ownership are enforced by the API (CSRF + RBAC + P1-B).
 */
class AppModal {
  /**
   * @param {Object} options
   * @param {string}   options.title
   * @param {string}   [options.description]
   * @param {Array}    [options.fields] field specs:
   *   { name, label, type: 'text'|'number'|'date'|'select'|'textarea'|'checklist',
   *     required, min, max, value, placeholder, rows,
   *     options: [{value,label,checked}], emptyText }
   * @param {string}   [options.submitLabel]
   * @param {string}   [options.cancelLabel]
   * @param {Function} options.onSubmit async (values) => void.
   *                 Throw (or reject) to show the error inside the modal
   *                 and keep it open.
   */
  constructor(options) {
    this.options = options || {};
    this.busy = false;
    this.closed = false;
    this.fields = [];
    this._build();
  }

  /** Convenience factory */
  static open(options) {
    return new AppModal(options);
  }

  /* ------------------------------------------------------------------ */
  /* DOM construction                                                     */
  /* ------------------------------------------------------------------ */

  _build() {
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'modal-backdrop';

    const content = document.createElement('div');
    content.className = 'modal-content';
    content.setAttribute('role', 'dialog');
    content.setAttribute('aria-modal', 'true');

    /* Header */
    const header = document.createElement('div');
    header.className = 'modal-header';

    const title = document.createElement('h3');
    title.className = 'modal-title';
    title.textContent = this.options.title || '';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'modal-close';
    closeBtn.setAttribute('aria-label', 'إغلاق');
    closeBtn.textContent = '✕';

    header.append(title, closeBtn);

    /* Body */
    const body = document.createElement('div');
    body.className = 'modal-body';

    if (this.options.description) {
      const desc = document.createElement('p');
      desc.style.cssText = 'margin:0 0 1rem;color:#64748b;font-size:0.85rem;';
      desc.textContent = this.options.description;
      body.appendChild(desc);
    }

    (this.options.fields || []).forEach(spec => {
      body.appendChild(this._buildField(spec));
    });

    /* Inline error box (hidden until needed) */
    this.errorBox = document.createElement('div');
    this.errorBox.style.cssText = 'display:none;background:#ffe4e6;color:#9f1239;border:1px solid #fecdd3;border-radius:0.5rem;padding:0.75rem;font-size:0.85rem;margin-top:0.75rem;';
    body.appendChild(this.errorBox);

    /* Footer actions (RTL: submit appears first / rightmost) */
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-start;gap:0.75rem;margin-top:1.25rem;';

    this.submitBtn = document.createElement('button');
    this.submitBtn.type = 'button';
    this.submitBtn.className = 'btn btn-primary';
    this.submitBtnLabel = document.createElement('span');
    this.submitBtnLabel.textContent = this.options.submitLabel || 'حفظ';
    this.submitBtn.appendChild(this.submitBtnLabel);

    this.cancelBtn = document.createElement('button');
    this.cancelBtn.type = 'button';
    this.cancelBtn.className = 'btn btn-secondary';
    this.cancelBtn.textContent = this.options.cancelLabel || 'إلغاء';

    footer.append(this.submitBtn, this.cancelBtn);
    body.appendChild(footer);

    content.append(header, body);
    this.backdrop.appendChild(content);
    document.body.appendChild(this.backdrop);

    /* Listeners */
    closeBtn.addEventListener('click', () => {
      if (!this.busy) this.close();
    });
    this.cancelBtn.addEventListener('click', () => {
      if (!this.busy) this.close();
    });
    this.submitBtn.addEventListener('click', () => {
      this._submit();
    });
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop && !this.busy) this.close();
    });
    this._onKeyDown = (e) => {
      if (e.key === 'Escape' && !this.busy) this.close();
    };
    document.addEventListener('keydown', this._onKeyDown);
  }

  _buildField(spec) {
    const group = document.createElement('div');
    group.className = 'form-group';
    group.style.marginBottom = '1rem';

    const label = document.createElement('label');
    label.className = 'form-label';
    label.textContent = (spec.label || spec.name) + (spec.required ? ' *' : '');
    group.appendChild(label);

    let control;

    if (spec.type === 'select') {
      control = document.createElement('select');
      control.className = 'form-control';
      (spec.options || []).forEach(opt => {
        const o = document.createElement('option');
        o.value = String(opt.value);
        o.textContent = opt.label;
        if (String(spec.value) === String(opt.value)) {
          o.selected = true;
        }
        control.appendChild(o);
      });
    } else if (spec.type === 'textarea') {
      control = document.createElement('textarea');
      control.className = 'form-control';
      control.rows = spec.rows || 3;
      if (spec.placeholder) control.placeholder = spec.placeholder;
      if (spec.value != null) control.value = String(spec.value);
    } else if (spec.type === 'checklist') {
      control = document.createElement('div');
      control.style.cssText = 'max-height:180px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:0.5rem;padding:0.75rem;background:#f8fafc;';
      const opts = spec.options || [];
      if (opts.length === 0) {
        const empty = document.createElement('p');
        empty.style.cssText = 'margin:0;color:#64748b;font-size:0.8rem;';
        empty.textContent = spec.emptyText || 'لا توجد خيارات متاحة';
        control.appendChild(empty);
      } else {
        opts.forEach(opt => {
          const row = document.createElement('label');
          row.style.cssText = 'display:flex;align-items:center;gap:0.5rem;padding:0.3rem 0;font-size:0.85rem;cursor:pointer;';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.value = String(opt.value);
          if (opt.checked) cb.checked = true;
          const text = document.createElement('span');
          text.textContent = opt.label;
          row.append(cb, text);
          control.appendChild(row);
        });
      }
    } else {
      control = document.createElement('input');
      control.type = spec.type || 'text';
      control.className = 'form-control';
      if (spec.placeholder) control.placeholder = spec.placeholder;
      if (spec.value != null) control.value = String(spec.value);
      if (spec.type === 'number') {
        if (spec.min != null) control.min = String(spec.min);
        if (spec.max != null) control.max = String(spec.max);
        control.step = spec.step || 'any';
      }
    }

    this.fields.push({ spec, control });
    group.appendChild(control);
    return group;
  }

  /* ------------------------------------------------------------------ */
  /* Validation & submission                                              */
  /* ------------------------------------------------------------------ */

  _collect() {
    const values = {};
    this.fields.forEach(({ spec, control }) => {
      if (spec.type === 'checklist') {
        values[spec.name] = Array.from(
          control.querySelectorAll('input[type="checkbox"]:checked')
        ).map(cb => cb.value);
      } else {
        values[spec.name] = control.value;
      }
    });
    return values;
  }

  _validate() {
    const values = this._collect();
    for (const { spec } of this.fields) {
      if (spec.type === 'checklist') {
        continue; // selection is optional unless backend rejects it
      }
      const text = String(values[spec.name] ?? '').trim();
      if (spec.required && text === '') {
        return { ok: false, message: `الحقل "${spec.label}" مطلوب` };
      }
      if (text !== '' && spec.type === 'number') {
        const num = Number(text);
        if (!Number.isFinite(num)) {
          return { ok: false, message: `الحقل "${spec.label}" يجب أن يكون رقمًا صالحًا` };
        }
        if (spec.min != null && num < spec.min) {
          return { ok: false, message: `الحقل "${spec.label}" لا يمكن أن يكون أقل من ${spec.min}` };
        }
        if (spec.max != null && num > spec.max) {
          return { ok: false, message: `الحقل "${spec.label}" لا يمكن أن يكون أكبر من ${spec.max}` };
        }
        values[spec.name] = num;
      }
    }
    return { ok: true, values };
  }

  async _submit() {
    if (this.busy || this.closed) return; // double-submit prevention

    const result = this._validate();
    if (!result.ok) {
      this._showError(result.message);
      return;
    }

    this._showError('');
    this.busy = true;
    this.submitBtn.disabled = true;
    this.cancelBtn.disabled = true;
    this.submitBtn.setAttribute('aria-busy', 'true');
    this.submitBtnLabel.textContent = 'جارٍ الحفظ...';

    try {
      await this.options.onSubmit(result.values);
      this.close();
    } catch (error) {
      this.busy = false;
      this.submitBtn.disabled = false;
      this.cancelBtn.disabled = false;
      this.submitBtn.removeAttribute('aria-busy');
      this.submitBtnLabel.textContent = this.options.submitLabel || 'حفظ';
      this._showError(this._describeError(error));
    }
  }

  _describeError(error) {
    const status = error && error.status;
    if (status === 401) return 'انتهت الجلسة — يرجى تسجيل الدخول مجددًا';
    if (status === 403) return 'غير مصرح لك بتنفيذ هذا الإجراء';
    if (status === 404) return 'المورد المطلوب غير موجود';
    if (status === 422) return 'البيانات المدخلة غير صالحة';
    if (status === 429) return 'محاولات كثيرة — حاول بعد قليل';
    if (status && status >= 500) return 'حدث خطأ في الخادم — حاول مرة أخرى لاحقًا';
    if (!status) return 'تعذر الاتصال بالخادم — تحقق من اتصالك بالإنترنت';
    return 'حدث خطأ غير متوقع';
  }

  _showError(message) {
    if (!message) {
      this.errorBox.textContent = '';
      this.errorBox.style.display = 'none';
      return;
    }
    this.errorBox.textContent = message;
    this.errorBox.style.display = 'block';
  }

  /* ------------------------------------------------------------------ */
  /* Safe teardown                                                        */
  /* ------------------------------------------------------------------ */

  close() {
    if (this.closed) return;
    this.closed = true;
    document.removeEventListener('keydown', this._onKeyDown);
    if (this.backdrop && this.backdrop.parentNode) {
      this.backdrop.parentNode.removeChild(this.backdrop);
    }
  }
}

// Expose globally (consistent with the project's existing script pattern)
window.AppModal = AppModal;
