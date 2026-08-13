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

// SECURITY (P1-G): 'student' was added to this role list ONLY so students can
// submit scanned dynamic-QR attendance (the qr-scan branch below). Students
// are hard-blocked from every other branch (generation / manual / scanner).
// Teacher, staff and super_admin behavior is unchanged.
$user = AuthManager::requireRole(['teacher', 'staff', 'super_admin', 'student']);

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

/* ===========================================================================
 * P1-G — DYNAMIC QR (Stateless HMAC-SHA256 + 45s TTL, broadcast-safe)
 *
 * Token  = base64url(payload_json) . "." . base64url(HMAC-SHA256(payload_part, secret))
 * Payload= {"v":1,"tid":..,"gid":..,"cid":..,"nonce":..,"iat":..,"exp":iat+45}
 *
 * The same broadcast token stays valid for every ENROLLED student until `exp`;
 * per-student same-day dedupe prevents duplicate records (replay-safe).
 * All validation is server-side; the frontend never decides validity.
 * ========================================================================= */

const QR_VERSION = 1;
const QR_TTL_SECONDS = 45;

/** Load the QR HMAC secret (fail-closed). Never echoed, logged, or returned. */
function qr_secret(): ?string
{
    $file = __DIR__ . '/../config/qr_secret.php';
    if (!file_exists($file)) {
        return null;
    }
    try {
        $secret = require $file;
    } catch (Throwable) {
        return null;
    }
    if (!is_string($secret) || strlen($secret) < 32) {
        return null;
    }
    return $secret;
}

function qr_base64url_encode(string $data): string
{
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function qr_base64url_decode(string $data): string|false
{
    $padded = $data . str_repeat('=', (4 - (strlen($data) % 4)) % 4);
    return base64_decode(strtr($padded, '-_', '+/'), true);
}

/** Prevent any caching of QR material. */
function qr_no_store_headers(): void
{
    header('Cache-Control: no-store, no-cache, must-revalidate');
    header('Pragma: no-cache');
    header('Expires: 0');
}

/** Safe generic failure — never exposes HMAC/secret/SQL/internals. */
function qr_fail_invalid(int $status = 403, string $message = 'رمز الحضور غير صالح'): never
{
    Helper::sendJson(['success' => false, 'message' => $message], $status);
}

/**
 * Teacher/staff: issue a signed 45s broadcast QR for one of their own groups.
 */
function qr_handle_generate(int $teacherId, array $input): never
{
    $secret = qr_secret();
    if ($secret === null) {
        Helper::sendJson(['success' => false, 'message' => 'خدمة رمز الحضور غير مهيأة على الخادم'], 503);
    }

    try {
        $db = DatabaseConnection::fromConfigFile()->connect();
    } catch (Throwable) {
        Helper::sendJson(['success' => false, 'message' => 'حدث خطأ غير متوقع'], 500);
    }

    $groupId = Helper::sanitizeInt($input['group_id'] ?? null, 1);
    if ($groupId === null) {
        Helper::sendJson(['success' => false, 'message' => 'بيانات الطلب غير صالحة'], 400);
    }

    // Ownership: the group must belong to this teacher (tenant isolation)
    $stmtG = $db->prepare('SELECT class_id FROM study_groups WHERE id = :gid AND teacher_id = :tid LIMIT 1');
    $stmtG->execute(['gid' => $groupId, 'tid' => $teacherId]);
    $group = $stmtG->fetch();
    if ($group === false) {
        Helper::sendForbidden('Access denied');
    }
    $classId = (int)$group['class_id'];

    // Ownership: the derived class must belong to the same teacher
    $stmtC = $db->prepare('SELECT id FROM academic_classes WHERE id = :cid AND teacher_id = :tid LIMIT 1');
    $stmtC->execute(['cid' => $classId, 'tid' => $teacherId]);
    if ($stmtC->fetch() === false) {
        Helper::sendForbidden('Access denied');
    }

    // Signed payload (Unix timestamps — UTC-consistent)
    $iat = time();
    $exp = $iat + QR_TTL_SECONDS;
    $nonce = bin2hex(random_bytes(16)); // cryptographically secure

    $payloadJson = json_encode([
        'v'     => QR_VERSION,
        'tid'   => $teacherId,
        'gid'   => $groupId,
        'cid'   => $classId,
        'nonce' => $nonce,
        'iat'   => $iat,
        'exp'   => $exp,
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

    $payloadPart = qr_base64url_encode($payloadJson);
    $signature = hash_hmac('sha256', $payloadPart, $secret, true);
    $token = $payloadPart . '.' . qr_base64url_encode($signature);

    qr_no_store_headers();
    Helper::sendJson([
        'success'  => true,
        'qr_token' => $token,
        'iat'      => $iat,
        'exp'      => $exp,
        'ttl'      => QR_TTL_SECONDS,
    ]);
}

/**
 * Student: submit a scanned dynamic QR. Full server-side validation, then
 * attendance recording with same-day dedupe (broadcast replay-safe).
 */
function qr_handle_student_scan(array $user, array $input): never
{
    // Students may ONLY use the dynamic-QR scan flow — nothing else
    $method = Helper::sanitizeString($input['method'] ?? '');
    if ($method !== 'dynamic_qr') {
        Helper::sendForbidden('Access denied');
    }

    $qrToken = is_string($input['qr_token'] ?? null) ? trim($input['qr_token']) : '';
    if ($qrToken === '' || strlen($qrToken) > 2048) {
        qr_fail_invalid(400);
    }

    $secret = qr_secret();
    if ($secret === null) {
        Helper::sendJson(['success' => false, 'message' => 'خدمة رمز الحضور غير مهيأة على الخادم'], 503);
    }

    // --- Format: two base64url parts separated by "." -------------------
    $parts = explode('.', $qrToken);
    if (count($parts) !== 2 || $parts[0] === '' || $parts[1] === '') {
        qr_fail_invalid(400);
    }
    [$payloadPart, $signaturePart] = $parts;

    $payloadJson = qr_base64url_decode($payloadPart);
    $signatureBytes = qr_base64url_decode($signaturePart);
    if ($payloadJson === false || $signatureBytes === false || strlen($signatureBytes) !== 32) {
        qr_fail_invalid(400);
    }

    $payload = json_decode($payloadJson, true);
    if (!is_array($payload)) {
        qr_fail_invalid(400);
    }

    // --- Required fields -------------------------------------------------
    foreach (['v', 'tid', 'gid', 'cid', 'nonce', 'iat', 'exp'] as $requiredKey) {
        if (!array_key_exists($requiredKey, $payload)) {
            qr_fail_invalid(400);
        }
    }

    if ((int)$payload['v'] !== QR_VERSION) {
        qr_fail_invalid(400);
    }

    $iat = filter_var($payload['iat'], FILTER_VALIDATE_INT);
    $exp = filter_var($payload['exp'], FILTER_VALIDATE_INT);
    $teacherId = filter_var($payload['tid'], FILTER_VALIDATE_INT);
    $groupId = filter_var($payload['gid'], FILTER_VALIDATE_INT);
    $classId = filter_var($payload['cid'], FILTER_VALIDATE_INT);
    if ($iat === false || $exp === false || $teacherId === false || $groupId === false || $classId === false
        || $teacherId < 1 || $groupId < 1 || $classId < 1) {
        qr_fail_invalid(400);
    }

    if (!is_string($payload['nonce']) || strlen($payload['nonce']) < 16 || strlen($payload['nonce']) > 128) {
        qr_fail_invalid(400);
    }

    if ($exp <= $iat) {
        qr_fail_invalid(400);
    }
    if (($exp - $iat) > QR_TTL_SECONDS) {
        // Forged/extended lifetime — reject even if otherwise well-formed
        qr_fail_invalid(400);
    }

    // --- Expiry (server clock is authoritative) ---------------------------
    if (time() > $exp) {
        qr_no_store_headers();
        Helper::sendJson(['success' => false, 'message' => 'انتهت صلاحية رمز الحضور'], 403);
    }

    // --- HMAC signature (constant-time comparison) ------------------------
    $expectedSignature = hash_hmac('sha256', $payloadPart, $secret, true);
    if (!hash_equals($expectedSignature, $signatureBytes)) {
        qr_fail_invalid(403);
    }

    // --- Tenant isolation & ownership --------------------------------------
    try {
        $db = DatabaseConnection::fromConfigFile()->connect();

        // The group must belong to the teacher encoded in the signed token
        $stmtG = $db->prepare('SELECT id FROM study_groups WHERE id = :gid AND teacher_id = :tid LIMIT 1');
        $stmtG->execute(['gid' => $groupId, 'tid' => $teacherId]);
        if ($stmtG->fetch() === false) {
            qr_fail_invalid(403);
        }

        // The class must belong to the same teacher
        $stmtC = $db->prepare('SELECT id FROM academic_classes WHERE id = :cid AND teacher_id = :tid LIMIT 1');
        $stmtC->execute(['cid' => $classId, 'tid' => $teacherId]);
        if ($stmtC->fetch() === false) {
            qr_fail_invalid(403);
        }

        // Student identity comes from the authenticated session — never the QR
        $stmtS = $db->prepare('SELECT id FROM students WHERE user_id = :uid LIMIT 1');
        $stmtS->execute(['uid' => $user['user_id']]);
        $studentRow = $stmtS->fetch();
        if ($studentRow === false) {
            Helper::sendForbidden('Access denied');
        }
        $studentId = (int)$studentRow['id'];

        // The student must be enrolled in exactly this group of this teacher
        $stmtE = $db->prepare('
            SELECT id FROM student_enrollments
            WHERE teacher_id = :tid AND student_id = :sid AND group_id = :gid
            LIMIT 1
        ');
        $stmtE->execute(['tid' => $teacherId, 'sid' => $studentId, 'gid' => $groupId]);
        if ($stmtE->fetch() === false) {
            Helper::sendJson(['success' => false, 'message' => 'غير مصرح لك بالحضور في هذه المجموعة'], 403);
        }

        // Broadcast replay safety: one attendance record per student per day.
        // The same valid QR works for every enrolled student until `exp`,
        // but re-submitting it never creates duplicates.
        $stmtD = $db->prepare('
            SELECT id FROM attendance_records
            WHERE teacher_id = :tid AND student_id = :sid AND date = CURRENT_DATE()
            LIMIT 1
        ');
        $stmtD->execute(['tid' => $teacherId, 'sid' => $studentId]);
        if ($stmtD->fetch() !== false) {
            Helper::sendJson([
                'success' => true,
                'already_recorded' => true,
                'message' => 'تم تسجيل حضورك مسبقًا اليوم',
            ]);
        }

        $stmtInsert = $db->prepare('
            INSERT INTO attendance_records
                (teacher_id, student_id, group_id, date, status, arrival_time, departure_time, late_minutes, method, notes)
            VALUES
                (:tid, :sid, :gid, CURRENT_DATE(), "present", :arrival, "", 0, "dynamic_qr", :notes)
        ');
        $stmtInsert->execute([
            'tid' => $teacherId,
            'sid' => $studentId,
            'gid' => $groupId,
            'arrival' => Helper::sanitizeString(date('h:i A')),
            'notes' => 'تسجيل تلقائي عبر الـ QR الديناميكي',
        ]);

        Helper::sendJson([
            'success' => true,
            'already_recorded' => false,
            'message' => 'تم تسجيل الحضور بنجاح',
        ]);
    } catch (Throwable) {
        // Generic message only — no SQL, stack traces, or internals
        Helper::sendJson(['success' => false, 'message' => 'حدث خطأ غير متوقع'], 500);
    }
}

/* ============================ Request routing ============================ */

// P1-G: Students can ONLY scan a dynamic QR — every other action is rejected.
if ($user['role'] === 'student') {
    qr_handle_student_scan($user, $input);
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

// P1-G: Teacher/staff issue a new signed broadcast QR for one of their groups
$action = Helper::sanitizeString($input['action'] ?? '');
if ($action === 'generate_qr') {
    qr_handle_generate($teacherId, $input);
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
    // P1-G: generic message only — never expose SQL/stack trace/internals
    Helper::sendJson([
        'success' => false,
        'error' => 'حدث خطأ غير متوقع أثناء تسجيل الحضور'
    ], 500);
}
