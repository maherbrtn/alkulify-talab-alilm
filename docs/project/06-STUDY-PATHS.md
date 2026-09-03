# مسارات الدراسة

## الحالة

اكتملت Slice 1 من Study Paths V1 كنموذج مجال static ونقي في Git، واكتملت Slice 2 كطبقة قراءة عامة static، واكتملت Slice 3V محليًا ومستضافًا بregistry نشر أدنى، ثم اكتملت Slice 4 محليًا ومستضافًا لتسجيل الطالب ودورة حياته. يدعم النموذج مسارًا بهوية دائمة وmetadata عرض وحالة و`currentVersion`، وإصدارات منهج ذات وحدات مرتبة وأهداف تعلم ودروس مطلوبة مرتبة تشير إلى `lesson_key` فقط. يوجد fixture تقني صغير بحالة `draft` للاختبار؛ ليس مسارًا علميًا منشورًا ولا يدخل الكتالوج العام.

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

## غير منفذ بعد

- لا يوجد حاليًا تعريف علمي منشور في الكتالوج، ولذلك لا يولد البناء صفحة مسار تفصيلية فعلية رغم جاهزية قوالب current/history.
- لا توجد UI للتسجيل أو تقدم المسار الخاص بالطالب.
- لا يوجد persistence للمنهج نفسه؛ المستضاف يحمل projection النشر الأدنى وتسجيلات lifecycle فقط.
- لا يوجد enrollment أو تثبيت طالب فعلي على إصدار أو ترقية إصدار في التطبيق؛ هذه عقود موثقة للشرائح اللاحقة فقط.
- لا توجد توصيات أو محرر مسارات أو تحويل/مزامنة تلقائية من قوائم التشغيل.
- لا ينفذ هذا المستودع Telegram ingestion أو transcription أو corpus ضمن Study Paths.

لا تُعد قائمة التشغيل مسارًا تلقائيًا؛ تبقى مادة تصفح وترتيب وقد تكون تصنيفًا بلا هدف أو متطلبات.

## القرارات المعتمدة

تعريفات المنهج وإصداراته immutable تعيش canonical في Git، و`lesson_progress.completed` هو مصدر اكتمال الدرس الوحيد، وتقدم المسار قيمة مشتقة. الإصدارات المنشورة اللاحقة ستحصل على Supabase projection أدنى للهوية والـdigest فقط، والتسجيل سيثبت على إصدار مع ترقية صريحة. التفاصيل في D-014 إلى D-017 وخطة Study Paths V1.

## الترتيب المقترح

أغلقت Slice 4 محليًا ومستضافًا. Slice 5 للواجهة هي الخطوة المخططة التالية ولم تبدأ، وأدوات التحرير والتوصيات ليستا ضمن V1 الحالي.
