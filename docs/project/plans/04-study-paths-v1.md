# خطة: 04 — مسارات الدراسة V1

- الحالة: `نشطة — Slice 2 مكتملة`
- المالك: `Codex / صاحب المشروع`
- آخر تحديث: `2026-09-02`
- ملف الوحدة: `docs/project/06-STUDY-PATHS.md`

## الهدف ومعيار الاكتمال

إضافة مسارات دراسة عامة ومنظمة فوق الدروس الحالية، مع تسجيل خاص بالطالب مثبت على إصدار منهج غير قابل للتغيير، ومن دون إنشاء مصدر ثانٍ لاكتمال الدرس أو ربط المسار بمزود محتوى. يكتمل V1 عندما يمكن نشر تعريفات ثابتة بإصدارات، وتسجيل الطالب في عدة مسارات نشطة بالتوازي، واشتقاق تقدم كل مسار ووحداته من `lesson_progress`، وعرض «تابع المسار» لكل تسجيل نشط مع بقاء Continue العام والدروس الأخيرة مستقلين.

بدأ التنفيذ واكتملت Slice 1 الخاصة بالمجال الثابت والاشتقاقات النقية، ثم Slice 2 لصفحات القراءة العامة static. لا تتضمن الحالة المنفذة migration أو كتابة Supabase أو تسجيلات؛ Slice 3 هي الخطوة التالية بعد مراجعة بوابة Slice 2.

## الحالة الأساسية ودليل المستودع

- الفرع `develop` عند `de84c46a8dd8e2ee4852ce363f2008b0cfa5eb02`، ومتزامن مع `origin/develop` ونظيف عند إنشاء الخطة.
- Astro يبني موقعًا static؛ بيانات الطالب وحدها تصل إلى Supabase من عميل browser-only بمفتاح publishable.
- `data/lesson-registry.json` يحتوي 4691 هوية `lesson_key` فريدة تقابل 4691 درسًا حاليًا. يضيف `scripts/sync-lesson-registry.ts` UUID للدروس الجديدة فقط، ويفشل البناء عند غياب الربط أو تكراره.
- الربط الدائم محايد في علاقات المنتج، مع أن resolver الحالي يحمل `youtube_video_id`؛ تطوير resolver لمصادر لاحقة لا يغير UUID القائم.
- `lesson_progress` صف واحد لكل `(user_id, lesson_key)`؛ القراءة للمالك تحت RLS، والكتابة عبر `merge_lesson_progress` فقط، والاكتمال sticky وفق إشارة Player الحالية عند 90% أو نهاية التشغيل.
- مساحة الطالب تقرأ التقدم السحابي وتحل metadata بكتالوج static، وتشتق Continue العام وRecent من دون كتابة أو مصالحة محلية.
- توجد 109 قوائم تشغيل و582 درسًا في أكثر من قائمة. القوائم مادة تصفح وترتيب وليست مسارات دراسة وفق D-010.
- يوجد الآن نموذج المجال في `src/lib/study-paths.ts` وfixture تقني draft في `src/lib/fixtures/study-path-v1.json` وتغطية regression في `scripts/selfcheck.ts`، وكتالوج عام يفشل مغلقًا أمام المسودات ويحل الدروس إلى routes وقت البناء، وصفحات static للفهرس والإصدار الحالي والتاريخي. لا توجد جداول أو تسجيلات لمسارات الدراسة، والكتالوج العام فارغ عمدًا حتى يراجع مسار علمي حقيقي وينشر.

## النطاق

### داخل V1

- هوية دائمة للمسار، وmetadata عرض عامة حالية، وإصدارات منهج immutable في Git.
- وحدات مرتبة، لكل منها هوية وعنوان وهدف تعلم وترتيب داخل الإصدار.
- دروس مطلوبة مرتبة تشير إلى `lesson_key` فقط.
- projection صغير في Supabase لهويات الإصدارات المنشورة وسلامة التسجيل، ثم تسجيلات مملوكة للمستخدم بعد إثبات النموذج الثابت.
- حالات التسجيل: `active | paused | withdrawn | superseded`، مع السماح بعدة تسجيلات `active` للمستخدم نفسه.
- تثبيت كل تسجيل على إصدار محدد، وترقية صريحة تنشئ تسجيلًا للإصدار الجديد وتجعل القديم `superseded`.
- اشتقاق تقدم الوحدة والمسار وContinue الخاص بكل مسار من تعريف الإصدار و`lesson_progress` الحالي.
- صفحات عامة static للمسارات وصفحات طالب للتسجيلات في الشرائح اللاحقة.

### خارج النطاق صراحةً

- أي عمل لأرشفة Telegram أو التفريغ أو تجميع corpus داخل هذا المستودع.
- استخدام Telegram message IDs أو YouTube IDs أو corpus IDs في عضوية المسار.
- تحويل playlist تلقائيًا إلى مسار أو إبقاؤه متزامنًا معه.
- optional lessons أو branching أو prerequisites أو quizzes أو شهادات أو شارات أو streaks.
- منع الطالب من فتح درس لاحق؛ الترتيب يوجه Continue ولا يفرض gating في V1.
- مسار focused/primary عالمي أو قيد «مسار نشط واحد» أو تفضيل يختار مسارًا رئيسيًا.
- جدول ثانٍ لاكتمال الدرس، أو نسخ completion إلى عناصر المسار، أو تخزين نسبة تقدم كحقيقة مستقلة.
- محرر/admin UI أو صلاحيات محررين في V1.
- تغيير دلالات Player أو local-first أو monotonic merge أو reset/rewatch.
- جعل الحساب شرطًا لقراءة تعريفات المسارات العامة.

## ثوابت المجال

1. `path_id` UUID دائم، و`slug` تسمية route لا تستخدم كمفتاح علاقات دائم.
2. عضوية المسار لا تحمل إلا `lesson_key` دائمًا قائمًا في سجل المنتج.
3. لا يعاد توليد `lesson_key` ولا يعاد إسناده إلى درس آخر.
4. يجوز للدرس أن ينتمي إلى عدة مسارات وإصدارات، لكنه لا يتكرر داخل إصدار مسار واحد.
5. كل إصدار منشور immutable ويحتوي البنية التعليمية المهمة كاملة.
6. تشمل البنية المهمة: هوية الوحدة وعنوانها وهدفها وترتيبها، وعضوية الدروس وترتيبها.
7. يشمل digest كل البنية المهمة السابقة بعد canonical serialization، ولا يشمل metadata العرض الحالية على مستوى المسار.
8. title/description/marketing/visual metadata الحالية للمسار وحدها قابلة للتعديل بلا إصدار منهج جديد.
9. كل تسجيل مثبت على `(path_id, path_version)` ولا يتبع latest تلقائيًا.
10. تبقى الإصدارات التاريخية وتعريفاتها قابلة للبناء ما دام تسجيل واحد قد يشير إليها.
11. `lesson_progress.completed` هو المرجع الوحيد لاكتمال الدرس.
12. تقدم الوحدة والمسار ونسبتهما وحالة الاكتمال قيم مشتقة وليست سجلات مستقلة.
13. جميع دروس V1 مطلوبة؛ يجب أن يحتوي الإصدار المنشور وحدة واحدة ودرسًا واحدًا على الأقل.
14. تكتب جميع UUIDs بتهجئة canonical lowercase. وحده الإصدار الحالي لمسار `draft` يجوز أن يحمل `publishedAt: null`؛ كل إصدار آخر مؤرخ بـISO timestamp canonical، وكل إصدار منشور immutable.

## النموذج المقترح

### التعريف canonical في Git

```ts
type StudyPath = {
  pathId: string
  slug: string
  title: string
  description: string
  status: 'draft' | 'published' | 'retired'
  currentVersion: number
  presentation?: Record<string, unknown>
}

type StudyPathVersion = {
  pathId: string
  version: number
  publishedAt: string | null
  modules: StudyPathModule[]
}

type StudyPathModule = {
  moduleKey: string
  title: string
  objective: string
  position: number
  lessons: StudyPathLesson[]
}

type StudyPathLesson = {
  lessonKey: string
  position: number
}
```

يحسب `definition_digest` من representation canonical لـ`pathId` و`version` والوحدات بهوياتها وعناوينها وأهدافها وترتيبها والدروس بمفاتيحها وترتيبها. لا يعتمد digest على ترتيب مفاتيح JSON أو whitespace أو metadata العرض العامة.

### projection النشر في Supabase — شريحة لاحقة

`study_path_versions` ليس نسخة ثانية من المنهج. الحقول المقترحة فقط:

- `path_id uuid`
- `version integer`
- `definition_digest text`
- `published_at timestamptz`
- `retired_at timestamptz null`
- primary key: `(path_id, version)`

لا يخزن هذا الجدول slug أو title أو description أو modules أو objectives أو lesson membership/order. لا يعتمد browser عليه في render التعريف العام؛ صفحات المسارات تقرأ تعريف Git المبني static. وظيفته FK للتسجيل، والتحقق من publication/digest، وهوية الإصدار immutable، وسياسة منع تسجيلات جديدة بعد retirement.

### تسجيل الطالب في Supabase — شريحة لاحقة

`study_path_enrollments`:

- `id uuid primary key`
- `user_id uuid references auth.users(id) on delete cascade`
- `path_id uuid`
- `path_version integer`
- `state text check (state in ('active', 'paused', 'withdrawn', 'superseded'))`
- `enrolled_at timestamptz`
- `updated_at timestamptz`
- `paused_at timestamptz null`
- `withdrawn_at timestamptz null`
- `superseded_at timestamptz null`
- `superseded_by_enrollment_id uuid null`
- FK `(path_id, path_version)` إلى `study_path_versions`
- unique `(user_id, path_id, path_version)`

لا يوجد partial unique index على التسجيلات النشطة. يجوز للمستخدم امتلاك عدة مسارات `active` بالتوازي. عمليات mutation تكون RPC-only وتشتق المالك من `auth.uid()`، ولا تقبل `p_user_id` ولا تغير إصدار تسجيل قائم.

## سياسة الإصدارات الدقيقة

| التغيير | النتيجة |
|---|---|
| عنوان المسار العام أو وصفه المختصر أو marketing/visual copy | يعدل metadata العرض الحالية بلا إصدار جديد؛ يراه الجميع |
| هوية الوحدة أو عنوانها أو هدفها | إصدار منهج جديد |
| ترتيب الوحدات | إصدار منهج جديد |
| إضافة درس أو حذفه أو تغيير عضويته | إصدار منهج جديد |
| ترتيب الدروس | إصدار منهج جديد |
| إعادة تصميم معتبرة | إصدار جديد، مع هويات وحدات جديدة حيث لا توجد استمرارية حقيقية |

- التسجيلات القائمة تبقى مثبتة دائمًا ولا تتبع الإصدار الجديد تلقائيًا.
- التسجيل الجديد يأخذ `currentVersion` المنشور وقت التسجيل.
- الترقية صريحة: تنشئ enrollment جديدًا، وتحول القديم إلى `superseded`، وتربطهما. لا يعاد نسخ تقدم الدروس؛ المفاتيح المشتركة تستفيد تلقائيًا من `lesson_progress` القائم.
- retirement يمنع تسجيلات جديدة في الإصدار ولا يحذف التعريف أو registry row أو يكسر التسجيلات القائمة.

## دلالات التقدم والاكتمال

- **الدرس مكتمل:** توجد للمالك row حيث `lesson_progress.lesson_key` يطابق العنصر و`completed = true`. لا يعاد حساب threshold داخل المسار.
- **الوحدة مكتملة:** كل `lesson_key` مطلوب في الوحدة مكتمل. غياب row يعني غير مكتمل.
- **المسار مكتمل:** كل درس مطلوب في الإصدار المثبت مكتمل. لا تتحول `state` إلى `completed`؛ الاكتمال derived مستقل عن lifecycle state.
- **النسبة:** `floor(completed distinct required lessons / total distinct required lessons * 100)`. الإصدار المنشور غير فارغ، والمسار المكتمل يعرض 100% بالضبط. لا weighting بالمدة ولا بمتوسط نسب المشاهدة أو الوحدات.
- إن أكمل الطالب درسًا قبل التسجيل، يحتسب فورًا لأي مسار يحتوي `lesson_key` نفسه.

## Continue ومساحة الطالب

يعرض القسم المستقبلي «مساراتي» كل تسجيل `active` مستقلًا:

```text
المسار أ → النسبة المشتقة + تابع المسار
المسار ب → النسبة المشتقة + تابع المسار
```

لكل تسجيل، «تابع المسار» يختار أول درس مطلوب غير مكتمل وفق ترتيب الوحدات ثم الدروس في الإصدار المثبت، ويتجاوز المكتمل. إذا كان للدرس تقدم جزئي غير مكتمل يعاد استخدام `studentEffectiveResumeSeconds`/Player semantics الحالية؛ وإلا يفتح من البداية. لا يختار النظام مسارًا رئيسيًا ولا يغير حالات بقية التسجيلات.

يبقى Continue العام الحالي مستقلًا، وكذلك Recent. لا يعاد تعريف أي منهما ليعني Continue لمسار واحد.

## RLS وRPC في الشرائح اللاحقة

- registry قابل للقراءة حسب أقل حاجة فعلية، ومن دون أي grants كتابة للمتصفح؛ النشر migration/deployment-controlled.
- enrollments تحت RLS بقراءة owner-only، ولا INSERT/UPDATE/DELETE مباشرًا لـ`authenticated`.
- RPCs ضيقة بـ`SECURITY DEFINER` و`search_path = ''` وأسماء fully qualified وأنواع ثابتة ومالك مشتق من `auth.uid()`.
- enroll: يتحقق من وجود الإصدار وعدم retirement ثم ينشئ `active`، من دون pause لمسارات أخرى.
- pause/resume: يغير التسجيل المحدد المملوك فقط؛ resume يعيده `active` ولا يؤثر في غيره.
- withdraw: soft transition ويحفظ التاريخ والتقدم.
- upgrade: transaction تنشئ/تعيد التسجيل الجديد وتحوّل القديم إلى `superseded` فقط.
- القراءة والاشتقاق في V1 يعيدان استخدام owner-scoped `lesson_progress`; لا progress write جديد للمسارات.

## الشرائح الصغيرة القابلة للعكس

### Slice 1 — المجال الثابت والاشتقاقات النقية فقط

- [x] أنواع TypeScript لـStudy Path وVersion وModule وLesson item.
- [x] fixture/تعريف مسار Git-authored صغير يستخدم `lesson_key` حقيقية.
- [x] validation للـUUIDs canonical lowercase، والإصدار، والحالات، ودورة `publishedAt`، وعدم الفراغ، وpositions المتصلة/الفريدة، وعدم تكرار modules أو lessons.
- [x] canonical serialization وحساب digest يغطي كل curriculum-significant structure.
- [x] تحقق أن كل `lesson_key` في كل إصدار منشور تحل عبر `data/lesson-registry.json`، من دون تخزين provider ID في التعريف.
- [x] pure derivation واختبارات/selfchecks لاكتمال الدرس والوحدة والمسار، النسبة، التقدم السابق للتسجيل، الدرس المشترك، وPath Continue المرتب.
- [x] لا migration ولا Supabase client/RPC ولا UI ولا route في هذه الشريحة.

بوابة Slice 1: أثبتت selfchecks النموذج static والـdigest deterministic وregistry resolution للـfixture، وروجعت البنية المقترحة. لا يمثل fixture draft نشر مسار علمي أو تفعيل enrollment.

### Slice 2 — صفحات القراءة العامة static

- [x] index للمسارات وصفحة current وصفحة version تاريخية من تعريف Git فقط.
- [x] حل `lesson_key` إلى route الدرس الحالية وقت البناء.
- [x] ضمان بقاء القراءة عامة وعدم اعتماد render على Supabase registry.

بوابة Slice 2: يبني `/study-paths/` دائمًا، ولا يقبل الكتالوج العام إلا تعريفًا حالته `published`، وتولد قوالب current والتاريخية لكل نسخه المنشورة المحتفظ بها. لا يدخل fixture التقني draft الكتالوج؛ لذلك لا توجد صفحة مسار تفصيلية منشورة حاليًا إلى أن يعتمد منهج علمي حقيقي. تغطي selfchecks حدود توليد route entries نفسها، وuniqueness وslug safety وحل current/history وربط كل `lesson_key` بمسار `/v/` عام، ولا تستورد صفحات أو resolver العام Supabase أو auth.

### Slice 3 — registry النشر الأدنى

- [ ] migration جديدة لـ`study_path_versions` بالحقول الدنيا فقط.
- [ ] publication check يقارن `(path_id, version, definition_digest)` مع Git.
- [ ] اختبارات immutability وretirement ومنع الكتابة من browser roles.

### Slice 4 — التسجيلات وRLS/RPC

- [ ] migration مستقلة لـ`study_path_enrollments` والحالات الأربع وFK/RLS/grants.
- [ ] RPCs للتسجيل وpause/resume وwithdraw/upgrade.
- [ ] تحقق hosted من owner isolation ورفض anon/other-user والإصدار المزيف والمتقاعد.
- [ ] إثبات عدة تسجيلات `active` للمستخدم نفسه؛ لا global focus ولا partial unique index.

### Slice 5 — واجهة التسجيل والمسار الخاص

- [ ] enroll controls للتعريفات المنشورة وصفحة enrollment مملوكة.
- [ ] تقدم الوحدة/المسار وPath Continue مشتقة من التعريف static و`lesson_progress`.
- [ ] loading/empty/error/retry والوصول وRTL والهاتف.

### Slice 6 — دمج «مساراتي» في مساحة الطالب

- [ ] بطاقة لكل تسجيل active مع تقدمه وContinue الخاص به.
- [ ] paused/withdrawn/superseded وفق UX صريح بلا حذف.
- [ ] الحفاظ منفصلين على Continue العام وRecent الحاليين.
- [ ] ترقية إصدار صريحة وبيان أثرها قبل التنفيذ.

### Slice 7 — الإغلاق التشغيلي والتوثيق

- [ ] تحقق publication/rollback مستضاف ومراجعة security/performance.
- [ ] تحديث `06-STUDY-PATHS.md` و`03-CURRENT-STATE.md` بما نفذ فعلاً فقط.
- [ ] توثيق عقد التكامل المستقبلي مع corpus من دون تنفيذه.

كل Slice لها diff ومراجعة وبوابات تحقق مستقلة، ولا يبدأ توسيع النطاق ضمنيًا إذا فشلت بوابتها.

## ترتيب النشر في النموذج الهجين

لإصدار جديد لاحقًا:

1. يضاف تعريف الإصدار immutable إلى Git ويضبط `currentVersion` في metadata ضمن التغيير نفسه.
2. تشغل validation وdigest وregistry-resolution وselfchecks والبناء؛ لا ينشر تعريف غير صالح.
3. تضاف migration/projection row المطابقة `(path_id, version, digest, published_at)` وتتحقق على staging/hosted قبل إتاحة enrollment.
4. ينشر build static الذي يحتوي التعريف وصفحات الإصدار.
5. تفعل قابلية التسجيل في الإصدار بعد إثبات تطابق digest ووجود الصفحة المنشورة. إذا تعذر الفصل التشغيلي، يبقى UI enrollment مغلقًا حتى اكتمال check بعد النشر.
6. لا تعدل registry row منشورة لتغيير المنهج؛ أي اختلاف digest يفشل النشر ويستلزم إصلاح التعريف غير المنشور أو إصدارًا جديدًا.

لا يستخدم browser registry لبناء curriculum. الاعتماد الوحيد عليه عند mutation هو إثبات أن هوية الإصدار منشورة وصالحة للتسجيل.

## rollback

- **قبل وجود تسجيلات:** يمكن تعطيل current version وإزالة/إبطال projection غير المستخدم ضمن migration تصحيحية؛ لا يعاد كتابة migration مطبقة.
- **بعد وجود تسجيل:** لا يحذف الإصدار أو تعريفه أو registry row. يحدد `retired_at` لمنع تسجيلات جديدة، ويعاد `currentVersion` إلى إصدار صالح أو ينشر إصدار إصلاح جديد.
- rollback للواجهة يعيد build static السابق، مع إبقاء الصفحات التاريخية التي تحتاجها التسجيلات.
- rollback لـenrollment UI/RPC لا يحذف بيانات الطالب؛ توقف mutation الجديدة وتبقى القراءة أو الاستعادة اللاحقة ممكنة.
- لا تغير الأخطاء في مصدر الدرس `lesson_key`. يصلح resolver أو المصدر خلف المفتاح؛ لا ترحل عضوية المسار إلى provider ID جديد.

## إبقاء الإصدارات التاريخية قابلة للبناء

- تحفظ ملفات كل نسخة منشورة في Git ولا تعدل أو تستبدل.
- يجمع build كل الإصدارات المنشورة والمتقاعدة المحتفظ بها في Git، لا currentVersion فقط؛ ولا يحتاج build إلى قراءة enrollments من Supabase.
- selfcheck يتحقق من uniqueness وdigest ووجود كل lesson key في registry لكل نسخة منشورة/retired المحتفظ بها.
- لا يحذف mapping قديم من registry بسبب تغير المزود. إذا تعذر عرض درس مؤقتًا، يبقى المفتاح ويظهر unavailable state صريح بدل إسقاط المتطلب أو احتسابه مكتملًا.
- retirement يمنع التسجيلات الجديدة فقط؛ لا يعني حذف الصفحة التاريخية.

## توافق مشروع Telegram Knowledge Archive المستقبلي

- مشروع corpus منفصل مسؤول عن raw archive → transcription → lesson assembly → review → canonical corpus.
- التكامل مع هذا المنتج يتم بعقد export/integration صريح ذي version، لا بقراءة جداول corpus الداخلية ولا بإدخال pipeline corpus هنا.
- يبقى `lesson_key` حد الهوية. يطور Product resolver لاحقًا لربط المفتاح بالمصدر canonical الحالي مع حفظ UUID والتقدم والتسجيلات.
- لا تدخل Telegram/YouTube/corpus identifiers في path files أو enrollment schema أو progress derivation.
- تغيير المصدر أو تحسينه تحت `lesson_key` لا ينشئ إصدار مسار؛ تغيير هوية/عضوية/ترتيب المنهج هو الذي ينشئ الإصدار.

## معايير قبول V1 الدقيقة

- [ ] يستطيع الزائر تصفح المسارات المنشورة وإصداراتها العامة بلا حساب وبلا query إلى Supabase registry للـrender.
- [ ] كل تعريف منشور يستخدم `lesson_key` فقط، وكل مفتاح يحل عبر registry وقت البناء.
- [ ] لا يظهر provider ID في membership أو enrollment أو progress derivation.
- [ ] digest deterministic ويغطي module identity/title/objective/order وlesson membership/order.
- [ ] تعديل أي curriculum-significant field يتطلب version جديدًا، بينما path-level presentation metadata لا يتطلبه.
- [ ] الإصدار المنشور immutable، غير فارغ، ولا يكرر درسًا أو وحدة.
- [ ] التسجيل مثبت على إصدار ولا يتبع latest تلقائيًا.
- [ ] الترقية صريحة وتحول القديم إلى `superseded` وتحفظ الاستفادة من تقدم المفاتيح المشتركة.
- [ ] يمكن للمستخدم امتلاك مسارين أو أكثر في حالة `active` بالتوازي.
- [ ] لا يوجد global focused/primary path ولا unique constraint على active enrollments.
- [ ] owner وحده يقرأ التسجيل، وanon/other-user/direct table mutation مرفوضة.
- [ ] `lesson_progress.completed` وحده يحدد اكتمال الدرس؛ لا جدول completion ثانٍ.
- [ ] الوحدة والمسار والنسبة مشتقة بالقواعد الموثقة، ويحتسب التقدم السابق للتسجيل والدرس المشترك بلا نسخ بيانات.
- [ ] كل active path يعرض تقدمه وContinue الخاص به: أول required incomplete حسب الترتيب، مع resume الحالي، وتجاوز المكتمل.
- [ ] Continue العام وRecent يبقيان مستقلين وغير متغيري المعنى.
- [ ] retirement يمنع enrollment جديدًا ولا يكسر التسجيلات أو الصفحات التاريخية.
- [ ] تعريفات الإصدارات التاريخية وregistry mappings اللازمة تبقى قابلة للبناء.
- [ ] drift بين Git digest وSupabase projection يفشل publication.
- [ ] `pnpm check` و`pnpm build` و`pnpm exec tsc --noEmit` و`git diff --check` تنجح لكل شريحة وظيفية.
- [ ] اختبارات RLS/RPC المستضافة تثبت الملكية والحالات والترقية وتعدد active enrollments قبل إغلاق شرائح Supabase.
- [ ] لا ينفذ أي عمل corpus/Telegram في هذا المستودع ضمن V1.

## مخاطر وشروط توقف

- إذا احتاج render العام إلى Supabase registry، يتوقف العمل ويعاد تقييم الحد static بدل توسيع projection.
- إذا لم يمكن جعل digest canonical ومستقرًا، لا تبدأ migration registry.
- إذا وجد `lesson_key` غير محلول في نسخة منشورة، يفشل البناء ولا يحذف العنصر أو يخمن بديله.
- إذا احتاج enrollment FK إلى نسخ modules/items في Supabase، يتوقف العمل؛ الـprojection الأدنى قرار معماري.
- إذا تطلب Path Continue تغيير Player أو completion semantics، يتوقف العمل ويطلب قرارًا منفصلًا.
- حجم قراءة جميع `lesson_progress` مقبول مبدئيًا وفق النمط الحالي؛ إذا أثبت القياس عكس ذلك، يدرس RPC قراءة/aggregation مشتقة من الجدول نفسه، لا جدول completion جديد.
- تبديل المصدر المستقبلي يحتاج تطوير resolver، لأن سجل اليوم يحمل `youtube_video_id`; يحفظ ذلك كل `lesson_key` ولا يدخل ضمن Study Paths V1.

## التحقق

لكل شريحة وظيفية:

- [ ] selfchecks الأقرب لعقد الشريحة وحالاتها الطرفية.
- [ ] مراجعة عدم تسرب provider IDs وعدم تكرار completion state.
- [ ] `pnpm check`.
- [ ] `pnpm build`.
- [ ] `pnpm exec tsc --noEmit`.
- [ ] `git diff --check`.

لهذه الشريحة التوثيقية فقط:

- [x] مراجعة diff للملفين المصرح بهما.
- [x] `git diff --check`.
- [x] لا application code ولا migration ولا commit ولا push.

## النتيجة

اكتملت Slice 1 عند `45291c9`: نموذج المجال static، والتحقق، والـcanonical digest، واشتقاقات التقدم وContinue، وتغطية التقدم السابق والمشترك. اكتملت Slice 2 محليًا بكتالوج وصفحات قراءة static من Git فقط، من دون نشر fixture المسودة كمنهج حقيقي. Slice 3 وما بعدها غير منفذة؛ يبقى أي عمل Supabase أو enrollment أو UI خاصًا بالطالب مؤجلًا إلى شريحته الصريحة.
