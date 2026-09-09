# مسارات الدراسة

## الحالة

اكتملت جميع شرائح نموذج مسارات الدراسة V1 (من Slice 1 إلى Slice 7) تقنيًا وتشغيليًا: بدءًا من نموذج المجال static والقراءة العامة، ثم registry النشر الأدنى وتسجيلات الطلاب وحالات دورة الحياة وقيد النسخة live الواحدة المؤجل، وصولاً إلى واجهة الطالب والتاريخ والترقية ودمج «مساراتي» في مساحة الطالب، والإغلاق التشغيلي لـSlice 7.

حالة الإغلاق المعتمدة:
**Slice 7 operational closeout PASS ; Study Paths V1 implementation techniquement close ; production content/browser acceptance pending first reviewed scientific path.**

يوجد fixture تقني صغير بحالة `draft` للاختبار؛ ليس مسارًا علميًا منشورًا ولا يدخل الكتالوج العام (`publicStudyPaths` فارغ عمدًا). تظل رحلة المتصفح الإنتاجية الكاملة بالمصادقة معلقة حتى نشر أول مسار علمي مراجع.

ينفذ النموذج حاليًا:

- validation صارم للحقول والهويات UUID v4 بتهجئة canonical lowercase والحالات والإصدارات والتواريخ، وعدم الفراغ، وترتيب `position` المتصل من 1، وعدم تكرار الوحدة أو الدرس داخل الإصدار.
- `publishedAt` من النوع `string | null`: وحده الإصدار الحالي لمسار `draft` يحمل `null`، وكل إصدار آخر—بما فيه المنشور والمتقاعد والإصدار التاريخي لمسودة—يحمل timestamp canonical. تبقى الإصدارات المنشورة immutable ومؤرخة.
- إلزام التعريف المنشور أو المتقاعد بالتحقق من أن كل `lesson_key` يحل عبر `data/lesson-registry.json`، ومنع provider IDs والحقول غير المعروفة من بنية المجال.
- canonical serialization مستقل عن ترتيب مفاتيح JSON، وSHA-256 digest ثابت يغطي هوية المسار والإصدار وهوية الوحدة وعنوانها وهدفها وترتيبها وعضوية الدروس وترتيبها، ولا يشمل metadata العرض على مستوى المسار.
- اشتقاق اكتمال الوحدات والمسار والنسب وContinue من `lesson_progress.completed` وترتيب الإصدار، مع resume الحالي للدرس الجزئي وsnapshot مجمدة من صف التقدم. غياب صف تقدم يعني غير مكتمل، ولا تؤثر المدة في النسبة، ولا يغير mutation لاحق لمدخلات المستدعي النتيجة المشتقة.
- احتساب التقدم الموجود سابقًا والمفتاح المشترك تلقائيًا لكل مسار يحتوي الدرس نفسه، من دون نسخ progress أو إنشاء مصدر اكتمال ثانٍ.
- كتالوج عام لا يقبل إلا تعريفًا حالته `published`، ويتحقق من uniqueness وslug، ويحل كل `lesson_key` وقت البناء إلى metadata وroute الدرس العام الحالي.
- فهرس `/study-paths/` وقالب current وقالب نسخة تاريخية، كلها من تعريفات Git فقط وبلا Auth أو Supabase. يبقى الفهرس في حالة فارغة صادقة حتى ينشر منهج علمي مراجع بدل عرض fixture تقني كدورة حقيقية.
- migration مطبقة لـ`study_path_versions` لا تخزن إلا `(path_id, version, definition_digest, published_at, retired_at)` مع PK مركب، وتحجب browser roles وتمنح `service_role` قراءة فقط، وتمنع تغيير النسخة المنشورة أو حذفها وتسمح بتقاعد أحادي الاتجاه.
- أثبت hosted verification أن RLS مفعل بلا policies، وأن مالك الجدول وtrigger functions هو `postgres`، وأن الدوال `SECURITY INVOKER` و`search_path = ''`. ثبتت قيود الإصدار وSHA-256 الصغير والأزمنة المحدودة وترتيب التقاعد، وسلوك immutability/retirement/delete باختبارات transaction. بعدها بقي الجدول فارغًا.
- manifest/verifier نقي يقارن هويات وإصدارات وdigests وتعريفات النشر canonical في Git مع snapshot من registry، وCLI إداري `pnpm verify:study-path-publications` يجلب الحقول الخمسة بمفتاح service-role من البيئة فقط؛ لا اعتماد في المتصفح أو render العام.
- migration Slice 4 تضيف `study_path_enrollments` بهوية مستقلة، ومالك، وإصدار مثبت، وحالة وأزمنة lifecycle فقط. تربط FK المركبة بـ`study_path_versions`، وتمنع unique تكرار `(user_id, path_id, path_version)` بلا أي قيد على عدد المسارات `active`.
- RLS التسجيل يسمح لـ`authenticated` بقراءة صفوفه فقط، مع سحب الكتابة المباشرة. تمر mutations عبر RPCs `SECURITY DEFINER` تشتق المالك من `auth.uid()` وتنفذ enroll/pause/resume/withdraw/upgrade فقط؛ يقرأ `service_role` الجدول ولا ينفذ RPCs المتصفح.
- أثبت تحقق Slice 4 المستضاف أن المالك `postgres`، وأن RLS يطبق policy المالك الوحيدة، وأن `anon` بلا وصول و`authenticated` يقرأ صفه فقط ولا يكتب مباشرة و`service_role` يقرأ فقط. الدوال الخمس `SECURITY DEFINER` و`search_path = ''` بلا overloads غير متوقعة، وتنفيذها لـ`authenticated` فقط. نجحت حالات lifecycle والـidempotency والترقية والretirement وعزل المالك وتعدد `active`، ثم رُجعت البيانات الصناعية وبقي الجدولان فارغين. ثبت تركيب advisory locks و`FOR SHARE` ساكنًا ومستضافًا، ولم ينفذ parallel stress test.

## Slice 4.1 — HOSTED APPLIED AND VERIFIED

طبقت migration `20260904195919_study_path_enrollments_one_live_forward_only.sql` مستضافًا وتحققت على PostgreSQL `17.6` بتاريخ `2026-09-04`.

- يوجد قيد B-tree exclusion واحد لكل `(user_id, path_id)` حيث الحالة `active` أو `paused`، من النوع `DEFERRABLE INITIALLY DEFERRED`: يسمح بالتعايش المؤقت للمصدر والهدف داخل الترقية الذرية target-first، لكنه يمنع التزام أكثر من نسخة live للمسار نفسه. ينشئ القيد فهرسه تلقائيًا بلا extension أو فهرس زائد.
- تبقى المسارات المختلفة live بالتوازي بلا primary/focused path. تبقى unique الإصدار الدقيق immediate وهدف `ON CONFLICT` الصريح.
- enroll للإصدار نفسه active/paused idempotent بلا resume ضمني؛ يرفض إصدارًا مختلفًا عند وجود live للمسار نفسه ويوجه إلى upgrade.
- upgrade يشترط هدفًا أكبر من المصدر قبل فرع الإعادة الناجحة أيضًا. تبقى الترقية target-first والرابط الدقيق وpublication/retirement والأقفال والأدوار كما هي.
- يتحقق lifecycle من supersession عند INSERT أو عند إنشائه بـUPDATE: هدف active لنفس المالك والمسار وبنسخة أكبر وغير المصدر. لا يلزم بقاء الهدف التاريخي active لاحقًا.
- بعد withdrawal، إذا لم يبق live، يجوز enroll لإصدار آخر مؤهل وفق دلالات terminal للإصدار الدقيق؛ لا lifetime monotonicity.
- تفحص migration التعارضات تحت `ACCESS EXCLUSIVE` داخل transaction يديرها Supabase migration runner دون `BEGIN/COMMIT` صريحين في الملف؛ تحقق rollback الذري للـrunner بprobe فاشل بلا object أو history row باقٍ، وتفشل دون إصلاح التاريخ عند وجود عدة live أو رابط supersession غير صالح. لا ترفض هدفًا تاريخيًا لمجرد تغير حالته.
- تحقق مستضافًا القيد المؤجل و`ON CONFLICT` ومصفوفات RPC/lifecycle وRLS/ACL والتنظيف النهائي. لم ينفذ اختبار ضغط متزامن حقيقي مضبوط بجلسَتين.

## Slice 5 — واجهة الطالب والتاريخ والترقية

اكتملت Slices 5A–5D محليًا فوق baseline `8415b978` بتاريخ `2026-09-06`. تعيد الواجهة استخدام helpers المجال والخدمة السحابية الحالية دون تغيير canonical definitions أو مخطط/RLS/RPC. يفصل `src/lib/student-study-path-controller.ts` التحقق بالمصادقة وقراءات الأجيال وقفل mutation عن React.

- الافتراضي هو live الوحيد؛ تعدد live أو صف أجنبي يفشل مغلقًا. يطابق `?enrollment=<uuid>` صفًا من قراءة المالك الخاصة بالمسار، ولا يمنح URL أي صلاحية. يمسح تغيير الحساب الاختيار والتاريخ السابقين.
- سجل المسار يعرض live والتسجيلات withdrawn/superseded. التاريخ للقراءة فقط، بلا Continue أو lifecycle actions؛ التقدم الحالي مشتق ضد الإصدار التاريخي المثبت وليس لقطة وقت إنهائه. غياب التعريف يبقي سلوك unavailable-version.
- تستخدم الترقية `studyPathUpgradeEligibility` و`studyPathUpgradePreview` وتعريفات Git؛ المعاينة تبين الدروس المضافة والخارجة والمشتركة وتغير البنية/الترتيب وتقدم الهدف من `lesson_progress` الموجود.
- التأكيد الصريح يتبعه قفل قبل await ثم getSession/getUser وقراءة المالك وإعادة الأهلية لنفس المصدر. يصدر RPC واحد؛ بعد أي نتيجة صالحة للنشر تعاد القراءة بدل استخدام payload. تؤكد المصالحة source superseded والرابط الدقيق والهدف live؛ بعدها تختار الواجهة الهدف افتراضيًا. رد مفقود بلا إثبات يبقى غير مؤكد، وزر التحديث يقرأ فقط ولا يعيد RPC.
- يحمي قفل lifecycle المشترك وأجيال القراءة من النقر المزدوج والإجراءات المتعارضة وauth/focus/pageshow وdispose. تحديث token أو SIGNED_IN للحساب نفسه يبقي العملية غير المؤكدة قابلة للمصالحة.
- لا تقدم أو اكتمال جديد، ولا تعديل لتقدم الدروس أو تخزين هوية التسجيل محليًا، ولا تغيير مستضاف. التحقق حتمي مع transport داخل الذاكرة، وليس اختبار RLS أو واجهة authenticated مستضافًا.

## Slice 6 — «مساراتي» داخل مساحة الطالب

- يمر `myPathsCatalog` من `src/pages/student/index.astro` وقت البناء عبر `studentStudyPathPageProps()`، مع كل الإصدارات المنشورة المتاحة وmetadata عرض منفصلة. المنهج canonical في Git؛ لا يصبح Supabase مخزنًا ثانيًا له، ولا يوجد endpoint metadata جديد أو filesystem/data-loader في مسار المتصفح.
- يبقى `StudentHome` مسؤولًا عن الربط والعرض، و`StudentMyPaths` presentational فقط. ينقل `student-home-controller.ts` التحقق والقراءات إلى فرعين مستقلين: فرع الدروس العامة، وفرع My Paths. تظل `student-my-paths.ts` مالكة التخطيط والاشتقاق النقيين، و`student-study-path-cloud.ts` مالكة القراءة السحابية المكتملة.
- يبدأ controller بـ`getSession()` ثم `getUser()` ويشترط تطابق المعرّفين. يمسح تبديل الحساب/sign-out حالة الفرعين وروابطهما وسجل المسارات فورًا. تمنع الأجيال نتائج النجاح والخطأ القديمة، وتستقل إعادة محاولة كل فرع. يبقي `TOKEN_REFRESHED`/`SIGNED_IN` للحساب المتحقق نفسه قراءاته؛ يؤجل أي auth read جديد إلى خارج callback، ويعالج focus/pageshow وdispose.
- تقرأ `readOwnerEnrollments()` كل الصفوف المرئية للمالك تحت RLS بترتيب cursor حتى صفحة فارغة متحققة، بما فيها active/paused/withdrawn/superseded. يرفض `planStudentMyPaths()` المالك الأجنبي قبل عرض أي تفاصيل، ويحل المنهج المثبت ويجمع مفاتيح جميع المسارات live. يصدر استدعاء تقدم واحد للاتحاد؛ تتكفل `readProgress()` بالدفعات والصفحات، ولا يعتمد اكتمالها على `student-progress-cloud.ts` العام.
- يجوز وجود عدة مسارات مختلفة live بالتوازي، مع نسخة live واحدة لكل مالك/مسار، ودون primary/focused path. بطاقات active/paused تستخدم الإصدار المثبت، وتشتق اكتمال الدروس والنسبة من `lesson_progress.completed` وحده؛ لا تقدم جديد مخزن ولا provider IDs ولا browser storage كمصدر للحقيقة في dashboard.
- يعرض active غير المكتمل Continue الخاص به؛ يبقى active المكتمل بحالته مع رسالة اكتمال ودون Continue. يظهر paused مع تقدمه دون Continue. روابط live هي `/student/study-paths/<slug>/` بلا `?enrollment=`.
- يعرض «سجل تسجيلاتي» withdrawn/superseded للقراءة فقط، حتى عند غياب live. يستخدم كل رابط UUID التسجيل المملوك الدقيق في `?enrollment=`. لا تقدم تاريخيًا مشتقًا على dashboard؛ تفاصيله والترقية وسائر lifecycle تبقى في صفحة Slice 5 الخاصة.
- تبقى التسجيلات ظاهرة أثناء تحميل التقدم وفشله، ولا يعرض فشل القراءة `0%`. الإصدار المثبت المفقود يمنع النسبة وContinue مع السماح بعنوان/نسخة/حالة ورابط slug متحقق؛ غياب تعريف المسار يمنع اختراع عنوان أو رابط. المجموعة الفاسدة تعرض عدم اتساق ولا تختار فائزًا. لا يعني فراغ الكتالوج فراغ تسجيلات المالك.
- يبقى Continue العام وRecent مستقلين بمعناهما وترتيبهما وكتالوجهما الأصلي؛ لا تصفية أو أولوية حسب المسار، ويجوز ظهور درس في Continue العام وContinue المسار معًا. فشل أو فراغ أحد الفرعين لا يخفي الفرع الآخر.
- لم تضف Slice 6 schema/migration/RLS/RPC أو كتابة تقدم أو lifecycle RPC من dashboard، ولا service-role access فيه. تستخدم عميل browser القائم بمفتاح publishable. الأدوات الإدارية القديمة ليست جزءًا من لوحة الطالب.

التحقق محلي وحتمي للقراءات/controller/rendering والسباقات والحالات الطرفية، مع بوابات build وCI للـcommits المثبتة؛ الأدلة في خطة Slice 6. لم تختبر رحلة My Paths إنتاجية فعلية في متصفح مصادق عليه لعدم وجود مسار علمي منشور بعد.

## Slice 7 — الإغلاق التشغيلي والمستضاف

أغلقت Slice 7 بتاريخ `2026-09-09` بالتحقق التشغيلي المستضاف الكامل على PostgreSQL `17.6` ومشروع Supabase `flrqmxxvdlwjutevefax`.

### 1. خط الأساس المستضاف (Hosted Baseline — Slice 7A)
- بدأ العمل على فرع `develop` نظيف عند baseline `438cc02` (`docs: close my paths slice 6`).
- تطابق كامل في migrations الست المحلية والبعيدة:
  `20260824000000`، `20260826000000`، `20260829000000`، `20260902000000`، `20260903164705`، `20260904195919`.
- حالة الجداول صفرية ونظيفة: `study_path_versions = 0`، و`study_path_enrollments = 0`.
- استمرار تفعيل RLS ومطابقة صلاحيات Study Paths (ACL) للمواصفات السابقة.

### 2. اختبار التزامن الحقيقي بجلسَتين مستقلتين (Slice 7B)
- نُفذ اختبار تزامن حقيقي على البيئة المستضافة عبر جلستي ومعاملتي PostgreSQL مستقلتين فعليًا، دون تعطيل أي قيود أثناء الاختبار.
- السيناريو: نفس المستخدم (`user_id`) ونفس المسار (`path_id`) مع محاولة تسجيل متزامنة لإصدارين مختلفين (v1 وv2):
  - **الجلسة أ (Session A):** نجح الـ`COMMIT` برمز خروج `RC=0`.
  - **الجلسة ب (Session B):** رُفض الـ`COMMIT` برمز خروج `RC=1` مع خطأ PostgreSQL:
    `23P01 conflicting key value violates exclusion constraint "study_path_enrollments_one_live_per_path"`
  - النتيجة بعد الـcommits: صف live واحد فقط باقٍ (`committed_live_rows = 1`).
  - أثبت الاختبار أن قيد الاستبعاد المؤجل `DEFERRABLE INITIALLY DEFERRED` فعال ومحقق في تزامن حقيقي عملي، وليس فقط ساكنًا.
  - استُبعدت محاولتان أوليتان كمسابر غير صالحة: الأولى فشلت على شرط `lifecycle_consistent`، والثانية استخدمت `session_replication_role=replica` مما أبطل صلاحيتها كإثبات للقيد المؤجل. الاعتماد الحصري تم على الاختبار النهائي الصالح.
  - تم تنظيف الجداول لتعود إلى الحالة الصفرية: `study_path_versions = 0` و`study_path_enrollments = 0`.

### 3. مسبار النشر والتراجع (rollback) (Publication / Rollback Probe — Slice 7C)
- استُخدم مسار اصطناعي مخصص داخل معاملة:
  - `before_count = 0`
  - إدخال صالح في `study_path_versions`.
  - تنفيذ `ROLLBACK` صريح.
  - `after_rollback = 0`
- الحالة النهائية: الجداول فارغة تمامًا (`0` صفوف) ولا توجد أي بيانات اصطناعية باقية.

### 4. مراجعة الأمان والأداء (Security / Performance Review)
- **مسارات الدراسة:** لا توجد أي ملاحظات مانعة للميزة. بقاء `study_path_versions` بـRLS دون policies سلوك مقصود لحجب سجل النشر عن قراءة المتصفح. دوال RPC المعرفة بـ`SECURITY DEFINER` المتاحة لـ`authenticated` مقصودة وتمثل جوهر نموذج RPC-only. الفهرس `study_path_enrollments_superseded_by_idx` الذي أفادت تقارير الأداء بأنه غير مستخدم لا يجوز حذفه لكون الجدول فارغًا حاليًا.
- **ديون عامة خارج نطاق مسارات الدراسة (Global Debt / Out of Scope):** دوال `handle_new_user()` و`rls_auto_enable()` مكشوفة `EXECUTE` لدور `PUBLIC` الافتراضي؛ حماية كلمات المرور المسربة في Auth معطلة؛ وسياسات `profiles` تعيد تقييم `auth.uid()` لكل صف. هذه الملاحظات مسجلة كديون سابقة ومستقلة لا تُعالج ضمن Slice 7 وتنتظر تحصينًا عامًا لـSupabase.

### 5. عقد التكامل المستقبلي مع Telegram / Corpus
- تم تثبيت وتأكيد العقد الفاصل فقط دون تنفيذ أي كود:
  `raw Telegram archive → transcription → LessonPart / lesson assembly → review → canonical corpus export → Product resolver → lesson_key stable`
- مشروع الـcorpus مستقل ومنفصل تمامًا.
- يُمنع منعًا باتًا دخول أي معرّف لـTelegram (message ID) أو YouTube ID أو معرّف corpus في عضوية المسار أو التسجيلات أو اشتقاق التقدم.
- تغيير مصدر المحتوى تحت نفس الـ`lesson_key` لا يُنشئ إصدارًا جديدًا للمسار؛ بل تعديل بنية المنهج التعليمية هو ما يُنشئ الإصدار الجديد.

### 6. حدود القبول والوضعية النهائية
- الإغلاق التقني والتشغيلي: **PASS**.
- قبول المتصفح والإنتاج الحقيقي بمستخدم مصادق عليه: **PENDING** حتى نشر أول مسار علمي مراجع.

## غير منفذ بعد

- لا يوجد حاليًا تعريف علمي منشور في الكتالوج (`publicStudyPaths` فارغ عمدًا)، ولذلك لا يولد البناء صفحة مسار تفصيلية فعلية، وتبقى رحلة قبول المتصفح الإنتاجية الكاملة معلقة حتى نشر أول مسار علمي مراجع.
- لا يوجد persistence للمنهج نفسه؛ المستضاف يحمل projection النشر الأدنى وتسجيلات lifecycle فقط، والمنهج canonical في Git.
- لا توجد توصيات أو محرر مسارات أو تحويل/مزامنة تلقائية من قوائم التشغيل.
- لا ينفذ هذا المستودع Telegram ingestion أو transcription أو corpus ضمن Study Paths.

لا تُعد قائمة التشغيل مسارًا تلقائيًا؛ تبقى مادة تصفح وترتيب وقد تكون تصنيفًا بلا هدف أو متطلبات.

## القرارات المعتمدة

تعريفات المنهج وإصداراته immutable تعيش canonical في Git، و`lesson_progress.completed` هو مصدر اكتمال الدرس الوحيد، وتقدم المسار قيمة مشتقة. يحمل Supabase projection النشر الأدنى للهوية والـdigest والأزمنة فقط، والتسجيل مثبت على إصدار مع ترقية صريحة. يعرض dashboard المسارات المتعددة دون primary path ودون تغيير Continue العام وRecent. التفاصيل في D-014 إلى D-017 وخطة Study Paths V1.

## الترتيب المقترح

أغلقت جميع شرائح Study Paths V1 (من Slice 1 إلى Slice 7) تقنيًا وتشغيليًا، وأُثبت قيد التزامن الحقيقي بجلسَتين مستقلتين على PostgreSQL 17.6، مع بقاء الجداول المستضافة نظيفة وصفرية.

الخطوات التالية خارج نطاق V1 التقني:
1. إعداد ومراجعة أول مسار علمي حقيقي وإضافته للكتالوج، وإجراء القبول المتصفحي الإنتاجي المصادق عليه.
2. مهمة تحصين أمني وأدائي مستقلة لـSupabase لمعالجة الديون العامة المرصودة.
