# P1-G_IMPLEMENTATION_PLAN — DYNAMIC QR SECURITY (PLAN ONLY)

**Scope:** PLAN ONLY — no code, database, or configuration changes are made by this document.
**Date:** 2026-08-13 (Africa/Cairo) · **Branch:** `arena/019ff7b4-studentssystem`
**Objective:** Replace the static mock QR (`DYN-QR-992384-AUTO`) with a secure, dynamic, server-validated attendance QR system: HMAC + TTL + nonce + server-side validation + tenant isolation + replay protection, with the backend as the only source of truth.
**Environment constraint:** PHP 8.3 · MySQL · Apache · cPanel shared hosting — no Node.js, no Redis, no Docker, no WebSockets, no external services.

---

## PART 1 — CURRENT QR ARCHITECTURE (AUDIT FINDINGS)

### 1.1 How is the QR currently generated?
- Purely **client-side and decorative**: `assets/js/qr-generator.js` (`QrSvgGenerator.renderSvg(text,size)`) draws a deterministic pattern from a JS string hash — it is **not a real QR encoding** and cannot be decoded by any scanner.
- Teacher "dynamic" screen: `assets/js/teacher.js:1025-1026` renders `renderSvg('DYNAMIC-QR-SCREEN-TOKEN', 220)` — a **fixed string**.
- Displayed token literal: `assets/js/teacher.js:312` → `TOKEN: DYN-QR-992384-AUTO` — **hard-coded**.
- Student badge QR (`student.js:28`, `teacher.js:243`): decorative `renderSvg(student_code)`; buttons currently dead.

### 1.2 Where is it stored?
**Nowhere.** Both "tokens" are string literals in JS. No DB table, no session value, no expiry, no nonce.

### 1.3 How is it read?
There is **no real reading path**:
- Teacher scanner tab: text input `#scanner-input-code` (`teacher.js:322`) + button `#btn-submit-scan` (`teacher.js:1031-1035`) that shows a **fake success alert with no API call**.
- Students have **no scan/submit surface at all** in the current UI.

### 1.4 How is it validated?
**It isn't.** `api/attendance.php` accepts `student_id`/`student_code` + a `method` label (`dynamic_qr|id_scanner|manual` — validated only as an ENUM string, line 62). The only real checks are: authentication, role/permission, CSRF, and the student-enrollment check against the **session** teacher (`attendance.php:84-93`).

### 1.5 Can it be reused (replayed)?
Yes — infinitely. The values are static literals with no expiry, no nonce, no usage tracking.

### 1.6 Can a student use another teacher's QR?
The QR carries no identity at all today. The *recording* path is teacher-session-scoped, so a student cannot record anything themselves currently — but any future wiring of the current mock would allow arbitrary reuse since nothing is signed or bound.

### 1.7 Cross-tenant QR usage?
Same as above: no tenant binding exists in the QR itself. Tenant safety today comes solely from `attendance.php` using the session `teacher_id`.

### 1.8 Can the QR be forged from the frontend?
Trivially — everything is frontend-generated; there is no signature, secret, or server check.

### 1.9 Is there an existing issue/renew QR endpoint?
**No.** No endpoint in `api/*.php` issues, renews, or validates QR tokens.

### 1.10 Is a database migration required?
**Yes — one small new table (`qr_tokens`) is recommended** (see §3 for the stateless-vs-stateful justification). No changes required to `attendance_records` for the feature itself; an *optional* dedupe hardening is flagged as a decision item.

### 1.11 What is the smallest safe architectural change?
One new endpoint file (`api/qr.php`), one new table, one JS QR encoder, and countdown/submit UI in `teacher.js`/`student.js`. **No changes** to authentication, RBAC, CSRF, CORS, idle timeout, rate limiting, routing architecture, or existing endpoints.

---

## PART 2 — SECURITY PROBLEMS OF THE CURRENT STATE

| # | Problem | Severity |
|---|---|---|
| 1 | Static hard-coded token `DYN-QR-992384-AUTO` — infinite replay, forgeable | HIGH (when wired) |
| 2 | No server-side validation of any QR value | HIGH |
| 3 | No TTL / expiry / nonce / signature | HIGH |
| 4 | Fake success alert in scanner path (UX deception adjacent to security) | MEDIUM |
| 5 | `students.qr_code_token` column exposed in API (`student.php:193`) but never validated — dead credential material | MEDIUM |
| 6 | No same-day attendance dedupe in `attendance.php` (duplicate records possible) | MEDIUM |
| 7 | Decorative "QR" cannot be scanned — feature non-functional | Functional |

---

## PART 3 — RECOMMENDED ARCHITECTURE

### 3.1 Design decision: STATEFUL (HMAC-assisted), not pure-stateless

**Why stateless-only (HMAC + timestamp) is NOT sufficient here:**
- It cannot revoke an old QR when the teacher regenerates (requirement: "old QR after regeneration → rejected").
- Strict replay protection within TTL is impossible without tracking usage/revocation.
- The requirement list explicitly demands deterministic expiry + regeneration invalidation + replay tests.

**Why still keep HMAC:**
- Instant tamper rejection **before any DB lookup** (defense in depth).
- Guarantees the token structure (`teacher_id|group_id|nonce|expires`) was issued by this server even if an attacker obtains a DB read of token hashes.
- Cheap: `hash_hmac('sha256', …)` + `hash_equals`.

**Result:** a small `qr_tokens` table (issue/revocation/expiry source of truth) + HMAC-signed tokens (integrity layer) + session-bound identity (student_id always from the PHP session, never from the QR).

### 3.2 Token design

```
payload = "v1" | teacher_id | group_id | nonce | expires_unix
sig     = HMAC-SHA256(QR_SECRET, payload)
token   = payload | "." | hex(sig)            → encoded into the QR image
code    = first 8 chars of nonce (unambiguous alphabet, e.g. A-Z 2-9 minus I/O/0/1)
                                                 → human-enterable fallback
```
- `nonce`: 16 bytes from `random_bytes()`, hex (32 chars); UNIQUE in DB.
- `expires_unix = time() + QR_TTL_SECONDS`.
- **Recommended TTL: 60 seconds** (configurable constant). Rationale: long enough for a classroom of students to scan one projected code with phone jitter; short enough that a leaked code dies within a minute. Frontend auto-regenerates every ~45 s (visible countdown).
- The QR encodes the full signed `token`; the large on-screen **code** allows manual entry for students without cameras (MVP path — no camera decoding library required, satisfying the no-external-library constraint).
- Teacher/group identity for validation is taken **from the DB row**, never from client input.

### 3.3 Secret management
- `QR_SECRET` read from the existing protected config file `config/db_credentials.php` (blocked by `.htaccess`, git-ignored) as an added key `qr_secret` (≥ 32 random bytes, base64/hex).
- **No fallback, no default:** if missing/short, `api/qr.php` answers 503 "QR feature not configured" (fail-closed).
- Secret never appears in any response, JS, log line, or error message.
- `config/db_credentials.php.template` documents the new key (template is safe to commit; the real file is not).

### 3.4 Validation flow (scan)

```
Student (authenticated session) POSTs {token} or {code}
 1. requireRole(['student'])                          → 401/403 gates first
 2. CSRF validated (existing mechanism)
 3. Parse:
      token path → split, recompute HMAC, hash_equals   → mismatch: 403 "Invalid QR"
                   parse fields, check expires_unix      → past:     403 "QR expired"
                   locate row by nonce
      code path  → normalize; locate row by short_code   → missing:  400/403
 4. Row checks: revoked = 0 AND expires_at > NOW()       → else 403 expired/revoked
 5. teacher_id/group_id ← DB ROW (not client)
 6. student_enrollments check: this student enrolled in that group of that teacher
                                                          → else 403
 7. Same-day dedupe: existing attendance_records row for (teacher_id, student_id,
    CURRENT_DATE) → return 200 {already_recorded:true} (idempotent, replay-safe)
 8. INSERT attendance_records (status 'present', method 'dynamic_qr',
    arrival_time = current server time, group_id from row)
 9. Optional: scans_count++ on the row
10. Response: success + student name + group name ONLY (no token, no HMAC, no secrets)
```

### 3.5 Issue/rotation flow (teacher)

```
Teacher/Staff (permission 'attendance') POST qr.php?action=issue {group_id}
 1. requireRole(['teacher','staff']); staff → requirePermission('attendance')
 2. CSRF validated
 3. teacher_id ← session (tenant_teacher_id)
 4. Ownership: group_id must belong to session teacher (P1-B-style check) → else 403
 5. Revoke all active rows for (teacher_id, group_id)   ← old QR dies immediately
 6. Generate nonce; expires = NOW + TTL; sig = HMAC
 7. INSERT qr_tokens (store sha256(token) as token_hash — raw token never stored)
 8. Respond: {qr_token, code, expires_at, ttl_seconds}  (secret never included)
```

---

## PART 4 — DATABASE CHANGES (PROPOSED — NOT EXECUTED)

### 4.1 New table `qr_tokens`
```sql
CREATE TABLE IF NOT EXISTS `qr_tokens` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `teacher_id`      INT UNSIGNED NOT NULL,
  `group_id`        INT UNSIGNED NOT NULL,
  `nonce`           CHAR(32)     NOT NULL,
  `short_code`      CHAR(8)      NOT NULL,
  `token_hash`      CHAR(64)     NOT NULL,          -- sha256(token); raw token never stored
  `issued_by`       INT UNSIGNED NOT NULL,          -- user who generated it
  `expires_at`      DATETIME     NOT NULL,
  `revoked`         TINYINT(1)   NOT NULL DEFAULT 0,
  `scans_count`     INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at`      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_qr_nonce` (`nonce`),
  UNIQUE KEY `uq_qr_short_code` (`short_code`),
  KEY `idx_qr_teacher_group` (`teacher_id`, `group_id`, `revoked`),
  KEY `idx_qr_expires` (`expires_at`),
  CONSTRAINT `fk_qr_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_qr_group`   FOREIGN KEY (`group_id`)   REFERENCES `study_groups` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```
- No passwords/secrets in this table (token_hash is one-way; forging still requires QR_SECRET).
- Cleanup: opportunistic purge of expired rows (`expires_at < NOW() - INTERVAL 1 DAY`) piggy-backed on issue calls (cPanel-friendly, no cron), same pattern as `login_attempts`.

### 4.2 Optional hardening (decision item — not part of the core feature)
- `UNIQUE KEY (teacher_id, student_id, date)` on `attendance_records` to make dedupe race-proof. **Flagged only**; app-level dedupe check in step 7 is sufficient for P1-G. Adding the constraint risks rejecting legitimate historical duplicate rows on production — must be checked before adoption.

### 4.3 No migration is executed in this phase.

---

## PART 5 — API CHANGES

### 5.1 Endpoints inventory
| Endpoint | Status in P1-G |
|---|---|
| `api/qr.php` | **NEW** — necessary: no existing endpoint can issue or validate QR; `attendance.php` role gate (teacher/staff) must not be widened to students |
| `api/attendance.php` | **UNCHANGED** — still serves manual/id_scanner recording for teachers/staff |
| `api/teacher.php`, `exams.php`, `reports.php`, `student.php`, `parent.php`, `super_admin.php`, `login.php`, `logout.php` | **UNCHANGED** |

### 5.2 `api/qr.php` specification

**POST `api/qr.php?action=issue`** (teacher-facing)
| Aspect | Value |
|---|---|
| Request | JSON `{action:'issue', payload:{group_id:int}, csrf_token}` |
| Auth | session required → 401 otherwise |
| Role | `teacher`, `staff` (staff additionally `requirePermission('attendance')`) → 403 otherwise |
| CSRF | required (POST, existing validation) |
| Tenant validation | `teacher_id` = session `tenant_teacher_id` only |
| Ownership validation | `group_id` must satisfy `study_groups.teacher_id = session teacher` → 403 otherwise |
| Response 200 | `{success, qr_token, code, expires_at, ttl_seconds}` — no secret/HMAC internals |
| Errors | 401 unauth · 403 role/permission/ownership · 422 missing group · 503 secret not configured |

**POST `api/qr.php?action=scan`** (student-facing)
| Aspect | Value |
|---|---|
| Request | JSON `{action:'scan', payload:{token?:string, code?:string}, csrf_token}` |
| Auth | session required → 401 |
| Role | `student` only → 403 for any other role |
| CSRF | required |
| QR validation | HMAC (token path) → expiry → row lookup → revoked check → enrollment check → dedupe |
| Tenant validation | teacher/group come from the DB row; student enrollment verified against that pair |
| Response 200 | `{success, already_recorded:bool, message, student_name, group_name}` — no token/secret echoed |
| Errors | 400 malformed/empty · 403 invalid signature / expired / revoked / not enrolled · 401 unauth |

**Design rules applied:** responses never contain the secret, HMAC details, or other tenants' data; errors are generic ("رمز غير صالح أو منتهي") without distinguishing signature vs expiry vs revocation in ways that help an attacker enumerate; tokens are never logged.

---

## PART 6 — FRONTEND CHANGES (PLANNED)

**Principle: the frontend makes zero security decisions; it only displays, counts down, and submits.**

### 6.1 `assets/js/teacher.js`
- Replace the static screen (`teacher.js:306-314` + `:1025-1026`): remove `DYN-QR-992384-AUTO` and `DYNAMIC-QR-SCREEN-TOKEN` literals entirely.
- Group selector (teacher's own groups only) → "توليد كود الحضور" → POST issue → render:
  - real QR image encoding `qr_token` (see 6.3),
  - large `code` text,
  - **countdown** from `expires_at` (server timestamp authoritative; client only displays),
  - states: loading / active(countdown) / **expired** ("انتهت صلاحية الرمز — جدّد الكود") / error.
- Renew button (+ optional auto-renew ~45 s) → new issue call; old QR already revoked server-side.
- Scanner tab (`btn-submit-scan` fake alert): out of P1-G scope (id_scanner method) — flagged for a later phase; not removed.

### 6.2 `assets/js/student.js` (+ minimal route registration)
- New student surface for attendance submission (recommended: tab `/student/attendance` — **requires registering one route/tab in `app.js` validTabs + addRoute**, flagged as necessary dependency; router *architecture* untouched):
  - input for the displayed `code` (and/or pasted full token),
  - submit → POST scan (CSRF auto via ApiClient),
  - states: idle / submitting(loading, double-submit guard) / success ("تم تسجيل حضورك") / already-recorded / expired / invalid / network — all mapped status-aware (reuse P1-E/F patterns),
  - no client-side validity decisions — server response drives everything.
- `assets/js/api.js`: two new thin wrappers `issueAttendanceQr(groupId)` and `scanAttendanceQr(payload)` following the existing `request()` pattern.

### 6.3 QR encoding (real QR, vanilla JS, no libraries)
- `assets/js/qr-generator.js` currently draws a fake pattern. Plan: add a compact real QR encoder (byte-mode, ECC level L/M, versions ≤ 10) as a **new file** `assets/js/qr-encoder.js` + script tag in `index.html`, keeping `QrSvgGenerator` for legacy badge rendering until a later cleanup.
- Rationale: cPanel prohibits server-side QR libs without composer; a self-contained encoder avoids external CDNs. Manual-code entry (§6.2) is the day-one fallback so the feature never depends on camera decoding.
- Camera-based decoding is explicitly **out of scope** (would require a decoder library).

---

## PART 7 — SECURITY MODEL (SUMMARY)

| Requirement | Mechanism |
|---|---|
| Short configurable TTL | `QR_TTL_SECONDS = 60` constant; `expires_at` enforced server-side |
| Old QR auto-invalid | expiry check + revocation-on-regeneration (step 5 of issue) |
| Replay protection | per-student same-day dedupe (idempotent), revocation, 60 s TTL, session-bound student identity |
| HMAC verified backend-only | `hash_hmac` + `hash_equals` in `qr.php`; JS never sees the secret |
| No secret in JS | secret lives only in `config/db_credentials.php` |
| No frontend/sessionStorage trust | student_id/teacher_id/group_id all resolved server-side (session + DB row) |
| Teacher owns class/group | ownership check in issue (P1-B pattern) |
| Student allowed in group | `student_enrollments` check in scan |
| Tenant isolation | all identifiers resolved server-side; no client tenant input honored |
| Wrong role → 403 | `requireRole` gates on both actions |
| Unauthenticated → 401 | session check first |
| Invalid QR → 400/403 | malformed 400; signature/expired/revoked/not-enrolled 403 |
| Expired QR → clear rejection | 403 + "انتهت صلاحية الرمز" |
| Invalid signature → clear rejection | 403, generic wording |
| No secret leakage in responses/logs | responses whitelisted; tokens/secrets never logged |

---

## PART 8 — MIGRATION STRATEGY

1. **Deploy DB first:** run the `qr_tokens` DDL (additive, zero impact on existing tables).
2. **Add config key:** `qr_secret` in production `config/db_credentials.php` + update template.
3. **Deploy `api/qr.php`** (inert until frontend calls it).
4. **Deploy frontend** (`qr-encoder.js`, `index.html` tag, `api.js` wrappers, `teacher.js`, `student.js`, `app.js` tab registration).
5. Smoke-test on production (see §13) before announcing the feature.
Each step is independently rollback-safe (§16).

---

## PART 9 — BACKWARD COMPATIBILITY

- `DYN-QR-992384-AUTO` / `DYNAMIC-QR-SCREEN-TOKEN`: **removed from the UI during implementation**; they have no meaning to the new validator, so any residual submission of them is malformed → rejected (fail-closed). **No legacy acceptance window is recommended** — nothing real ever depended on them.
- `students.qr_code_token` column: untouched (used by badge rendering plans later); P1-G does not read or trust it. Recommendation (later phase): stop exposing it in `student.php:193`.
- `attendance.php` manual/id_scanner flows and all three `method` ENUM values: unchanged.
- Old recorded attendance rows: unaffected.

---

## PART 10 — TEST MATRIX (STATIC + SIMULATED; live execution later)

| # | Case | Expected | Layer |
|---|---|---|---|
| 1 | Valid QR within TTL, enrolled student | 200 recorded (method dynamic_qr) | simulated |
| 2 | Expired QR (TTL+1s) | 403 "انتهت الصلاحية" | simulated |
| 3 | Tampered HMAC/signature | 403 invalid | simulated |
| 4 | Modified `teacher_id` in payload | HMAC mismatch → 403 | simulated |
| 5 | Modified `group_id` in payload | HMAC mismatch → 403 | simulated |
| 6 | Modified `nonce` | HMAC mismatch / row miss → 403 | simulated |
| 7 | Wrong tenant (Teacher A row, Teacher B context) | impossible by construction (teacher_id from row/session); issue ownership → 403 | static |
| 8 | Wrong role (teacher/staff/parent calling scan) | 403 | static |
| 9 | Unauthenticated issue/scan | 401 | static |
| 10 | Replay: same student resubmits same token | idempotent 200 `already_recorded` (no duplicate row) | simulated |
| 11 | Old QR after regeneration | revoked row → 403 | simulated |
| 12 | Malformed QR string | 400 | simulated |
| 13 | Empty QR/code | 400 | simulated |
| 14 | Missing nonce | 400 | simulated |
| 15 | Missing expiry | 400 | simulated |
| 16 | Invalid/garbage timestamp | 400/403 | simulated |
| 17 | Teacher A QR issued, Teacher B tries to manage it | ownership gates → 403 | static |
| 18 | Student from another group of same teacher | enrollment check → 403 | simulated |
| 19 | Student from another teacher | enrollment check → 403 | simulated |
| 20 | Multiple simultaneous scans (20 students, same code) | all enrolled students recorded once each; dedupe prevents duplicates; race tolerated by app-check (UNIQUE flag = decision item) | simulated |
| Extra | Missing `qr_secret` in config | 503 fail-closed | simulated |
| Extra | CSRF missing on issue/scan | 403 | static |
| Extra | Code brute force | 8-char space + 60 s TTL + row lookup only → impractical; optional per-row attempt counter noted | analysis |

---

## PART 11 — PRODUCTION VERIFICATION PLAN (later, on live)

1. Teacher issues QR for an owned group → code + countdown visible; DB row exists, `token_hash` only.
2. Second issue → previous row `revoked=1`; old code rejected.
3. Enrolled student submits code → attendance row created (`method='dynamic_qr'`).
4. Same student resubmits → idempotent, no duplicate.
5. Non-enrolled student / other-tenant student → 403.
6. Wait TTL+ → code rejected as expired; UI shows expired state.
7. Student/teacher role swaps → 401/403 as matrix.
8. Verify responses/logs contain no secret/token internals.
9. Regression: manual attendance, login/logout, idle timeout, rate limit, reports/exams, routing — all unchanged.

---

## PART 12 — FILES

**To MODIFY (implementation phase only):**
- `assets/js/teacher.js` — dynamic QR screen (remove literals, issue/countdown/renew)
- `assets/js/student.js` — scan/submit surface
- `assets/js/app.js` — register the student attendance tab/route (dependency, additive)
- `assets/js/api.js` — two wrappers
- `index.html` — script tag for the encoder
- `database/schema.sql` — `qr_tokens` DDL (and template docs)
- `config/db_credentials.php.template` — document `qr_secret` key

**To CREATE:**
- `api/qr.php`
- `assets/js/qr-encoder.js`

**NOT TO TOUCH:**
- `config/auth.php`, `config/helper.php` (CORS), `api/login.php`, `api/logout.php`, `api/attendance.php`, `api/teacher.php`, `api/exams.php`, `api/reports.php`, `api/student.php`, `api/parent.php`, `api/super_admin.php`, `assets/js/router.js`, `.htaccess`, `assets/js/modal.js`, error-UI code, rate-limit code, idle-timeout code, all previous reports.
- Dependencies note: none of the protected systems need modification for P1-G; the single additive touch is the new student tab registration in `app.js` (routing *registration*, not architecture).

---

## PART 13 — RISK ASSESSMENT

| Risk | Likelihood | Mitigation |
|---|---|---|
| Hand-written QR encoder bugs | Medium | manual-code entry path is first-class; encoder unit-testable; worst case = QR image unreadable, code entry still works |
| Clock skew (server vs display) | Low | server timestamps authoritative; client only counts down from `expires_at` |
| `qr_secret` missing on production | Low | fail-closed 503 + deployment checklist step |
| Duplicate-row race under many scans | Low | app-level dedupe; optional UNIQUE constraint flagged as decision |
| Short-code brute force within TTL | Very low | 8-char unambiguous alphabet (~2.8e12), 60 s window, DB-hit cost; optional scan-attempt counter |
| Scope creep into attendance.php | Controlled | new endpoint isolates all P1-G logic |
| Shared-host timezone quirks | Low | use `time()` consistently; store `expires_at` computed from PHP time |

---

## PART 14 — ROLLBACK PLAN

1. Frontend rollback: revert the 5 frontend files + `index.html` → static dashboard returns exactly to pre-P1-G state (mock screen restored or left absent).
2. Backend rollback: delete `api/qr.php` — nothing else references it.
3. Data rollback: `DROP TABLE qr_tokens;` (additive table; no FKs from other tables into it).
4. Config rollback: remove `qr_secret` key.
No attendance history is affected by any rollback step.

---

## PART 15 — ESTIMATED IMPLEMENTATION STEPS (ordered)

| Step | Task | Complexity |
|---|---|---|
| 1 | `qr_tokens` DDL in schema.sql + migration SQL documented | S |
| 2 | `config/db_credentials.php.template` docs for `qr_secret` | XS |
| 3 | `api/qr.php` — issue action (auth/CSRF/ownership/revoke/HMAC/insert) | M |
| 4 | `api/qr.php` — scan action (parse/HMAC/expiry/revoked/enrollment/dedupe/insert) + cleanup | M |
| 5 | `assets/js/qr-encoder.js` real encoder + `index.html` tag | L |
| 6 | `assets/js/api.js` wrappers | XS |
| 7 | `teacher.js` — group select, issue call, QR+code display, countdown, renew, expired/error states | M |
| 8 | `student.js` + `app.js` tab — code/token submit UI with full state handling | M |
| 9 | Static tests (`node --check`, `git diff --check`, PHP lint where available) + simulated matrix | M |
| 10 | Production verification pass (§11) | — |

---

## PART 16 — FINAL OUTPUT SUMMARY

- **Current QR Architecture:** fully mock — client-side decorative SVG, hard-coded literals, no storage/validation/expiry; recording path trusts teacher session only.
- **Security Problems:** static forgeable token, infinite replay, no server validation, fake success alert, dead `qr_code_token` exposure, no dedupe (§2).
- **Recommended Architecture:** stateful `qr_tokens` + HMAC-SHA256 signed tokens + 60 s TTL + revocation-on-regeneration + session-bound identity + enrollment checks + idempotent dedupe (§3).
- **Database Changes:** one new `qr_tokens` table (proposed, not executed); optional attendance UNIQUE flag (§4).
- **API Changes:** one new `api/qr.php` (issue + scan); everything else unchanged (§5).
- **Frontend Changes:** teacher countdown/issue/renew screen; student submit surface; real JS QR encoder; two ApiClient wrappers (§6).
- **Security Model:** table in §7.
- **Migration Strategy:** DB → config → backend → frontend → verify (§8).
- **Backward Compatibility:** old literals removed and rejected fail-closed; no legacy window (§9).
- **Test Matrix:** 20+ cases (§10).
- **Production Verification Plan:** §11.
- **Files To Modify / Create / Not To Touch:** §12.
- **Risk Assessment:** §13 · **Rollback:** §14 · **Implementation Steps:** §15.

**THIS IS A PLAN ONLY — NO FILES WERE MODIFIED, CREATED (except this plan), OR DELETED. NO MIGRATION EXECUTED. NO CODE CHANGED.**

**STOP — P1-G implementation not started.**
