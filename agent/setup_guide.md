# מדריך הגדרה - WhatsApp AI Calendar Agent

## מה זה עושה?
סוכן AI שמאפשר לך לנהל את Google Calendar שלך דרך WhatsApp.
שלח הודעה כמו *"קבע פגישה עם דן מחר ב-15:00 לשעה"* והסוכן ייצור את האירוע.

## צעדים להגדרה

### 1. התקנת דפנדנסיז
```bash
cd agent
pip install -r requirements.txt
```

### 2. Google Calendar API - Service Account

1. היכנס ל-[Google Cloud Console](https://console.cloud.google.com)
2. צור פרויקט חדש (או השתמש בקיים)
3. הפעל את **Google Calendar API**: APIs & Services → Library → חפש "Google Calendar API" → Enable
4. צור Service Account: APIs & Services → Credentials → Create Credentials → Service Account
   - תן שם, לחץ Create
   - תפקיד: לא נדרש, לחץ Continue → Done
5. לחץ על ה-Service Account שנוצר → Keys → Add Key → JSON
   - שמור את הקובץ כ-`service_account.json` בתיקיית `agent/`
6. **שתף את היומן עם ה-Service Account**:
   - פתח [Google Calendar](https://calendar.google.com)
   - לחץ על שלוש הנקודות ליד היומן שלך → Settings and sharing
   - תחת "Share with specific people" → Add people
   - הזן את האימייל של ה-Service Account (נראה כמו `name@project.iam.gserviceaccount.com`)
   - הרשאות: **Make changes to events**

### 3. Twilio WhatsApp Sandbox

1. הירשם ל-[Twilio](https://www.twilio.com) (חינמי לפיתוח)
2. היכנס ל-Console → Messaging → Try it out → Send a WhatsApp message
3. עקוב אחר הוראות ה-Sandbox כדי לחבר את הוואטסאפ שלך (שלח הודעה join לנייד המצוין)
4. שמור את:
   - **Account SID** (מהדף הראשי)
   - **Auth Token** (מהדף הראשי)
   - **Sandbox number**: `whatsapp:+14155238886`

### 4. הגדרת קובץ .env
```bash
cp .env.example .env
```
ערוך את `.env` עם הפרטים שלך:
```
TWILIO_ACCOUNT_SID=ACxxxxxxxx
TWILIO_AUTH_TOKEN=your_token
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
MY_WHATSAPP_NUMBER=whatsapp:+972XXXXXXXXX
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_SERVICE_ACCOUNT_FILE=service_account.json
GOOGLE_CALENDAR_ID=primary
TIMEZONE=Asia/Jerusalem
```

### 5. הפעלת השרת

```bash
python main.py
```
השרת עולה על פורט 8000.

### 6. חשיפת השרת לאינטרנט (לצורך Webhook)

**לפיתוח** - השתמש ב-[ngrok](https://ngrok.com):
```bash
ngrok http 8000
```
תקבל URL כמו: `https://abc123.ngrok.io`

**לייצור** - Deploy ל-Railway / Render / VPS.

### 7. הגדרת Webhook ב-Twilio

1. ב-Twilio Console → Messaging → Settings → WhatsApp Sandbox Settings
2. בשדה **"When a message comes in"** הכנס:
   ```
   https://YOUR_DOMAIN/webhook/whatsapp
   ```
3. שיטה: **HTTP POST**
4. שמור

## שימוש - דוגמאות

| הודעה | פעולה |
|-------|--------|
| `קבע פגישה עם יוסי מחר ב-10 לשעה` | יוצר אירוע מחר בשעה 10:00-11:00 |
| `יש לי ישיבה ב-15/7 משעה 14 עד 16 בנושא תקציב` | יוצר אירוע בתאריך ספציפי עם כותרת |
| `מה יש לי השבוע?` | מציג אירועים לשבוע הנוכחי |
| `מחק את הפגישה עם דן` | מחפש ושואל לאישור לפני מחיקה |
| `העבר את הישיבה של מחר לשעה 16` | מעדכן שעת אירוע קיים |

## ארכיטקטורה

```
WhatsApp → Twilio → Webhook (FastAPI) → Claude Agent → Google Calendar API
                                              ↑
                                        Tool Use Loop
```

## קבצים

| קובץ | תיאור |
|------|-------|
| `main.py` | שרת FastAPI, מקבל webhooks מ-Twilio |
| `agent.py` | סוכן Claude עם tool use ליומן |
| `calendar_service.py` | פונקציות Google Calendar API |
| `requirements.txt` | חבילות Python |
| `.env` | משתני סביבה (לא לcommit!) |
