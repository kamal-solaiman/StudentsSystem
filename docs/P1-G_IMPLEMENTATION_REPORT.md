# P1-G_IMPLEMENTATION_REPORT — DYNAMIC QR SECURITY (IMPLEMENTED)

**Phase:** P1-G — Dynamic QR Security Implementation (executed per `P1-G_IMPLEMENTATION_PLAN.md` + user spec)
**Date:** 2026-08-13 (Africa/Cairo) · **Branch:** `arena/019ff7b4-studentssystem`
**Mode:** REAL IMPLEMENTATION (not audit). Scope: P1-G only — no P1-H or later started.

---

## 1. What Changed

| Area | Change |
|---|---|
| Backend | `api/attendance.php` extended with two new branches: `action=generate_qr` (teacher/staff) and student QR scan (`method=dynamic_qr` + `qr_token`). Existing manual/scanner teacher flows preserved verbatim |
| Frontend (teacher) | Static fake QR screen (`DYN-QR-992384-AUTO`) replaced with real flow: group select → generate → scannable QR + 45s countdown → auto-renew |
| Frontend (student) | New attendance card on student overview: token input → submit → status-aware Arabic result |
| Library | Vendored real QR encoder (`qrcode-generator` v1.4.4, MIT) as `assets/js/qr-encoder.js` — locally, no CDN |
| Config | New `config/qr_secret.php` (256-bit random secret, git-ignored) + `.template`; `.gitignore` entry added |
| Old QR | `DYN-QR-992384-AUTO` / `DYNAMIC-QR-SCREEN-TOKEN` **removed from the codebase**; any such submission is rejected by the new validator (0 occurrences remain) |

## 2. QR Architecture

**Stateless HMAC-SHA256 + 45s TTL (broadcast-safe)** — as mandated:
- Teacher/staff issues a signed token bound to their session tenant + one of their own groups.
- The same token is valid for **every enrolled student** until `exp` (classroom broadcast).
- Per-student same-day **dedupe** makes replays idempotent (no duplicate attendance rows).
- No nonce table / no DB migration — `qr_tokens`/`qr_nonces` tables were **not** created because stateless + TTL + HMAC + enrollment checks + dedupe satisfy the required security model (plan §3 justification; broadcast semantics make per-token single-use state counterproductive).
- All validation server-side; frontend never signs, validates, or decides.

## 3. Token Format

```json
{ "v": 1, "tid": <teacher_id>, "gid": <group_id>, "cid": <class_id>,
  "nonce": "<32-hex random>", "iat": <unix>, "exp": <iat + 45> }
```
```
payload   = canonical JSON (server-built, fixed key order)
signature = HMAC-SHA256(base64url(payload), server_secret)  [raw bytes]
token     = base64url(payload) + "." + base64url(signature)
```
- `nonce`: `bin2hex(random_bytes(16))` — cryptographically secure, never `Math.random()`.
- Timestamps: Unix (UTC-consistent); server clock authoritative for expiry.
- `cid` derived server-side from the chosen group (`study_groups.class_id`) — teacher cannot mismatch group/class.

## 4. HMAC Implementation (`api/attendance.php`)

- Generation: `hash_hmac('sha256', $payloadPart, $secret, true)` → base64url.
- Validation: recompute over the received payload part, compare with `hash_equals()` (constant-time) against the decoded 32-byte signature.
- Validation order (per spec): auth → role → token present → length cap → two-part format → base64url decode (strict) → JSON parse → required fields (`v,tid,gid,cid,nonce,iat,exp`) → `v==1` → integer validity → ids ≥ 1 → nonce shape → `exp > iat` → `exp - iat ≤ 45` → **expiry (403 "انتهت صلاحية رمز الحضور")** → **HMAC (403 "رمز الحضور غير صالح")** → DB ownership/enrollment → dedupe → insert.
- Forged longer TTL (`exp - iat > 45`) rejected with 400 even if well-formed.

## 5. Secret Management

- **`config/qr_secret.php`** (created): 256-bit cryptographically random hex secret (`random_bytes(32)` equivalent), generated for this deployment.
- Git-ignored (same policy as `db_credentials.php`) → never committed to the public repo.
- Served behind `.htaccess` config-directory block; loaded via `require` with fail-closed: missing/short secret → **503** on both actions.
- `config/qr_secret.php.template` created documenting generation (`bin2hex(random_bytes(32))`) and rules.
- Verified: secret value appears in **no** JS, HTML, API response, log path, or DB artifact (grep scan passed). Rotation = replace value → all issued tokens die instantly.

## 6. Generation Flow (`?action=generate_qr`)

1. POST-only → `requireRole(['teacher','staff','super_admin','student'])` gate → staff needs `attendance` permission → CSRF validated.
2. Students hard-blocked from this branch (403). Super_admin 403 (unchanged).
3. `teacher_id` from session (`tenant_teacher_id`) — never from request.
4. `group_id` sanitized int; ownership: `study_groups.id=:gid AND teacher_id=:tid` → else 403; derived `class_id` ownership re-checked → else 403.
5. `iat=time()`, `exp=iat+45`, nonce → payload → HMAC → token.
6. Response with **`Cache-Control: no-store, no-cache, must-revalidate` + `Pragma: no-cache` + `Expires: 0`**: `{success, qr_token, iat, exp, ttl}` — nothing else.

## 7. Validation Flow (student scan)

Student POSTs `{method:'dynamic_qr', qr_token}` — full order in §4; then:
- Group-of-teacher, class-of-teacher checks against the **signed** ids (DB).
- Student identity from session (`students.user_id`) — never from QR.
- Enrollment: `student_enrollments (teacher_id, student_id, group_id)` → else 403 "غير مصرح لك بالحضور في هذه المجموعة".
- Dedupe: existing record for (teacher, student, today) → idempotent `{success:true, already_recorded:true}`.
- Insert: `status='present'`, `method='dynamic_qr'`, arrival time, safe notes.
- Errors: 401 unauth · 403 role/signature/expired/enrollment · 400 malformed/empty · 503 secret missing · generic 500 (own try/catch — no internals).

## 8. Tenant Isolation

- `tid/gid/cid` honored **only from the HMAC-verified payload**; group/class ownership re-verified in DB against that teacher; enrollment binds the student to that exact group of that teacher.
- Teacher A cannot issue for Teacher B's group (session tenant + ownership checks). A stolen/broadcast token of Teacher A grants attendance only within Teacher A's enrolled students — by design of broadcast.
- No client-supplied tenant identifier is trusted anywhere.

## 9. RBAC

- `student` added to `attendance.php` role list **solely** for the scan branch; students get 403 on every other action (`method !== 'dynamic_qr'` → 403). Documented justification: QR submission is a student capability; widening the existing endpoint avoided inventing a new API (per spec).
- Teacher/staff/super_admin behavior unchanged; staff permission `attendance` still enforced; super_admin still blocked. CSRF enforced for all actions.

## 10. Replay / Broadcast Behavior

- One valid QR → many students, until `exp` (45 s): broadcast requirement satisfied.
- Same student re-submitting within TTL → idempotent success, **no duplicate row** (dedupe).
- After `exp` → 403 expired for everyone.
- No first-scan invalidation (stateless, as mandated).

## 11. Expiry

- TTL constant `QR_TTL_SECONDS = 45`; `exp = iat + 45`; server `time()` authoritative; teacher UI shows countdown from server `exp` (display only) and auto-generates a fresh QR when it hits 0 while the screen is open; manual "تجديد الرمز الآن" available. Old QR after renewal naturally dies at its own `exp` (≤45 s) — stateless design.

## 12. Frontend Changes

**`assets/js/teacher.js`**
- Constructor: `qrState` + timer (no secrets, no signing).
- `renderDynamicQrScreen()`: idle (group select from the teacher's OWN groups + generate button) / loading / active (real QR + big countdown + refresh) / expired (auto-renew notice) / error (retry). Existing `.dynamic-qr-screen`/`.dynamic-qr-box` design preserved.
- `generateQr()` → `ApiClient.generateAttendanceQr(groupId)` with double-click guard.
- `startQrCountdown()`: 1s ticks from `exp`; at ≤0 → expired + auto-regenerate while screen open; self-cleans on tab switch.
- `renderQrGraphic()`: real scannable SVG via vendored `qrcode(0,'M')` encoder.
- Old literals (`DYN-QR-992384-AUTO`, `DYNAMIC-QR-SCREEN-TOKEN`) removed.

**`assets/js/student.js`**
- Overview: new "تسجيل الحضور بالرمز الديناميكي" card (input + submit + result box).
- `submitQrAttendance()`: busy guard, double-submit prevention, `ApiClient.submitAttendanceQr(token)`; results via `textContent` (XSS-safe); status-aware Arabic messages (400/403 → backend safe messages; 401 → session message; no-status → network message).
- No client-side validation of HMAC/expiry/ownership/tenant.

**`assets/js/api.js`**: `generateAttendanceQr()`, `submitAttendanceQr()` wrappers (existing CSRF mechanism auto-applied).
**`index.html`**: `<script src="assets/js/qr-encoder.js">` tag added.
**`assets/js/qr-encoder.js`** (new): vendored MIT encoder with attribution header; encodes public tokens only.

## 13. Backend Changes

`api/attendance.php` only:
- Constants `QR_VERSION=1`, `QR_TTL_SECONDS=45`; helpers `qr_secret()`, `qr_base64url_encode/decode()` (strict mode + re-padding), `qr_no_store_headers()`, `qr_fail_invalid()`.
- `qr_handle_generate()` and `qr_handle_student_scan()` (full spec order).
- Pre-existing manual/scanner recording flow preserved unchanged; its catch block message made generic (no `getMessage()` leakage) — required by P1-G no-leak rule; response shape/status unchanged.

## 14. Database Changes

**None.** No migration, no new table, no schema edit (stateless design justified in §2). Existing `attendance_records` (incl. `method='dynamic_qr'` ENUM value) and `student_enrollments` reused as-is.

## 15. Security Tests (STATIC + SIMULATED — executed)

Crypto-algorithm simulation mirroring the exact PHP logic (base64url, HMAC over payload part, `hash_equals` semantics, spec validation order) — **18/18 PASS**:

| # | Case | Result |
|---|---|---|
| 1 | Valid QR → success | ✅ 200 |
| 2 | Expired QR → rejected | ✅ 403 |
| 3 | Invalid HMAC → rejected | ✅ 403 |
| 4/5/6 | Modified tid / cid / gid (signature kept) → rejected | ✅ 403 |
| 10 | Replay within 45s (same student) → allowed once, idempotent | ✅ 200 + dedupe rule |
| 11 | After expiry → rejected | ✅ 403 |
| 12 | Old `DYN-QR-992384-AUTO` → rejected | ✅ 400 (and 0 occurrences left in code) |
| 13/14 | Malformed / empty QR → rejected | ✅ 400 |
| 15/16 | Missing nonce / missing expiry → rejected | ✅ 400 |
| 17 | Invalid timestamp → rejected | ✅ 400 |
| 18 | Teacher A QR vs Teacher B context → issue-time ownership 403; scan binds signed tid only | ✅ static trace |
| 19/20 | Student from another group / another teacher → enrollment 403 | ✅ static trace |
| 21 | Multiple students, same valid broadcast QR → success for enrolled | ✅ 200 each + dedupe |
| 22/23 | Regenerated QR → new nonce + new expiry | ✅ (fresh `random_bytes` + `time()` per issue) |
| Forged TTL > 45s | rejected | ✅ 400 |
| 24/25 | Secret absent from frontend assets & API responses | ✅ grep scan NO LEAK |
| 26 | No SQL/stack-trace leakage in QR paths (generic messages) | ✅ code review |
| Wrong role / unauthenticated | 403 / 401 via existing gates | ✅ static trace |
| CSRF missing | 403 (existing validation precedes all branches) | ✅ static trace |

Tooling executed: `node --check` (api.js, teacher.js, student.js, qr-encoder.js) — all PASS; `git diff --check` — PASS; secret-leak grep — PASS; old-literal grep — 0 hits.

## 16. Regression Tests

| Area | Status |
|---|---|
| Login / Logout / Session / CSRF architecture | ✅ untouched (files unchanged) |
| Idle Timeout (P1-C) / DB Rate Limiting (P1-D) | ✅ untouched (`config/auth.php`, `login.php` unchanged) |
| CORS (P1-A) / IDOR ownership (P1-B) | ✅ untouched (`helper.php`, `teacher.php`, `exams.php` unchanged) |
| Reports / Exams integrations (P1-E) / Error UI (P1-F) | ✅ untouched |
| Router / routing / F5 / Back-Forward | ✅ `router.js`, `app.js` unchanged |
| Super Admin isolation / RBAC | ✅ gates unchanged; SA still 403 on attendance |
| Teacher manual/scanner attendance flow | ✅ preserved verbatim (only error text made non-leaking) |
| Modal system / empty states | ✅ untouched |

## 17. Production Verification

**LIVE VERIFICATION: NOT AVAILABLE** — no tests were executed against https://einshtein-store.online/110/ in this phase. No LIVE PASS is claimed.

Deployment checklist (later, on production):
1. Create `config/qr_secret.php` on the server (copy template; `php -r "echo bin2hex(random_bytes(32));"`).
2. Upload: `api/attendance.php`, `assets/js/{teacher.js,student.js,api.js,qr-encoder.js}`, `index.html`, `.gitignore` (server copy irrelevant), keep `.htaccess` as-is (config dir already blocked).
3. `php -l api/attendance.php` (PHP 8.3).
4. Live pass: teacher generates QR → phone scans/decodes → student submits → 200 recorded; wait 45s → 403 expired; tampered token → 403; non-enrolled student → 403; replay → idempotent; regression sweep (login/logout/routing/idle/rate-limit/reports/exams).

## 18. Files Modified

1. `api/attendance.php` — generate + scan branches, QR helpers, generic error text
2. `assets/js/teacher.js` — dynamic QR screen (state, generate, countdown, real render), literals removed
3. `assets/js/student.js` — QR attendance submission card + handler
4. `assets/js/api.js` — 2 wrappers
5. `index.html` — qr-encoder script tag
6. `.gitignore` — `config/qr_secret.php` entry (security necessity, documented)

## 19. Files Created

1. `assets/js/qr-encoder.js` — vendored real QR encoder (MIT, attribution header)
2. `config/qr_secret.php` — 256-bit secret (**git-ignored; must be created on production**)
3. `config/qr_secret.php.template` — documentation template
4. `P1-G_IMPLEMENTATION_REPORT.md` — this report

## 20. Rollback Plan

1. Revert `assets/js/teacher.js` + `index.html` → static screen returns (old literals) with zero backend dependency.
2. Revert `api/attendance.php` → new branches disappear; manual/scanner flow identical.
3. Revert `assets/js/student.js` + `api.js` → submission card/wrappers gone.
4. Delete `config/qr_secret.php` (optional) and `assets/js/qr-encoder.js`.
5. No DB rollback needed (no schema changed). No attendance data affected.

---

**P1-G IMPLEMENTED — STOP. No further phase started.**
