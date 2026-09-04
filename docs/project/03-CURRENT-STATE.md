# الحالة الحالية

آخر تحقق محلي: `2026-09-04` على `develop` عند baseline `12a6902` مع تغييرات Slice 4.1 غير الملتزمة؛ نجحت selfchecks وTypeScript وbuild و`slice:verify`. طبقت Slice 4.1 مستضافًا وتحققت على PostgreSQL `17.6` في `2026-09-04`، مع بقاء اختبار ضغط متزامن حقيقي مضبوط بجلسَتين غير منفذ.

## Slice 4.1 — HOSTED APPLIED AND VERIFIED

طبقت migration `20260904195919_study_path_enrollments_one_live_forward_only.sql` على المشروع المستضاف `flrqmxxvdlwjutevefax` وتحقق سلوكها على PostgreSQL `17.6` بتاريخ `2026-09-04`.

- يوجد قيد B-tree exclusion واحد لكل `(user_id, path_id)` حيث الحالة `active` أو `paused`، من النوع `DEFERRABLE INITIALLY DEFERRED`: يسمح بالتعايش المؤقت للمصدر والهدف داخل الترقية الذرية target-first، لكنه يمنع التزام أكثر من نسخة live للمسار نفسه. ينشئ القيد فهرسه تلقائيًا بلا extension أو فهرس زائد.
- تبقى المسارات المختلفة live بالتوازي بلا primary/focused path. تبقى unique الإصدار الدقيق immediate وهدف `ON CONFLICT` الصريح.
- enroll للإصدار نفسه active/paused idempotent بلا resume ضمني؛ يرفض إصدارًا مختلفًا عند وجود live للمسار نفسه ويوجه إلى upgrade.
- upgrade يشترط هدفًا أكبر من المصدر قبل فرع الإعادة الناجحة أيضًا. تبقى الترقية target-first والرابط الدقيق وpublication/retirement والأقفال والأدوار كما هي.
- يتحقق lifecycle من supersession عند INSERT أو عند إنشائه بـUPDATE: هدف active لنفس المالك والمسار وبنسخة أكبر وغير المصدر. لا يلزم بقاء الهدف التاريخي active لاحقًا.
- بعد withdrawal، إذا لم يبق live، يجوز enroll لإصدار آخر مؤهل وفق دلالات terminal للإصدار الدقيق؛ لا lifetime monotonicity.
- تفحص migration التعارضات تحت `ACCESS EXCLUSIVE` داخل transaction يديرها Supabase migration runner دون `BEGIN/COMMIT` صريحين في الملف؛ أثبت probe فاشل rollback ذريًا بلا object أو history row باقٍ، وتفشل migration دون إصلاح التاريخ عند وجود عدة live أو رابط supersession غير صالح. لا ترفض هدفًا تاريخيًا لمجرد تغير حالته.
- تحقق مستضافًا القيد المؤجل و`ON CONFLICT` ومصفوفات RPC/lifecycle وRLS/ACL والأقفال والتنظيف النهائي. لم ينفذ اختبار ضغط متزامن حقيقي مضبوط بجلسَتين.

## يعمل الآن

- الأرشيف العام والتصفح وخط ingestion والفهرسة والبحث الحرفي/الدلالي.
- Auth بالبريد/كلمة المرور وPKCE، والملف الشخصي مع RLS.
- تقدم محلي للزائر ومزامنة تقدم المسجل عبر RPC آمن.
- مساحة الطالب V1 موثقة بالمتصفح: `StudentHome` متحقق بالمصادقة عبر `getSession()` ثم `getUser()`، ويقرأ `lesson_progress` السحابي المملوك للمستخدم عبر الخدمة المقبولة تحت RLS، من دون تعداد أو مصالحة `localStorage` في لوحة الطالب.
- عند وجود تقدم، يجلب StudentHome كتالوج metadata ثابتًا من الأصل نفسه ثم يستخدم view model النقي: Continue هو أحدث درس معروف غير مكتمل، وRecent حتى 8 صفوف معروفة مع الحفاظ على ترتيب السحابة. عند فراغ التقدم يتجاوز جلب الكتالوج.
- المفاتيح المجهولة/القديمة تبقى مخزنة بلا mutation، وتُستبعد من بطاقات الدروس مع إشعار محايد واحد. يملك `deriveStudentProgress()` دلالات العرض والاستئناف، بينما يبقى Player مسؤولًا عن حفظ التقدم والمصالحة المحلية/السحابية الحالية.
- اكتملت Study Paths Slice 1 كنموذج مجال static ونقي: تعريفات مسارات ذات إصدارات، ووحدات ودروس مطلوبة مرتبة بـ`lesson_key`، مع UUID v4 canonical lowercase وvalidation صارم وحل المفاتيح عبر registry، وcanonical serialization وSHA-256 digest يغطيان بنية المنهج المهمة ولا يشملان metadata العرض.
- يشتق `deriveStudyPathProgress()` اكتمال الدرس والوحدة والمسار والنسب وContinue الخاص بالمسار من `lesson_progress.completed` وترتيب الإصدار فقط، ويعيد استخدام resume الحالي. يحتسب التقدم السابق والمفتاح المشترك لأي مسار يحتويه بلا نسخ حالة تقدم، ويعيد snapshots مجمدة لصفوف التقدم بدل مراجع mutable يملكها المستدعي.
- اكتملت Study Paths Slice 2 محليًا: كتالوج عام static لا يقبل إلا تعريفًا حالته `published`، وحل build-time من `lesson_key` إلى route الدرس الحالية، وفهرس وقوالب current/history عامة لا تستورد Auth أو Supabase. الكتالوج فارغ عمدًا حتى ينشر منهج علمي حقيقي؛ fixture التقني draft غير مكشوف كمسار إنتاجي.
- اكتملت Study Paths Slice 3V محليًا ومستضافًا: registry بالحقول الخمسة الدنيا وPK على `(path_id, version)`، وRLS مفعل بلا policies، ولا privileges لـ`anon` أو `authenticated`، و`service_role` يملك `SELECT` فقط. ثبتت القيود وimmutability وretirement أحادي الاتجاه ورفض الحذف باختبارات transaction مستضافة، وبقي registry فارغًا بلا بيانات صناعية.
- اكتملت Study Paths Slice 4 محليًا ومستضافًا بالمigration `20260903164705`: تسجيل الطالب مثبت على إصدار وبحالات `active | paused | withdrawn | superseded`، وRLS قراءة للمالك فقط، وبلا كتابة مباشرة للمتصفح. ثبتت فعليًا RPCs الـenroll/pause/resume/withdraw/upgrade، وعزل المالك والأدوار، والانتقالات والـidempotency والretirement وتعدد المسارات النشطة، مع rollback لكل البيانات الصناعية.
- تحقق Supabase المستضاف مكتمل: Auth وprofile trigger وعزل RLS بين مستخدمين وRPC والقيود ومزامنة Player اختبرت فعليًا.
- تاريخ migrations المحلي والبعيد متطابق للإصدارات `20260824000000`، `20260826000000`، `20260829000000`، `20260902000000`، `20260903164705`، و`20260904195919`؛ و`authenticated` يملك على `profiles` فقط `SELECT/INSERT/UPDATE`.
- مزامنة upstream حتى `5dbed6d`.

## جزئي أو غير موجود

- لا تشمل مساحة الطالب V1 ملاحظات أو محفوظات سحابية أو واجهة لمسارات الدراسة أو تقدم دورة ظاهرًا للمستخدم أو نسبة تقدم عامة للأرشيف أو دلالات reset/rewatch.
- لا يوجد بعد مسار علمي منشور فعليًا أو واجهة تسجيل/تقدم Study Paths. مخطط/RPCs Slice 4 مستضافة ومتحققة، لكن لا توجد تسجيلات مستضافة؛ بقي `study_path_versions` و`study_path_enrollments` بصفر صفوف. الـfixture الحالي تقني بحالة `draft` وليس مسارًا علميًا منشورًا، وقوائم التشغيل تبقى للتصفح والتسلسل فقط.
- لا توجد توصيات لمسارات الدراسة، ولا ينفذ هذا المستودع ingestion أو corpus خاصًا بـTelegram ضمن الميزة.
- لا توجد Ask AI أو RAG؛ البحث الدلالي استرجاع فقط.

## الخطوة التالية

إغلاق تغييرات Slice 4.1 المطبقة والمتحققة محليًا ومستضافًا، مع إبقاء اختبار الضغط المتزامن الحقيقي المضبوط قيدًا معروفًا. Slice 4 تبقى مغلقة وفق عقدها السابق؛ Slice 5 لم تبدأ.

## عوائق ومخاطر نشطة

- حفظ أكبر موضع لا يمثل الرجوع المقصود أو إعادة الدراسة.
- قد يبقى ظل `localStorage` أحدث قليلًا من Supabase بعد `pagehide`، وهو غير مفصول حاليًا حسب المستخدم في المتصفح المشترك.
- ACL `service_role` على `profiles` غير معتاد لكنه سابق لـ02V ولم يتغير، والتطبيق لا يستخدمه في المتصفح.
- المحلي مربوط بـ`videoId` والسحابة بـ`lesson_key`؛ تغيير المصدر أو UUIDs يحتاج ترحيلًا يحفظ تقدم الطلاب.
- المحتوى والبحث يعتمدان على مصادر وخدمات خارجية، ومزامنة upstream اليدوية حساسة خصوصًا في `Player.tsx` وخط البيانات والإعدادات.

نجح التحقق المتصفحي لمسار 03 الأساسي: لوحة authenticated، وContinue وRecent والاستئناف عبر Player، والخروج، وسطح المكتب والهاتف، ثم نجحت `pnpm check` و`pnpm build` و`pnpm exec tsc --noEmit` و`git diff --check`. لم تختبر يدويًا كل الحالات الطرفية؛ بقيت حالات صفر تقدم والمفاتيح المجهولة واكتمال الكل وخطأ/إعادة محاولة progress أو catalog غير منفذة متصفحيًا لعدم توفر حالة طبيعية أو حجب طلبات آمن، وهي مغطاة بمنطق نقي وselfchecks مقبولة.

تغطي selfchecks الخاصة بـStudy Paths صلاحية الهوية والإصدار والحالة والبنية والترتيب وعدم التكرار، وحل `lesson_key`، وثبات canonical form والـdigest، وتأثره بكل بنية منهجية مهمة دون metadata العرض، واشتقاق التقدم وContinue، وفلترة النشر وroute resolution، وmanifest/registry duplicate/missing/mismatch/retirement. وتغطي كذلك شكل enrollment migration وFK/unique/indexes وعدم وجود progress/provider fields أو one-active constraint، وowner RLS/grants، وتواقيع RPCs و`auth.uid()`/`search_path`/EXECUTE، ودلالات transitions/idempotency/concurrency القابلة للإثبات ساكنًا.
