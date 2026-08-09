<?php

declare(strict_types=1);

/**
 * PHP 8.3 Native MySQL PDO Database Connection Class
 * Compatible with cPanel Shared Hosting & Apache
 */

final class DatabaseConnection
{
    private ?PDO $connection = null;
    private readonly string $host;
    private readonly string $dbName;
    private readonly string $user;
    private readonly string $password;
    private readonly int $port;

    public function __construct(
        string $host = '127.0.0.1',
        string $dbName = 'overtechnology_education1',
        string $user = 'overtechnology_education1',
        string $password = 'hok?[7b5[)$[fRoE',
        int $port = 3306
    ) {
        $this->host = $host;
        $this->dbName = $dbName;
        $this->user = $user;
        $this->password = $password;
        $this->port = $port;
    }

    public static function fromConfigFile(string $filePath = __DIR__ . '/db_credentials.php'): self
    {
        if (file_exists($filePath)) {
            $config = require $filePath;
            return new self(
                (string)($config['host'] ?? '127.0.0.1'),
                (string)($config['dbname'] ?? 'education_platform_db'),
                (string)($config['user'] ?? 'root'),
                (string)($config['password'] ?? ''),
                (int)($config['port'] ?? 3306)
            );
        }
        return new self();
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
                'error' => 'تعذر الاتصال بقاعدة بيانات MySQL في السيرفر.',
                'code' => $exception->getCode()
            ], JSON_UNESCAPED_UNICODE);
            exit;
        }
    }
}
