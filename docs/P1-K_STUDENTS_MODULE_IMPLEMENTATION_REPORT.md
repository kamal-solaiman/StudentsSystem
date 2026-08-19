# P1-K — TEACHER "الطلاب" (STUDENTS) MODULE — IMPLEMENTATION REPORT

**Repository:** `kamal-solaiman/StudentsSystem`
**Branch:** `arena/01a006ac-studentssystem` (branched from `main` @ `745b3ff`)
**Date:** 2026-08-15
**Status:** implemented + tested locally. **Nothing committed, nothing pushed, no PR** (per instruction).

> **Verification honesty note (read first).**
> This report distinguishes four evidence levels and never mixes them:
> - **[STATIC]** — verified by reading/parsing the source or by a source-contract assertion in a test.
> - **[SIM]** — simulated: the real frontend module executed in a Node `vm` sandbox with a fake `fetch`/modal.
> - **[REAL-PHP]** — the **real** `api/teacher.php` + real `config/auth.php` + real `config/helper.php` executed in a **real PHP 8.4 interpreter** (php-wasm) against a **real SQL engine** (PGlite/PostgreSQL).
> - **[NOT DONE]** — not performed in this environment.
>
> **No live MySQL, no browser, and no production deployment were used or verified.** The `php` CLI is not installed in this sandbox (`php: command not found`), so `php -l`, `php -S` and MySQL connections were impossible. Everything labelled **[REAL-PHP]** ran under php-wasm with a PostgreSQL-dialect database; three documented harness-only shims are listed in §17.

---

## 1. Architecture audit performed BEFORE any modification

Read in full before touching a line: `database/schema.sql`, `database/seed.sql`, `api/teacher.php`, `api/student.php`, `api/parent.php`, `api/login.php`, `api/reports.php`, `config/auth.php`, `config/database.php`, `config/helper.php`, `assets/js/api.js`, `assets/js/modal.js`, `assets/js/router.js`, `assets/js/app.js`, `assets/js/teacher.js`.

| Question | Answer found in the existing system |
|---|---|
| Is there a global student table? | **Yes** — `students` (18-table schema, §6). It is already platform-global; it has no `teacher_id`. |
| Unique business identifier? | **Yes** — `students.student_code VARCHAR(50) NOT NULL UNIQUE`. No new identifier was invented. |
| Teacher ↔ student relation? | **Yes** — `student_enrollments(teacher_id, student_id, class_id, group_id, enrollment_date, status, payment_status)`. |
| Student authentication? | Shared `users` table (`role='student'`), linked by `students.user_id` → `users.id`. Login is `api/login.php` against `users.email` + `password_hash`. |
| Parent model? | `users` rows with `role='parent'`, linked from `students.parent_user_id` (NULLABLE) plus a plain `students.parent_phone`. **One parent → many students already supported.** |
| Academic classes / groups? | `academic_classes(teacher_id, name, level, grade)` (P1-I) and `study_groups(teacher_id, class_id, …)` (P1-J) — both teacher-scoped. |
| Ownership / tenancy? | `AuthManager` session, `$user['tenant_teacher_id']`, per-row `teacher_id`, `requirePermission('students')` for staff. |

**Conclusion of the audit: no parallel student system, no parallel auth, no parallel parent system, and no new "teacher_students" table were needed.** P1-K reuses all of the above.

---

## 2. Files changed / added

```
 M api/reports.php                                         (+8 / -2)
 M api/teacher.php                                         (+~700)
 M assets/js/api.js                                        (+40)
 M assets/js/teacher.js                                    (+535)
 M database/schema.sql                                     (+10)
?? database/migrations/20260815_students_module_p1k.sql    (new, 67 L)
?? tests/students_module_frontend.test.js                  (new, 670 L, 45 tests)
?? tests/students_module_backend_phpwasm.test.js           (new, 1088 L, 43 tests)
?? P1-K_STUDENTS_MODULE_IMPLEMENTATION_REPORT.md           (this report)
```

No file was deleted, renamed or reverted. No pre-existing uncommitted work existed at start (`git status` was clean).

---

## 3. Data model: what changed and why (minimum necessary)

`database/migrations/20260815_students_module_p1k.sql` — **additive only. Nothing dropped, renamed or rewritten; no data deletion.**

1. **Four NULLABLE profile columns on `students`**: `gender ENUM('male','female') NULL`, `date_of_birth DATE NULL`, `address VARCHAR(255) NULL`, `notes TEXT NULL`. Reason: the P1-K form must store them and they did not exist. All nullable — **no field was made mandatory**.
2. **Search indexes**: `idx_student_phone(phone)`, `idx_student_name(name)` (`student_code` was already indexed).
3. **`UNIQUE KEY uq_enrollment_teacher_student (teacher_id, student_id)`** on `student_enrollments` — makes "one group per teacher per student" a real DB guarantee, not just a PHP check. The migration includes the pre-flight duplicate-detection query and explicitly refuses to auto-delete anything.
4. **`idx_enrollment_group(group_id)`** for roster filtering.

**Deliberately NOT changed:** no new `status` column (the existing `student_enrollments.status ENUM('active','inactive')` is reused for hide/unlink), no new parent table, no new student-code column, no change to `users`, no destructive statement anywhere. `database/schema.sql` was updated to match so fresh installs need no migration.

---

## 4. Backend — `api/teacher.php`

Five new actions inside the existing POST `{action, payload}` envelope, plus new pure helpers above the endpoint:

| Action | Purpose | Key guarantees |
|---|---|---|
| `search_students` | Server-side, class-filtered search by code / name / phone / parent phone | `LIMIT 20`, LIKE wildcards escaped, minimum fields only, phone masked for students not linked to me |
| `create_student` | New global student + `users` account + enrollment, **one transaction** | Only `name` required; duplicate code/email → 409; rollback on any failure |
| `enroll_existing_student` | Explicit opt-in link to an existing student, **transaction** | Enrollment only — `users`/`students`/parent untouched; reactivates a previously hidden row |
| `transfer_student_group` | Move between MY groups of the SAME class | **UPDATE only**, never an INSERT |
| `unlink_student` | "Delete" = hide for me | `UPDATE student_enrollments SET status='inactive'` — **no `DELETE FROM students` exists anywhere in the module** |

Removed: the old `all_platform_students` full-directory dump from the GET payload (privacy — see §11).
Changed: the GET students list is now `WHERE se.teacher_id = :tid AND se.status = 'active'`.

`api/reports.php` — the teacher roster report now also filters `se.status = 'active'` so a hidden student disappears from the teacher's own reports. Historical attendance statistics are deliberately left untouched (removing a student must not rewrite past session history).

---

## 5. Frontend

- `assets/js/api.js` — 5 thin helpers (`searchStudents`, `createStudent`, `enrollExistingStudent`, `transferStudentGroup`, `unlinkStudent`). They reuse the existing `ApiClient.request()` (envelope, `/110/` prefix, CSRF header **and** body, 401 handling). **No `deleteStudent` helper exists**, and `teacher_id` is never sent.
- `assets/js/teacher.js` — 5 top-level pure helpers + 10 controller methods implementing the search-first flow, reusing the existing `AppModal`, the existing per-tab message banner pattern, the existing `[data-action]` binding convention, and the existing Arabic RTL/glassmorphism design system. **The dashboard was not redesigned.**

---

## 6. The 20 required report items (spec §30)

### 1) Existing architecture found before the change
See §1. Global `students` + `student_code` UNIQUE + `student_enrollments` + shared `users` auth + parent via `users.role='parent'`/`students.parent_user_id`. Teacher-scoped `academic_classes`/`study_groups`. **[STATIC]**

### 2) What was reused vs. newly created
**Reused:** `students`, `student_enrollments`, `users`, `academic_classes`, `study_groups`, `AuthManager` (session/CSRF/RBAC/tenant), `Helper::sendJson/sanitizeString/sendForbidden/sendNotFound`, `api/teacher.php` endpoint + its action envelope, `ApiClient`, `AppModal`, the router, the CSS design system.
**New:** five actions, ~10 PHP helper functions, five JS API helpers, the students UI block, four nullable columns, two indexes, one UNIQUE key, two test files. **No new table, no new API file, no new auth path, no new parent system.** **[STATIC]**

### 3) Migrations executed (or not)
`database/migrations/20260815_students_module_p1k.sql` was **written but NOT executed against any live database** — there is no MySQL in this sandbox. **[NOT DONE — deployment step]**. Its equivalent DDL *was* executed inside the php-wasm/PGlite test database, where all P1-K behavior tests ran. **[REAL-PHP]**

### 4) Search-first flow implementation
Modal step 1 = class → group → query (`openStudentModal`), which calls `search_students` on the server. Step 2 renders `renderStudentSearchPanel()` with one of three outcomes: *not found* → "إضافة طالب جديد"; *found & not linked to me* → badge "الطالب مسجل بالفعل" + button "**إضافة الطالب إلى المجموعة**"; *found & already mine* → badge "الطالب مضاف بالفعل" + current class/group + "نقل إلى مجموعة أخرى". Verified by simulated render tests 20–25 and source contract 26. **[SIM]** + backend search behavior **[REAL-PHP]** (tests 1–8).

### 5) Duplicate-student prevention
Four layers: (a) the UI never offers "create" without a prior search; (b) `create_student` pre-checks `student_code` and `email` → 409; (c) `enroll_existing_student` pre-checks an existing enrollment → 409 `already_linked`; (d) the DB `UNIQUE (teacher_id, student_id)` + `students.student_code UNIQUE` are the real guarantees, and a PDO `23000/23505` is converted to a friendly 409 instead of a 500. **[REAL-PHP]** tests 22, 23, 24, 25.

### 6) One-group-per-teacher-per-student enforcement
`transfer_student_group` performs an `UPDATE student_enrollments SET group_id = …` on the single existing row and never inserts; `enroll_existing_student` reactivates the existing row instead of inserting a second one; the UNIQUE key blocks anything else. **[REAL-PHP]** tests 18, 26, 27, 28, 29 (post-conditions assert `rows.length === 1` and that the row id is unchanged).

### 7) Academic-class hard backend filter
`teacherStudentClassFilterSql()` is applied inside `search_students` **and** re-applied inside `enroll_existing_student`; the class itself is resolved through `teacherRequireOwnedClass()` from the session tenant. A student of another class is invisible in search **and** rejected at enrollment even if the client forges the id. **[REAL-PHP]** tests 4, 19; transfer across classes rejected in test 27.

### 8) Deletion behavior
`unlink_student` only sets `status='inactive'`. **[STATIC]** grep confirms there is no `DELETE FROM students` (and no `delete_student` action) anywhere in `api/teacher.php`. **[REAL-PHP]** test 30 asserts after unlink: the `students` row survives, the `users` row survives, the enrollment row survives as `inactive`, and **teacher 2's enrollment for the same student is still `active`**. Test 32/33 assert the student disappears from the GET list and returns after re-linking. Test 42 asserts the DELETE surface still refuses `entity=student`; test 43 asserts `delete_student` is an unknown action.

### 9) Credentials handling
Teacher-created student → `users.role='student'`, `email` = the entered email lowercased (or `stu-xxxxx@student.local` when omitted, because `users.email` is `NOT NULL UNIQUE`), password = `00000000` stored as `password_hash(..., PASSWORD_DEFAULT)`. **[REAL-PHP]** test 15 asserts `password_verify('00000000', stored_hash) === true` **and** that the plaintext is not stored. Test 16 asserts that linking an existing student leaves `password_hash`, `email`, `name`, `student_code` and `parent_user_id` **byte-identical** and creates **no** new `users` row.

### 10) Parent handling
The teacher flow stores at most `students.parent_phone` and **never** creates a parent account, parent credentials or a `parent_user_id` link. **[REAL-PHP]** test 37: after creating a student with a parent phone that matches an existing parent, `SELECT id FROM users WHERE role='parent'` still returns exactly the one pre-existing parent, the new student's `parent_user_id` is `NULL`, and the response contains no `parent_username` / `parent_password`. The existing one-parent-many-students model is untouched.

### 11) Privacy of the search
`search_students` returns exactly 11 fields per row (`id, student_code, name, phone, phone_masked, grade_level, link_state, group_id, group_name, class_id, class_name`), capped at 20 rows, with the phone masked (`010••••••42`) unless the student is already linked to the session tenant, and with `group_*`/`class_*` **nulled** for students who belong to another teacher. The previous `all_platform_students` full dump was **removed** from the GET payload. **[REAL-PHP]** test 2 asserts the exact key set and that no password hash, QR token, email or `parent_user_id` appears in the response; test 3 asserts the masking; test 32 asserts `all_platform_students === undefined`.

### 12) Tenant isolation & IDOR
The teacher id comes **only** from `session.tenant_teacher_id`; `class_id`/`group_id`/`student_id` from the client are always re-resolved and ownership-checked (`teacherRequireOwnedClass`, `teacherRequireOwnedGroup`, enrollment lookups scoped by `teacher_id`). **[REAL-PHP]**: test 6 (search another teacher's class → 403), test 14 (create into another teacher's group → 403), test 29 (transfer into another teacher's group → 403), test 35 (a forged `teacher_id: 1` in the payload is ignored — the row lands on tenant 2), test 36 (teacher 2 cannot unlink/transfer teacher 1's student), test 31 (unlink of a non-linked student → 404 with no cross-tenant write), test 41 (super_admin blocked).

### 13) Transactions
`create_student` wraps `users` + `students` + `student_enrollments` in `beginTransaction/commit` with `rollBack()` on any `Throwable`; `enroll_existing_student` and `transfer_student_group` are likewise transactional and roll back before every early error response. **[STATIC]** + **[REAL-PHP]** test 11 (a rejected create leaves the `students` table at exactly 4 rows) and test 19 (a rejected enroll leaves teacher 1's enrollments untouched).

### 14) Concurrency protection
The DB UNIQUE key is the authority. Test 24 simulates "another request won the race" by inserting the competing enrollment before the endpoint's write path and asserts the endpoint answers **409** while the table still holds exactly one row for `(teacher 1, student 2)`. Test 25 verifies from the live SQL catalog that the unique constraint really is on `(student_id, teacher_id)` and cross-checks that the same key is declared in both `database/schema.sql` and the migration. PDO `23000/23505` is mapped to 409, never to a 500. **[REAL-PHP]**

### 15) RBAC / CSRF
All five actions were added to the staff permission switch behind `requirePermission('students')`, and they sit behind the endpoint's existing `requireRole(['super_admin','teacher','staff'])` + CSRF gate. **[REAL-PHP]** test 38 (all five actions reject a wrong CSRF token → 403 `Invalid CSRF token`), test 39 (staff with `["attendance","groups"]` are denied all five → 403 `Access denied: Insufficient permissions`), test 40 (staff with `["students"]` can search and link, inside their own tenant only), test 41 (super_admin → 403).

### 16) Test suite: what exists and what it proves

| File | Tests | Level |
|---|---|---|
| `tests/students_module_frontend.test.js` | **45** | **[SIM]** + **[STATIC]** |
| `tests/students_module_backend_phpwasm.test.js` | **43** | **[REAL-PHP]** |
| `tests/academic_classes_frontend.test.js` (pre-existing) | 39 | regression |
| `tests/study_groups_frontend.test.js` (pre-existing) | 40 | regression |
| `tests/study_groups_backend_phpwasm.test.js` (pre-existing) | 28 | regression |

Frontend groups: **A** (01–07) ApiClient wiring/CSRF/no-`teacher_id`/no-`deleteStudent`; **B** (08–15) helper contracts (`buildStudentSearchPayload`, `collectStudentPayload` — only `name` required and **no password field**, `studentGroupsForClass`, gender options, HTML escaping); **C** (16–19) students-table render, 8-column empty state, class/group prerequisite gating, message banner; **D** (20–25) the four search outcomes + escaping + dismiss; **E** (26–32) source contracts on `assets/js/teacher.js` (search-first modal, exactly three `required: true` fields, no parent credentials, all six `data-action` bindings, transfer filtered to the same class, unlink wording, no `all_platform_students`); **F/G** (33–45) source contracts on `api/teacher.php`, `api/reports.php`, `database/schema.sql` and the migration.

Backend scenario coverage (spec A–J): **A** new student → 9–14; **B** existing student → 17, 20; **C** already linked → 21; **D** transfer → 26–29; **E** class isolation → 4, 19, 27; **F** tenant isolation → 6, 14, 29, 34, 35, 36; **G** hide/remove → 30–33; **H** parent → 37; **I** credentials → 15, 16; **J** duplicates/concurrency → 22–25.

### 17) Honest limits of the backend test harness
The **real** `api/teacher.php` source is loaded and executed, but three runtime-glue substitutions are applied (identical to the pre-existing P1-J harness): `require_once` of the two config files is inlined; `Helper::getJsonInput()` is redirected to a test stub; `Helper::sendJson()` throws a control-flow exception instead of calling `exit()` (php-wasm cannot survive `exit`). Two dialect accommodations are also required because the harness DB is PostgreSQL, not MySQL: `ESCAPE '\\'` is rewritten to the equivalent Postgres `ESCAPE E'\\'`, and `PDO::commit()` is a no-op (the pglite driver aborts on a real COMMIT; the connection is discarded per test anyway, so in-transaction observable behavior is preserved). **All business logic, validation, RBAC, CSRF, SQL statements and error mapping under test are the unmodified production code.** MySQL-specific behaviors (ENUM coercion, `utf8mb4` collation ordering, `FOR UPDATE` locking semantics, InnoDB deadlocks) are **[NOT DONE]** here.

### 18) Regression results

Baseline **before** any change (three pre-existing files): **39 + 40 + 28 = 107 passing, 0 failing**.
Full suite **after** the change: `node --test tests/*.test.js` → **195 tests, 195 pass, 0 fail, 0 cancelled** (~283 s).

Regression scope covered by those 107 pre-existing tests, all still green: teacher dashboard GET payload, academic classes (P1-I) CRUD + validation + tenant isolation, study groups (P1-J) CRUD + day/time validation + student counts, RBAC (staff permissions, super_admin block), CSRF, the `DELETE ?entity=` surface, the endpoint's 400/403/404/409/500 conventions, ApiClient behavior and the modal system.
**Login for all roles, QR / attendance methods 1–2–3, exams and the question bank were NOT re-executed** — they have no automated suite in this repository and no PHP/browser runtime here. What *is* verified for them: **[STATIC]** none of their files were modified (`git status` shows only the six files in §2); the only cross-module edits are the two `status='active'` filters, whose effects are asserted by backend tests 30–33 and by the unchanged attendance/exam assertions in the P1-J suite. **[NOT DONE]** end-to-end login/QR/attendance runs.

### 19) Known limitations / open items
1. The migration has never been applied to a real MySQL database — the pre-flight duplicate query in its header **must** be run before the `UNIQUE` ALTER on production data.
2. Search pagination is a hard `LIMIT 20` with no "next page"; a teacher must refine the query. Acceptable for the flow, but noted.
3. `search_students` matches the class either by `students.grade_level` equality or by an existing enrollment in an equivalent class (including legacy `sec_3`-style level codes). A student with a *stale* `grade_level` and no enrollment anywhere will not be found under the new class — by design, since the class filter is a hard rule.
4. Placeholder usernames (`stu-xxxxx@student.local`) exist because `users.email` is `NOT NULL UNIQUE`; making it nullable was rejected as an unnecessary schema change.
5. The `show-qr` button in the students table has **no** JS handler — this is a **pre-existing** gap (verified by grep on the original file), not introduced here, and was left alone to stay in scope.
6. No browser test, no screenshot, no production smoke test was performed.

### 20) Explicit statement of what was NOT verified
- **[NOT DONE]** Live MySQL execution of the schema, the migration, or any query.
- **[NOT DONE]** `php -l` / real PHP-FPM / Apache execution (`php` CLI absent).
- **[NOT DONE]** Any browser run: no manual click-through, no Playwright/Selenium, no rendering check of the Arabic RTL layout.
- **[NOT DONE]** Any production or staging deployment, and any verification on `https://…/110/`.
- **[NOT DONE]** End-to-end login as student/parent/teacher/staff/super_admin, QR scanning, attendance methods 1/2/3, exams, question bank — no automated coverage exists for them in this repo.
- **[NOT DONE]** Load/perf testing of the new search indexes.
- **[NOT DONE]** Any git commit, push, PR or merge (explicitly out of scope by instruction).

---

## 7. `git status` at the end of the work

```
 M api/reports.php
 M api/teacher.php
 M assets/js/api.js
 M assets/js/teacher.js
 M database/schema.sql
?? P1-K_STUDENTS_MODULE_IMPLEMENTATION_REPORT.md
?? database/migrations/20260815_students_module_p1k.sql
?? tests/students_module_backend_phpwasm.test.js
?? tests/students_module_frontend.test.js
```

**Modified (5):** `api/teacher.php` (5 new actions + helpers, `all_platform_students` removed, GET filtered to active), `api/reports.php` (roster report filtered to active), `assets/js/api.js` (5 helpers), `assets/js/teacher.js` (helpers + students UI + bindings), `database/schema.sql` (4 nullable columns, 3 indexes, 1 unique key).
**Untracked (4):** the P1-K migration, the two new test files, and this report.

Everything is left **uncommitted** in the working tree, as instructed.
