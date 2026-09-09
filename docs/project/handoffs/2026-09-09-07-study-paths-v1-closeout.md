# تسليم: Study Paths V1 — إغلاق Slice 7 التشغيلي

- التاريخ: `2026-09-09`
- الفرع: `develop`
- الـbaseline: `438cc02` (`docs: close my paths slice 6`)
- المشروع المستضاف: `flrqmxxvdlwjutevefax`
- PostgreSQL: `17.6`
- الخطة: `docs/project/plans/04-study-paths-v1.md`
- ملف الوحدة: `docs/project/06-STUDY-PATHS.md`

## الهدف والحالة

إغلاق Slice 7 التشغيلي لـStudy Paths V1:
**Slice 7 operational closeout PASS ; Study Paths V1 implementation techniquement close ; production content/browser acceptance pending first reviewed scientific path.**

تم بنجاح تثبيت خط الأساس المستضاف، وإثبات قيد التزامن الحقيقي المؤجل بجلسَتين مستقلتين، واختبار النشر والـrollback، ومراجعة الأمان والأداء، وتثبيت عقد تكامل الـcorpus المستقبلي. تظل رحلة المتصفح الإنتاجية الكاملة معلقة حتى نشر أول مسار علمي مراجع.

## ما تغيّر

- `docs/project/handoffs/2026-09-09-07-study-paths-v1-closeout.md` — إنشاء وثيقة التسليم والإغلاق التشغيلي لـSlice 7.
- `docs/project/03-CURRENT-STATE.md` — تحديث حالة المشروع لإثبات إغلاق Slice 7 التشغيلي، ونتائج اختبار التزامن الحقيقي، وحالة الجداول النظيفة، وتسجيل الديون العامة خارج نطاق الميزة.
- `docs/project/06-STUDY-PATHS.md` — توثيق تفاصيل Slice 7 (الأساس المستضاف، اختبار التزامن، probe النشر/rollback، مراجعة الأمان، عقد الكوربس، وحدود القبول الإنتاجي).
- `docs/project/plans/04-study-paths-v1.md` — تحديث حالة الخطة، وتوثيق إنجاز Slice 7، وتحديث معايير القبول مع إبقاء المعايير المشروطة بمسار علمي منشور معلقة.

## ما تم التحقق منه

### Slice 7A — خط الأساس المستضاف (Hosted Baseline)
- مستودع `develop` نظيف ومتطابق مع `origin/develop` عند الـcommit `438cc02` في بداية العمل.
- المشروع المستضاف المرتبط: `flrqmxxvdlwjutevefax`.
- إصدار قاعدة البيانات المستضافة: PostgreSQL `17.6`.
- تطابق migrations المحلية والبعيدة تمامًا:
  - `20260824000000`
  - `20260826000000`
  - `20260829000000`
  - `20260902000000`
  - `20260903164705`
  - `20260904195919`
- جداول Study Paths في حالة نظيفة وصفرية:
  - `study_path_versions = 0`
  - `study_path_enrollments = 0`
- RLS مفعل ومستمر على الجداول، وصلاحيات الوصول (ACL) مطابقة تمامًا للتحققات السابقة (لا قراءة من المتصفح لـ`study_path_versions`، قراءة المالك فقط لـ`study_path_enrollments`، والـRPCs محصورة لـ`authenticated`).

### Slice 7B — اختبار التزامن الحقيقي بجلسَتين (Real Two-Session Concurrency Test)
- نُفذ اختبار تزامن حقيقي على البيئة المستضافة عبر جلستي/معاملتي PostgreSQL مستقلتين فعليًا، دون تعطيل أي قيود أثناء الاختبار.
- السيناريو: نفس المستخدم (`user_id`) ونفس المسار (`path_id`) مع محاولة تسجيل متزامنة للإصدار 1 والإصدار 2:
  - **الجلسة أ (Session A):** نجح الـ`COMMIT` برمز خروج `RC=0`.
  - **الجلسة ب (Session B):** رُفض الـ`COMMIT` برمز خروج `RC=1`.
  - خطأ PostgreSQL الناتج في الجلسة ب:
    `23P01 conflicting key value violates exclusion constraint "study_path_enrollments_one_live_per_path"`
  - بعد اكتمال المعاملتين: `committed_live_rows = 1` فقط.
  - النتيجة: إثبات قيد الاستبعاد المؤجل `DEFERRABLE INITIALLY DEFERRED` في تزامن حقيقي عملي، وليس فقط ساكنًا.
  - تم استبعاد تجربتين أوليتين كمسابر غير صالحة: الأولى فشلت بسبب `lifecycle_consistent`، والثانية استخدمت `session_replication_role=replica` مما أبطل صلاحيتها كإثبات للقيد المؤجل. الاعتماد الكامل والحصري تم على الاختبار النهائي الصالح.
  - التنظيف النهائي بعد الاختبار:
    - `study_path_versions = 0`
    - `study_path_enrollments = 0`

### Slice 7C — مسبار النشر والتراجع (rollback) (Publication / Rollback Probe)
- استُخدم مسار اصطناعي تجريبي داخل معاملة (`TRANSACTION`):
  - `before_count = 0`
  - تم تنفيذ `INSERT` صالح في `study_path_versions`.
  - تم تنفيذ `ROLLBACK` صريح.
  - `after_rollback = 0`
- الحالة النهائية: لا توجد أي بيانات اصطناعية باقية:
  - `study_path_versions = 0`
  - `study_path_enrollments = 0`

### مراجعة الأمان والأداء (Security / Performance Review)
- **خاص بمسارات الدراسة (Study Paths):**
  - لا توجد أي ملاحظات أمنية أو أدائية تعيق الميزة.
  - تفعيل RLS على `study_path_versions` دون أي سياسة (policy) هو سلوك مقصود تمامًا لمنع المتصفح من قراءة سجل النشر مباشرة.
  - دوال RPC الخاصة بـStudy Paths المعرفة بـ`SECURITY DEFINER` والقابلة للتنفيذ بواسطة دور `authenticated` مقصودة وتشكل جوهر نموذج الـRPC-only المعتمد.
  - الفهرس `study_path_enrollments_superseded_by_idx` الذي أشارت تقارير الأداء إلى أنه غير مستخدم (`unused`) لا يجوز حذفه لمجرد أن جدول الإنتاج فارغ حاليًا.
- **ديون عامة خارج نطاق Study Paths (Global Debt / Out of Scope):**
  - أشارت تقارير Supabase Advisors إلى أن الدوال `handle_new_user()` و`rls_auto_enable()` مكشوفة للتنفيذ `EXECUTE` عبر الأدوار العامة الافتراضية للمتصفح (`PUBLIC`).
  - خاصية حماية كلمات المرور المسربة (leaked-password protection) في Auth معطلة حاليًا.
  - تقارير الأداء تشير إلى سياسات جدول `profiles` حيث يعاد تقييم `auth.uid()` لكل صف في البيئة المستضافة.
  - هذه الملاحظات عامة وسابقة لـStudy Paths، ولا يجوز تعديلها أو معالجتها ضمن Slice 7؛ ستُدرج ضمن مهمة تحصين عامة منفصلة لـSupabase.

### عقد التكامل المستقبلي مع Telegram / Corpus
- تم تثبيت وتأكيد العقد الفاصل فقط دون تنفيذ أي كود:
  `raw Telegram archive → transcription → LessonPart / lesson assembly → review → canonical corpus export → Product resolver → lesson_key stable`
- مشروع الـcorpus مستقل ومنفصل تمامًا.
- يُمنع منعًا باتًا دخول أي معرّف لـTelegram (message ID) أو YouTube ID أو معرّف corpus في عضوية المسار أو التسجيلات أو اشتقاق التقدم.
- تغيير مصدر المحتوى تحت نفس الـ`lesson_key` لا يُنشئ إصدارًا جديدًا للمسار؛ بل تعديل بنية المنهج التعليمية هو ما يُنشئ الإصدار الجديد.

## ما لم يتم التحقق منه

- **قبول رحلة المتصفح الإنتاجية (Production Browser Journey):**
  - لم تُختبر رحلة تسجيل حقيقية للمستخدم عبر المتصفح في الإنتاج؛ لعدم وجود أي مسار علمي مراجع ومنشور حتى الآن في الكتالوج (`publicStudyPaths = []`، والـfixture التقني ما زال `draft`).
  - القبول الإنتاجي الفعلي لرحلة المستخدم معلق (`PENDING`) حتى نشر أول مسار علمي معتمد ومراجع.

## الخطوة التالية

1. إعداد ومراجعة أول مسار علمي حقيقي وإدخاله في كتالوج Git، ثم تنفيذ خطوات النشر في البيئة الإنتاجية واختبار رحلة الطالب الكاملة في المتصفح.
2. التخطيط لمهمة تحصين مستقلة لـSupabase (معالجة صلاحيات `handle_new_user`/`rls_auto_enable`، تفعيل leaked password protection، وتحسين سياسات `profiles`).

## تنبيهات

- لا توجد أي تغييرات برمجية أو migrations في هذه الشريحة (توثيق تشغيلي فقط).
- لم يتم عمل commit أو push.
- الجداول المستضافة في حالة صفرية ونظيفة (`0` صفوف).
