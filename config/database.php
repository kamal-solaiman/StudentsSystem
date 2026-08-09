<?php
declare(strict_types=1);

/**
 * PHP 8.3 Native MySQL PDO Database Connection Class
 * Compatible with cPanel Shared Hosting & Apache
 * Security Hardening Phase 1.6: Removed embedded credentials from source
 */
final class DatabaseConnection
{
    private ?PDO $connection = null;
    private readonly string $host;
    private readonly string $dbName;
    private readonly string $user;
    private readonly string $password;
    private readonly int $port;

    /**
     * Private constructor - use fromConfigFile() instead
     * This prevents accidental instantiation with default credentials
     */
    private function __construct(
        string $host,
        string $dbName,
        string $user,
        string $password,
        int $port = 3306
    ) {
        $this->host = $host;
        $this->dbName = $dbName;
        $this->user = $user;
        $this->password = $password;
        $this->port = $port;
    }

    /**
     * Create database connection from external configuration file
     * REQUIRED: config/db_credentials.php must exist with valid credentials
     * 
     * @throws RuntimeException If configuration file is missing or contains invalid data
     */
    public static function fromConfigFile(string $filePath = __DIR__ . '/db_credentials.php'): self
    {
        if (!file_exists($filePath)) {
            throw new RuntimeException(
                'Database configuration file not found: ' . $filePath . '. ' .
                'Please create config/db_credentials.php with host, dbname, user, password, and port.'
            );
        }

        $config = require $filePath;
        
        // Validate required configuration values
        if (!isset($config['host'], $config['dbname'], $config['user'], $config['port'])) {
            throw new RuntimeException(
                'Invalid database configuration file: ' . $filePath . '. ' .
                'Required keys: host, dbname, user, password, port.'
            );
        }

        return new self(
            (string)$config['host'],
            (string)$config['dbname'],
            (string)$config['user'],
            (string)($config['password'] ?? ''),
            (int)($config['port'] ?? 3306)
        );
    }

    public function connect(): PDO
    {
        if ($this->connection !== null) {
            return $this->connection;
        }

        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
            $this->host,
            $this->port,
            $this->dbName
        );

        $options = [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
            PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci"
        ];

        try {
            $this->connection = new PDO($dsn, $this->user, $this->password, $options);
            return $this->connection;
        } catch (PDOException $exception) {
            http_response_code(500);
            header('Content-Type: application/json; charset=UTF-8');
            echo json_encode([
                'success' => false,
                'error' => 'Database connection failed. Please check your database configuration.',
                'code' => $exception->getCode()
            ], JSON_UNESCAPED_UNICODE);
            exit;
        }
    }
}
