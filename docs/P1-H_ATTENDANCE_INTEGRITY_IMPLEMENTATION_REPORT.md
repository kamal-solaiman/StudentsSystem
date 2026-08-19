# P1-H — ATTENDANCE INTEGRITY REMEDIATION (Methods 2 & 3)

**Repository:** `kamal-solaiman/StudentsSystem` (branch `arena/019ff89d-studentssystem`)
**Date:** 2026-08-15
**Scope:** Attendance Method 2 (`id_scanner`) + Method 3 (`manual`) integrity hardening only.

---

## 1. Scope

- Fix duplicate attendance (one record per student per day) for Methods 2 & 3.
- Reject inactive / missing / cross-tenant enrollments.
- Make the server authoritative for attendance date/time.
- Strictly limit the record branch to the supported methods (`id_scanner`, `manual`).
- Strictly limit statuses to the schema ENUM set (`present`, `absent`, `late`).
- Dynamic QR (Method 1) must remain **completely untouched** (HMAC, 45s TTL, nonce, tenant/group/class ownership, enrollment validation, broadcast behavior).
- No changes to authentication, RBAC, CSRF, session, tenant architecture, login/logout, or the QR secret.

## 2. Before State

`api/attendance.php` (record branch, ~lines 355–433):
- Unconditional `INSERT INTO attendance_records` — repeated submissions created duplicate rows for the same student/day.
- Ownership check `SELECT group_id FROM student_enrollments WHERE teacher_id=:tid AND student_id=:sid` — **did not check `status = 'active'`**.
- `arrival_time` accepted from the client (`$input['arrival_time'] ?? date('h:i A')`) — client-supplied values were trusted.
- Method whitelist included `dynamic_qr` in the record branch — a teacher could label a record as Method 1 without any QR validation (label forgery).
- No transaction/locking around the check-then-insert sequence (race-prone).

Working tree at start (preserved, uncommitted): previous QR presentation/UX fixes in `assets/css/qr.css`, `assets/js/teacher.js`, `index.html`, plus the audit report `ATTENDANCE_METHOD_2_3_BACKEND_AUDIT_REPORT.md`. None of these were reverted or overwritten; **this task modified only `api/attendance.php`**.

## 3. Duplicate Attendance Fix (Fix 1)

Inside a new transaction, after locking the enrollment row (see §12), the branch now checks:

```sql
SELECT id FROM attendance_records
WHERE teacher_id = :tid AND student_id = :sid AND date = CURRENT_DATE()
LIMIT 1
```

If a row exists → `rollBack()` and respond (HTTP 200, consistent with the existing Dynamic QR duplicate convention):

```json
{ "success": true, "already_recorded": true, "message": "تم تسجيل الحضور بالفعل اليوم" }
```

No second row is inserted. The response is not a server exception, matches the project's existing duplicate-response shape used by the Dynamic QR branch, and is displayed by the existing frontend message mechanism (green info box) — no frontend change required. Dedupe scope is per `(teacher_id, student_id, date)` — a student enrolled with **two different teachers** may still legitimately have one record per teacher per day (same rule as the QR branch).

## 4. Active Enrollment Fix (Fix 2)

The ownership query now requires an active enrollment and locks the row:

```sql
SELECT group_id FROM student_enrollments
WHERE teacher_id = :tid AND student_id = :sid AND status = 'active'
LIMIT 1 FOR UPDATE
```

Missing enrollment, inactive enrollment, and cross-tenant students all return **403** with the safe Arabic message `الطالب غير مسجل حاليًا في مجموعة نشطة`. (The previously reachable-but-dead `super_admin` group-lookup `else` branch was removed; super_admin is already hard-blocked above with 403.)

## 5. Server Time/Date Fix (Fix 3)

- `date` was already `CURRENT_DATE()` in the INSERT — kept.
- `$arrivalTime` is **no longer read from the client**; the INSERT now always binds `date('h:i A')` (server clock).
- Client-supplied `date`, `arrival_time`, `departure_time` are ignored (departure stays `""`; no departure-time behavior exists elsewhere for Methods 2/3 — the QR branch is untouched and has its own hardcoded values).

## 6. Method Validation (Fix 4)

Record-branch whitelist changed from `['dynamic_qr', 'id_scanner', 'manual']` to **`['id_scanner', 'manual']`** → anything else returns **400 `Invalid method value`** (verified: a teacher sending `method='dynamic_qr'` is now rejected — Dynamic QR can only be produced through its own dedicated student-role branch with a valid signed token; `qr_handle_student_scan` is byte-for-byte untouched).

## 7. Status Validation (Fix 5)

Unchanged in behavior, kept strict: status must be one of `['present', 'absent', 'late']` (exactly the `attendance_records.status` ENUM in `database/schema.sql`) → otherwise **400 `Invalid status value`**. No new statuses invented.

## 8. Method 2 Changes (`id_scanner`)

- Still accepts `student_code`, resolves the student server-side (`SELECT id FROM students WHERE student_code = :code LIMIT 1`; unknown code → 404 safe message).
- Added: active-enrollment check (403), same-day duplicate prevention (`already_recorded`), server-authoritative `arrival_time`, transaction + row lock.
- CSRF / authentication / RBAC / tenant isolation: unchanged (shared branch).
- Persists exactly one legitimate `attendance_records` row with `method='id_scanner'`.

## 9. Method 3 Changes (`manual`)

- Still accepts `student_id` from the teacher's own tenant-scoped list.
- Added: active-enrollment check (403), same-day duplicate prevention (shared with Method 2 — a student recorded today via Method 3 cannot be re-recorded via Method 2 and vice versa, verified), server-authoritative time, transaction + row lock.
- Persists exactly one legitimate `attendance_records` row with `method='manual'`.

## 10. Dynamic QR Regression Verification

The QR branch (`qr_handle_student_scan`, `qr_handle_generate`, `qr_secret`, HMAC, `QR_VERSION=1`, `QR_TTL_SECONDS=45`) is byte-for-byte unchanged (`git diff` shows no hunks touching it). Verified in the simulated environment with **real tokens** (same base64url + HMAC-SHA256 construction and the real verification code):

| # | Scenario | Result |
|---|---|---|
| 1 | Valid signed token → attendance recorded | PASS (200, `method=dynamic_qr`) |
| 2 | Expired token (`time() > exp`) | PASS (403 "انتهت صلاحية رمز الحضور") |
| 3 | Tampered HMAC signature | PASS (403 "رمز الحضور غير صالح") |
| 4 | Modified `tid` (re-signed) | PASS (403) |
| 5 | Modified `gid` (re-signed) | PASS (403 "غير مصرح لك بالحضور في هذه المجموعة") |
| 6 | Modified `cid` (re-signed, wrong teacher's class) | PASS (403) |
| 7 | Wrong tenant (teacher 2's group/class) | PASS (403) |
| 8 | Wrong group enrollment | PASS (403) |
| 9 | Old static / v0 token | PASS (400) |
| 10 | Malformed legacy token | PASS (400) |
| 11 | Multiple students scanning the same valid broadcast QR | PASS (2 records, one per student) |
| 12 | Student attempting the record branch | PASS (403 "Access denied") |

## 11. Security Regression

| Check | Result |
|---|---|
| Unauthenticated → 401 | PASS (simulated) |
| Wrong role (parent) → 403 | PASS (simulated) |
| Cross-teacher student (Methods 2/3) → 403 | PASS (simulated) |
| Inactive enrollment → 403 | PASS (simulated) |
| Invalid student code → 404 / invalid id → 403 | PASS (simulated) |
| Missing CSRF → 403 "Invalid CSRF token" | PASS (simulated) |
| CSRF via header still accepted | PASS (simulated) |
| Invalid method/status → 400 | PASS (simulated) |
| Client `date`/`arrival_time` cannot override server values | PASS (simulated; DB row compared against server-generated values) |
| QR branch + constants + secret untouched | PASS (static diff) |
| No secrets in frontend/logs | PASS (nothing added) |

## 12. Database / Transaction Decision

**Decision: application-level duplicate check inside a transaction with a row lock — NO schema change, NO unique constraint.**

Rationale:
- A DB unique constraint on `(student_id, date)` would be **wrong** (a student legitimately has one record per teacher per day — multi-teacher enrollments exist).
- A constraint on `(teacher_id, student_id, date)` would be compatible with today's behavior (the QR branch already dedupes on exactly that triple), but it would require a migration, risk failing on pre-existing duplicates, and change the contract for all methods at once.
- The MySQL InnoDB pattern used — `SELECT ... FROM student_enrollments ... FOR UPDATE` (locking read) followed by the duplicate SELECT and the INSERT **inside one transaction** — serializes concurrent submissions for the same student+teacher: the second transaction blocks on the locked enrollment row, and after the first commits, its duplicate check (a consistent read taken after the lock was acquired) sees the committed row and returns `already_recorded`. This is the smallest safe fix and does not alter the schema or Method 1.
- Documented limitation: the concurrent-interleaving behavior was verified by design/static analysis and by sequential simulated tests only — a real MySQL concurrency test was not possible in this environment (see §15).

## 13. Test Matrix

| Test | Method 2 | Method 3 |
|---|---|---|
| Valid attendance → success + persisted row | PASS | PASS |
| Duplicate same student/day → `already_recorded`, no new row | PASS | PASS |
| Cross-method duplicate (M3 then M2) | PASS (M3-first seeded, M2 scan blocked) | — |
| Inactive enrollment → 403 | PASS | PASS |
| Cross-teacher student → 403 | PASS | PASS |
| Invalid student (code 404 / id 403) | PASS | PASS |
| Missing CSRF → 403 | PASS | PASS |
| Unauthenticated → 401 | PASS | PASS |
| Wrong role → 403 | PASS | PASS |
| Invalid method → 400 (incl. `dynamic_qr` label forgery) | PASS | PASS |
| Invalid status → 400 | PASS | PASS |
| Client `date` cannot override server date | PASS | PASS |
| Client `arrival_time` cannot override server time | PASS | PASS |
| Dynamic QR regression (12 cases) | PASS | PASS |

**Total: 39/39 simulated scenarios PASS** (+ frontend browser regression: requests identical, messages displayed).

## 14. Files Modified

- `api/attendance.php` — the only P1-H code change (~82 lines diff, record branch only).
- `P1-H_ATTENDANCE_INTEGRITY_IMPLEMENTATION_REPORT.md` — this report.
- (Preserved uncommitted, NOT part of this change: `assets/css/qr.css`, `assets/js/teacher.js`, `index.html`, `ATTENDANCE_METHOD_2_3_BACKEND_AUDIT_REPORT.md`.)
- **Not modified:** `database/schema.sql` (no migration needed), `config/auth.php`, `config/helper.php`, `config/qr_secret.php(.template)`, all other APIs, all other JS/CSS.

## 15. Production Verification Status

- **STATIC VERIFIED:** PHP/SQL logic reviewed line-by-line; QR branch byte-identical diff.
- **SIMULATED VERIFIED (39/39):** the **real `api/attendance.php`** (+ real `config/auth.php`, helper with harness-only input-injection/status-recording patches) executed in a WASM PHP 8.4 runtime against a simulated persistence layer (stub `config/database.php` replicating the exact SQL semantics; `FOR UPDATE` clause parsed; state dumped per scenario and asserted — including stored dates/times). QR tokens generated with the same HMAC-SHA256 algorithm and verified by the real verification code.
- **LOCAL BROWSER VERIFIED:** frontend chain for Methods 2/3 re-tested (real `teacher.js`/`api.js` in headless Chromium) — requests unchanged (`POST /api/attendance.php`, CSRF header+body), duplicate message flows through the existing UI mechanism.
- **LIVE PRODUCTION VERIFIED: NO.** No production access; no real MySQL concurrency test; no destructive tests. PHP lint: performed via WASM PHP 8.4 (`php -l` CLI unavailable; parse+execute probe passed — the file parses and executes, endpoint answered).
- Required checks: `git diff --check` CLEAN; `node --check assets/js/teacher.js` OK (file unchanged by P1-H).

## 16. Remaining Issues (documented, out of scope)

1. The record branch has no explicit `action` gate (any authenticated POST with valid student/method/status records) — pre-existing; functional today.
2. `late_minutes` remains an int-cast client value (bounded by PHP int; not a date/time field — outside Fix 3 scope).
3. Real MySQL concurrent-request interleaving was not executed (design + sequential simulation only).
4. QR branch does not check `status='active'` on enrollments (pre-existing, explicitly out of scope — Dynamic QR must remain untouched).
5. `config/database.php` contains a hardcoded DB password (pre-existing; not modified, not committed).
