<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/helper.php';
require_once __DIR__ . '/../config/auth.php';

Helper::handleCorsOptions();

// Logout changes server-side session state and must only be submitted as POST.
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    Helper::sendJson(['success' => false, 'message' => 'Method not allowed, use POST'], 405);
}

// Require a live authenticated session before it can be destroyed.
AuthManager::requireAuth();

// Follow the existing JSON-body / X-CSRF-Token validation pattern used by state-changing APIs.
$input = Helper::getJsonInput();
$csrfToken = $input['csrf_token'] ?? null;
if ($csrfToken === null || $csrfToken === '') {
    $csrfToken = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? null;
}

if (!AuthManager::validateCsrfToken($csrfToken)) {
    Helper::sendForbidden('Invalid CSRF token');
}

// AuthManager clears $_SESSION, expires the session cookie, and destroys the PHP session.
AuthManager::logout();

Helper::sendJson([
    'success' => true,
    'message' => 'Logged out successfully'
]);
