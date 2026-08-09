<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/helper.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../config/auth.php';

Helper::handleCorsOptions();

// SECURITY: Only POST method allowed
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Helper::sendJson(['success' => false, 'message' => 'Method not allowed, use POST'], 405);
}

// SECURITY: Require authentication for attendance recording
$user = AuthManager::requireRole(['teacher', 'staff', 'super_admin']);

// SECURITY: For staff, check specific permission
if ($user['role'] === 'staff') {
    AuthManager::requirePermission('attendance');
}

// SECURITY: Verify CSRF token
$input = Helper::getJsonInput();
$csrfToken = $input['csrf_token'] ?? null;
if ($csrfToken === null || $csrfToken === '') {
    $csrfToken = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? null;
}
if (!AuthManager::validateCsrfToken($csrfToken)) {
    Helper::sendForbidden('Invalid CSRF token');
}

// SECURITY: Extract teacher_id from session context
if ($user['role'] === 'teacher' || $user['role'] === 'staff') {
    $teacherId = (int)$user['tenant_teacher_id'];
    if ($teacherId <= 0) {
        Helper::sendForbidden('Invalid teacher context');
    }
} elseif ($user['role'] === 'super_admin') {
    // SECURITY FIX: Super Admin should NOT record attendance for individual teachers/students per business rules
    // Super Admin can only manage platform-level settings, not tenant-specific operations
    Helper::sendForbidden('Super Admin cannot record attendance. This is a teacher-level operation.');
} else {
    Helper::sendForbidden('Access denied');
}

$studentId = (int)($input['student_id'] ?? 0);
$studentCode = Helper::sanitizeString($input['student_code'] ?? '');
$method = Helper::sanitizeString($input['method'] ?? 'manual');
$status = Helper::sanitizeString($input['status'] ?? 'present');
$arrivalTime = Helper::sanitizeString($input['arrival_time'] ?? date('h:i A'));
$lateMinutes = (int)($input['late_minutes'] ?? 0);
$notes = Helper::sanitizeString($input['notes'] ?? 'تم التسجيل عبر المنصة');

// Validate status
$validStatuses = ['present', 'absent', 'late'];
if (!in_array($status, $validStatuses, true)) {
    Helper::sendJson(['success' => false, 'message' => 'Invalid status value'], 400);
}

// Validate method
$validMethods = ['dynamic_qr', 'id_scanner', 'manual'];
if (!in_array($method, $validMethods, true)) {
    Helper::sendJson(['success' => false, 'message' => 'Invalid method value'], 400);
}

try {
    $db = DatabaseConnection::fromConfigFile()->connect();

    // If student_code is provided instead of ID (Scanner Mode 2)
    if ($studentId <= 0 && $studentCode !== '') {
        $stmtFind = $db->prepare('SELECT id FROM students WHERE student_code = :code LIMIT 1');
        $stmtFind->execute(['code' => $studentCode]);
        $found = $stmtFind->fetch();
        if ($found === false) {
            Helper::sendJson(['success' => false, 'error' => 'لم يتم العثور على طالب بكود: ' . $studentCode], 404);
        }
        $studentId = (int)$found['id'];
    }

    if ($studentId <= 0) {
        Helper::sendJson(['success' => false, 'message' => 'Student ID or student code is required'], 422);
    }

    // SECURITY: Verify the student belongs to this teacher (for teacher/staff roles)
    if ($user['role'] === 'teacher' || $user['role'] === 'staff') {
        $stmtVerify = $db->prepare('SELECT group_id FROM student_enrollments WHERE teacher_id = :tid AND student_id = :sid LIMIT 1');
        $stmtVerify->execute(['tid' => $teacherId, 'sid' => $studentId]);
        $enr = $stmtVerify->fetch();
        
        if ($enr === false) {
            Helper::sendForbidden('Access denied');
        }
        $groupId = (int)$enr['group_id'];
    } else {
        // For super_admin, just get the group_id
        $stmtGrp = $db->prepare('SELECT group_id FROM student_enrollments WHERE teacher_id = :tid AND student_id = :sid LIMIT 1');
        $stmtGrp->execute(['tid' => $teacherId, 'sid' => $studentId]);
        $enr = $stmtGrp->fetch();
        $groupId = $enr ? (int)$enr['group_id'] : 1;
    }

    $stmtInsert = $db->prepare('
        INSERT INTO attendance_records 
            (teacher_id, student_id, group_id, date, status, arrival_time, departure_time, late_minutes, method, notes)
        VALUES 
            (:tid, :sid, :gid, CURRENT_DATE(), :status, :arrival, "", :latem, :method, :notes)
    ');
    $stmtInsert->execute([
        'tid' => $teacherId,
        'sid' => $studentId,
        'gid' => $groupId,
        'status' => $status,
        'arrival' => $arrivalTime,
        'latem' => $lateMinutes,
        'method' => $method,
        'notes' => $notes
    ]);

    Helper::sendJson([
        'success' => true,
        'message' => 'تم تسجيل الحضور بنجاح عبر الطريقة: ' . ($method === 'dynamic_qr' ? 'الـ QR المتغير (1)' : ($method === 'id_scanner' ? 'الـ Scanner (2)' : 'اليدوي (3)')),
        'attendance_id' => (int)$db->lastInsertId()
    ]);

} catch (Throwable $exception) {
    Helper::sendJson([
        'success' => false,
        'error' => 'خطأ في سيرفر تسجيل الحضور: ' . $exception->getMessage()
    ], 500);
}
