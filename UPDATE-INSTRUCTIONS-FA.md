# راهنمای اعمال به‌روزرسانی Cinema Vault v2.0.1

## نکته مهم درباره فایل‌های پوستر

آرشیو RAR ارسالی شامل پوشهٔ پوسترهای محلی نبود؛ در شاخهٔ فعلی GitHub، پوشهٔ `docs/posters/` شامل ۱٬۷۱۸ فایل WebP است. این فایل‌ها در این بسته بازسازی نشده‌اند. هنگام اعمال آپدیت، فایل‌ها را روی کلون فعلی ریپو کپی و Merge کنید؛ پوشهٔ `docs/posters/` را حذف یا با یک پوشهٔ خالی جایگزین نکنید.

## روش پیشنهادی برای اعمال فایل‌ها

1. از ریپوی فعلی یک Clone یا Backup بگیرید.
2. ZIP با عنوان `imdb-showcase-update-pack.zip` را در ریشهٔ همان Clone استخراج کنید و اجازه دهید فایل‌های هم‌نام جایگزین شوند.
3. پوشهٔ `docs/posters/` و فایل‌های موجودی که در Update Pack نیامده‌اند را حفظ کنید.
4. فایل‌های تغییرکرده را Commit و Push کنید. منبع GitHub Pages باید همچنان GitHub Actions و خروجی پوشهٔ `docs/` باشد.

## استقرار ربات تلگرام با Wrangler

پوشهٔ `worker/` شامل Worker مستقل، تنظیمات نمونه و تست‌ها است. ابتدا از فایل نمونه تنظیمات واقعی بسازید:

```powershell
cd worker
Copy-Item .\wrangler.toml.example .\wrangler.toml
notepad .\wrangler.toml
```

در `wrangler.toml` فقط `database_name` و `database_id` را با مشخصات **همان D1 فعلی ربات** جایگزین کنید. نام binding باید دقیقاً `DB` بماند. دیتابیس جدید نسازید؛ در غیر این صورت مشترک‌ها، علاقه‌مندی‌ها، تاریخچه و صف اعلان‌ها در دیتابیس قبلی باقی می‌مانند و Worker جدید آن‌ها را نمی‌بیند.

Secretها را از PowerShell در پوشهٔ `worker` ثبت کنید:

```powershell
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put WORKER_PING_SECRET
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put ADMIN_IDS
```

مقدار `WORKER_PING_SECRET` باید با Secret هم‌نام در GitHub Repository Settings → Secrets and variables → Actions یکسان باشد. توکن GitHub باید برای `mehrdadmb2/imdb-showcase` دسترسی Contents Read/Write و Actions Read/Write داشته باشد.

سپس تست و Deploy:

```powershell
npm test
npx wrangler deploy
Invoke-RestMethod https://imdb-showcase-telegram-bot.game-developer-mb.workers.dev/health
```

در خروجی Health باید `version: 2.0.1` و وضعیت Bindingها/Secretهای مورد نیاز `true` باشد.

## بررسی گردش CSV

1. در تلگرام به ربات `/import` بفرستید و فایل CSV خروجی IMDb را در چت خصوصی آپلود کنید.
2. گزارش Import باید تعداد رکوردهای معتبر، تعداد قبلی و فعلی، افزوده/حذف/ویرایش‌شده/بدون تغییر و نوع تغییر فیلدها را نشان دهد.
3. در GitHub Actions اجرای `IMDb Showcase — resilient data pipeline` را بررسی کنید.
4. فقط بعد از موفقیت کامل آن Workflow، Workflow با نام `Trigger Cinema Vault Telegram Worker` از رویداد `workflow_run` اجرا می‌شود.
5. اعلان عنوان جدید زمان تشخیص را با منطقهٔ زمانی تهران نشان می‌دهد. زمان تشخیص با مقدار `Date Rated` در CSV متفاوت است.

زمان‌بندی نیم‌ساعتهٔ Worker به‌عنوان مسیر بازیابی حفظ شده است. برای جزییات معماری و فرمول رتبه‌بندی، `README.md`، `README-V20-RANKING-IMPORT.md` و `worker/README.md` را بخوانید.
