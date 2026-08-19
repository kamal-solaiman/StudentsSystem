# Authentication + Attendance Production Fix Report

**Date:** 2026-08-13
**Scope:** authentication and attendance only; no P2, exam, question-bank, or report work was performed.

## Evidence boundary

`LIVE VERIFICATION: NOT AVAILABLE`

The production page was reachable through the page-fetch service, but this workspace has no production browser session, server error-log access, database access, or PHP runtime. Direct HTTPS diagnostic requests from the workspace's `curl` client failed during TLS connection (`SSL_ERROR_SYSCALL`) before an HTTP request was sent. Consequently, no production HTTP status, authenticated response body, browser-console error, or PHP error-log entry can honestly be reported here. This report separates source-trace findings from live evidence and does **not** claim a live pass.

## 1. Student login root cause

### Source trace

1. `assets/js/app.js:572-616` reads email/password and calls `ApiClient.login(email, password)`.
2. `assets/js/api.js:86-88` sends JSON `POST /110/api/login.php` when the application is under `/110/`; this avoids a nested route such as `/110/student/api/login.php`.
3. `api/login.php:15-82` reads `email` and `password`, rate-limits failures, looks up `users.email`, verifies `password_hash`, preserves the database `role`, creates the PHP session, and returns the role plus CSRF token.
4. `assets/js/app.js:620-631` maps `student` to `/student`; the router registers `/student` and `/student/:tab` at `assets/js/app.js:119-126`.
5. The guard's student session probe calls `ApiClient.getStudentData()` (`assets/js/app.js:174-176`), and `api/student.php:11-28` requires the authenticated `student` role and derives the student record from the session user ID.

### Confirmed root cause

**Not proven on production.** The current checked-out source contains the required student role mapping, request payload, session setup, CSRF handling, route registration, and root-relative API resolution. The reported symptom cannot be attributed to a specific source line without the failing production Network/Console entry and server log.

### Related hardening implemented

`api/student.php` previously concatenated `$exception->getMessage()` into a browser response. It now logs only a safe event/class marker server-side and returns a generic 500 JSON message. This prevents a dashboard failure from exposing SQL, filesystem, or internal exception detail while retaining a production-safe diagnostic signal.

## 2. Parent login root cause

### Source trace

The login flow is shared with student through `api/login.php`. Role routing maps `parent` to `/parent` at `assets/js/app.js:144-145`; `/parent` and `/parent/:tab` are registered at lines 128-135. The guard probes `ApiClient.getParentData()` (`assets/js/app.js:177-178`), and `api/parent.php:11-38` requires the authenticated `parent` role and uses the session user ID.

### Confirmed root cause

**Not proven on production.** The source has no separate parent login payload or role-routing omission. A specific production request/response and browser error are required before claiming an exact cause.

### Related hardening implemented

As for the student endpoint, `api/parent.php` now keeps exception detail out of the HTTP response and writes only an event/class marker to the server error log.

## 3. Dynamic QR generation root cause

### Expected behavior

Method 1 lets a teacher/staff member with `attendance` permission select an owned group. `ApiClient.generateAttendanceQr()` posts `{action:"generate_qr", group_id}` to `api/attendance.php`; the server checks session role, CSRF, group ownership, class ownership, creates a nonce with `random_bytes()`, signs the base64url payload with HMAC-SHA256, and returns a 45-second token. The browser only renders the signed token as QR data.

### Source trace

- Request/UI: `assets/js/teacher.js:1086-1111` and `assets/js/api.js:167-173`.
- Authentication, role, permission and CSRF: `api/attendance.php:13-32`.
- Teacher/staff context: `api/attendance.php:334-355`.
- Secret loading and no-secret fail-closed path: `api/attendance.php:51-67`, `:98-102`.
- Group/class ownership and HMAC issuance: `api/attendance.php:113-157`.
- The old `DYN-QR-992384-AUTO` literal is not accepted by the dynamic-token parser.

### Confirmed source condition

`config/qr_secret.php` is deliberately git-ignored and absent from this checkout. If the matching private file is absent, unreadable, invalid, or returns fewer than 32 bytes on production, the confirmed code path returns **HTTP 503** with the safe message `خدمة رمز الحضور غير مهيأة على الخادم`. The secret is never returned, logged, or sent to JavaScript.

This is a deployment prerequisite, not a safe value to commit. It is not evidence that this is the production response because production HTTP/log access was unavailable.

### Fix implemented

The QR generation block is now one guarded operational unit. Database, ownership-query, entropy, JSON-encoding, and HMAC operational failures produce a safe 500 JSON response and a server-side event/class marker (`attendance.php QR generation failure (...)`). `JSON_THROW_ON_ERROR` prevents an invalid JSON encoding from silently becoming a malformed token. Authorization, HMAC validation, token TTL, and secret confidentiality were not relaxed.

**Required deployment check:** install a distinct 32+ byte `config/qr_secret.php` on the production host, readable by PHP and excluded from source control. Confirm its exact 503/500/200 result via the browser Network panel and the server error log; do not place the secret in a report, HTML, JavaScript, API response, or log.

## 4. Attendance method 2 root cause

### Expected behavior and source trace

Method 2 is the teacher/staff scanner/card flow, not student self-scanning. `assets/js/teacher.js:315-325` gathers `student_code`; its click handler at `:1208-1229` posts `{student_code, method:"id_scanner", status:"present"}`. `api/attendance.php:360-427` resolves the student code, verifies an enrollment for the session tenant teacher, derives the group server-side, and inserts the record.

### Confirmed root cause

**Not proven on production.** The current UI does issue the authenticated request and the backend performs the ownership check. Production request status/body and any server error are unavailable, so no exact method-2 failure can be claimed.

## 5. Attendance method 3 root cause

### Expected behavior and source trace

Method 3 is teacher/staff manual marking. The table renders session-tenant students at `assets/js/teacher.js:327-356`; the handler at `:1233-1248` posts `{student_id, method:"manual", status:"present"}`. The same backend branch validates the enrollment against the server session tenant before insertion.

### Confirmed root cause

**Not proven on production.** The source has a wired request and server-side tenant ownership validation. There is no live request/status/body/browser error available to establish a more specific cause.

## 6. Files changed in this phase

- `api/attendance.php`
- `api/login.php`
- `api/student.php`
- `api/parent.php`
- `AUTH_ATTENDANCE_PRODUCTION_FIX_REPORT.md`

## 7. Exact fixes

- Added server-side, secret-free operational logging to QR generation and made JSON payload encoding fail explicitly.
- Added server-side, secret-free logging to login failures.
- Removed raw exception-message disclosure from student and parent dashboard API responses; they now return safe JSON errors.

## 8. Security regression analysis

- No role, permission, CSRF, session, rate-limit, idle-timeout, cookie, CORS, or tenant check was bypassed.
- Students still only use the `dynamic_qr` scan branch; they cannot issue QR tokens or use manual/scanner branches.
- Teachers/staff still require their own tenant context; staff still require `attendance` permission.
- Group/class ownership, student enrollment validation, HMAC-SHA256, `hash_equals`, and 45-second expiry remain server-authoritative.
- No QR secret was created, committed, exposed, or logged. `.gitignore` still excludes `config/qr_secret.php`, and `.htaccess` denies direct `config/` access.

## 9. Tests performed

- `git diff --check`: PASS.
- JavaScript syntax checks (`api.js`, `app.js`, `router.js`, `teacher.js`, `student.js`, `parent.js`): PASS.
- PHP lint: **NOT AVAILABLE** (`php` CLI is not installed in this workspace).
- Production browser/API/database tests: **NOT AVAILABLE**.

The requested valid/invalid login, F5/back/logout, QR tampering/expiry/tenant, and method-2/method-3 end-to-end tests require an authorized production-equivalent PHP/MySQL environment and test accounts. They were not fabricated.

## 10. Production verification status

**LIVE VERIFICATION: NOT AVAILABLE**

## 11. Remaining issues / required production verification

1. Capture the Student and Parent login Network entries: login status/body, then `student.php`/`parent.php` probe status/body, and browser Console errors.
2. Inspect the server error log for the new safe event markers after a controlled failure.
3. Verify `config/qr_secret.php` exists only on the server, returns a strong string, is readable by PHP, and remains inaccessible over HTTP.
4. Execute the requested role, logout, route-refresh/back, QR integrity/expiry/tenant, and method-2/method-3 tests with approved test credentials.
