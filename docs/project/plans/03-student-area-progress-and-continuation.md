# خطة: 03 — مساحة الطالب: التقدم والمتابعة

- الحالة: `نشطة`
- المالك: `Codex / صاحب المشروع`
- آخر تحديث: `2026-08-30`
- ملف الوحدة: `docs/project/04-STUDENT-LAYER.md`

## A. الهدف ونتيجة المستخدم في V1

تحويل `/student/` من غلاف تقني للحساب إلى مساحة تعرض تقدم الدروس السحابي المملوك للمستخدم المسجل، مع بطاقة «تابع التعلّم» وقائمة حديثة محدودة، من دون تغيير مخطط Supabase أو سلوك Player أو جعل الحساب شرطًا لقراءة الأرشيف العام.

يكتمل V1 عندما يستطيع الطالب رؤية أحدث درس معروف غير مكتمل حسب `client_updated_at` والعودة إلى موضعه الفعّال، ورؤية أحدث 8 دروس معروفة مع حالة ومعلومة تقدم، مع بقاء الملف الشخصي والخروج وحالات التحميل/الفراغ/الخطأ وإعادة المحاولة.

## B. النطاق

| داخل نطاق 03 V1 | خارج النطاق صراحةً |
|---|---|
| قراءة `lesson_progress` السحابي للمستخدم الموثق عبر RLS | استيراد/دمج/حذف تقدم `localStorage` من مساحة الطالب |
| بطاقة Continue لأحدث درس معروف غير مكتمل | تغيير حفظ/استئناف/دمج Player |
| أحدث 8 دروس معروفة حسب `client_updated_at` | pagination أو infinite scroll |
| تقدم كل درس وتمييز المكتمل/الجاري | نسبة إكمال عامة للأرشيف |
| join آمن من `lesson_key` إلى metadata الحالية | مسارات/وحدات/تسجيل/تقدم دورة أو playlist |
| loading/empty/error/retry وتحذير حميد اختياري للمفاتيح المجهولة | أهداف وتوصيات وشارات وAsk AI وcloud notes وreset وadmin |

يطبق حد `8` بعد حل metadata، فلا تستهلك المفاتيح المجهولة أي خانة. سياق playlists خارج نطاق 03 V1 بالكامل: لا تختار مساحة الطالب playlist أساسية، ولا تصف playlists بأنها دورات أو مسارات دراسة. يبقى Telegram المصدر الأصلي/المرجعي المقرر لمحتوى أبي جعفر، ولا تعيد مساحة الطالب تعريف provenance.

## C. المعمارية والحدود

- `StudentHome.tsx`: session verification والحساب والخروج.
- `supabase.ts`: عميل browser-only publishable وPKCE.
- `lesson_progress`: صف لكل `(user_id, lesson_key)` وقراءة المالك تحت RLS.
- `lesson-progress.ts`: local-first ومصالحة Player الحالية؛ ملف محمي لا تمسه 03.
- lesson registry: الربط الدائم `lesson_key ↔ videoId`؛ مصادره محمية ولا تعدلها 03.
- `data.ts` ومصادر البيانات: build-time موجودة ولا تعدلها 03.
- `Player.tsx`: يحترم `?t=` ويحفظ قبل RPC؛ ملف محمي ويبقى بلا تغيير.
- migrations الحالية مثبتة في 02V؛ لا تعدل ولا تضاف migration.

## D. استعلام التقدم وتدفق البيانات

```text
StudentHome client:load
  → getSession()
  → getUser() للتحقق
  → قراءة واحدة authenticated owner-scoped من lesson_progress
  → SELECT lesson_key, position_seconds, duration_seconds,
           completed, client_updated_at
  → ORDER BY client_updated_at DESC
  → بلا server-side limit
  → إذا كانت النتيجة فارغة: render empty ولا fetch للكتالوج
  → إذا احتوت صفًا: fetch كتالوج ثابت مصغر من نفس الأصل
  → حل metadata مع إبقاء ترتيب النشاط التنازلي
  → knownRows = الصفوف التي حُل lesson_key الخاص بها فقط
  → Continue = أول صف في knownRows حيث completed === false
  → Recent = أول 8 صفوف من knownRows
  → render
```

القراءة السحابية واحدة فقط، وتختار بالضبط الحقول الخمسة المذكورة، ولا تضع حدًا على الخادم لأن الحد يطبق بعد حل metadata. يفرض RLS الملكية؛ لا يمرر العميل `user_id` كحد ثقة، ولا يستخدم credentials مميزة، ولا يستدعي RPC merge أو أي كتابة.

## E. المفاتيح المجهولة وقواعد الاختيار

- **`knownRows`:** صفوف القراءة التي يطابق `lesson_key` فيها metadata حالية، مع الحفاظ على ترتيب `client_updated_at DESC`.
- **Continue:** أول صف في `knownRows` حيث `completed === false`. قد تكون أحدث الصفوف الخام مكتملة أو مجهولة من دون أن تحجب المرشح الصحيح.
- **Recent:** أول 8 صفوف من `knownRows`. قد يظهر المكتمل في Recent، لكنه لا يصبح Continue أبدًا.
- **المفتاح المجهول/القديم:** لا يحذف ولا يعدل ولا يخمن ولا يعاد إسناده. يستبعد من Continue، ولا يستهلك خانة Recent، ولا يفشل مساحة الطالب. يجوز تحذير واحد غير مانع مهما كان عدد الصفوف.
- تخفى Continue إذا لم يوجد صف معروف غير مكتمل؛ تبقى Recent إن وجدت.

## F. دلالات عرض التقدم والاستئناف

تبقى قيم قاعدة البيانات المخزنة كما هي؛ كل clamp أو اشتقاق للعرض والرابط فقط ولا يكتب إلى السحابة أو التخزين المحلي.

إذا كان `duration_seconds > 0`:

- `completed === true` يعني `displayPercentage = 100`.
- وإلا: `displayPercentage = round(clamp(position_seconds / duration_seconds * 100, 0, 100))`.
- إذا كان `position_seconds > duration_seconds`، تقطع النسبة إلى 100 ويكون `effectiveResumeSeconds = duration_seconds`.
- وإلا: `effectiveResumeSeconds = clamp(position_seconds, 0, duration_seconds)`.

إذا كان `duration_seconds <= 0`:

- لا نسبة رقمية ولا progress bar مصطنع.
- تبقى حالة المكتمل/الجاري.
- `effectiveResumeSeconds = max(position_seconds, 0)` للرابط فقط.

الصف غير المكتمل ذو `position_seconds === 0` يبقى مؤهلًا لـContinue. رابط Continue:

- إذا كان `effectiveResumeSeconds > 0`: `/v/{videoId}/?t={floor(effectiveResumeSeconds)}`.
- وإلا: `/v/{videoId}/` بلا `?t=`.

الدروس المكتملة لا تصبح Continue. درس Recent المكتمل يفتح من البداية عبر `/v/{videoId}/`. لا تتغير دلالات Player.

## G. كتالوج metadata المؤقت

يعتمد V1 مبدئيًا `src/pages/student/lesson-catalog.json.ts`: build artifact عام static من نفس الأصل، غير authenticated، ولا يحتوي private data. يجلب فقط بعد نجاح تحقق auth/session ونجاح قراءة تقدم المالك وثبوت وجود صف واحد على الأقل. إذا كان التقدم فارغًا فلا يجلب الكتالوج.

يحتوي كل عنصر فقط:

- `lessonKey`
- `videoId`
- `title`

ولا يحتوي duration أو playlists أو descriptions أو thumbnails أو provenance text أو user data. هو projection مؤقت لا مصدر حقيقة جديدًا. لا تمرر البيانات في hydration props، ولا تستورد مجموعات JSON الكبيرة داخل island، ولا تستخدم Meilisearch أو endpoint ديناميكيًا.

## H. بوابة أداء الكتالوج

أثناء التنفيذ، وقبل اعتماد التصميم، تقاس وتوثق:

- raw bytes
- gzip bytes
- Brotli bytes إذا كان متاحًا بسهولة
- أثره على زمن البناء

الميزانيات:

- raw `<= 700 KiB`
- gzip `<= 250 KiB`
- Brotli SHOULD be `<= 200 KiB`

إذا تجاوز gzip مقدار `250 KiB` يتوقف التنفيذ ويطلب قرار تصميم جديد. لا يقدم تلقائيًا sharding أو SSR أو dynamic APIs أو Meilisearch أو per-lesson endpoints أو إعادة تصميم نموذج البيانات. تجاوز raw ميزانيته أو Brotli القيمة الإرشادية يفشل البوابة ويحتاج تقييمًا صريحًا؛ شرط gzip هو شرط التوقف القطعي المحدد.

## I. حالات الواجهة والوصول

- تحميل الحساب ثم تحميل التقدم بلا بيانات مستخدم سابق.
- الفراغ يدعو لفتح درس، ولا يجلب الكتالوج ولا يعرض إحصاءات صفرية أو وعودًا بمسار.
- خطأ progress/catalog يعرض retry يعيد pipeline ولا يغير session.
- الجلسة غير الصالحة تتبع sign-out/redirect الحالي.
- تحذير واحد غير مانع مسموح للمفاتيح المجهولة؛ لا عنوان مخمنًا أو رابطًا لها.
- الخروج لا يمس local progress، وretry لا يكرر auth listener.
- أقسام وقائمة دلالية و`aria-live` بلا تكرار؛ أهداف لمس ≥44px وRTL طبيعي.
- الهاتف عمود واحد، والحالة لا تعتمد على اللون؛ لا bar عند مدة غير موجبة.

## J. حدود localStorage والأمن

لا تقوم مساحة الطالب بتعداد `localStorage`، أو قراءة ظلال التقدم المحلية، أو تعديل/حذف أي قيمة، أو مصالحة تقدم محلي إلى السحابة، أو نسبة سجلات browser-wide إلى المستخدم المسجل.

تبقى مزامنة Player الحالية local-first كما هي. تبقى المسارات العامة المجهولة متاحة، وStudent Area static shell بعميل publishable فقط، وRLS حد الملكية. لا `service_role` أو secrets أو SSR أو privileged server code. الكتالوج static same-origin ولا يوسع CSP.

## K. الملفات المتوقعة في التنفيذ اللاحق

| الملف | الإجراء المتوقع |
|---|---|
| `src/islands/StudentHome.tsx` | UI وحالات التقدم |
| `src/lib/student-progress.ts` | القراءة والتحويلات النقية |
| `scripts/selfcheck.ts` | assertions للعقد والاختيار والنسبة والروابط |
| `src/pages/student/lesson-catalog.json.ts` | الكتالوج العام الثابت |
| `src/pages/student/index.astro` | فقط إذا كان مطلوبًا فعليًا |

لا تخطط 03 لتعديل `src/islands/Player.tsx` أو `src/lib/lesson-progress.ts` أو `src/lib/data.ts` أو أي مصدر lesson registry أو Supabase migration. إذا أصبح أحدها ضروريًا، يتوقف العمل ويشرح السبب قبل توسيع النطاق.

## L. خطة التحقق

### عقد القراءة والتحويلات

- [ ] اختيار الحقول الخمسة بالضبط: `lesson_key`, `position_seconds`, `duration_seconds`, `completed`, `client_updated_at`.
- [ ] `client_updated_at DESC` وبلا server-side limit.
- [ ] Continue صحيح حتى عندما تكون أحدث الصفوف الخام مكتملة.
- [ ] unknown لا يمنع Continue ولا يفشل المساحة ولا يستهلك خانة Recent.
- [ ] Recent لا يتجاوز 8 دروس معروفة والحد بعد metadata resolution.
- [ ] المكتمل لا يصبح Continue، والمكتمل ذو مدة موجبة يعرض `100%`.
- [ ] المدة غير الموجبة لا تعرض نسبة أو bar وتبقي الحالة.
- [ ] `position_seconds > duration_seconds > 0` يقطع العرض والاستئناف إلى المدة بلا mutation.
- [ ] Continue ذو الموضع صفر مؤهل ورابطه بلا `?t=`.
- [ ] الاستئناف الموجب يستخدم `floor(effectiveResumeSeconds)`، وRecent المكتمل يفتح من البداية.

### التكامل والانحدارات

- [ ] owner-only read يعمل بالعميل authenticated publishable تحت RLS، بلا privileged credentials.
- [ ] الكتالوج لا يجلب عندما يكون progress فارغًا.
- [ ] لا Student Area localStorage access أو mutation أو reconciliation أو attribution.
- [ ] لا تغيير في Player أو سلوكه.
- [ ] unknown لا يحذف أو يعدل أو يخمن؛ التحذير، إن ظهر، واحد وغير مانع.
- [ ] قياس raw/gzip/Brotli إن توفر بسهولة وأثر build-time وتطبيق الميزانيات.
- [ ] لا playlists في الكتالوج/الواجهة ولا course/path أو إعادة تعريف provenance.
- [ ] anonymous public routes (`/`, `/v/`, `/p/`, `/a/`, `/b/`, البحث والمحفوظات) غير متأثرة.
- [ ] output ثابت، صفحات الطالب `noindex` وخارج sitemap، وCSP بلا توسع، ولا أسرار.
- [ ] mobile/desktop وRTL/LTR والعناوين الطويلة ولوحة المفاتيح وقارئ شاشة أساسي.
- [ ] `pnpm check`.
- [ ] `pnpm build`.
- [ ] `git diff --check`.

## M. شرائح التنفيذ اللاحق

1. التحويلات والاختبارات لـ`knownRows` وContinue وRecent وunknown والنسبة والروابط.
2. projection بالحقول الثلاثة، ثم قياس raw/compressed/build-time وبوابة الأداء.
3. القراءة السحابية الواحدة بلا localStorage/RPC، ومراجعة الأعمدة والترتيب وعدم limit وRLS.
4. تركيب StudentHome وحالاته، ثم الوصول وRTL والهاتف.
5. تحقق resume مع Player الحالي بلا تعديله، والتصفح العام وstatic/CSP/secrets.
6. `pnpm check` ثم `pnpm build` ثم `git diff --check`.

لا تبدأ شريحة قبل نجاح بوابة السابقة. هذه الخطة لا تبدأ IMPLEMENT بذاتها.

## N. شروط التوقف

يتوقف التنفيذ بدل توسيع النطاق بصمت إذا:

1. تجاوز الكتالوج gzip مقدار `250 KiB`.
2. تطلب توليده تعديل مصادر بيانات upstream-sensitive.
3. عجز RLS الحالي عن قراءة المالك بالعميل authenticated publishable.
4. تطلب Continue الصحيح تغيير schema أو RPC.
5. تطلب التنفيذ مصالحة `localStorage`.
6. تطلب التنفيذ تغيير دلالات Player.
7. تطلب التنفيذ SSR أو privileged server code.
8. ناقضت وثائق المشروع authoritative هذه القرارات ماديًا.
9. أصبح تعديل ملف محمي أو migrations ضروريًا.
10. تطلب الحل migration/table/grant/RLS جديدًا أو مفتاحًا privileged.
11. تعذر join موثوق أو ظهر غياب/تكرار واسع في registry.
12. تطلب الحل sharding أو dynamic APIs أو Meilisearch أو per-lesson endpoints أو إعادة تصميم نموذج البيانات.
13. تطلب المنتج playlist canonical أو course/path أو إعادة تعريف provenance.
14. طلب أي عنصر آخر خارج نطاق 03 V1.

عند التوقف يشرح المنفذ السبب والدليل والقرار المطلوب، ولا ينفذ البديل تلقائيًا.

## القرارات والمخاطر المثبتة

- Continue أول `knownRows` غير مكتمل وفق `client_updated_at DESC`.
- Recent أول 8 معروفة بعد metadata resolution؛ المكتمل مسموح والمجهول لا يستهلك خانة.
- `/student/` cloud-only؛ ظل `pagehide` قيد معروف لا تعالجه المساحة.
- unknown يبقى بلا حذف أو تعديل أو تخمين.
- لا global/archive أو playlist/path progress.
- لا commit أو push حتى طلب صريح.

## النتيجة

PLAN gate فقط: الخطة توثق عقد V1 النهائي وشروط التنفيذ والتوقف. لم ينفذ كود تطبيق أو migration أو تثبيت حزمة.
