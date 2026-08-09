<?php
declare(strict_types=1);

require_once __DIR__ . '/helper.php';

/**
 * PHP 8.3 Native Authentication & Role Based Access Control (RBAC)
 * Security Hardening Phase 1: Central Authentication Guard
 */
final class AuthManager
{
    private const SESSION_NAME = 'UNIFIED_EDU_SESSION';
    private const CSRF_TOKEN_LENGTH = 32;
    private const RATE_LIMIT_WINDOW = 900; // 15 minutes in seconds
    private const RATE_LIMIT_MAX_ATTEMPTS = 5;

    public static function startSession(): void
    {
        if (session_status() === PHP_SESSION_NONE) {
            session_name(self::SESSION_NAME);
            session_set_cookie_params([
                'lifetime' => 86400, // 24 hours (reduced from 7 days for security)
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
        
        // Session Fixation Protection: Regenerate session ID after successful login
        session_regenerate_id(true);
        
        $_SESSION['user_id'] = (int)$userRow['id'];
        $_SESSION['name'] = (string)$userRow['name'];
        $_SESSION['email'] = (string)$userRow['email'];
        $_SESSION['role'] = (string)$userRow['role'];
        $_SESSION['phone'] = (string)$userRow['phone'];
        
        // Determine tenant_teacher_id based on user role
        // For teachers: from teachers table
        // For staff: from teacher_staff table (staff_teacher_id)
        // For others: null
        if ($userRow['role'] === 'teacher' && isset($userRow['teacher_id'])) {
            $_SESSION['tenant_teacher_id'] = (int)$userRow['teacher_id'];
        } elseif ($userRow['role'] === 'staff' && isset($userRow['staff_teacher_id'])) {
            $_SESSION['tenant_teacher_id'] = (int)$userRow['staff_teacher_id'];
        } elseif ($userRow['role'] === 'staff' && isset($userRow['teacher_id'])) {
            // Fallback: if teacher_id was set from JOIN
            $_SESSION['tenant_teacher_id'] = (int)$userRow['teacher_id'];
        } else {
            $_SESSION['tenant_teacher_id'] = null;
        }
        
        // Generate and store CSRF token for the session
        self::regenerateCsrfToken();
        
        // Clear rate limit attempts on successful login
        self::clearRateLimit($userRow['email']);
    }

    /**
     * Regenerate CSRF token for the current session
     */
    public static function regenerateCsrfToken(): string
    {
        self::startSession();
        $token = bin2hex(random_bytes(self::CSRF_TOKEN_LENGTH));
        $_SESSION['csrf_token'] = $token;
        $_SESSION['csrf_token_time'] = time();
        return $token;
    }

    /**
     * Get current CSRF token
     */
    public static function getCsrfToken(): string
    {
        self::startSession();
        if (!isset($_SESSION['csrf_token']) || !isset($_SESSION['csrf_token_time'])) {
            return self::regenerateCsrfToken();
        }
        
        // Regenerate token every hour for security
        if (time() - $_SESSION['csrf_token_time'] > 3600) {
            return self::regenerateCsrfToken();
        }
        
        return (string)$_SESSION['csrf_token'];
    }

    /**
     * Validate CSRF token
     */
    public static function validateCsrfToken(?string $token): bool
    {
        self::startSession();
        if ($token === null || $token === '') {
            return false;
        }
        
        return isset($_SESSION['csrf_token']) && 
               hash_equals($_SESSION['csrf_token'], $token);
    }

    /**
     * Check if user is authenticated
     */
    public static function isAuthenticated(): bool
    {
        self::startSession();
        return isset($_SESSION['user_id'], $_SESSION['role']);
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

    /**
     * Get current user or fail with 401
     */
    public static function getCurrentUserOrFail(): array
    {
        $user = self::getCurrentUser();
        if ($user === null) {
            Helper::sendJson(['success' => false, 'message' => 'Authentication required'], 401);
        }
        return $user;
    }

    /**
     * Require specific roles
     */
    public static function requireRole(array $allowedRoles): array
    {
        $user = self::getCurrentUserOrFail();

        if (!in_array($user['role'], $allowedRoles, true)) {
            Helper::sendJson(['success' => false, 'message' => 'Access denied'], 403);
        }

        return $user;
    }

    /**
     * Require authentication without role check
     */
    public static function requireAuth(): array
    {
        return self::getCurrentUserOrFail();
    }

    /**
     * Require specific permission for the current user
     * For staff: checks permissions from teacher_staff table
     * For teachers: automatically granted (they own the tenant)
     * For super_admin: automatically granted (platform-level access)
     * For others: denied
     * 
     * @param string $permission Required permission (e.g., 'attendance', 'students', 'groups')
     * @param int|null $teacherId Optional teacher_id for additional validation
     * @return array User data
     */
    public static function requirePermission(string $permission): array
    {
        $user = self::getCurrentUserOrFail();
        
        // Teachers automatically have all permissions for their own tenant
        if ($user['role'] === 'teacher') {
            return $user;
        }
        
        // Super Admin has platform-level permissions but not tenant-level
        // They should not be using permission-checked endpoints
        if ($user['role'] === 'super_admin') {
            Helper::sendForbidden('Super Admin access restricted to platform management only');
        }
        
        // Students and Parents don't have staff permissions
        if ($user['role'] === 'student' || $user['role'] === 'parent') {
            Helper::sendForbidden('Access denied');
        }
        
        // Staff: check permissions from database
        if ($user['role'] === 'staff') {
            $db = DatabaseConnection::fromConfigFile()->connect();
            
            // Get staff permissions from teacher_staff table
            $stmt = $db->prepare('SELECT permissions FROM teacher_staff WHERE user_id = :uid LIMIT 1');
            $stmt->execute(['uid' => $user['user_id']]);
            $staffData = $stmt->fetch();
            
            if ($staffData === false) {
                Helper::sendForbidden('Staff record not found');
            }
            
            $permissions = json_decode($staffData['permissions'], true) ?: [];
            
            if (!in_array($permission, $permissions, true)) {
                Helper::sendForbidden('Access denied: Insufficient permissions');
            }
            
            return $user;
        }
        
        Helper::sendForbidden('Access denied');
    }

    /**
     * Check if current user has a specific permission (returns bool instead of failing)
     * Useful for conditional UI elements
     */
    public static function hasPermission(string $permission): bool
    {
        try {
            $user = self::getCurrentUser();
            if ($user === null) {
                return false;
            }
            
            // Teachers automatically have all permissions for their own tenant
            if ($user['role'] === 'teacher') {
                return true;
            }
            
            // Super Admin doesn't have tenant-level permissions
            if ($user['role'] === 'super_admin') {
                return false;
            }
            
            // Students and Parents don't have staff permissions
            if ($user['role'] === 'student' || $user['role'] === 'parent') {
                return false;
            }
            
            // Staff: check permissions from database
            if ($user['role'] === 'staff') {
                $db = DatabaseConnection::fromConfigFile()->connect();
                $stmt = $db->prepare('SELECT permissions FROM teacher_staff WHERE user_id = :uid LIMIT 1');
                $stmt->execute(['uid' => $user['user_id']]);
                $staffData = $stmt->fetch();
                
                if ($staffData === false) {
                    return false;
                }
                
                $permissions = json_decode($staffData['permissions'], true) ?: [];
                return in_array($permission, $permissions, true);
            }
            
            return false;
        } catch (Throwable) {
            return false;
        }
    }

    /**
     * Get all permissions for the current staff user
     */
    public static function getStaffPermissions(): array
    {
        $user = self::getCurrentUser();
        if ($user === null || $user['role'] !== 'staff') {
            return [];
        }
        
        try {
            $db = DatabaseConnection::fromConfigFile()->connect();
            $stmt = $db->prepare('SELECT permissions FROM teacher_staff WHERE user_id = :uid LIMIT 1');
            $stmt->execute(['uid' => $user['user_id']]);
            $staffData = $stmt->fetch();
            
            if ($staffData === false) {
                return [];
            }
            
            return json_decode($staffData['permissions'], true) ?: [];
        } catch (Throwable) {
            return [];
        }
    }

    /**
     * Check rate limit for login attempts
     */
    public static function checkRateLimit(string $identifier): bool
    {
        self::startSession();
        
        $key = 'rate_limit_' . $identifier;
        
        if (!isset($_SESSION[$key])) {
            $_SESSION[$key] = [
                'attempts' => 0,
                'first_attempt' => time(),
                'last_attempt' => time()
            ];
            return true;
        }
        
        $rateData = $_SESSION[$key];
        $now = time();
        
        // Reset if window expired
        if ($now - $rateData['first_attempt'] > self::RATE_LIMIT_WINDOW) {
            $_SESSION[$key] = [
                'attempts' => 0,
                'first_attempt' => $now,
                'last_attempt' => $now
            ];
            return true;
        }
        
        // Check if max attempts exceeded
        if ($rateData['attempts'] >= self::RATE_LIMIT_MAX_ATTEMPTS) {
            return false;
        }
        
        // Increment attempt counter
        $_SESSION[$key]['attempts'] = $rateData['attempts'] + 1;
        $_SESSION[$key]['last_attempt'] = $now;
        
        return true;
    }

    /**
     * Clear rate limit for identifier
     */
    public static function clearRateLimit(string $identifier): void
    {
        self::startSession();
        $key = 'rate_limit_' . $identifier;
        unset($_SESSION[$key]);
    }

    /**
     * Get remaining rate limit attempts
     */
    public static function getRateLimitRemaining(string $identifier): int
    {
        self::startSession();
        $key = 'rate_limit_' . $identifier;
        
        if (!isset($_SESSION[$key])) {
            return self::RATE_LIMIT_MAX_ATTEMPTS;
        }
        
        $rateData = $_SESSION[$key];
        $now = time();
        
        // Reset if window expired
        if ($now - $rateData['first_attempt'] > self::RATE_LIMIT_WINDOW) {
            return self::RATE_LIMIT_MAX_ATTEMPTS;
        }
        
        return max(0, self::RATE_LIMIT_MAX_ATTEMPTS - $rateData['attempts']);
    }

    /**
     * Verify teacher isolation - ensure current user can access the requested teacher_id
     * For teachers: must match their own tenant_teacher_id
     * For staff: must match their teacher_id from teacher_staff table
     * For super_admin: allowed (but should not access individual student data per business rules)
     */
    public static function verifyTeacherAccess(int $requestedTeacherId, ?int $currentUserTeacherId = null, string $currentRole = ''): bool
    {
        // Super admin can access any teacher for SaaS management (but not individual student data)
        if ($currentRole === 'super_admin') {
            return true;
        }
        
        // If current user teacher ID not provided, get it from session
        if ($currentUserTeacherId === null) {
            $user = self::getCurrentUser();
            if ($user === null) {
                return false;
            }
            $currentUserTeacherId = $user['tenant_teacher_id'];
            $currentRole = $user['role'];
        }
        
        // Teacher can only access their own data
        if ($currentRole === 'teacher') {
            return $currentUserTeacherId === $requestedTeacherId;
        }
        
        // Staff must belong to the requested teacher
        if ($currentRole === 'staff') {
            return $currentUserTeacherId === $requestedTeacherId;
        }
        
        // Student and parent cannot access teacher data directly
        return false;
    }

    /**
     * Verify student isolation - ensure current user can access the requested student_id
     */
    public static function verifyStudentAccess(int $requestedStudentId, ?int $currentUserId = null, string $currentRole = '', ?int $currentStudentId = null): bool
    {
        if ($currentUserId === null || $currentRole === '') {
            $user = self::getCurrentUser();
            if ($user === null) {
                return false;
            }
            $currentUserId = $user['user_id'];
            $currentRole = $user['role'];
        }
        
        // Super admin should not access individual student data per business rules
        if ($currentRole === 'super_admin') {
            return false;
        }
        
        // Student can only access their own data
        if ($currentRole === 'student') {
            if ($currentStudentId === null) {
                // Need to look up student_id from user_id
                // This will be handled at the API level with database check
                return false; // Will be verified with DB
            }
            return $currentStudentId === $requestedStudentId;
        }
        
        // Parent can access their children's data
        if ($currentRole === 'parent') {
            // Will be verified at API level with database check for parent-child relationship
            return true; // Preliminary - actual check happens in API with DB
        }
        
        // Teacher and staff can access students in their groups
        if ($currentRole === 'teacher' || $currentRole === 'staff') {
            // Will be verified at API level with database check
            return true; // Preliminary - actual check happens in API with DB
        }
        
        return false;
    }

    /**
     * Verify parent can access the requested child
     * This requires database check - returns true to allow API to do the check
     */
    public static function verifyParentChildAccess(int $parentUserId, int $studentId): bool
    {
        // This is a placeholder - actual verification happens in API with database
        // We return true here to allow the API to perform the database check
        return true;
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
