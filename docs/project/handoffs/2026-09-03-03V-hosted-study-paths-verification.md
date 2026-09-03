# تسليم: إغلاق 03V — التحقق المستضاف لسجل نشر Study Paths

- التاريخ: `2026-09-03`
- الفرع: `develop`
- الخطة: `docs/project/plans/04-study-paths-v1.md`
- ملف الوحدة: `docs/project/06-STUDY-PATHS.md`

## الهدف والحالة

إثبات تطابق registry نشر Study Paths الأدنى على Supabase المستضاف مع عقد المخطط والأمان ودورة الحياة: مكتمل.

## ما تغيّر

- طبقت migration `20260902000000_study_path_versions` مسبقًا وأصبحت ضمن تاريخ migrations المستضاف المتطابق مع المستودع.
- حدثت وثائق الحالة وStudy Paths والخطة بنتائج 03V.

## ما تم التحقق منه

- migrations `20260824000000`، `20260826000000`، `20260829000000`، و`20260902000000` — موجودة مستضافًا ومتطابقة.
- `public.study_path_versions` — الحقول الخمسة المتوقعة وPK `(path_id, version)` وقيود الإصدار وdigest والأزمنة — ناجحة على المستضاف.
- RLS مفعل بلا policies؛ `anon` و`authenticated` بلا privileges على الجدول، و`service_role` يملك `SELECT` فقط.
- الجدول وtrigger functions يملكهما `postgres`، والدوال `SECURITY INVOKER` مع `search_path = ''`.
- الإدخال الصالح، وimmutability للهوية/الإصدار/digest/وقت النشر، وretirement أحادي الاتجاه، ورفض الحذف — ناجحة باختبارات transaction آمنة.
- الحالات المرفوضة: إصدار صفر، digest كبيرة الأحرف أو قصيرة، وقت نشر لا نهائي، وretirement يسبق النشر — رفضت كما هو متوقع.
- بعد rollback، بقي `public.study_path_versions` صفر صفوف ولم تبق بيانات صناعية.

## ما لم يتم التحقق منه

لا شيء ضمن نطاق Slice 3V.

## الخطوة التالية

1. Slice 4 هي الشريحة المخططة التالية، لكنها لم تبدأ ضمن هذا العمل.

## تنبيهات

- لا يوجد مسار علمي منشور؛ كتالوج Git المنشور وregistry المستضاف فارغان عمدًا.
- لا توجد `study_path_enrollments` أو enrollment RPCs/UI، ولم يتم commit أو push ضمن 03V.
