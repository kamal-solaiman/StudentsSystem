<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/helper.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../config/auth.php';

Helper::handleCorsOptions();

// SECURITY: Require super_admin role for all super_admin endpoints
$user = AuthManager::requireRole(['super_admin']);

// SECURITY: Verify CSRF token for state-changing methods
if (in_array($_SERVER['REQUEST_METHOD'], ['POST'], true)) {
    $input = Helper::getJsonInput();
    $csrfToken = $input['csrf_token'] ?? null;
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

    // GET: Retrieve all teachers with their active student counts & SaaS monthly subscription fees
    if ($method === 'GET') {
        $stmtTeachers = $db->query('
            SELECT
                t.id,
                t.name,
                t.center_name,
                t.phone,
                t.address,
                COALESCE(su.name, t.subject) AS subject,
                t.price_per_student,
                u.email,
                u.account_status,
                COUNT(DISTINCT CASE WHEN se.status = "active" THEN se.student_id END) AS active_students
            FROM teachers t
            JOIN users u ON u.id = t.user_id AND u.role = \'teacher\'
            LEFT JOIN subjects su ON su.id = t.subject_id
            LEFT JOIN student_enrollments se ON t.id = se.teacher_id
            GROUP BY t.id, t.name, t.center_name, t.phone, t.address, t.subject,
                     t.price_per_student, u.email, u.account_status, su.name
            ORDER BY FIELD(u.account_status, \'pending\', \'active\', \'rejected\'), t.id ASC
        ');
        $teachersRaw = $stmtTeachers->fetchAll();

        $teachers = [];
        $totalMonthlyRevenue = 0.0;

        foreach ($teachersRaw as $row) {
            $activeStudents = (int)$row['active_students'];
            $price = (float)$row['price_per_student'];
            $monthlySub = $activeStudents * $price;
            $totalMonthlyRevenue += $monthlySub;

            $teachers[] = [
                'id' => (int)$row['id'],
                'name' => (string)$row['name'],
                'center_name' => (string)$row['center_name'],
                'phone' => (string)$row['phone'],
                'address' => (string)$row['address'],
                'subject' => (string)$row['subject'],
                'email' => (string)$row['email'],
                'account_status' => (string)$row['account_status'],
                'price_per_student' => $price,
                'active_students' => $activeStudents,
                'subscription_monthly' => $monthlySub
            ];
        }

        $stmtSettings = $db->query('SELECT * FROM saas_settings LIMIT 1');
        $settings = $stmtSettings->fetch() ?: [
            'id' => 1,
            'platform_name' => 'منصة إدارة تعليم موحدة',
            'default_price_per_student' => 50.00,
            'currency' => 'ج.م'
        ];

        Helper::sendJson([
            'success' => true,
            'teachers' => $teachers,
            'saas_settings' => [
                'id' => (int)$settings['id'],
                'platform_name' => (string)$settings['platform_name'],
                'default_price_per_student' => (float)$settings['default_price_per_student'],
                'currency' => (string)$settings['currency']
            ],
            'summary' => [
                'total_teachers' => count($teachers),
                'total_active_students' => array_sum(array_column($teachers, 'active_students')),
                'total_monthly_revenue' => $totalMonthlyRevenue
            ]
        ]);
    }

    // POST: Update SaaS settings or platform default pricing
    if ($method === 'POST') {
        $input = Helper::getJsonInput();
        $action = Helper::sanitizeString($input['action'] ?? '');

        if (in_array($action, ['approve_teacher', 'reject_teacher'], true)) {
            $teacherId = filter_var($input['teacher_id'] ?? null, FILTER_VALIDATE_INT, [
                'options' => ['min_range' => 1]
            ]);
            if ($teacherId === false) {
                Helper::sendJson(['success' => false, 'message' => 'حساب المدرس غير صالح'], 422);
            }

            $newStatus = $action === 'approve_teacher' ? 'active' : 'rejected';
            $stmtStatus = $db->prepare("\n                UPDATE users u\n                JOIN teachers t ON t.user_id = u.id\n                SET u.account_status = :status\n                WHERE t.id = :teacher_id\n                  AND u.role = 'teacher'\n                  AND u.account_status IN ('pending', 'rejected')\n            ");
            $stmtStatus->execute(['status' => $newStatus, 'teacher_id' => $teacherId]);
            if ($stmtStatus->rowCount() !== 1) {
                Helper::sendJson(['success' => false, 'message' => 'لم يتم العثور على طلب مدرس قابل للتحديث'], 404);
            }

            Helper::sendJson([
                'success' => true,
                'message' => $newStatus === 'active' ? 'تمت الموافقة على حساب المدرس' : 'تم رفض حساب المدرس'
            ]);
        }

        if ($action === 'update_saas_settings') {
            $platformName = Helper::sanitizeString($input['platform_name'] ?? 'منصة إدارة تعليم موحدة');
            $defaultPrice = (float)($input['default_price_per_student'] ?? 50.0);

            $stmtUpdate = $db->prepare('
                UPDATE saas_settings 
                SET platform_name = :pname, default_price_per_student = :dprice 
                WHERE id = 1
            ');
            $stmtUpdate->execute([
                'pname' => $platformName,
                'dprice' => $defaultPrice
            ]);

            Helper::sendJson(['success' => true, 'message' => 'تم تحديث إعدادات نظام الـ SaaS بنجاح']);
        }

        Helper::sendJson(['success' => false, 'error' => 'إجراء غير معروف'], 400);
    }

    Helper::sendJson(['success' => false, 'error' => 'طريقة الطلب غير مسموح بها'], 405);

} catch (Throwable $exception) {
    error_log('super_admin.php failure: ' . get_class($exception));
    Helper::sendJson([
        'success' => false,
        'message' => 'حدث خطأ غير متوقع في لوحة الإدارة'
    ], 500);
}
