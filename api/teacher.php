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

/* ================================================================
 * P1-K: Students module helpers.
 *
 * Identity model (unchanged, audited before writing this code):
 *   - `students` is the ONE global student record of the platform and
 *     `students.student_code` is its authoritative unique business id.
 *   - `student_enrollments` is the ONLY teacher <-> student <-> group link
 *     and already carries `status`, so "delete" for a teacher is a hide
 *     (status = 'inactive'); a student row is NEVER deleted here.
 *   - Student credentials live in the shared `users` table
 *     (`students.user_id`), so an existing student keeps their username and
 *     password hash when a second teacher links them.
 *   - Parents are `users` with role='parent' referenced by
 *     `students.parent_user_id`; this module NEVER creates a parent account.
 * ================================================================ */

/** Default password of a student account created by a teacher (P1-K). */
function teacherDefaultStudentPassword(): string
{
    return '00000000';
}

/** Values allowed by students.gender (ENUM), plus "not specified" = NULL. */
function teacherStudentGenderCatalog(): array
{
    return ['male', 'female'];
}

/**
 * Inverse of the legacy level codes normalized by teacherAcademicClassParts().
 * Used so a student enrolled by another teacher in a pre-migration class row
 * ("sec_3") still matches the same academic class chosen here.
 */
function teacherAcademicClassLegacyCode(string $educationalStage, string $grade): string
{
    $legacy = [
        'preparatory' => ['first' => 'prep_1', 'second' => 'prep_2', 'third' => 'prep_3'],
        'secondary' => ['first' => 'sec_1', 'second' => 'sec_2', 'third' => 'sec_3'],
    ];
    return $legacy[$educationalStage][$grade] ?? '';
}

/**
 * P1-K: resolve an academic class that MUST belong to the session tenant.
 * 404 when the class does not exist, 403 when another teacher owns it
 * (same convention as update_class / delete class).
 */
function teacherRequireOwnedClass(PDO $db, int $classId, int $teacherId): array
{
    if ($classId <= 0) {
        Helper::sendJson(['success' => false, 'error' => 'الصف الدراسي مطلوب'], 400);
    }
    $stmt = $db->prepare('SELECT id, teacher_id, name, level, grade FROM academic_classes WHERE id = :cid LIMIT 1');
    $stmt->execute(['cid' => $classId]);
    $row = $stmt->fetch();
    if ($row === false) {
        Helper::sendNotFound('الصف الدراسي غير موجود');
    }
    if ((int)$row['teacher_id'] !== $teacherId) {
        Helper::sendForbidden('Access denied');
    }

    $parts = teacherAcademicClassParts(
        (string)$row['level'],
        isset($row['grade']) ? (string)$row['grade'] : null
    );
    $canonicalName = $parts['valid']
        ? teacherAcademicClassName($parts['educational_stage'], $parts['grade'])
        : (string)$row['name'];

    return [
        'id' => (int)$row['id'],
        'name' => $canonicalName,
        'educational_stage' => (string)($parts['educational_stage'] ?? ''),
        'grade' => (string)($parts['grade'] ?? ''),
        'legacy_code' => $parts['valid']
            ? teacherAcademicClassLegacyCode($parts['educational_stage'], $parts['grade'])
            : '',
    ];
}

/**
 * P1-K: resolve a study group that MUST belong to the session tenant.
 * 404 when absent, 403 when owned by another teacher.
 */
function teacherRequireOwnedGroup(PDO $db, int $groupId, int $teacherId): array
{
    if ($groupId <= 0) {
        Helper::sendJson(['success' => false, 'error' => 'المجموعة الدراسية مطلوبة'], 400);
    }
    $stmt = $db->prepare('SELECT id, teacher_id, class_id, name FROM study_groups WHERE id = :gid LIMIT 1');
    $stmt->execute(['gid' => $groupId]);
    $row = $stmt->fetch();
    if ($row === false) {
        Helper::sendNotFound('المجموعة غير موجودة');
    }
    if ((int)$row['teacher_id'] !== $teacherId) {
        Helper::sendForbidden('Access denied');
    }

    return [
        'id' => (int)$row['id'],
        'class_id' => (int)$row['class_id'],
        'name' => (string)$row['name'],
    ];
}

/**
 * P1-K: the academic class is a HARD backend filter for search and
 * enrollment — it is re-evaluated server-side and never trusted from the
 * client. A student matches the selected class when either:
 *   a) their stored grade_level equals the canonical class name, or
 *   b) they already have an enrollment (with ANY teacher) in an academic
 *      class of the same educational stage + grade — including the legacy
 *      level code and the identical canonical class name of another teacher.
 * No other teacher's data is ever returned; only the match is evaluated.
 */
function teacherStudentClassFilterSql(): string
{
    return '(
            s.grade_level = :cls_name
            OR EXISTS (
                SELECT 1 FROM student_enrollments se_f
                JOIN academic_classes ac_f ON se_f.class_id = ac_f.id
                WHERE se_f.student_id = s.id
                  AND (
                        (ac_f.level = :cls_level AND ac_f.grade = :cls_grade)
                        OR ac_f.level = :cls_legacy
                        OR ac_f.name = :cls_name2
                  )
            )
        )';
}

/** Bound values for teacherStudentClassFilterSql(). */
function teacherStudentClassFilterParams(array $class): array
{
    return [
        'cls_name' => $class['name'],
        'cls_name2' => $class['name'],
        'cls_level' => $class['educational_stage'] !== '' ? $class['educational_stage'] : '__none__',
        'cls_grade' => $class['grade'] !== '' ? $class['grade'] : '__none__',
        'cls_legacy' => $class['legacy_code'] !== '' ? $class['legacy_code'] : '__none__',
    ];
}

/**
 * PRIVACY (P1-K): search results expose the least identifying data that still
 * lets a teacher recognize the right student — the full phone number is
 * returned only for students already linked to the session tenant.
 */
function teacherMaskStudentPhone(string $phone): string
{
    $digits = preg_replace('/\D+/', '', $phone);
    $digits = is_string($digits) ? $digits : '';
    $length = strlen($digits);
    if ($length === 0) {
        return '';
    }
    if ($length <= 4) {
        return str_repeat('•', $length);
    }
    return substr($digits, 0, 3) . str_repeat('•', $length - 5) . substr($digits, -2);
}

/** Optional phone-ish text (student / parent). Stored as-is, never required. */
function teacherNormalizeOptionalPhone(mixed $raw, string $label): string
{
    if ($raw === null || $raw === '') {
        return '';
    }
    if (!is_string($raw) && !is_int($raw)) {
        Helper::sendJson(['success' => false, 'error' => $label . ' غير صالح'], 400);
    }
    $phone = Helper::sanitizeString(trim((string)$raw));
    if ($phone === '') {
        return '';
    }
    if (preg_match('/^[0-9+\-\s()]{6,30}$/', $phone) !== 1) {
        Helper::sendJson(['success' => false, 'error' => $label . ' غير صالح'], 400);
    }
    return $phone;
}

/**
 * P1-K: backend-authoritative student payload validation.
 *
 * NOTHING is artificially mandatory: only the student name is required (the
 * `students` table cannot store a nameless student). Every other profile
 * field is optional and stored as NULL / '' when omitted. teacher_id,
 * class_id and group_id are NEVER taken from here — the caller resolves them
 * from the session tenant and re-verifies ownership.
 */
function teacherValidateStudentPayload(array $payload): array
{
    // Name: the only required field (students.name is NOT NULL).
    $nameRaw = $payload['name'] ?? null;
    if (!is_string($nameRaw) || trim($nameRaw) === '') {
        Helper::sendJson(['success' => false, 'error' => 'اسم الطالب مطلوب'], 400);
    }
    $name = Helper::sanitizeString(trim($nameRaw));
    if (teacherUnicodeLength($name) > 150) {
        Helper::sendJson(['success' => false, 'error' => 'اسم الطالب طويل جداً (الحد الأقصى 150 حرفاً)'], 400);
    }

    // Student code: optional. When supplied it must look like a business code;
    // uniqueness is checked against the database by the caller.
    $codeRaw = $payload['student_code'] ?? null;
    $studentCode = '';
    if (is_string($codeRaw) && trim($codeRaw) !== '') {
        $studentCode = strtoupper(Helper::sanitizeString(trim($codeRaw)));
        if (preg_match('/^[A-Z0-9][A-Z0-9_\-]{2,49}$/', $studentCode) !== 1) {
            Helper::sendJson(['success' => false, 'error' => 'كود الطالب غير صالح (حروف إنجليزية وأرقام و - أو _ فقط)'], 400);
        }
    }

    // Email: optional. It becomes the student's username when provided, so it
    // must be a real address; uniqueness is checked by the caller.
    $emailRaw = $payload['email'] ?? null;
    $email = '';
    if (is_string($emailRaw) && trim($emailRaw) !== '') {
        $email = strtolower(trim($emailRaw));
        if (strlen($email) > 150 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            Helper::sendJson(['success' => false, 'error' => 'البريد الإلكتروني غير صالح'], 400);
        }
    }

    $phone = teacherNormalizeOptionalPhone($payload['phone'] ?? null, 'رقم هاتف الطالب');
    $parentPhone = teacherNormalizeOptionalPhone($payload['parent_phone'] ?? null, 'رقم هاتف ولي الأمر');

    // Gender: optional, schema ENUM('male','female') or NULL.
    $genderRaw = $payload['gender'] ?? null;
    $gender = null;
    if (is_string($genderRaw) && trim($genderRaw) !== '') {
        $gender = trim($genderRaw);
        if (!in_array($gender, teacherStudentGenderCatalog(), true)) {
            Helper::sendJson(['success' => false, 'error' => 'النوع غير صالح'], 400);
        }
    }

    // Date of birth: optional ISO date, never in the future.
    $dobRaw = $payload['date_of_birth'] ?? null;
    $dateOfBirth = null;
    if (is_string($dobRaw) && trim($dobRaw) !== '') {
        $dob = trim($dobRaw);
        $parsed = DateTime::createFromFormat('Y-m-d', $dob);
        if ($parsed === false || $parsed->format('Y-m-d') !== $dob) {
            Helper::sendJson(['success' => false, 'error' => 'تاريخ الميلاد غير صالح'], 400);
        }
        if ($dob > date('Y-m-d') || $dob < '1900-01-01') {
            Helper::sendJson(['success' => false, 'error' => 'تاريخ الميلاد غير منطقي'], 400);
        }
        $dateOfBirth = $dob;
    }

    // Address / notes: optional free text with schema-sized limits.
    $addressRaw = $payload['address'] ?? null;
    $address = null;
    if (is_string($addressRaw) && trim($addressRaw) !== '') {
        $address = Helper::sanitizeString(trim($addressRaw));
        if (teacherUnicodeLength($address) > 255) {
            Helper::sendJson(['success' => false, 'error' => 'العنوان طويل جداً (الحد الأقصى 255 حرفاً)'], 400);
        }
    }

    $notesRaw = $payload['notes'] ?? null;
    $notes = null;
    if (is_string($notesRaw) && trim($notesRaw) !== '') {
        $notes = Helper::sanitizeString(trim($notesRaw));
        if (teacherUnicodeLength($notes) > 2000) {
            Helper::sendJson(['success' => false, 'error' => 'الملاحظات طويلة جداً (الحد الأقصى 2000 حرف)'], 400);
        }
    }

    return [
        'name' => $name,
        'student_code' => $studentCode,
        'email' => $email,
        'phone' => $phone,
        'parent_phone' => $parentPhone,
        'gender' => $gender,
        'date_of_birth' => $dateOfBirth,
        'address' => $address,
        'notes' => $notes,
    ];
}

/**
 * P1-K: collision-safe student code. `students.student_code` is UNIQUE, so a
 * losing race still fails at the database; this only avoids the common case.
 */
function teacherGenerateStudentCode(PDO $db): string
{
    $stmt = $db->prepare('SELECT id FROM students WHERE student_code = :code LIMIT 1');
    for ($attempt = 0; $attempt < 25; $attempt++) {
        $code = 'STU-' . str_pad((string)random_int(10000, 99999), 5, '0', STR_PAD_LEFT);
        $stmt->execute(['code' => $code]);
        if ($stmt->fetch() === false) {
            return $code;
        }
    }
    Helper::sendJson(['success' => false, 'error' => 'تعذر توليد كود طالب فريد، حاول مرة أخرى'], 500);
}

/* ================================================================
 * P1-L: Teacher-scoped student profile helpers.
 *
 * IMPORTANT: a student is a global platform identity, but every profile
 * request starts from the ACTIVE student_enrollments row of the authenticated
 * session tenant. The group and class joins are tenant-qualified as well. A
 * caller can therefore never use a valid global student id to traverse into
 * another teacher's relationship data.
 * ================================================================ */

/** Strictly parse a positive integer supplied in a profile payload. */
function teacherProfilePositiveInt(mixed $raw, string $error): int
{
    $valid = is_int($raw)
        || (is_string($raw) && $raw !== '' && ctype_digit($raw));
    if (!$valid || (int)$raw <= 0) {
        Helper::sendJson(['success' => false, 'error' => $error], 400);
    }
    return (int)$raw;
}

/**
 * Resolve the student's global identity through THIS teacher's active link.
 *
 * The single tenant-qualified query intentionally returns 404 both when the
 * student id does not exist and when it exists but is not linked to this
 * tenant. That uniform response prevents student-id enumeration (IDOR).
 */
function teacherRequireOwnedStudentProfile(PDO $db, int $studentId, int $teacherId): array
{
    $stmt = $db->prepare('
        SELECT
            s.id AS student_id, s.student_code, s.name AS student_name,
            s.gender, s.date_of_birth, s.phone AS student_phone,
            s.parent_phone, s.address, s.grade_level,
            s.created_at AS platform_registered_at,
            u.email AS student_email,
            se.enrollment_date, se.status AS enrollment_status,
            ac.id AS class_id, ac.name AS class_name,
            ac.level AS class_level, ac.grade AS class_grade,
            sg.id AS group_id, sg.name AS group_name,
            sg.study_days, sg.class_time, sg.end_time, sg.shift,
            sg.price, sg.payment_scheme
        FROM student_enrollments se
        JOIN students s ON s.id = se.student_id
        JOIN users u ON u.id = s.user_id
        JOIN academic_classes ac
          ON ac.id = se.class_id AND ac.teacher_id = se.teacher_id
        JOIN study_groups sg
          ON sg.id = se.group_id
         AND sg.teacher_id = se.teacher_id
         AND sg.class_id = ac.id
        WHERE se.teacher_id = :tid
          AND se.student_id = :sid
          AND se.status = \'active\'
        LIMIT 1
    ');
    $stmt->execute(['tid' => $teacherId, 'sid' => $studentId]);
    $row = $stmt->fetch();
    if ($row === false) {
        Helper::sendNotFound('الطالب غير موجود في قائمتك');
    }

    $daysRaw = json_decode((string)($row['study_days'] ?? ''), true);
    $studyDays = [];
    if (is_array($daysRaw)) {
        foreach ($daysRaw as $day) {
            if (is_string($day)) {
                $studyDays[] = $day;
            }
        }
    }

    $email = trim((string)($row['student_email'] ?? ''));
    // Teacher-created accounts without a real email use an internal login
    // placeholder. It is not presented as the student's email address.
    if ($email !== '' && str_ends_with(strtolower($email), '@student.local')) {
        $email = '';
    }

    $parts = teacherAcademicClassParts(
        (string)($row['class_level'] ?? ''),
        isset($row['class_grade']) ? (string)$row['class_grade'] : null
    );
    $className = $parts['valid']
        ? teacherAcademicClassName($parts['educational_stage'], $parts['grade'])
        : (string)$row['class_name'];

    return [
        'student' => [
            'id' => (int)$row['student_id'],
            'student_code' => (string)$row['student_code'],
            'name' => (string)$row['student_name'],
            'phone' => (string)($row['student_phone'] ?? ''),
            'email' => $email !== '' ? $email : null,
            'parent_phone' => (string)($row['parent_phone'] ?? ''),
            'gender' => $row['gender'] !== null ? (string)$row['gender'] : null,
            'date_of_birth' => $row['date_of_birth'] !== null ? (string)$row['date_of_birth'] : null,
            'address' => $row['address'] !== null ? (string)$row['address'] : null,
            'grade_level' => (string)($row['grade_level'] ?? ''),
            'platform_registered_at' => $row['platform_registered_at'] !== null
                ? (string)$row['platform_registered_at'] : null,
        ],
        'enrollment' => [
            'enrollment_date' => (string)$row['enrollment_date'],
            'status' => (string)$row['enrollment_status'],
            // The schema has no current-group joined-at field. enrollment_date
            // is the teacher-link date and must not be mislabeled after transfer.
            'group_joined_at' => null,
        ],
        'class' => [
            'id' => (int)$row['class_id'],
            'name' => $className,
            'educational_stage' => $parts['educational_stage'],
            'grade' => $parts['grade'],
        ],
        'group' => [
            'id' => (int)$row['group_id'],
            'name' => (string)$row['group_name'],
            'study_days' => $studyDays,
            'class_time' => (string)$row['class_time'],
            'end_time' => $row['end_time'] !== null && $row['end_time'] !== ''
                ? (string)$row['end_time'] : null,
            'shift' => (string)$row['shift'],
            'price' => (float)$row['price'],
            'payment_scheme' => (string)$row['payment_scheme'],
        ],
    ];
}

/** Standard, bounded pagination metadata for profile history sections. */
function teacherStudentProfilePagination(int $total, int $requestedPage, int $perPage = 10): array
{
    $totalPages = max(1, (int)ceil($total / $perPage));
    $page = min(max(1, $requestedPage), $totalPages);
    return [
        'page' => $page,
        'per_page' => $perPage,
        'total' => $total,
        'total_pages' => $totalPages,
        'offset' => ($page - 1) * $perPage,
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

        // Enrolled Students with this Teacher.
        // P1-K: only ACTIVE enrollments are listed — "delete" in the teacher
        // students module hides the link (status = 'inactive') for this
        // teacher only and never touches the global student record.
        $stmtStudents = $db->prepare('
            SELECT s.id, s.student_code, s.name, s.phone, s.parent_phone, s.grade_level,
                   u.email AS email, se.id AS enrollment_id, se.group_id, se.class_id,
                   se.payment_status, se.enrollment_date, se.status AS enrollment_status,
                   sg.name AS group_name, ac.name AS class_name 
            FROM student_enrollments se 
            JOIN students s ON se.student_id = s.id 
            LEFT JOIN users u ON s.user_id = u.id 
            LEFT JOIN study_groups sg ON se.group_id = sg.id 
            LEFT JOIN academic_classes ac ON se.class_id = ac.id 
            WHERE se.teacher_id = :tid AND se.status = \'active\'
            ORDER BY se.id DESC
        ');
        $stmtStudents->execute(['tid' => $teacherId]);
        $students = $stmtStudents->fetchAll();

        // PRIVACY (P1-K): the full platform student directory is NO LONGER
        // dumped to the browser. Linking an existing student now goes through
        // the server-side `search_students` action, which is scoped by the
        // selected academic class and returns the minimum identifying fields.

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
            } elseif (
                // P1-K: every students-module action requires the same
                // existing 'students' staff permission.
                $action === 'create_student'
                || $action === 'enroll_existing_student'
                || $action === 'search_students'
                || $action === 'student_profile'
                || $action === 'transfer_student_group'
                || $action === 'unlink_student'
            ) {
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

        /* ------------------------------------------------------------
         * P1-L: Full teacher-scoped student profile, loaded by section.
         *
         * This is deliberately a CSRF-protected POST action. Every request —
         * including lazy-loaded pages — re-proves the active relationship via
         * teacherRequireOwnedStudentProfile() before reading any history.
         * ------------------------------------------------------------ */
        if ($action === 'student_profile') {
            $studentId = teacherProfilePositiveInt(
                $payload['student_id'] ?? null,
                'معرف الطالب غير صالح'
            );
            $sectionRaw = $payload['section'] ?? 'overview';
            if (!is_string($sectionRaw)) {
                Helper::sendJson(['success' => false, 'error' => 'قسم الملف الشخصي غير صالح'], 400);
            }
            $section = trim($sectionRaw);
            $allowedSections = ['overview', 'attendance', 'exams', 'homeworks'];
            if (!in_array($section, $allowedSections, true)) {
                Helper::sendJson(['success' => false, 'error' => 'قسم الملف الشخصي غير صالح'], 400);
            }

            $pageRaw = $payload['page'] ?? 1;
            $page = teacherProfilePositiveInt($pageRaw, 'رقم الصفحة غير صالح');

            // IDOR barrier: no global-student lookup is performed before this
            // tenant-qualified relationship check. Missing and foreign ids get
            // the exact same 404 response.
            $profile = teacherRequireOwnedStudentProfile($db, $studentId, $teacherId);
            $classId = (int)$profile['class']['id'];
            $groupId = (int)$profile['group']['id'];

            if ($section === 'overview') {
                $stmtAttendance = $db->prepare('
                    SELECT
                        COUNT(*) AS total_records,
                        SUM(CASE WHEN status = \'present\' THEN 1 ELSE 0 END) AS present_count,
                        SUM(CASE WHEN status = \'absent\' THEN 1 ELSE 0 END) AS absent_count,
                        SUM(CASE WHEN status = \'late\' THEN 1 ELSE 0 END) AS late_count
                    FROM attendance_records
                    WHERE teacher_id = :tid AND student_id = :sid
                ');
                $stmtAttendance->execute(['tid' => $teacherId, 'sid' => $studentId]);
                $attendanceRow = $stmtAttendance->fetch() ?: [];
                $totalAttendance = (int)($attendanceRow['total_records'] ?? 0);
                $presentCount = (int)($attendanceRow['present_count'] ?? 0);
                $absentCount = (int)($attendanceRow['absent_count'] ?? 0);
                $lateCount = (int)($attendanceRow['late_count'] ?? 0);
                // A late student attended the lesson, while remaining a
                // separate database status/statistic.
                $attendanceRate = $totalAttendance > 0
                    ? round((($presentCount + $lateCount) / $totalAttendance) * 100, 1)
                    : 0.0;

                // Latest result per exam prevents duplicate legacy attempts
                // from multiplying one exam in the summary. The exam itself
                // must belong to this tenant and be assigned to the student's
                // current class/group, unless this tenant already has a result
                // for the student (preserves legitimate historical results).
                $stmtExamSummary = $db->prepare('
                    SELECT
                        COUNT(*) AS total_exams,
                        SUM(CASE WHEN ser.status = \'graded\' THEN 1 ELSE 0 END) AS graded_count,
                        SUM(CASE WHEN ser.status = \'absent\' THEN 1 ELSE 0 END) AS absent_count,
                        AVG(CASE
                            WHEN ser.score IS NOT NULL
                             AND COALESCE(NULLIF(ser.max_score, 0), NULLIF(e.total_points, 0)) IS NOT NULL
                            THEN (ser.score / COALESCE(NULLIF(ser.max_score, 0), NULLIF(e.total_points, 0))) * 100
                            ELSE NULL
                        END) AS average_percentage
                    FROM exams e
                    LEFT JOIN (
                        SELECT exam_id, MAX(id) AS result_id
                        FROM student_exam_results
                        WHERE student_id = :result_sid AND teacher_id = :result_tid
                        GROUP BY exam_id
                    ) latest_result ON latest_result.exam_id = e.id
                    LEFT JOIN student_exam_results ser
                      ON ser.id = latest_result.result_id
                     AND ser.teacher_id = :ser_tid
                    WHERE e.teacher_id = :exam_tid
                      AND (
                            (e.class_id = :class_id AND (e.group_id IS NULL OR e.group_id = :group_id))
                            OR ser.id IS NOT NULL
                      )
                ');
                $stmtExamSummary->execute([
                    'result_sid' => $studentId,
                    'result_tid' => $teacherId,
                    'ser_tid' => $teacherId,
                    'exam_tid' => $teacherId,
                    'class_id' => $classId,
                    'group_id' => $groupId,
                ]);
                $examRow = $stmtExamSummary->fetch() ?: [];

                $stmtHomeworkSummary = $db->prepare('
                    SELECT
                        COUNT(*) AS total_homeworks,
                        SUM(CASE WHEN shs.status IN (\'submitted\', \'graded\') THEN 1 ELSE 0 END) AS submitted_count,
                        SUM(CASE WHEN shs.status = \'graded\' THEN 1 ELSE 0 END) AS graded_count,
                        SUM(CASE WHEN shs.status = \'missing\' THEN 1 ELSE 0 END) AS missing_count
                    FROM homeworks hw
                    LEFT JOIN (
                        SELECT homework_id, MAX(id) AS submission_id
                        FROM student_homework_submissions
                        WHERE student_id = :submission_sid AND teacher_id = :submission_tid
                        GROUP BY homework_id
                    ) latest_submission ON latest_submission.homework_id = hw.id
                    LEFT JOIN student_homework_submissions shs
                      ON shs.id = latest_submission.submission_id
                     AND shs.teacher_id = :shs_tid
                    WHERE hw.teacher_id = :homework_tid
                      AND (hw.group_id = :group_id OR shs.id IS NOT NULL)
                ');
                $stmtHomeworkSummary->execute([
                    'submission_sid' => $studentId,
                    'submission_tid' => $teacherId,
                    'shs_tid' => $teacherId,
                    'homework_tid' => $teacherId,
                    'group_id' => $groupId,
                ]);
                $homeworkRow = $stmtHomeworkSummary->fetch() ?: [];

                Helper::sendJson([
                    'success' => true,
                    'section' => 'overview',
                    'student_id' => $studentId,
                    'profile' => $profile,
                    'summaries' => [
                        'attendance' => [
                            'total_records' => $totalAttendance,
                            'present_count' => $presentCount,
                            'absent_count' => $absentCount,
                            'late_count' => $lateCount,
                            'attendance_rate' => $attendanceRate,
                        ],
                        'exams' => [
                            'total_exams' => (int)($examRow['total_exams'] ?? 0),
                            'graded_count' => (int)($examRow['graded_count'] ?? 0),
                            'absent_count' => (int)($examRow['absent_count'] ?? 0),
                            'average_percentage' => $examRow['average_percentage'] !== null
                                ? round((float)$examRow['average_percentage'], 1) : null,
                        ],
                        'homeworks' => [
                            'total_homeworks' => (int)($homeworkRow['total_homeworks'] ?? 0),
                            'submitted_count' => (int)($homeworkRow['submitted_count'] ?? 0),
                            'graded_count' => (int)($homeworkRow['graded_count'] ?? 0),
                            'missing_count' => (int)($homeworkRow['missing_count'] ?? 0),
                        ],
                    ],
                    // No payment ledger/transactions table exists in the
                    // audited schema. Group price/scheme remain in group data,
                    // but paid amount/date/month/method must not be invented.
                    'payments' => [
                        'available' => false,
                        'message' => 'البيانات المالية غير متاحة حاليًا',
                    ],
                ]);
            }

            if ($section === 'attendance') {
                $stmtCount = $db->prepare('
                    SELECT COUNT(*) AS c
                    FROM attendance_records
                    WHERE teacher_id = :tid AND student_id = :sid
                ');
                $stmtCount->execute(['tid' => $teacherId, 'sid' => $studentId]);
                $total = (int)($stmtCount->fetch()['c'] ?? 0);
                $pagination = teacherStudentProfilePagination($total, $page);

                $stmtRecords = $db->prepare('
                    SELECT id, date, status, arrival_time, departure_time,
                           late_minutes, method, notes
                    FROM attendance_records
                    WHERE teacher_id = :tid AND student_id = :sid
                    ORDER BY date DESC, id DESC
                    LIMIT :record_limit OFFSET :record_offset
                ');
                $stmtRecords->bindValue(':tid', $teacherId, PDO::PARAM_INT);
                $stmtRecords->bindValue(':sid', $studentId, PDO::PARAM_INT);
                $stmtRecords->bindValue(':record_limit', $pagination['per_page'], PDO::PARAM_INT);
                $stmtRecords->bindValue(':record_offset', $pagination['offset'], PDO::PARAM_INT);
                $stmtRecords->execute();

                $records = [];
                foreach ($stmtRecords->fetchAll() as $row) {
                    $records[] = [
                        'id' => (int)$row['id'],
                        'date' => (string)$row['date'],
                        'status' => (string)$row['status'],
                        'arrival_time' => $row['arrival_time'] !== null ? (string)$row['arrival_time'] : null,
                        'departure_time' => $row['departure_time'] !== null ? (string)$row['departure_time'] : null,
                        'late_minutes' => (int)($row['late_minutes'] ?? 0),
                        'method' => (string)$row['method'],
                        'notes' => $row['notes'] !== null ? (string)$row['notes'] : null,
                    ];
                }

                unset($pagination['offset']);
                Helper::sendJson([
                    'success' => true,
                    'section' => 'attendance',
                    'student_id' => $studentId,
                    'records' => $records,
                    'pagination' => $pagination,
                ]);
            }

            if ($section === 'exams') {
                $examFrom = '
                    FROM exams e
                    LEFT JOIN (
                        SELECT exam_id, MAX(id) AS result_id
                        FROM student_exam_results
                        WHERE student_id = :result_sid AND teacher_id = :result_tid
                        GROUP BY exam_id
                    ) latest_result ON latest_result.exam_id = e.id
                    LEFT JOIN student_exam_results ser
                      ON ser.id = latest_result.result_id
                     AND ser.teacher_id = :ser_tid
                    WHERE e.teacher_id = :exam_tid
                      AND (
                            (e.class_id = :class_id AND (e.group_id IS NULL OR e.group_id = :group_id))
                            OR ser.id IS NOT NULL
                      )
                ';
                $examParams = [
                    'result_sid' => $studentId,
                    'result_tid' => $teacherId,
                    'ser_tid' => $teacherId,
                    'exam_tid' => $teacherId,
                    'class_id' => $classId,
                    'group_id' => $groupId,
                ];
                $stmtCount = $db->prepare('SELECT COUNT(*) AS c ' . $examFrom);
                $stmtCount->execute($examParams);
                $total = (int)($stmtCount->fetch()['c'] ?? 0);
                $pagination = teacherStudentProfilePagination($total, $page);

                $stmtRecords = $db->prepare('
                    SELECT e.id, e.title, e.date, e.total_points,
                           ser.score, ser.max_score, ser.status AS result_status,
                           ser.submitted_at, ser.feedback
                    ' . $examFrom . '
                    ORDER BY e.date DESC, e.id DESC
                    LIMIT :record_limit OFFSET :record_offset
                ');
                foreach ($examParams as $name => $value) {
                    $stmtRecords->bindValue(':' . $name, $value, PDO::PARAM_INT);
                }
                $stmtRecords->bindValue(':record_limit', $pagination['per_page'], PDO::PARAM_INT);
                $stmtRecords->bindValue(':record_offset', $pagination['offset'], PDO::PARAM_INT);
                $stmtRecords->execute();

                $records = [];
                foreach ($stmtRecords->fetchAll() as $row) {
                    $maxScore = $row['max_score'] !== null
                        ? (float)$row['max_score'] : (float)$row['total_points'];
                    $score = $row['score'] !== null ? (float)$row['score'] : null;
                    $records[] = [
                        'id' => (int)$row['id'],
                        'title' => (string)$row['title'],
                        'date' => (string)$row['date'],
                        'score' => $score,
                        'max_score' => $maxScore,
                        'percentage' => $score !== null && $maxScore > 0
                            ? round(($score / $maxScore) * 100, 1) : null,
                        'status' => $row['result_status'] !== null
                            ? (string)$row['result_status'] : 'no_result',
                        'submitted_at' => $row['submitted_at'] !== null
                            ? (string)$row['submitted_at'] : null,
                        'feedback' => $row['feedback'] !== null ? (string)$row['feedback'] : null,
                    ];
                }

                unset($pagination['offset']);
                Helper::sendJson([
                    'success' => true,
                    'section' => 'exams',
                    'student_id' => $studentId,
                    'records' => $records,
                    'pagination' => $pagination,
                ]);
            }

            if ($section === 'homeworks') {
                $homeworkFrom = '
                    FROM homeworks hw
                    LEFT JOIN (
                        SELECT homework_id, MAX(id) AS submission_id
                        FROM student_homework_submissions
                        WHERE student_id = :submission_sid AND teacher_id = :submission_tid
                        GROUP BY homework_id
                    ) latest_submission ON latest_submission.homework_id = hw.id
                    LEFT JOIN student_homework_submissions shs
                      ON shs.id = latest_submission.submission_id
                     AND shs.teacher_id = :shs_tid
                    WHERE hw.teacher_id = :homework_tid
                      AND (hw.group_id = :group_id OR shs.id IS NOT NULL)
                ';
                $homeworkParams = [
                    'submission_sid' => $studentId,
                    'submission_tid' => $teacherId,
                    'shs_tid' => $teacherId,
                    'homework_tid' => $teacherId,
                    'group_id' => $groupId,
                ];
                $stmtCount = $db->prepare('SELECT COUNT(*) AS c ' . $homeworkFrom);
                $stmtCount->execute($homeworkParams);
                $total = (int)($stmtCount->fetch()['c'] ?? 0);
                $pagination = teacherStudentProfilePagination($total, $page);

                $stmtRecords = $db->prepare('
                    SELECT hw.id, hw.title, hw.description, hw.due_date,
                           hw.max_grade, hw.created_at,
                           shs.status AS submission_status, shs.submitted_at,
                           shs.grade, shs.feedback
                    ' . $homeworkFrom . '
                    ORDER BY hw.due_date DESC, hw.id DESC
                    LIMIT :record_limit OFFSET :record_offset
                ');
                foreach ($homeworkParams as $name => $value) {
                    $stmtRecords->bindValue(':' . $name, $value, PDO::PARAM_INT);
                }
                $stmtRecords->bindValue(':record_limit', $pagination['per_page'], PDO::PARAM_INT);
                $stmtRecords->bindValue(':record_offset', $pagination['offset'], PDO::PARAM_INT);
                $stmtRecords->execute();

                $records = [];
                foreach ($stmtRecords->fetchAll() as $row) {
                    $records[] = [
                        'id' => (int)$row['id'],
                        'title' => (string)$row['title'],
                        'description' => (string)$row['description'],
                        'created_at' => (string)$row['created_at'],
                        'due_date' => (string)$row['due_date'],
                        'status' => $row['submission_status'] !== null
                            ? (string)$row['submission_status'] : 'no_submission',
                        'submitted_at' => $row['submitted_at'] !== null
                            ? (string)$row['submitted_at'] : null,
                        'grade' => $row['grade'] !== null ? (float)$row['grade'] : null,
                        'max_grade' => (float)$row['max_grade'],
                        'feedback' => $row['feedback'] !== null ? (string)$row['feedback'] : null,
                    ];
                }

                unset($pagination['offset']);
                Helper::sendJson([
                    'success' => true,
                    'section' => 'homeworks',
                    'student_id' => $studentId,
                    'records' => $records,
                    'pagination' => $pagination,
                ]);
            }
        }

        /* ------------------------------------------------------------
         * P1-K: Search platform students (server-side, class-filtered).
         *
         * PRIVACY: replaces the previous full `all_platform_students` dump.
         * Returns at most 20 rows of the minimum identifying fields, and the
         * phone number is masked unless the student is already linked to the
         * SESSION tenant. No password hashes, no QR tokens, no other
         * teacher's class / group / attendance data ever leave this action.
         * ------------------------------------------------------------ */
        if ($action === 'search_students') {
            // The academic class is a HARD backend filter: it is resolved from
            // the session tenant's own classes, never trusted from the client.
            $class = teacherRequireOwnedClass($db, (int)($payload['class_id'] ?? 0), $teacherId);

            $queryRaw = $payload['query'] ?? '';
            if (!is_string($queryRaw)) {
                Helper::sendJson(['success' => false, 'error' => 'صيغة البحث غير صالحة'], 400);
            }
            $query = Helper::sanitizeString(trim($queryRaw));
            if (teacherUnicodeLength($query) < 2) {
                Helper::sendJson(['success' => false, 'error' => 'أدخل حرفين على الأقل للبحث'], 400);
            }
            if (teacherUnicodeLength($query) > 100) {
                Helper::sendJson(['success' => false, 'error' => 'نص البحث طويل جداً'], 400);
            }

            // LIKE wildcards supplied by the user are escaped so a lone "%"
            // cannot turn the search into a full-table dump.
            $like = '%' . str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $query) . '%';

            $sql = '
                SELECT s.id, s.student_code, s.name, s.phone, s.grade_level,
                       se.id AS enrollment_id, se.status AS enrollment_status,
                       se.group_id, se.class_id AS enrolled_class_id,
                       sg.name AS group_name, ac.name AS class_name
                FROM students s
                LEFT JOIN student_enrollments se
                       ON se.student_id = s.id AND se.teacher_id = :tid
                LEFT JOIN study_groups sg
                       ON sg.id = se.group_id AND sg.teacher_id = :tid2
                LEFT JOIN academic_classes ac
                       ON ac.id = se.class_id AND ac.teacher_id = :tid3
                WHERE (
                        UPPER(s.student_code) = UPPER(:exact)
                        OR s.student_code LIKE :like1 ESCAPE \'\\\\\'
                        OR s.name LIKE :like2 ESCAPE \'\\\\\'
                        OR s.phone LIKE :like3 ESCAPE \'\\\\\'
                        OR s.parent_phone LIKE :like4 ESCAPE \'\\\\\'
                      )
                  AND ' . teacherStudentClassFilterSql() . '
                ORDER BY s.id DESC
                LIMIT 20
            ';
            $stmtSearch = $db->prepare($sql);
            $stmtSearch->execute(array_merge([
                'tid' => $teacherId,
                'tid2' => $teacherId,
                'tid3' => $teacherId,
                'exact' => $query,
                'like1' => $like,
                'like2' => $like,
                'like3' => $like,
                'like4' => $like,
            ], teacherStudentClassFilterParams($class)));

            $results = [];
            foreach ($stmtSearch->fetchAll() as $row) {
                $status = isset($row['enrollment_status']) && $row['enrollment_status'] !== null
                    ? (string)$row['enrollment_status']
                    : '';
                // 'linked'   → already added to THIS teacher (active enrollment)
                // 'hidden'   → previously removed by THIS teacher (inactive)
                // 'unlinked' → exists on the platform, not linked to this teacher
                $linkState = $status === 'active' ? 'linked' : ($status === 'inactive' ? 'hidden' : 'unlinked');
                $isOurs = $linkState !== 'unlinked';
                $phone = (string)($row['phone'] ?? '');
                $results[] = [
                    'id' => (int)$row['id'],
                    'student_code' => (string)$row['student_code'],
                    'name' => (string)$row['name'],
                    // PRIVACY: partial phone for students that are not ours.
                    'phone' => $isOurs ? $phone : teacherMaskStudentPhone($phone),
                    'phone_masked' => !$isOurs,
                    'grade_level' => (string)($row['grade_level'] ?? ''),
                    'link_state' => $linkState,
                    // Only the SESSION tenant's own group/class is ever exposed.
                    'group_id' => $isOurs && $row['group_id'] !== null ? (int)$row['group_id'] : null,
                    'group_name' => $isOurs && $row['group_name'] !== null ? (string)$row['group_name'] : null,
                    'class_id' => $isOurs && $row['enrolled_class_id'] !== null ? (int)$row['enrolled_class_id'] : null,
                    'class_name' => $isOurs && $row['class_name'] !== null ? (string)$row['class_name'] : null,
                ];
            }

            Helper::sendJson([
                'success' => true,
                'class_id' => $class['id'],
                'class_name' => $class['name'],
                'count' => count($results),
                'results' => $results,
            ]);
        }

        /* ------------------------------------------------------------
         * P1-K: Create a NEW global student and enroll them with this
         * teacher, in ONE transaction (users + students + enrollment).
         * ------------------------------------------------------------ */
        if ($action === 'create_student') {
            $student = teacherValidateStudentPayload($payload);

            // Tenant-owned class + group, and the group MUST belong to the
            // selected academic class (hard backend filter).
            $class = teacherRequireOwnedClass($db, (int)($payload['class_id'] ?? 0), $teacherId);
            $group = teacherRequireOwnedGroup($db, (int)($payload['group_id'] ?? 0), $teacherId);
            if ($group['class_id'] !== $class['id']) {
                Helper::sendJson(['success' => false, 'error' => 'المجموعة المختارة لا تنتمي إلى هذا الصف الدراسي'], 400);
            }

            // Duplicate protection BEFORE the write (the UNIQUE indexes below
            // remain the real guarantee against a concurrent request).
            if ($student['student_code'] !== '') {
                $stmtCode = $db->prepare('SELECT id FROM students WHERE student_code = :code LIMIT 1');
                $stmtCode->execute(['code' => $student['student_code']]);
                if ($stmtCode->fetch() !== false) {
                    Helper::sendJson(['success' => false, 'message' => 'كود الطالب مستخدم بالفعل لطالب آخر'], 409);
                }
            }
            if ($student['email'] !== '') {
                $stmtEmail = $db->prepare('SELECT id FROM users WHERE email = :email LIMIT 1');
                $stmtEmail->execute(['email' => $student['email']]);
                if ($stmtEmail->fetch() !== false) {
                    Helper::sendJson([
                        'success' => false,
                        'message' => 'البريد الإلكتروني مستخدم بالفعل — ابحث عن الطالب وأضفه إلى مجموعتك بدلاً من إنشاء حساب جديد'
                    ], 409);
                }
            }

            $studentCode = $student['student_code'] !== ''
                ? $student['student_code']
                : teacherGenerateStudentCode($db);
            // users.email is NOT NULL UNIQUE. When the teacher leaves the email
            // empty (it must never be mandatory) a placeholder username is
            // derived from the student code instead of a random timestamp.
            $loginEmail = $student['email'] !== ''
                ? $student['email']
                : strtolower($studentCode) . '@student.local';
            $gradeLevel = $class['name'];
            $today = date('Y-m-d');

            $db->beginTransaction();
            try {
                // Student account in the SHARED users table (role = student).
                $stmtUser = $db->prepare('
                    INSERT INTO users (name, email, phone, password_hash, role)
                    VALUES (:name, :email, :phone, :phash, \'student\')
                ');
                $stmtUser->execute([
                    'name' => $student['name'],
                    'email' => $loginEmail,
                    'phone' => $student['phone'],
                    // P1-K: documented default password for teacher-created
                    // student accounts (never reused for existing students).
                    'phash' => password_hash(teacherDefaultStudentPassword(), PASSWORD_DEFAULT)
                ]);
                $userId = (int)$db->lastInsertId();

                $stmtSt = $db->prepare('
                    INSERT INTO students (user_id, student_code, name, gender, date_of_birth, phone,
                                          parent_phone, address, notes, grade_level, qr_code_token)
                    VALUES (:uid, :code, :name, :gender, :dob, :phone,
                            :pphone, :address, :notes, :grade, :qr)
                ');
                $stmtSt->execute([
                    'uid' => $userId,
                    'code' => $studentCode,
                    'name' => $student['name'],
                    'gender' => $student['gender'],
                    'dob' => $student['date_of_birth'],
                    'phone' => $student['phone'],
                    'pphone' => $student['parent_phone'],
                    'address' => $student['address'],
                    'notes' => $student['notes'],
                    'grade' => $gradeLevel,
                    'qr' => 'QR-' . $studentCode . '-TOKEN-' . time()
                ]);
                $studentId = (int)$db->lastInsertId();

                $stmtEnr = $db->prepare('
                    INSERT INTO student_enrollments (teacher_id, student_id, class_id, group_id, enrollment_date, status, payment_status)
                    VALUES (:tid, :sid, :cid, :gid, :edate, \'active\', \'paid\')
                ');
                $stmtEnr->execute([
                    'tid' => $teacherId,
                    'sid' => $studentId,
                    'cid' => $class['id'],
                    'gid' => $group['id'],
                    'edate' => $today
                ]);

                $db->commit();
            } catch (Throwable $ex) {
                if ($db->inTransaction()) {
                    $db->rollBack();
                }
                // Concurrency: a parallel request won the unique index race.
                if ($ex instanceof PDOException && in_array((string)$ex->getCode(), ['23000', '23505'], true)) {
                    Helper::sendJson(['success' => false, 'message' => 'الطالب مسجل بالفعل — أعد البحث ثم أضفه إلى مجموعتك'], 409);
                }
                throw $ex;
            }

            Helper::sendJson([
                'success' => true,
                'message' => 'تم إنشاء حساب الطالب وربطه بالمجموعة بنجاح',
                'student_id' => $studentId,
                'student_code' => $studentCode,
                'username' => $loginEmail,
                'default_password' => teacherDefaultStudentPassword(),
                'group_name' => $group['name'],
                'class_name' => $class['name']
            ]);
        }

        /* ------------------------------------------------------------
         * P1-K: Link an EXISTING platform student to one of this teacher's
         * groups. Explicit opt-in step of the search-first flow.
         *
         * The student record, its credentials and its parent are left
         * untouched: only an enrollment row is created (or an enrollment
         * previously hidden by THIS teacher is reactivated).
         * ------------------------------------------------------------ */
        if ($action === 'enroll_existing_student') {
            $studentId = (int)($payload['student_id'] ?? 0);
            if ($studentId <= 0) {
                Helper::sendJson(['success' => false, 'error' => 'الطالب مطلوب'], 400);
            }

            $class = teacherRequireOwnedClass($db, (int)($payload['class_id'] ?? 0), $teacherId);
            $group = teacherRequireOwnedGroup($db, (int)($payload['group_id'] ?? 0), $teacherId);
            if ($group['class_id'] !== $class['id']) {
                Helper::sendJson(['success' => false, 'error' => 'المجموعة المختارة لا تنتمي إلى هذا الصف الدراسي'], 400);
            }

            $stmtStu = $db->prepare('SELECT id, name FROM students WHERE id = :sid LIMIT 1');
            $stmtStu->execute(['sid' => $studentId]);
            $studentRow = $stmtStu->fetch();
            if ($studentRow === false) {
                Helper::sendNotFound('الطالب غير موجود');
            }

            // The academic class filter is re-applied on the server: a client
            // may not enroll a student who does not belong to the class.
            $stmtMatch = $db->prepare('SELECT s.id FROM students s WHERE s.id = :sid AND ' . teacherStudentClassFilterSql() . ' LIMIT 1');
            $stmtMatch->execute(array_merge(['sid' => $studentId], teacherStudentClassFilterParams($class)));
            if ($stmtMatch->fetch() === false) {
                Helper::sendJson(['success' => false, 'message' => 'الطالب لا ينتمي إلى الصف الدراسي المختار'], 400);
            }

            $db->beginTransaction();
            try {
                $stmtExisting = $db->prepare('
                    SELECT id, status, group_id FROM student_enrollments
                    WHERE teacher_id = :tid AND student_id = :sid
                    LIMIT 1
                ');
                $stmtExisting->execute(['tid' => $teacherId, 'sid' => $studentId]);
                $existing = $stmtExisting->fetch();

                if ($existing !== false && (string)$existing['status'] === 'active') {
                    $db->rollBack();
                    Helper::sendJson([
                        'success' => false,
                        'message' => 'الطالب مضاف بالفعل إلى مجموعاتك',
                        'already_linked' => true,
                        'group_id' => (int)$existing['group_id']
                    ], 409);
                }

                if ($existing !== false) {
                    // Previously hidden by this teacher: REACTIVATE the same
                    // row — never a second enrollment for the same pair.
                    $stmtReactivate = $db->prepare('
                        UPDATE student_enrollments
                        SET class_id = :cid, group_id = :gid, status = \'active\', enrollment_date = :edate
                        WHERE id = :eid AND teacher_id = :tid
                    ');
                    $stmtReactivate->execute([
                        'cid' => $class['id'],
                        'gid' => $group['id'],
                        'edate' => date('Y-m-d'),
                        'eid' => (int)$existing['id'],
                        'tid' => $teacherId
                    ]);
                } else {
                    $stmtInsert = $db->prepare('
                        INSERT INTO student_enrollments (teacher_id, student_id, class_id, group_id, enrollment_date, status, payment_status)
                        VALUES (:tid, :sid, :cid, :gid, :edate, \'active\', \'paid\')
                    ');
                    $stmtInsert->execute([
                        'tid' => $teacherId,
                        'sid' => $studentId,
                        'cid' => $class['id'],
                        'gid' => $group['id'],
                        'edate' => date('Y-m-d')
                    ]);
                }

                $db->commit();
            } catch (Throwable $ex) {
                if ($db->inTransaction()) {
                    $db->rollBack();
                }
                if ($ex instanceof PDOException && in_array((string)$ex->getCode(), ['23000', '23505'], true)) {
                    Helper::sendJson(['success' => false, 'message' => 'الطالب مضاف بالفعل إلى مجموعاتك'], 409);
                }
                throw $ex;
            }

            Helper::sendJson([
                'success' => true,
                'message' => 'تم إضافة الطالب إلى المجموعة بنجاح',
                'student_id' => $studentId,
                'group_name' => $group['name'],
                'class_name' => $class['name']
            ]);
        }

        /* ------------------------------------------------------------
         * P1-K: Move a student between two groups OF THE SAME TEACHER.
         * Always an UPDATE of the single existing enrollment — a transfer
         * can never produce a second enrollment row.
         * ------------------------------------------------------------ */
        if ($action === 'transfer_student_group') {
            $studentId = (int)($payload['student_id'] ?? 0);
            if ($studentId <= 0) {
                Helper::sendJson(['success' => false, 'error' => 'الطالب مطلوب'], 400);
            }
            $group = teacherRequireOwnedGroup($db, (int)($payload['group_id'] ?? 0), $teacherId);

            $db->beginTransaction();
            try {
                $stmtEnr = $db->prepare('
                    SELECT id, class_id, group_id FROM student_enrollments
                    WHERE teacher_id = :tid AND student_id = :sid AND status = \'active\'
                    LIMIT 1
                ');
                $stmtEnr->execute(['tid' => $teacherId, 'sid' => $studentId]);
                $enrollment = $stmtEnr->fetch();
                if ($enrollment === false) {
                    $db->rollBack();
                    Helper::sendNotFound('الطالب غير مرتبط بمجموعاتك');
                }

                // Same academic class only (both groups belong to this teacher
                // and the class was already verified as tenant-owned).
                if ((int)$enrollment['class_id'] !== $group['class_id']) {
                    $db->rollBack();
                    Helper::sendJson([
                        'success' => false,
                        'error' => 'لا يمكن النقل إلى مجموعة في صف دراسي مختلف'
                    ], 400);
                }

                if ((int)$enrollment['group_id'] === $group['id']) {
                    $db->rollBack();
                    Helper::sendJson(['success' => false, 'message' => 'الطالب موجود بالفعل في هذه المجموعة'], 409);
                }

                $stmtMove = $db->prepare('
                    UPDATE student_enrollments
                    SET group_id = :gid
                    WHERE id = :eid AND teacher_id = :tid
                ');
                $stmtMove->execute([
                    'gid' => $group['id'],
                    'eid' => (int)$enrollment['id'],
                    'tid' => $teacherId
                ]);

                $db->commit();
            } catch (Throwable $ex) {
                if ($db->inTransaction()) {
                    $db->rollBack();
                }
                throw $ex;
            }

            Helper::sendJson([
                'success' => true,
                'message' => 'تم نقل الطالب إلى المجموعة الجديدة بنجاح',
                'student_id' => $studentId,
                'group_id' => $group['id'],
                'group_name' => $group['name']
            ]);
        }

        /* ------------------------------------------------------------
         * P1-K: "Delete" a student FROM THIS TEACHER'S LIST ONLY.
         *
         * This hides the student for the session tenant by setting the
         * existing enrollment status to 'inactive'. The global student
         * record, the student's account and every other teacher's link are
         * left completely untouched — there is NO DELETE FROM students
         * anywhere in the teacher module.
         * ------------------------------------------------------------ */
        if ($action === 'unlink_student') {
            $studentId = (int)($payload['student_id'] ?? 0);
            if ($studentId <= 0) {
                Helper::sendJson(['success' => false, 'error' => 'الطالب مطلوب'], 400);
            }

            $stmtEnr = $db->prepare('
                SELECT id FROM student_enrollments
                WHERE teacher_id = :tid AND student_id = :sid AND status = \'active\'
                LIMIT 1
            ');
            $stmtEnr->execute(['tid' => $teacherId, 'sid' => $studentId]);
            $enrollment = $stmtEnr->fetch();
            if ($enrollment === false) {
                Helper::sendNotFound('الطالب غير مرتبط بمجموعاتك');
            }

            $stmtHide = $db->prepare('
                UPDATE student_enrollments
                SET status = \'inactive\'
                WHERE id = :eid AND teacher_id = :tid
            ');
            $stmtHide->execute(['eid' => (int)$enrollment['id'], 'tid' => $teacherId]);

            Helper::sendJson([
                'success' => true,
                'message' => 'تم إزالة الطالب من قائمتك (لم يتم حذف حساب الطالب من المنصة)',
                'student_id' => $studentId
            ]);
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
