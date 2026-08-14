-- P1-I follow-up: minimal, backward-compatible Academic Classes migration
--
-- AUDIT RESULT BEFORE THIS MIGRATION:
--   academic_classes(id, teacher_id, name, level, description, created_at)
--   All dependent tables reference academic_classes.id, so IDs and foreign keys
--   must remain untouched. The existing level column is reused for the
--   educational stage. Only the nullable grade column is added.
--
-- Apply this file ONCE to an existing database before deploying the matching
-- api/teacher.php. Fresh installations already receive grade from schema.sql.

ALTER TABLE `academic_classes`
  ADD COLUMN `grade` VARCHAR(20) NULL AFTER `level`;

-- Backfill only legacy codes whose stage and grade are unambiguous. Preserve
-- id, teacher_id, name, description, timestamps and every relationship. Names
-- are deliberately not rewritten: the API presents a canonical derived name,
-- and a later teacher edit stores that canonical name authoritatively.
UPDATE `academic_classes`
SET
  `grade` = CASE `level`
    WHEN 'prep_1' THEN 'first'
    WHEN 'prep_2' THEN 'second'
    WHEN 'prep_3' THEN 'third'
    WHEN 'sec_1' THEN 'first'
    WHEN 'sec_2' THEN 'second'
    WHEN 'sec_3' THEN 'third'
    ELSE `grade`
  END,
  `level` = CASE
    WHEN `level` IN ('prep_1', 'prep_2', 'prep_3') THEN 'preparatory'
    WHEN `level` IN ('sec_1', 'sec_2', 'sec_3') THEN 'secondary'
    ELSE `level`
  END
WHERE `grade` IS NULL
  AND `level` IN ('prep_1', 'prep_2', 'prep_3', 'sec_1', 'sec_2', 'sec_3');

-- Existing unknown/custom/general legacy rows intentionally remain with a NULL
-- grade. They remain visible and associated; editing one through the new modal
-- requires a valid stage+grade and upgrades it to the canonical model.
