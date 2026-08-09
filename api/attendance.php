<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/helper.php';
require_once __DIR__ . '/../config/database.php';

Helper::handleCorsOptions();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Helper::sendJson(['success' => false, 'error' => 'يجب استخدام طلب POST لتسجيل الحضور'], 405);
}

$input = Helper::getJsonInput();
$teacherId = (int)($input['teacher_id'] ?? 1);
$studentId = (int)($input['student_id'] ?? 0);
$studentCode = Helper::sanitizeString($input['student_code'] ?? '');
$method = Helper::sanitizeString($input['method'] ?? 'manual');
$status = Helper::sanitizeString($input['status'] ?? 'present');
$arrivalTime = Helper::sanitizeString($input['arrival_time'] ?? date('h:i A'));
$lateMinutes = (int)($input['late_minutes'] ?? 0);
$notes = Helper::sanitizeString($input['notes'] ?? 'تم التسجيل عبر المنصة');

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
        Helper::sendJson(['success' => false, 'error' => 'الرجاء تحديد الطالب أو كود الطالب'], 422);
    }

    // Identify student default group with this teacher
    $stmtGrp = $db->prepare('SELECT group_id FROM student_enrollments WHERE teacher_id = :tid AND student_id = :sid LIMIT 1');
    $stmtGrp->execute(['tid' => $teacherId, 'sid' => $studentId]);
    $enr = $stmtGrp->fetch();
    $groupId = $enr ? (int)$enr['group_id'] : 1;

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
