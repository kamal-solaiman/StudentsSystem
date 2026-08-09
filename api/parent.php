<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/helper.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../config/auth.php';

Helper::handleCorsOptions();

try {
    $db = DatabaseConnection::fromConfigFile()->connect();
    $parentUserId = isset($_GET['parent_id']) ? (int)$_GET['parent_id'] : 5;
    $studentIdParam = isset($_GET['student_id']) ? (int)$_GET['student_id'] : 0;

    $stmtParent = $db->prepare('SELECT * FROM users WHERE id = :uid LIMIT 1');
    $stmtParent->execute(['uid' => $parentUserId]);
    $parent = $stmtParent->fetch();

    if ($parent === false) {
        Helper::sendJson(['success' => false, 'error' => 'لم يتم العثور على حساب ولي الأمر'], 404);
    }

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
        // If no child matched by ID, fallback to student 1 and 2 demo
        $stmtChildren = $db->query('SELECT * FROM students LIMIT 2');
        $children = $stmtChildren->fetchAll();
    }

    $selectedChild = null;
    if ($studentIdParam > 0) {
        foreach ($children as $ch) {
            if ((int)$ch['id'] === $studentIdParam) {
                $selectedChild = $ch;
                break;
            }
        }
    }
    if ($selectedChild === null) {
        $selectedChild = $children[0] ?? [];
    }
    $selectedChildId = (int)($selectedChild['id'] ?? 1);

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
    Helper::sendJson([
        'success' => false,
        'error' => 'خطأ في سيرفر لوحة ولي الأمر: ' . $exception->getMessage()
    ], 500);
}
