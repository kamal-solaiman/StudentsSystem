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

  static async request(endpoint, method = 'GET', payload = null) {
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
      options.body = JSON.stringify(payload);
      
      // Also include CSRF token in body for JSON requests
      if (stateChangingMethods.includes(method) && !payload.csrf_token) {
        payload = { ...payload, csrf_token: this.getCsrfToken() };
        options.body = JSON.stringify(payload);
      }
    }

    try {
      const response = await fetch(`api/${endpoint}`, options);
      const data = await response.json();

      if (!response.ok) {
        // If unauthorized, clear CSRF token
        if (response.status === 401) {
          this.csrfToken = '';
          if (typeof sessionStorage !== 'undefined') {
            sessionStorage.removeItem('csrf_token');
          }
        }
        throw new Error(data.message || data.error || `Server error: ${response.status}`);
      }

      // Extract CSRF token from response if present
      if (data.csrf_token) {
        this.setCsrfToken(data.csrf_token);
      }

      return data;
    } catch (error) {
      console.error(`API Client Error [${method} ${endpoint}]:`, error);
      throw error;
    }
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

  static async getTeacherData(teacherId = null) {
    // For authenticated users, don't pass teacher_id - use session context
    const url = teacherId ? `teacher.php?teacher_id=${teacherId}` : 'teacher.php';
    return this.request(url, 'GET');
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

  static async recordAttendance(data) {
    return this.request('attendance.php', 'POST', data);
  }

  static async createExam(data) {
    return this.request('exams.php', 'POST', data);
  }

  static async createQuestion(data) {
    return this.request('exams.php', 'POST', data);
  }

  static async updateSaasSettings(data) {
    return this.request('super_admin.php', 'POST', data);
  }
}
