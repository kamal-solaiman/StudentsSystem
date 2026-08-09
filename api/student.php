<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/helper.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../config/auth.php';

Helper::handleCorsOptions();

try {
    $db = DatabaseConnection::fromConfigFile()->connect();
    $studentId = isset($_GET['student_id']) ? (int)$_GET['student_id'] : 1;
    if ($studentId <= 0) {
        $studentId = 1;
    }

    $stmtStudent = $db->prepare('SELECT * FROM students WHERE id = :sid LIMIT 1');
    $stmtStudent->execute(['sid' => $studentId]);
    $student = $stmtStudent->fetch();

    if ($student === false) {
        Helper::sendJson(['success' => false, 'error' => 'لم يتم العثور على الطالب الموحد'], 404);
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
    Helper::sendJson([
        'success' => false,
        'error' => 'خطأ في سيرفر لوحة الطالب الموحدة: ' . $exception->getMessage()
    ], 500);
}
