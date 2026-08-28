# مزامنة upstream

## العلاقة

- `origin`: `https://github.com/maherbrtn/alkulify-talab-alilm.git`
- `upstream`: `https://github.com/haithamassoli/kashaf-abu-jaafar.git`
- خط العمل: `develop`؛ مرجع هيثم: `upstream/main`.

في 2026-08-28 كان `develop`/`origin/develop` عند `16a8a6d` و`upstream/main` المحلي عند `5dbed6d`. آخر merge يصرح بالمزامنة حتى هذا commit، ولا يوجد في المرجع المحلي commit من upstream خارج develop. تظهر فروع تكامل مؤرخة في التاريخ (`integrate/haitham-*`).

## الإجراء

1. ابدأ من `develop` نظيف ومحدث.
2. نفذ `git fetch upstream` قبل المقارنة.
3. أنشئ فرع تكامل مؤرخًا من `develop`.
4. ادمج `upstream/main` merge صريحًا، بلا rebase لتاريخ منشور.
5. راجع التعارضات ثم شغل `pnpm check` و`pnpm build`.
6. ادمج فرع التكامل إلى `develop` بعد المراجعة.

لم يُنفذ fetch أو merge أو push أثناء إنشاء هذه الوثائق.

## مناطق حساسة

`Player.tsx`، و`data.ts`/`build-data.ts`، و`astro.config.mjs`/`Base.astro`، و`package.json`، وسجل الهوية. لا يؤخذ جانب كامل آليًا: يجب بقاء `lessonKey` والحفظ وCSP المحدد. ولا يعاد توليد UUIDs الموجودة.
