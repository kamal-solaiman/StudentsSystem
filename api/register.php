<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/helper.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../config/auth.php';

Helper::handleCorsOptions();

/** Unicode-aware length without requiring mbstring on shared hosting. */
function registrationLength(string $value): int
{
    if (function_exists('mb_strlen')) {
        return mb_strlen($value, 'UTF-8');
    }
    $count = preg_match_all('/./us', $value, $matches);
    return $count === false ? strlen($value) : $count;
}

function registrationString(array $input, string $key, int $max, bool $required = false): string
{
    $raw = $input[$key] ?? null;
    if ($raw !== null && !is_string($raw)) {
        Helper::sendJson(['success' => false, 'message' => 'قيمة غير صالحة في نموذج التسجيل'], 422);
    }
    $value = trim((string)$raw);
    if ($required && $value === '') {
        Helper::sendJson(['success' => false, 'message' => 'يرجى استكمال جميع البيانات المطلوبة'], 422);
    }
    if (registrationLength($value) > $max) {
        Helper::sendJson(['success' => false, 'message' => 'إحدى القيم المدخلة أطول من الحد المسموح'], 422);
    }
    return Helper::sanitizeString($value);
}

function registrationPhone(array $input, string $key, bool $required, string $label): string
{
    $phone = registrationString($input, $key, 30, $required);
    if ($phone === '') {
        return '';
    }
    // Canonical ASCII representation makes public-registration uniqueness
    // independent of spaces, dashes, parentheses, and Arabic digit glyphs.
    $phone = strtr($phone, [
        '٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4',
        '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9',
    ]);
    $phone = preg_replace('/[\s()\-]/u', '', $phone) ?? '';
    if (preg_match('/^\+?[0-9]{6,20}$/', $phone) !== 1) {
        Helper::sendJson(['success' => false, 'message' => $label . ' غير صالح'], 422);
    }
    return $phone;
}

function registrationConflict(): never
{
    Helper::sendJson([
        'success' => false,
        'message' => 'بيانات التسجيل مستخدمة بالفعل أو تتعارض مع حساب موجود. استخدم تسجيل الدخول أو تواصل مع إدارة المنصة لاستعادة الحساب.'
    ], 409);
}

function registrationDate(array $input, string $key): ?string
{
    $value = registrationString($input, $key, 10);
    if ($value === '') {
        return null;
    }
    $date = DateTime::createFromFormat('Y-m-d', $value);
    if ($date === false || $date->format('Y-m-d') !== $value || $value < '1900-01-01' || $value > date('Y-m-d')) {
        Helper::sendJson(['success' => false, 'message' => 'تاريخ الميلاد غير صالح'], 422);
    }
    return $value;
}

/** Public registration is limited per IP using the existing database limiter store. */
function registrationConsumeRateLimit(PDO $db): void
{
    $key = 'register:' . hash('sha256', (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
    $stmt = $db->prepare('SELECT attempts, first_attempt_at FROM login_attempts WHERE identifier = :identifier LIMIT 1');
    $stmt->execute(['identifier' => $key]);
    $row = $stmt->fetch();
    if ($row !== false) {
        $started = strtotime((string)$row['first_attempt_at']);
        if ($started !== false && (time() - $started) < 3600 && (int)$row['attempts'] >= 5) {
            Helper::sendJson(['success' => false, 'message' => 'تم تجاوز عدد محاولات التسجيل المسموح. يرجى المحاولة لاحقاً.'], 429);
        }
    }

    $stmt = $db->prepare("\n        INSERT INTO login_attempts (identifier, ip_hash, attempts, first_attempt_at, last_attempt_at)\n        VALUES (:identifier, :ip_hash, 1, NOW(), NOW())\n        ON DUPLICATE KEY UPDATE\n          attempts = IF(last_attempt_at <= NOW() - INTERVAL 1 HOUR, 1, attempts + 1),\n          first_attempt_at = IF(last_attempt_at <= NOW() - INTERVAL 1 HOUR, NOW(), first_attempt_at),\n          last_attempt_at = NOW()\n    ");
    $stmt->execute(['identifier' => $key, 'ip_hash' => hash('sha256', $key)]);
}

$method = (string)($_SERVER['REQUEST_METHOD'] ?? 'GET');

try {
    $db = DatabaseConnection::fromConfigFile()->connect();

    // A same-origin GET bootstraps the public form's session CSRF token and
    // returns only the controlled, active subject catalog.
    if ($method === 'GET') {
        $stmt = $db->query("SELECT id, name FROM subjects WHERE status = 'active' ORDER BY name ASC");
        $subjects = array_map(static fn(array $row): array => [
            'id' => (int)$row['id'],
            'name' => (string)$row['name'],
        ], $stmt->fetchAll());

        Helper::sendJson([
            'success' => true,
            'subjects' => $subjects,
            'csrf_token' => AuthManager::getCsrfToken(),
        ]);
    }

    if ($method !== 'POST') {
        Helper::sendJson(['success' => false, 'message' => 'طريقة الطلب غير مسموح بها'], 405);
    }

    $input = Helper::getJsonInput();
    $csrfRaw = $input['csrf_token'] ?? ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? null);
    $csrfToken = is_string($csrfRaw) ? $csrfRaw : null;
    if (!AuthManager::validateCsrfToken($csrfToken)) {
        Helper::sendForbidden('رمز الحماية غير صالح. أعد تحميل صفحة التسجيل وحاول مرة أخرى.');
    }

    registrationConsumeRateLimit($db);

    $accountType = registrationString($input, 'account_type', 20, true);
    if (!in_array($accountType, ['student', 'teacher', 'parent'], true)) {
        Helper::sendJson(['success' => false, 'message' => 'نوع الحساب غير صالح'], 422);
    }

    $name = registrationString($input, 'name', 150, true);
    $username = strtolower(registrationString($input, 'username', 100, true));
    if (preg_match('/^[a-z0-9][a-z0-9._-]{2,99}$/', $username) !== 1) {
        Helper::sendJson(['success' => false, 'message' => 'اسم المستخدم يجب أن يتكون من 3 أحرف على الأقل ويحتوي على حروف إنجليزية أو أرقام فقط'], 422);
    }

    $email = strtolower(registrationString($input, 'email', 150, true));
    if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
        Helper::sendJson(['success' => false, 'message' => 'البريد الإلكتروني غير صالح'], 422);
    }

    $phone = registrationPhone($input, 'phone', true, 'رقم الموبايل');

    $password = isset($input['password']) && is_string($input['password']) ? $input['password'] : '';
    $passwordConfirmation = isset($input['password_confirmation']) && is_string($input['password_confirmation'])
        ? $input['password_confirmation'] : '';
    if ($password !== $passwordConfirmation) {
        Helper::sendJson(['success' => false, 'message' => 'كلمتا المرور غير متطابقتين'], 422);
    }
    if (strlen($password) > 200 || registrationLength($password) < 8 || preg_match('/\p{L}/u', $password) !== 1 || preg_match('/\d/', $password) !== 1) {
        Helper::sendJson(['success' => false, 'message' => 'كلمة المرور يجب أن تكون 8 أحرف على الأقل وتحتوي على حرف ورقم'], 422);
    }

    $address = registrationString($input, 'address', 255);
    $dateOfBirth = registrationDate($input, 'date_of_birth');
    $gender = registrationString($input, 'gender', 10);
    if ($gender !== '' && !in_array($gender, ['male', 'female'], true)) {
        Helper::sendJson(['success' => false, 'message' => 'النوع غير صالح'], 422);
    }
    $genderValue = $gender === '' ? null : $gender;

    // One public response for every identity conflict prevents email, username,
    // phone, and cross-identifier enumeration. The UNIQUE keys remain the
    // authoritative race-condition protection.
    $stmt = $db->prepare("\n        SELECT id FROM users\n        WHERE email = :email OR username = :username\n           OR email = :username_as_email OR username = :email_as_username\n           OR registration_phone_key = :phone_key\n           OR REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, '٠', '0'), '١', '1'), '٢', '2'), '٣', '3'), '٤', '4'), '٥', '5'), '٦', '6'), '٧', '7'), '٨', '8'), '٩', '9'), ' ', ''), '-', ''), '(', ''), ')', '') = :phone\n        LIMIT 1\n    ");
    $stmt->execute([
        'email' => $email,
        'username' => $username,
        'username_as_email' => $username,
        'email_as_username' => $email,
        'phone_key' => $phone,
        'phone' => $phone,
    ]);
    if ($stmt->fetch() !== false) {
        registrationConflict();
    }

    $subject = null;
    $bio = null;
    if ($accountType === 'teacher') {
        $subjectId = filter_var($input['subject_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($subjectId === false) {
            Helper::sendJson(['success' => false, 'message' => 'المادة الدراسية مطلوبة'], 422);
        }
        $stmt = $db->prepare("SELECT id, name FROM subjects WHERE id = :id AND status = 'active' LIMIT 1");
        $stmt->execute(['id' => $subjectId]);
        $subject = $stmt->fetch();
        if ($subject === false) {
            Helper::sendJson(['success' => false, 'message' => 'المادة الدراسية المختارة غير متاحة للتسجيل'], 422);
        }
        $bio = registrationString($input, 'bio', 2000);
    }

    $parentPhone = '';
    if ($accountType === 'student') {
        $parentPhone = registrationPhone($input, 'parent_phone', false, 'رقم هاتف ولي الأمر');

        // A supplied code means "recover/claim", never "create". Return the
        // same conflict whether the code exists or not, so this public endpoint
        // cannot be used as a student-code oracle. Claiming is intentionally
        // deferred to a future verified recovery flow.
        $knownStudentCode = strtoupper(registrationString($input, 'student_code', 50));
        if ($knownStudentCode !== '') {
            if (preg_match('/^[A-Z0-9][A-Z0-9_-]{2,49}$/', $knownStudentCode) !== 1) {
                Helper::sendJson(['success' => false, 'message' => 'كود الطالب غير صالح'], 422);
            }
            registrationConflict();
        }

        // Deliberately do not merge or reject by name/date-of-birth: two real
        // students may share those values. Race-safe account identity is based
        // on database-unique email, username and normalized public phone key.
    }

    $status = $accountType === 'teacher' ? 'pending' : 'active';
    $db->beginTransaction();
    try {
        if ($accountType === 'teacher') {
            // Revalidate and lock the catalog row inside the creation
            // transaction so it cannot be deactivated between validation and
            // teacher-profile insertion.
            $stmtSubjectLock = $db->prepare("SELECT id, name FROM subjects WHERE id = :id AND status = 'active' LIMIT 1 FOR UPDATE");
            $stmtSubjectLock->execute(['id' => (int)$subject['id']]);
            $subject = $stmtSubjectLock->fetch();
            if ($subject === false) {
                registrationConflict();
            }
        }

        $stmt = $db->prepare("\n            INSERT INTO users (name, username, email, phone, registration_phone_key, password_hash, role, account_status, date_of_birth, gender, address)\n            VALUES (:name, :username, :email, :phone, :phone_key, :password_hash, :role, :status, :date_of_birth, :gender, :address)\n        ");
        $stmt->execute([
            'name' => $name,
            'username' => $username,
            'email' => $email,
            'phone' => $phone,
            'phone_key' => $phone,
            'password_hash' => password_hash($password, PASSWORD_DEFAULT),
            'role' => $accountType,
            'status' => $status,
            'date_of_birth' => $dateOfBirth,
            'gender' => $genderValue,
            'address' => $address === '' ? null : $address,
        ]);
        $userId = (int)$db->lastInsertId();

        if ($accountType === 'teacher') {
            $stmt = $db->prepare("\n                INSERT INTO teachers (user_id, name, center_name, phone, address, subject, subject_id, bio)\n                VALUES (:user_id, :name, :center_name, :phone, :address, :subject, :subject_id, :bio)\n            ");
            $stmt->execute([
                'user_id' => $userId,
                'name' => $name,
                'center_name' => 'مساحة ' . $name,
                'phone' => $phone,
                'address' => $address,
                'subject' => (string)$subject['name'],
                'subject_id' => (int)$subject['id'],
                'bio' => $bio === '' ? null : $bio,
            ]);
        } elseif ($accountType === 'student') {
            $studentCode = 'STU-' . strtoupper(bin2hex(random_bytes(6)));
            $stmt = $db->prepare("\n                INSERT INTO students (user_id, student_code, name, gender, date_of_birth, phone, parent_phone, address, grade_level, qr_code_token)\n                VALUES (:user_id, :student_code, :name, :gender, :date_of_birth, :phone, :parent_phone, :address, '', :qr_token)\n            ");
            $stmt->execute([
                'user_id' => $userId,
                'student_code' => $studentCode,
                'name' => $name,
                'gender' => $genderValue,
                'date_of_birth' => $dateOfBirth,
                'phone' => $phone,
                'parent_phone' => $parentPhone,
                'address' => $address === '' ? null : $address,
                'qr_token' => 'QR-' . bin2hex(random_bytes(24)),
            ]);
        }
        // Parent profiles are intentionally represented by the existing unified
        // users row; students.parent_user_id remains the one-parent relationship.

        $db->commit();
    } catch (Throwable $exception) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        if ($exception instanceof PDOException && in_array((string)$exception->getCode(), ['23000', '23505'], true)) {
            Helper::sendJson(['success' => false, 'message' => 'تعذر إنشاء الحساب لأن بعض بياناته مستخدمة بالفعل'], 409);
        }
        throw $exception;
    }

    $message = match ($accountType) {
        'teacher' => 'تم إنشاء حسابك بنجاح، ولكن الحساب يحتاج إلى موافقة الإدارة قبل أن تتمكن من الدخول إلى لوحة المدرس.',
        'parent' => 'تم إنشاء حساب ولي الأمر بنجاح.',
        default => 'تم إنشاء حساب الطالب بنجاح.',
    };

    Helper::sendJson(['success' => true, 'message' => $message], 201);
} catch (Throwable $exception) {
    error_log('register.php failure: ' . get_class($exception));
    Helper::sendJson(['success' => false, 'message' => 'حدث خطأ غير متوقع أثناء إنشاء الحساب'], 500);
}
