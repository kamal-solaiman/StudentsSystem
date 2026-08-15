-- ==============================================================================
-- MySQL Database Schema (InnoDB, utf8mb4_unicode_ci)
-- Unified Education Platform (Multi-Tenant SaaS + Unified Student/Parent Accounts)
-- ==============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 1. Users table (Unified Identity across Super Admin, Teachers, Staff, Students, Parents)
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(150) NOT NULL,
  `email` VARCHAR(150) NOT NULL UNIQUE,
  `phone` VARCHAR(30) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `role` ENUM('super_admin', 'teacher', 'staff', 'student', 'parent') NOT NULL,
  `avatar` VARCHAR(255) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Teachers Profile & Multi-Tenant Space (Active tenant isolation by teacher_id)
CREATE TABLE IF NOT EXISTS `teachers` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `center_name` VARCHAR(200) NOT NULL,
  `phone` VARCHAR(30) NOT NULL,
  `address` VARCHAR(255) NOT NULL,
  `logo` VARCHAR(255) NULL,
  `subject` VARCHAR(100) NOT NULL,
  `price_per_student` DECIMAL(10,2) NOT NULL DEFAULT 50.00,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_teacher_user` (`user_id`),
  CONSTRAINT `fk_teacher_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Teacher Staff (Secretary / Assistant with custom JSON permissions)
CREATE TABLE IF NOT EXISTS `teacher_staff` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `teacher_id` INT UNSIGNED NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  `role_title` ENUM('secretary', 'assistant') NOT NULL DEFAULT 'secretary',
  `permissions` JSON NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_staff_teacher` (`teacher_id`),
  CONSTRAINT `fk_staff_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_staff_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Academic Classes
-- level stores the educational stage; grade stores the grade within that stage.
-- name is a backend-derived canonical display value (e.g. الصف الأول الإعدادي).
CREATE TABLE IF NOT EXISTS `academic_classes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `teacher_id` INT UNSIGNED NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `level` VARCHAR(50) NOT NULL,
  `grade` VARCHAR(20) NULL,
  `description` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_class_teacher` (`teacher_id`),
  CONSTRAINT `fk_class_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Study Groups (المجموعات)
CREATE TABLE IF NOT EXISTS `study_groups` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `teacher_id` INT UNSIGNED NOT NULL,
  `class_id` INT UNSIGNED NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `study_days` JSON NOT NULL,
  `class_time` VARCHAR(50) NOT NULL,
  `end_time` VARCHAR(5) NULL DEFAULT NULL,
  `shift` ENUM('morning', 'evening') NOT NULL DEFAULT 'evening',
  `price` DECIMAL(10,2) NOT NULL,
  `payment_scheme` ENUM('monthly', 'per_session') NOT NULL DEFAULT 'monthly',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_group_teacher` (`teacher_id`),
  KEY `idx_group_class` (`class_id`),
  CONSTRAINT `fk_group_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_group_class` FOREIGN KEY (`class_id`) REFERENCES `academic_classes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Students Profile (Unified Student Account across Teachers)
CREATE TABLE IF NOT EXISTS `students` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NOT NULL,
  `student_code` VARCHAR(50) NOT NULL UNIQUE,
  `name` VARCHAR(150) NOT NULL,
  -- P1-K: optional profile fields, never mandatory.
  `gender` ENUM('male', 'female') NULL DEFAULT NULL,
  `date_of_birth` DATE NULL DEFAULT NULL,
  `phone` VARCHAR(30) NOT NULL,
  `parent_phone` VARCHAR(30) NOT NULL,
  `parent_user_id` INT UNSIGNED NULL,
  `address` VARCHAR(255) NULL DEFAULT NULL,
  `notes` TEXT NULL DEFAULT NULL,
  `grade_level` VARCHAR(100) NOT NULL,
  `qr_code_token` VARCHAR(150) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_student_code` (`student_code`),
  KEY `idx_student_parent` (`parent_user_id`),
  KEY `idx_student_phone` (`phone`),
  KEY `idx_student_name` (`name`),
  CONSTRAINT `fk_student_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_student_parent` FOREIGN KEY (`parent_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Student Enrollments (Linking Student to multiple Teachers & Groups)
CREATE TABLE IF NOT EXISTS `student_enrollments` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `teacher_id` INT UNSIGNED NOT NULL,
  `student_id` INT UNSIGNED NOT NULL,
  `class_id` INT UNSIGNED NOT NULL,
  `group_id` INT UNSIGNED NOT NULL,
  `enrollment_date` DATE NOT NULL,
  `status` ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  `payment_status` ENUM('paid', 'pending', 'overdue') NOT NULL DEFAULT 'paid',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_enrollment_teacher` (`teacher_id`),
  KEY `idx_enrollment_student` (`student_id`),
  KEY `idx_enrollment_group` (`group_id`),
  -- P1-K: one enrollment (= one group) per teacher per student, enforced by the DB.
  UNIQUE KEY `uq_enrollment_teacher_student` (`teacher_id`, `student_id`),
  CONSTRAINT `fk_enrollment_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_enrollment_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Attendance Records (3 Methods: dynamic_qr, id_scanner, manual)
CREATE TABLE IF NOT EXISTS `attendance_records` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `teacher_id` INT UNSIGNED NOT NULL,
  `student_id` INT UNSIGNED NOT NULL,
  `group_id` INT UNSIGNED NOT NULL,
  `date` DATE NOT NULL,
  `status` ENUM('present', 'absent', 'late') NOT NULL DEFAULT 'present',
  `arrival_time` VARCHAR(30) NULL,
  `departure_time` VARCHAR(30) NULL,
  `late_minutes` INT NOT NULL DEFAULT 0,
  `method` ENUM('dynamic_qr', 'id_scanner', 'manual') NOT NULL,
  `notes` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_att_teacher_date` (`teacher_id`, `date`),
  KEY `idx_att_student` (`student_id`),
  CONSTRAINT `fk_att_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_att_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. Question Bank (4 Types: mcq, true_false, essay, bubble_sheet)
CREATE TABLE IF NOT EXISTS `question_bank` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `teacher_id` INT UNSIGNED NOT NULL,
  `class_id` INT UNSIGNED NOT NULL,
  `subject` VARCHAR(150) NOT NULL,
  `question_type` ENUM('mcq', 'true_false', 'essay', 'bubble_sheet') NOT NULL,
  `question_text` TEXT NOT NULL,
  `options` JSON NOT NULL,
  `correct_option` TEXT NOT NULL,
  `points` DECIMAL(6,2) NOT NULL DEFAULT 2.00,
  `difficulty` ENUM('easy', 'medium', 'hard') NOT NULL DEFAULT 'medium',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_qb_teacher` (`teacher_id`),
  CONSTRAINT `fk_qb_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. Exams (إنشاء امتحان)
CREATE TABLE IF NOT EXISTS `exams` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `teacher_id` INT UNSIGNED NOT NULL,
  `class_id` INT UNSIGNED NOT NULL,
  `group_id` INT UNSIGNED NULL,
  `title` VARCHAR(200) NOT NULL,
  `date` DATE NOT NULL,
  `time` VARCHAR(30) NOT NULL,
  `duration_minutes` INT NOT NULL,
  `exam_type` ENUM('quiz', 'monthly', 'midterm', 'final') NOT NULL DEFAULT 'monthly',
  `total_points` DECIMAL(8,2) NOT NULL DEFAULT 100.00,
  `is_published` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_exam_teacher` (`teacher_id`),
  CONSTRAINT `fk_exam_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11. Exam Questions Link
CREATE TABLE IF NOT EXISTS `exam_questions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `exam_id` INT UNSIGNED NOT NULL,
  `question_id` INT UNSIGNED NOT NULL,
  `order_index` INT NOT NULL DEFAULT 1,
  `points` DECIMAL(6,2) NOT NULL DEFAULT 5.00,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_eq_exam` FOREIGN KEY (`exam_id`) REFERENCES `exams` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_eq_qb` FOREIGN KEY (`question_id`) REFERENCES `question_bank` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 12. Student Exam Results
CREATE TABLE IF NOT EXISTS `student_exam_results` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `exam_id` INT UNSIGNED NOT NULL,
  `student_id` INT UNSIGNED NOT NULL,
  `teacher_id` INT UNSIGNED NOT NULL,
  `score` DECIMAL(8,2) NOT NULL,
  `max_score` DECIMAL(8,2) NOT NULL,
  `status` ENUM('graded', 'pending', 'absent') NOT NULL DEFAULT 'graded',
  `submitted_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `feedback` TEXT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_res_exam` FOREIGN KEY (`exam_id`) REFERENCES `exams` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_res_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 13. Homeworks (الواجبات)
CREATE TABLE IF NOT EXISTS `homeworks` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `teacher_id` INT UNSIGNED NOT NULL,
  `group_id` INT UNSIGNED NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `description` TEXT NOT NULL,
  `due_date` DATE NOT NULL,
  `max_grade` DECIMAL(6,2) NOT NULL DEFAULT 20.00,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_hw_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 14. Student Homework Submissions
CREATE TABLE IF NOT EXISTS `student_homework_submissions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `homework_id` INT UNSIGNED NOT NULL,
  `student_id` INT UNSIGNED NOT NULL,
  `teacher_id` INT UNSIGNED NOT NULL,
  `status` ENUM('submitted', 'graded', 'missing') NOT NULL DEFAULT 'graded',
  `grade` DECIMAL(6,2) NOT NULL DEFAULT 18.00,
  `feedback` TEXT NULL,
  `submitted_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_sub_hw` FOREIGN KEY (`homework_id`) REFERENCES `homeworks` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_sub_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 15. Lesson Videos (الدروس المسجلة)
CREATE TABLE IF NOT EXISTS `lesson_videos` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `teacher_id` INT UNSIGNED NOT NULL,
  `group_id` INT UNSIGNED NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `video_url` VARCHAR(500) NOT NULL,
  `duration` VARCHAR(50) NOT NULL,
  `description` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_vid_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `teachers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 16. Notifications across platform
CREATE TABLE IF NOT EXISTS `notifications` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `target_user_id` INT UNSIGNED NOT NULL,
  `teacher_id` INT UNSIGNED NULL,
  `title` VARCHAR(200) NOT NULL,
  `message` TEXT NOT NULL,
  `type` ENUM('exam', 'attendance', 'payment', 'general') NOT NULL DEFAULT 'general',
  `is_read` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_notif_user` FOREIGN KEY (`target_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 17. SaaS Settings
CREATE TABLE IF NOT EXISTS `saas_settings` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `platform_name` VARCHAR(200) NOT NULL DEFAULT 'منصة إدارة تعليم موحدة',
  `default_price_per_student` DECIMAL(10,2) NOT NULL DEFAULT 50.00,
  `currency` VARCHAR(20) NOT NULL DEFAULT 'ج.م',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 18. Login Attempts (P1-D: database-backed login rate limiting)
-- Counters are keyed by identifier (email) and by hashed-IP key ('ip:<sha256>').
-- Stores ONLY identifier / hashed IP / attempt counters / timestamps.
-- NEVER stores passwords or any secret.
CREATE TABLE IF NOT EXISTS `login_attempts` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `identifier`       VARCHAR(190) NOT NULL,
  `ip_hash`          CHAR(64)     NOT NULL,
  `attempts`         INT UNSIGNED NOT NULL DEFAULT 1,
  `first_attempt_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_attempt_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_login_attempts_identifier` (`identifier`),
  KEY `idx_login_attempts_last` (`last_attempt_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
