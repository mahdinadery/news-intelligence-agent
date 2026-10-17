# استقرار رایگان و بدون سرور (از طریق GitHub)

این برنامه Next.js + PostgreSQL است و **روی GitHub Pages اجرا نمی‌شود** (Pages فقط
سایت استاتیک سرو می‌کند؛ این اپ API زنده و دیتابیس دارد). مسیر رایگانِ پیشنهادی:

| قطعه | سرویس | سهمیهٔ رایگان |
|---|---|---|
| اپ (Build + `next start` + API routes) | **Render** — Blueprint این repo (`render.yaml`) | سرویس رایگان: ۵۱۲MB RAM، ۷۵۰ ساعت اجرا/ماه، پس از ۱۵ دقیقه بی‌کاری sleep و cold-start ~۳۰–۶۰ ثانیه |
| دیتابیس PostgreSQL | **Neon** (یا Supabase) | ۰.۵GB، autosuspend؛ connection stringِ pooled خودش `?sslmode=require` دارد که درایور `pg` همین را می‌فهمد |
| زمان‌بندی دریافت اخبار + ارسال خودکار | **GitHub Actions** (`scheduled-ingest.yml`) | روی repo عمومی رایگان و نامحدود |
| تست/بیلد خودکار هر push | **GitHub Actions** (`ci.yml`) | همان |

## ۱) دیتابیس (Neon)

1. در neon.com یک پروژهٔ رایگان بسازید (Sign in with GitHub).
2. از تب **Connection Details** رشتهٔ **pooled** را کپی کنید
   (شکل: `postgresql://user:pass@ep-xxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`).
3. همین URL را در مرحلهٔ بعد به‌عنوان `DATABASE_URL` می‌چسبانید. **هیچ‌جا commit نشود.**

## ۲) اپ (Render)

1. در render.com با GitHub وارد شوید → **New → Blueprint** → این repo را انتخاب کنید.
2. Render فایل `render.yaml` را می‌خواند و سرویس رایگان را می‌سازد (build:
   `npm install && npm run build`، start: `npm start`، health check: `/api/health`).
3. در تب **Environment** مقدار متغیرهای خالی را یک‌بار وارد کنید
   (در blueprint با `sync: false` تعریف شده‌اند تا Render مقدار دستی شما را بازنویسی نکند):
   - `DATABASE_URL` — رشتهٔ Neon
   - `ADMIN_ACCESS_KEY` — **حیاتی**: چون repo پابلیک است، اگر این تنظیم نشود کل
     `/admin` روی اینترنت باز است (طراحی موجود پروژه). یک کلید تصادفی بلند بگذارید؛
     از آن پس هنگام باز کردن صفحات مدیریت یک پاپ‌آپ ورود کلید نمایش داده می‌شود و
     دسترسی آن مرورگر تا ۱۲ ساعت (کوکی HttpOnly) باز می‌ماند. لینک `?key=...` و
     هدر `x-admin-key` (برای اسکریپت‌ها / GitHub Actions) هم پشتیبانی می‌شوند.
   - `AI_API_KEY` / `AI_API_BASE_URL` / `AI_API_MODEL` — برای تحلیل هوش مصنوعی
   - `BALE_BOT_TOKEN` / `BALE_CHAT_ID` / `BALE_DELIVERY_MODE` — برای ارسال به بله
   - اختیاری: `NEWS_FETCH_PROXY_URL` (برخی فیدهای ایرانی از IP خارج ایران را
     بی‌پاسخ می‌گذارند؛ اپ روی سرور اروپا/آمریکا است)، `AUTO_SEND_*`
4. **Deploy**. از این پس هر push به `main` خودکار build و مستقر می‌شود.

**دیگر نیازی به اجرای دستی `npm run db:ensure` نیست:** هوک‌های `prestart` و
`postinstall` در `package.json` همان اسکریپت idempotent و افزودنی‌محل را در هر
build و هر بوت سرور اجرا می‌کنند؛ یعنی مشکل «کد جدید روی دیتابیس قدیمی» که
باعث ۵۰۰ شدن دکمه‌ها شده بود، در این پلتفرم‌ها خودکار رخ نمی‌دهد. (اگر
DATABASE_URL لحظهٔ بوت در دسترس نباشد، هوک بی‌آزار رد می‌شود و برنامه کرش نمی‌کند.)

## ۳) ارسال خودکار زمان‌بندی‌شده (تحلیل + بله)

از داشبورد، کارت **«ارسال خودکار زمان‌بندی‌شده (تحلیل + بله)»** را باز کنید
(`https://<your-app>/dashboard`). در آن‌جا:

1. یک یا چند **زمان** (مثلاً `08:00` و `20:00`) و **منطقه زمانی** (پیش‌فرض
   `Asia/Tehran`) تعیین کنید.
2. **مقصد** را روی «بله» بگذارید (برای ارسال واقعی، `BALE_BOT_TOKEN` و
   `BALE_CHAT_ID` باید در Environment Variables سرور تنظیم شده باشند).
3. تیک «فعال باشد» را بزنید و **ذخیره زمان‌بندی** کنید.

در هر نوبت، یک چرخه کامل اجرا می‌شود: دریافت فیدها → تحلیل اخبار در صف →
ارسال خودکار خبرهای واجد شرایط (حد نصاب اهمیت/مرتبط بودن) **بدون تأیید دستی**.
هر نوبت فقط یک‌بار اجرا می‌شود (کلید `last_run_slot`) و اگر کرون با تأخیر برسد،
تا ۶۰ دقیقه بعد از زمان نوبت هم قابل جبران است. «اجرای فوری چرخه کامل» برای
تست یا جبران دستی است.

**فعال‌سازی کرون:** فایل `.github/workflows/scheduled-agent.yml` هر ۵ دقیقه
`POST /api/agent/scheduler/tick` را صدا می‌زند و فقط وقتی نوبتی رسیده باشد کاری
انجام می‌دهد. دو secret مخزنی لازم است (همان‌های بخش بعد): `APP_URL` و
`ADMIN_ACCESS_KEY`. بدون آن‌ها tick با پیام «skipping» سبز تمام می‌شود.
نکته: GitHub فقط کرونِ برنچ پیش‌فرض (`main`) را اجرا می‌کند.

> اگر در «پیکربندی AI» سیاست ارسال خودکار (Auto-send policy) را روی «بله» و
> فعال بگذارید، پاس ۱۵‌دقیقه‌ای قدیمی هم می‌تواند بیرون از نوبت‌ها ارسال کند.
> برای ارسال صرفاً زمان‌بندی‌شده، آن سیاست را روی `local` بگذارید یا خاموش کنید؛
> ارسال زمان‌بندی‌شده مستقل از آن کار می‌کند.

## ۴) زمان‌بندی دریافت (GitHub Actions)

اپ عمداً هیچ scheduler درون-فرآیندی ندارد؛ زمان‌بندی با endpointهای `tick` و یک
کرون بیرونی (GitHub Actions) انجام می‌شود. برای اینکه بدون سرورِ روشن هم هر ۱۵ دقیقه اجرا شود:

- در GitHub: **Settings → Secrets and variables → Actions → Repository secrets**:
  - `APP_URL` = آدرس سرویس Render (بدون `/` انتهایی)
  - `ADMIN_ACCESS_KEY` = همان کلید مرحلهٔ ۲
- فایل `scheduled-ingest.yml` هر ۱۵ دقیقه فقط
  `POST /api/admin/news-sources/run-due` را صدا می‌زند (دریافت فیدهای رسیده؛ بدون
  تحلیل و بدون ارسال). ارسال خودکار فقط در نوبت‌های تعیین‌شده در کارت زمان‌بندی
  انجام می‌شود. خودِ این فراخوانی‌ها سرویس را بیدار نگه می‌دارند، پس عملاً sleep
  نمی‌شود و ۷۵۰ ساعت ماهانه هم کفایت می‌کند (یک سرویس رایگان ۲۴/۷ = ~۷۲۰ ساعت؛
  اگر سرویس رایگان دوم اضافه کردید، سهمیه تقسیم می‌شود).
- توجه: GitHub فقط workflowهای زمان‌بندی‌شده را از **برنچ پیش‌فرض (main)** اجرا
  می‌کند؛ تا وقتی این فایل ادغام نشده، با دکمهٔ **Run workflow** دستی تست کنید.
- اگر secret تنظیم نشده باشد، workflow با پیام «skipping» سبز تمام می‌شود و کاری نمی‌کند.
- **Schema sync دستی/فوری:** workflow سه‌مـن `Schema sync (db:ensure)` با دکمهٔ
  Run workflow، همان اسکریپت افزودنی را مستقیم روی Neon اجرا و جدول‌ها را تأیید
  می‌کند (runner های GitHub به ۵432 دسترسی دارند؛ محیط‌های سندباکس معمولاً نه).
  نیازمند secret مخزنی `DATABASE_URL`.
- نکتهٔ امنیتی: لایه‌هایی مثل **Data API** و **Neon Auth** را در پروژهٔ Neon
  روشن نگه ندارید — این اپ از هیچ‌کدام استفاده نمی‌کند (drizzle/pg + ADMIN_ACCESS_KEY)
  و هر کدام فقط سطح حملهٔ بی‌دلیل اضافه می‌کند.

## ۵) گزینه‌های رایگان دیگر

- **Koyeb free** — ۱ سرویس رایگان ۵۱۲MB با scale-to-zero؛ در UI بسازید:
  build `npm install && npm run build`، run `npm start`، همان envها. (فایل
  `render.yaml` مخصوص Render است؛ بقیهٔ پلتفرم‌ها env را دستی می‌خواهند.)
- **Supabase free** جای Neon — از Project Settings → Database → Connection string
  (URI) رشتهٔ **session pooler** را با `?sslmode=require` بگیرید.
- **Vercel** — همان اپ را می‌سازد ولی اعتبار شما تمام شده؛ ضمناً build این اپ به
  هر حال `DATABASE_URL` تنظیم‌شده می‌خواهد (throw در import؛ مستقل از این PR).
- **Railway/Fly** — دیگر لایهٔ «همیشه رایگان» ندارند (اعتبار محدود یک‌باره).
- ارسال به بله در این معماری outbound است (Bot API)؛ هیچ callback/webhook عمومی لازم نیست.

## عیب‌یابی سریع

| نشانه | علت / کار |
|---|---|
| build در Render خطای DATABASE_URL داد | مقدار sync:false را در تب Environment ست نکرده‌اید (build هم به وجودش نیاز دارد) |
| صفحات admin باز می‌شوند ولی اکشن‌ها ۵۰۰ + hint «db:ensure» | هوک بوت اجرا نشده. از نسخهٔ فعلی، اولین درخواست ادمین اسکیما را **خودکار** (idempotent و فقط-افزودنی) همگام می‌کند؛ اگر باز هم خطا دیدید دکمهٔ «همگام‌سازی خودکار اسکیما» در همان صفحه یا `POST /api/admin/db-ensure` را بزنید، یا از Render → Shell / `Run job` / local با `DATABASE_URL`: `npm run db:ensure` |
| روی Vercel خطای `relation "ai_configurations" does not exist` | Vercel فقط `next build` را اجرا می‌کند و `prestart`/`postinstall` عملاً اسکیما را نمی‌سازند؛ نسخهٔ فعلی در اولین درخواست ادمین خودکار repair می‌کند. برای repair دستی: `POST /api/admin/db-ensure` (با `x-admin-key`) یا از GitHub Actions → «Schema sync (db:ensure)» |
| پیام «کلید API تنظیم نشده (AI_API_KEY)» در پیکربندی AI | متغیر `AI_API_KEY` (و اختیاری `AI_API_BASE_URL`/`AI_API_MODEL`) را در Environment Variables میزبان ست و سرویس را دوباره deploy کنید |
| ارسال زمان‌بندی‌شده اجرا نمی‌شود | کارت داشبورد باید «ذخیره» شده و فعال باشد؛ secretهای `APP_URL` و `ADMIN_ACCESS_KEY` در GitHub Actions لازم‌اند؛ در تب Actions، اجرای «Scheduled auto-publish» را دستی Run کنید و خروجی tick را ببینید |
| `POST /api/agent/scheduler` خطای ۴۰۱ می‌دهد | زمان‌بندی به کلید مدیریتی نیاز دارد؛ یک‌بار با `?key=...` وارد داشبورد شوید (کوکی ۱۲ ساعته) یا از صفحه «پیکربندی AI» کلید را وارد کنید |
| در کارت زمان‌بندی «بله: تنظیم نشده» است | `BALE_BOT_TOKEN` و `BALE_CHAT_ID` را ست کنید (و کارت تست بله را اجرا کنید) |
| درخواست اول بعد از سکون ~۱ دقیقه طول می‌کشد | cold-start سرویس رایگان؛ cron بخش ۳ این را حذف می‌کند |
| ۴۰۱ در admin | در مرورگر از پاپ‌آپ ورود کلید استفاده کنید؛ برای اسکریپت‌ها هدر `x-admin-key` یا پارامتر `?key=` هم پشتیبانی می‌شود |
| فیدهای ایرانی timeout | `NEWS_FETCH_PROXY_URL` را روی پروکسی با IP مناسب ست کنید |
