-- P1-J-FIX: Study group lesson-time range (من / إلى) — minimal, backward-compatible
--
-- AUDIT RESULT BEFORE THIS MIGRATION:
--   study_groups(id, teacher_id, class_id, name, study_days, class_time,
--                shift, price, payment_scheme, created_at)
--   There are NO existing start_time/end_time columns. class_time already
--   stores the canonical 24h "HH:MM" lesson START for post-P1-J rows and a
--   legacy Arabic display string (e.g. '05:00 مساءً') for older rows. Every
--   existing consumer (teacher dashboard, student dashboard) reads class_time.
--
-- DECISION: class_time is REUSED as the lesson start time — no data is moved,
-- rewritten, or deleted. Only one nullable end-time column is added.
--
-- Apply this file ONCE to an existing database before deploying the matching
-- api/teacher.php. Fresh installations already receive end_time from schema.sql.

ALTER TABLE `study_groups`
  ADD COLUMN `end_time` VARCHAR(5) NULL DEFAULT NULL AFTER `class_time`;

-- No backfill: legacy rows keep end_time = NULL. The UI shows only the start
-- time for those rows, and the next teacher edit through the new من/إلى form
-- stores a validated canonical range (end_time strictly after class_time).
