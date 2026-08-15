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
 * select / textarea / checklist / timerow), client-side validation, inline
 * errors, loading state, double-submit prevention, safe close (button /
 * backdrop / Escape) and RTL Arabic UI.
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
   *   { name, label, type: 'text'|'number'|'date'|'select'|'textarea'|'checklist'|'timerow',
   *     required, min, max, value, placeholder, rows,
   *     options: [{value,label,checked}] | (values => options), emptyText }
   *   'timerow' (P1-J-FIX): one INLINE row of three selects (hour : minute period)
   *   — spec: { hourOptions, minuteOptions, periodOptions,
   *             value: { hour, minute, period } };
   *   collected as the object { hour, minute, period }.
   * @param {Object}   [options.preview] { label, render(values) }
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

    /* Optional read-only derived-value preview (always textContent/XSS-safe). */
    if (this.options.preview && typeof this.options.preview.render === 'function') {
      const previewGroup = document.createElement('div');
      previewGroup.className = 'form-group';
      previewGroup.style.marginBottom = '1rem';

      const previewLabel = document.createElement('span');
      previewLabel.className = 'form-label';
      previewLabel.textContent = this.options.preview.label || 'معاينة';

      this.previewValue = document.createElement('div');
      this.previewValue.setAttribute('aria-live', 'polite');
      this.previewValue.style.cssText = 'background:#f8fafc;border:1px solid #cbd5e1;border-radius:0.5rem;padding:0.75rem;font-weight:800;color:#0f172a;min-height:2.75rem;';
      previewGroup.append(previewLabel, this.previewValue);
      body.appendChild(previewGroup);
    }

    // Function-valued select options support dependent fields (for example,
    // restricting grades after the educational stage changes).
    this.fields.forEach(({ control }) => {
      if (!control || typeof control.addEventListener !== 'function') return;
      control.addEventListener('change', () => {
        this._refreshDynamicFields();
        this._updatePreview();
      });
      control.addEventListener('input', () => this._updatePreview());
    });
    this._refreshDynamicFields();
    this._updatePreview();

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

    // P1-J-FIX: an explicit empty label suppresses the block label entirely
    // (used by the second من/إلى time row, which carries its own inline label).
    if (spec.label !== '') {
      const label = document.createElement('label');
      label.className = 'form-label';
      label.textContent = (spec.label || spec.name) + (spec.required ? ' *' : '');
      group.appendChild(label);
    }

    let control;

    if (spec.type === 'select') {
      control = document.createElement('select');
      control.name = spec.name;
      control.className = 'form-control';
      this._setSelectOptions(control, this._getSelectOptions(spec), spec.value);
    } else if (spec.type === 'textarea') {
      control = document.createElement('textarea');
      control.name = spec.name;
      control.className = 'form-control';
      control.rows = spec.rows || 3;
      if (spec.placeholder) control.placeholder = spec.placeholder;
      if (spec.value != null) control.value = String(spec.value);
      if (spec.maxlength) control.maxLength = Number(spec.maxlength);
    } else if (spec.type === 'timerow') {
      // P1-J-FIX: hour/minute/period selects INLINE on one row (hour beside
      // minute, never stacked). RTL flows the controls naturally after the
      // من/إلى label; the values stay canonical Latin digits.
      control = document.createElement('div');
      control.style.cssText = 'display:flex;align-items:center;gap:0.5rem;';
      const value = spec.value || {};

      // Inline row prefix (e.g. "من:" / "إلى:") — keeps the whole row on one
      // line: label, hour, ':', minute, period.
      if (spec.inlineLabel) {
        const rowLabel = document.createElement('span');
        rowLabel.style.cssText = 'font-weight:800;color:#0f172a;min-width:2.5rem;';
        rowLabel.textContent = spec.inlineLabel;
        control.appendChild(rowLabel);
      }

      const hourSelect = document.createElement('select');
      hourSelect.className = 'form-control';
      hourSelect.style.cssText = 'width:auto;min-width:4.5rem;';
      this._setSelectOptions(hourSelect, spec.hourOptions || [], value.hour);

      const separator = document.createElement('span');
      separator.style.cssText = 'font-weight:800;color:#0f172a;';
      separator.textContent = ':';

      const minuteSelect = document.createElement('select');
      minuteSelect.className = 'form-control';
      minuteSelect.style.cssText = 'width:auto;min-width:4.5rem;';
      this._setSelectOptions(minuteSelect, spec.minuteOptions || [], value.minute);

      const periodSelect = document.createElement('select');
      periodSelect.className = 'form-control';
      periodSelect.style.cssText = 'width:auto;min-width:5.5rem;';
      this._setSelectOptions(periodSelect, spec.periodOptions || [], value.period);

      control.append(hourSelect, separator, minuteSelect, periodSelect);
      control._timeParts = { hour: hourSelect, minute: minuteSelect, period: periodSelect };
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
      control.name = spec.name;
      control.className = 'form-control';
      if (spec.placeholder) control.placeholder = spec.placeholder;
      if (spec.value != null) control.value = String(spec.value);
      if (spec.maxlength) control.maxLength = Number(spec.maxlength);
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

  _getSelectOptions(spec) {
    if (typeof spec.options === 'function') {
      const options = spec.options(this._collect());
      return Array.isArray(options) ? options : [];
    }
    return Array.isArray(spec.options) ? spec.options : [];
  }

  _setSelectOptions(control, options, preferredValue) {
    const preferred = preferredValue == null ? '' : String(preferredValue);
    while (control.firstChild) control.removeChild(control.firstChild);
    options.forEach(opt => {
      const option = document.createElement('option');
      option.value = String(opt.value);
      option.textContent = opt.label;
      if (option.value === preferred) option.selected = true;
      control.appendChild(option);
    });
    if (preferred !== '' && options.some(opt => String(opt.value) === preferred)) {
      control.value = preferred;
    }
  }

  _refreshDynamicFields() {
    this.fields.forEach(({ spec, control }) => {
      if (spec.type !== 'select' || typeof spec.options !== 'function') return;
      const currentValue = control.value;
      const options = this._getSelectOptions(spec);
      const preferred = options.some(opt => String(opt.value) === String(currentValue))
        ? currentValue
        : (options[0] ? options[0].value : '');
      this._setSelectOptions(control, options, preferred);
    });
  }

  _updatePreview() {
    if (!this.previewValue || !this.options.preview) return;
    const value = this.options.preview.render(this._collect());
    this.previewValue.textContent = value == null || value === '' ? '—' : String(value);
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
      } else if (spec.type === 'timerow') {
        values[spec.name] = {
          hour: control._timeParts.hour.value,
          minute: control._timeParts.minute.value,
          period: control._timeParts.period.value
        };
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
      if (spec.type === 'timerow') {
        continue; // selects always hold a valid option; range is checked by the caller
      }
      const text = String(values[spec.name] ?? '').trim();
      if (spec.required && text === '') {
        return { ok: false, message: `الحقل "${spec.label}" مطلوب` };
      }
      if (text !== '' && spec.maxlength && text.length > Number(spec.maxlength)) {
        return { ok: false, message: `الحقل "${spec.label}" لا يمكن أن يتجاوز ${spec.maxlength} حرفًا` };
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
    this.submitBtnLabel.textContent = this.options.loadingLabel || 'جارٍ الحفظ...';

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
    // P1-I: for 409 the backend sends a safe, server-authored Arabic conflict
    // message (e.g. class delete blocked by dependent data) — surface it.
    if (status === 409) return (error && error.message) || 'تعذر إتمام العملية لوجود بيانات مرتبطة';
    if (status === 401) return 'انتهت جلسة تسجيل الدخول';
    if (status === 403) return 'ليس لديك صلاحية';
    if (status === 400) return (error && error.message) || 'البيانات المدخلة غير صالحة';
    if (status === 404) return 'المورد المطلوب غير موجود';
    if (status === 422) return 'البيانات المدخلة غير صالحة';
    if (status === 429) return 'محاولات كثيرة — حاول بعد قليل';
    if (status && status >= 500) return 'حدث خطأ في الخادم — حاول مرة أخرى لاحقًا';
    // Only ApiClient's explicit fetch/body-stream failure marker is a network
    // error. A parse/application exception without an HTTP status is not.
    if (error && error.isNetworkError === true) {
      return 'تعذر الاتصال بالخادم — تحقق من اتصالك بالإنترنت';
    }
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
