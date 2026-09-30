# Badya Spaces

Booking for Badya University's sports courts and Activity Center — tennis, padel, football, volleyball, ping-pong, billiards and air hockey. Students book from their phones, show a live QR code at the entrance, and staff check them in. Fair-use rules, waitlists and no-show strikes run automatically. The interface is in Arabic and English.

[العربية](#بالعربية) · [English](#in-english)

---

## بالعربية

### المطلوب من إدارة تكنولوجيا المعلومات

1. **سيرفر** Windows أو Linux عليه **Node.js 22.13 أو أحدث** (يُفضَّل إصدار LTS 22 أو 24 من [nodejs.org](https://nodejs.org)). البرنامج خفيف: 1 جيجا رام و2 جيجا مساحة كافية.
2. **دومين فرعي بشهادة HTTPS** (مثلًا `https://spaces.badya.edu.eg`) أمام السيرفر (IIS أو Nginx أو Caddy). الـ HTTPS ضروري لحماية جلسات الدخول ولتشغيل كاميرا مسح الـ QR على موبايلات الموظفين.

### التشغيل لأول مرة (Windows)

1. انسخ مجلد المشروع على السيرفر.
2. شغّل `start-production.bat`. أول مرة سيُنشئ ملف `.env` ويفتحه — املأ فيه:
   - `PUBLIC_URL` — عنوان الموقع (https).
   - `BOOTSTRAP_ADMIN_EMAIL` — إيميل أول مسؤول (المسؤول العام).
   - `BOOTSTRAP_ADMIN_PASSWORD` — كلمة مروره (8 أحرف على الأقل). لو تركتها فاضية، سيولّد السيرفر كلمة مرور ويطبعها مرة واحدة في نافذته.
3. شغّل `start-production.bat` مرة ثانية. سيثبّت المكتبات، ويبني التطبيق، ويشغّل السيرفر.
4. ادخل من المتصفح بإيميل المسؤول وكلمة المرور، وغيّرها من **قائمة الحساب ← تغيير كلمة المرور**. أضف باقي الموظفين والمسؤولين من **الإعدادات ← الفريق** — كل عضو جديد تظهر له كلمة مرور مؤقتة تسلّمها له.

على Linux: `npm ci` ثم `npm run build` ثم `npm start` (وانظر قسم التشغيل كخدمة بالأسفل).

### كيف يعمل الدخول والأجهزة

- أول مرة: الطالب **ينشئ حسابه** (الاسم، إيميل الجامعة، الرقم الجامعي، الكلية، السنة، كلمة المرور). بعدها يدخل بـ**الرقم الجامعي أو الإيميل + كلمة المرور**.
- بعد أول دخول، **التطبيق يفتح على طول** على موبايله من غير شاشة دخول، ومفيش زرار "تسجيل خروج" للطلاب — فمحدش يقدر يدخل حساب تاني على موبايله.
- **كل طالب له جهاز واحد، وكل جهاز عليه حساب طالب واحد.** لو دخل الطالب من موبايل جديد، أو حاول طالب تاني يدخل من نفس الموبايل، تظهر رسالة إنه **يتواصل مع الإدارة**، وفيها مكان يكتب فيه رسالة وزرار يبعتها. الطلب يظهر في **لوحة الإدارة ← الأجهزة** مع رسالته. عند الموافقة **الحساب يتفعّل على الموبايل الجديد على طول** (ويُسجَّل خروج الموبايل القديم)، وعند الرفض يرى الطالب السبب.
- **نسي كلمة المرور؟** من صفحة الطالب في لوحة الإدارة ← **إعادة تعيين كلمة المرور**، وتظهر كلمة مرور مؤقتة تسلّمها له بعد التأكد من الكارنيه. ولو المسؤول نفسه نسي كلمته: `npm run data:password -- البريد` على السيرفر.
- كلمات المرور محفوظة مشفّرة (scrypt)، وبعد 8 محاولات خاطئة يتوقف الحساب 15 دقيقة.
- المتصفح الآخر أو وضع التصفح الخفي أو مسح بيانات الموقع يُعتبر جهازًا جديدًا — هذا مقصود.
- من صفحة الطالب في لوحة الإدارة يمكن **إعادة ضبط الأجهزة** (مثلًا لو ضاع موبايله)؛ أول جهاز يدخل منه بعدها يصبح جهازه.
- الموظفون والمسؤولون غير مربوطين بجهاز (لأجهزة المسح المشتركة).
- عدد الأجهزة لكل طالب ونطاقات الإيميل المسموحة تتغير من **الإعدادات ← الأمان**.

### قائمة الطلاب الرسمية — مهمة جدًا

**التسجيل مقفول لحد ما ترفع القائمة.** اطلب من شؤون الطلاب ملف Excel فيه **الرقم الجامعي** (ويا ريت كمان الاسم بالعربي والإنجليزي والإيميل والكلية والسنة والمرحلة والحالة و**الرقم القومي**)، واحفظه **CSV**، وارفعه من **لوحة الإدارة ← الطلاب ← قائمة الطلاب الرسمية** (زرار **النموذج** بيوضّح الأعمدة، والعناوين بالعربي شغالة). قبل ما أي حاجة تتحفظ هتشوف معاينة: كل سطر فيه مشكلة برقمه، والأرقام المكررة، واللي هيتغير في الحسابات الموجودة. **لو في أي سطر غلط مفيش حاجة بتتحمّل** — صلّح الأسطر وارفع تاني. بعد الرفع:

- محدش يقدر يسجّل أو يحجز أو يتدعى لحجز إلا لو رقمه الجامعي في القائمة ونشط، ولو الإيميل موجود في القائمة لازم يطابق.
- **الرقم القومي:** لو موجود في القائمة (كامل أو آخر 4 أرقام)، التسجيل بيطلب آخر 4 أرقام — يعني معرفة الرقم الجامعي والإيميل بتاع حد مش كفاية عشان تسجّل باسمه. البرنامج بيحتفظ ببصمة مشفّرة بس (`ROSTER_SECRET`). 5 محاولات غلط بتوقف الرقم ده يوم، ورفع القائمة من جديد بيلغي الإيقاف.
- الاسم والكلية والسنة بتتاخد من القائمة مش من اللي الطالب كتبه، وكل رفع بيحدّث الحسابات الموجودة — إلا الكلية أو السنة اللي المكتب صحّحها بإيده.
- الحسابات اللي مش في القائمة أو غير نشطة فيها أو بإيميل مختلف بتظهر في نفس الكارت، وأول نوعين مبيقدروش يحجزوا.
- ارفع القائمة من جديد كل ترم (الملف الجديد بيحل محل القديم). مسح القائمة بيقفل التسجيل تاني (الحسابات الموجودة بتفضل شغالة).

### حسابات الطلاب

من صفحة الطالب في **لوحة الإدارة ← الطلاب**:

- **إيقاف الحساب** — للاطلاع بس: يشوف حجوزاته ويلغيها لكن ميحجزش ولا يدخل قوائم انتظار ولا يدعي حد ولا يتدعى. الدعوات المفتوحة وأماكن الانتظار بتنتهي، والحجوزات بتفضل إلا لو اخترت إلغاءها. ترفع الإيقاف في أي وقت.
- **إغلاق الحساب** — للخريجين أو لحساب حد تاني سجّله: بيخرج من كل الأجهزة، والحجوزات الجاية بتتلغي، والسجل بيفضل، والإيميل والرقم الجامعي بيتحرروا عشان الطالب الحقيقي يسجّل. ممكن يتفتح تاني لو محدش أخدهم.
- **تصحيح البيانات** — الكلية والسنة (الطالب مبيقدرش يغيّرهم). التصحيح بيفضل بعد رفع القائمة الجديدة، و«استخدام القيمة الرسمية» بيرجّع قيمة القائمة.

### إيقاف المرافق وأنواعها

من **لوحة الإدارة ← المرافق**: افتح المرفق واختار **أرشفة المرفق**. المرفق المؤرشف بيختفي عند الطلاب والموظفين ومبيتحجزش؛ الحجوزات الجاية بتظهر الأول وبتتلغي من غير مخالفة (والطلاب بيتبلغوا) بعد ما تأكد بس. الحجوزات وقوائم الانتظار وسجل التدقيق بتفضل، و**استعادة** بترجّعه زي ما كان. المرفق اللي عمره ما اتحجز ولا عليه بلاغات أو صيانة ممكن **يتحذف** بدل الأرشفة. نوع المرافق بيتأرشف لما ميبقاش فيه مرافق شغالة، وبيتحذف بس لو مفيش ولا مرفق (حتى المؤرشف) بيستخدمه.

### تسجيل الحضور

الموظف بيمسح كود QR المباشر من موبايل الطالب (بيتغير كل 30 ثانية فالسكرين شوت مبيشتغلش). الكاميرا شغالة على Chrome في أندرويد **و**على آيفون (Safari أو Chrome) — الصفحة بتقرا الكود بنفسها لو المتصفح مبيعرفش — ومحتاجة البرنامج يكون على **HTTPS**. لو الكاميرا مش متاحة: **التقط صورة للكود**، أو **اكتب رقم الحجز** المكتوب على التذكرة — وساعتها لازم الطالب يوريك الكارنيه قبل ما تأكد الحضور — أو دوّر عليه في قائمة اليوم.

### الحجز الجماعي والدعوات

- اللي بيحجز بيضيف اللاعبين بالاسم أو الرقم الجامعي، وكل لاعب **بيوصله دعوة ويوافق من موبايله**. الدعوة مبتتحسبش من حدود اللاعب غير لما يوافق، ووقتها بتتراجع حدوده هو (اليومي، والأسبوعي، والمتتالي، وفترة الراحة).
- في الملاعب اللي ليها حد أدنى (تنس وبادل: 2، كورة: 6)، الحجز بيفضل **"في انتظار اللاعبين"** لحد ما العدد يكمل، ولو ماكملش في **مهلة القبول** (افتراضيًا 60 دقيقة، وتتعدل من قواعد الحجز) الحجز بيتلغي من غير مخالفة والميعاد بيرجع متاح.
- لو لاعب خرج والعدد نزل عن الحد الأدنى، الحجز بيرجع "في انتظار اللاعبين" بمهلة جديدة. يعني مينفعش حد يحجز الملعب كله لوحده.

### الإشعارات على الموبايل

- من **الملف الشخصي ← الإشعارات على هذا الموبايل ← فعّل الإشعارات**. بعدها التذكيرات والدعوات وعروض قائمة الانتظار بتوصل للموبايل زي رسايل أي تطبيق، حتى لو التطبيق مقفول. لازم الموقع يكون على HTTPS.
- **أندرويد:** بتشتغل من Chrome على طول.
- **آيفون (iOS 16.4 أو أحدث):** لازم الطالب يضيف التطبيق للشاشة الرئيسية الأول (زرار المشاركة ← إضافة إلى الشاشة الرئيسية) ويفعّل الإشعارات من هناك. التطبيق على الشاشة الرئيسية بيعتبره الآيفون متصفح منفصل، فالأحسن الطالب **يعمل حسابه من التطبيق اللي على الشاشة الرئيسية**. ولو كان عامل حسابه من Safari، هيظهر كجهاز جديد ويحتاج موافقة من **الأجهزة** مرة واحدة.

### الملاعب والمواعيد

الملاعب والترابيزات الحقيقية مُعدّة مسبقًا (ملعب تنس، ملعبا بادل، ملعب كرة قدم، ملعب كرة طائرة، ترابيزتا بينج بونج، ترابيزة بلياردو، ترابيزة إير هوكي). **كلها مفتوحة من 9 الصبح لـ 3 العصر، وكل ميعاد نص ساعة** (آخر ميعاد بيبدأ 2:30)، والأكتيفيتي سنتر مقفول الجمعة. المميزات المعروضة: مقاعد (تنس وكورة)، وتكييف وأدوات ومقاعد (الأكتيفيتي سنتر). **حجز كل يوم جديد بيفتح الساعة 9 الصبح** لكل الناس في نفس اللحظة، بدل 12 بالليل. كل شيء يتعدّل من لوحة الإدارة من غير برمجة: مواعيد العمل، مدة الحجز، عدد اللاعبين، القواعد، المكان على الخريطة، والمحتوى العربي (قسم **المحتوى العربي** في صفحة المرفق). قواعد الحجز (الحدود اليومية والأسبوعية، المواعيد المتتالية، الإلغاء، الغياب، ساعة فتح الحجز، مهلة القبول) من **قواعد الحجز**.

### الأمان — مهم قبل التشغيل

- **شغّل البرنامج خلف HTTPS فقط**، ولو الـ reverse proxy على نفس السيرفر اكتب `HOST=127.0.0.1` في `.env` حتى لا يصل أحد للبرنامج مباشرة من غير HTTPS.
- **مجلد `data`** فيه قاعدة البيانات (كلمات المرور مشفّرة) وملف `secrets.json`. اسمح بالوصول له لحساب الخدمة فقط، وانسخه يوميًا لجهاز أو مكان تاني.
- **البيانات التجريبية** (`data:demo`) فيها حسابات تدخل بضغطة من غير كلمة مرور — لا تحمّلها على سيرفر الجامعة. ولو اتحمّلت بالغلط، الدخول بضغطة مقفول تلقائيًا على السيرفر.
- **الموافقة على نقل الجهاز**: اتأكد من كارنيه الطالب بنفسك قبل الموافقة — اللي يعرف كلمة مرور طالب يقدر يطلب نقل حسابه. الطالب نفسه بيوصله إشعار بأي طلب لنقل حسابه.
- **الموظفين** يقدروا يشتغلوا بس على المرافق المسؤولين عنها. **الأدمن** لا يقدر يعدّل أو يوقف المسؤول العام.
- كلمة المرور المؤقتة (من الأدمن أو أول تشغيل) لازم تتغيّر أول ما صاحبها يدخل.
- بعد 8 كلمات مرور غلط من نفس الشبكة يتوقف الدخول من الشبكة دي 15 دقيقة (وبعد 40 من شبكات مختلفة يتوقف الحساب كله)، وده بيتسجّل في سجل التدقيق.

### النسخ الاحتياطي والاسترجاع

- السيرفر يحفظ **نسخة احتياطية يوميًا** تلقائيًا في `data/backups` ويحتفظ بآخر 14 يومًا (`BACKUP_KEEP_DAYS`).
- نسخة فورية: `npm run data:backup`.
- **الاسترجاع:** أوقف السيرفر ← انسخ ملف النسخة المطلوبة مكان `data/badya-spaces.db` ← شغّل السيرفر.
- انسخ مجلد `data` كاملًا (قاعدة البيانات + `secrets.json`) لمكان آخر بشكل دوري. لا ترفعه على Git.

### التحديث

انسخ الكود الجديد مكان القديم (من غير مجلد `data` و`.env`)، ثم شغّل `start-production.bat --build`.

### تجربة البرنامج على جهازك

شغّل `run-all.bat`. سيفتح التطبيق في المتصفح. المسؤول للتجربة: `admin@badya.edu.eg` وكلمة المرور `badya-admin-2026` (تظهر في نافذة الأوامر). لتجربة ببيانات تجريبية (طلاب وحجوزات): `run-all.bat --demo` — لا يعمل أبدًا فوق بيانات حقيقية.

---

## In English

### What IT needs to provide

1. **A server** (Windows or Linux) with **Node.js 22.13 or newer** — the 22 or 24 LTS from [nodejs.org](https://nodejs.org). It's light: 1 GB RAM and 2 GB disk are plenty.
2. **A subdomain with HTTPS** (e.g. `https://spaces.badya.edu.eg`) in front of the server — IIS, Nginx or Caddy as a reverse proxy. HTTPS protects sign-in sessions and is required for the QR-scanner camera on staff phones.

### First start (Windows)

1. Copy the project folder to the server.
2. Run `start-production.bat`. The first time it creates `.env` and opens it — fill in `PUBLIC_URL`, `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` (8+ characters; leave it empty and a password is generated and printed once in the server window).
3. Run `start-production.bat` again. It installs dependencies, builds the app and starts the server.
4. Sign in with the admin email and password, and change it from the account menu. Add staff and other administrators under **Settings → Team** — each new member gets a temporary password to hand over.

On Linux: `npm ci`, `npm run build`, `npm start`.

### Settings (`.env`)

| Setting | Meaning |
|---|---|
| `PUBLIC_URL` | The address students open. Must be `https://` in production. |
| `PORT` / `HOST` | Where the server listens (default `3000` on all interfaces). Use `HOST=127.0.0.1` when the reverse proxy runs on the same machine. |
| `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_PASSWORD` | The first super admin, created on start if missing. Without a password, one is generated and printed once. |
| `ALLOWED_EMAIL_DOMAINS` | Who can register (default `badya.edu.eg`). Also editable in Settings → Security. |
| `DATA_DIR` | Database, backups and generated secrets (default `./data`). |
| `BACKUP_KEEP_DAYS` | Daily backups to keep (default 14). |
| `TIMEZONE` | Campus time zone (default `Africa/Cairo`). |
| `TRUST_PROXY` | Read the client IP from `X-Forwarded-For` (default on in production). |

Session, QR-signing and student-list (`ROSTER_SECRET`) secrets are generated into `DATA_DIR/secrets.json` on first start — back that file up with the database. If `ROSTER_SECRET` ever changes, load the student list again.

### Reverse proxy example (Caddy)

```
spaces.badya.edu.eg {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy obtains the HTTPS certificate itself. With IIS, use URL Rewrite + Application Request Routing to forward to `http://127.0.0.1:3000`, and don't buffer responses for `/api/events` (live updates).

### Running as a service

- **Windows:** use [NSSM](https://nssm.cc) — `nssm install BadyaSpaces "C:\Program Files\nodejs\npm.cmd" start`, with the project folder as the startup directory. Or a Task Scheduler task that runs `start-production.bat` at startup.
- **Linux (systemd):**

  ```ini
  [Unit]
  Description=Badya Spaces
  After=network.target

  [Service]
  WorkingDirectory=/opt/badya-spaces
  ExecStart=/usr/bin/npm start
  Restart=always
  User=badya

  [Install]
  WantedBy=multi-user.target
  ```

### Sign-in and devices

- Students **create an account** the first time (name, university email, university ID, faculty, year, password), then sign in with their **university ID or email and password**.
- After that the app **opens straight away** on their phone — there's no sign-out for students, so nobody can switch to another account on it.
- **One device per student, one student per device.** Signing in on a new phone, or a second student signing in on the same phone, shows a **contact the facilities office** screen with a message box and a send button. The request appears under **Admin → Devices** with the message. Approving signs the student in on the new phone right away and signs the old one out.
- **Forgotten password:** in the student's page in the admin console, **Reset password** shows a temporary password to hand over after checking their student card. Administrators can recover their own account on the server with `npm run data:password -- someone@badya.edu.eg`.
- Passwords are stored as scrypt hashes; 8 wrong passwords in a row pause the account for 15 minutes.
- Another browser, private browsing or clearing site data counts as a new device — on purpose.
- **Reset devices** from a student's page in the admin console (e.g. a lost phone); the next device they sign in on becomes theirs.
- Staff and administrators aren't tied to a device, so shared scanner phones work.

### Official student list — upload it before launch

**Registration is closed until a list is loaded.** Ask Student Affairs for a spreadsheet with the **university ID** — ideally also the name (English and Arabic), email, faculty, year, level, status (active, graduated…) and the **national ID** — save it as **CSV** (CSV UTF-8, or plain CSV from Arabic Excel), and upload it under **Admin → Students → Official student list** (the **Template** button shows the columns; Arabic headers work too). Before anything is saved you see a preview: every unusable line with its line number, repeated IDs, and what changes for existing accounts. **A file with any problem loads nothing** — fix those lines and upload it again. Once it's loaded:

- Only listed, active university IDs can register, book or be invited; where the list has an email, it must match.
- **National ID:** where the list has it (the full number or its last 4 digits), registration asks for the last 4 digits — knowing someone's university ID and email is no longer enough to register as them. Only a keyed fingerprint of the digits is stored (see `ROSTER_SECRET`). Five wrong tries pause that ID for a day; loading the list again lifts the pause.
- Name, faculty and year come from the list, not from what the student typed, and every upload updates existing accounts too — except a faculty or year the office corrected by hand.
- Accounts that aren't on the list, are inactive on it, or use a different email are shown on the same card; the first two can't book or be invited.
- Upload a fresh list each term — it replaces the previous one. Removing the list closes registration again (existing accounts keep working).

### Student accounts

From a student's page (**Admin → Students**):

- **Suspend** — read-only: they can see and cancel their bookings but can't book, join waitlists, invite or be invited. Open invitations and waitlist places end; their bookings stay unless you tick *Also cancel*. Lift it any time.
- **Close account** — for graduates, or an account someone else registered: signed out everywhere, upcoming bookings cancelled, history kept, and the email and university ID freed so the real student can register. It can be reopened if nobody else has taken them since.
- **Correct details** — faculty and year (students can't change these). Corrections are marked as the office's and survive the next list upload; *Use official value* goes back to the list.

### Retiring facilities and facility types

In **Admin → Facilities**, open a facility and choose **Archive facility**. Archived facilities disappear for students and staff and can't be booked; upcoming bookings are listed first and cancelled without a strike (the students are told) only once you confirm. Bookings, waitlists and the audit trail are kept, and **Restore** brings the facility back as it was. A facility that has never had a booking, waitlist, issue or maintenance entry can be **deleted** instead. A facility type can be archived once none of its facilities are live, and deleted only if no facility — archived ones included — uses it.

### Checking in

Staff scan the student's live QR code (it changes every 30 seconds, so screenshots don't work). The camera works in Chrome on Android **and** on iPhone (Safari or Chrome) — the page decodes the code itself where the browser can't — and needs the app on **HTTPS**. Without a camera: **Take a photo of the code**, or **Enter the booking reference** printed on the ticket — the student then shows their student card before you confirm — or find them in today's list.

### Group bookings and invitations

- The booker adds players by name or university ID; each player **gets an invitation and accepts from their own phone**. Nothing counts towards a player's limits until they accept, and accepting checks their own daily, weekly, back-to-back and rest rules.
- Where a facility has a minimum (tennis and padel 2, football 6), the booking **waits for players** until enough accept. If they don't within the **time to accept** (60 minutes by default, set under Booking rules), it's cancelled without a strike and the session reopens.
- If a player leaves and the booking drops below the minimum, it goes back to waiting for players with a new deadline — nobody can hold a pitch alone.

### Notifications on the phone

- **Profile → Notifications on this phone → Turn on notifications.** Reminders, invitations and waitlist offers then arrive like messages from any other app, even when the app is closed. Requires HTTPS.
- **Android:** works straight from Chrome.
- **iPhone (iOS 16.4+):** the student adds the app to the Home Screen first (Share → Add to Home Screen) and turns notifications on from there. iOS treats the Home Screen app as a separate browser, so students should **create their account in the Home Screen app**; one who registered in Safari first will show up once under **Devices** for approval.
- Push keys are generated into `DATA_DIR/secrets.json` on first start, next to the other secrets.

### Opening hours

All courts and tables are open **09:00–15:00** in **30-minute sessions** (the last starts at 14:30); the Activity Center is closed on Fridays. Databases from earlier versions are moved to the current hours, session length and amenities when the server starts, unless an administrator had changed them. **Each new day opens for booking at 09:00** — the same moment for everyone, instead of midnight. Hours, the opening hour and the time to accept are editable in the admin console.

### Security checklist

- **Serve it only over HTTPS.** When the reverse proxy runs on the same machine, set `HOST=127.0.0.1` so nobody can reach the app directly. The client IP is taken from `X-Forwarded-For` only when the request comes from a local or private-network proxy.
- **`DATA_DIR`** holds the database (passwords are scrypt hashes) and `secrets.json`. Give only the service account access to it, and copy it off the machine daily.
- **Demo data** (`data:demo`) has one-tap accounts with no password. Don't load it on the university server; if it happens by mistake, one-tap sign-in stays off in production unless `ALLOW_DEMO_SIGN_IN=true`.
- **Approving a device move:** check the student card in person first — anyone who knows a student's password can ask to move their account. The student is notified about every such request.
- **Staff** can only work on their assigned facilities. **Administrators** can't edit, demote or suspend a super admin, and at least one active super admin always remains.
- Temporary passwords (set by an administrator, or generated at first start) must be changed at the next sign-in.
- 8 wrong passwords from one network pause sign-in from that network for 15 minutes (40 from anywhere pause the account); both are written to the audit log.
- Students can't look up other students' schedules; searching for teammates needs a full university ID or three letters of a name, and IDs come back masked. Invited players accept or decline from their own phone, and the booker never learns why someone can't join.
- The server only sends push messages to the real push services (Google, Apple, Mozilla, Microsoft), so a browser can't point it at addresses inside the university network.

### Backups and restore

- A backup is written **every day** to `DATA_DIR/backups`; the last 14 are kept.
- Take one now: `npm run data:backup`.
- **Restore:** stop the server, copy the backup over `DATA_DIR/badya-spaces.db`, start the server.
- Copy the whole `data` folder (database and `secrets.json`) somewhere safe regularly. Never commit it.

### Updating

Replace the code (keep `data/` and `.env`), then run `start-production.bat --build` (or `npm ci && npm run build && npm start`).

### Data commands (stop the server first)

| Command | What it does |
|---|---|
| `npm run data:backup` | Write a backup now. |
| `npm run data:demo` | Load sample students and bookings for a demonstration. Refuses to run over real data. |
| `npm run data:reset -- --yes` | Wipe everything and start again with the real catalogue (a backup is taken first). |
| `npm run data:password -- <email or university ID>` | Give an account a new temporary password (e.g. a locked-out administrator). |

### Trying it on your own computer

Run `run-all.bat`. It opens the app in your browser. The local administrator is `admin@badya.edu.eg` with the password `badya-admin-2026` (also shown in the command window). `run-all.bat --demo` adds sample data first.

### Development

```
npm run dev          # API server (restarts on change) + web app on http://localhost:5173
npm test             # server and booking-rule tests
npm run typecheck
npm run i18n:check   # lists interface text that still needs Arabic
```

- Interface text goes through `t("English text")`; the Arabic lives in `src/i18n/ar.ts`. Messages built on the server use `L(english, arabic)` and are written in the reader's language (notifications in the recipient's).
- Facility content has optional Arabic fields, edited under **Arabic content** in the facility editor.
- The audit log is kept in English.
