<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/helper.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../config/auth.php';

Helper::handleCorsOptions();

// Only POST method allowed for login
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Helper::sendJson(['success' => false, 'message' => 'Method not allowed, use POST'], 405);
}

$input = Helper::getJsonInput();
// Existing clients still send `email`; the value may now be either the account
// email or the unique username introduced for public registration.
$identifier = strtolower(Helper::sanitizeString($input['email'] ?? null));
$password = (string)($input['password'] ?? '');

// Validate input
if ($identifier === '' || $password === '') {
    Helper::sendJson(['success' => false, 'message' => 'Email and password are required'], 422);
}

// SECURITY (P1-D): Database-backed rate limiting keyed by identifier + IP hash.
// Counters survive cookie deletion, private windows, new sessions and other
// devices from the same source IP. Only FAILED attempts are recorded.
$clientIp = (string)($_SERVER['REMOTE_ADDR'] ?? '');
if (!AuthManager::checkRateLimit($identifier, $clientIp)) {
    $retryAfter = ceil(AuthManager::getRateLimitWindow() / 60); // minutes
    Helper::sendJson([
        'success' => false,
        'message' => "Too many login attempts. Please try again in $retryAfter minutes."
    ], 429);
}

try {
    $db = DatabaseConnection::fromConfigFile()->connect();

    // Find user by email
    $stmt = $db->prepare('
        SELECT u.*, t.id AS teacher_id, ts.teacher_id AS staff_teacher_id 
        FROM users u 
        LEFT JOIN teachers t ON u.id = t.user_id 
        LEFT JOIN teacher_staff ts ON u.id = ts.user_id 
        WHERE (u.email = :identifier OR u.username = :identifier)
        LIMIT 1
    ');
    $stmt->execute(['identifier' => $identifier]);
    $user = $stmt->fetch();

    if ($user === false) {
        // Perform a real password verification against a fixed dummy hash so a
        // missing identifier follows the same expensive path and external
        // response as an existing account with a wrong password.
        password_verify($password, '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi');
        AuthManager::recordFailedLoginAttempt($identifier, $clientIp);
        Helper::sendJson(['success' => false, 'message' => 'بيانات تسجيل الدخول غير صحيحة'], 401);
    }

    // SECURITY FIX: For staff users, use staff_teacher_id from teacher_staff table
    // For teacher users, use teacher_id from teachers table
    if ($user['role'] === 'staff' && isset($user['staff_teacher_id'])) {
        $user['teacher_id'] = $user['staff_teacher_id'];
    }
    $passwordValid = password_verify($password, (string)$user['password_hash']);

    if (!$passwordValid) {
        // SECURITY (P1-D): record failed attempt (message does not reveal email existence)
        AuthManager::recordFailedLoginAttempt($identifier, $clientIp);
        Helper::sendJson(['success' => false, 'message' => 'بيانات تسجيل الدخول غير صحيحة'], 401);
    }

    // Status is server-controlled. A pending/rejected teacher never receives a
    // session or tenant_teacher_id, so normal teacher APIs remain unreachable.
    if (($user['account_status'] ?? 'active') === 'pending') {
        Helper::sendJson([
            'success' => false,
            'message' => 'حساب المدرس في انتظار موافقة الإدارة ولا يمكن تسجيل الدخول حالياً.'
        ], 403);
    }
    if (($user['account_status'] ?? 'active') === 'rejected') {
        Helper::sendJson([
            'success' => false,
            'message' => 'تعذر تسجيل الدخول إلى هذا الحساب. يرجى التواصل مع إدارة المنصة.'
        ], 403);
    }

    // Successful login - AuthManager will handle session regeneration and CSRF token
    AuthManager::loginUser($user);
    // loginUser clears the canonical email counter; a username login may have
    // a distinct limiter key, so clear the identifier used by this request too.
    AuthManager::clearRateLimit($identifier);

    // Get the CSRF token for the frontend
    $csrfToken = AuthManager::getCsrfToken();

    Helper::sendJson([
        'success' => true,
        'message' => 'Login successful',
        'user' => [
            'id' => (int)$user['id'],
            'name' => (string)$user['name'],
            'email' => (string)$user['email'],
            'role' => (string)$user['role'],
            'phone' => (string)$user['phone'],
            'teacher_id' => isset($user['teacher_id']) ? (int)$user['teacher_id'] : null,
            'avatar' => (string)($user['avatar'] ?? '')
        ],
        'csrf_token' => $csrfToken
    ]);

} catch (Throwable $exception) {
    // Production-safe diagnostic: retain exception details only in the server log.
    // Never return SQL, paths, or stack traces to the browser.
    error_log('login.php authentication failure: ' . get_class($exception));
    Helper::sendJson([
        'success' => false,
        'message' => 'A system error occurred during login'
    ], 500);
}
