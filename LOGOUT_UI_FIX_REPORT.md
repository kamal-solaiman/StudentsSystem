# تقرير إصلاح حالة واجهة زر Logout (Logout UI Hang)

**التاريخ:** 2026-08-10
**النطاق:** Frontend UI فقط — لم يتم تعديل أي شيء في Authentication / Routing / Backend Security.
**الفرع:** `arena/019fec08-studentssystem`

---

## 1) الملفات التي تم تعديلها

| الملف | نوع التعديل |
|---|---|
| `assets/js/app.js` | ✅ تم تعديله (الملف الوحيد المعدّل) |
| `assets/js/api.js` | ❌ لم يُعدَّل |
| `assets/js/router.js` | ❌ لم يُعدَّل |
| `index.html` | ❌ لم يُعدَّل |
| `api/logout.php` | ❌ لم يُعدَّل (مستخدم كما هو) |
| `config/auth.php` وكل ملفات Backend / RBAC / CSRF / Tenant / Database | ❌ لم تُعدَّل |

---

## 2) سبب المشكلة (Root Cause)

المشكلة ناتجة عن **خللين مترابطين في طبقة الواجهة فقط**، وليست في الـ Session ولا الـ Redirect ولا الـ Back Protection (كلها تعمل سليمًا):

### الخلل الأول: حالة الزر لا تُعاد إلا عند الفشل فقط
في `AppController.handleLogout()` السابق، كان استرجاع حالة الزر (النص، `disabled`، `aria-busy`) موجودًا **داخل `catch` فقط**. في مسار النجاح:
- النص يبقى `جارٍ تسجيل الخروج...` إلى الأبد.
- الزر يبقى `disabled` و`aria-busy` إلى الأبد.

الكود كان "يراهن" على أن الزر سيُخفى بعد النجاح — لكن الإخفاء نفسه كان معطّلًا (الخلل الثاني).

### الخلل الثاني: خاصية `hidden` لا تخفي الزر فعليًا
`#logout-btn` يحمل الكلاس `.btn`، وملف `assets/css/style.css` يعرّف:

```css
.btn { display: inline-flex; ... }
```

قاعدة CSS من المؤلف **تتغلب** على القاعدة الافتراضية للمتصفح `[hidden] { display: none }`. لذلك كان:

```js
logoutBtn.hidden = true;   // لا أثر بصري لها!
```

يبقى الزر **ظاهرًا** رغم خاصية `hidden`.

### النتيجة المركبة (السيناريو الفعلي):
1. المستخدم يضغط "تسجيل الخروج" → النص يصبح `جارٍ تسجيل الخروج...` → ينجح الطلب.
2. `logoutAndReturnToLanding()` يخفي الزر "نظريًا" (`hidden=true`) لكن الزر **ما زال ظاهرًا** بسبب CSS.
3. عند فتح `/login`: `showLoginForm()` يستدعي `landing.hide()` الذي يُظهر الـ Navbar (`display: ''`) — فيظهر زر Logout القديم **بنص `جارٍ تسجيل الخروج...` العالق** في صفحة تسجيل الدخول.
4. في أي إخفاق لاحق أو إعادة عرض، النص العالق يظهر أيضًا لأن `finally` لم يكن يسترجع الحالة.

---

## 3) التعديل الذي تم عمله (في `assets/js/app.js` فقط)

### أ) `setLogoutButtonVisibility()` — إخفاء حقيقي للزر
```js
setLogoutButtonVisibility(visible) {
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.hidden = !visible;
    // .btn { display: inline-flex } يتغلب على hidden في CSS — فرض الإخفاء مباشرة
    logoutBtn.style.display = visible ? '' : 'none';
  }
}
```

### ب) دالة موحّدة لحالة الزر `setLogoutButtonState(btn, busy)`
مصدر واحد للحقيقة للنص / `disabled` / `aria-busy` في الحالتين (busy / idle)، حتى لا تتباعد حالات الزر بين المسارات.

### ج) `handleLogout()` — بنية `try / catch / finally` كاملة
```js
async handleLogout(logoutBtn) {
  if (this.isLoggingOut) return;          // حماية من التكرار

  this.isLoggingOut = true;
  this.setLogoutButtonState(logoutBtn, true);   // → "جارٍ تسجيل الخروج..."

  try {
    const response = await ApiClient.logout();  // api/logout.php الموجود
    if (!response || response.success !== true) {
      throw new Error(...);
    }
    await this.logoutAndReturnToLanding();      // تنظيف كامل + الانتقال إلى /
  } catch (error) {
    console.error('Logout error:', error);
    alert('تعذر تسجيل الخروج: ' + (error.message || 'يرجى المحاولة مرة أخرى'));
  } finally {
    // تُنفَّذ في كل الحالات: نجاح، فشل، HTTP error، Network error، Exception
    this.setLogoutButtonState(logoutBtn, false); // → "تسجيل الخروج" + إعادة التفعيل
    this.isLoggingOut = false;
  }
}
```

### د) منع Event Listener المزدوج
`attachLogoutListener()` أصبح idempotent عبر `dataset.logoutListenerAttached` — لا يمكن إرفاق مستمع ثانٍ لنفس الزر، بالإضافة إلى حارس `isLoggingOut` الذي يمنع إرسال طلب Logout ثانٍ أثناء التنفيذ.

---

## 4) كيف تم ضمان تنظيف Loading State في جميع الحالات

- **Logout ناجح:** `finally` يسترجع الزر لحالته الطبيعية (نص `تسجيل الخروج`، إعادة التفعيل، إزالة `aria-busy`)، و`logoutAndReturnToLanding()` يُخفي الزر فعليًا (`display:none` + `hidden`)، ينظّف `user_role` و`csrf_token` من `sessionStorage`، و`ApiClient.csrfToken`، وحالة المستخدم (`isAuthenticated` / `currentUser` / `controllerInstance` / `_cachedRole`)، وينتقل إلى `/110/` عبر `router.replace('/')`.
- **Logout فاشل / HTTP error / Network error / Exception:** `catch` يعرض رسالة خطأ، ثم `finally` يسترجع الزر إلى `تسجيل الخروج` مفعّلًا.
- **التكرار:** `isLoggingOut` + المستمع الأحادي يمنعان أي طلب Logout ثانٍ أثناء التنفيذ.
- **صفحة `/login`:** مسار `/login` يستدعي `setLogoutButtonVisibility(false)` — والآن الإخفاء فعلي بصريًا، فلا يظهر نص `جارٍ تسجيل الخروج...` إطلاقًا (ولا يمكن أن "يُرث" من Dashboard سابق لأن النص يُسترجع دائمًا في `finally`).

---

## 5) هل تم تعديل Backend؟

**لا.** لم يُعدَّل أي ملف Backend:
- `api/logout.php` مستخدم كما هو (POST + CSRF + `AuthManager::logout()`).
- لا يوجد Logout endpoint جديد.
- لم تُلمس Authentication / RBAC / Permissions / CSRF / Tenant Isolation / Database / Routing / Landing Page.

---

## 6) نتائج الاختبارات المحلية / Static

### فحص الصياغة (Syntax)
```
node --check assets/js/app.js   → SYNTAX OK
node --check assets/js/api.js   → SYNTAX OK
node --check assets/js/router.js → SYNTAX OK
```

### اختبار سلوكي (Behavioral harness على المتصفح-المحاكى)
تم تحميل `app.js` / `api.js` / `router.js` / `landing.js` الحقيقية داخل بيئة Node.js مع DOM مموّه، وتشغيل 7 سيناريوهات:

| # | السيناريو | النتيجة |
|---|---|---|
| 1 | Logout ناجح → الزر يستعيد حالته، يُخفى، تنظيف `user_role`/`csrf_token`/`ApiClient.csrfToken`/حالة المستخدم والـ controller، `router.replace("/")` | ✅ PASS |
| 2 | صفحة `/login` → لا يظهر زر Logout ولا النص العالق | ✅ PASS |
| 3 | فشل Logout (`success:false`) → الزر يعود `تسجيل الخروج` + رسالة خطأ | ✅ PASS |
| 4 | HTTP 500 / Network error / Exception عام → الزر يعود لحالته + رسالة خطأ | ✅ PASS |
| 5 | ضغطة مزدوجة أثناء التنفيذ → طلب واحد فقط | ✅ PASS |
| 6 | `attachLogoutListener` idempotent → مستمع واحد فقط، والضغط المزدوج يرسل طلبًا واحدًا | ✅ PASS |
| 7 | `logoutAndReturnToLanding()` → تنظيف كامل (كل البنود المطلوبة) | ✅ PASS |

**الإجمالي: 44/44 ناجحة (0 فشل).**

### Preview حي (بيئة محلية)
تم تشغيل خادم معاينة محلي يقدّم الواجهة الحقيقية مع **Mock API** (خارج المستودع، غير مضمّن في الكود) لتجربة السيناريو كاملًا في المتصفح: تسجيل دخول → Dashboard → ضغط Logout → `جارٍ تسجيل الخروج...` → Landing Page → `/login` بدون زر Logout.

### ⚠️ ملاحظة هامة — لا يوجد ادعاء بـ LIVE PASS
لم يتم اختبار أي شيء على Production الفعلي في هذه الجلسة (لا يوجد وصول إلى بيئة الإنتاج). التقرير أعلاه يعتمد على اختبارات محلية/Static فقط. **يُرجى اعتماد الـ LIVE PASS بعد نشر الملف على Production وتنفيذ Acceptance Criteria يدويًا**:
1. Dashboard: `تسجيل الخروج` ← ضغط ← `جارٍ تسجيل الخروج...` ← Landing Page.
2. Landing Page: لا يوجد زر Logout.
3. Login Page: لا يوجد `جارٍ تسجيل الخروج...`.
4. فشل Logout: الزر يعود إلى `تسجيل الخروج` مع رسالة خطأ.
5. أثناء التنفيذ: لا يمكن إرسال طلب Logout ثانٍ.
6. بعد Logout ناجح: `/110/` ← Back ← `/110/login` (Back Protection كما هي).

---

## 7) ملخص

- **سبب الـ hanging:** حالة الزر لم تكن تُستعاد إلا في `catch` + خاصية `hidden` معطّلة بسبب قاعدة `.btn { display: inline-flex }`.
- **الإصلاح:** استرجاع الحالة في `finally` (كل المسارات) + إخفاء حقيقي عبر `style.display` + مستمع واحد idempotent + حارس `isLoggingOut`.
- **الحجم:** ملف واحد، `assets/js/app.js` (+42 / −16 سطرًا). لا تغيير Backend.
