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
     * Set allowed CORS origin (call this before any output)
     */
    public static function setAllowedOrigin(string $origin): void
    {
        self::$allowedOrigin = $origin;
    }

    /**
     * Get the allowed CORS origin
     */
    private static function getAllowedOrigin(): string
    {
        if (self::$allowedOrigin !== null) {
            return self::$allowedOrigin;
        }
        
        // Check if this is a same-origin request (from the frontend)
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        
        // Allowed origins for development
        $allowedOrigins = [
            'http://localhost',
            'https://localhost',
            'http://127.0.0.1',
            'https://127.0.0.1',
            'http://localhost:8080',
            'https://localhost:8080',
        ];
        
        // Check if origin is in allowed list
        if (in_array($origin, $allowedOrigins, true)) {
            return $origin;
        }
        
        // Default: try to detect from server
        $https = isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on';
        $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
        $scheme = $https ? 'https' : 'http';
        
        // For development, allow localhost and 127.0.0.1
        if (in_array($host, ['localhost', '127.0.0.1', '::1'], true)) {
            return $scheme . '://' . $host;
        }
        
        // For production, be restrictive - only allow same origin
        return $scheme . '://' . $host;
    }

    public static function sendJson(array $data, int $statusCode = 200): never
    {
        http_response_code($statusCode);
        header('Content-Type: application/json; charset=UTF-8');
        
        // Secure CORS: Only allow specific origin
        $origin = self::getAllowedOrigin();
        header("Access-Control-Allow-Origin: $origin");
        header('Access-Control-Allow-Credentials: true');
        header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-CSRF-Token');
        header('Access-Control-Expose-Headers: X-CSRF-Token');
        header('Vary: Origin');

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
            header("Access-Control-Allow-Origin: $origin");
            header('Access-Control-Allow-Credentials: true');
            header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
            header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-CSRF-Token');
            header('Access-Control-Expose-Headers: X-CSRF-Token');
            header('Vary: Origin');
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

