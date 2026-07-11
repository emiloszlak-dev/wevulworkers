# Thai Workers Manager — Netlify Database

מערכת לניהול פרויקטים ופועלים, בתאית ובאנגלית.

## יכולות

- כניסה מאובטחת עם שם משתמש וסיסמה.
- החלפת סיסמה מתוך מסך אדמין.
- שמירת פרויקטים ופועלים במסד נתונים בענן.
- שעות התחלה וסיום לכל פועל.
- חישוב שעות עבודה.
- שכר וסיכומים בשקלים ישראליים (ILS / ₪).
- סטטוס שולם / לא שולם.
- היסטוריית פרויקטים.
- שליחת סיכום אישי לכל פועל.
- ייצוא CSV.

## התקנה ב-Netlify

יש להעלות את כל תיקיית הפרויקט ל-GitHub או להפעיל דרך Netlify CLI.

### 1. התקנת החבילות

```bash
npm install
```

### 2. התחברות ל-Netlify

```bash
npx netlify login
```

### 3. קישור לאתר Netlify

```bash
npx netlify link
```

### 4. יצירת Netlify Database

באתר Netlify:
- היכנס לפרויקט.
- פתח את אזור Database.
- צור מסד נתונים חדש.
- אשר את חיבור משתני הסביבה לפרויקט.

### 5. משתני סביבה לכניסה הראשונית

```bash
npx netlify env:set ADMIN_USERNAME wit
```

```bash
npx netlify env:set ADMIN_INITIAL_PASSWORD "CHANGE-ME-123456"
```

יש להחליף את הסיסמה בדוגמה בסיסמה אמיתית.

### 6. הרצת migrations

```bash
npx netlify db migrate
```

### 7. בדיקה מקומית

```bash
npm run dev
```

### 8. פריסה

```bash
npx netlify deploy --prod
```

## אבטחה

הסיסמה נשמרת במסד הנתונים לאחר גיבוב Scrypt.
ההתחברות משתמשת בעוגיית HttpOnly מאובטחת.
לאחר הכניסה הראשונה מומלץ להחליף את הסיסמה במסך האדמין.
