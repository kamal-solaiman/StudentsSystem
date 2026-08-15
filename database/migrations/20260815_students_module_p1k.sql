-- P1-K Students module — minimal, backward-compatible migration
--
-- AUDIT RESULT BEFORE THIS MIGRATION
-- ---------------------------------------------------------------------------
--   students(id, user_id, student_code UNIQUE, name, phone, parent_phone,
--            parent_user_id, grade_level, qr_code_token, created_at)
--   student_enrollments(id, teacher_id, student_id, class_id, group_id,
--            enrollment_date, status ENUM('active','inactive'),
--            payment_status, created_at)
--
--   * The GLOBAL student entity already exists (`students`) and its business
--     key already exists (`students.student_code`, UNIQUE). Nothing about the
--     identity model needs to change.
--   * The teacher <-> student <-> group relation already exists
--     (`student_enrollments`) and it ALREADY has a `status` column, so the
--     "delete = hide/unlink for this teacher only" rule needs NO new column:
--     it reuses status = 'inactive'.
--   * `students` has NO column for gender / date of birth / address / notes,
--     which the P1-K student form must store. Those four are added here, all
--     NULLABLE, because none of them may be artificially mandatory.
--   * `student_enrollments` has NO uniqueness guarantee for
--     (teacher_id, student_id), so two concurrent "add student" requests could
--     create two enrollments for the same teacher+student. The rule
--     "one group per teacher per student" therefore needs a real DB
--     constraint, not only a backend check.
--
-- NOTHING IS DROPPED, RENAMED OR REWRITTEN. No student row is ever deleted.
-- Apply this file ONCE to an existing database before deploying the matching
-- api/teacher.php. Fresh installations already receive everything below from
-- database/schema.sql.
-- ===========================================================================


-- 1) Optional student profile fields used by the P1-K "add student" form.
--    Every column is NULL-able: a teacher may add a student with a name only.
ALTER TABLE `students`
  ADD COLUMN `gender` ENUM('male', 'female') NULL DEFAULT NULL AFTER `name`,
  ADD COLUMN `date_of_birth` DATE NULL DEFAULT NULL AFTER `gender`,
  ADD COLUMN `address` VARCHAR(255) NULL DEFAULT NULL AFTER `parent_user_id`,
  ADD COLUMN `notes` TEXT NULL DEFAULT NULL AFTER `address`;

-- 2) Search support. The P1-K search is server-side (code / name / phone) and
--    must stay fast as the platform grows; student_code is already indexed.
ALTER TABLE `students`
  ADD KEY `idx_student_phone` (`phone`),
  ADD KEY `idx_student_name` (`name`);


-- 3) "One enrollment per teacher per student" as a REAL database constraint.
--
--    BEFORE RUNNING THE ALTER, verify there is no pre-existing duplicate:
--
--      SELECT teacher_id, student_id, COUNT(*) AS c
--      FROM student_enrollments
--      GROUP BY teacher_id, student_id
--      HAVING c > 1;
--
--    If that query returns rows, resolve them MANUALLY first (keep the row the
--    teacher actually uses and set the others to status='inactive', or delete
--    the redundant enrollment rows after checking attendance_records).
--    This migration deliberately performs NO automatic data deletion.
ALTER TABLE `student_enrollments`
  ADD UNIQUE KEY `uq_enrollment_teacher_student` (`teacher_id`, `student_id`);

-- 4) Index used when listing / filtering a teacher's roster by group.
ALTER TABLE `student_enrollments`
  ADD KEY `idx_enrollment_group` (`group_id`);
