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
$email = Helper::sanitizeString($input['email'] ?? null);
$password = (string)($input['password'] ?? '');

// Validate input
if ($email === '' || $password === '') {
    Helper::sendJson(['success' => false, 'message' => 'Email and password are required'], 422);
}

// SECURITY (P1-D): Database-backed rate limiting keyed by identifier + IP hash.
// Counters survive cookie deletion, private windows, new sessions and other
// devices from the same source IP. Only FAILED attempts are recorded.
$clientIp = (string)($_SERVER['REMOTE_ADDR'] ?? '');
if (!AuthManager::checkRateLimit($email, $clientIp)) {
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
        WHERE u.email = :email 
        LIMIT 1
    ');
    $stmt->execute(['email' => $email]);
    $user = $stmt->fetch();

    if ($user === false) {
        // SECURITY (P1-D): record failed attempt (message does not reveal email existence)
        AuthManager::recordFailedLoginAttempt($email, $clientIp);
        Helper::sendJson(['success' => false, 'message' => 'Invalid credentials'], 401);
    }

    // SECURITY FIX: For staff users, use staff_teacher_id from teacher_staff table
    // For teacher users, use teacher_id from teachers table
    if ($user['role'] === 'staff' && isset($user['staff_teacher_id'])) {
        $user['teacher_id'] = $user['staff_teacher_id'];
    }
    $passwordValid = password_verify($password, (string)$user['password_hash']);

    if (!$passwordValid) {
        // SECURITY (P1-D): record failed attempt (message does not reveal email existence)
        AuthManager::recordFailedLoginAttempt($email, $clientIp);
        Helper::sendJson(['success' => false, 'message' => 'Invalid credentials'], 401);
    }

    // Successful login - AuthManager will handle session regeneration and CSRF token
    AuthManager::loginUser($user);

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
    // Don't expose internal errors in production
    Helper::sendJson([
        'success' => false,
        'message' => 'A system error occurred during login'
    ], 500);
}
