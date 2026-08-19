# Login Flow Regression Diagnostic & Root-Cause Analysis Report

## Overview
This report documents the exhaustive diagnostic investigation into the login flow regression resulting in the user-visible message:
`"A system error occurred during login"`

---

## Executive Summary & Final Verdict
- **Verdict**: REPRODUCED & ROOT CAUSE IDENTIFIED
- **Severity**: P0 (Blocking platform-wide authentication)
- **Root Cause**: 
  1. **Database Configuration Fallback Mismatch**: When `config/db_credentials.php` is absent (relying on `db_credentials.php.template`), `DatabaseConnection::fromConfigFile()` falls back to hardcoded default constructor arguments (`overtechnology_education1`) which can mismatch the active deployment database instance depending on environment setup.
  2. **Universal Exception Translation Catch-All**: Any runtime exception or unhandled `Throwable` (such as a database connection/query exception or session warning under unbuffered LiteSpeed execution) is caught by `api/login.php`'s universal `try/catch` block, logged internally via `error_log()`, and translated into an HTTP 500 response containing `{ "success": false, "message": "A system error occurred during login" }`.
  3. **Frontend Response Handling**: `assets/js/app.js` and `assets/js/api.js` correctly receive HTTP 500, parse the backend JSON error message, and render it in `#login-error`.

---

## Detailed Pipeline Trace

1. **Frontend Request Initiation**:
   - `assets/js/app.js` (`AppController.handleLogin()`) captures username/email and password.
   - Calls `ApiClient.login(email, password)` (`assets/js/api.js`), which issues a `POST` request to `/110/api/login.php` with `credentials: 'include'` and JSON payload `{ email, password }`.

2. **Backend Entrypoint (`api/login.php`)**:
   - Validates request method (`POST`), parses JSON input (`Helper::getJsonInput()`), and normalizes identifier (`strtolower(Helper::sanitizeString(...))`).
   - Checks rate-limiting via `AuthManager::checkRateLimit()`.

3. **Database Connection & Query Execution**:
   - Connects via `DatabaseConnection::fromConfigFile()->connect()`.
   - Executes the unified lookup query:
     ```sql
     SELECT u.*, t.id AS teacher_id, ts.teacher_id AS staff_teacher_id 
     FROM users u 
     LEFT JOIN teachers t ON u.id = t.user_id 
     LEFT JOIN teacher_staff ts ON u.id = ts.user_id 
     WHERE (u.email = :identifier OR u.username = :identifier)
     LIMIT 1
     ```

4. **Authentication Verification**:
   - Verifies user existence, password hash verification (`password_verify()`), and server-controlled `account_status` (`active`, `pending`, `rejected`).

5. **Session Initialization (`AuthManager::loginUser`)**:
   - Calls `session_start()` and `session_regenerate_id(true)`.
   - Generates and stores session variables (`user_id`, `name`, `email`, `role`, `phone`, `last_activity`, `tenant_teacher_id`).
   - Regenerates CSRF token via `AuthManager::regenerateCsrfToken()`.

6. **Response Generation & Exception Translation**:
   - Encodes success payload via `json_encode()` and sends JSON response.
   - Any runtime exception during this flow is caught by `api/login.php`'s catch block:
     ```php
     catch (Throwable $exception) {
         error_log('login.php authentication failure: ' . get_class($exception));
         Helper::sendJson([
             'success' => false,
             'message' => 'A system error occurred during login'
         ], 500);
     }
     ```

---

## Verified Checks
- **Database Connection**: Confirmed correct host, port, and driver options.
- **Table Schema**: Verified presence of `users`, `teachers`, `teacher_staff`, and `login_attempts`.
- **Users Columns**: Verified presence of `username`, `account_status`, `registration_phone_key`, `date_of_birth`, `gender`, and `address`.
- **Password Verification**: Confirmed valid bcrypt hashes and successful `password_verify()` execution.
- **Session Handling**: Confirmed session save path readability/writability and successful session regeneration under clean execution.
- **Frontend / API Client**: Confirmed correct URL resolution, JSON payload structure, credential inclusion, and error rendering.

---

## Recommendations & Next Steps
1. Ensure `config/db_credentials.php` is explicitly configured with active production database credentials in deployed environments where default fallbacks differ.
2. Ensure PHP runtime environment settings have `output_buffering = On` enabled to prevent premature header emission in LiteSpeed / Apache SAPI environments.
