# الحالة الحالية

آخر تحقق مستضاف وتشغيلي: `2026-09-09` على `develop` عند baseline `438cc02` (`docs: close my paths slice 6`).
الحالة المعتمدة: **Slice 7 operational closeout PASS ; Study Paths V1 implementation techniquement close ; production content/browser acceptance pending first reviewed scientific path.**

اكتملت جميع شرائح Study Paths V1 (من 1 إلى 7) تقنيًا وتشغيليًا. أثبت تحقق Slice 7 المستضاف على PostgreSQL `17.6` ومشروع `flrqmxxvdlwjutevefax` قيد الاستبعاد المؤجل في تزامن حقيقي بجلسَتين مستقلتين، ونجح مسبار النشر والتراجع (rollback)، واستقرت الجداول في حالة صفرية ونظيفة (`0` صفوف). تبقى رحلة التسجيل المتصفحية الإنتاجية الحقيقية معلقة حتى اعتماد ونشر أول مسار علمي مراجع في الكتالوج (`publicStudyPaths = []`).

## Slice 7 — HOSTED OPERATIONAL CLOSEOUT AND CONCURRENCY VERIFICATION

تحقق الإغلاق التشغيلي المستضاف على PostgreSQL `17.6` في المشروع `flrqmxxvdlwjutevefax` بتاريخ `2026-09-09`:

- **خط الأساس المستضاف (Slice 7A):** الفرع `develop` نظيف عند `438cc02`، وتطابق كامل في الـmigrations الست (`20260824000000`، `20260826000000`، `20260829000000`، `20260902000000`، `20260903164705`، `20260904195919`). الجداول فارغة تمامًا (`study_path_versions = 0` و`study_path_enrollments = 0`)، وRLS مفعل، وصلاحيات ACL مطابقة للمواصفات.
- **اختبار التزامن الحقيقي بجلسَتين (Slice 7B):** نُفذ اختبار متزامن حقيقي بمعاملتي PostgreSQL مستقلتين فعليًا دون تعطيل القيود، لنفس المستخدم ونفس المسار مع محاولة تسجيل متزامنة لإصدارين (v1 وv2):
  - الجلسة أ: نجح الـ`COMMIT` برمز `RC=0`.
  - الجلسة ب: رُفض الـ`COMMIT` برمز `RC=1` مع خطأ PostgreSQL رقم `23P01`: `conflicting key value violates exclusion constraint "study_path_enrollments_one_live_per_path"`.
  - النتيجة: التزام صف live واحد فقط (`committed_live_rows = 1`)؛ وبذلك ثبت القيد المؤجل `DEFERRABLE INITIALLY DEFERRED` عمليًا في تزامن حقيقي وليس فقط ساكنًا.
  - استُبعدت المحاولتان الأوليتان كمسابر غير صالحة (الأولى لفشلها على `lifecycle_consistent`، والثانية لاستخدامها `session_replication_role=replica`). الاعتماد الحصري على الاختبار النهائي الصالح، وأعاد التنظيف النهائي الجداول للحالة الصفرية.
- **مسبار النشر والتراجع (rollback) (Slice 7C):** مسار اصطناعي داخل معاملة: `before_count = 0`، ثم `INSERT` صالح في `study_path_versions`، ثم `ROLLBACK` صريح، و`after_rollback = 0`. لم تتبق أي بيانات اصطناعية.
- **مراجعة الأمان والأداء:** لا توجد ملاحظات مانعة لمسارات الدراسة. RLS على `study_path_versions` بلا policies مقصود لحجب سجل النشر عن المتصفح، ودوال RPC بـ`SECURITY DEFINER` المتاحة لـ`authenticated` مقصودة وتمثل نموذج RPC-only. الفهرس `study_path_enrollments_superseded_by_idx` يُحتفظ به ولا يُحذف استنادًا لجدول فارغ مؤقتًا.
- **ديون عامة خارج نطاق مسارات الدراسة:** رُصدت كديون سابقة تحال لتحصين منفصل: دوال `handle_new_user()` و`rls_auto_enable()` مكشوفة `EXECUTE` لدور `PUBLIC`، وحماية كلمات المرور المسربة في Auth معطلة، وسياسات `profiles` تعيد تقييم `auth.uid()` لكل صف.
- **عقد التكامل المستقبلي مع Telegram / Corpus:** العقد الفاصل: `raw Telegram archive → transcription → LessonPart / lesson assembly → review → canonical corpus export → Product resolver → lesson_key stable`. الـcorpus مشروع منفصل؛ لا تدخل معرّفات Telegram أو YouTube أو corpus في جداول أو اشتقاقات المسارات، وتغيير المصدر تحت نفس الـ`lesson_key` لا ينشئ إصدار مسار جديد.

## يعمل الآن

- الأرشيف العام والتصفح وخط ingestion والفهرسة والبحث الحرفي/الدلالي.
- Auth بالبريد/كلمة المرور وPKCE، والملف الشخصي مع RLS.
- تقدم محلي للزائر ومزامنة تقدم المسجل عبر RPC آمن.
- مساحة الطالب الأساسية لها تحقق متصفحي سابق مستقل عن Slice 6. ينسق الآن `student-home-controller.ts` التحقق عبر `getSession()` ثم `getUser()` مع اشتراط تطابق المعرّفين، وقراءة تقدم المالك تحت RLS، دون تعداد أو مصالحة `localStorage` في لوحة الطالب. يبقى `StudentHome` للربط والعرض.
- عند وجود تقدم، يجلب فرع الدروس العامة كتالوج metadata الثابت نفسه من الأصل نفسه ثم يستخدم `deriveStudentProgress()`: Continue هو أحدث درس معروف غير مكتمل، وRecent حتى 8 صفوف معروفة مع الحفاظ على ترتيب السحابة. عند فراغ التقدم يتجاوز جلب الكتالوج؛ لا تغير عضوية المسارات هذه الدلالات أو الترتيب.
- المفاتيح المجهولة/القديمة تبقى مخزنة بلا mutation، وتُستبعد من بطاقات الدروس مع إشعار محايد واحد. يملك `deriveStudentProgress()` دلالات العرض والاستئناف، بينما يبقى Player مسؤولًا عن حفظ التقدم والمصالحة المحلية/السحابية الحالية.
- اكتملت Study Paths Slice 1 كنموذج مجال static ونقي: تعريفات مسارات ذات إصدارات، ووحدات ودروس مطلوبة مرتبة بـ`lesson_key`، مع UUID v4 canonical lowercase وvalidation صارم وحل المفاتيح عبر registry، وcanonical serialization وSHA-256 digest يغطيان بنية المنهج المهمة ولا يشملان metadata العرض.
- يشتق `deriveStudyPathProgress()` اكتمال الدرس والوحدة والمسار والنسب وContinue الخاص بالمسار من `lesson_progress.completed` وترتيب الإصدار فقط، ويعيد استخدام resume الحالي. يحتسب التقدم السابق والمفتاح المشترك لأي مسار يحتويه بلا نسخ حالة تقدم، ويعيد snapshots مجمدة لصفوف التقدم بدل مراجع mutable يملكها المستدعي.
- اكتملت Study Paths Slice 2 محليًا: كتالوج عام static لا يقبل إلا تعريفًا حالته `published`، وحل build-time من `lesson_key` إلى route الدرس الحالية، وفهرس وقوالب current/history عامة لا تستورد Auth أو Supabase. الكتالوج فارغ عمدًا حتى ينشر منهج علمي حقيقي؛ fixture التقني draft غير مكشوف كمسار إنتاجي.
- اكتملت Study Paths Slice 3V محليًا ومستضافًا: registry بالحقول الخمسة الدنيا وPK على `(path_id, version)`، وRLS مفعل بلا policies، ولا privileges لـ`anon` أو `authenticated`، و`service_role` يملك `SELECT` فقط. ثبتت القيود وimmutability وretirement أحادي الاتجاه ورفض الحذف باختبارات transaction مستضافة، وبقي registry فارغًا بلا بيانات صناعية.
- اكتملت Study Paths Slice 4 محليًا ومستضافًا بالمigration `20260903164705`: تسجيل الطالب مثبت على إصدار وبحالات `active | paused | withdrawn | superseded`، وRLS قراءة للمالك فقط، وبلا كتابة مباشرة للمتصفح. ثبتت فعليًا RPCs الـenroll/pause/resume/withdraw/upgrade، وعزل المالك والأدوار، والانتقالات والـidempotency والretirement وتعدد المسارات النشطة، مع rollback لكل البيانات الصناعية.
- التحقق المستضاف السابق أثبت Auth وprofile trigger وعزل RLS بين مستخدمين وRPC والقيود ومزامنة Player؛ ليس قبولًا جديدًا للوحة My Paths.
- في آخر تحقق مستضاف كان تاريخ migrations المحلي والبعيد متطابقًا للإصدارات `20260824000000`، `20260826000000`، `20260829000000`، `20260902000000`، `20260903164705`، و`20260904195919`؛ وكان `authenticated` يملك على `profiles` فقط `SELECT/INSERT/UPDATE`. لم تعد هذه القراءات في Slice 6C.
- مزامنة upstream مكتملة حتى `d3ee5dc` عبر فرع `integrate/haitham-2026-09-04` وcommit التكامل `c26d118 merge: sync upstream view transitions`؛ دخل commitا هيثم `581ff88` و`d3ee5dc` بلا تعارضات، ونجحت بوابات التحقق وGitHub Actions run `33917124878`.
- اكتملت Slice 5A–5D محليًا: خدمة سحابية موجودة بـRPCs الخمس وصفحة طالب مثبتة الإصدار، وإجراءات enroll/pause/resume/withdraw، وسجل مملوك للمسار وترقية صريحة للأمام مع معاينة المنهج وتقدم الهدف. يفصل `student-study-path-controller.ts` auth والأجيال وقفل mutation عن العرض.
- يطابق `?enrollment=` صفًا من قراءة المالك للمسار فقط؛ المدخل غير الصالح أو المجهول يفشل مغلقًا، والتاريخ withdrawn/superseded للقراءة مع تقدم الدروس الحالي بحسب المنهج المثبت، لا snapshot عند الإنهاء. يمسح تغيير الحساب التحديد والتاريخ السابقين.
- بعد upgrade يعاد التحقق والقراءة؛ لا يعتمد العرض على payload الـRPC. تؤكد المصالحة المصدر superseded ورابطه الدقيق والهدف live قبل اختيار الهدف بالطريقة المعتادة. الخطأ أو فقد الرد لا يعيد RPC تلقائيًا، وإعادة المحاولة تقرأ فقط. لا كتابة إلى تقدم الدروس.

- اكتملت Slice 6A/6B وقبول Slice 6C المحلي: يبني `student/index.astro` كتالوج المسارات عبر `studentStudyPathPageProps()` بكل الإصدارات المنشورة المتاحة وmetadata منفصلة، ويعرض `StudentMyPaths` الحالة المشتقة فقط. يملك `student-my-paths.ts` التخطيط والاشتقاق النقيين، وتملك `student-study-path-cloud.ts` القراءة الكاملة للمالك حتى صفحة cursor فارغة متحققة.
- ينفذ controller فرعي الدروس العامة وMy Paths مستقلين، دون ربط نجاح أحدهما بالآخر. يخطط `planStudentMyPaths()` مفاتيح المناهج المثبتة لجميع المسارات live؛ يصدر استدعاء `readProgress()` واحد للاتحاد وتكتمل دفعاته/صفحاته داخل الخدمة قبل اشتقاق النسب. فراغ الكتالوج أو التقدم العام لا يلغي قراءة تسجيلات المالك.
- تظهر مسارات مختلفة متعددة live بالتوازي بلا primary/focused path؛ active غير المكتمل له Continue الخاص به، وpaused يظهر بتقدمه دون Continue، وactive المكتمل يبقى active بلا Continue. `lesson_progress.completed` وحده حقيقة الاكتمال، والبطاقات مثبتة على نسخ التسجيل؛ لا browser storage truth ولا provider IDs في عقود المسارات ولا lifecycle writes أو service-role access في dashboard.
- روابط live بلا `?enrollment=`، وسجل withdrawn/superseded للقراءة فقط بروابط UUID التسجيل المملوك الدقيقة. لا يشتق dashboard تقدم التاريخ؛ التفاصيل والترقية تبقيان في صفحة Slice 5. غياب التعريف يمنع العنوان المخترع والرابط، وغياب النسخة يمنع النسبة/Continue، والمجموعة الفاسدة لا تختار فائزًا، والمالك الأجنبي يفشل الفرع كله مغلقًا. فشل التقدم لا يصبح `0%`.
- يمسح تغيير الحساب أو sign-out الفرعين وسجل المسارات والروابط القديمة فورًا؛ تمنع الأجيال نتائج النجاح/الفشل المتأخرة وتفصل محاولات القراءة. يعالج controller focus/pageshow/dispose، ويحفظ العمل للحساب نفسه مع TOKEN_REFRESHED/SIGNED_IN، ويخرج من auth callback قبل بدء تحقق جديد. يمكن ظهور الدرس نفسه في Continue العام وContinue المسار دون تعارض.
- اكتملت Slice 7 بالإغلاق التشغيلي المستضاف: أثبت اختبار التزامن الحقيقي المستضاف بجلسَتين مستقلتين على PostgreSQL 17.6 قيد `study_path_enrollments_one_live_per_path` المؤجل برفض الجلسة الثانية برمز خطأ 23P01 والتزام صف live واحد، وأثبت مسبار النشر والتراجع (rollback) سلامة المعاملات، واستقرت الجداول في حالة صفرية ونظيفة (`0` صفوف)، وثبتت مراجعة الأمان والأداء سلامة نموذج Study Paths، مع توثيق عقد التكامل المستقبلي مع مشروع الكوربس المنفصل.

## جزئي أو غير موجود

- لا تشمل لوحة مساحة الطالب ملاحظات أو محفوظات سحابية أو نسبة تقدم عامة للأرشيف أو دلالات reset/rewatch؛ «مساراتي» وصفحة المسار الخاص منفذتان.
- لا يوجد مسار علمي منشور فعليًا؛ كتالوج `publicStudyPaths` فارغ عمدًا، لذلك لا يولد البناء صفحة مسار تفصيلية إنتاجية لرحلة تسجيل My Paths حقيقية. الـfixture تقني draft، والاختبارات تستخدم مناهج داخل الذاكرة. ترك مسبار النشر واختبار التزامن في Slice 7 جدولي النشر والتسجيل فارغين ونظيفين؛ تبقى رحلة تسجيل My Paths الإنتاجية معلقة بنشر أول مسار علمي مراجع.
- لا توجد توصيات لمسارات الدراسة، ولا ينفذ هذا المستودع ingestion أو corpus خاصًا بـTelegram ضمن الميزة.
- لا توجد Ask AI أو RAG؛ البحث الدلالي استرجاع فقط.

## الخطوة التالية

الخطوة التالية بعد إغلاق Slice 7 التشغيلي هي إعداد ومراجعة أول مسار علمي حقيقي ونشره لاختبار رحلة My Paths الإنتاجية المتكاملة في المتصفح بحساب مصادق عليه. يلي ذلك في مسار منفصل مهمة تحصين لـSupabase لمعالجة الديون العامة المرصودة (صلاحيات الدوال العامة، وتفعيل leaked-password protection، وسياسات profiles).

## عوائق ومخاطر نشطة

- ديون عامة في Supabase مرصودة أثناء مراجعة Slice 7 وخارج نطاق مسارات الدراسة: دوال `handle_new_user()` و`rls_auto_enable()` مكشوفة `EXECUTE` لدور `PUBLIC`؛ خاصية leaked-password protection في Auth معطلة؛ وسياسات جدول `profiles` تعيد تقييم `auth.uid()` لكل صف في البيئة المستضافة. تحتاج لتحصين منفصل.
- حفظ أكبر موضع لا يمثل الرجوع المقصود أو إعادة الدراسة.
- قد يبقى ظل `localStorage` أحدث قليلًا من Supabase بعد `pagehide`، وهو غير مفصول حاليًا حسب المستخدم في المتصفح المشترك.
- ACL `service_role` على `profiles` غير معتاد لكنه سابق لـ02V ولم يتغير، والتطبيق لا يستخدمه في المتصفح.
- المحلي مربوط بـ`videoId` والسحابة بـ`lesson_key`؛ تغيير المصدر أو UUIDs يحتاج ترحيلًا يحفظ تقدم الطلاب.
- المحتوى والبحث يعتمدان على مصادر وخدمات خارجية، ومزامنة upstream اليدوية حساسة خصوصًا في `Player.tsx` وخط البيانات والإعدادات.

نجح التحقق المتصفحي لمسار 03 الأساسي: لوحة authenticated، وContinue وRecent والاستئناف عبر Player، والخروج، وسطح المكتب والهاتف، ثم نجحت `pnpm check` و`pnpm build` و`pnpm exec tsc --noEmit` و`git diff --check`. لم تختبر يدويًا كل الحالات الطرفية؛ بقيت حالات صفر تقدم والمفاتيح المجهولة واكتمال الكل وخطأ/إعادة محاولة progress أو catalog غير منفذة متصفحيًا لعدم توفر حالة طبيعية أو حجب طلبات آمن، وهي مغطاة بمنطق نقي وselfchecks مقبولة.

تغطي selfchecks الخاصة بـStudy Paths صلاحية الهوية والإصدار والحالة والبنية والترتيب وعدم التكرار، وحل `lesson_key`، وثبات canonical form والـdigest، وتأثره بكل بنية منهجية مهمة دون metadata العرض، واشتقاق التقدم وContinue، وفلترة النشر وroute resolution، وmanifest/registry duplicate/missing/mismatch/retirement. وتغطي كذلك شكل enrollment migration وFK/unique/indexes وعدم وجود progress/provider fields أو one-active constraint، وowner RLS/grants، وتواقيع RPCs و`auth.uid()`/`search_path`/EXECUTE، ودلالات transitions/idempotency/concurrency القابلة للإثبات ساكنًا.

تغطي selfchecks الموجودة لـSlice 6 اكتمال owner pagination والتخطيط/الاشتقاق، وتعدد active/paused والتاريخ وحالات missing/corrupt/foreign-owner، واستقلال الفرعين، وتحقق الهوية وسباقات النجاح والفشل وإعادة المحاولة وأحداث الصفحة وdispose، وrendering العربي والروابط واستقلال Continue/Recent. أعيد تشغيلها في 6C دون تعديل كود أو إضافة اختبارات مكررة؛ نجح البناء بـ`8260` صفحة وguard، وفُحص noindex و`myPathsCatalog` الفارغ في StudentHome المبني. نتائج البوابات وCI الموثقة وحدودها في خطة Slice 6، ولا تشمل قبول تسجيل إنتاجي أو تغيير schema/RLS/RPC أو mutation مستضافة.
