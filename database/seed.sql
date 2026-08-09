-- ==============================================================================
-- MySQL Demo Seed Data (UTF8MB4)
-- ==============================================================================

SET NAMES utf8mb4;

-- 1. SaaS Settings
INSERT INTO `saas_settings` (`id`, `platform_name`, `default_price_per_student`, `currency`)
VALUES (1, 'منصة إدارة تعليم موحدة (Unified Education Platform)', 50.00, 'ج.م')
ON DUPLICATE KEY UPDATE `platform_name` = VALUES(`platform_name`);

-- 2. Users (Super Admin, 2 Teachers, 1 Staff, 1 Parent, 2 Students)
INSERT INTO `users` (`id`, `name`, `email`, `phone`, `password_hash`, `role`, `avatar`) VALUES
(1, 'م. حسام العطار (مدير المنصة)', 'admin@platform.edu', '01000000001', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'super_admin', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150'),
(2, 'أ. أحمد محمود (فيزياء)', 'ahmed@physics.edu', '01011111111', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'teacher', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150'),
(3, 'أ. سارة عادل (رياضيات)', 'sara@math.edu', '01022222222', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'teacher', 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150'),
(4, 'أ. خالد سامح (سكرتير ومساعد)', 'khaled@staff.edu', '01033333333', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'staff', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150'),
(5, 'م. محمد سعيد علي (ولي أمر)', 'parent@edu.com', '01099999999', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'parent', 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150'),
(6, 'يوسف محمد سعيد (ثالثة ثانوي)', 'youssef@student.edu', '01044444441', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'student', 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=150'),
(7, 'مريم محمد سعيد (أولى ثانوي)', 'mariam@student.edu', '01044444442', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'student', 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150')
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- 3. Teachers Profiles (Multi-Tenant isolation spaces)
INSERT INTO `teachers` (`id`, `user_id`, `name`, `center_name`, `phone`, `address`, `subject`, `price_per_student`) VALUES
(1, 2, 'أ. أحمد محمود', 'سنتر النخبة التعليمي - الدقي', '01011111111', '15 شارع التحرير - الدقي - الجيزة', 'الفيزياء للثانوية العامة', 45.00),
(2, 3, 'أ. سارة عادل', 'أكاديمية التفوق الرياضي - المعادي', '01022222222', '30 شارع النصر - المعادي - القاهرة', 'الرياضيات المتقدمة', 50.00)
ON DUPLICATE KEY UPDATE `center_name` = VALUES(`center_name`);

-- 4. Teacher Staff
INSERT INTO `teacher_staff` (`id`, `teacher_id`, `user_id`, `role_title`, `permissions`) VALUES
(1, 1, 4, 'secretary', '["attendance", "students", "groups", "exams", "reports"]')
ON DUPLICATE KEY UPDATE `role_title` = VALUES(`role_title`);

-- 5. Academic Classes
INSERT INTO `academic_classes` (`id`, `teacher_id`, `name`, `level`, `description`) VALUES
(1, 1, 'ثالثة ثانوي (علمي)', 'sec_3', 'منهج الفيزياء الكامل للثانوية العامة الشعبة العلمية'),
(2, 1, 'أولى ثانوي', 'sec_1', 'أساسيات الفيزياء الميكانيكية والحرارية'),
(3, 1, 'أولى إعدادي', 'prep_1', 'مبادئ العلوم والفيزياء العامة'),
(4, 2, 'ثالثة ثانوي (رياضيات)', 'sec_3', 'التفاضل والتكامل والجبر والهندسة الفراغية'),
(5, 2, 'أولى ثانوي', 'sec_1', 'الجبر وحساب المثلثات والهندسة التحليلية')
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- 6. Study Groups
INSERT INTO `study_groups` (`id`, `teacher_id`, `class_id`, `name`, `study_days`, `class_time`, `shift`, `price`, `payment_scheme`) VALUES
(1, 1, 1, 'مجموعة الأحد والثلاثاء (مسائي)', '["الأحد", "الثلاثاء"]', '05:00 مساءً', 'evening', 350.00, 'monthly'),
(2, 1, 1, 'مجموعة السبت والخميس (صباحي)', '["السبت", "الخميس"]', '10:00 صباحاً', 'morning', 300.00, 'monthly'),
(3, 1, 2, 'مجموعة الإثنين والأربعاء - أولى ثانوي', '["الإثنين", "الأربعاء"]', '04:00 مساءً', 'evening', 60.00, 'per_session'),
(4, 2, 4, 'مجموعة التفوق - الأحد والأربعاء', '["الأحد", "الأربعاء"]', '07:00 مساءً', 'evening', 400.00, 'monthly')
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- 7. Students Profile
INSERT INTO `students` (`id`, `user_id`, `student_code`, `name`, `phone`, `parent_phone`, `parent_user_id`, `grade_level`, `qr_code_token`) VALUES
(1, 6, 'STU-10045', 'يوسف محمد سعيد', '01044444441', '01099999999', 5, 'ثالثة ثانوي', 'QR-STU-10045-SECRET-HASH'),
(2, 7, 'STU-10088', 'مريم محمد سعيد', '01044444442', '01099999999', 5, 'أولى ثانوي', 'QR-STU-10088-SECRET-HASH')
ON DUPLICATE KEY UPDATE `student_code` = VALUES(`student_code`);

-- 8. Student Enrollments (Unified Account linked across multiple Teachers)
INSERT INTO `student_enrollments` (`id`, `teacher_id`, `student_id`, `class_id`, `group_id`, `enrollment_date`, `status`, `payment_status`) VALUES
(1, 1, 1, 1, 1, '2026-01-15', 'active', 'paid'),
(2, 2, 1, 4, 4, '2026-01-20', 'active', 'paid'),
(3, 1, 2, 2, 3, '2026-02-01', 'active', 'paid')
ON DUPLICATE KEY UPDATE `status` = VALUES(`status`);

-- 9. Attendance Records (All 3 Methods: dynamic_qr, id_scanner, manual)
INSERT INTO `attendance_records` (`id`, `teacher_id`, `student_id`, `group_id`, `date`, `status`, `arrival_time`, `departure_time`, `late_minutes`, `method`, `notes`) VALUES
(1, 1, 1, 1, CURRENT_DATE(), 'present', '04:55 مساءً', '07:00 مساءً', 0, 'dynamic_qr', 'تم التسجيل تلقائياً بواسطة الـ QR المتغير لشاشة الفصل'),
(2, 1, 2, 3, CURRENT_DATE(), 'late', '04:20 مساءً', '06:00 مساءً', 20, 'id_scanner', 'تم مسح كارنيه الطالب بواسطة جهاز الـ Scanner'),
(3, 2, 1, 4, '2026-03-25', 'present', '06:50 مساءً', '09:00 مساءً', 0, 'manual', 'تسجيل يدوي بواسطة المدرس')
ON DUPLICATE KEY UPDATE `notes` = VALUES(`notes`);

-- 10. Question Bank (4 types: mcq, true_false, essay, bubble_sheet)
INSERT INTO `question_bank` (`id`, `teacher_id`, `class_id`, `subject`, `question_type`, `question_text`, `options`, `correct_option`, `points`, `difficulty`) VALUES
(1, 1, 1, 'الفيزياء - الفصل الأول: التيار الكهربي', 'mcq', 'تتناسب شدة التيار المار في موصل تناسباً طردياً مع فرق الجهد عند ثبوت:', '["أ: طول الموصل", "ب: مساحة المقطع", "ج: درجة الحرارة", "د: نوع مادة الموصل"]', 'ج: درجة الحرارة', 2.00, 'medium'),
(2, 1, 1, 'الفيزياء - الفصل الأول', 'true_false', 'المقاومة النوعية لموصل تعتمد على مساحة مقطع الموصل وطوله.', '["صواب", "خطأ"]', 'خطأ', 2.00, 'easy'),
(3, 1, 1, 'الفيزياء - قانون كيرشوف', 'essay', 'اشرح خطوات تطبيق القانون الأول والثاني لكيرشوف لحساب شحنات وتيارات دائرة معقدة.', '[]', 'إجابة مقالية نموذجية تتضمن تطبيق قانون حفظ الشحنة وحفظ الطاقة في المسارات المغلقة.', 5.00, 'hard'),
(4, 1, 1, 'الفيزياء - الحث الكهرومغناطيسي', 'bubble_sheet', 'القوة الدافعة الكهربية المستحثة في ملف تتناسب طردياً مع معدل التغير في الفيض المغناطيسي طبقاً لقانون:', '["(A) فاراداي", "(B) لنز", "(C) أمبير", "(D) أوم"]', '(A)', 3.00, 'medium')
ON DUPLICATE KEY UPDATE `question_text` = VALUES(`question_text`);

-- 11. Exams & Results
INSERT INTO `exams` (`id`, `teacher_id`, `class_id`, `group_id`, `title`, `date`, `time`, `duration_minutes`, `exam_type`, `total_points`, `is_published`) VALUES
(1, 1, 1, 1, 'امتحان شهر مارس الشامل في الفيزياء - الباب الأول والثاني', '2026-03-31', '05:00 مساءً', 90, 'monthly', 12.00, 1)
ON DUPLICATE KEY UPDATE `title` = VALUES(`title`);

INSERT INTO `exam_questions` (`id`, `exam_id`, `question_id`, `order_index`, `points`) VALUES
(1, 1, 1, 1, 2.00),
(2, 1, 2, 2, 2.00),
(3, 1, 3, 3, 5.00),
(4, 1, 4, 4, 3.00)
ON DUPLICATE KEY UPDATE `points` = VALUES(`points`);

INSERT INTO `student_exam_results` (`id`, `exam_id`, `student_id`, `teacher_id`, `score`, `max_score`, `status`, `feedback`) VALUES
(1, 1, 1, 1, 11.00, 12.00, 'graded', 'أداء ممتاز يا يوسف، استمر على هذا المستوى في حل أسئلة البابل شيت والمقالي.')
ON DUPLICATE KEY UPDATE `feedback` = VALUES(`feedback`);

-- 12. Homeworks & Submissions
INSERT INTO `homeworks` (`id`, `teacher_id`, `group_id`, `title`, `description`, `due_date`, `max_grade`) VALUES
(1, 1, 1, 'واجب الأسبوع الرابع: مسائل قانون أوم وكيرشوف', 'حل التدريبات رقم 1 إلى 20 في مذكرة الأستاذ ص 45', '2026-04-03', 20.00)
ON DUPLICATE KEY UPDATE `title` = VALUES(`title`);

INSERT INTO `student_homework_submissions` (`id`, `homework_id`, `student_id`, `teacher_id`, `status`, `grade`, `feedback`) VALUES
(1, 1, 1, 1, 'graded', 19.50, 'حل منظم ودقيق جداً')
ON DUPLICATE KEY UPDATE `feedback` = VALUES(`feedback`);

-- 13. Lesson Videos
INSERT INTO `lesson_videos` (`id`, `teacher_id`, `group_id`, `title`, `video_url`, `duration`, `description`) VALUES
(1, 1, 1, 'الشرح التفصيلي للحث الكهرومغناطيسي وقانون فاراداي', 'https://www.youtube.com/embed/dQw4w9WgXcQ', '52 دقيقة', 'شرح شامل مع أمثلة تطبيقية على أسئلة امتحانات سابقة'),
(2, 2, 4, 'مراجعة التفاضل: مشتقات الدوال المثلثية', 'https://www.youtube.com/embed/dQw4w9WgXcQ', '48 دقيقة', 'أهم مسائل الكتاب المدرسي وامتحانات الثانوية العامة السابقة')
ON DUPLICATE KEY UPDATE `title` = VALUES(`title`);

-- 14. Notifications
INSERT INTO `notifications` (`id`, `target_user_id`, `teacher_id`, `title`, `message`, `type`, `is_read`) VALUES
(1, 6, 1, 'تنبيه امتحان شهر مارس', 'تم تحديد موعد امتحان شهر مارس في الفيزياء يوم الأحد القادم الساعة 5:00 مساءً.', 'exam', 0),
(2, 5, 1, 'تقرير حضور يوسف محمد', 'سجل ابنك يوسف الحضور في حصة الفيزياء اليوم في تمام الساعة 04:55 مساءً بواسطة الـ QR المتغير.', 'attendance', 0)
ON DUPLICATE KEY UPDATE `title` = VALUES(`title`);
