# الحالة الحالية

آخر تحقق محلي: `2026-09-09` على `develop` عند baseline `bc04797e16ab5515c0aee5211d95c6276d5e1247` لقبول Slice 6C. اكتملت Slice 6A عند `5ab65c0` وSlice 6B عند `bc04797`: «مساراتي» داخل مساحة الطالب مع بقاء Continue العام وRecent مستقلين. القبول محلي وحتمي ببيانات داخل الذاكرة وفحص المخرجات static، مع CI ناجح للـcommits المثبتة وبقاء الكتالوج العام فارغًا؛ لا رحلة تسجيل إنتاجية مختبرة في متصفح مصادق عليه ولا قبول مستضاف جديد. الأدلة والحدود في [خطة Slice 6](plans/06-student-my-paths.md).

آخر تحقق مستضاف لـSlice 4.1 بقي بتاريخ `2026-09-04` على PostgreSQL `17.6`. لم ينفذ اختبار تزامن حقيقي مضبوط بجلسَتين، ولم تعد قراءة حالة الجداول البعيدة في قبول Slice 6C.

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

## جزئي أو غير موجود

- لا تشمل لوحة مساحة الطالب ملاحظات أو محفوظات سحابية أو نسبة تقدم عامة للأرشيف أو دلالات reset/rewatch؛ «مساراتي» وصفحة المسار الخاص منفذتان.
- لا يوجد مسار علمي منشور فعليًا؛ كتالوج `publicStudyPaths` فارغ عمدًا، لذلك لا يولد البناء صفحة مسار تفصيلية إنتاجية لرحلة تسجيل My Paths حقيقية. الـfixture تقني draft، والاختبارات تستخدم مناهج داخل الذاكرة. آخر تحقق مستضاف سابق ترك جدولي النشر والتسجيل فارغين؛ لم تعد قراءة حالتهما في Slice 5D أو Slice 6C، ولم تنفذ acceptance mutation مستضافة جديدة في Slice 6.
- لا توجد توصيات لمسارات الدراسة، ولا ينفذ هذا المستودع ingestion أو corpus خاصًا بـTelegram ضمن الميزة.
- لا توجد Ask AI أو RAG؛ البحث الدلالي استرجاع فقط.

## الخطوة التالية

الخطوة التالية Slice 7 closeout وفق خطة V1، وليست مزيدًا من ميزات Slice 6. لم تبدأ أعمال Slice 7 في قبول 6C. تظل رحلة My Paths المتكاملة في متصفح بحساب حقيقي مشروطة بمنهج علمي منشور مراجع أو بيئة اختبار منفصلة معزولة؛ لم ينشر fixture لاختلاقها. لا تدعي selfchecks أو CI/build إثبات الشبكة/RLS المستضافة أو التزامن الحقيقي المضبوط بجلسَتين.

## عوائق ومخاطر نشطة

- حفظ أكبر موضع لا يمثل الرجوع المقصود أو إعادة الدراسة.
- قد يبقى ظل `localStorage` أحدث قليلًا من Supabase بعد `pagehide`، وهو غير مفصول حاليًا حسب المستخدم في المتصفح المشترك.
- ACL `service_role` على `profiles` غير معتاد لكنه سابق لـ02V ولم يتغير، والتطبيق لا يستخدمه في المتصفح.
- المحلي مربوط بـ`videoId` والسحابة بـ`lesson_key`؛ تغيير المصدر أو UUIDs يحتاج ترحيلًا يحفظ تقدم الطلاب.
- المحتوى والبحث يعتمدان على مصادر وخدمات خارجية، ومزامنة upstream اليدوية حساسة خصوصًا في `Player.tsx` وخط البيانات والإعدادات.

نجح التحقق المتصفحي لمسار 03 الأساسي: لوحة authenticated، وContinue وRecent والاستئناف عبر Player، والخروج، وسطح المكتب والهاتف، ثم نجحت `pnpm check` و`pnpm build` و`pnpm exec tsc --noEmit` و`git diff --check`. لم تختبر يدويًا كل الحالات الطرفية؛ بقيت حالات صفر تقدم والمفاتيح المجهولة واكتمال الكل وخطأ/إعادة محاولة progress أو catalog غير منفذة متصفحيًا لعدم توفر حالة طبيعية أو حجب طلبات آمن، وهي مغطاة بمنطق نقي وselfchecks مقبولة.

تغطي selfchecks الخاصة بـStudy Paths صلاحية الهوية والإصدار والحالة والبنية والترتيب وعدم التكرار، وحل `lesson_key`، وثبات canonical form والـdigest، وتأثره بكل بنية منهجية مهمة دون metadata العرض، واشتقاق التقدم وContinue، وفلترة النشر وroute resolution، وmanifest/registry duplicate/missing/mismatch/retirement. وتغطي كذلك شكل enrollment migration وFK/unique/indexes وعدم وجود progress/provider fields أو one-active constraint، وowner RLS/grants، وتواقيع RPCs و`auth.uid()`/`search_path`/EXECUTE، ودلالات transitions/idempotency/concurrency القابلة للإثبات ساكنًا.

تغطي selfchecks الموجودة لـSlice 6 اكتمال owner pagination والتخطيط/الاشتقاق، وتعدد active/paused والتاريخ وحالات missing/corrupt/foreign-owner، واستقلال الفرعين، وتحقق الهوية وسباقات النجاح والفشل وإعادة المحاولة وأحداث الصفحة وdispose، وrendering العربي والروابط واستقلال Continue/Recent. أعيد تشغيلها في 6C دون تعديل كود أو إضافة اختبارات مكررة؛ نجح البناء بـ`8260` صفحة وguard، وفُحص noindex و`myPathsCatalog` الفارغ في StudentHome المبني. نتائج البوابات وCI الموثقة وحدودها في خطة Slice 6، ولا تشمل قبول تسجيل إنتاجي أو تغيير schema/RLS/RPC أو mutation مستضافة.
