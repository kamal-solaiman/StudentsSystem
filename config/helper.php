<?php
declare(strict_types=1);

/**
 * PHP 8.3 Native Helper Utilities
 * Response formatting, Input Sanitation, and Arabic string support
 * Security Hardening Phase 1: Configurable CORS and standardized responses
 */
final class Helper
{
    private static ?string $allowedOrigin = null;

    /**
     * P1-A: Explicit CORS origin whitelist.
     * Only the official production origin and local development origins are
     * trusted. No other Origin (and never the Host header) is reflected.
     */
    private const ALLOWED_ORIGINS = [
        'https://einshtein-store.online',
        'http://localhost',
        'https://localhost',
        'http://127.0.0.1',
        'https://127.0.0.1',
        'http://localhost:8080',
        'https://localhost:8080',
    ];

    /**
     * Set allowed CORS origin (call this before any output)
     */
    public static function setAllowedOrigin(string $origin): void
    {
        self::$allowedOrigin = $origin;
    }

    /**
     * Get the allowed CORS origin.
     *
     * P1-A: Returns the request Origin header ONLY when it exactly matches the
     * explicit whitelist; otherwise returns null and no CORS allow-headers are
     * sent at all. The Host header is never used to build an allowed origin,
     * so arbitrary Host/Origin values can no longer be reflected.
     */
    private static function getAllowedOrigin(): ?string
    {
        if (self::$allowedOrigin !== null) {
            return self::$allowedOrigin;
        }

        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        if ($origin !== '' && in_array($origin, self::ALLOWED_ORIGINS, true)) {
            return $origin;
        }

        return null;
    }

    /**
     * P1-A: Emit CORS headers only for explicitly whitelisted origins.
     * Same-origin requests (the production SPA under /110/) need none.
     * 'Vary: Origin' is always sent so caches key responses correctly.
     */
    private static function sendCorsHeaders(?string $origin): void
    {
        if ($origin === null) {
            header('Vary: Origin');
            return;
        }

        header("Access-Control-Allow-Origin: $origin");
        header('Access-Control-Allow-Credentials: true');
        header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-CSRF-Token');
        header('Access-Control-Expose-Headers: X-CSRF-Token');
        header('Vary: Origin');
    }

    public static function sendJson(array $data, int $statusCode = 200): never
    {
        http_response_code($statusCode);
        header('Content-Type: application/json; charset=UTF-8');

        // P1-A: CORS headers are sent only for explicitly whitelisted origins
        self::sendCorsHeaders(self::getAllowedOrigin());

        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        exit;
    }

    public static function sendError(string $message, int $statusCode = 400): never
    {
        self::sendJson([
            'success' => false,
            'message' => $message
        ], $statusCode);
    }

    public static function sendUnauthorized(string $message = 'Authentication required'): never
    {
        self::sendJson([
            'success' => false,
            'message' => $message
        ], 401);
    }

    public static function sendForbidden(string $message = 'Access denied'): never
    {
        self::sendJson([
            'success' => false,
            'message' => $message
        ], 403);
    }

    public static function sendNotFound(string $message = 'Resource not found'): never
    {
        self::sendJson([
            'success' => false,
            'message' => $message
        ], 404);
    }

    public static function sendRateLimited(string $message = 'Too many requests, please try again later'): never
    {
        self::sendJson([
            'success' => false,
            'message' => $message
        ], 429);
    }

    public static function handleCorsOptions(): void
    {
        if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
            $origin = self::getAllowedOrigin();

            // P1-A: Reject preflight requests from non-whitelisted origins.
            // Same-origin browsers never send cross-origin preflights, so this
            // cannot affect the production SPA under /110/.
            if ($origin === null) {
                header('Vary: Origin');
                header('Content-Type: application/json; charset=UTF-8');
                http_response_code(403);
                echo json_encode([
                    'success' => false,
                    'message' => 'Origin not allowed'
                ], JSON_UNESCAPED_UNICODE);
                exit;
            }

            self::sendCorsHeaders($origin);
            http_response_code(200);
            exit;
        }
    }

    public static function getJsonInput(): array
    {
        $raw = file_get_contents('php://input');
        if ($raw === false || $raw === '') {
            return [];
        }
        
        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : [];
    }

    public static function sanitizeString(?string $input): string
    {
        if ($input === null) {
            return '';
        }
        return trim(htmlspecialchars($input, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'));
    }

    /**
     * Sanitize integer input
     */
    public static function sanitizeInt($input, int $min = 0): ?int
    {
        if ($input === null || $input === '') {
            return null;
        }
        
        $int = filter_var($input, FILTER_VALIDATE_INT, [
            'options' => ['min_range' => $min]
        ]);
        
        return $int === false ? null : $int;
    }

    /**
     * Sanitize float input
     */
    public static function sanitizeFloat($input): ?float
    {
        if ($input === null || $input === '') {
            return null;
        }
        
        $float = filter_var($input, FILTER_VALIDATE_FLOAT);
        return $float === false ? null : $float;
    }

    public static function formatArabicNumber(float|int $number): string
    {
        return number_format($number, 2, '.', ',');
    }
}

