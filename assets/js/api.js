/**
 * JavaScript API Wrapper
 * Security Hardening Phase 1: CSRF Token support
 */
class ApiClient {
  static csrfToken = '';
  static allowedOrigins = [
    window.location.origin,
    'http://localhost',
    'https://localhost',
    'http://127.0.0.1',
    'https://127.0.0.1'
  ];

  static setCsrfToken(token) {
    this.csrfToken = token || '';
    // Store in sessionStorage for persistence
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('csrf_token', this.csrfToken);
    }
  }

  static getCsrfToken() {
    // Try to get from sessionStorage first
    if (typeof sessionStorage !== 'undefined' && this.csrfToken === '') {
      const stored = sessionStorage.getItem('csrf_token');
      if (stored) {
        this.csrfToken = stored;
      }
    }
    return this.csrfToken;
  }

  static resolveApiUrl(endpoint) {
    // The SPA uses history routes such as /110/teacher/classes. A
    // document-relative URL would incorrectly request /110/teacher/api/*.
    // Resolve every endpoint from the deployed application root instead.
    const path = window.location.pathname;
    const basePath = path === '/110' || path.startsWith('/110/') ? '/110/' : '/';
    return `${basePath}api/${String(endpoint || '').replace(/^\/+/, '')}`;
  }

  static _networkError(cause) {
    const error = new Error('Network request failed');
    error.name = 'NetworkError';
    error.isNetworkError = true;
    error.cause = cause;
    return error;
  }

  static async request(endpoint, method = 'GET', payload = null) {
    method = String(method || 'GET').toUpperCase();
    const headers = {
      'Accept': 'application/json, text/plain, */*'
    };

    const options = {
      method,
      headers,
      credentials: 'include' // Important for cookies/session
    };

    // Add CSRF token for state-changing requests
    const stateChangingMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
    if (stateChangingMethods.includes(method)) {
      const csrfToken = this.getCsrfToken();
      if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
      }
    }

    if (payload !== null && method !== 'GET') {
      headers['Content-Type'] = 'application/json; charset=UTF-8';

      // Also include CSRF token in the JSON body. Build a new object rather
      // than mutating caller-owned data.
      let bodyPayload = payload;
      if (stateChangingMethods.includes(method)
          && payload && typeof payload === 'object' && !Array.isArray(payload)
          && !payload.csrf_token) {
        bodyPayload = { ...payload, csrf_token: this.getCsrfToken() };
      }
      options.body = JSON.stringify(bodyPayload);
    }

    const url = this.resolveApiUrl(endpoint);
    let response;
    try {
      response = await fetch(url, options);
    } catch (cause) {
      // Only a rejected fetch() is a transport/network failure. HTTP 4xx/5xx
      // responses resolve normally and must retain their status for the UI.
      const error = this._networkError(cause);
      console.error(`API Client Network Error [${method} ${url}]:`, cause);
      throw error;
    }

    let responseText;
    try {
      responseText = await response.text();
    } catch (cause) {
      // A body-stream failure after headers were received is still a genuine
      // transport failure, but retain the received status for diagnostics.
      const error = this._networkError(cause);
      error.status = response.status;
      error.responseReceived = true;
      console.error(`API Client Response Read Error [${method} ${url}]:`, cause);
      throw error;
    }

    // A 401 is authoritative even if its body is empty or malformed. Clear the
    // token before parsing so an HTML login/session error cannot leave stale
    // CSRF state behind.
    if (response.status === 401) {
      this.csrfToken = '';
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem('csrf_token');
      }
    }

    let data = {};
    if (responseText.trim() !== '') {
      try {
        data = JSON.parse(responseText);
      } catch (cause) {
        // Root-cause fix: response.json() previously threw a bare SyntaxError
        // for an Apache/PHP HTML or empty error page. With no .status attached,
        // AppModal mislabeled that HTTP response as a network outage.
        const error = new Error('استجابة غير صالحة من الخادم');
        error.status = response.status;
        error.responseReceived = true;
        error.code = 'INVALID_JSON_RESPONSE';
        error.cause = cause;
        console.error(`API Client Invalid JSON [${method} ${url}] (HTTP ${response.status})`);
        throw error;
      }
    }

    if (!response.ok) {
      const backendMessage = data && typeof data === 'object'
        ? (data.message || data.error)
        : '';
      const error = new Error(backendMessage || `Server error: ${response.status}`);
      error.status = response.status;
      error.responseReceived = true;
      error.data = data;
      console.error(`API Client HTTP Error [${method} ${url}]:`, error);
      throw error;
    }

    // Extract CSRF token from response if present
    if (data && typeof data === 'object' && data.csrf_token) {
      this.setCsrfToken(data.csrf_token);
    }

    return data;
  }

  static async getRegistrationOptions() {
    return this.request('register.php', 'GET');
  }

  static async register(payload) {
    return this.request('register.php', 'POST', payload);
  }

  static async login(email, password) {
    const payload = { email, password };
    const response = await this.request('login.php', 'POST', payload);
    
    // Store CSRF token from login response
    if (response.csrf_token) {
      this.setCsrfToken(response.csrf_token);
    }
    
    return response;
  }

  static async logout() {
    // request() sends the existing CSRF token in both the header and JSON body.
    return this.request('logout.php', 'POST', {});
  }

  static async getTeacherData(teacherId = null) {
    // For authenticated users, don't pass teacher_id - use session context
    const url = teacherId ? `teacher.php?teacher_id=${teacherId}` : 'teacher.php';
    return this.request(url, 'GET');
  }

  static async updateTeacherSettings(data) {
    return this.request('teacher.php', 'POST', { action: 'update_teacher_settings', payload: data });
  }

  /* ------------------------------------------------------------------ */
  /* P1-I: Academic Classes CRUD (teacher tenant).                       */
  /* Ownership is NEVER accepted from the client — the backend derives   */
  /* teacher_id exclusively from the authenticated session tenant and    */
  /* enforces 404/403/409 semantics server-side.                         */
  /* ------------------------------------------------------------------ */

  static async createClass(data) {
    return this.request('teacher.php', 'POST', { action: 'create_class', payload: data });
  }

  static async updateClass(data) {
    return this.request('teacher.php', 'POST', { action: 'update_class', payload: data });
  }

  static async deleteClass(id) {
    return this.request(`teacher.php?entity=class&id=${encodeURIComponent(String(id))}`, 'DELETE');
  }

  /* ------------------------------------------------------------------ */
  /* P1-J: Study Groups CRUD (teacher tenant).                          */
  /* Ownership is NEVER accepted from the client — the backend derives   */
  /* teacher_id exclusively from the authenticated session tenant and    */
  /* enforces 404/403/409 semantics server-side.                        */
  /* ------------------------------------------------------------------ */

  static async createGroup(data) {
    return this.request('teacher.php', 'POST', { action: 'create_group', payload: data });
  }

  static async updateGroup(data) {
    return this.request('teacher.php', 'POST', { action: 'update_group', payload: data });
  }

  static async deleteGroup(id) {
    return this.request(`teacher.php?entity=group&id=${encodeURIComponent(String(id))}`, 'DELETE');
  }

  /* ------------------------------------------------------------------ */
  /* P1-K: Students module (teacher tenant).                             */
  /* The student identity is GLOBAL (one record per platform); these     */
  /* helpers only manage the CURRENT teacher's link to that student.     */
  /* teacher_id is NEVER sent — the backend derives it from the session  */
  /* tenant, re-applies the academic-class filter and enforces           */
  /* 400/403/404/409 semantics server-side.                              */
  /* ------------------------------------------------------------------ */

  /** Server-side student search (class-scoped, limited, minimum fields). */
  static async searchStudents(data) {
    return this.request('teacher.php', 'POST', { action: 'search_students', payload: data });
  }

  /** Create a brand-new global student and enroll them with this teacher. */
  static async createStudent(data) {
    return this.request('teacher.php', 'POST', { action: 'create_student', payload: data });
  }

  /** Explicit opt-in: link an EXISTING platform student to one of my groups. */
  static async enrollExistingStudent(data) {
    return this.request('teacher.php', 'POST', { action: 'enroll_existing_student', payload: data });
  }

  /** Move a student between MY groups (updates the single enrollment). */
  static async transferStudentGroup(data) {
    return this.request('teacher.php', 'POST', { action: 'transfer_student_group', payload: data });
  }

  /**
   * P1-L: Load one section of the teacher-scoped student profile.
   * teacher_id is intentionally absent: the backend derives it exclusively
   * from tenant_teacher_id in the authenticated session and re-verifies the
   * active enrollment on every overview/history request.
   */
  static async getTeacherStudentProfile(studentId, section = 'overview', page = 1) {
    return this.request('teacher.php', 'POST', {
      action: 'student_profile',
      payload: {
        student_id: Number(studentId),
        section: String(section || 'overview'),
        page: Number(page) || 1
      }
    });
  }

  /**
   * Remove the student FROM MY LIST ONLY (hide/unlink). The global student
   * record, their account and other teachers' links are never touched.
   */
  static async unlinkStudent(studentId) {
    return this.request('teacher.php', 'POST', {
      action: 'unlink_student',
      payload: { student_id: Number(studentId) }
    });
  }

  static async getStudentData(studentId = null) {
    const url = studentId ? `student.php?student_id=${studentId}` : 'student.php';
    return this.request(url, 'GET');
  }

  static async getParentData(parentId = null, studentId = null) {
    let url = 'parent.php';
    if (parentId || studentId) {
      url += '?';
      if (parentId) url += `parent_id=${parentId}`;
      if (studentId) url += `${parentId ? '&' : ''}student_id=${studentId}`;
    }
    return this.request(url, 'GET');
  }

  static async getSuperAdminData() {
    return this.request('super_admin.php', 'GET');
  }

  static async getReportsData(teacherId = null, reportType = 'all') {
    let url = `reports.php?type=${reportType}`;
    if (teacherId) {
      url += `&teacher_id=${teacherId}`;
    }
    return this.request(url, 'GET');
  }

  /**
   * P1-E: Fetch the authenticated teacher's question bank + exams.
   * Server-side, exams.php scopes everything to the session tenant.
   */
  static async getExamsData() {
    return this.request('exams.php', 'GET');
  }

  static async recordAttendance(data) {
    return this.request('attendance.php', 'POST', data);
  }

  /**
   * P1-G: Teacher/staff issue a signed 45s broadcast QR (backend signs it;
   * no HMAC or secret ever exists in JavaScript).
   */
  static async generateAttendanceQr(groupId) {
    return this.request('attendance.php?action=generate_qr', 'POST', {
      action: 'generate_qr',
      group_id: Number(groupId)
    });
  }

  /**
   * P1-G: Student submits a scanned dynamic QR token. ALL validation
   * (signature, expiry, tenant, enrollment) happens server-side.
   */
  static async submitAttendanceQr(qrToken) {
    return this.request('attendance.php', 'POST', {
      method: 'dynamic_qr',
      qr_token: String(qrToken || '')
    });
  }

  static async createExam(data) {
    return this.request('exams.php', 'POST', data);
  }

  static async createQuestion(data) {
    return this.request('exams.php', 'POST', data);
  }

  static async updateTeacherApproval(teacherId, action) {
    return this.request('super_admin.php', 'POST', {
      action,
      teacher_id: Number(teacherId)
    });
  }

  static async updateSaasSettings(data) {
    return this.request('super_admin.php', 'POST', data);
  }
}
