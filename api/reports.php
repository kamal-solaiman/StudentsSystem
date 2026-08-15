<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/helper.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../config/auth.php';

Helper::handleCorsOptions();

// SECURITY: Require authentication for reports endpoint
$user = AuthManager::requireRole(['teacher', 'staff', 'super_admin']);

// SECURITY: For staff, check specific permission
if ($user['role'] === 'staff') {
    AuthManager::requirePermission('reports');
}

try {
    $db = DatabaseConnection::fromConfigFile()->connect();
    
    // SECURITY: Extract teacher_id from session context
    if ($user['role'] === 'teacher' || $user['role'] === 'staff') {
        $teacherId = (int)$user['tenant_teacher_id'];
        if ($teacherId <= 0) {
            Helper::sendForbidden('Invalid teacher context');
        }
    } elseif ($user['role'] === 'super_admin') {
        // SECURITY FIX: Super Admin should NOT access individual teacher reports per business rules
        // Super Admin can only view platform-level aggregate reports, not tenant-specific data
        Helper::sendForbidden('Super Admin cannot access individual teacher reports. Use super_admin.php for platform-level statistics.');
    } else {
        Helper::sendForbidden('Access denied');
    }
    $reportType = Helper::sanitizeString($_GET['type'] ?? 'all');

    // 1. Students Report
    // P1-K: only ACTIVE enrollments are reported. Removing a student in the
    // teacher students module hides the link (status='inactive') for this
    // teacher only, so the student must disappear from this teacher's roster
    // report as well. Historical attendance rows (report 2 below) are kept
    // deliberately: they are the teacher's own past session records and
    // deleting them from the statistics would rewrite history.
    $stmtSt = $db->prepare('
        SELECT s.student_code, s.name, s.grade_level, s.phone, se.enrollment_date, se.payment_status,
               sg.name AS group_name, ac.name AS class_name 
        FROM student_enrollments se 
        JOIN students s ON se.student_id = s.id 
        LEFT JOIN study_groups sg ON se.group_id = sg.id 
        LEFT JOIN academic_classes ac ON se.class_id = ac.id 
        WHERE se.teacher_id = :tid AND se.status = \'active\'
        ORDER BY se.id DESC
    ');
    $stmtSt->execute(['tid' => $teacherId]);
    $studentsReport = $stmtSt->fetchAll();

    // 2. Attendance Report
    $stmtAtt = $db->prepare('
        SELECT ar.*, s.student_code, s.name AS student_name, sg.name AS group_name 
        FROM attendance_records ar 
        JOIN students s ON ar.student_id = s.id 
        LEFT JOIN study_groups sg ON ar.group_id = sg.id 
        WHERE ar.teacher_id = :tid 
        ORDER BY ar.date DESC, ar.id DESC
    ');
    $stmtAtt->execute(['tid' => $teacherId]);
    $attRecords = $stmtAtt->fetchAll();

    $attSummary = [
        'present_count' => 0,
        'late_count' => 0,
        'absent_count' => 0,
        'total_late_minutes' => 0
    ];
    foreach ($attRecords as $r) {
        if ($r['status'] === 'present') {
            $attSummary['present_count']++;
        } elseif ($r['status'] === 'late') {
            $attSummary['late_count']++;
            $attSummary['total_late_minutes'] += (int)$r['late_minutes'];
        } else {
            $attSummary['absent_count']++;
        }
    }

    // 3. Exams Report
    $stmtEx = $db->prepare('
        SELECT e.*, COUNT(eq.id) AS total_questions 
        FROM exams e 
        LEFT JOIN exam_questions eq ON e.id = eq.exam_id 
        WHERE e.teacher_id = :tid 
        GROUP BY e.id 
        ORDER BY e.date DESC
    ');
    $stmtEx->execute(['tid' => $teacherId]);
    $examsReport = $stmtEx->fetchAll();

    // 4. Grades Report
    $stmtGrades = $db->prepare('
        SELECT ser.*, s.student_code, s.name AS student_name, e.title AS exam_title 
        FROM student_exam_results ser 
        JOIN students s ON ser.student_id = s.id 
        JOIN exams e ON ser.exam_id = e.id 
        WHERE ser.teacher_id = :tid 
        ORDER BY ser.submitted_at DESC
    ');
    $stmtGrades->execute(['tid' => $teacherId]);
    $gradesReport = $stmtGrades->fetchAll();

    // 5. Payments Report
    $stmtPay = $db->prepare('
        SELECT se.payment_status, sg.payment_scheme, sg.price, COUNT(*) AS students_count,
               SUM(sg.price) AS total_expected_revenue 
        FROM student_enrollments se 
        JOIN study_groups sg ON se.group_id = sg.id 
        WHERE se.teacher_id = :tid 
        GROUP BY se.payment_status, sg.payment_scheme, sg.price
    ');
    $stmtPay->execute(['tid' => $teacherId]);
    $paymentsReport = $stmtPay->fetchAll();

    // 6. Groups Report
    $stmtGrp = $db->prepare('
        SELECT sg.*, ac.name AS class_name, COUNT(se.id) AS enrolled_students 
        FROM study_groups sg 
        LEFT JOIN academic_classes ac ON sg.class_id = ac.id 
        LEFT JOIN student_enrollments se ON sg.id = se.group_id 
        WHERE sg.teacher_id = :tid 
        GROUP BY sg.id 
        ORDER BY sg.id ASC
    ');
    $stmtGrp->execute(['tid' => $teacherId]);
    $groupsReport = $stmtGrp->fetchAll();

    // 7. Classes Report
    $stmtCls = $db->prepare('
        SELECT ac.*, COUNT(DISTINCT sg.id) AS groups_count, COUNT(DISTINCT se.student_id) AS total_students 
        FROM academic_classes ac 
        LEFT JOIN study_groups sg ON ac.id = sg.class_id 
        LEFT JOIN student_enrollments se ON ac.id = se.class_id 
        WHERE ac.teacher_id = :tid 
        GROUP BY ac.id 
        ORDER BY ac.id ASC
    ');
    $stmtCls->execute(['tid' => $teacherId]);
    $classesReport = $stmtCls->fetchAll();

    Helper::sendJson([
        'success' => true,
        'reports' => [
            'students' => $studentsReport,
            'attendance' => [
                'summary' => $attSummary,
                'records' => $attRecords
            ],
            'exams' => $examsReport,
            'grades' => $gradesReport,
            'payments' => $paymentsReport,
            'groups' => $groupsReport,
            'classes' => $classesReport
        ]
    ]);

} catch (Throwable $exception) {
    Helper::sendJson([
        'success' => false,
        'error' => 'خطأ في سيرفر التقارير 7: ' . $exception->getMessage()
    ], 500);
}
