<?php
declare(strict_types=1);

require_once __DIR__ . '/helper.php';

/**
 * PHP 8.3 Native Authentication & Role Based Access Control (RBAC)
 */
final class AuthManager
{
    private const SESSION_NAME = 'UNIFIED_EDU_SESSION';

    public static function startSession(): void
    {
        if (session_status() === PHP_SESSION_NONE) {
            session_name(self::SESSION_NAME);
            session_set_cookie_params([
                'lifetime' => 86400 * 7,
                'path' => '/',
                'secure' => isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on',
                'httponly' => true,
                'samesite' => 'Lax',
            ]);
            session_start();
        }
    }

    public static function loginUser(array $userRow): void
    {
        self::startSession();
        $_SESSION['user_id'] = (int)$userRow['id'];
        $_SESSION['name'] = (string)$userRow['name'];
        $_SESSION['email'] = (string)$userRow['email'];
        $_SESSION['role'] = (string)$userRow['role'];
        $_SESSION['phone'] = (string)$userRow['phone'];
        $_SESSION['tenant_teacher_id'] = isset($userRow['teacher_id']) ? (int)$userRow['teacher_id'] : null;
    }

    public static function getCurrentUser(): ?array
    {
        self::startSession();
        if (!isset($_SESSION['user_id'])) {
            return null;
        }

        return [
            'user_id' => (int)$_SESSION['user_id'],
            'name' => (string)$_SESSION['name'],
            'email' => (string)$_SESSION['email'],
            'role' => (string)$_SESSION['role'],
            'phone' => (string)$_SESSION['phone'],
            'tenant_teacher_id' => $_SESSION['tenant_teacher_id'] ?? null,
        ];
    }

    public static function requireRole(array $allowedRoles): array
    {
        $user = self::getCurrentUser();
        if ($user === null) {
            Helper::sendJson(['success' => false, 'error' => 'الرجاء تسجيل الدخول أولاً'], 401);
        }

        if (!in_array($user['role'], $allowedRoles, true)) {
            Helper::sendJson(['success' => false, 'error' => 'ليس لديك صلاحية للوصول إلى هذه الواجهة'], 403);
        }

        return $user;
    }

    public static function logout(): void
    {
        self::startSession();
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(
                session_name(),
                '',
                time() - 42000,
                $params['path'],
                $params['domain'],
                $params['secure'],
                $params['httponly']
            );
        }
        session_destroy();
    }
}
