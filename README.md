# Private Cinema - Shared Control

نسخة فيها:

- رابط غرفة خاص
- كلمة مرور
- أول شخص يدخل يصبح المنظّم
- المنظّم يستطيع إعطاء كنترول لأي مشاهد أو سحبه
- YouTube Video
- MP4 مباشر
- Website iframe للمواقع التي تسمح بذلك
- شات
- مزامنة Play / Pause / Seek للفيديوهات

## مهم جدًا

مشاهدة موقع كامل معًا داخل iframe تعتمد على سماح الموقع نفسه.
مواقع كثيرة تمنع ذلك بإعدادات مثل X-Frame-Options أو CSP.

لتحكم حقيقي في موقع كامل مثل "متصفح مشترك" تحتاج نظام آخر مثل:
- بث شاشة WebRTC
- Browser Streaming
- Remote Browser
- أو مشاركة شاشة من جهازك

## تشغيل محلي

```bash
npm install
npm start
```

ثم افتح:

```text
http://localhost:3000
```

## النشر على Render

- Build Command:

```bash
npm install
```

- Start Command:

```bash
npm start
```