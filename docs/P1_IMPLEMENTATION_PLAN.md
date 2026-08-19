# P1_IMPLEMENTATION_PLAN

**Project:** kamal-solaiman/StudentsSystem — Unified Education Platform
**Phase:** P1 — DASHBOARD STABILIZATION & SECURITY AUDIT (AUDIT-ONLY; plan only)
**Date:** 2026-08-12 (Africa/Cairo) · **Branch:** `arena/019ff7b4-studentssystem`
**Production reference:** https://einshtein-store.online/110/ (Apache · cPanel shared hosting · PHP 8.3 · MySQL · Vanilla JS SPA)

> ⚠️ **Reconciliation note (important):** The user reports P0 remediation as completed (5/5). However, **this branch checkout still contains the pre-P0 code state**: hard-coded DB credential defaults in `config/database.php:21-23`, `test_negative_permissions.php` at the web root, the `123456` default student password (`api/teacher.php:280`), `all_platform_students` (`api/teacher.php:120,178`), and the shared seed hash (`database/seed.sql`). The P0 fixes were evidently applied outside this checkout (production/another branch). **P1 implementation must not start on this branch until it is synced with the P0-fixed state.** All analysis below describes the code exactly as it exists in this checkout.

---

## 1. Executive Summary

- Scope: plan the safest implementation order for the 8 deferred findings (R-1…R-8) plus the four dashboard-stabilization tasks (reports wiring, exams wiring, prompt/alert cleanup, supporting UX items).
- Key architectural conclusions:
  1. **CORS is NOT required** for the current same-origin `/110/` deployment. Headers exist but are inert for same-origin fetches. The correct fix is a strict whitelist + stop reflecting `Host` — not adding more CORS.
  2. **Idle timeout** can be enforced centrally in one method of `AuthManager` that every authenticated request already passes through. Recommended value: **60 minutes** (classroom-usage rationale in §4).
  3. **No existing DB table can safely host rate limiting**; a new small table is required (schema proposed, **not created**).
  4. The **Reports** and **Exams** teacher tabs are the only tabs not connected to their existing, working endpoints (`reports.php`, `exams.php`). Student/Parent dashboards already receive equivalent data inline.
  5. **`prompt()` is not used anywhere** in the project. There are 4 `alert()` calls and zero `confirm()` calls. A **reusable modal CSS pattern already exists** (`assets/css/qr.css` `.modal-*` classes) — a small modal JS helper reusing it is justified; no new modal system is needed.
  6. **Dynamic QR is fully mock/static** today (decorative SVG, fixed token). It is NOT wired to attendance recording, so replacing it later will not break existing manual/scanner attendance.
  7. Ownership gaps (R-8) are confined to `class_id` / `group_id` / `question_ids` in `teacher.php` POST and `exams.php` POST; every other client-supplied identifier is already ownership-validated.
  8. Cross-tenant student linking (R-7) is **an intentional platform feature** (Unified Student Account); only the *full-list disclosure* part is a security concern.
- No file was modified. Files Modified = **0** (§20).

---

## 2. Current Architecture (as of this checkout)

```
SPA (index.html, /110/) ──relative fetch──▶ api/*.php (same origin)
  app.js (router guards + backend probe per navigation)
  api.js (ApiClient: session cookie + X-CSRF-Token/body csrf_token)
  controllers: admin.js | teacher.js | student.js | parent.js

config/auth.php   AuthManager: session, CSRF, RBAC, rate limit, helpers
config/helper.php Helper: JSON I/O, CORS headers, sanitizers
config/database.php PDO (prepared statements, emulation off)
.htaccess         SPA fallback, config/database dir blocking, headers
```

- AuthN: PHP session (`UNIFIED_EDU_SESSION`), `session_regenerate_id(true)` on login, HttpOnly/SameSite=Lax cookies, full destruction on logout.
- AuthZ: `requireRole` (all 9 endpoints) → `requirePermission` for staff per-action → session-derived `tenant_teacher_id` for tenant isolation.
- CSRF: server token validated via `hash_equals` before every POST/DELETE mutation.
- Dashboard data model: one GET per role dashboard (`teacher.php`, `student.php`, `parent.php`, `super_admin.php`); tabs render from that single payload. **Write-side endpoints (`attendance.php`, `exams.php`, `reports.php`, `teacher.php` POST/DELETE) have no frontend callers yet** (functional defect carried from the functional audit).

---

## 3. CORS Analysis (R-1)

**CURRENT BEHAVIOR** (`config/helper.php:25-60` for origin selection; `:62-79` `sendJson`; `:119-133` `handleCorsOptions`):
- `getAllowedOrigin()` order: (a) `setAllowedOrigin()` override — **never called anywhere in the codebase**; (b) reflect `HTTP_ORIGIN` only if it exactly matches the static dev list (`http(s)://localhost`, `http(s)://127.0.0.1`, `http(s)://localhost:8080`); (c) otherwise build `scheme://HTTP_HOST` from the **Host header** (production path).
- Every API response additionally sends `Access-Control-Allow-Credentials: true`, methods `GET, POST, DELETE, OPTIONS`, headers incl. `X-CSRF-Token`, and `Vary: Origin`.
- Arbitrary origins are **not** reflected: unknown `Origin` values get an ACAO derived from `Host`, which won't match the attacker's origin, so credentialed cross-origin reads fail.

**SECURITY RISK** — LOW-to-MEDIUM in practice:
1. Host-header-derived ACAO + unconditional `Allow-Credentials: true` is a fragile pattern (host-header poisoning edge cases on misconfigured vhosts; opaque to reviewers).
2. The production origin `https://einshtein-store.online` is not explicitly whitelisted — it relies on Host reconstruction.
3. The dev localhost list ships to production.

**IS CORS ACTUALLY REQUIRED?** **No.** The SPA fetches relative paths (`api/...`) from the same origin; browsers do not apply CORS to same-origin requests. CORS would only matter if a different frontend host were introduced later. **Do not add CORS features; reduce and harden the existing headers.**

**RECOMMENDED IMPLEMENTATION**
- Replace Host-based derivation with an **explicit whitelist**: `https://einshtein-store.online` (production) + existing localhost dev entries (optionally gated by a debug flag).
- If request `Origin` is absent or not whitelisted → send **no** `Access-Control-Allow-*` headers at all (keep `Vary: Origin`).
- Keep the localhost dev origins so local development keeps working.
- Keep preflight (`OPTIONS`) handling identical otherwise.

**FILES / EXACT LOCATIONS**
- `config/helper.php` — `getAllowedOrigin()` lines 25-60 (rewrite selection logic); `sendJson()` lines 62-79 and `handleCorsOptions()` lines 119-133 (emit headers only when a whitelisted Origin matched).

**EXPECTED TESTS**
1. Same-origin fetch from `/110/` still succeeds (no behavior change).
2. `curl -H "Origin: https://evil.example"` → response has **no** ACAO header.
3. `curl -H "Origin: http://localhost"` (dev) → ACAO = `http://localhost`, `Vary: Origin` present.
4. Cross-origin XHR with credentials from a non-whitelisted origin cannot read the response (browser-level check).
5. Preflight OPTIONS still returns 200 for whitelisted origins only.

---

## 4. Idle Session Timeout Analysis (R-2)

**CURRENT BEHAVIOR**
- No `last_activity` exists anywhere (verified in `config/auth.php`).
- Session lifetime: cookie 86400s (`auth.php:22`); effective server-side lifetime additionally depends on host `session.gc_maxlifetime`.
- Every authenticated request already funnels through `AuthManager`: `requireRole()` (`auth.php:152`) / `requireAuth()` (`auth.php:166`) → `getCurrentUserOrFail()` (`auth.php:140`) → `getCurrentUser()` (`auth.php:120`) → `startSession()`.

**RISK** — sessions stay valid for the full cookie lifetime after inactivity; a session cookie leaked from an idle device remains usable.

**RECOMMENDED DESIGN**
- Add a single central method, e.g. `AuthManager::enforceIdleTimeout()`, invoked from `getCurrentUser()` (`auth.php:120-136`) — this is the safest single choke point because **all 9 API files** reach it via `requireRole`/`requireAuth`, and it runs before any role/permission logic.
- Mechanics: `$_SESSION['last_activity']` set at login (`loginUser`, `auth.php:32-66`) and refreshed on each authenticated request; if `time() - last_activity > IDLE_TIMEOUT` → call `AuthManager::logout()` and respond **401** (same shape as unauthenticated).
- Applies to **all authenticated API requests** (GET and POST) — uniform and predictable.
- Logout interaction: logout already destroys the session; the timeout is an additional destroyer. No conflict: a timed-out session simply fails `requireAuth` in `logout.php:15` with 401 (acceptable; frontend treats it as already logged out).
- Frontend reaction: existing machinery suffices — `api.js:69-76` clears CSRF on 401; the router probe (`app.js:185-199`) fails → cached role cleared → redirect to `/login`. P1-B (§13) gives this a proper "session expired" message instead of the misleading generic error.

**WHY 60 MINUTES (not 15/30):**
- The teacher dashboard is used **live in classrooms**: the dynamic-QR screen (`teacher.js:283-303`) is displayed for the duration of a lesson, and the SPA performs **no background polling** — API calls happen on navigation/actions only (probe per navigation, `app.js:204-221`). A 15–30 min idle timeout would routinely expire mid-lesson, and the teacher's next click (e.g., manual attendance) would fail with 401.
- 60 minutes covers a full class period plus breaks, while still bounding exposure far below today's 24h.
- Optional (later enhancement, not P1): a lightweight keep-alive probe every ~5 min while the tab is visible, which would permit shortening the idle value safely.

**FILES / EXACT LOCATIONS**
- `config/auth.php` — `getCurrentUser()` (120-136) enforcement hook; `loginUser()` (32-66) initialize `last_activity`; new constant near line 13-15.
- No API file changes needed (they all pass through the choke point).
- Frontend: none strictly required; P1-B improves the 401 message (`assets/js/app.js:349-364`, `assets/js/api.js:67-78`).

**TEST CASES**
1. Login → immediate request → 200 (baseline).
2. Simulate `last_activity` older than timeout → next request → 401; session destroyed (subsequent request with same cookie also 401).
3. Activity within window keeps session alive (rolling behavior).
4. Logout after timeout already fired → still graceful (401, no error loop).
5. All five roles experience identical behavior (choke-point coverage).
6. F5/Back/Forward after timeout → redirect to `/login` (frontend path).

---

## 5. Rate Limit Analysis (R-3)

**CURRENT BEHAVIOR** (`config/auth.php:312-385`, invoked at `api/login.php:24-31`)
- Counters stored in `$_SESSION['rate_limit_' . $email]` — **inside the attacker's own session**.
- Bypass: a fresh cookie jar per attempt starts a fresh counter; the 5-attempt/15-min limit is never reached. Cleared on success (`auth.php:355-362`).

**EXISTING-TABLE REUSE ASSESSMENT (as instructed, checked first)**
- `users` — identity table; no attempt/lock columns; adding columns = schema change and mixes throttling with identity. **Not safe to reuse.**
- `saas_settings`, `notifications`, `teacher_staff`, enrollment/attendance tables — semantically wrong; reuse would corrupt their meaning. **Not reusable.**
- **Conclusion: no existing table can safely be reused. A new table is required.** Schema below is a **proposal only — NOT created in this phase.**

**PROPOSED SCHEMA (do not create yet)**
```sql
CREATE TABLE IF NOT EXISTS `login_rate_limits` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `identifier`      VARCHAR(190) NOT NULL,              -- lowercased email
  `ip_hash`         CHAR(64)     NOT NULL,              -- hash(RemoteAddr + daily salt) for privacy
  `attempts`        INT UNSIGNED NOT NULL DEFAULT 1,
  `first_attempt_at` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_attempt_at`  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `locked_until`    DATETIME     NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_identifier` (`identifier`),
  KEY `idx_last_attempt` (`last_attempt_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

**RECOMMENDED DESIGN**
- Key: **primary key on normalized email** (account-lockout semantics); store `ip_hash` for monitoring/abuse review. IP+email compound limiting can be added later; email-keyed is the effective brute-force control.
- Window 15 min / max 5 attempts / lock 15 min → 429 with retry minutes (same response shape as today, `login.php:26-30`). Successful login resets the row.
- **Race conditions:** use a single atomic statement `INSERT INTO login_rate_limits (identifier, ip_hash) VALUES (:i,:h) ON DUPLICATE KEY UPDATE attempts = attempts + 1, last_attempt_at = NOW()` — InnoDB row locking handles concurrency; no application-level locks needed. Read-then-decide happens after the atomic increment.
- **Cleanup:** opportunistic purge inside the same code path, probabilistic (e.g., ~1% of checks): `DELETE FROM login_rate_limits WHERE last_attempt_at < NOW() - INTERVAL 1 DAY` — no cron available on typical cPanel accounts, so piggy-backing is the shared-hosting-compatible pattern.
- **IP source:** `$_SERVER['REMOTE_ADDR']` (reliable on cPanel shared hosting; do not trust `X-Forwarded-For` unless the proxy is known).
- Session-based counters are removed entirely (no dual system).

**FILES / EXACT LOCATIONS**
- `config/auth.php` — replace `checkRateLimit` (312-347), `clearRateLimit` (355-362), `getRateLimitRemaining` (365-385) with DB-backed equivalents.
- `api/login.php` — call sites unchanged in shape (`login.php:24-31`); success-clear call at `:65` region.
- `database/schema.sql` — add table definition (only when approved).

**EXPECTED TESTS**
1. 5 wrong passwords → 6th returns 429 even with fresh cookies each time.
2. Correct password after lock → still 429 until window ends (lock semantics) — or immediate unlock if reset-on-success policy chosen (decide explicitly).
3. Concurrent attempts (parallel curl) → counter never under/over-counts (atomicity).
4. Two different emails don't share counters.
5. Purge removes rows older than 24h.

---

## 6. Reports Analysis

Endpoint: `api/reports.php` GET — complete and working server-side: 7 reports (students, attendance summary+records, exams, grades, payments, groups, classes), all scoped by session `teacher_id`; staff needs `reports` permission; super_admin 403 (`reports.php:11-32`).

| TAB | ROLE | CURRENT UI | CURRENT API | CURRENT STATUS | MISSING CONNECTION | RECOMMENDED CONNECTION |
|---|---|---|---|---|---|---|
| `/teacher/reports` (tab 7) | teacher / staff | 3 static stat cards numbered "1, 2, 5" computed from `teacher.php` payload; card 2 shows `today_attendance \|\| 1` (misleading) — `teacher.js:388-412` | **none** (`reports.php` never called; `ApiClient.getReportsData` in `api.js:147-152` is dead code) | **MOCK** | Fetch + render of the 7 real reports | On activation of tab `reports`, call `getReportsData()` and render the 7 sections; remove `\|\| 1` |
| Student dashboards | student | attendance/exams/homeworks rendered from `student.php` inline payload (`student.js:139-217`) | `student.php` GET | CONNECTED (inline equivalent) | none | none |
| Parent dashboards | parent | attendance report/exams/homeworks from `parent.php` inline payload (`parent.js:108-219`) | `parent.php` GET | CONNECTED (inline equivalent) | none | none |

Notes: teacher dashboard caches its payload in `controllerInstance` (`app.js:391-394`), so the reports tab must perform its **own** fetch rather than rely on cached data. No API contract change is needed.

---

## 7. Exams Analysis

Endpoint: `api/exams.php` — GET returns question bank + exams for session teacher (`exams.php:44-82`); POST `create_question` (`:92-119`) and `create_exam` (`:122-173`); staff permission `exams`; CSRF on POST; super_admin 403.

| Part | State | Evidence |
|---|---|---|
| Teacher tab `/teacher/exams` rendering | **DISCONNECTED** — reads `this.data.questions` which `teacher.php` GET never returns → question table **always empty**; the exams list (`data.exams`, present in payload) is never rendered at all | `teacher.js:343` |
| GET wiring | Missing — `exams.php` GET has no frontend caller; no wrapper for it exists in `api.js` | grep: zero callers |
| POST wiring | Missing — `ApiClient.createExam/createQuestion` (`api.js:139-145`) defined but never called | grep: zero callers |
| Buttons | `#open-qb-modal` ("+ إضافة سؤال للبنك") is **dead** (`teacher.js:367`, no handler in `:486-522`); **no** "create exam" button exists anywhere | code inspection |
| Routes | `/teacher/exams` registered and guarded (`app.js:104-110`) — route layer fine | — |
| Student/Parent exam views | CONNECTED via inline payloads (`student.js:180-217`, `parent.js:186-219`) | — |
| `prompt()` usage | **None in project** (§8) | grep |
| Modal infrastructure | **Reusable CSS exists**: `.modal-backdrop/.modal-content/.modal-header/.modal-title/.modal-close/.modal-body` in `assets/css/qr.css:5-56`; no modal JS/markup exists yet → a minimal helper reusing these classes is the correct pattern (not a new modal system) | `qr.css` |

Recommended connection (later implementation): tab activation → GET `exams.php` → render question bank + exam list; dead button + a new "create exam" action open modals built on the existing `.modal-*` CSS → POST `exams.php` with existing CSRF mechanism.

---

## 8. Prompt Usage Analysis

Full-project search results:

| Pattern | Count | Occurrences |
|---|---|---|
| `prompt(` | **0** | — none anywhere |
| `confirm(` | **0** | — |
| `alert(` | **4** | below |

| FILE | LINE | PURPOSE | ROLE | CURRENT BEHAVIOR | RECOMMENDED UI |
|---|---|---|---|---|---|
| `assets/js/admin.js` | 142 | SaaS settings save success | super_admin | Blocking alert after successful POST | Inline success banner in the settings card |
| `assets/js/admin.js` | 145 | SaaS settings save failure | super_admin | Blocking alert with raw `error.message` | Inline error banner; generic text (server messages sanitized per M-1) |
| `assets/js/app.js` | 328 | Logout failure | all | Blocking alert | Inline notice near logout button / toast area |
| `assets/js/teacher.js` | 519 | Scanner "attendance recorded" | teacher/staff | **Fake success — no API call at all** (functional defect F-1 from earlier audit) | Real POST to `attendance.php`; success/error rendered inline in the attendance tab |

**Reusable pattern determination:** the project's only modal assets are the CSS classes in `qr.css` (§7). Five dead "open-*-modal" buttons already assume modals (`teacher.js:140,190,238,367,434`). Therefore: **reuse the existing `.modal-*` CSS with one small shared JS open/close helper** — this is reusing an existing pattern, not inventing a new system. Destructive actions (future delete wiring) additionally need a confirmation step via the same modal pattern (no `confirm()` exists today).

---

## 9. QR Security Analysis (R-6)

**CURRENT FLOW (fully traced)**
- `assets/js/qr-generator.js` — `QrSvgGenerator.renderSvg(text,size)` produces a **decorative deterministic pattern** from a JS string hash; it is not a real QR encoding and cannot be scanned by phones/scanners.
- Teacher "dynamic QR" screen: renders `renderSvg('DYNAMIC-QR-SCREEN-TOKEN')` with a hard-coded display token `TOKEN: DYN-QR-992384-AUTO` (`teacher.js:295-303`, `:510-512`). **Static; never changes; not verified server-side.**
- Student/teacher badge buttons render `renderSvg(student_code)` — the `students.qr_code_token` column exists (`database/schema.sql` students table) and is returned by `api/student.php:193`, but **no code validates it anywhere**.
- Attendance recording (`api/attendance.php`) accepts `student_id` or `student_code` and a `method` label (`dynamic_qr|id_scanner|manual`); the `method` value is **only a stored label** — there is no server-side QR verification, no expiration, no nonce/timestamp, no signature.
- **Replay:** trivially replayable — codes/tokens are static. Today this is latent because the QR path is not wired to recording (the scanner button fakes success, `teacher.js:515-521`); the real credential in use would be the static `student_code`.

**IMPACT ON EXISTING ATTENDANCE FUNCTIONALITY:** none — manual recording (when wired) and `student_code` scanning do not depend on the QR mechanism. Replacing the mock QR later touches only the `dynamic_qr` method path.

**SAFE RECOMMENDED DESIGN (for a later dedicated phase — NOT to be implemented in P1)**
1. Server endpoint issues a short-lived signed token: `HMAC-SHA256(server_secret, teacher_id|timestamp|nonce)` with TTL ≤ 60s; screen polls/rotates every ~20s.
2. QR encodes the signed token; scan submission sends token + student identifier; server verifies signature, TTL, teacher match, and enrollment before inserting attendance.
3. `server_secret` stored in `config/db_credentials.php` (outside web access via `.htaccess`) or an equivalent non-public config — no new infrastructure needed.
4. Keep `student_code`-based ID scanning as a separate method; plan its own upgrade path (static codes are shared secrets) but do not couple it to dynamic QR work.
5. Remove hard-coded tokens/literals from `teacher.js` when implementing.

---

## 10. Ownership / IDOR Analysis (R-8)

Complete review of every client-supplied identifier:

| FILE | LINE | INPUT | CURRENT VALIDATION | RISK | RECOMMENDED VALIDATION |
|---|---|---|---|---|---|
| `api/teacher.php` | 231-256 (`create_group`) | `payload.class_id` | none — inserted with session `teacher_id` | Cross-tenant FK: group pointing at another teacher's class; joins leak names | `SELECT 1 FROM academic_classes WHERE id=:cid AND teacher_id=:tid` before insert; reject 403 |
| `api/teacher.php` | 264-320 (`create_student`) | `payload.group_id`, `payload.class_id` | none | same as above | ownership check for both against session tenant |
| `api/teacher.php` | 323-339 (`enroll_existing_student`) | `payload.student_id`, `group_id`, `class_id` | none; no duplicate check | cross-tenant group/class references; duplicate enrollments | group/class ownership check + existing-enrollment check (student_id itself is platform-shared by design — §11) |
| `api/exams.php` | 104-117 (`create_question`) | `payload.class_id` | none | cross-tenant class reference | ownership check |
| `api/exams.php` | 122-173 (`create_exam`) | `payload.class_id`, `group_id`, `question_ids[]` | none | cross-tenant class/group refs; **linking another teacher's questions into own exam** (`exam_questions`) | ownership checks for class/group; `question_ids` must satisfy `teacher_id = :tid` (filter or reject) |
| `api/teacher.php` | 366-392 (DELETE) | `$_GET[id]` | ✅ `AND teacher_id = :tid` | — | already safe |
| `api/attendance.php` | 71-93 | `student_id` / `student_code` | ✅ enrollment check vs session teacher | — | already safe |
| `api/student.php` | 22-81 | `$_GET[student_id]` | ✅ per-role ownership checks | residual `parent_phone` fallback (known M-4) | already safe for R-8 scope |
| `api/parent.php` | 38,84 | `parent_id`, `student_id` | ✅ relationship checks | residual phone fallback | already safe for R-8 scope |
| `api/super_admin.php` | — | no ID inputs | — | — | safe |
| all files | — | `teacher_id` | never accepted from request (session-derived) | — | safe |

**Properties of the fix:** backend-only tightening, no API contract change (same endpoints, same payloads; invalid IDs now get 403/404 instead of silently inserting cross-tenant references), zero frontend impact.

---

## 11. Cross-Tenant Analysis (R-7 — `name`/student linking)

**Verdict: the linking itself is intentional platform behavior; the disclosure is the problem.**

- The platform's core design is the **Unified Student Account**: `students` is a global table; `student_enrollments` links one student to many teachers (schema header comment; seed shows student #1 enrolled with teachers #1 **and** #2 — `database/seed.sql` enrollments 1-2). Enrolling an *existing* student (`enroll_existing_student`, `teacher.php:323-339`) is a legitimate, designed teacher action.
- What is **not** acceptable: `teacher.php:120` returns **every student on the platform** (`id, student_code, name, phone, grade_level`) to every teacher/staff as `all_platform_students` — and the current UI never even consumes it (dead payload, `teacher.js` has no reference). This is information disclosure beyond the feature's need.
- Business/security implications:
  - Keeping the full list: every tenant can harvest competitor client lists (names + phones) → privacy/compliance exposure; no functional benefit today.
  - Removing it without replacement: breaks the intended "link existing student" workflow when UI gets built.
- **Recommended direction (implementation later):** replace the full list with an explicit **search** flow (by student code or name, minimum fields, no phone, result-capped), plus ownership checks from §10 on the enrollment itself. Until then, the cheapest safe step is to stop returning the list.

---

## 12. Staff UI Analysis (R-7 LOW)

- **What staff sees today:** the complete teacher dashboard — all 9 tabs and all action buttons (add/delete class/group, add student, settings, staff) regardless of individual permissions; `teacher.php` GET requires only *at least one* permission (`teacher.php:16-22`).
- **What staff may actually do:** only actions whose permission exists in `teacher_staff.permissions` — enforced server-side per action (`teacher.php:200-213` POST, `:369-374` DELETE, plus `attendance.php:20`, `exams.php:15`, `reports.php:15`, `parent.php:15`, `student.php:15`).
- **Does visibility match backend permissions?** No — the UI over-exposes capabilities; unauthorized attempts would die with 403 (which the current error UI mislabels, §13).
- **Security vs UX:** hiding/showing buttons is **purely UX** — the backend is authoritative and no bypass exists through visibility. That is exactly why this was classified LOW. Two supporting facts: (a) the buttons are currently *dead* anyway (functional defect), so there is no live mismatch to exploit; (b) `getStaffPermissions()` exists (`auth.php:278-302`) but the GET response does not expose the *current* user's permissions to the frontend — an additive `my_permissions` field would enable correct visibility with no contract break.
- **Recommended sequence:** wire buttons first (exams/reports/deletes), then add `my_permissions` to `teacher.php` GET, then hide/disable non-permitted controls.

---

## 13. Error UI Analysis (R-4)

**Why the title is misleading:** `renderError` (`assets/js/app.js:349-364`) hard-codes the heading **"تعذر الاتصال بالخادم"** for every failure — including 401/403/404/422/500 and JSON parse errors. The server's message is shown as body text, but the heading asserts a connectivity failure. Additionally, `api.js:77` builds `Error(data.message || data.error || 'Server error: ' + status)` — **the numeric status is lost** from the error object whenever a message exists, so the UI layer cannot distinguish cases even if it wanted to.

**Recommended mapping (no security impact; frontend-only):**

| Condition | Title | Body |
|---|---|---|
| `TypeError`/network failure (fetch rejected) | تعذر الاتصال بالخادم | تحقق من الاتصال بالإنترنت |
| 401 | انتهت الجلسة | يرجى تسجيل الدخول مجددًا (+ redirect to `/login`) |
| 403 | غير مصرح بهذا الإجراء | server message |
| 404 | البيانات غير موجودة | server message |
| 422 | بيانات غير صالحة | server validation message |
| 429 | محاولات كثيرة | retry hint |
| 500 / other | حدث خطأ في الخادم | generic (never raw internals) |

**Mechanism:** attach `status` to the thrown error in `api.js` (`err.status = response.status`), keep message as-is; `renderError` branches on `error.status`. Also covers the idle-timeout 401 UX (dependency for P1-E).

---

## 14. Empty State Analysis (R-5)

Existing screens lacking empty states (empty `<tbody>`/empty grids rendered silently):

| Dashboard | Screens affected | Evidence |
|---|---|---|
| Teacher | classes, groups, students, question bank, staff list, manual-attendance table | `teacher.js` renderClasses/renderGroups/renderStudents/renderExams/renderStaff/renderAttendance |
| Student | schedule, homeworks, exams, lessons, subscriptions | `student.js:103-262` |
| Parent | homeworks, attendance records, exams, teachers grid | `parent.js:108-243` |
| Super Admin | teachers table | `admin.js:18-35` |

Notes: `parent.php` already returns a well-formed empty payload (`parent.php:98-117`) — the backend anticipates empty states the frontend never renders. Hard-coded placeholder texts in student overview (`student.js:71-84`) and parent overview (`parent.js:97-104`) are the inverse problem (static text where data could exist). Recommendation: one shared empty-state row/card snippet reused by all controllers (copy-based, matching the existing no-framework style); compute real values for the static cards. No redesign.

---

## 15. Recommended Priority Order

| # | Priority | Finding/Task | Reason | Files | Est. complexity | Security impact | Regression risk | Dependencies | Testing requirements |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **P1-A** | R-1 CORS whitelist + remove Host reflection | Smallest security hardening; zero functional coupling | `config/helper.php` (25-60, 62-79, 119-133) | S | Medium (defense-in-depth) | Very low — same-origin fetches unaffected | none | CORS curl matrix (§3) + full role smoke test |
| 2 | **P1-B** | R-4 error UI status mapping | Unblocks correct 401/403 UX for everything after it | `assets/js/api.js` (67-78), `assets/js/app.js` (349-364) | S | Low (clarity, less misleading) | Low | none | induce each status; verify titles; network-off test |
| 3 | **P1-C** | R-8 ownership validation (class/group/question) | Pure backend tightening of existing endpoints; no contract change | `api/teacher.php` (231-256, 264-320, 323-339), `api/exams.php` (104-117, 122-173) | M | **High** (closes cross-tenant IDOR class) | Low — valid flows unchanged | none | positive create flows + forged-ID negatives (403) |
| 4 | **P1-D** | R-3 DB-backed rate limiting | Removes brute-force gap; needs new table (approval gate) | `config/auth.php` (312-385), `api/login.php` (24-31), `database/schema.sql` | M | **High** | Low-medium (login path) | schema approval + branch sync w/ P0 | §5 test suite incl. concurrency |
| 5 | **P1-E** | R-2 idle timeout (60 min) | Central choke point; depends on P1-B for proper 401 UX | `config/auth.php` (120-136, 32-66, constants) | S-M | Medium | Low-medium (all authenticated calls) | P1-B | §4 test cases incl. classroom-duration simulation |
| 6 | **P1-F** | Reports tab wiring | Small, self-contained, uses existing endpoint | `assets/js/teacher.js` (renderReports 388-412 + listeners), `assets/js/api.js` (getReportsData 147-152) | S | None | Low | P1-B | tab renders 7 reports; staff-permission negative; empty data case |
| 7 | **P1-G** | Exams tab wiring (GET + create question/exam via modal) | Largest stabilization item; needs modal helper on existing CSS | `assets/js/teacher.js` (renderExams 340-385, listeners 486-522), `assets/js/api.js` (new GET wrapper + existing POST wrappers 139-145), `assets/css/qr.css` reuse | L | None (CSRF/ownership already server-side; P1-C applied) | Medium | P1-B, P1-C, modal helper | GET renders bank+exams; create flows persist; CSRF negative; staff `exams`-permission negative |
| 8 | **P1-H** | R-5 empty states (+ de-static overview cards) | Polish after new data flows exist so they cover new screens too | all four controllers + `student.js:71-84`, `parent.js:97-104` | S-M | None | Very low | P1-F, P1-G (order only) | each list with 0 rows shows the empty state |
| 9 | **P1-I** | R-7-LOW staff button visibility | UX alignment after buttons are live | `api/teacher.php` GET (additive `my_permissions`), `assets/js/teacher.js` | S-M | None (backend remains authority) | Low | P1-G, `getStaffPermissions` exists (`auth.php:278-302`) | staff with subset sees only permitted actions; unauthorized still 403 if forced |
| 10 | **P1-J** | R-7-MED cross-tenant list removal/search | Contract-affecting; pair with enrollment UX decision | `api/teacher.php` (120, 178) + future search endpoint | M | **High** (PII disclosure) | Medium (future enroll flow) | product decision on search UX | no full list in response; search returns minimal fields only |
| 11 | **P1-K** | R-6 dynamic QR signed-token (design implemented as separate phase) | Largest; touches attendance semantics; keep out of P1 implementation | new token endpoint + `teacher.js` QR screen + `attendance.php` verify path | L-XL | High (when implemented) | Medium | secret storage decision; P1-G not required | signature/expiry/replay matrix; teacher mismatch negative |

**Explicitly out of P1 implementation:** real QR encoding library choice, attendance scanner hardware integration, keep-alive heartbeat, permission-management UI.

---

## 16. Dependency Map

```
P1-A (CORS)                 — independent, do first
P1-B (Error UI) ────────────┬─▶ P1-E (Idle timeout: proper 401 UX)
                            ├─▶ P1-F (Reports: error path)
                            └─▶ P1-G (Exams: error paths)
P1-C (Ownership) ────────────▶ P1-G (create_exam/question safe to wire)
P1-D (Rate limit)           — independent; gated by DB table approval
P1-F (Reports)              — independent after P1-B
P1-G (Exams + modal helper) — after P1-B + P1-C
P1-H (Empty states)         — after P1-F/P1-G (coverage ordering only)
P1-I (Staff visibility)     — after P1-G (buttons must exist to hide)
P1-J (Cross-tenant list)    — gated by product decision; independent technically
P1-K (Dynamic QR)           — separate future phase; needs secret-storage decision
GLOBAL GATE                 — sync branch with P0-fixed state before ANY of the above
```

---

## 17. Testing Strategy

**Classification rule (carried from prior phases):** STATIC VERIFIED ≠ SIMULATED ≠ LIVE PRODUCTION VERIFIED. Every P1 item must record which level each check reached; no live claim without a real browser test on https://einshtein-store.online/110/.

1. **Regression suite (run after every item):** login for all 5 roles → correct dashboard; F5 on each tab; Back/Forward; logout + post-logout protected URL → redirect; CSRF-negative POST → 403; wrong-role API calls → 403.
2. **Item-specific suites:** defined per section (§3, §4, §5, §10 negatives, §13 status matrix, empty-state sweep).
3. **Negative/permission matrix:** reuse the PHASE 2.1 approach (`test_negative_permissions.php` pattern) but execute against a staging copy — note that script must NOT be present on the production web root (P0 item).
4. **Data safety checks** for P1-C/P1-J: verify no rows created with foreign `group_id`/`class_id`; verify enrollment integrity counts unchanged for valid flows.
5. **Browser matrix for UX items:** Chrome + one mobile browser (RTL layout), since modals/empty states are visual.

---

## 18. Production Deployment Considerations

Environment: Apache + cPanel shared hosting, PHP 8.3, MySQL, vanilla JS, SPA under `/110/` (`RewriteBase /110/`, `.htaccess`).

- **No external infrastructure required** by anything in this plan: no Node.js, no Redis, no Docker, no workers/queues. Rate limiting uses MySQL only; idle timeout uses the PHP session; QR signing (future) uses an HMAC secret in the existing non-public config file.
- **DB changes:** exactly one proposed (the `login_rate_limits` table, P1-D) — requires explicit approval and a manual SQL run via cPanel/phpMyAdmin; schema.sql updated for consistency.
- **Deployment mechanics:** file upload of changed files; `.htaccess` untouched by all P1 items (CORS changes live in PHP, not Apache headers).
- **Shared-hosting caveats:** `session.gc_maxlifetime` may prune idle sessions earlier than the chosen timeout (harmless — same effect); opportunistic purge replaces cron (§5); use `REMOTE_ADDR` not forwarded headers (§5).
- **Cache/busting:** static JS/CSS are uploaded raw; instruct a hard refresh on release day (no build pipeline exists).
- **Rollback:** every item is file-scoped; rollback = re-upload previous file versions; the new DB table is additive and safe to leave in place.

---

## 19. Files Reviewed (this phase)

`config/auth.php`, `config/database.php`, `config/helper.php`, `config/db_credentials.php.template`, `api/login.php`, `api/logout.php`, `api/teacher.php`, `api/attendance.php`, `api/exams.php`, `api/reports.php`, `api/student.php`, `api/parent.php`, `api/super_admin.php`, `assets/js/app.js`, `assets/js/router.js`, `assets/js/api.js`, `assets/js/admin.js`, `assets/js/teacher.js`, `assets/js/student.js`, `assets/js/parent.js`, `assets/js/landing.js`, `assets/js/qr-generator.js`, `assets/css/qr.css`, `index.html`, `.htaccess`, `.gitignore`, `database/schema.sql`, `database/seed.sql`, `test_negative_permissions.php`, `README.md` — **30 files**.

## 20. Files Modified

**0.** No code, UI, database, configuration, or contract was changed. This plan document (`P1_IMPLEMENTATION_PLAN.md`) is the sole deliverable, created as explicitly required by this phase.

---

**PLAN COMPLETE — AUDIT ONLY. NO IMPLEMENTATION STARTED.**
