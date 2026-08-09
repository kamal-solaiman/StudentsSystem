# منصة إدارة تعليم موحدة (Unified Education Platform)
### النسخة الرسمية المتوافقة مع cPanel Shared Hosting & Apache
**المتطلبات التقنية:**
- **Backend:** PHP 8.3 Native فقط (بدون أي أطر عمل مثل Laravel أو Symfony).
- **Frontend:** HTML5 + CSS3 + JavaScript Vanilla فقط (بدون أي مكاتب خارجية).
- **Database:** MySQL 8.0 / 5.7 (InnoDB + utf8mb4_unicode_ci).
- **Server:** Apache / cPanel Shared Hosting.

---

## شجرة الملفات الكاملة للمشروع

```
cpanel-php-dist/
├── .htaccess                     # إعدادات Apache و cPanel وموجه الروابط وحماية الملفات الحساسة
├── config/
│   ├── database.php              # فئة الاتصال بقاعدة بيانات MySQL عبر PDO (PHP 8.3 Native)
│   ├── auth.php                  # إدارة الجلسات وصلاحيات الوصول RBAC وحسابات المستخدمين
│   └── helper.php                # دوال مساعدة لردود JSON والتعامل مع نصوص UTF-8 العربية
├── database/
│   ├── schema.sql                # هيكل الجداول الـ 17 وعلاقات قواعد البيانات Multi-Tenant
│   └── seed.sql                  # بيانات تجريبية شاملة للمدرسين والطلاب وأولياء الأمور
├── api/
│   ├── login.php                 # نقطة اتصال تسجيل الدخول وتحديد الصلاحيات
│   ├── super_admin.php           # الإشراف العام وحساب اشتراكات الـ SaaS الشهرية
│   ├── teacher.php               # لوحة المدرس (الصفوف، المجموعات، الطلاب، المساعدون، الإعدادات)
│   ├── student.php               # حساب الطالب الموحد (مواعيدي، واجباتي، الامتحانات، الدروس)
│   ├── parent.php                # لوحة ولي الأمر (التنقل بين الأبناء، تقرير الحضور، الدرجات)
│   ├── attendance.php            # تسجيل الحضور بـ 3 طرق (QR متغير، Scanner، ويدوي)
│   ├── exams.php                 # بنك الأسئلة (4 أنواع أسئلة) وإنشاء الامتحانات
│   └── reports.php               # التقارير الـ 7 الشاملة والبيانية
├── assets/
│   ├── css/
│   │   ├── reset.css             # إعادة ضبط CSS3 والمتغيرات والتوافق مع RTL
│   │   ├── style.css             # تصميم جميع مكونات اللوحة والجداول والنماذج
│   │   └── qr.css                # تصميم الكارنيه وشاشة الـ QR المتغير والطباعة
│   └── js/
│       ├── app.js                # موجه التطبيق الرئيسي Single-Page Application Router
│       ├── api.js                # مكتبة الاتصال بـ PHP Backend عبر Native Fetch API
│       ├── qr-generator.js       # مولد باركود QR برمجياً بصيغة SVG بدون مكاتب خارجية
│       ├── teacher.js            # تحكم الـ 9 صفحات الإلزامية للوحة المدرس
│       ├── student.js            # تحكم الـ 7 صفحات الإلزامية لحساب الطالب الموحد
│       ├── parent.js             # تحكم الـ 5 صفحات الإلزامية والتنقل بين الأبناء
│       └── admin.js              # تحكم لوحة الـ Super Admin وحساب عوائد الـ SaaS
└── index.html                    # واجهة المستخدم الموحدة (HTML5 RTL)
```

---

## خطوات التثبيت على سيرفر cPanel المشترك

1. قم بإنشاء قاعدة بيانات MySQL جديدة من لوحة تحكم cPanel.
2. قم باستيراد ملف **`database/schema.sql`** ثم ملف **`database/seed.sql`** من خلال phpMyAdmin.
3. قم بنسخ ملف **`config/db_credentials.php.template`** إلى **`config/db_credentials.php`** داخل مجلد `config/` ثم قم بتعديل الملف الجديد بإدخال بيانات قاعدة البيانات الخاصة بك:
```php
<?php
return [
    'host'     => 'localhost',
    'dbname'   => 'cpaneluser_education_db',
    'user'     => 'cpaneluser_admin',
    'password' => 'your_mysql_password',
    'port'     => 3306,
];
```
4. **مهم للأمان**: لا تقم برفع ملف `config/db_credentials.php` إلى مستودع Git. أضفه إلى ملف `.gitignore`.
5. ارفع جميع الملفات (معدا `config/db_credentials.php`) إلى مجلد `public_html/` أو النطاق الفرعي الخاص بك.
6. افتح رابط موقعك لتعمل المنصة فوراً على سيرفرك.

### ⚠️ تحذير أمني
- **لا تقم ابدا** بمشاركة ملف `config/db_credentials.php` أو محتوياته.
- **لا تقم** بوضع بيانات قاعدة البيانات مباشرة في الكود المصدر.
- **استخدم** ملف configuration خارج مستودع الكود.
