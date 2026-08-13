# Authentication + Attendance Production Fix Report

Date: 2026-08-13

## 1. Student login root cause

Static tracing found the role mapping and `/student` routes are present and correct. The frontend also sends the canonical `{email, password}` payload and `api/login.php` authenticates by `users.email`, preserving the database role. The concrete client-side defect fixed in this phase was API URL resolution: after History API navigation to `/110/student/*` or `/110/parent/*`, a relative `api/...` URL resolves to `/110/student/api/...` (or `/110/parent/api/...`) rather than `/110/api/...`. This makes the session probe/dashboard request fail and previously leaves the UI with no usable route state. API requests now resolve from the application base path.

The login handler already displays `Error.message`; no authorization bypass was added.

## 2. Parent login root cause

Same path-resolution defect as Student. Parent route registration and role mapping were already present. Requests from nested SPA paths could target a non-existent nested API path. The shared API client fix covers both roles.

## 3. Dynamic QR root cause

The implementation correctly keeps the HMAC secret server-side, checks teacher/group/class ownership, uses `random_bytes`, HMAC-SHA256, expiry, and generic errors. The checked-out repository intentionally does not contain `config/qr_secret.php`; only the protected template exists and `.gitignore` excludes the real secret. Therefore a production server without its private deployment copy fails closed with HTTP 503 (`خدمة رمز الحضور غير مهيأة على الخادم`). This is a deployment prerequisite, not something safe to solve by committing a secret. The code path remains fail-closed and does not expose the secret.

## 4. Method 2 root cause

The UI button was a demo-only `alert()` and did not issue an API request. It has been replaced with an authenticated `attendance.php` request using `student_code` and `method: id_scanner`; the existing backend performs tenant enrollment/ownership checks and records the attendance.

## 5. Method 3 root cause

The rendered manual buttons had no click handler. They now issue `attendance.php` with the selected `student_id` and `method: manual`; backend ownership validation remains authoritative.

## 6. Files changed

- `assets/js/api.js` — resolve API URLs from `/110/` (or root) rather than the current nested SPA route.
- `assets/js/teacher.js` — replace method 2 demo alert with API request; wire method 3 buttons; add scoped feedback.
- `AUTH_ATTENDANCE_PRODUCTION_FIX_REPORT.md` — this report.

## 7. Exact fixes

- Shared API requests use `/110/api/...` when deployed under `/110/`, otherwise `/api/...`.
- Scanner attendance sends `student_code`, `id_scanner`, and `present`.
- Manual attendance sends the rendered student ID, `manual`, and `present`.
- Errors are shown without SQL, stack traces, paths, credentials, or secrets.

## 8. Security regression analysis

No backend authorization was weakened. CSRF still comes from `ApiClient`; PHP session cookies and idle timeout remain unchanged. Attendance remains subject to role checks, staff permission checks, tenant ownership/enrollment checks, and server-side database validation. Dynamic QR signing/verification, expiry, old static-token rejection, and secret confidentiality remain server-side. Frontend values are not trusted for authorization.

## 9. Tests performed

- `git diff --check`: PASS.
- `node --check assets/js/api.js`: PASS.
- `node --check assets/js/teacher.js`: PASS.
- `node --check assets/js/app.js`: PASS (regression syntax check).
- PHP lint: NOT AVAILABLE (PHP CLI is not installed in the workspace).
- Production HTTP/browser/API evidence: NOT AVAILABLE in this environment.

Security negative cases (invalid signature, modified token, expiry, wrong tenant/group/teacher, enrollment, and old static QR) were reviewed in the existing server-side implementation; they were not live-executed here.

## 10. Production verification status

**LIVE VERIFICATION: NOT AVAILABLE**

The production URL and server logs/database were not accessible from this workspace, so HTTP status/response-body capture and browser-console capture cannot honestly be claimed.

Deployment action required before QR can pass: install a strong private `config/qr_secret.php` on production, outside source control, readable by PHP, returning a 32+ byte secret. Do not put it in JavaScript, HTML, API responses, browser storage, or logs.

## 11. Remaining issues

- Production must be tested with browser Network/Console and server error logs.
- PHP lint and end-to-end database tests require the production-equivalent PHP 8.3/runtime and database fixtures.
- QR generation remains expected to return 503 until the private production secret is installed if it is currently absent.
