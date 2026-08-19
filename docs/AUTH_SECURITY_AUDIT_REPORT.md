# AUTH_SECURITY_AUDIT_REPORT

**Project:** kamal-solaiman/StudentsSystem (Unified Education Platform — PHP 8.3 native + Vanilla JS SPA)
**Phase:** AUTHENTICATION & AUTHORIZATION FULL PRODUCTION AUDIT
**Audit date:** 2026-08-12 (Africa/Cairo)
**Branch:** `arena/019ff7b4-studentssystem`
**Mode:** STATIC + ARCHITECTURAL AUDIT ONLY — no code executed against Production by the auditor
**Production URL (reference only):** https://einshtein-store.online/110/

> **ملخص تنفيذي (عربي):** تدقيق كامل لسلسلة المصادقة والتفويض للأدوار الخمسة. معماريًا النظام سليم: الخادم هو الحاكم النهائي، عزل المستأجرين قائم على `teacher_id` من الجلسة، CSRF مفروض على كل العمليات المُغيِّرة، وحماية Session Fixation موجودة. لا توجد ثغرات **جديدة** في طبقة المصادقة/التفويض نفسها، لكن بنودًا حرجة/عالية مُرحَّلة من تدقيقات سابقة ما زالت قائمة (بيانات DB في مستودع عام، Stored XSS، Rate Limit قابل للتجاوز، كلمات مرور افتراضية ضعيفة). التفاصيل الكاملة أدناه.

---

## 1. Executive Summary

| Area | Verdict |
|---|---|
| Login / session creation / fixation protection | ✅ Sound (STATIC VERIFIED) |
| Role resolution chain (DB → session → API → frontend → router) | ✅ Exact role strings preserved end-to-end; no unsafe conversion (STATIC VERIFIED) |
| Route authorization (frontend guards) | ✅ UX layer only; backend re-authorizes every request (STATIC VERIFIED) |
| API authorization (backend) | ✅ Every endpoint gates on `requireRole` before any logic (STATIC VERIFIED) |
| Super Admin isolation (both directions) | ✅ Enforced on all 7 tenant endpoints + `super_admin.php` exclusive (STATIC VERIFIED) |
| CSRF on state-changing operations | ✅ Validated before business logic on every POST/DELETE (STATIC VERIFIED) |
| Session flags & destruction | ✅ HttpOnly + SameSite=Lax + Secure-on-HTTPS; full destruction on logout (STATIC VERIFIED) |
| Tenant isolation (IDOR) | 🟡 Core paths safe; 4 residual cross-tenant gaps carried from prior audits (M-2, M-3, M-4, H-6) |
| Brute-force protection | 🔴 Session-based rate limit is trivially bypassable (HIGH) |
| Secrets in repo | 🔴 Production DB credentials committed to a **public** repo (CRITICAL, carried) |
| XSS surface affecting auth artifacts | 🔴 Stored XSS path + CSRF token in `sessionStorage` (HIGH, carried) |

**Bottom line:** the authentication/authorization *architecture* is correct and the five roles are properly isolated. The outstanding risks are carried findings from earlier audits (secrets, XSS, rate limiting, weak default passwords) — not new auth-layer defects.

---

## 2. Authentication Audit

### 2.1 Login flow (`api/login.php`, 92 lines)
1. POST-only gate — `login.php:10-12` (405 otherwise).
2. JSON body parse; email passed through `Helper::sanitizeString` — `login.php:15-16` (note finding L-1).
3. Empty-field check → 422 — `login.php:19-21`.
4. Session-based rate limit check → 429 — `login.php:24-31` (see finding H-2).
5. Prepared lookup with LEFT JOINs to `teachers` / `teacher_staff` — `login.php:35-44`.
6. Unknown email → generic 401 "Invalid credentials" (no enumeration in message) — `login.php:49-51`.
7. Staff tenant fix-up: `staff_teacher_id` overrides `teacher_id` — `login.php:54-57`.
8. `password_verify` against `password_hash` (bcrypt) — `login.php:58`; failure → generic 401 — `login.php:60-62`.
9. `AuthManager::loginUser()` — `login.php:65` (details in §9).
10. Response: explicit field whitelist (`id,name,email,role,phone,teacher_id,avatar`) + `csrf_token` — `login.php:70-84`. **`password_hash` never leaves the server** even though `SELECT u.*` fetched it.
11. `catch (Throwable)` → generic 500 with no internals — `login.php:86-91` (the only endpoint doing this correctly).

### 2.2 Session creation (`config/auth.php:17-30`)
- Custom name `UNIFIED_EDU_SESSION`; `lifetime=86400`, `path=/`, `httponly=true`, `samesite=Lax`, `secure` derived from `$_SERVER['HTTPS']` (finding M-6 behind TLS-terminating proxies).

### 2.3 `session_regenerate_id(true)` — `auth.php:37`
Called inside `loginUser()` immediately after credential success → classic session-fixation protection. No regeneration on privilege change (none exists) or periodic rotation (finding L-9/INFO).

### 2.4 Session expiration behavior
- Cookie lifetime 24h (`auth.php:22`). No server-side idle or absolute timeout; effective server lifetime additionally depends on host `session.gc_maxlifetime` (default 1440s) — finding M-5.

### 2.5 `AuthManager::requireAuth()` — `auth.php:166-170`
Delegates to `getCurrentUserOrFail()` (`auth.php:140-149`): missing `user_id` → 401 JSON and `exit`. Used by `logout.php:15`.

### 2.6 `AuthManager::logout()` — `auth.php:477-494`
`$_SESSION = []` → cookie expired at `time()-42000` with original path/domain/secure/httponly → `session_destroy()`. Complete server-side termination.

### 2.7 Login failure / invalid credentials
- Uniform 401 message for unknown email and wrong password (`login.php:50,61`). Minor timing delta (no dummy hash for unknown users) — finding L-3.
- Rate-limit 429 returns retry minutes (`login.php:26-30`).

### 2.8 Already-authenticated user behavior
- No `/me` endpoint exists. Re-login while authenticated silently replaces session fields and rotates ID/CSRF (`loginUser`) — acceptable.
- Frontend: authenticated visit to `/login` redirects to role dashboard (`app.js:61-63`).

### 2.9 CSRF token generation/validation
- Generation: `bin2hex(random_bytes(32))` + timestamp, stored server-side — `auth.php:70-79`.
- `getCsrfToken()` hourly rotation branch — `auth.php:82-97` — is **only reachable from `login.php`**, so tokens are effectively static per session (finding M-7).
- Validation: null/empty → false; `hash_equals` comparison — `auth.php:100-110`.

### 2.10 Rate limiting — `auth.php:312-385`
Counter keyed by email **inside the caller's own session** (5 attempts / 15 min, cleared on success). Bypassable with fresh cookies per attempt — finding **H-2**.

### 2.11 Session cleanup
- Logout (server) + frontend cleanup (`app.js:577-630`: clears `csrf_token`, `user_role`, in-memory state) — see §11.

---

## 3. Role Resolution Audit

Traced end-to-end for the five exact values `super_admin | teacher | staff | student | parent`:

```
users.role ENUM('super_admin','teacher','staff','student','parent')  [schema.sql:16]
  → login.php SELECT u.* … WHERE email = :email                      [login.php:36-44]
  → AuthManager::loginUser: $_SESSION['role'] = (string)$userRow['role'] [auth.php:42]
  → getCurrentUser(): 'role' => (string)$_SESSION['role']            [auth.php:131]
  → login response: 'role' => (string)$user['role']                  [login.php:78]
  → handleLogin: _setCachedRole(String(response.user.role))          [app.js:~559, 226-233]
  → sessionStorage['user_role'] (UX hint only)                       [app.js:226-233]
  → beforeEach guard: _resolveRole() + backend probe per navigation  [app.js:52-83, 171-221]
  → getDashboardRouteForRole(role) switch (exact strings)            [app.js:153-166]
  → Dashboard controller rendered; every API re-checks $_SESSION role server-side
```

Checks performed:
- **Hard-coded roles:** only route `meta` arrays (`app.js:101-137`), the dashboard switch (`app.js:153-166`), the probe switch (`app.js:207-215`), and backend `requireRole` arrays — all use the exact five strings. No typos/aliases found.
- **Role aliases:** exactly one, intentional and mirrored by backend policy — `teacher ↔ staff` share the teacher dashboard (`app.js:70`); backend still enforces per-action staff permissions (`teacher.php:200-213`, `auth.php:182-215`).
- **Accidental conversion:** none. Role is string-cast at every hop; DB ENUM constrains source values.
- **Missing/default/fallback roles:** `getDashboardRouteForRole` default returns `'/'` (landing), never invents a role (`app.js:163-164`). `requireRole` fails closed with 403 for any unlisted role (`auth.php:152-163`). `isAuthenticated()` requires BOTH `user_id` and `role` (`auth.php:117`).
- **Unsafe assumptions:** role is never parsed from client input on the server. The client-side `user_role` can only select which endpoint to *probe*; the server decides.

**Verdict: STATIC VERIFIED — role values preserved exactly; no spoofable role source.**

---

## 4. Authorization Matrix (Routes)

Expected vs actual (frontend layer — UX only):

| Role | Allowed dashboard (expected) | Actual route registration | Guard meta | Result (STATIC) |
|---|---|---|---|---|
| super_admin | `/super-admin` | `/super-admin` (`app.js:99-101`) | `role:'super_admin'` | ✅ |
| teacher | `/teacher` | `/teacher`, `/teacher/:tab` (`app.js:104-110`) | `['teacher','staff']` | ✅ |
| staff | `/teacher` | `/teacher*` + alias `/staff*` (`app.js:113-119`) | `['staff','teacher']` | ✅ |
| student | `/student` | `/student`, `/student/:tab` (`app.js:122-128`) | `'student'` | ✅ |
| parent | `/parent` | `/parent`, `/parent/:tab` (`app.js:131-137`) | `'parent'` | ✅ |

Cross-access determinations (frontend guard + backend authority):

| Attempt | Frontend outcome | Backend outcome (final authority) |
|---|---|---|
| Teacher → `/super-admin` | Redirect to `/teacher` (`app.js:66-75`) | `super_admin.php:11` → **403** |
| Staff → `/super-admin` | Redirect to `/teacher` | **403** (`super_admin.php:11`) |
| Student → `/teacher` | Redirect to `/student` | `teacher.php:11` → **403** |
| Parent → `/student` (route) | Redirect to `/parent` | `student.php` allows parent role *for parent-scoped data only* (`student.php:41-63`) — by design |
| Student → `/parent` | Redirect to `/student` | `parent.php:11` → **403** for student role |
| Parent → `/teacher` | Redirect to `/parent` | **403** (`teacher.php:11`) |
| Teacher → `/student` (route) | Redirect to `/teacher` | `student.php` permits teacher **only with enrollment-verified student_id** (`student.php:66-81`) — by design |
| Teacher → `/parent` (route) | Redirect | `parent.php` permits teacher **only for parents of enrolled children** (`parent.php:35-64`) — by design |
| Unauthenticated → any protected route | Redirect to `/login` (`app.js:57-59`) | All APIs → **401** (`auth.php:140-149`) |
| Logged-out + browser Back | SPA re-probes on resolve; probe fails → cached role cleared → redirect (`app.js:185-199`) | Session destroyed server-side; APIs 401 |
| Direct URL / F5 / deep link | Server serves `index.html` (`.htaccess` SPA fallback); guard+probe run | Backend re-authorizes every fetch |

**Direct URL access cannot bypass backend authorization** — routes render empty shells until the probe/API succeeds, and every API enforces roles independently of routing. STATIC VERIFIED.

---

## 5. API Security Matrix

| Endpoint | Auth | Role | Permission | CSRF | Tenant Isolation | Status |
|---|---|---|---|---|---|---|
| `login.php` POST | none (bootstrap) | any | — | none by design (pre-auth; fixation mitigated by ID regeneration) | N/A | ✅ |
| `logout.php` POST | `requireAuth` (`logout.php:15`) | any authenticated | — | ✅ required (`logout.php:18-26`) | N/A | ✅ |
| `teacher.php` GET | `requireRole` (`teacher.php:11`) | teacher, staff (super_admin listed then **403** at `teacher.php:51-54`) | staff: ≥1 permission (`teacher.php:16-22`) | — (GET) | ✅ teacher_id from session (`teacher.php:46-49`) | 🟡 H-6 payload issue |
| `teacher.php` POST | same | same | per-action staff checks (`teacher.php:200-213`) | ✅ before logic (`teacher.php:24-37`) | ✅ teacher_id from session | 🟡 M-2 (enroll ownership) |
| `teacher.php` DELETE | same | same | per-entity staff checks (`teacher.php:369-374`) | ✅ | ✅ `AND teacher_id = :tid` (`teacher.php:378,384`) | ✅ |
| `attendance.php` POST | `requireRole` (`attendance.php:16`) | teacher, staff (super_admin **403** at `:39-42`) | staff: `attendance` (`:20`) | ✅ (`:24-31`) | ✅ session teacher_id + enrollment check (`:84-93`) | ✅ |
| `exams.php` GET | `requireRole` (`exams.php:11`) | teacher, staff (super_admin **403** at `:48-51`) | staff: `exams` (`:15`) | — | ✅ session teacher_id | 🟡 M-3 |
| `exams.php` POST | same | same | same | ✅ (`exams.php:32-41`) | ✅ session teacher_id | 🟡 M-3 |
| `reports.php` GET | `requireRole` (`reports.php:11`) | teacher, staff (super_admin **403** at `:29-32`) | staff: `reports` (`:15`) | — | ✅ all queries by session teacher_id | ✅ |
| `student.php` GET | `requireRole` (`student.php:11`) | all five (super_admin **403** at `:78-80`) | staff: `students` (`:15`) | — | ✅ per-role ownership checks (`:26-81`) | 🟡 M-4 |
| `parent.php` GET | `requireRole` (`parent.php:11`) | parent, teacher, staff (super_admin **403** at `:66-68`) | staff: `parent` (`:15`) | — | ✅ session-scoped + relationship checks | 🟡 M-4 |
| `super_admin.php` GET | `requireRole(['super_admin'])` (`super_admin.php:11`) | super_admin only | — | — | platform-level aggregates only | ✅ |
| `super_admin.php` POST | same | same | — | ✅ (`super_admin.php:14-23`) | ✅ (`WHERE id = 1`) | ✅ (with prior validation notes) |

Unauthorized access is rejected with 401 (no session) / 403 (wrong role/permission/CSRF) at every gate; every gate executes **before** any database mutation. No PUT/PATCH endpoints exist. STATIC VERIFIED.

---

## 6. Tenant Isolation Audit

**Core mechanism (sound):** `tenant_teacher_id` is computed once at login (`auth.php:46-60`) from `teachers.id` / `teacher_staff.teacher_id` and is the *only* tenant identifier used by `teacher.php`, `attendance.php`, `exams.php`, `reports.php`. No endpoint accepts `teacher_id` from the request for authorization decisions. Student and parent identifiers are validated against DB relationships per request (`student.php:26-81`, `parent.php:24-64`).

### IDOR-format findings (carried from prior audits; NOT fixed; documented per required format)

**IDOR-1 — Cross-tenant student PII list**
- FILE: `api/teacher.php` LINE: `120` (also payload key at `178`)
- CURRENT BEHAVIOR: every teacher/staff dashboard GET returns **all students platform-wide** (`id, student_code, name, phone, grade_level`) as `all_platform_students`; the frontend never consumes it.
- SECURITY IMPACT: cross-tenant PII disclosure (names + phones of other tenants' students) to any teacher/staff account.
- RECOMMENDED FIX: remove the global list; replace with an explicit search endpoint returning minimal fields.

**IDOR-2 — Enrollment references unvalidated group/class**
- FILE: `api/teacher.php` LINES: `323-339`
- CURRENT BEHAVIOR: `enroll_existing_student` inserts `student_enrollments` with client-supplied `group_id`/`class_id` without verifying they belong to the session's teacher.
- SECURITY IMPACT: cross-tenant foreign references; records pointing at another tenant's group/class (data integrity + leakage through joins).
- RECOMMENDED FIX: verify `study_groups.teacher_id` / `academic_classes.teacher_id` equal session tenant before insert; dedupe check.

**IDOR-3 — Exam/question cross-linking**
- FILE: `api/exams.php` LINES: `104-165`
- CURRENT BEHAVIOR: `create_question`/`create_exam` accept `class_id`, `group_id`, `question_ids` without ownership validation.
- SECURITY IMPACT: a teacher can attach another teacher's question IDs to their own exam (`exam_questions`) and reference foreign classes/groups.
- RECOMMENDED FIX: filter `question_bank.teacher_id = :tid`; validate class/group ownership.

**IDOR-4 — Parent linkage via `parent_phone`**
- FILE: `api/student.php` LINES: `44-46, 53-58`; `api/parent.php` LINES: `91-95`
- CURRENT BEHAVIOR: child queries use `parent_user_id = :puid OR parent_phone = :pphone`.
- SECURITY IMPACT: two parents sharing a phone number can see each other's linked children's data.
- RECOMMENDED FIX: rely on `parent_user_id` exclusively; formalize linking.

**Helper landmines (dead code)**
- FILE: `config/auth.php` LINES: `391-423` (`verifyTeacherAccess` auto-returns `true` for super_admin), `425-468` (`verifyStudentAccess` preliminary `true`), `470-475` (`verifyParentChildAccess` returns `true` unconditionally).
- CURRENT BEHAVIOR: none of these helpers is called by any endpoint today (endpoints do inline DB checks), so no live exposure.
- SECURITY IMPACT: HIGH if any future code trusts them as-is.
- RECOMMENDED FIX: delete or complete them before reuse; never treat as authorizers today.

---

## 7. Super Admin Isolation

**Forward direction (super_admin restricted to platform APIs):**
- `super_admin.php:11` — the only endpoint granting access, role-locked.
- Explicit 403 blocks for super_admin on every tenant endpoint: `teacher.php:51-54`, `attendance.php:39-42`, `exams.php:48-51 & 87-89`, `reports.php:29-32`, `student.php:78-80`, `parent.php:66-68`. STATIC VERIFIED.

**Reverse direction (no other role reaches platform APIs):**
- `super_admin.php` `requireRole(['super_admin'])` → teacher/staff/student/parent get 403; unauthenticated get 401. No other endpoint exposes `saas_settings` or tenant-wide aggregates. STATIC VERIFIED.

**Notes:** `requireRole` lists in tenant endpoints still *name* `super_admin` before rejecting it later (defense-in-depth, fail-closed second layer — INFO). Frontend probe for super_admin calls only `getSuperAdminData` (`app.js:207-208`); no tenant API is ever invoked from the SA dashboard (STATIC VERIFIED by code inspection).

---

## 8. CSRF Audit

State-changing surface inventory:

| Endpoint | Method | CSRF enforced? | Where | Order vs business logic |
|---|---|---|---|---|
| `login.php` | POST | N/A (pre-auth bootstrap) | — | acceptable; session ID regenerated on success kills login-CSRF/fixation |
| `logout.php` | POST | ✅ | `logout.php:18-26` | before destruction |
| `attendance.php` | POST | ✅ | `attendance.php:24-31` | before INSERT |
| `exams.php` | POST | ✅ | `exams.php:32-41` | before actions |
| `super_admin.php` | POST | ✅ | `super_admin.php:14-23` | before UPDATE |
| `teacher.php` | POST | ✅ | `teacher.php:24-37` | before actions |
| `teacher.php` | DELETE | ✅ | `teacher.php:24-37` | before DELETE |

- Generation: CSPRNG 32 bytes (`auth.php:70-79`). Storage: server session + client `sessionStorage` (`api.js:15-21`). Transmission: `X-CSRF-Token` header **and** JSON body field (`api.js:45-60`). Validation: `hash_equals` (`auth.php:108`).
- Missing token → `validateCsrfToken(null)=false` → 403. Invalid token → 403 `Invalid CSRF token`. Same behavior everywhere.
- Logout CSRF: ✅ protected (matches current design). Login CSRF: mitigated by design (no pre-login session trust + ID regeneration).
- SameSite=Lax session cookie independently blocks cross-site cookie submission on non-GET top-level flows (defense in depth).
- Weaknesses: token static per session (rotation code unreachable — M-7); token readable by any XSS because it lives in `sessionStorage` (feeds H-1).
- No PUT/PATCH endpoints exist. OPTIONS handled via `Helper::handleCorsOptions()` without executing state logic.

STATIC VERIFIED.

---

## 9. Session Security Audit

| Check | Result | Evidence |
|---|---|---|
| `session_start()` guarded by `session_status()` | ✅ | `auth.php:18-29` |
| `session_regenerate_id(true)` at login | ✅ fixation-resistant | `auth.php:37` |
| HttpOnly | ✅ | `auth.php:25` |
| Secure | ✅ conditional on detected HTTPS (M-6 behind proxies) | `auth.php:24` |
| SameSite | ✅ `Lax` | `auth.php:26` |
| Session destruction on logout | ✅ `$_SESSION=[]` + cookie expiry + `session_destroy()` | `auth.php:477-494` |
| Logout cookie invalidation | ✅ with original flags/path | `auth.php:482-491` |
| Stale session behavior | ✅ destroyed session ⇒ probe 401 ⇒ frontend clears state and redirects | `app.js:185-199`, `api.js:69-76` |
| Server-side idle/absolute timeout | ❌ absent (cookie lifetime only + host gc) — M-5 | `auth.php:22` |
| Periodic ID rotation | ❌ absent (login only) — INFO | — |
| Session data minimization | ✅ only id/name/email/role/phone/tenant_teacher_id; never password_hash | `auth.php:39-60` |

STATIC VERIFIED.

---

## 10. Frontend Security Audit

Files: `app.js`, `router.js`, `api.js`, `admin.js`, `teacher.js`, `student.js`, `parent.js`.

- **Frontend routing is UX only.** Every navigation runs `checkAuthStatus()` which *re-probes the backend* (`app.js:52-57, 171-221`); guard decisions without a successful probe always end in redirect. Backend re-authorizes every fetch. STATIC VERIFIED.
- **sessionStorage trust:** `user_role` (`app.js:226-233`) and `csrf_token` (`api.js:15-21`) live in `sessionStorage`. Tampering with `user_role` only changes which probe endpoint is called — the server rejects and the cache is cleared (`app.js:193-198`). **No privilege can be gained client-side.** The CSRF token's presence in `sessionStorage` is a real (if conventional) XSS-amplifying factor (feeds H-1).
- **Client-side role spoofing / hidden dashboard bypass:** controllers are global classes, but they render only data returned by authorized APIs; forcing a controller render without data produces an empty shell and no request bypass.
- **API calls without backend protection:** none exist — every `ApiClient.request` targets an endpoint gated by `requireRole`/`requireAuth` (matrix in §5).
- **CORS:** `Helper::getAllowedOrigin` echoes whitelisted localhost origins in dev and same-origin (scheme://Host) otherwise, always with `Vary: Origin` (`helper.php:25-79`) — cross-origin credentialed reads are not enabled in production.
- **Known carried defect:** DB-derived values interpolated into `innerHTML` without output encoding (`teacher.js:28-29,167`, `student.js:114`, `parent.js:29,42`, `admin.js:22-27`, `app.js:351-364`), with `study_days` JSON bypassing write-time escaping (`teacher.php:236`) → stored XSS path (H-1).

---

## 11. Logout Security Audit

Implemented chain (verified statically end-to-end):

```
Logout click (app.js:317-336 handleLogout, re-entrancy guarded)
  → ApiClient.logout() = POST api/logout.php with X-CSRF-Token + body csrf_token (api.js:103-106)
  → logout.php: POST-only (405) → requireAuth (401) → CSRF check (403)
  → AuthManager::logout(): $_SESSION=[] → cookie expired → session_destroy() (auth.php:477-494)
  → 200 JSON → frontend clears sessionStorage csrf_token/user_role, in-memory state, hides button (app.js:577-630)
  → router.replace('/') — dashboard history entry replaced (app.js:622-624)
```

Checklist:
- POST-only ✅ (`logout.php:10-12`) · requires authentication ✅ (`:15`) · requires valid CSRF ✅ (`:18-26`) · destroys PHP session ✅ (`auth.php:477-494`) · clears frontend state ✅ (`app.js:580-616`) · protected URLs after logout redirect to login ✅ (guard + probe, `app.js:57-59,185-199`).
- **Browser Back:** SPA replaces the dashboard history entry before navigating to `/`; a Back press re-resolves through guards → unauthenticated → `/login`. Caveat (INFO): browsers may briefly show a bfcache DOM snapshot without running JS on Back; the session is dead server-side, so any data action fails with 401 and the next resolve redirects. No authenticated *capability* survives logout.
- CSRF-protected logout ✅ — matches the verified production behavior you reported.

STATIC VERIFIED; LIVE behavior previously attested by your production tests (not re-tested by auditor).

---

## 12. Negative Test Matrix (STATIC / SIMULATED ONLY)

> Method: code-path tracing. **Nothing below was executed against Production.**

### 12.1 Unauthenticated route access

| Target | Expected | Static outcome | Class |
|---|---|---|---|
| GET `/teacher` | redirect to `/login` | guard `app.js:57-59` → `/login` | STATIC VERIFIED |
| GET `/staff` | redirect | same | STATIC VERIFIED |
| GET `/student` | redirect | same | STATIC VERIFIED |
| GET `/parent` | redirect | same | STATIC VERIFIED |
| GET `/super-admin` | redirect | same | STATIC VERIFIED |
| Direct API GET (any) | 401 | `auth.php:140-149` | STATIC VERIFIED |

### 12.2 Wrong-role access

| Attempt | Frontend | Backend | Class |
|---|---|---|---|
| Teacher → `/super-admin` | redirect `/teacher` | 403 `super_admin.php:11` | STATIC VERIFIED |
| Staff → `/super-admin` | redirect `/teacher` | 403 | STATIC VERIFIED |
| Student → `/teacher` | redirect `/student` | 403 `teacher.php:11` | STATIC VERIFIED |
| Student → `/parent` | redirect | 403 `parent.php:11` | STATIC VERIFIED |
| Parent → `/teacher` | redirect | 403 | STATIC VERIFIED |
| Parent → `/student` (route) | redirect `/parent` | API allows parent scope only (`student.php:41-63`) | STATIC VERIFIED (by design) |
| Teacher → `/student` (route) | redirect | API requires enrollment proof (`student.php:66-81`) | STATIC VERIFIED (by design) |
| Teacher → `/parent` (route) | redirect | API requires relationship proof (`parent.php:35-64`) | STATIC VERIFIED (by design) |
| super_admin → tenant APIs | N/A (no UI path) | 403 at all six endpoints (§7) | STATIC VERIFIED |

### 12.3 API negative matrix

| Condition | Endpoints affected | Expected | Static outcome |
|---|---|---|---|
| No session | all protected | 401 | ✅ via `getCurrentUserOrFail` |
| Wrong role | all protected | 403 | ✅ via `requireRole` |
| Staff lacking permission | attendance/exams/reports/parent/student + teacher.php actions | 403 | ✅ via `requirePermission` (`auth.php:182-215`) |
| Missing CSRF on POST/DELETE | logout, attendance, exams POST, super_admin POST, teacher POST/DELETE | 403 before mutation | ✅ |
| Invalid CSRF (tampered) | same | 403 (`hash_equals` fail) | ✅ |
| Tampered `student_id`/`parent_id` | student.php, parent.php | 403 unless relationship proven | ✅ (residual M-4 phone caveat) |
| Tampered `teacher_id` param | teacher/attendance/exams/reports | ignored — session value used | ✅ |
| super_admin on tenant endpoints | 6 endpoints | 403 explicit | ✅ |
| any role on `super_admin.php` except super_admin | — | 401/403 | ✅ |

SIMULATED (code-traced). Live execution of this matrix remains **NOT VERIFIED by auditor**.

---

## 13. Findings (consolidated)

### Carried from prior audits — still present

| ID | Severity | Summary | File:Line |
|---|---|---|---|
| C-1 | **CRITICAL** | Production DB credentials committed to a **public** GitHub repo | `config/database.php:21-23` |
| H-1 | HIGH | Stored XSS via `study_days` JSON + unescaped `innerHTML`; CSRF token in `sessionStorage` amplifies impact | `api/teacher.php:236`; `assets/js/student.js:114`; `assets/js/teacher.js:167` |
| H-2 | HIGH | Login rate limit stored in caller's session → bypassable with fresh cookies (no real brute-force protection) | `config/auth.php:312-345` |
| H-3 | HIGH | All seed accounts share the well-known bcrypt hash of `password` | `database/seed.sql:10-18` |
| H-4 | HIGH | New students created with fixed password `123456` + collision-prone `time().'@student.edu'` | `api/teacher.php:271-282` |
| H-5 | HIGH | Executable test script at web root that mutates staff permissions | `test_negative_permissions.php` |
| H-6 | HIGH | `all_platform_students` leaks every student's PII to every teacher/staff | `api/teacher.php:120,178` |
| M-1 | MEDIUM | Exception messages (possible SQL/structure detail) returned to clients in 7 endpoints | `api/attendance.php:129`, `exams.php:187`, `parent.php:247`, `reports.php:160`, `student.php:205`, `super_admin.php:125`, `teacher.php:399` |
| M-2 | MEDIUM | IDOR-2 above (enroll ownership) | `api/teacher.php:323-339` |
| M-3 | MEDIUM | IDOR-3 above (exam/question linking) | `api/exams.php:104-165` |
| M-4 | MEDIUM | IDOR-4 above (parent_phone linkage) | `api/student.php:44-46,53-58`; `api/parent.php:91-95` |
| M-5 | MEDIUM | No server-side idle/absolute session timeout | `config/auth.php:22` |
| M-6 | MEDIUM | Secure flag depends on `$_SERVER['HTTPS']` (proxy caveat) | `config/auth.php:24` |
| M-7 | MEDIUM | CSRF token static per session; rotation branch unreachable; token in sessionStorage | `config/auth.php:82-97`; `assets/js/api.js:15-21` |
| M-8 | MEDIUM | Multi-teacher staff ambiguity (`teacher_staff` no UNIQUE; `LIMIT 1` joins) | `api/login.php:36-43`; `config/auth.php:182-215` |
| M-9 | MEDIUM | `.htaccess` protections rewrite-only; no CSP/HSTS/.user.ini hardening | `.htaccess` |
| M-10 | MEDIUM | No output encoding layer in frontend (relies on write-time escaping) | all controllers |

### New findings specific to this audit

| ID | Severity | Summary | File:Line |
|---|---|---|---|
| L-1 | LOW | Email passed through `htmlspecialchars` before DB lookup — emails containing `&`/`'` can never authenticate | `api/login.php:15` |
| L-2 | LOW | Dead auth helpers with dangerous placeholders (`return true`) | `config/auth.php:391-475` |
| L-3 | LOW | Timing delta between unknown-email and wrong-password paths | `api/login.php:49-62` |
| L-4 | LOW | `qr_code_token` exposed in student API response | `api/student.php:193` |
| L-5 | LOW | Dev localhost origins remain in CORS allowlists | `config/helper.php:35-42`; `assets/js/api.js:7-12` |
| L-6 | LOW | `super_admin` named in tenant `requireRole` lists before second-layer rejection (fail-closed but noisy) | e.g. `api/teacher.php:11` |
| L-7 | LOW | No security audit logging (failed logins, 403s, settings changes) | system-wide |
| L-8 | LOW | Deprecated `X-XSS-Protection` header; no Permissions-Policy | `.htaccess:34` |
| L-9 | LOW | No periodic session-ID rotation; `gc_maxlifetime` host-dependent | `config/auth.php` |
| INFO | INFO | bfcache may briefly show stale DOM after Back post-logout; server session is dead, no capability survives | browser behavior |

---

## 14. Severity Classification

- **CRITICAL (1):** C-1 — production DB credentials in public repository.
- **HIGH (6):** H-1 … H-6.
- **MEDIUM (10):** M-1 … M-10.
- **LOW (9):** L-1 … L-9.
- **INFO (1+):** bfcache note; fail-closed super_admin double layer; strengths list below.

Because C-1/H-1/H-2/H-3/H-4/H-5/H-6 remain open, **the statement "NO CRITICAL SECURITY ISSUES FOUND" cannot be made**. The authentication/authorization architecture itself contains **no new critical or high defects** discovered in this phase.

### Security strengths (verified static)
100% prepared statements; central `AuthManager` gates; session fixation protection; HttpOnly/SameSite cookies; `hash_equals` CSRF on every mutation before execution; session-derived tenant identifiers; explicit super_admin blocks in both directions; bcrypt password handling with no hash leakage; complete server-side logout destruction; backend as final authority over a UX-only frontend guard layer.

---

## 15. Recommended Fixes (priority order — NOT implemented)

1. **P0:** Rotate the production DB password now; remove credentials from `config/database.php`; purge from Git history; enforce mandatory `db_credentials.php` (C-1).
2. **P0:** Remove `test_negative_permissions.php` from any deployed web root (H-5); confirm `.git/` is not deployed.
3. **P0/P1:** Replace session-based login throttling with DB/IP-based limiting + account lockout/backoff (H-2); eradicate seed/shared weak passwords in any live environment (H-3); random temporary passwords for created students (H-4).
4. **P1:** Eliminate the XSS surface: output-encode all interpolated fields, add CSP, escape JSON fields like `study_days` (H-1, M-10); consider moving CSRF transmission out of JS-readable storage once CSP exists (M-7).
5. **P1:** Stop exposing `all_platform_students`; replace with scoped search (H-6).
6. **P2:** Ownership validation for enroll/exam linking (M-2, M-3); drop `parent_phone` fallback (M-4); generic error responses + server logs (M-1); session idle timeout + proxy-aware Secure flag (M-5, M-6); UNIQUE constraint on (teacher_id,user_id) in `teacher_staff` (M-8).
7. **P3:** Harden `.htaccess`/.user.ini (M-9); delete placeholder helpers (L-2); audit logging (L-7); remaining Lows.

---

## 16. Production Verification Status

| Item | Status |
|---|---|
| All code-level conclusions in this report | **STATIC VERIFIED** (code reading only) |
| Negative test matrix (§12) | **SIMULATED** (code-path tracing; not executed) |
| Login/routing/logout/F5/Back-Forward/deep-link behavior on https://einshtein-store.online/110/ | **LIVE PRODUCTION VERIFIED — per the user's reported manual tests**; not performed or re-confirmed by the auditor |
| Brute-force resistance, CSRF tampering, IDOR probes against live system | **NOT VERIFIED** (requires controlled live testing; deliberately not performed in an audit-only phase) |

No live results were fabricated. Static verification is not equivalent to live verification.

---

## 17. Files Reviewed

| Layer | Files |
|---|---|
| Backend config | `config/auth.php`, `config/database.php`, `config/helper.php`, `config/db_credentials.php.template` |
| Backend API | `api/login.php`, `api/logout.php`, `api/teacher.php`, `api/attendance.php`, `api/exams.php`, `api/reports.php`, `api/student.php`, `api/parent.php`, `api/super_admin.php` |
| Frontend | `assets/js/app.js`, `assets/js/router.js`, `assets/js/api.js`, `assets/js/admin.js`, `assets/js/teacher.js`, `assets/js/student.js`, `assets/js/parent.js`, `assets/js/landing.js`, `assets/js/qr-generator.js` |
| Markup/Config | `index.html`, `.htaccess`, `.gitignore`, `.gitattributes` |
| Database | `database/schema.sql`, `database/seed.sql` |
| Other | `test_negative_permissions.php`, `README.md` |

Total: **30 files reviewed.**

## 18. Files Modified

**0 source files modified.**
One new deliverable file created as explicitly required by this phase: `AUTH_SECURITY_AUDIT_REPORT.md` (this report). No code, UI, database, authentication, authorization, or API contract was touched. (`git status` clean apart from this new untracked deliverable.)

---

## 19. Final Verdict

1. The **authentication and authorization architecture is sound**: the five roles are correctly resolved end-to-end with exact string values, the backend is the final authority on every request, Super Admin is isolated in both directions, CSRF protects every state-changing endpoint, sessions are fixation-resistant and fully destroyed on logout, and tenant identifiers are session-derived (not client-supplied) on all core paths.
2. **No new CRITICAL/HIGH defects were found in the auth/authz layer itself** during this phase.
3. However, the system **cannot be declared fully secure**: one CRITICAL (public-repo DB credentials) and six HIGH findings from prior audits remain unresolved, and the negative-test matrix is only SIMULATED, not live-executed.
4. Next action (not performed): execute the P0 items in §15 — credential rotation and removal first — then schedule a controlled live penetration pass of the §12 matrix.

**AUDIT COMPLETE — NO SOURCE FILES MODIFIED. STOPPING HERE; NO FIXES IMPLEMENTED.**
