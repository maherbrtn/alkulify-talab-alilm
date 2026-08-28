# مصادر المحتوى

## الدروس

المرجع قناة YouTube `@Alkulify1`. التفريغ يتم خارج المستودع بواسطة `tafrigh` (ترجمة YouTube العربية أو wit.ai). يقرأ `scripts/build-data.ts` ملفات `RAW_DIR/*.transcript.json` ويبني الفيديوهات والقوائم و`data/segments/`.

## النصوص الأخرى

- `scripts/articles.ts`: مرآة Blogger Atom.
- `scripts/wayback.ts`: لقطات archive.org لموقع `alkulify.com`؛ نسخة WordPress تتقدم على Blogger عند التكرار.
- `scripts/telegram.ts`: منشورات وصور تيليجرام إلى صيغة المقالات؛ الصور في `public/tg/`.
- ملفات `data/articles/` تشمل المقالات والفتاوى والكتب وروابط المصدر/التنزيل عند وجودها.
- PDF ليس مصدر استخراج معتمدًا بسبب تشوه الأرقام والمسافات الموثق في README.

## خط الاستيراد

`pnpm ingest` = `data` ثم `articles` ثم `telegram` ثم `index`. ويضيف `pnpm lesson-registry` UUIDs للدروس الجديدة فقط. يدير `pnpm embed` المتجهات، و`verify` اتساق المصدر/البيانات/الفهرس، و`eval` جودة البحث.

الفهارس: `cues` للمقاطع الزمنية، `lessons` لنص الدرس الكامل، و`articles` للفقرات. لقطة `data/` هي مصدر بناء Astro، وسجل الهوية ملك دائم للمشروع.

## المخاطر

تغير المصادر الخارجية، أخطاء التفريغ، اختلاف `data/` عن فهرس الإنتاج، وبقاء متجه قديم بعد تصحيح نص مجمد بـ`regenerate: false`.
