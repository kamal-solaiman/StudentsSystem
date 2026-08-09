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
        if ($user['role'] === 'staff') {
            if ($action === 'create_class' || $action === 'delete-class') {
                AuthManager::requirePermission('classes');
            } elseif ($action === 'create_group' || $action === 'delete-group') {
                AuthManager::requirePermission('groups');
            } elseif ($action === 'create_student' || $action === 'enroll_existing_student') {
                AuthManager::requirePermission('students');
            } elseif ($action === 'update_teacher_settings') {
                AuthManager::requirePermission('settings');
            }
        }

        // Create Academic Class
        if ($action === 'create_class') {
            $name = Helper::sanitizeString($payload['name'] ?? '');
            $level = Helper::sanitizeString($payload['level'] ?? 'prep_1');
            $desc = Helper::sanitizeString($payload['description'] ?? '');

            $stmt = $db->prepare('
                INSERT INTO academic_classes (teacher_id, name, level, description)
                VALUES (:tid, :name, :level, :descr)
            ');
            $stmt->execute([
                'tid' => $teacherId,
                'name' => $name,
                'level' => $level,
                'descr' => $desc
            ]);

            Helper::sendJson(['success' => true, 'message' => 'تم إضافة الصف الدراسي بنجاح', 'id' => (int)$db->lastInsertId()]);
        }

        // Create Study Group
        if ($action === 'create_group') {
            $classId = (int)($payload['class_id'] ?? 1);
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
            $stmt = $db->prepare('DELETE FROM academic_classes WHERE id = :id AND teacher_id = :tid');
            $stmt->execute(['id' => $id, 'tid' => $teacherId]);
            Helper::sendJson(['success' => true, 'message' => 'تم حذف الصف بنجاح']);
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
    Helper::sendJson([
        'success' => false,
        'error' => 'خطأ في سيرفر لوحة المدرس: ' . $exception->getMessage()
    ], 500);
}
