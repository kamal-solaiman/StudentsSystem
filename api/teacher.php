<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/helper.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../config/auth.php';

/**
 * Academic-class catalog shared by GET normalization and POST validation.
 * `academic_classes.level` is intentionally reused for the educational stage;
 * only `grade` is added by the focused migration.
 */
function teacherAcademicClassCatalog(): array
{
    return [
        'primary' => [
            'adjective' => 'الابتدائي',
            'grades' => ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'],
        ],
        'preparatory' => [
            'adjective' => 'الإعدادي',
            'grades' => ['first', 'second', 'third'],
        ],
        'secondary' => [
            'adjective' => 'الثانوي',
            'grades' => ['first', 'second', 'third'],
        ],
        // The pre-existing "general" category is unrestricted by a specific
        // school cycle, so it uses the existing first–sixth grade vocabulary.
        'general' => [
            'adjective' => 'العام',
            'grades' => ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'],
        ],
    ];
}

function teacherAcademicGradeLabels(): array
{
    return [
        'first' => 'الأول',
        'second' => 'الثاني',
        'third' => 'الثالث',
        'fourth' => 'الرابع',
        'fifth' => 'الخامس',
        'sixth' => 'السادس',
    ];
}

/** Normalize known pre-migration level codes without changing row IDs/names. */
function teacherAcademicClassParts(string $level, ?string $grade): array
{
    $legacy = [
        'prep_1' => ['preparatory', 'first'],
        'prep_2' => ['preparatory', 'second'],
        'prep_3' => ['preparatory', 'third'],
        'sec_1' => ['secondary', 'first'],
        'sec_2' => ['secondary', 'second'],
        'sec_3' => ['secondary', 'third'],
    ];
    if (($grade === null || $grade === '') && isset($legacy[$level])) {
        [$level, $grade] = $legacy[$level];
    }

    $catalog = teacherAcademicClassCatalog();
    $valid = isset($catalog[$level])
        && is_string($grade)
        && in_array($grade, $catalog[$level]['grades'], true);

    return [
        'educational_stage' => $valid ? $level : null,
        'grade' => $valid ? $grade : null,
        'valid' => $valid,
    ];
}

function teacherAcademicClassName(string $educationalStage, string $grade): string
{
    $catalog = teacherAcademicClassCatalog();
    $gradeLabels = teacherAcademicGradeLabels();
    return 'الصف ' . $gradeLabels[$grade] . ' ' . $catalog[$educationalStage]['adjective'];
}

/**
 * P1-J: Canonical study-day catalog, in the Arabic week order already used by
 * the existing `study_groups.study_days` JSON convention (database/seed.sql).
 * Client-submitted days are validated against this list and stored as Arabic
 * day names — no new storage representation is introduced.
 */
function teacherStudyDayCatalog(): array
{
    return ['السبت', 'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
}

/**
 * P1-J: Unicode-aware string length (mbstring optional, same fallback logic
 * as the class validators) so group-name limits behave for Arabic text.
 */
function teacherUnicodeLength(string $s): int
{
    if (function_exists('mb_strlen')) {
        return mb_strlen($s, 'UTF-8');
    }
    if (strlen($s) > 4000) {
        return 1001;
    }
    $count = preg_match_all('/./us', $s, $matches);
    return $count === false ? strlen($s) : $count;
}

/**
 * P1-J: Backend-authoritative study-group payload validation (shared by
 * create_group and update_group). teacher_id is NEVER accepted from the
 * client — the caller passes the session tenant id — and the selected
 * academic class is re-verified against academic_classes.teacher_id.
 *
 * Stored conventions (matching database/schema.sql):
 *  - study_days   → JSON array of canonical Arabic day names (deduped, week order)
 *  - class_time   → canonical 24h "HH:MM" lesson START (never a localized
 *                   Arabic string; legacy rows may still hold one and are
 *                   preserved until the teacher edits them)
 *  - end_time     → canonical 24h "HH:MM" lesson END, strictly after the
 *                   start (P1-J-FIX; nullable for legacy rows)
 *  - shift        → ENUM('morning','evening'), default 'evening'
 *  - price        → numeric, >= 0, at most 2 decimals (DECIMAL(10,2))
 *  - payment_scheme → ENUM('monthly','per_session')
 */
function teacherValidateStudyGroupPayload(array $payload, PDO $db, int $teacherId): array
{
    // Group name: required, trimmed, max 150 chars (schema VARCHAR(150)).
    $nameRaw = $payload['name'] ?? null;
    if (!is_string($nameRaw) || trim($nameRaw) === '') {
        Helper::sendJson(['success' => false, 'error' => 'اسم المجموعة مطلوب'], 400);
    }
    $name = Helper::sanitizeString(trim($nameRaw));
    if (teacherUnicodeLength($name) > 150) {
        Helper::sendJson(['success' => false, 'error' => 'اسم المجموعة طويل جداً (الحد الأقصى 150 حرفاً)'], 400);
    }

    // Academic class: required integer id that MUST belong to the session tenant.
    $classIdRaw = $payload['class_id'] ?? null;
    $classIdIsValid = is_int($classIdRaw)
        || (is_string($classIdRaw) && $classIdRaw !== '' && ctype_digit($classIdRaw));
    if (!$classIdIsValid || (int)$classIdRaw <= 0) {
        Helper::sendJson(['success' => false, 'error' => 'الصف الدراسي مطلوب'], 400);
    }
    $classId = (int)$classIdRaw;
    $stmtClassExists = $db->prepare('SELECT id FROM academic_classes WHERE id = :cid LIMIT 1');
    $stmtClassExists->execute(['cid' => $classId]);
    if ($stmtClassExists->fetch() === false) {
        Helper::sendNotFound('الصف الدراسي غير موجود');
    }
    $stmtClassOwn = $db->prepare('SELECT id FROM academic_classes WHERE id = :cid AND teacher_id = :tid LIMIT 1');
    $stmtClassOwn->execute(['cid' => $classId, 'tid' => $teacherId]);
    if ($stmtClassOwn->fetch() === false) {
        Helper::sendForbidden('Access denied');
    }

    // Study days: required non-empty array of canonical Arabic day names.
    $daysInput = $payload['study_days'] ?? null;
    if (!is_array($daysInput) || count($daysInput) === 0) {
        Helper::sendJson(['success' => false, 'error' => 'يرجى اختيار يوم دراسة واحد على الأقل'], 400);
    }
    $catalog = teacherStudyDayCatalog();
    $acceptedDays = [];
    foreach ($daysInput as $day) {
        if (!is_string($day)) {
            continue; // malformed entries are ignored, never trusted
        }
        $day = trim($day);
        if (!in_array($day, $catalog, true) || in_array($day, $acceptedDays, true)) {
            continue; // invalid or duplicate values are dropped
        }
        $acceptedDays[] = $day;
    }
    if (count($acceptedDays) === 0) {
        Helper::sendJson(['success' => false, 'error' => 'أيام الدراسة غير صالحة'], 400);
    }
    // Normalize to canonical week order regardless of the client order.
    $orderedDays = [];
    foreach ($catalog as $day) {
        if (in_array($day, $acceptedDays, true)) {
            $orderedDays[] = $day;
        }
    }

    // Lesson time range (P1-J-FIX): canonical 24h "HH:MM" start AND end,
    // both required, end strictly after start. No localized strings, no
    // seconds, no out-of-range hour/minute values.
    $startRaw = $payload['start_time'] ?? null;
    if (!is_string($startRaw) || preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/', trim($startRaw)) !== 1) {
        Helper::sendJson(['success' => false, 'error' => 'موعد بداية الحصة غير صالح'], 400);
    }
    [$hourPart, $minutePart] = explode(':', trim($startRaw));
    $classTime = sprintf('%02d:%02d', (int)$hourPart, (int)$minutePart);

    $endRaw = $payload['end_time'] ?? null;
    if (!is_string($endRaw) || preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/', trim($endRaw)) !== 1) {
        Helper::sendJson(['success' => false, 'error' => 'موعد نهاية الحصة غير صالح'], 400);
    }
    [$endHourPart, $endMinutePart] = explode(':', trim($endRaw));
    $endTime = sprintf('%02d:%02d', (int)$endHourPart, (int)$endMinutePart);

    // end > start (same day). Equal times are rejected too.
    $startMinutes = ((int)$hourPart) * 60 + (int)$minutePart;
    $endMinutes = ((int)$endHourPart) * 60 + (int)$endMinutePart;
    if ($endMinutes <= $startMinutes) {
        Helper::sendJson(['success' => false, 'error' => 'وقت نهاية الحصة يجب أن يكون بعد وقت بدايتها'], 400);
    }

    // Shift: schema ENUM('morning','evening'), default 'evening'.
    $shiftRaw = $payload['shift'] ?? 'evening';
    if (!is_string($shiftRaw) || !in_array($shiftRaw, ['morning', 'evening'], true)) {
        Helper::sendJson(['success' => false, 'error' => 'الفترة غير صالحة (صباحي أو مسائي)'], 400);
    }

    // Price: required numeric, >= 0, DECIMAL(10,2) → at most 2 decimals.
    $priceRaw = $payload['price'] ?? null;
    if (!is_int($priceRaw) && !is_float($priceRaw) && !(is_string($priceRaw) && is_numeric($priceRaw))) {
        Helper::sendJson(['success' => false, 'error' => 'سعر الدرس مطلوب ويجب أن يكون رقمًا'], 400);
    }
    $price = (float)$priceRaw;
    if ($price < 0) {
        Helper::sendJson(['success' => false, 'error' => 'سعر الدرس لا يمكن أن يكون سالبًا'], 400);
    }
    if ($price > 99999999.99) {
        Helper::sendJson(['success' => false, 'error' => 'سعر الدرس يتجاوز الحد الأقصى المسموح'], 400);
    }
    if (round($price, 2) !== $price) {
        Helper::sendJson(['success' => false, 'error' => 'سعر الدرس يجب ألا يتضمن أكثر من رقمين عشريين'], 400);
    }

    // Payment scheme: schema ENUM('monthly','per_session') only — the UI
    // exposes the Arabic labels for exactly these database values.
    $schemeRaw = $payload['payment_scheme'] ?? null;
    if (!is_string($schemeRaw) || !in_array($schemeRaw, ['monthly', 'per_session'], true)) {
        Helper::sendJson(['success' => false, 'error' => 'نظام الدفع غير صالح'], 400);
    }

    return [
        'name' => $name,
        'class_id' => $classId,
        'study_days' => $orderedDays,
        'class_time' => $classTime,
        'end_time' => $endTime,
        'shift' => $shiftRaw,
        'price' => number_format($price, 2, '.', ''),
        'payment_scheme' => $schemeRaw,
    ];
}

Helper::handleCorsOptions();

// SECURITY: Require authentication for all teacher endpoints
$user = AuthManager::requireRole(['super_admin', 'teacher', 'staff']);

// SECURITY: For staff, check dashboard access permission
if ($user['role'] === 'staff') {
    // Staff needs at least one permission to access teacher dashboard
    // This allows them to see the dashboard but specific operations will require specific permissions
    $permissions = AuthManager::getStaffPermissions();
    if (empty($permissions)) {
        Helper::sendForbidden('Access denied: No permissions assigned');
    }
}

// SECURITY: Verify CSRF token for state-changing methods
if (in_array($_SERVER['REQUEST_METHOD'], ['POST', 'DELETE'], true)) {
    $input = Helper::getJsonInput();
    $csrfRaw = $input['csrf_token'] ?? null;
    $csrfToken = is_string($csrfRaw) ? $csrfRaw : null;

    // Also check header for CSRF token
    if ($csrfToken === null || $csrfToken === '') {
        $headerToken = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? null;
        $csrfToken = is_string($headerToken) ? $headerToken : null;
    }

    if (!AuthManager::validateCsrfToken($csrfToken)) {
        Helper::sendForbidden('Invalid CSRF token');
    }
}

try {
    $db = DatabaseConnection::fromConfigFile()->connect();
    $method = $_SERVER['REQUEST_METHOD'];

    // SECURITY: Extract teacher_id from session context, not from request parameter
    // For teachers and staff, use their tenant_teacher_id
    if ($user['role'] === 'teacher' || $user['role'] === 'staff') {
        $teacherId = (int)$user['tenant_teacher_id'];
        if ($teacherId <= 0) {
            Helper::sendForbidden('Invalid teacher context');
        }
    } elseif ($user['role'] === 'super_admin') {
        // SECURITY FIX: Super Admin should NOT access individual teacher data per business rules
        // Super Admin can only manage platform-level settings, not tenant-specific data
        Helper::sendForbidden('Super Admin cannot access individual teacher dashboard. Use super_admin.php for platform management.');
    } else {
        Helper::sendForbidden('Access denied');
    }

    // GET: Fetch teacher dashboard data with complete Multi-Tenant isolation
    if ($method === 'GET') {
        // Teacher Profile
        $stmtTeacher = $db->prepare('SELECT * FROM teachers WHERE id = :id LIMIT 1');
        $stmtTeacher->execute(['id' => $teacherId]);
        $teacher = $stmtTeacher->fetch();

        if ($teacher === false) {
            Helper::sendJson(['success' => false, 'error' => 'لم يتم العثور على المدرس في المنصة'], 404);
        }

        // Academic Classes & Groups Count
        $stmtClasses = $db->prepare('
            SELECT ac.*, COUNT(sg.id) AS groups_count 
            FROM academic_classes ac 
            LEFT JOIN study_groups sg ON ac.id = sg.class_id 
            WHERE ac.teacher_id = :tid 
            GROUP BY ac.id 
            ORDER BY ac.id ASC
        ');
        $stmtClasses->execute(['tid' => $teacherId]);
        $classesRaw = $stmtClasses->fetchAll();
        $classes = [];
        foreach ($classesRaw as $row) {
            $parts = teacherAcademicClassParts(
                (string)($row['level'] ?? ''),
                isset($row['grade']) ? (string)$row['grade'] : null
            );
            $canonicalName = $parts['valid']
                ? teacherAcademicClassName($parts['educational_stage'], $parts['grade'])
                : (string)$row['name'];
            $classes[] = [
                'id' => (int)$row['id'],
                'teacher_id' => (int)$row['teacher_id'],
                // Structured rows always expose the deterministic canonical
                // display name. Unknown legacy rows retain their original name.
                'name' => $canonicalName,
                'educational_stage' => $parts['educational_stage'],
                'grade' => $parts['grade'],
                // Keep level in the response for older consumers; for all new
                // rows it now means educational stage, not stage+grade.
                'level' => $parts['educational_stage'] ?? (string)$row['level'],
                'description' => $row['description'] === null ? null : (string)$row['description'],
                'groups_count' => (int)$row['groups_count'],
                'created_at' => (string)$row['created_at'],
                'is_legacy' => !$parts['valid'],
            ];
        }

        // Study Groups (P1-J: student count exposed for the groups list; the
        // count is scoped to the session tenant's own enrollments only)
        $stmtGroups = $db->prepare('
            SELECT sg.*, ac.name AS class_name,
                   (SELECT COUNT(*) FROM student_enrollments se
                     WHERE se.group_id = sg.id AND se.teacher_id = sg.teacher_id) AS student_count
            FROM study_groups sg 
            LEFT JOIN academic_classes ac ON sg.class_id = ac.id 
            WHERE sg.teacher_id = :tid 
            ORDER BY sg.id ASC
        ');
        $stmtGroups->execute(['tid' => $teacherId]);
        $groupsRaw = $stmtGroups->fetchAll();
        $groups = [];
        foreach ($groupsRaw as $row) {
            // Malformed JSON must never surface as a non-array value to the
            // frontend (which calls Array.isArray / join on it).
            $decodedDays = json_decode((string)$row['study_days'], true);
            $studyDays = [];
            if (is_array($decodedDays)) {
                foreach ($decodedDays as $day) {
                    if (is_string($day)) {
                        $studyDays[] = $day;
                    }
                }
            }
            $groups[] = [
                'id' => (int)$row['id'],
                'class_id' => (int)$row['class_id'],
                'class_name' => (string)$row['class_name'],
                'name' => (string)$row['name'],
                'study_days' => $studyDays,
                'class_time' => (string)$row['class_time'],
                // P1-J-FIX: nullable for legacy rows created before the
                // من/إلى range existed; the UI then shows only the start.
                'end_time' => isset($row['end_time']) && $row['end_time'] !== null && $row['end_time'] !== ''
                    ? (string)$row['end_time'] : null,
                'shift' => (string)$row['shift'],
                'price' => (float)$row['price'],
                'payment_scheme' => (string)$row['payment_scheme'],
                'student_count' => (int)$row['student_count']
            ];
        }

        // Enrolled Students with this Teacher
        $stmtStudents = $db->prepare('
            SELECT s.*, se.group_id, se.class_id, se.payment_status, se.enrollment_date,
                   sg.name AS group_name, ac.name AS class_name 
            FROM student_enrollments se 
            JOIN students s ON se.student_id = s.id 
            LEFT JOIN study_groups sg ON se.group_id = sg.id 
            LEFT JOIN academic_classes ac ON se.class_id = ac.id 
            WHERE se.teacher_id = :tid 
            ORDER BY se.id DESC
        ');
        $stmtStudents->execute(['tid' => $teacherId]);
        $students = $stmtStudents->fetchAll();

        // All platform students (for linking an existing unified student account)
        $stmtAllStudents = $db->query('SELECT id, student_code, name, phone, grade_level FROM students ORDER BY id DESC');
        $allPlatformStudents = $stmtAllStudents->fetchAll();

        // Attendance Overview Today
        $today = date('Y-m-d');
        $stmtAttPresent = $db->prepare('SELECT COUNT(*) AS c FROM attendance_records WHERE teacher_id = :tid AND date = :dt AND status = "present"');
        $stmtAttPresent->execute(['tid' => $teacherId, 'dt' => $today]);
        $todayAttendance = (int)$stmtAttPresent->fetch()['c'];

        $stmtAttAbs = $db->prepare('SELECT COUNT(*) AS c FROM attendance_records WHERE teacher_id = :tid AND date = :dt AND status IN ("absent", "late")');
        $stmtAttAbs->execute(['tid' => $teacherId, 'dt' => $today]);
        $todayAbsence = (int)$stmtAttAbs->fetch()['c'];

        // Upcoming Exams
        $stmtExams = $db->prepare('SELECT * FROM exams WHERE teacher_id = :tid ORDER BY id DESC');
        $stmtExams->execute(['tid' => $teacherId]);
        $exams = $stmtExams->fetchAll();

        // Teacher Staff
        $stmtStaff = $db->prepare('
            SELECT ts.*, u.name, u.email, u.phone 
            FROM teacher_staff ts 
            JOIN users u ON ts.user_id = u.id 
            WHERE ts.teacher_id = :tid
        ');
        $stmtStaff->execute(['tid' => $teacherId]);
        $staffRaw = $stmtStaff->fetchAll();
        $staff = [];
        foreach ($staffRaw as $sr) {
            $staff[] = [
                'id' => (int)$sr['id'],
                'user_id' => (int)$sr['user_id'],
                'name' => (string)$sr['name'],
                'phone' => (string)$sr['phone'],
                'role_title' => (string)$sr['role_title'],
                'permissions' => json_decode((string)$sr['permissions'], true) ?: []
            ];
        }

        $activeStudentsCount = count($students);
        $pricePerSt = (float)$teacher['price_per_student'];
        $monthlySub = $activeStudentsCount * $pricePerSt;

        Helper::sendJson([
            'success' => true,
            'teacher' => [
                'id' => (int)$teacher['id'],
                'name' => (string)$teacher['name'],
                'center_name' => (string)$teacher['center_name'],
                'phone' => (string)$teacher['phone'],
                'address' => (string)$teacher['address'],
                'subject' => (string)$teacher['subject'],
                'price_per_student' => $pricePerSt,
                'subscription_monthly' => $monthlySub
            ],
            'classes' => $classes,
            'groups' => $groups,
            'students' => $students,
            'all_platform_students' => $allPlatformStudents,
            'exams' => $exams,
            'staff' => $staff,
            'overview' => [
                'total_students' => $activeStudentsCount,
                'total_classes' => count($classes),
                'total_groups' => count($groups),
                'today_attendance' => $todayAttendance,
                'today_absence' => $todayAbsence,
                'upcoming_exams_count' => count($exams),
                'subscription_monthly' => $monthlySub
            ]
        ]);
    }

    // POST: Create Class, Study Group, Add Student, or Update Settings
    if ($method === 'POST') {
        // Reuse the same parsed body that passed CSRF validation instead of
        // performing a second, unnecessary php://input read.
        $input = isset($input) && is_array($input) ? $input : Helper::getJsonInput();
        $actionRaw = $input['action'] ?? '';
        if (!is_string($actionRaw)) {
            Helper::sendJson(['success' => false, 'error' => 'صيغة الطلب غير صالحة'], 400);
        }
        $action = Helper::sanitizeString($actionRaw);
        $payload = is_array($input['payload'] ?? null) ? $input['payload'] : [];

        // SECURITY: For staff, check specific permission for each action
        // P1-I: update_class is a classes operation, same 'classes' permission.
        if ($user['role'] === 'staff') {
            if ($action === 'create_class' || $action === 'update_class' || $action === 'delete-class') {
                AuthManager::requirePermission('classes');
            } elseif ($action === 'create_group' || $action === 'update_group' || $action === 'delete-group') {
                AuthManager::requirePermission('groups');
            } elseif ($action === 'create_student' || $action === 'enroll_existing_student') {
                AuthManager::requirePermission('students');
            } elseif ($action === 'update_teacher_settings') {
                AuthManager::requirePermission('settings');
            }
        }

        // Count Unicode characters even when the optional mbstring extension
        // is unavailable; JSON input is UTF-8 and PCRE is part of PHP core.
        $textLen = static function (string $s): int {
            if (function_exists('mb_strlen')) {
                return mb_strlen($s, 'UTF-8');
            }
            // More than 4 bytes per allowed character is already over limit;
            // cap work before building the small PCRE match array.
            if (strlen($s) > 4000) {
                return 1001;
            }
            $count = preg_match_all('/./us', $s, $matches);
            return $count === false ? strlen($s) : $count;
        };

        // Backend-authoritative academic class validation. The submitted name
        // and teacher_id (if any) are deliberately ignored; both are derived.
        $validateClassPayload = static function (array $classPayload) use ($textLen): array {
            $stageRaw = $classPayload['educational_stage'] ?? null;
            if (!is_string($stageRaw)) {
                Helper::sendJson(['success' => false, 'error' => 'المرحلة التعليمية غير صالحة'], 400);
            }
            $stage = trim($stageRaw);
            $catalog = teacherAcademicClassCatalog();
            if (!isset($catalog[$stage])) {
                Helper::sendJson(['success' => false, 'error' => 'المرحلة التعليمية غير صالحة'], 400);
            }

            $gradeRaw = $classPayload['grade'] ?? null;
            if (!is_string($gradeRaw)) {
                Helper::sendJson(['success' => false, 'error' => 'الصف الدراسي غير صالح'], 400);
            }
            $grade = trim($gradeRaw);
            if (!in_array($grade, $catalog[$stage]['grades'], true)) {
                Helper::sendJson(['success' => false, 'error' => 'الصف الدراسي غير متاح للمرحلة التعليمية المحددة'], 400);
            }

            $descRaw = $classPayload['description'] ?? '';
            if ($descRaw !== null && !is_string($descRaw)) {
                Helper::sendJson(['success' => false, 'error' => 'الوصف غير صالح'], 400);
            }
            $description = $descRaw === null ? '' : Helper::sanitizeString($descRaw);
            if ($textLen($description) > 1000) {
                Helper::sendJson(['success' => false, 'error' => 'الوصف طويل جداً (الحد الأقصى 1000 حرف)'], 400);
            }

            return [
                'educational_stage' => $stage,
                'grade' => $grade,
                'name' => teacherAcademicClassName($stage, $grade),
                'description' => $description === '' ? null : $description,
            ];
        };

        // Create Academic Class. teacher_id comes only from tenant_teacher_id.
        if ($action === 'create_class') {
            $class = $validateClassPayload($payload);
            $stmt = $db->prepare('
                INSERT INTO academic_classes (teacher_id, name, level, grade, description)
                VALUES (:tid, :name, :level, :grade, :descr)
            ');
            $stmt->execute([
                'tid' => $teacherId,
                'name' => $class['name'],
                'level' => $class['educational_stage'],
                'grade' => $class['grade'],
                'descr' => $class['description'],
            ]);

            Helper::sendJson([
                'success' => true,
                'message' => 'تم إضافة الصف الدراسي بنجاح',
                'id' => (int)$db->lastInsertId(),
                'name' => $class['name'],
            ]);
        }

        // Ownership-aware UPDATE. 404 if absent, 403 if another tenant owns it.
        if ($action === 'update_class') {
            $idRaw = $payload['id'] ?? null;
            $idIsValid = is_int($idRaw)
                || (is_string($idRaw) && $idRaw !== '' && ctype_digit($idRaw));
            if (!$idIsValid || (int)$idRaw <= 0) {
                Helper::sendJson(['success' => false, 'error' => 'معرف الصف غير صالح'], 400);
            }
            $classId = (int)$idRaw;

            $stmtExists = $db->prepare('SELECT id FROM academic_classes WHERE id = :cid LIMIT 1');
            $stmtExists->execute(['cid' => $classId]);
            if ($stmtExists->fetch() === false) {
                Helper::sendNotFound('الصف الدراسي غير موجود');
            }

            $stmtOwn = $db->prepare('SELECT id FROM academic_classes WHERE id = :cid AND teacher_id = :tid LIMIT 1');
            $stmtOwn->execute(['cid' => $classId, 'tid' => $teacherId]);
            if ($stmtOwn->fetch() === false) {
                Helper::sendForbidden('Access denied');
            }

            $class = $validateClassPayload($payload);
            $stmt = $db->prepare('
                UPDATE academic_classes
                SET name = :name, level = :level, grade = :grade, description = :descr
                WHERE id = :cid AND teacher_id = :tid
            ');
            $stmt->execute([
                'tid' => $teacherId,
                'cid' => $classId,
                'name' => $class['name'],
                'level' => $class['educational_stage'],
                'grade' => $class['grade'],
                'descr' => $class['description'],
            ]);

            Helper::sendJson([
                'success' => true,
                'message' => 'تم تحديث الصف الدراسي بنجاح',
                'name' => $class['name'],
            ]);
        }

        // Create Study Group
        if ($action === 'create_group') {
            // SECURITY (P1-J): full backend-authoritative validation. The
            // class must belong to the session tenant; teacher_id comes only
            // from tenant_teacher_id and is never read from the payload.
            $group = teacherValidateStudyGroupPayload($payload, $db, $teacherId);

            $stmt = $db->prepare('
                INSERT INTO study_groups (teacher_id, class_id, name, study_days, class_time, end_time, shift, price, payment_scheme)
                VALUES (:tid, :cid, :name, :days, :time, :end_time, :shift, :price, :scheme)
            ');
            $stmt->execute([
                'tid' => $teacherId,
                'cid' => $group['class_id'],
                'name' => $group['name'],
                'days' => json_encode($group['study_days'], JSON_UNESCAPED_UNICODE),
                'time' => $group['class_time'],
                'end_time' => $group['end_time'],
                'shift' => $group['shift'],
                'price' => $group['price'],
                'scheme' => $group['payment_scheme']
            ]);

            Helper::sendJson([
                'success' => true,
                'message' => 'تم إضافة المجموعة الدراسية بنجاح',
                'id' => (int)$db->lastInsertId()
            ]);
        }

        // Update Study Group (P1-J). Ownership-aware like update_class:
        // 404 when absent, 403 when owned by another tenant; the update
        // itself is scoped by id AND teacher_id.
        if ($action === 'update_group') {
            $idRaw = $payload['id'] ?? null;
            $idIsValid = is_int($idRaw)
                || (is_string($idRaw) && $idRaw !== '' && ctype_digit($idRaw));
            if (!$idIsValid || (int)$idRaw <= 0) {
                Helper::sendJson(['success' => false, 'error' => 'معرف المجموعة غير صالح'], 400);
            }
            $groupId = (int)$idRaw;

            $stmtExists = $db->prepare('SELECT id FROM study_groups WHERE id = :gid LIMIT 1');
            $stmtExists->execute(['gid' => $groupId]);
            if ($stmtExists->fetch() === false) {
                Helper::sendNotFound('المجموعة غير موجودة');
            }

            $stmtOwn = $db->prepare('SELECT id FROM study_groups WHERE id = :gid AND teacher_id = :tid LIMIT 1');
            $stmtOwn->execute(['gid' => $groupId, 'tid' => $teacherId]);
            if ($stmtOwn->fetch() === false) {
                Helper::sendForbidden('Access denied');
            }

            $group = teacherValidateStudyGroupPayload($payload, $db, $teacherId);
            $stmt = $db->prepare('
                UPDATE study_groups
                SET class_id = :cid, name = :name, study_days = :days,
                    class_time = :time, end_time = :end_time, shift = :shift,
                    price = :price, payment_scheme = :scheme
                WHERE id = :gid AND teacher_id = :tid
            ');
            $stmt->execute([
                'gid' => $groupId,
                'tid' => $teacherId,
                'cid' => $group['class_id'],
                'name' => $group['name'],
                'days' => json_encode($group['study_days'], JSON_UNESCAPED_UNICODE),
                'time' => $group['class_time'],
                'end_time' => $group['end_time'],
                'shift' => $group['shift'],
                'price' => $group['price'],
                'scheme' => $group['payment_scheme']
            ]);

            Helper::sendJson([
                'success' => true,
                'message' => 'تم تحديث المجموعة الدراسية بنجاح',
                'name' => $group['name']
            ]);
        }

        // Create New Student & Enroll with Teacher
        if ($action === 'create_student') {
            $name = Helper::sanitizeString($payload['name'] ?? '');
            $phone = Helper::sanitizeString($payload['phone'] ?? '');
            $parentPhone = Helper::sanitizeString($payload['parent_phone'] ?? '');
            $gradeLevel = Helper::sanitizeString($payload['grade_level'] ?? 'ثالثة ثانوي');
            $groupId = (int)($payload['group_id'] ?? 1);
            $classId = (int)($payload['class_id'] ?? 1);

            // SECURITY (P1-B): Verify the class belongs to this teacher's tenant
            $stmtChkC = $db->prepare('SELECT id FROM academic_classes WHERE id = :cid AND teacher_id = :tid LIMIT 1');
            $stmtChkC->execute(['cid' => $classId, 'tid' => $teacherId]);
            if ($stmtChkC->fetch() === false) {
                Helper::sendForbidden('Access denied');
            }

            // SECURITY (P1-B): Verify the group belongs to this teacher's tenant
            $stmtChkG = $db->prepare('SELECT id FROM study_groups WHERE id = :gid AND teacher_id = :tid LIMIT 1');
            $stmtChkG->execute(['gid' => $groupId, 'tid' => $teacherId]);
            if ($stmtChkG->fetch() === false) {
                Helper::sendForbidden('Access denied');
            }

            $db->beginTransaction();
            try {
                // Create User record
                $stmtUser = $db->prepare('
                    INSERT INTO users (name, email, phone, password_hash, role)
                    VALUES (:name, :email, :phone, :phash, "student")
                ');
                $stmtUser->execute([
                    'name' => $name,
                    'email' => time() . '@student.edu',
                    'phone' => $phone,
                    'phash' => password_hash('123456', PASSWORD_DEFAULT)
                ]);
                $userId = (int)$db->lastInsertId();

                // Create Student profile
                $studentCode = 'STU-' . rand(10000, 99999);
                $stmtSt = $db->prepare('
                    INSERT INTO students (user_id, student_code, name, phone, parent_phone, grade_level, qr_code_token)
                    VALUES (:uid, :code, :name, :phone, :pphone, :grade, :qr)
                ');
                $stmtSt->execute([
                    'uid' => $userId,
                    'code' => $studentCode,
                    'name' => $name,
                    'phone' => $phone,
                    'pphone' => $parentPhone,
                    'grade' => $gradeLevel,
                    'qr' => 'QR-' . $studentCode . '-TOKEN-' . time()
                ]);
                $studentId = (int)$db->lastInsertId();

                // Enroll with current teacher & group
                $stmtEnr = $db->prepare('
                    INSERT INTO student_enrollments (teacher_id, student_id, class_id, group_id, enrollment_date, status, payment_status)
                    VALUES (:tid, :sid, :cid, :gid, CURRENT_DATE(), "active", "paid")
                ');
                $stmtEnr->execute([
                    'tid' => $teacherId,
                    'sid' => $studentId,
                    'cid' => $classId,
                    'gid' => $groupId
                ]);

                $db->commit();
                Helper::sendJson(['success' => true, 'message' => 'تم إنشاء حساب الطالب وربطه بالمجموعة بنجاح', 'student_code' => $studentCode]);

            } catch (Throwable $ex) {
                $db->rollBack();
                throw $ex;
            }
        }

        // Enroll Existing Student (Unified Student Account)
        if ($action === 'enroll_existing_student') {
            $studentId = (int)($payload['student_id'] ?? 1);
            $groupId = (int)($payload['group_id'] ?? 1);
            $classId = (int)($payload['class_id'] ?? 1);

            // SECURITY (P1-B): Verify the student exists
            $stmtStu = $db->prepare('SELECT id FROM students WHERE id = :sid LIMIT 1');
            $stmtStu->execute(['sid' => $studentId]);
            if ($stmtStu->fetch() === false) {
                Helper::sendNotFound('Student not found');
            }

            // SECURITY (P1-B): Prevent duplicate enrollment with the same teacher
            $stmtDup = $db->prepare('SELECT id FROM student_enrollments WHERE teacher_id = :tid AND student_id = :sid LIMIT 1');
            $stmtDup->execute(['tid' => $teacherId, 'sid' => $studentId]);
            if ($stmtDup->fetch() !== false) {
                Helper::sendJson(['success' => false, 'message' => 'الطالب مرتبط بالفعل بمجموعات هذا المدرس'], 400);
            }

            // SECURITY (P1-B): Verify the class belongs to this teacher's tenant
            $stmtChkC = $db->prepare('SELECT id FROM academic_classes WHERE id = :cid AND teacher_id = :tid LIMIT 1');
            $stmtChkC->execute(['cid' => $classId, 'tid' => $teacherId]);
            if ($stmtChkC->fetch() === false) {
                Helper::sendForbidden('Access denied');
            }

            // SECURITY (P1-B): Verify the group belongs to this teacher's tenant
            $stmtChkG = $db->prepare('SELECT id FROM study_groups WHERE id = :gid AND teacher_id = :tid LIMIT 1');
            $stmtChkG->execute(['gid' => $groupId, 'tid' => $teacherId]);
            if ($stmtChkG->fetch() === false) {
                Helper::sendForbidden('Access denied');
            }

            $stmt = $db->prepare('
                INSERT INTO student_enrollments (teacher_id, student_id, class_id, group_id, enrollment_date, status, payment_status)
                VALUES (:tid, :sid, :cid, :gid, CURRENT_DATE(), "active", "paid")
            ');
            $stmt->execute([
                'tid' => $teacherId,
                'sid' => $studentId,
                'cid' => $classId,
                'gid' => $groupId
            ]);

            Helper::sendJson(['success' => true, 'message' => 'تم ربط الطالب الموجود بمجموعتك بنجاح — حساب موحد']);
        }

        // Update Teacher Settings
        if ($action === 'update_teacher_settings') {
            $stmt = $db->prepare('
                UPDATE teachers 
                SET name = :name, center_name = :center, phone = :phone, address = :addr, subject = :subj, price_per_student = :price
                WHERE id = :tid
            ');
            $stmt->execute([
                'tid' => $teacherId,
                'name' => Helper::sanitizeString($payload['name'] ?? ''),
                'center' => Helper::sanitizeString($payload['center_name'] ?? ''),
                'phone' => Helper::sanitizeString($payload['phone'] ?? ''),
                'addr' => Helper::sanitizeString($payload['address'] ?? ''),
                'subj' => Helper::sanitizeString($payload['subject'] ?? ''),
                'price' => (float)($payload['price_per_student'] ?? 50.0)
            ]);

            Helper::sendJson(['success' => true, 'message' => 'تم حفظ إعدادات المدرس بنجاح']);
        }

        Helper::sendJson(['success' => false, 'error' => 'إجراء غير معروف في المدرس'], 400);
    }

    // DELETE: Delete class or group
    if ($method === 'DELETE') {
        $entityRaw = $_GET['entity'] ?? '';
        $entity = is_string($entityRaw) ? Helper::sanitizeString($entityRaw) : '';
        $idRaw = $_GET['id'] ?? null;
        $idIsValid = is_string($idRaw) && $idRaw !== '' && ctype_digit($idRaw);
        $id = $idIsValid ? (int)$idRaw : 0;

        // SECURITY: For staff, check specific permission for each entity
        if ($user['role'] === 'staff') {
            if ($entity === 'class') {
                AuthManager::requirePermission('classes');
            } elseif ($entity === 'group') {
                AuthManager::requirePermission('groups');
            }
        }

        if ($entity === 'class' && $id > 0) {
            // SECURITY (P1-B/P1-I): Never delete another teacher's class and
            // never delete a class that still has dependent data. The class
            // row is locked (FOR UPDATE) so a concurrent study_groups insert
            // (which needs a shared lock on the parent row for its FK) cannot
            // slip in between the dependency check and the DELETE.
            $db->beginTransaction();
            try {
                $stmtOwn = $db->prepare('SELECT id FROM academic_classes WHERE id = :cid AND teacher_id = :tid LIMIT 1 FOR UPDATE');
                $stmtOwn->execute(['cid' => $id, 'tid' => $teacherId]);
                if ($stmtOwn->fetch() === false) {
                    $db->rollBack();
                    // Distinguish 404 (class does not exist) from 403 (exists
                    // but belongs to another teacher) per project convention.
                    $stmtExists = $db->prepare('SELECT id FROM academic_classes WHERE id = :cid LIMIT 1');
                    $stmtExists->execute(['cid' => $id]);
                    if ($stmtExists->fetch() === false) {
                        Helper::sendNotFound('الصف الدراسي غير موجود');
                    }
                    Helper::sendForbidden('Access denied');
                }

                // SECURITY (P1-I): study_groups.class_id has ON DELETE CASCADE
                // and student_enrollments / exams / question_bank reference
                // class_id. If any dependent record exists, refuse with 409
                // instead of cascade-deleting or orphaning production data.
                // NOTE: PDO runs native prepares (ATTR_EMULATE_PREPARES=false),
                // so a named placeholder cannot be reused — use one per column.
                $stmtDeps = $db->prepare('
                    SELECT
                        (SELECT COUNT(*) FROM study_groups WHERE class_id = :cid1) AS group_count,
                        (SELECT COUNT(*) FROM student_enrollments WHERE class_id = :cid2) AS enrollment_count,
                        (SELECT COUNT(*) FROM exams WHERE class_id = :cid3) AS exam_count,
                        (SELECT COUNT(*) FROM question_bank WHERE class_id = :cid4) AS question_count
                ');
                $stmtDeps->execute(['cid1' => $id, 'cid2' => $id, 'cid3' => $id, 'cid4' => $id]);
                $deps = $stmtDeps->fetch();
                $dependent = (int)($deps['group_count'] ?? 0)
                    + (int)($deps['enrollment_count'] ?? 0)
                    + (int)($deps['exam_count'] ?? 0)
                    + (int)($deps['question_count'] ?? 0);
                if ($dependent > 0) {
                    $db->rollBack();
                    Helper::sendJson([
                        'success' => false,
                        'message' => 'لا يمكن حذف هذا الصف الدراسي لوجود بيانات مرتبطة به (مجموعات دراسية، طلاب مسجلين، امتحانات أو أسئلة). احذف البيانات المرتبطة أولاً.'
                    ], 409);
                }

                $stmt = $db->prepare('DELETE FROM academic_classes WHERE id = :id AND teacher_id = :tid');
                $stmt->execute(['id' => $id, 'tid' => $teacherId]);
                if ($stmt->rowCount() === 0) {
                    $db->rollBack();
                    Helper::sendNotFound('الصف الدراسي غير موجود');
                }
                $db->commit();
            } catch (Throwable $ex) {
                if ($db->inTransaction()) {
                    $db->rollBack();
                }
                throw $ex;
            }
            Helper::sendJson(['success' => true, 'message' => 'تم حذف الصف الدراسي بنجاح']);
        }

        if ($entity === 'group' && $id > 0) {
            // SECURITY (P1-J): Never delete another teacher's group and never
            // delete a group that still has dependent data. The row is locked
            // (FOR UPDATE) while dependencies are counted, mirroring the
            // P1-I class-delete pattern.
            $db->beginTransaction();
            try {
                $stmtOwn = $db->prepare('SELECT id FROM study_groups WHERE id = :gid AND teacher_id = :tid LIMIT 1 FOR UPDATE');
                $stmtOwn->execute(['gid' => $id, 'tid' => $teacherId]);
                if ($stmtOwn->fetch() === false) {
                    $db->rollBack();
                    // Distinguish 404 (group does not exist) from 403 (exists
                    // but belongs to another teacher) per project convention.
                    $stmtExists = $db->prepare('SELECT id FROM study_groups WHERE id = :gid LIMIT 1');
                    $stmtExists->execute(['gid' => $id]);
                    if ($stmtExists->fetch() === false) {
                        Helper::sendNotFound('المجموعة غير موجودة');
                    }
                    Helper::sendForbidden('Access denied');
                }

                // SECURITY (P1-J): refuse with 409 instead of silently
                // orphaning enrollment / attendance / exam / homework /
                // lesson-video rows that keep a group_id reference.
                $stmtDeps = $db->prepare('
                    SELECT
                        (SELECT COUNT(*) FROM student_enrollments WHERE group_id = :gid1) AS enrollment_count,
                        (SELECT COUNT(*) FROM attendance_records WHERE group_id = :gid2) AS attendance_count,
                        (SELECT COUNT(*) FROM exams WHERE group_id = :gid3) AS exam_count,
                        (SELECT COUNT(*) FROM homeworks WHERE group_id = :gid4) AS homework_count,
                        (SELECT COUNT(*) FROM lesson_videos WHERE group_id = :gid5) AS video_count
                ');
                $stmtDeps->execute(['gid1' => $id, 'gid2' => $id, 'gid3' => $id, 'gid4' => $id, 'gid5' => $id]);
                $deps = $stmtDeps->fetch();
                $dependent = (int)($deps['enrollment_count'] ?? 0)
                    + (int)($deps['attendance_count'] ?? 0)
                    + (int)($deps['exam_count'] ?? 0)
                    + (int)($deps['homework_count'] ?? 0)
                    + (int)($deps['video_count'] ?? 0);
                if ($dependent > 0) {
                    $db->rollBack();
                    Helper::sendJson([
                        'success' => false,
                        'message' => 'لا يمكن حذف المجموعة لارتباطها ببيانات أخرى (طلاب مسجلين، سجلات حضور، امتحانات، واجبات أو دروس مسجلة). احذف البيانات المرتبطة أولاً.'
                    ], 409);
                }

                $stmt = $db->prepare('DELETE FROM study_groups WHERE id = :id AND teacher_id = :tid');
                $stmt->execute(['id' => $id, 'tid' => $teacherId]);
                if ($stmt->rowCount() === 0) {
                    $db->rollBack();
                    Helper::sendNotFound('المجموعة غير موجودة');
                }
                $db->commit();
            } catch (Throwable $ex) {
                if ($db->inTransaction()) {
                    $db->rollBack();
                }
                throw $ex;
            }
            Helper::sendJson(['success' => true, 'message' => 'تم حذف المجموعة بنجاح']);
        }

        Helper::sendJson(['success' => false, 'error' => 'فشل الحذف، معرف أو كيان غير صالح'], 400);
    }

    Helper::sendJson(['success' => false, 'error' => 'طريقة الطلب غير مسموح بها'], 405);

} catch (Throwable $exception) {
    // SECURITY (P1-I): log full details server-side; NEVER expose SQL errors,
    // exception messages, stack traces or filesystem paths to the frontend.
    error_log('[teacher.php] ' . $exception->getMessage());
    Helper::sendJson([
        'success' => false,
        'error' => 'خطأ في سيرفر لوحة المدرس'
    ], 500);
}
