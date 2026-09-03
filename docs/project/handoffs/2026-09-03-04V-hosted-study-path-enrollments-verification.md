# تسليم: Slice 4V — تحقق تسجيلات Study Paths المستضاف

- التاريخ: `2026-09-03`
- الفرع: `develop`
- الخطة: `docs/project/plans/04-study-paths-v1.md`
- ملف الوحدة: `docs/project/06-STUDY-PATHS.md`

## الهدف والحالة

إغلاق Slice 4 بعد تطبيق migration والتحقق من persistence وRLS/RPC دورة حياة تسجيل Study Paths على المشروع المستضاف. لا UI ولا مصدر progress جديد ضمن هذه الشريحة.

## ما تغيّر

- سجل التاريخ البعيد migration باسم `20260903164705 study_path_enrollments`، ووفق الملف المحلي معه باسم `20260903164705_study_path_enrollments.sql` من دون إعادة تطبيق أو إصلاح history.
- أضيفت RPCs `enroll_study_path`، `pause_study_path_enrollment`، `resume_study_path_enrollment`، `withdraw_study_path_enrollment`، و`upgrade_study_path_enrollment`.
- طابقت أنواع Supabase اليدوية الشكل والتواقيع المولدة مستضافًا، وحدثت selfchecks ووثائق الحالة والقرار.

## ما تم التحقق منه

- الجدول وRLS والpolicy الوحيدة والACL الفعلية: `anon` بلا وصول، و`authenticated` يقرأ صفوفه فقط بلا كتابة مباشرة، و`service_role` يقرأ فقط.
- مالك الجدول والدوال `postgres`. الدوال الخمس `SECURITY DEFINER` و`search_path = ''`، وتنفيذها لـ`authenticated` فقط؛ لا PUBLIC/anon/service-role EXECUTE ولا overloads غير متوقعة. trigger function `SECURITY INVOKER` وغير منفذة مباشرة من هذه الأدوار.
- اختبارات rollback أثبتت الانتقالات والـidempotency والterminal والretirement والترقية وسلامة supersession وعزل المالك وتعدد active وثبات الإصدار وmonotonicity.
- اختبرت الأدوار فعليًا: owner SELECT/RPC ينجحان، وother-owner/anon والكتابة المباشرة مرفوضة، و`service_role` يقرأ ولا يكتب أو ينفذ RPC.
- FK حذف المستخدم هو `ON DELETE CASCADE` ولا يوجد DELETE-rejection trigger؛ لم يحذف مستخدم حقيقي للاختبار.
- تعريفات enroll/upgrade تستخدم transaction advisory lock بالمفتاح نفسه، وregistry `FOR SHARE`، وON CONFLICT exact. لم ينفذ parallel stress test.

## الحالة النهائية

- كل البيانات الصناعية رجعت؛ `study_path_versions = 0` و`study_path_enrollments = 0`.
- تاريخ migrations المحلي مطابق للبعيد: `20260824000000`، `20260826000000`، `20260829000000`، `20260902000000`، `20260903164705`.
- تحذيرات advisors لدوال RPC المصادق عليها وللفهرس غير المستخدم متوقعة في هذا التصميم والجدول الفارغ، ولا تستدعي تغيير Slice 4.

## تنبيهات

- Slice 4 مغلقة؛ لا تبدأ Slice 5 ضمن هذا التسليم.
- لا يوجد مسار علمي منشور؛ registry المستضاف فارغ، ولم ينشأ هذا العمل أي بيانات تسجيل.
