<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/helper.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../config/auth.php';

Helper::handleCorsOptions();

// SECURITY: Require authentication for all teacher endpoints
$user = AuthManager::requireRole(['super_admin', 'teacher', 'staff']);

// SECURITY: For staff, check dashboard access permission
if ($user['role'] === 'staff') {
    // Staff needs at least one permission to access teacher dashboard
    // This allows them to see the dashboard but specific operations will require specific permissions
    $permissions = AuthManager::getStaffPermissions();
    if (empty($permissions)) {
        Helper::sendForbidden('Access denied: No permissions assigned');
    }
}

// SECURITY: Verify CSRF token for state-changing methods
if (in_array($_SERVER['REQUEST_METHOD'], ['POST', 'DELETE'], true)) {
    $input = Helper::getJsonInput();
    $csrfToken = $input['csrf_token'] ?? null;
    
    // Also check header for CSRF token
    if ($csrfToken === null || $csrfToken === '') {
        $csrfToken = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? null;
    }
    
    if (!AuthManager::validateCsrfToken($csrfToken)) {
        Helper::sendForbidden('Invalid CSRF token');
    }
}

try {
    $db = DatabaseConnection::fromConfigFile()->connect();
    $method = $_SERVER['REQUEST_METHOD'];

    // SECURITY: Extract teacher_id from session context, not from request parameter
    // For teachers and staff, use their tenant_teacher_id
    if ($user['role'] === 'teacher' || $user['role'] === 'staff') {
        $teacherId = (int)$user['tenant_teacher_id'];
        if ($teacherId <= 0) {
            Helper::sendForbidden('Invalid teacher context');
        }
    } elseif ($user['role'] === 'super_admin') {
        // SECURITY FIX: Super Admin should NOT access individual teacher data per business rules
        // Super Admin can only manage platform-level settings, not tenant-specific data
        Helper::sendForbidden('Super Admin cannot access individual teacher dashboard. Use super_admin.php for platform management.');
    } else {
        Helper::sendForbidden('Access denied');
    }

    // GET: Fetch teacher dashboard data with complete Multi-Tenant isolation
    if ($method === 'GET') {
        // Teacher Profile
        $stmtTeacher = $db->prepare('SELECT * FROM teachers WHERE id = :id LIMIT 1');
        $stmtTeacher->execute(['id' => $teacherId]);
        $teacher = $stmtTeacher->fetch();

        if ($teacher === false) {
            Helper::sendJson(['success' => false, 'error' => 'لم يتم العثور على المدرس في المنصة'], 404);
        }

        // Academic Classes & Groups Count
        $stmtClasses = $db->prepare('
            SELECT ac.*, COUNT(sg.id) AS groups_count 
            FROM academic_classes ac 
            LEFT JOIN study_groups sg ON ac.id = sg.class_id 
            WHERE ac.teacher_id = :tid 
            GROUP BY ac.id 
            ORDER BY ac.id ASC
        ');
        $stmtClasses->execute(['tid' => $teacherId]);
        $classes = $stmtClasses->fetchAll();

        // Study Groups
        $stmtGroups = $db->prepare('
            SELECT sg.*, ac.name AS class_name 
            FROM study_groups sg 
            LEFT JOIN academic_classes ac ON sg.class_id = ac.id 
            WHERE sg.teacher_id = :tid 
            ORDER BY sg.id ASC
        ');
        $stmtGroups->execute(['tid' => $teacherId]);
        $groupsRaw = $stmtGroups->fetchAll();
        $groups = [];
        foreach ($groupsRaw as $row) {
            $groups[] = [
                'id' => (int)$row['id'],
                'class_id' => (int)$row['class_id'],
                'class_name' => (string)$row['class_name'],
                'name' => (string)$row['name'],
                'study_days' => json_decode((string)$row['study_days'], true) ?: [],
                'class_time' => (string)$row['class_time'],
                'shift' => (string)$row['shift'],
                'price' => (float)$row['price'],
                'payment_scheme' => (string)$row['payment_scheme']
            ];
        }

        // Enrolled Students with this Teacher
        $stmtStudents = $db->prepare('
            SELECT s.*, se.group_id, se.class_id, se.payment_status, se.enrollment_date,
                   sg.name AS group_name, ac.name AS class_name 
            FROM student_enrollments se 
            JOIN students s ON se.student_id = s.id 
            LEFT JOIN study_groups sg ON se.group_id = sg.id 
            LEFT JOIN academic_classes ac ON se.class_id = ac.id 
            WHERE se.teacher_id = :tid 
            ORDER BY se.id DESC
        ');
        $stmtStudents->execute(['tid' => $teacherId]);
        $students = $stmtStudents->fetchAll();

        // All platform students (for linking an existing unified student account)
        $stmtAllStudents = $db->query('SELECT id, student_code, name, phone, grade_level FROM students ORDER BY id DESC');
        $allPlatformStudents = $stmtAllStudents->fetchAll();

        // Attendance Overview Today
        $today = date('Y-m-d');
        $stmtAttPresent = $db->prepare('SELECT COUNT(*) AS c FROM attendance_records WHERE teacher_id = :tid AND date = :dt AND status = "present"');
        $stmtAttPresent->execute(['tid' => $teacherId, 'dt' => $today]);
        $todayAttendance = (int)$stmtAttPresent->fetch()['c'];

        $stmtAttAbs = $db->prepare('SELECT COUNT(*) AS c FROM attendance_records WHERE teacher_id = :tid AND date = :dt AND status IN ("absent", "late")');
        $stmtAttAbs->execute(['tid' => $teacherId, 'dt' => $today]);
        $todayAbsence = (int)$stmtAttAbs->fetch()['c'];

        // Upcoming Exams
        $stmtExams = $db->prepare('SELECT * FROM exams WHERE teacher_id = :tid ORDER BY id DESC');
        $stmtExams->execute(['tid' => $teacherId]);
        $exams = $stmtExams->fetchAll();

        // Teacher Staff
        $stmtStaff = $db->prepare('
            SELECT ts.*, u.name, u.email, u.phone 
            FROM teacher_staff ts 
            JOIN users u ON ts.user_id = u.id 
            WHERE ts.teacher_id = :tid
        ');
        $stmtStaff->execute(['tid' => $teacherId]);
        $staffRaw = $stmtStaff->fetchAll();
        $staff = [];
        foreach ($staffRaw as $sr) {
            $staff[] = [
                'id' => (int)$sr['id'],
                'user_id' => (int)$sr['user_id'],
                'name' => (string)$sr['name'],
                'phone' => (string)$sr['phone'],
                'role_title' => (string)$sr['role_title'],
                'permissions' => json_decode((string)$sr['permissions'], true) ?: []
            ];
        }

        $activeStudentsCount = count($students);
        $pricePerSt = (float)$teacher['price_per_student'];
        $monthlySub = $activeStudentsCount * $pricePerSt;

        Helper::sendJson([
            'success' => true,
            'teacher' => [
                'id' => (int)$teacher['id'],
                'name' => (string)$teacher['name'],
                'center_name' => (string)$teacher['center_name'],
                'phone' => (string)$teacher['phone'],
                'address' => (string)$teacher['address'],
                'subject' => (string)$teacher['subject'],
                'price_per_student' => $pricePerSt,
                'subscription_monthly' => $monthlySub
            ],
            'classes' => $classes,
            'groups' => $groups,
            'students' => $students,
            'all_platform_students' => $allPlatformStudents,
            'exams' => $exams,
            'staff' => $staff,
            'overview' => [
                'total_students' => $activeStudentsCount,
                'total_classes' => count($classes),
                'total_groups' => count($groups),
                'today_attendance' => $todayAttendance,
                'today_absence' => $todayAbsence,
                'upcoming_exams_count' => count($exams),
                'subscription_monthly' => $monthlySub
            ]
        ]);
    }

    // POST: Create Class, Study Group, Add Student, or Update Settings
    if ($method === 'POST') {
        $input = Helper::getJsonInput();
        $action = Helper::sanitizeString($input['action'] ?? '');
        $payload = is_array($input['payload'] ?? null) ? $input['payload'] : [];

        // SECURITY: For staff, check specific permission for each action
        // P1-I: update_class is a classes operation, same 'classes' permission.
        if ($user['role'] === 'staff') {
            if ($action === 'create_class' || $action === 'update_class' || $action === 'delete-class') {
                AuthManager::requirePermission('classes');
            } elseif ($action === 'create_group' || $action === 'delete-group') {
                AuthManager::requirePermission('groups');
            } elseif ($action === 'create_student' || $action === 'enroll_existing_student') {
                AuthManager::requirePermission('students');
            } elseif ($action === 'update_teacher_settings') {
                AuthManager::requirePermission('settings');
            }
        }

        // ---- P1-I: shared validation helpers for Academic Classes ----
        // Character-aware length check with byte fallback: when mbstring is
        // missing, utf8mb4 encodes at most 4 bytes per character, so a byte
        // limit of 4×chars can never accept more characters than the column.
        $textLen = static function (string $s): int {
            return function_exists('mb_strlen') ? mb_strlen($s, 'UTF-8') : strlen($s);
        };
        $lenLimit = static function (int $chars) use ($textLen): int {
            return function_exists('mb_strlen') ? $chars : $chars * 4;
        };

        // Create Academic Class
        // SECURITY (P1-I): teacher ownership ALWAYS comes from the session
        // tenant ($teacherId). A client-supplied teacher_id is never accepted.
        if ($action === 'create_class') {
            // name: required, string, trimmed, non-empty, <= 150 chars
            if (!is_string($payload['name'] ?? null)) {
                Helper::sendJson(['success' => false, 'error' => 'اسم الصف غير صالح'], 400);
            }
            $name = Helper::sanitizeString($payload['name']);
            if ($name === '') {
                Helper::sendJson(['success' => false, 'error' => 'اسم الصف مطلوب'], 400);
            }
            if ($textLen($name) > $lenLimit(150)) {
                Helper::sendJson(['success' => false, 'error' => 'اسم الصف طويل جداً (الحد الأقصى 150 حرفاً)'], 400);
            }

            // level: required per schema (VARCHAR(50) NOT NULL)
            if (!is_string($payload['level'] ?? null)) {
                Helper::sendJson(['success' => false, 'error' => 'المرحلة الدراسية غير صالحة'], 400);
            }
            $level = Helper::sanitizeString($payload['level']);
            if ($level === '') {
                Helper::sendJson(['success' => false, 'error' => 'المرحلة الدراسية مطلوبة'], 400);
            }
            if ($textLen($level) > $lenLimit(50)) {
                Helper::sendJson(['success' => false, 'error' => 'المرحلة الدراسية طويلة جداً (الحد الأقصى 50 حرفاً)'], 400);
            }

            // description: optional (TEXT NULL)
            $descRaw = $payload['description'] ?? '';
            if ($descRaw !== null && !is_string($descRaw)) {
                Helper::sendJson(['success' => false, 'error' => 'الوصف غير صالح'], 400);
            }
            $desc = $descRaw === null ? '' : Helper::sanitizeString($descRaw);
            if ($textLen($desc) > $lenLimit(1000)) {
                Helper::sendJson(['success' => false, 'error' => 'الوصف طويل جداً (الحد الأقصى 1000 حرف)'], 400);
            }

            $stmt = $db->prepare('
                INSERT INTO academic_classes (teacher_id, name, level, description)
                VALUES (:tid, :name, :level, :descr)
            ');
            $stmt->execute([
                'tid' => $teacherId,
                'name' => $name,
                'level' => $level,
                'descr' => $desc === '' ? null : $desc
            ]);

            Helper::sendJson(['success' => true, 'message' => 'تم إضافة الصف الدراسي بنجاح', 'id' => (int)$db->lastInsertId()]);
        }

        // Update Academic Class
        // SECURITY (P1-I): ownership-aware UPDATE. 404 when the class does not
        // exist, 403 when it belongs to another teacher. No IDOR.
        if ($action === 'update_class') {
            // Reject malformed ids (arrays, floats, non-numeric strings)
            // instead of letting a cast silently coerce them to 1.
            $idRaw = $payload['id'] ?? null;
            $idIsValid = is_int($idRaw)
                || (is_string($idRaw) && $idRaw !== '' && ctype_digit($idRaw));
            if (!$idIsValid) {
                Helper::sendJson(['success' => false, 'error' => 'معرف الصف غير صالح'], 400);
            }
            $classId = (int)$idRaw;
            if ($classId <= 0) {
                Helper::sendJson(['success' => false, 'error' => 'معرف الصف غير صالح'], 400);
            }

            $stmtExists = $db->prepare('SELECT id FROM academic_classes WHERE id = :cid LIMIT 1');
            $stmtExists->execute(['cid' => $classId]);
            if ($stmtExists->fetch() === false) {
                Helper::sendNotFound('الصف الدراسي غير موجود');
            }

            $stmtOwn = $db->prepare('SELECT id FROM academic_classes WHERE id = :cid AND teacher_id = :tid LIMIT 1');
            $stmtOwn->execute(['cid' => $classId, 'tid' => $teacherId]);
            if ($stmtOwn->fetch() === false) {
                Helper::sendForbidden('Access denied');
            }

            // name: required, string, trimmed, non-empty, <= 150 chars
            if (!is_string($payload['name'] ?? null)) {
                Helper::sendJson(['success' => false, 'error' => 'اسم الصف غير صالح'], 400);
            }
            $name = Helper::sanitizeString($payload['name']);
            if ($name === '') {
                Helper::sendJson(['success' => false, 'error' => 'اسم الصف مطلوب'], 400);
            }
            if ($textLen($name) > $lenLimit(150)) {
                Helper::sendJson(['success' => false, 'error' => 'اسم الصف طويل جداً (الحد الأقصى 150 حرفاً)'], 400);
            }

            // level: required per schema (VARCHAR(50) NOT NULL)
            if (!is_string($payload['level'] ?? null)) {
                Helper::sendJson(['success' => false, 'error' => 'المرحلة الدراسية غير صالحة'], 400);
            }
            $level = Helper::sanitizeString($payload['level']);
            if ($level === '') {
                Helper::sendJson(['success' => false, 'error' => 'المرحلة الدراسية مطلوبة'], 400);
            }
            if ($textLen($level) > $lenLimit(50)) {
                Helper::sendJson(['success' => false, 'error' => 'المرحلة الدراسية طويلة جداً (الحد الأقصى 50 حرفاً)'], 400);
            }

            // description: optional (TEXT NULL)
            $descRaw = $payload['description'] ?? '';
            if ($descRaw !== null && !is_string($descRaw)) {
                Helper::sendJson(['success' => false, 'error' => 'الوصف غير صالح'], 400);
            }
            $desc = $descRaw === null ? '' : Helper::sanitizeString($descRaw);
            if ($textLen($desc) > $lenLimit(1000)) {
                Helper::sendJson(['success' => false, 'error' => 'الوصف طويل جداً (الحد الأقصى 1000 حرف)'], 400);
            }

            $stmt = $db->prepare('
                UPDATE academic_classes
                SET name = :name, level = :level, description = :descr
                WHERE id = :cid AND teacher_id = :tid
            ');
            $stmt->execute([
                'tid' => $teacherId,
                'cid' => $classId,
                'name' => $name,
                'level' => $level,
                'descr' => $desc === '' ? null : $desc
            ]);

            Helper::sendJson(['success' => true, 'message' => 'تم تحديث الصف الدراسي بنجاح']);
        }

        // Create Study Group
        if ($action === 'create_group') {
            $classId = (int)($payload['class_id'] ?? 1);

            // SECURITY (P1-B): Verify the class belongs to this teacher's tenant
            $stmtChk = $db->prepare('SELECT id FROM academic_classes WHERE id = :cid AND teacher_id = :tid LIMIT 1');
            $stmtChk->execute(['cid' => $classId, 'tid' => $teacherId]);
            if ($stmtChk->fetch() === false) {
                Helper::sendForbidden('Access denied');
            }

            $name = Helper::sanitizeString($payload['name'] ?? '');
            $studyDays = json_encode($payload['study_days'] ?? ['الأحد', 'الثلاثاء'], JSON_UNESCAPED_UNICODE);
            $time = Helper::sanitizeString($payload['class_time'] ?? '05:00 مساءً');
            $shift = Helper::sanitizeString($payload['shift'] ?? 'evening');
            $price = (float)($payload['price'] ?? 300.0);
            $scheme = Helper::sanitizeString($payload['payment_scheme'] ?? 'monthly');

            $stmt = $db->prepare('
                INSERT INTO study_groups (teacher_id, class_id, name, study_days, class_time, shift, price, payment_scheme)
                VALUES (:tid, :cid, :name, :days, :time, :shift, :price, :scheme)
            ');
            $stmt->execute([
                'tid' => $teacherId,
                'cid' => $classId,
                'name' => $name,
                'days' => $studyDays,
                'time' => $time,
                'shift' => $shift,
                'price' => $price,
                'scheme' => $scheme
            ]);

            Helper::sendJson(['success' => true, 'message' => 'تم إضافة المجموعة الدراسية بنجاح']);
        }

        // Create New Student & Enroll with Teacher
        if ($action === 'create_student') {
            $name = Helper::sanitizeString($payload['name'] ?? '');
            $phone = Helper::sanitizeString($payload['phone'] ?? '');
            $parentPhone = Helper::sanitizeString($payload['parent_phone'] ?? '');
            $gradeLevel = Helper::sanitizeString($payload['grade_level'] ?? 'ثالثة ثانوي');
            $groupId = (int)($payload['group_id'] ?? 1);
            $classId = (int)($payload['class_id'] ?? 1);

            // SECURITY (P1-B): Verify the class belongs to this teacher's tenant
            $stmtChkC = $db->prepare('SELECT id FROM academic_classes WHERE id = :cid AND teacher_id = :tid LIMIT 1');
            $stmtChkC->execute(['cid' => $classId, 'tid' => $teacherId]);
            if ($stmtChkC->fetch() === false) {
                Helper::sendForbidden('Access denied');
            }

            // SECURITY (P1-B): Verify the group belongs to this teacher's tenant
            $stmtChkG = $db->prepare('SELECT id FROM study_groups WHERE id = :gid AND teacher_id = :tid LIMIT 1');
            $stmtChkG->execute(['gid' => $groupId, 'tid' => $teacherId]);
            if ($stmtChkG->fetch() === false) {
                Helper::sendForbidden('Access denied');
            }

            $db->beginTransaction();
            try {
                // Create User record
                $stmtUser = $db->prepare('
                    INSERT INTO users (name, email, phone, password_hash, role)
                    VALUES (:name, :email, :phone, :phash, "student")
                ');
                $stmtUser->execute([
                    'name' => $name,
                    'email' => time() . '@student.edu',
                    'phone' => $phone,
                    'phash' => password_hash('123456', PASSWORD_DEFAULT)
                ]);
                $userId = (int)$db->lastInsertId();

                // Create Student profile
                $studentCode = 'STU-' . rand(10000, 99999);
                $stmtSt = $db->prepare('
                    INSERT INTO students (user_id, student_code, name, phone, parent_phone, grade_level, qr_code_token)
                    VALUES (:uid, :code, :name, :phone, :pphone, :grade, :qr)
                ');
                $stmtSt->execute([
                    'uid' => $userId,
                    'code' => $studentCode,
                    'name' => $name,
                    'phone' => $phone,
                    'pphone' => $parentPhone,
                    'grade' => $gradeLevel,
                    'qr' => 'QR-' . $studentCode . '-TOKEN-' . time()
                ]);
                $studentId = (int)$db->lastInsertId();

                // Enroll with current teacher & group
                $stmtEnr = $db->prepare('
                    INSERT INTO student_enrollments (teacher_id, student_id, class_id, group_id, enrollment_date, status, payment_status)
                    VALUES (:tid, :sid, :cid, :gid, CURRENT_DATE(), "active", "paid")
                ');
                $stmtEnr->execute([
                    'tid' => $teacherId,
                    'sid' => $studentId,
                    'cid' => $classId,
                    'gid' => $groupId
                ]);

                $db->commit();
                Helper::sendJson(['success' => true, 'message' => 'تم إنشاء حساب الطالب وربطه بالمجموعة بنجاح', 'student_code' => $studentCode]);

            } catch (Throwable $ex) {
                $db->rollBack();
                throw $ex;
            }
        }

        // Enroll Existing Student (Unified Student Account)
        if ($action === 'enroll_existing_student') {
            $studentId = (int)($payload['student_id'] ?? 1);
            $groupId = (int)($payload['group_id'] ?? 1);
            $classId = (int)($payload['class_id'] ?? 1);

            // SECURITY (P1-B): Verify the student exists
            $stmtStu = $db->prepare('SELECT id FROM students WHERE id = :sid LIMIT 1');
            $stmtStu->execute(['sid' => $studentId]);
            if ($stmtStu->fetch() === false) {
                Helper::sendNotFound('Student not found');
            }

            // SECURITY (P1-B): Prevent duplicate enrollment with the same teacher
            $stmtDup = $db->prepare('SELECT id FROM student_enrollments WHERE teacher_id = :tid AND student_id = :sid LIMIT 1');
            $stmtDup->execute(['tid' => $teacherId, 'sid' => $studentId]);
            if ($stmtDup->fetch() !== false) {
                Helper::sendJson(['success' => false, 'message' => 'الطالب مرتبط بالفعل بمجموعات هذا المدرس'], 400);
            }

            // SECURITY (P1-B): Verify the class belongs to this teacher's tenant
            $stmtChkC = $db->prepare('SELECT id FROM academic_classes WHERE id = :cid AND teacher_id = :tid LIMIT 1');
            $stmtChkC->execute(['cid' => $classId, 'tid' => $teacherId]);
            if ($stmtChkC->fetch() === false) {
                Helper::sendForbidden('Access denied');
            }

            // SECURITY (P1-B): Verify the group belongs to this teacher's tenant
            $stmtChkG = $db->prepare('SELECT id FROM study_groups WHERE id = :gid AND teacher_id = :tid LIMIT 1');
            $stmtChkG->execute(['gid' => $groupId, 'tid' => $teacherId]);
            if ($stmtChkG->fetch() === false) {
                Helper::sendForbidden('Access denied');
            }

            $stmt = $db->prepare('
                INSERT INTO student_enrollments (teacher_id, student_id, class_id, group_id, enrollment_date, status, payment_status)
                VALUES (:tid, :sid, :cid, :gid, CURRENT_DATE(), "active", "paid")
            ');
            $stmt->execute([
                'tid' => $teacherId,
                'sid' => $studentId,
                'cid' => $classId,
                'gid' => $groupId
            ]);

            Helper::sendJson(['success' => true, 'message' => 'تم ربط الطالب الموجود بمجموعتك بنجاح — حساب موحد']);
        }

        // Update Teacher Settings
        if ($action === 'update_teacher_settings') {
            $stmt = $db->prepare('
                UPDATE teachers 
                SET name = :name, center_name = :center, phone = :phone, address = :addr, subject = :subj, price_per_student = :price
                WHERE id = :tid
            ');
            $stmt->execute([
                'tid' => $teacherId,
                'name' => Helper::sanitizeString($payload['name'] ?? ''),
                'center' => Helper::sanitizeString($payload['center_name'] ?? ''),
                'phone' => Helper::sanitizeString($payload['phone'] ?? ''),
                'addr' => Helper::sanitizeString($payload['address'] ?? ''),
                'subj' => Helper::sanitizeString($payload['subject'] ?? ''),
                'price' => (float)($payload['price_per_student'] ?? 50.0)
            ]);

            Helper::sendJson(['success' => true, 'message' => 'تم حفظ إعدادات المدرس بنجاح']);
        }

        Helper::sendJson(['success' => false, 'error' => 'إجراء غير معروف في المدرس'], 400);
    }

    // DELETE: Delete class or group
    if ($method === 'DELETE') {
        $entity = Helper::sanitizeString($_GET['entity'] ?? '');
        $id = (int)($_GET['id'] ?? 0);

        // SECURITY: For staff, check specific permission for each entity
        if ($user['role'] === 'staff') {
            if ($entity === 'class') {
                AuthManager::requirePermission('classes');
            } elseif ($entity === 'group') {
                AuthManager::requirePermission('groups');
            }
        }

        if ($entity === 'class' && $id > 0) {
            // SECURITY (P1-B/P1-I): Never delete another teacher's class and
            // never delete a class that still has dependent data. The class
            // row is locked (FOR UPDATE) so a concurrent study_groups insert
            // (which needs a shared lock on the parent row for its FK) cannot
            // slip in between the dependency check and the DELETE.
            $db->beginTransaction();
            try {
                $stmtOwn = $db->prepare('SELECT id FROM academic_classes WHERE id = :cid AND teacher_id = :tid LIMIT 1 FOR UPDATE');
                $stmtOwn->execute(['cid' => $id, 'tid' => $teacherId]);
                if ($stmtOwn->fetch() === false) {
                    $db->rollBack();
                    // Distinguish 404 (class does not exist) from 403 (exists
                    // but belongs to another teacher) per project convention.
                    $stmtExists = $db->prepare('SELECT id FROM academic_classes WHERE id = :cid LIMIT 1');
                    $stmtExists->execute(['cid' => $id]);
                    if ($stmtExists->fetch() === false) {
                        Helper::sendNotFound('الصف الدراسي غير موجود');
                    }
                    Helper::sendForbidden('Access denied');
                }

                // SECURITY (P1-I): study_groups.class_id has ON DELETE CASCADE
                // and student_enrollments / exams / question_bank reference
                // class_id. If any dependent record exists, refuse with 409
                // instead of cascade-deleting or orphaning production data.
                // NOTE: PDO runs native prepares (ATTR_EMULATE_PREPARES=false),
                // so a named placeholder cannot be reused — use one per column.
                $stmtDeps = $db->prepare('
                    SELECT
                        (SELECT COUNT(*) FROM study_groups WHERE class_id = :cid1) AS group_count,
                        (SELECT COUNT(*) FROM student_enrollments WHERE class_id = :cid2) AS enrollment_count,
                        (SELECT COUNT(*) FROM exams WHERE class_id = :cid3) AS exam_count,
                        (SELECT COUNT(*) FROM question_bank WHERE class_id = :cid4) AS question_count
                ');
                $stmtDeps->execute(['cid1' => $id, 'cid2' => $id, 'cid3' => $id, 'cid4' => $id]);
                $deps = $stmtDeps->fetch();
                $dependent = (int)($deps['group_count'] ?? 0)
                    + (int)($deps['enrollment_count'] ?? 0)
                    + (int)($deps['exam_count'] ?? 0)
                    + (int)($deps['question_count'] ?? 0);
                if ($dependent > 0) {
                    $db->rollBack();
                    Helper::sendJson([
                        'success' => false,
                        'message' => 'لا يمكن حذف هذا الصف الدراسي لوجود بيانات مرتبطة به (مجموعات دراسية، طلاب مسجلين، امتحانات أو أسئلة). احذف البيانات المرتبطة أولاً.'
                    ], 409);
                }

                $stmt = $db->prepare('DELETE FROM academic_classes WHERE id = :id AND teacher_id = :tid');
                $stmt->execute(['id' => $id, 'tid' => $teacherId]);
                if ($stmt->rowCount() === 0) {
                    $db->rollBack();
                    Helper::sendNotFound('الصف الدراسي غير موجود');
                }
                $db->commit();
            } catch (Throwable $ex) {
                if ($db->inTransaction()) {
                    $db->rollBack();
                }
                throw $ex;
            }
            Helper::sendJson(['success' => true, 'message' => 'تم حذف الصف الدراسي بنجاح']);
        }

        if ($entity === 'group' && $id > 0) {
            $stmt = $db->prepare('DELETE FROM study_groups WHERE id = :id AND teacher_id = :tid');
            $stmt->execute(['id' => $id, 'tid' => $teacherId]);
            Helper::sendJson(['success' => true, 'message' => 'تم حذف المجموعة بنجاح']);
        }

        Helper::sendJson(['success' => false, 'error' => 'فشل الحذف، معرف أو كيان غير صالح'], 400);
    }

    Helper::sendJson(['success' => false, 'error' => 'طريقة الطلب غير مسموح بها'], 405);

} catch (Throwable $exception) {
    // SECURITY (P1-I): log full details server-side; NEVER expose SQL errors,
    // exception messages, stack traces or filesystem paths to the frontend.
    error_log('[teacher.php] ' . $exception->getMessage());
    Helper::sendJson([
        'success' => false,
        'error' => 'خطأ في سيرفر لوحة المدرس'
    ], 500);
}
