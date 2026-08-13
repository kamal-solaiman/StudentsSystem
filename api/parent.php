<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/helper.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../config/auth.php';

Helper::handleCorsOptions();

// SECURITY: Require authentication for parent endpoint
$user = AuthManager::requireRole(['parent', 'teacher', 'staff', 'super_admin']);

// SECURITY: For staff, check specific permission
if ($user['role'] === 'staff') {
    AuthManager::requirePermission('parent');
}

try {
    $db = DatabaseConnection::fromConfigFile()->connect();
    
    // SECURITY: For parent role, use authenticated user's ID
    // For other roles, validate access
    $parent = null;
    $parentUserId = null;
    
    if ($user['role'] === 'parent') {
        $parentUserId = $user['user_id'];
        $stmtParent = $db->prepare('SELECT * FROM users WHERE id = :uid LIMIT 1');
        $stmtParent->execute(['uid' => $parentUserId]);
        $parent = $stmtParent->fetch();
        
        if ($parent === false || $parent['role'] !== 'parent') {
            Helper::sendForbidden('Parent not found or invalid role');
        }
        
    } elseif ($user['role'] === 'teacher' || $user['role'] === 'staff') {
        // SECURITY FIX: Teacher/staff can only access parents related to their students
        $parentUserId = isset($_GET['parent_id']) ? (int)$_GET['parent_id'] : 0;
        if ($parentUserId <= 0) {
            Helper::sendJson(['success' => false, 'message' => 'Parent ID is required'], 400);
        }
        
        // Verify the parent exists and has parent role
        $stmtParentCheck = $db->prepare('SELECT * FROM users WHERE id = :uid AND role = "parent" LIMIT 1');
        $stmtParentCheck->execute(['uid' => $parentUserId]);
        $parent = $stmtParentCheck->fetch();
        
        if ($parent === false) {
            Helper::sendJson(['success' => false, 'message' => 'Parent not found'], 404);
        }
        
        // Verify this parent has at least one child enrolled with the teacher
        $teacherId = (int)$user['tenant_teacher_id'];
        if ($teacherId <= 0) {
            Helper::sendForbidden('Invalid teacher context');
        }
        
        $stmtVerify = $db->prepare('
            SELECT COUNT(*) as c
            FROM students s
            JOIN student_enrollments se ON s.id = se.student_id
            WHERE (s.parent_user_id = :puid OR s.parent_phone = :pphone)
            AND se.teacher_id = :tid
            LIMIT 1
        ');
        $stmtVerify->execute([
            'puid' => $parentUserId,
            'pphone' => $parent['phone'],
            'tid' => $teacherId
        ]);
        
        if ((int)$stmtVerify->fetch()['c'] === 0) {
            Helper::sendForbidden('Access denied: Parent has no children enrolled with this teacher');
        }
        
    } elseif ($user['role'] === 'super_admin') {
        // SECURITY FIX: Super Admin should NOT access individual parent data per business rules
        Helper::sendForbidden('Super Admin cannot access individual parent data. Use super_admin.php for platform management.');
    } else {
        Helper::sendForbidden('Access denied');
    }
    
    // Get student_id parameter from request
    $studentIdParam = isset($_GET['student_id']) ? (int)$_GET['student_id'] : 0;

    // Children belonging to this parent
    $stmtChildren = $db->prepare('
        SELECT * FROM students 
        WHERE parent_user_id = :puid OR parent_phone = :pphone 
        ORDER BY id ASC
    ');
    $stmtChildren->execute([
        'puid' => $parentUserId,
        'pphone' => (string)$parent['phone']
    ]);
    $children = $stmtChildren->fetchAll();

    if (empty($children)) {
        // For parent role, if no children found, return empty
        Helper::sendJson([
            'success' => true,
            'parent' => [
                'id' => (int)$parent['id'],
                'name' => (string)$parent['name'],
                'email' => (string)$parent['email'],
                'phone' => (string)$parent['phone']
            ],
            'children' => [],
            'selected_child' => null,
            'teachers' => [],
            'attendance_report' => [
                'records' => [],
                'total_present' => 0,
                'total_absent' => 0,
                'total_late' => 0
            ],
            'homeworks' => [],
            'exams' => []
        ]);
    }

    $selectedChild = null;
    if ($studentIdParam > 0) {
        foreach ($children as $ch) {
            if ((int)$ch['id'] === $studentIdParam) {
                $selectedChild = $ch;
                break;
            }
        }
        // SECURITY: If requested student_id doesn't belong to this parent, deny access
        if ($selectedChild === null && $user['role'] === 'parent') {
            Helper::sendForbidden('Access denied');
        }
    }
    if ($selectedChild === null) {
        $selectedChild = $children[0] ?? null;
    }
    
    if ($selectedChild === null) {
        Helper::sendJson([
            'success' => true,
            'parent' => [
                'id' => (int)$parent['id'],
                'name' => (string)$parent['name'],
                'email' => (string)$parent['email'],
                'phone' => (string)$parent['phone']
            ],
            'children' => $children,
            'selected_child' => null,
            'teachers' => [],
            'attendance_report' => [
                'records' => [],
                'total_present' => 0,
                'total_absent' => 0,
                'total_late' => 0
            ],
            'homeworks' => [],
            'exams' => []
        ]);
    }
    
    $selectedChildId = (int)$selectedChild['id'];

    // Attendance monthly report for child
    $stmtAtt = $db->prepare('
        SELECT * FROM attendance_records 
        WHERE student_id = :sid 
        ORDER BY date DESC
    ');
    $stmtAtt->execute(['sid' => $selectedChildId]);
    $attendanceRecords = $stmtAtt->fetchAll();

    $totalPresent = 0;
    $totalAbsent = 0;
    $totalLate = 0;
    foreach ($attendanceRecords as $ar) {
        if ($ar['status'] === 'present') {
            $totalPresent++;
        } elseif ($ar['status'] === 'late') {
            $totalLate++;
        } else {
            $totalAbsent++;
        }
    }

    // Enrolled Teachers for this Child
    $stmtTeachers = $db->prepare('
        SELECT se.*, t.name AS teacher_name, t.center_name, t.subject, t.phone,
               sg.name AS group_name, sg.price, sg.payment_scheme 
        FROM student_enrollments se 
        JOIN teachers t ON se.teacher_id = t.id 
        JOIN study_groups sg ON se.group_id = sg.id 
        WHERE se.student_id = :sid
        ORDER BY t.id ASC
    ');
    $stmtTeachers->execute(['sid' => $selectedChildId]);
    $teachers = $stmtTeachers->fetchAll();

    // Homeworks
    $stmtHw = $db->prepare('
        SELECT hw.*, t.name AS teacher_name, sub.status AS submission_status, sub.grade, sub.feedback 
        FROM homeworks hw 
        JOIN student_enrollments se ON hw.group_id = se.group_id 
        JOIN teachers t ON hw.teacher_id = t.id 
        LEFT JOIN student_homework_submissions sub ON hw.id = sub.homework_id AND sub.student_id = :sid
        WHERE se.student_id = :sid
        ORDER BY hw.due_date DESC
    ');
    $stmtHw->execute(['sid' => $selectedChildId]);
    $homeworks = $stmtHw->fetchAll();

    // Exams & Scores
    $stmtExams = $db->prepare('
        SELECT ex.*, t.name AS teacher_name, res.score, res.max_score, res.feedback 
        FROM exams ex 
        JOIN teachers t ON ex.teacher_id = t.id 
        LEFT JOIN student_exam_results res ON ex.id = res.exam_id AND res.student_id = :sid
        ORDER BY ex.date DESC
    ');
    $stmtExams->execute(['sid' => $selectedChildId]);
    $exams = $stmtExams->fetchAll();

    Helper::sendJson([
        'success' => true,
        'parent' => [
            'id' => (int)$parent['id'],
            'name' => (string)$parent['name'],
            'email' => (string)$parent['email'],
            'phone' => (string)$parent['phone']
        ],
        'children' => $children,
        'selected_child' => $selectedChild,
        'teachers' => $teachers,
        'attendance_report' => [
            'records' => $attendanceRecords,
            'total_present' => $totalPresent,
            'total_absent' => $totalAbsent,
            'total_late' => $totalLate
        ],
        'homeworks' => $homeworks,
        'exams' => $exams
    ]);

} catch (Throwable $exception) {
    // Keep actionable details in the server error log only.
    error_log('parent.php dashboard failure (' . get_class($exception) . ')');
    Helper::sendJson([
        'success' => false,
        'message' => 'حدث خطأ غير متوقع'
    ], 500);
}
