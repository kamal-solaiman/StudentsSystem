/**
 * Vanilla JavaScript API Wrapper (PHP 8.3 Native Backend communication)
 */
class ApiClient {
  static async request(endpoint, method = 'GET', payload = null) {
    const headers = {
      'Accept': 'application/json, text/plain, */*'
    };

    const options = {
      method,
      headers
    };

    if (payload !== null && method !== 'GET') {
      headers['Content-Type'] = 'application/json; charset=UTF-8';
      options.body = JSON.stringify(payload);
    }

    try {
      const response = await fetch(`api/${endpoint}`, options);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `خطأ سيرفر: ${response.status}`);
      }

      return data;
    } catch (error) {
      console.error(`API Client Error [${method} ${endpoint}]:`, error);
      throw error;
    }
  }

  static async getTeacherData(teacherId = 1) {
    return this.request(`teacher.php?teacher_id=${teacherId}`, 'GET');
  }

  static async getStudentData(studentId = 1) {
    return this.request(`student.php?student_id=${studentId}`, 'GET');
  }

  static async getParentData(parentId = 5, studentId = 1) {
    return this.request(`parent.php?parent_id=${parentId}&student_id=${studentId}`, 'GET');
  }

  static async getSuperAdminData() {
    return this.request(`super_admin.php`, 'GET');
  }

  static async getReportsData(teacherId = 1, reportType = 'all') {
    return this.request(`reports.php?teacher_id=${teacherId}&type=${reportType}`, 'GET');
  }
}
