<?php
declare(strict_types=1);

require_once __DIR__ . '/../config/helper.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../config/auth.php';

Helper::handleCorsOptions();

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
                t.subject,
                t.price_per_student,
                COUNT(DISTINCT CASE WHEN se.status = "active" THEN se.student_id END) AS active_students
            FROM teachers t
            LEFT JOIN student_enrollments se ON t.id = se.teacher_id
            GROUP BY t.id
            ORDER BY t.id ASC
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
    Helper::sendJson([
        'success' => false,
        'error' => 'خطأ في سيرفر الإدارة الشاملة: ' . $exception->getMessage()
    ], 500);
}
