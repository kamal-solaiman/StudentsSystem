<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/helper.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../config/auth.php';

Helper::handleCorsOptions();

// SECURITY: Require authentication for student endpoint
$user = AuthManager::requireRole(['student', 'parent', 'teacher', 'staff', 'super_admin']);

// SECURITY: For staff, check specific permission
if ($user['role'] === 'staff') {
    AuthManager::requirePermission('students');
}

try {
    $db = DatabaseConnection::fromConfigFile()->connect();
    
    // SECURITY: Extract student_id from request, but validate access
    $requestedStudentId = isset($_GET['student_id']) ? (int)$_GET['student_id'] : 0;
    
    // Determine which student data we can access based on user role
    if ($user['role'] === 'student') {
        // Student can only access their own data
        // Find the student record for this user
        $stmtStudentUser = $db->prepare('SELECT id FROM students WHERE user_id = :uid LIMIT 1');
        $stmtStudentUser->execute(['uid' => $user['user_id']]);
        $studentUser = $stmtStudentUser->fetch();
        
        if ($studentUser === false) {
            Helper::sendForbidden('Student record not found for authenticated user');
        }
        
        $studentId = (int)$studentUser['id'];
        
        // If a specific student_id was requested, verify it matches
        if ($requestedStudentId > 0 && $requestedStudentId !== $studentId) {
            Helper::sendForbidden('Access denied');
        }
        
    } elseif ($user['role'] === 'parent') {
        // Parent can access their children's data
        // Verify the requested student belongs to this parent
        if ($requestedStudentId <= 0) {
            // Find first child of this parent
            $stmtChild = $db->prepare('SELECT id FROM students WHERE parent_user_id = :puid OR parent_phone = :pphone LIMIT 1');
            $stmtChild->execute([
                'puid' => $user['user_id'],
                'pphone' => $user['phone']
            ]);
            $child = $stmtChild->fetch();
            if ($child === false) {
                Helper::sendForbidden('No children found for this parent');
            }
            $studentId = (int)$child['id'];
        } else {
            // Verify this student belongs to the parent
            $stmtVerify = $db->prepare('SELECT id FROM students WHERE id = :sid AND (parent_user_id = :puid OR parent_phone = :pphone) LIMIT 1');
            $stmtVerify->execute([
                'sid' => $requestedStudentId,
                'puid' => $user['user_id'],
                'pphone' => $user['phone']
            ]);
            $verified = $stmtVerify->fetch();
            if ($verified === false) {
                Helper::sendForbidden('Access denied');
            }
            $studentId = $requestedStudentId;
        }
        
    } elseif ($user['role'] === 'teacher' || $user['role'] === 'staff') {
        // Teacher/Staff can access students in their groups
        if ($requestedStudentId <= 0) {
            Helper::sendJson(['success' => false, 'message' => 'Student ID is required'], 400);
        }
        
        // Verify this student is enrolled with the teacher
        $teacherId = (int)$user['tenant_teacher_id'];
        $stmtVerify = $db->prepare('SELECT se.id FROM student_enrollments se WHERE se.student_id = :sid AND se.teacher_id = :tid LIMIT 1');
        $stmtVerify->execute([
            'sid' => $requestedStudentId,
            'tid' => $teacherId
        ]);
        if ($stmtVerify->fetch() === false) {
            Helper::sendForbidden('Access denied');
        }
        $studentId = $requestedStudentId;
        
    } elseif ($user['role'] === 'super_admin') {
        // Super admin should not access individual student data per business rules
        Helper::sendForbidden('Access denied');
    } else {
        Helper::sendForbidden('Access denied');
    }
    
    if ($studentId <= 0) {
        Helper::sendJson(['success' => false, 'message' => 'Invalid student ID'], 400);
    }

    $stmtStudent = $db->prepare('SELECT * FROM students WHERE id = :sid LIMIT 1');
    $stmtStudent->execute(['sid' => $studentId]);
    $student = $stmtStudent->fetch();

    if ($student === false) {
        Helper::sendJson(['success' => false, 'message' => 'Student not found'], 404);
    }

    // Subscriptions across Teachers (Multi-Tenant Unified Student link)
    $stmtSubs = $db->prepare('
        SELECT se.*, t.name AS teacher_name, t.subject, t.center_name, t.phone,
               sg.name AS group_name, sg.class_time, sg.study_days, sg.payment_scheme, sg.price 
        FROM student_enrollments se 
        JOIN teachers t ON se.teacher_id = t.id 
        JOIN study_groups sg ON se.group_id = sg.id 
        WHERE se.student_id = :sid
        ORDER BY se.id DESC
    ');
    $stmtSubs->execute(['sid' => $studentId]);
    $subsRaw = $stmtSubs->fetchAll();

    $subscriptions = [];
    foreach ($subsRaw as $row) {
        $subscriptions[] = [
            'id' => (int)$row['id'],
            'teacher_name' => (string)$row['teacher_name'],
            'subject' => (string)$row['subject'],
            'center_name' => (string)$row['center_name'],
            'phone' => (string)$row['phone'],
            'group_name' => (string)$row['group_name'],
            'class_time' => (string)$row['class_time'],
            'study_days' => json_decode((string)$row['study_days'], true) ?: [],
            'payment_scheme' => (string)$row['payment_scheme'],
            'price' => (float)$row['price'],
            'payment_status' => (string)$row['payment_status'],
            'status' => (string)$row['status']
        ];
    }

    // Homeworks
    $stmtHw = $db->prepare('
        SELECT hw.*, t.name AS teacher_name, 
               sub.status AS submission_status, sub.grade, sub.feedback 
        FROM homeworks hw 
        JOIN student_enrollments se ON hw.group_id = se.group_id 
        JOIN teachers t ON hw.teacher_id = t.id 
        LEFT JOIN student_homework_submissions sub ON hw.id = sub.homework_id AND sub.student_id = :sid
        WHERE se.student_id = :sid
        ORDER BY hw.due_date DESC
    ');
    $stmtHw->execute(['sid' => $studentId]);
    $homeworks = $stmtHw->fetchAll();

    // Exams
    $stmtExams = $db->prepare('
        SELECT ex.*, t.name AS teacher_name, 
               res.score, res.max_score, res.feedback, res.status AS result_status 
        FROM exams ex 
        JOIN teachers t ON ex.teacher_id = t.id 
        LEFT JOIN student_exam_results res ON ex.id = res.exam_id AND res.student_id = :sid
        ORDER BY ex.date DESC
    ');
    $stmtExams->execute(['sid' => $studentId]);
    $exams = $stmtExams->fetchAll();

    // Lesson Videos
    $stmtVideos = $db->prepare('
        SELECT lv.*, t.name AS teacher_name, t.subject 
        FROM lesson_videos lv 
        JOIN student_enrollments se ON lv.group_id = se.group_id 
        JOIN teachers t ON lv.teacher_id = t.id 
        WHERE se.student_id = :sid
        ORDER BY lv.id DESC
    ');
    $stmtVideos->execute(['sid' => $studentId]);
    $lessons = $stmtVideos->fetchAll();

    // Notifications
    $stmtNotif = $db->prepare('SELECT * FROM notifications WHERE target_user_id = :uid ORDER BY created_at DESC');
    $stmtNotif->execute(['uid' => (int)$student['user_id']]);
    $notifications = $stmtNotif->fetchAll();

    Helper::sendJson([
        'success' => true,
        'student' => [
            'id' => (int)$student['id'],
            'student_code' => (string)$student['student_code'],
            'name' => (string)$student['name'],
            'phone' => (string)$student['phone'],
            'parent_phone' => (string)$student['parent_phone'],
            'grade_level' => (string)$student['grade_level'],
            'qr_code_token' => (string)$student['qr_code_token']
        ],
        'subscriptions' => $subscriptions,
        'homeworks' => $homeworks,
        'exams' => $exams,
        'lessons' => $lessons,
        'notifications' => $notifications
    ]);

} catch (Throwable $exception) {
    // Keep actionable details in the server error log only.
    error_log('student.php dashboard failure (' . get_class($exception) . ')');
    Helper::sendJson([
        'success' => false,
        'message' => 'حدث خطأ غير متوقع'
    ], 500);
}
