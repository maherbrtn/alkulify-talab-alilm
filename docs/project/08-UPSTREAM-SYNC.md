# مزامنة upstream

## العلاقة

- `origin`: `https://github.com/maherbrtn/alkulify-talab-alilm.git`
- `upstream`: `https://github.com/haithamassoli/kashaf-alkulify.git`
- خط العمل: `develop`؛ مرجع هيثم: `upstream/main`.

المستودع السابق `https://github.com/haithamassoli/kashaf-abu-jaafar.git` يعيد التوجيه إلى العنوان canonical أعلاه.

في `2026-09-04` اكتملت مزامنة upstream من baseline السابق `5dbed6d` حتى `d3ee5dc`. دمج فرع التكامل `integrate/haitham-2026-09-04` الـcommitين `581ff8842fa26c18606a816121ba4f5f392f97c0` و`d3ee5dcbc25c455f38c92bfb084a3cdb9ef02775` بلا تعارضات، ثم دخل الناتج إلى `develop` بالـcommit `c26d118 merge: sync upstream view transitions`. شمل التكامل 13 ملفًا من upstream فقط.

نجحت بوابات `pnpm install --frozen-lockfile` و`pnpm check` و`pnpm exec tsc --noEmit` و`pnpm build` و`pnpm slice:verify`؛ بنى Astro عدد `8260` صفحة، ونجح GitHub Actions run `33917124878`.

## الإجراء

1. ابدأ من `develop` نظيف ومحدث.
2. نفذ `git fetch upstream` قبل المقارنة.
3. أنشئ فرع تكامل مؤرخًا من `develop`.
4. ادمج `upstream/main` merge صريحًا، بلا rebase لتاريخ منشور.
5. راجع نتيجة الدمج وكل تعارض، ثم شغل بوابات التحقق المناسبة ومنها `pnpm check` و`pnpm build`.
6. ادمج فرع التكامل إلى `develop` بعد نجاح المراجعة والتحقق.

## مناطق حساسة

`Player.tsx`، و`data.ts`/`build-data.ts`، و`astro.config.mjs`/`Base.astro`، و`package.json`، وسجل الهوية. لا يؤخذ جانب كامل آليًا: يجب بقاء `lessonKey` والحفظ وCSP المحدد. ولا يعاد توليد UUIDs الموجودة.
