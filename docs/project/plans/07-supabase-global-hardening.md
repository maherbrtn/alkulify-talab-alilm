# خطة: 07 — تحصين Supabase العام (Global Supabase Security Hardening)

- الحالة: `مكتملة — HOSTED APPLIED AND VERIFIED` / mini-slice terminée
- المالك: `Codex / صاحب المشروع`
- آخر تحديث: `2026-09-13`
- ملف الوحدة: `docs/project/04-STUDENT-LAYER.md`

أُغلقت الشريحة استنادًا إلى نتائج التحقق المستضاف التي أكدها صاحب المشروع، بما فيها اختبار Auth الوظيفي الحقيقي بتاريخ `2026-09-12`. تحديث الإغلاق توثيقي محلي؛ لم يُعد تنفيذ التطبيق أو الاختبارات على Supabase المستضاف في هذه الجلسة.

## الهدف ومعيار الاكتمال

معالجة الديون الأمنية العامة لـSupabase المرصودة أثناء تدقيق ومراجعة Slice 7 والمستقلة عن مسارات الدراسة (Study Paths):
1. سحب صلاحية `EXECUTE` غير اللازمة على دالتي `handle_new_user()` و`rls_auto_enable()` من الأدوار العامة (`PUBLIC`, `anon`, `authenticated`, `service_role`).
2. تحسين أداء سياسات RLS لجدول `public.profiles` باعتماد صيغة `(select auth.uid()) = id` الموصى بها لمعالجة تحذير `auth_rls_initplan` من Supabase Advisor.
3. فصل «حماية كلمات المرور المسربة» (Leaked Password Protection) كتحسين مستقبلي غير مانع، مشروط بانتقال اختياري من Free إلى Pro أو أعلى.

معيار الاكتمال:
- تجهيز migration وحيدة آمنة وقابلة لإعادة التشغيل (`20260910000000_harden_global_supabase_security.sql`).
- نجاح الفحوص الذاتية (`scripts/selfcheck.ts`) و`pnpm check` و`pnpm exec tsc --noEmit` و`pnpm build` و`git diff --check`.
- تطبيق الـmigration على المشروع المستضاف والتحقق من صلاحيات الدوال وسياسات `profiles` وزوال تحذيرات Advisors المعنية، مع اختبار إنشاء profile تلقائيًا عبر Auth وتنظيف مستخدم الاختبار.
- تطابق تاريخ migrations المحلي والبعيد حتى `20260910000000` وتوثيق الأدلة والمخاطر وإجراءات التراجع. تفعيل Leaked Password Protection ليس شرطًا لإغلاق الشريحة.

---

## النطاق

### داخل النطاق (In Scope)

1. **migration SQL واحدة**:
   - `supabase/migrations/20260910000000_harden_global_supabase_security.sql`.
   - سحب صلاحية `EXECUTE` على `public.handle_new_user()` من `PUBLIC`, `anon`, `authenticated`, `service_role`.
   - فحص وجود `public.rls_auto_enable()` شرطيًا وسحب `EXECUTE` منها إن وُجدت دون كسر البيئات المحلية التي تخلو منها.
   - تعديل سياسات `profiles_select_own` و`profiles_insert_own` و`profiles_update_own` بـ`ALTER POLICY` لاستخدام `(select auth.uid()) = id`.
2. **فحص ذاتي محلي**:
   - إضافة قيود التحقق في `scripts/selfcheck.ts`.
3. **توثيق الحالة**:
   - تحديث `docs/project/03-CURRENT-STATE.md`.

### خارج النطاق (Out of Scope)

1. **لا مساس بمسارات الدراسة (Study Paths)**:
   - عدم تعديل أي جداول أو دوال أو سياسات أو migrations تخص `study_path_versions` أو `study_path_enrollments`.
2. **حماية كلمات المرور المسربة (Leaked-Password Protection)**:
   - ليست إعدادًا في SQL، وهي غير متاحة على خطة المشروع الحالية Free. تظل تحسينًا مستقبليًا اختياريًا بعد الانتقال إلى Pro أو أعلى، ولا تمنع إغلاق الشريحة.
3. **عدم تعديل صلاحيات جداول `profiles` الأخرى**:
   - الإبقاء على صلاحيات الجداول كما تم تحصينها في `20260829000000_harden_profiles_authenticated_grants.sql`.
4. **عدم إعادة التطبيق على البيئة المستضافة أثناء الإغلاق التوثيقي**:
   - الـmigration مطبقة ومحققة بالفعل؛ لا تشغيل لـ`supabase db push` أو تغيير مستضاف في جلسة الإغلاق، ولا إعادة إنشاء الـmigration أو تعديل القديمة. لا تعديل لـ`package.json` أو lockfile أو `.env`، ولا commit أو push.

---

## الحالة الأساسية قبل التحصين (مرجع تاريخي)

- الفرع الحالي: `develop` عند baseline `7086665` (`docs: close study paths v1 operationally`).
- عند استئناف الإغلاق كانت تغييرات `03-CURRENT-STATE.md` و`scripts/selfcheck.ts` والخطة والـmigration موجودة محليًا منذ `2026-09-10`؛ حُفظ العمل القائم دون إعادة بنائه.
- الحقائق المستضافة المؤكدة قبل تطبيق الـmigration (عولجت كما تثبت المرحلة 2):
  1. `public.handle_new_user()` معرّفة بـ`SECURITY DEFINER` وتملك `EXECUTE` متاحًا لدور `PUBLIC`.
  2. `public.rls_auto_enable()` معرّفة بـ`SECURITY DEFINER` ومكشوفة لدور `PUBLIC` في البيئة المستضافة، لكنها غير معرّفة في migrations المستودع.
  3. كانت سياسات `profiles` في المستضاف تستخدم `auth.uid()` مباشرة ما كان يسبب تحذير `auth_rls_initplan`.
  4. الـmigration التاريخية `20260824000000_profiles.sql` كُتبت بالصيغة المحسنة محليًا لكن المستضاف كان يحتاج إلى تعديل صريح عبر migration تالية دون لمس الملف التاريخي المعتمد.

---

## مراحل العمل

### المرحلة 1: إعداد الـMigration المحلية والفحوص الذاتية (مكتملة)
- [x] إنشاء `supabase/migrations/20260910000000_harden_global_supabase_security.sql`.
- [x] إضافة شروط فحص وجود دالة `rls_auto_enable()` عبر كتالوج PostgreSQL `pg_proc`.
- [x] صياغة `ALTER POLICY` لتحديث سياسات `profiles` دون drop/recreate.
- [x] تعزيز `scripts/selfcheck.ts` بفحوص بنيوية للتحقق من سلامة وصلاحيات الـmigration الجديدة وعدم مساسها بمسارات الدراسة.
- [x] نجاح الفحوص المحلية `pnpm check` و`pnpm exec tsc --noEmit` و`pnpm build` و`git diff --check`.

### المرحلة 2: التطبيق المستضاف والتحقق (HOSTED APPLIED AND VERIFIED — مكتملة)
- [x] تطبيق `20260910000000_harden_global_supabase_security.sql` بنجاح على المشروع المستضاف (`flrqmxxvdlwjutevefax`).
- [x] تطابق تاريخ migrations المحلي والبعيد حتى `20260910000000`.
- [x] فحص صلاحيات الدوال: بقي `EXECUTE` لـ`postgres` وحده على `public.handle_new_user()` و`public.rls_auto_enable()`؛ لم يعد لدى `PUBLIC` أو `anon` أو `authenticated` أو `service_role` هذه الصلاحية. بقيت `handle_new_user()` دالة `SECURITY DEFINER`.

  استعلامات مرجعية للتحقق من الصلاحيات:
  ```sql
  -- التحقق من سحب EXECUTE عن handle_new_user
  select grantee, privilege_type
  from information_schema.routine_privileges
  where routine_schema = 'public' and routine_name = 'handle_new_user';

  -- التحقق من سحب EXECUTE عن rls_auto_enable إن وجدت
  select grantee, privilege_type
  from information_schema.routine_privileges
  where routine_schema = 'public' and routine_name = 'rls_auto_enable';
  ```
- [x] فحص سياسات `profiles_select_own` و`profiles_insert_own` و`profiles_update_own` على `public.profiles`: تستخدم الصيغة المحسنة المكافئة لـ`(select auth.uid()) = id` في مواضع `USING` و`WITH CHECK` المعنية.

  استعلام مرجعي للسياسات:
  ```sql
  select policyname, qual, with_check
  from pg_policies
  where schemaname = 'public' and tablename = 'profiles';
  ```
- [x] التأكد من بقاء trigger `on_auth_user_created` واختبار عمله وظيفيًا بتاريخ `2026-09-12`: أُنشئ مستخدم Auth مؤقت من Supabase Dashboard، وأثبت استعلام SQL وجود profile مطابق (`profile_created = true`) مع تقارب شديد بين `user_created_at` و`profile_created_at`. بذلك ثبت استمرار السلسلة `auth.users → on_auth_user_created → handle_new_user() → public.profiles` بعد `REVOKE EXECUTE`.
- [x] حذف مستخدم Auth المؤقت بعد الاختبار.
- [x] مراجعة Supabase Advisor بعد التطبيق: اختفى `auth_rls_initplan` على `profiles`، واختفت تنبيهات `SECURITY DEFINER` المتعلقة بـ`handle_new_user` و`rls_auto_enable`.

### تحسين مستقبلي خارج معيار الإغلاق: Leaked Password Protection

- **Future Pro-only improvement / non-blocking**: الخاصية ما زالت معطلة، والمشروع على خطة **Free**. تتاح الحماية على **Pro أو أعلى** وفق [توثيق Supabase الرسمي](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- لا توجد خطوة تفعيل مطلوبة أو اختبار معلق لهذه الخاصية ضمن الشريحة المكتملة.
- إذا تقرر لاحقًا الانتقال إلى Pro أو أعلى، يمكن تفعيل الخاصية من إعدادات Supabase Auth المستضافة والتحقق من رفض كلمة مرور معروفة التسريب ضمن مهمة منفصلة.

### Findings متبقية مقصودة أو غير مانعة

- `study_path_versions`: تفعيل RLS بلا policy مقصود لحجب سجل النشر عن المتصفح.
- RPCs الخاصة بـStudy Paths من نوع `SECURITY DEFINER` والمتاحة لـ`authenticated`: مقصودة ضمن نموذج RPC-only.
- `study_path_enrollments_superseded_by_idx` غير مستخدم حاليًا: غير مانع؛ يُحتفظ به دون تعديل ضمن هذه الشريحة.

---

## تقييم المخاطر وإجراءات التراجع (Rollback & Risks)

### المخاطر وإجراءات الوقاية
1. **خطر تعطل trigger إنشاء الحسابات (`handle_new_user`)**:
   - **التقييم**: تحقق المسار فعليًا بعد التطبيق بتاريخ `2026-09-12` بإنشاء مستخدم Auth وظهور profile تلقائيًا (`profile_created = true`)، ثم حذف مستخدم الاختبار. لم يزل سحب `EXECUTE` الـtrigger أو يغيّر تعريفه، وبقيت `handle_new_user()` دالة `SECURITY DEFINER`.
   - **الوقاية**: سحب الصلاحيات يمنع فقط الاستدعاء المباشر عبر `RPC` أو من عملاء `anon` / `authenticated` / `PUBLIC` / `service_role`.
2. **خطر عدم وجود دالة `rls_auto_enable` في بيئات أخرى**:
   - **التقييم**: مُعالج بالكامل. استخدام كتلة PL/pgSQL تفحص `pg_proc` وتنفذ السحب فقط في حال وجود الدالة، وتمر دون أخطاء في حال غيابها.
3. **خطر تعطل وصول المستخدمين لبياناتهم في `profiles`**:
   - **التقييم**: منعدم. صيغة `(select auth.uid()) = id` تطابق دلاليًا `auth.uid() = id`، وتسمح لمخطط استعلامات PostgreSQL بتنفيذ الاستدعاء مرة واحدة لكل استعلام كـ`InitPlan` بدلاً من تقييمها عند كل صف.

### إجراءات التراجع (Rollback SQL)
إذا تطلب الأمر العودة للحالة السابقة لأي سبب استثنائي:
```sql
-- إعادة منح تنفيذ handle_new_user (إن لزم)
grant execute on function public.handle_new_user() to authenticated, anon, service_role, public;

-- إعادة سياسات profiles للصيغة غير الملتفة (إن لزم)
alter policy "profiles_select_own" on public.profiles using (auth.uid() = id);
alter policy "profiles_insert_own" on public.profiles with check (auth.uid() = id);
alter policy "profiles_update_own" on public.profiles using (auth.uid() = id) with check (auth.uid() = id);
```

---

## النتيجة

- **الشريحة مكتملة — HOSTED APPLIED AND VERIFIED** على المشروع `flrqmxxvdlwjutevefax` بالـmigration `20260910000000`، مع تطابق التاريخ المحلي والبعيد حتى هذا الإصدار.
- ثبت تصحيح تعرض `EXECUTE` للدالتين وتحسين سياسات `profiles` وزوال تنبيهات Advisors المعنية، واختُبر trigger Auth فعليًا ونُظف مستخدم الاختبار.
- روجع SQL الـmigration وكتلة التحصين في `scripts/selfcheck.ts` دون اكتشاف خطأ موضوعي يستلزم تعديلهما؛ حُفظ الملفان كما كانا. اقتصرت القراءة الإضافية للـmigrations التاريخية الخاصة بـ`profiles` على تثبيت تعريف الدالة والـtrigger والسياسات والمنح السابقة، دون تعديلها.
- اجتازت التغييرات جميع الفحوص المحلية بنجاح (`pnpm check`, `tsc --noEmit`, `pnpm build`, `git diff --check`).
- Leaked Password Protection تحسين مستقبلي مشروط بخطة Pro أو أعلى، خارج معيار الإغلاق وغير مانع. لا توجد خطوة hosted متبقية ضمن الشريحة.
