# المعمارية الحالية

```text
YouTube/tafrigh + Blogger + archive.org + Telegram
                         │
                    scripts/*
                         ▼
                      data/* ──┬─▶ Astro static build ─▶ المتصفح
                               └─▶ Meilisearch indexes ─▶ Search

المتصفح ─▶ Supabase Auth ─▶ profiles + lesson_progress (RLS/RPC)
```

## الطبقات

- `src/pages/`: مسارات Astro الثابتة، ومنها صفحات الطالب.
- `src/islands/`: البحث والمشغل والمصادقة والملف ومساحة الطالب.
- `src/lib/data.ts`: يقرأ `data/` وقت البناء، يتحقق من سجل الهوية ويربط كل فيديو بـ`lessonKey`.
- `data/`: الفيديوهات والقوائم والتفريغات والمقالات وسجل الهوية.
- `scripts/`: بناء البيانات والاستيراد والفهرسة والتضمين والتقييم والتحقق.

## البحث

يتصل المتصفح مباشرة بـMeilisearch بمفتاح بحث فقط. ينفذ `src/lib/meili.ts` بحثًا هجينًا مع عتبة جودة وfallback موسوم. الفهارس هي `cues` و`lessons` و`articles`. يحسب `scripts/embed.ts` متجهات `bge-m3` عبر Ollama ويرفعها، بينما يدير `scripts/index.ts` الفهارس والإعدادات.

## Supabase

`src/lib/supabase.ts` عميل browser-only بجلسة PKCE مستمرة. جدول `profiles` صف لكل مستخدم. جدول `lesson_progress` صف لكل `(user_id, lesson_key)`؛ القراءة للمالك، والكتابة فقط عبر `merge_lesson_progress` الذي يشتق المالك من `auth.uid()`.

## تدفق التقدم

يمرر مسار الدرس `videoId` و`lessonKey` إلى `Player`. يحفظ المشغل الموضع والمدة والاكتمال (90%). تكتب طبقة `lesson-progress.ts` ظلًا محليًا أولًا، ثم RPC عند وجود جلسة، وتحذف النسخة المحلية المطابقة بعد النجاح فقط. قاعدة البيانات تحافظ على أكبر موضع/مدة وعلى اكتمال sticky.

## حدود الثقة والتحقق

مفتاح Meilisearch الإداري و`service_role` لا يصلان إلى المتصفح. الأمان في Supabase قائم على grants وRLS وRPC. يفحص `scripts/selfcheck.ts` الهوية والتقدم وخصائص migrations، ويشغل CI `pnpm check` و`pnpm build`. لا توجد اختبارات end-to-end لمشروع Supabase مستضاف داخل المستودع.
