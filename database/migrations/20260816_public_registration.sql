-- P1-M — Public registration, controlled subjects and teacher approval
-- MySQL/InnoDB focused migration. Apply exactly once, before deploying P1-M PHP.
--
-- IMPORTANT: MySQL DDL implicitly commits. Run these PRE-FLIGHT checks first:
--
--   SELECT email, COUNT(*) c FROM users GROUP BY email HAVING c > 1;
--   SELECT user_id, COUNT(*) c FROM students GROUP BY user_id HAVING c > 1;
--   SHOW TABLES LIKE 'subjects';
--   SHOW COLUMNS FROM users LIKE 'username';
--
-- Expected: no duplicate emails, no duplicate students.user_id, and no P1-M
-- subjects/username objects. If a previous attempt stopped part-way, DO NOT
-- rerun this whole file: inspect SHOW COLUMNS/SHOW INDEX/SHOW CREATE TABLE,
-- apply only the remaining statements, and verify the canonical subject rows
-- (IDs 1..10 below) before adding fk_teacher_subject. No data is dropped here.

-- The unified users table remains the only authentication/parent identity store.
ALTER TABLE `users`
  ADD COLUMN `username` VARCHAR(150) NULL AFTER `name`,
  ADD COLUMN `registration_phone_key` VARCHAR(30) NULL DEFAULT NULL AFTER `phone`,
  ADD COLUMN `account_status` ENUM('active', 'pending', 'rejected') NOT NULL DEFAULT 'active' AFTER `role`,
  ADD COLUMN `date_of_birth` DATE NULL DEFAULT NULL AFTER `avatar`,
  ADD COLUMN `gender` ENUM('male', 'female') NULL DEFAULT NULL AFTER `date_of_birth`,
  ADD COLUMN `address` VARCHAR(255) NULL DEFAULT NULL AFTER `gender`;

-- Existing accounts retain their login and access behavior. The nullable phone
-- key is intentionally NOT backfilled: legacy users may legitimately share a
-- phone. New public accounts reserve a normalized key atomically.
UPDATE `users` SET `username` = `email` WHERE `username` IS NULL OR `username` = '';
ALTER TABLE `users`
  MODIFY COLUMN `username` VARCHAR(150) NOT NULL,
  ADD UNIQUE KEY `uq_users_username` (`username`),
  ADD UNIQUE KEY `uq_users_registration_phone_key` (`registration_phone_key`);

-- One global student profile per unified user account. student_code already has
-- its own UNIQUE constraint; this closes a second race path at the entity level.
ALTER TABLE `students`
  ADD UNIQUE KEY `uq_students_user_id` (`user_id`);

-- Controlled canonical subject catalog with stable IDs shared by migration and seed.
CREATE TABLE `subjects` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  `normalized_name` VARCHAR(100) NOT NULL,
  `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_subjects_normalized_name` (`normalized_name`),
  KEY `idx_subjects_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `subjects` (`id`, `name`, `normalized_name`, `status`) VALUES
  (1, 'رياضيات', 'رياضيات', 'active'),
  (2, 'اللغة العربية', 'اللغه العربيه', 'active'),
  (3, 'اللغة الإنجليزية', 'اللغه الانجليزيه', 'active'),
  (4, 'الفيزياء', 'الفيزياء', 'active'),
  (5, 'الكيمياء', 'الكيمياء', 'active'),
  (6, 'العلوم', 'العلوم', 'active'),
  (7, 'الدراسات الاجتماعية', 'الدراسات الاجتماعيه', 'active'),
  (8, 'الأحياء', 'الاحياء', 'active'),
  (9, 'التاريخ', 'التاريخ', 'active'),
  (10, 'الجغرافيا', 'الجغرافيا', 'active');

-- Keep teachers.subject as a synchronized compatibility cache for legacy
-- consumers. subjects.name through subject_id is authoritative.
ALTER TABLE `teachers`
  ADD COLUMN `subject_id` INT UNSIGNED NULL AFTER `subject`,
  ADD COLUMN `bio` TEXT NULL AFTER `subject_id`,
  ADD KEY `idx_teacher_subject` (`subject_id`),
  ADD CONSTRAINT `fk_teacher_subject` FOREIGN KEY (`subject_id`) REFERENCES `subjects` (`id`) ON DELETE RESTRICT;

-- Explicit, deterministic aliases only. No wildcard LIKE matching: ambiguous or
-- unknown legacy values remain NULL and continue to display teachers.subject.
UPDATE `teachers`
SET `subject_id` = CASE TRIM(`subject`)
  WHEN 'رياضيات' THEN 1
  WHEN 'الرياضيات' THEN 1
  WHEN 'الرياضيات المتقدمة' THEN 1
  WHEN 'اللغة العربية' THEN 2
  WHEN 'لغة عربية' THEN 2
  WHEN 'اللغة الإنجليزية' THEN 3
  WHEN 'لغة إنجليزية' THEN 3
  WHEN 'الفيزياء' THEN 4
  WHEN 'الفيزياء للثانوية العامة' THEN 4
  WHEN 'الكيمياء' THEN 5
  WHEN 'العلوم' THEN 6
  WHEN 'الدراسات الاجتماعية' THEN 7
  WHEN 'الأحياء' THEN 8
  WHEN 'التاريخ' THEN 9
  WHEN 'الجغرافيا' THEN 10
  ELSE NULL
END
WHERE `subject_id` IS NULL;
