# تسليم: إغلاق 03 — مساحة الطالب

- التاريخ: `2026-08-30`
- الفرع: `develop`
- الخطة: `docs/project/plans/03-student-area-progress-and-continuation.md`
- ملف الوحدة: `docs/project/04-STUDENT-LAYER.md`

## الهدف والحالة

إضافة مساحة طالب V1 تعرض تقدم الدروس السحابي المملوك للمستخدم مع Continue وRecent واستئناف Player، من دون تغيير مخطط Supabase أو مصالحة Player: مكتمل.

## commits المكتملة

- `8ba3e61` — `docs: plan student area progress and continuation`
- `410545f` — `feat: add student progress view model`
- `367d74a` — `feat: add student cloud progress read`
- `4e51d08` — `feat: add static student lesson catalog`
- `6863886` — `feat: add student lesson catalog client`
- `f81683b` — `feat: integrate student progress dashboard`

## المعمارية النهائية

```text
auth → cloud progress → conditional catalog → deriveStudentProgress → StudentHome
```

- يتحقق StudentHome عبر `getSession()` ثم `getUser()`، ويقرأ خدمة التقدم owner-scoped تحت RLS.
- لا يقرأ StudentHome ظلال `localStorage` ولا يصالحها؛ تبقى الكتابة والمصالحة الحالية مسؤولية Player.
- لا يطلب الكتالوج الثابت من الأصل نفسه إلا عند وجود صف تقدم واحد على الأقل.
- يحدد view model النقي known rows وContinue وRecent ودلالات العرض والاستئناف؛ تبقى المفاتيح المجهولة محفوظة بلا mutation.

## قياسات الكتالوج

- entries: `4,691`
- raw: `629,108` bytes
- gzip: `249,342` bytes — نجح الحد الإلزامي.
- Brotli: `209,827` bytes — تجاوز قليلًا قيمة SHOULD الإرشادية.

## ما تم التحقق منه

- PASS — حملت مساحة الطالب authenticated، ونجحت قراءة تقدم المالك السحابي.
- PASS — كان طلب كتالوج الدروس `/student/lesson-catalog.json` من الأصل نفسه.
- PASS — عرضت Continue رابط الاستئناف المشتق `?t=41`؛ وفتحها وصل إلى الدرس الصحيح، واستقبل iframe الخاص بـPlayer القيمة `start=41`.
- PASS — عرضت Recent بصورة صحيحة، وأعاد الخروج التوجيه كما ينبغي، ونجح تخطيط سطح المكتب والهاتف، ولم يظهر bug تطبيقي.
- PASS — `pnpm check` و`pnpm build` و`pnpm exec tsc --noEmit` و`git diff --check`.

أدى فتح Continue أثناء التحقق إلى تقدم موضع Player الموجود طبيعيًا من `41` إلى `72`. كان ذلك سلوك التطبيق العادي، لا تعديلًا مباشرًا لقاعدة البيانات ولا إنشاء test data.

## ما لم يتم التحقق منه

- NOT EXERCISED — حساب authenticated بلا تقدم.
- NOT EXERCISED — مفاتيح unknown/stale طبيعية.
- NOT EXERCISED — كل الدروس المعروفة مكتملة بلا Continue.
- NOT EXERCISED — خطأ وإعادة محاولة progress وcatalog عبر حجب طلب آمن.

تغطي التحويلات النقية وselfchecks المقبولة هذه الفروع، ويمكن إعادة فحصها متصفحيًا عند توفر حالات مناسبة من دون تصنيع بيانات.

## الخطوة التالية

1. ابدأ المرحلة التالية المسمّاة في خارطة الطريق: اعتماد نموذج المسارات والوحدات والتسجيل والتقدم الإجمالي، ثم Ask AI. يجب أن تبدأ من هذا التسليم وألا توسع نطاق 03 V1 ضمنيًا.

## تنبيهات

- قد يكون ظل `pagehide` في `localStorage` أحدث من السحابة قليلًا.
- الظل المحلي browser-wide غير مفصول حسب المستخدم في متصفح مشترك.
- الدمج الرتيب بأكبر موضع قد لا يمثل نية الدراسة بعد رجوع مقصود أو إعادة زيارة.
- لا يعالج 03 هذه القيود، ولا يضيف reset/rewatch أو UX جديدًا لتعارض الأجهزة.
