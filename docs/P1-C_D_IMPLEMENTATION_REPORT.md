# P1-C_D_IMPLEMENTATION_REPORT

**Phase:** P1-C (Idle Session Timeout — 30 minutes) + P1-D (Database-backed Login Rate Limiting) — user labeling
**Date:** 2026-08-13 (Africa/Cairo) · **Branch:** `arena/019ff7b4-studentssystem`
**Plan reference:** `P1_IMPLEMENTATION_PLAN.md` §4 (idle timeout → implemented at the plan's specified choke point) and §5 (rate limiting → DB-backed design; table named `login_attempts` per user instruction)
**Mode:** Implementation of P1-C + P1-D ONLY. P1-E/F/G not started. No UI redesign.

---

## Files Modified (3)

| File | Change scope |
|---|---|
| `config/auth.php` | P1-C: `IDLE_TIMEOUT_SECONDS` constant, `last_activity` init at login, central enforcement in `getCurrentUser()`. P1-D: DB-backed `checkRateLimit`, new `recordFailedLoginAttempt`, DB-backed `clearRateLimit` / `getRateLimitRemaining`, helper methods (`loginAttemptIpKey`, `loginAttemptsExceedLimit`, `remainingFromRow`, `maybePurgeOldLoginAttempts`) |
| `api/login.php` | P1-D: passes client IP to the limiter; records failed attempts on both failure paths (unknown email, wrong password); identical 429/401 response shapes preserved |
| `database/schema.sql` | P1-D: new section 18 — `login_attempts` table DDL |

## Files Created (1)

| File | Purpose |
|---|---|
| `P1-C_D_IMPLEMENTATION_REPORT.md` | This report (required deliverable) |

No other file was touched: JS/CSS/HTML/`.htaccess` untouched; `AUTH_SECURITY_AUDIT_REPORT.md` and all previous reports untouched; P1-A/P1-B changes verified intact (markers present: `ALLOWED_ORIGINS` ×2 in `helper.php`, `SECURITY (P1-B)` ×7 in `teacher.php`, ×4 in `exams.php`).

---

## Database Changes

**One new table — required and justified by the plan (§5: no existing table can be safely reused).** Schema added to `database/schema.sql` section 18; **not executed anywhere** (audit environment has no DB). Migration SQL for production (run once via cPanel/phpMyAdmin before deploying the PHP files):

```sql
CREATE TABLE IF NOT EXISTS `login_attempts` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `identifier`       VARCHAR(190) NOT NULL,   -- email OR 'ip:<sha256>' key
  `ip_hash`          CHAR(64)     NOT NULL,   -- one-way hash, informational
  `attempts`         INT UNSIGNED NOT NULL DEFAULT 1,
  `first_attempt_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_attempt_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_login_attempts_identifier` (`identifier`),
  KEY `idx_login_attempts_last` (`last_attempt_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Properties: InnoDB (atomic upserts), `utf8mb4_unicode_ci` (case-insensitive email counters), `VARCHAR(190)` unique key (old-MySQL index limit safe), indexed `last_attempt_at` for cleanup. Stores **no passwords, no secrets, no raw IPs**. No other schema object added or changed.

---

## Idle Timeout Implementation (P1-C)

| Requirement | Implementation |
|---|---|
| 30-minute idle expiry, unified for all 5 roles | `private const IDLE_TIMEOUT_SECONDS = 1800` — single constant, no per-role branching; enforced for `super_admin / teacher / staff / student / parent` identically |
| Central, backend-only enforcement | Placed exactly where the plan specifies: `AuthManager::getCurrentUser()` (`config/auth.php`) — the choke point every protected endpoint passes through via `requireRole()` / `requireAuth()` (all 9 API files). No JavaScript involved; backend is the source of truth |
| `last_activity` recorded at login | `loginUser()` sets `$_SESSION['last_activity'] = time()` right after `session_regenerate_id(true)` — no conflict with fixation protection (session data survives regeneration) |
| Legitimate activity refreshes the window | After the expiry check passes, `$_SESSION['last_activity'] = time()` runs on every authenticated request (GET and POST) |
| Public/unauthenticated requests never refresh | `getCurrentUser()` returns `null` for requests without `user_id` **before** any `last_activity` access/update; `login.php` (public) never calls `getCurrentUser()` |
| Safe session termination on expiry | Calls the existing `AuthManager::logout()` — `$_SESSION = []` + cookie expiry with original flags + `session_destroy()` — then returns `null`, so `getCurrentUserOrFail()` answers **401 Unauthorized** on every protected API |
| Frontend redirects to `/110/login` | Existing mechanism (no frontend change needed, per plan §4): `api.js` clears CSRF on 401; the router guard runs `checkAuthStatus()` on every navigation — the role probe gets 401, `_clearCachedRole()` runs, `isAuthenticated=false` → guard returns `/login` → `AppRouter.toFullPath()` applies the `/110` base path → `/110/login` (covers tab clicks, F5, deep links, Back/Forward) |
| Local auth state cleanup | Same existing path: probe failure clears `user_role`; `api.js` removes `csrf_token` on 401 |
| Cookie flags preserved | `HttpOnly=true`, `SameSite=Lax`, `Secure`-on-HTTPS untouched (`startSession()` unchanged) |
| Logout preserved | `logout.php` flow unchanged; `requireAuth()` → (possibly refreshed) session → CSRF → destruction. Edge case: logout on an already-expired session returns 401 (session already destroyed server-side) — harmless, next navigation redirects to login |
| No conflict with `session_regenerate_id(true)` | Regeneration keeps session data; `last_activity` persists across it |

Note: sessions created **before deployment** have no `last_activity` → they are expired once on their first post-deployment request (fail-safe interpretation of "no recorded activity"). Users log in one time after rollout.

---

## Rate Limit Implementation (P1-D)

| Requirement | Implementation |
|---|---|
| Move off `$_SESSION` | All three counters methods rewritten to use the `login_attempts` table via PDO prepared statements; no session usage remains in the limiter |
| Keyed by IP **and** email/identifier | Two dimensions per check: (1) identifier row (email), max **5** attempts / 15 min (existing window preserved); (2) IP row keyed `ip:sha256(REMOTE_ADDR)`, max **20** attempts / 15 min across all emails (anti credential-stuffing) |
| Survives Incognito / cookie deletion / new sessions / other devices same IP | Counters are server-side in MySQL; only the IP dimension ties devices sharing a source IP |
| Records failed attempts safely | New `recordFailedLoginAttempt($email, $ip)` called **only** on the two failure paths of `login.php` (unknown email, wrong password). Atomic upsert: `INSERT … ON DUPLICATE KEY UPDATE attempts = IF(window expired → 1, else attempts+1)` — InnoDB row locking, no app-level race |
| No passwords/secrets stored | Table holds identifier, hashed IP, counters, timestamps only |
| Timestamps for window & cleanup | `first_attempt_at` drives the 15-min window; `last_attempt_at` (`ON UPDATE CURRENT_TIMESTAMP`) drives the 24h purge, piggy-backed on ~1% of checks (`maybePurgeOldLoginAttempts`) — no cron needed on cPanel |
| Existing 429 message kept | Identical: `"Too many login attempts. Please try again in N minutes."` with 429 (`login.php`) |
| No email-existence disclosure | Both failure paths return the same generic `401 Invalid credentials`; 429 text is identical for existing/non-existing emails; recording happens for unknown emails too |
| Legitimate login not broken | Successful login deletes the email counter (`clearRateLimit` inside `loginUser`, case-insensitive via `utf8mb4_unicode_ci`); valid credentials always authenticate unless the identifier/IP is actively locked |
| Minimal architecture change | `checkRateLimit`/`getRateLimitRemaining` gain an `$ip` parameter (internal API only, single caller updated); `clearRateLimit` signature unchanged; login flow order preserved (validate → rate check → lookup → verify) |
| cPanel + PHP + MySQL only | Pure PDO/MySQL; no Redis/Node/Docker/workers |

Failure-mode policy: limiter DB error → `checkRateLimit` fails **open** (login cannot succeed anyway — the user lookup uses the same DB and returns the generic 500); `recordFailedLoginAttempt` / `clearRateLimit` are best-effort inside try/catch.

---

## Security Considerations

- **Authentication / session architecture:** unchanged except the additive idle check; fixation protection, cookie flags, regeneration, destruction all intact.
- **RBAC / Tenant isolation / Super Admin isolation:** untouched — the idle check sits below role logic and applies uniformly; no endpoint logic changed.
- **CSRF:** untouched — no token flow modified.
- **Logout:** untouched (regression-checked below).
- **Routing / UI / Landing:** untouched (no frontend files modified).
- **Known trade-off (documented, accepted):** identifier-based locking allows an attacker to temporarily lock a victim's email for up to 15 minutes by burning 5 attempts (account-lockout DoS). Mitigations already in place: short window, clear-on-success, generic responses reveal nothing. Raising this would require product decisions (e.g., CAPTCHA) — out of scope.
- **IP source:** `$_SERVER['REMOTE_ADDR']` (reliable on cPanel shared hosting; `X-Forwarded-For` deliberately NOT trusted).
- **Privacy:** raw client IPs never stored (one-way SHA-256).
- **Timezone note:** window math compares PHP `time()` with MySQL `DATETIME` parsed by `strtotime`; both use server time on typical cPanel hosts (consistent with existing `CURRENT_DATE()` usage).

---

## Tests Passed (executed in audit environment)

| Test | Result |
|---|---|
| `git diff --check` | ✅ PASS (after fixing one added trailing-whitespace line) |
| Whole-file brace/paren balance delta for `auth.php`, `login.php`, `schema.sql` (HEAD vs working) | ✅ PASS — delta (0,0) for all three |
| Scope check: only PHP + SQL modified, no JS/CSS/HTML/.htaccess | ✅ PASS |
| JS syntax checks | ✅ N/A — no JavaScript file modified |
| P1-A / P1-B regression markers present | ✅ PASS |
| Static traces (below) | ✅ PASS (STATIC) |

### Idle Timeout — static trace

| # | Scenario | Expected | Static outcome |
|---|---|---|---|
| 1 | New login → authenticated request | 200; `last_activity` set at login | ✅ `loginUser()` init |
| 2 | Authenticated activity within 30 min | session continues; timestamp refreshed | ✅ update after check in `getCurrentUser()` |
| 3 | No activity > 30 min → next protected request | `logout()` destroys session → 401 | ✅ expiry branch |
| 4 | After expiry → router navigation | probe 401 → cached role cleared → redirect `/110/login` | ✅ existing guard/probe path (app.js:185-199, 57-59) |
| 5 | Logout after fresh activity | unchanged flow | ✅ |
| 6 | All five roles | identical enforcement (single choke point, no role branches) | ✅ |
| 7 | Public/unauthenticated requests | never touch `last_activity` | ✅ early return before update |

### Rate Limit — static trace

| # | Scenario | Expected | Static outcome |
|---|---|---|---|
| 1 | Correct credentials, no failures | login succeeds; email counter deleted on success | ✅ |
| 2 | Repeated wrong password | each failure recorded (email row + IP row) | ✅ two failure paths call `recordFailedLoginAttempt` |
| 3 | 6th attempt within 15 min (same email) | 429 with existing message | ✅ `loginAttemptsExceedLimit` ≥ 5 |
| 4 | Fresh cookie/incognito/new session between attempts | limit still enforced (DB-backed) | ✅ no session dependency |
| 5 | Different emails, same IP | IP dimension blocks after 20 attempts | ✅ IP row check |
| 6 | No password/secret stored | table columns verified | ✅ |
| 7 | Email existence | identical 401/429 responses either way | ✅ |
| 8 | Window expiry | counter resets on next failure (`IF` reset branch); check allows again | ✅ |
| 9 | Concurrent attempts | atomic upsert (InnoDB) — no lost updates | ✅ by construction |
| 10 | Case-varied email | counter matches (unicode_ci), cleared on success | ✅ |

## Tests Not Run (and why)

| Test | Reason |
|---|---|
| `php -l` lint | **No PHP runtime in the audit environment.** Mitigated by full-file balance + structural review; MUST be run on deploy |
| Live DB tests of both features | No MySQL / production access in this environment |
| Browser-level redirect observation | No production access |

---

## Regression Results

| Area | Result |
|---|---|
| Existing logout flow | ✅ Unchanged (`logout.php`, `AuthManager::logout()` untouched) |
| Session regeneration at login | ✅ Unchanged; `last_activity` survives regeneration |
| HttpOnly / Secure / SameSite | ✅ `startSession()` untouched |
| CSRF architecture | ✅ Untouched |
| RBAC gates & Super Admin isolation | ✅ Untouched (idle check is below role logic; uniform) |
| Existing API authorization | ✅ Untouched |
| Routing / Landing / UI | ✅ No frontend files modified |
| P0 fixes | ✅ Nothing conflicts or reverts (branch-sync caveat from prior reports still applies) |
| P1-A (CORS whitelist) | ✅ Verified intact |
| P1-B (ownership/IDOR) | ✅ Verified intact |
| Feature removals | ✅ None |

---

## LIVE Verification Status

**NOT VERIFIED.** Nothing in this report was executed against https://einshtein-store.online/110/ or any live database. All results are STATIC or environment-limited. **No LIVE PASS is claimed.**

**Required deployment sequence (production):**
1. Run the `login_attempts` DDL (migration SQL above) on the production database.
2. `php -l` on `config/auth.php` and `api/login.php` (PHP 8.3).
3. Upload the two modified PHP files.
4. Execute the live matrices: idle (login → wait > 30 min → 401 → `/110/login` redirect; activity keeps session alive; logout still works; all five roles) and rate limit (5 failures → 429; fresh cookies don't reset; IP cap across emails; success clears; window expiry re-allows).
5. Expect one forced re-login for sessions created before deployment (documented behavior).

---

## Remaining P1 Findings (NOT started — stop condition respected)

Per plan numbering: **P1-B (error-UI status mapping), P1-F (reports tab wiring), P1-G (exams tab wiring + modal helper), P1-H (empty states), P1-I (staff permission visibility), P1-J (cross-tenant full-list removal/search), P1-K (dynamic QR signed tokens — separate phase).** Carried: branch-sync with the P0-fixed production state; `php -l` and live matrix execution listed above.

---

**IMPLEMENTATION OF P1-C + P1-D COMPLETE — STOPPED HERE. NO OTHER PHASE OR PLAN ITEM STARTED.**
