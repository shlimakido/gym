// מבנה המחלקות, תתי-הסוכנים, הסולמות והמשקלות, כפי שהוגדרו בבריף הביקורת.

export const DEPARTMENTS = [
  {
    id: 'TECH', name: 'טכני', weight: 20,
    agents: [
      { id: 'TECH-A', name: 'זרימות קריטיות', checklist: 'האם כל זרימה מההגדרה אפשר להשלים מתחילה ועד סוף? שלבים חסרים, מבוי סתום, כפתורים שלא עושים כלום.' },
      { id: 'TECH-B', name: 'טפסים וקלט', checklist: 'ולידציה, הודעות שגיאה ברורות, שדות חובה מסומנים, מקלדת מתאימה במובייל, שמירת נתונים אחרי שגיאה.' },
      { id: 'TECH-C', name: 'שגיאות וקישורים', checklist: 'קישורים שבורים או כפולים, קישורים לא עקביים לאותו יעד, עמודי 404, שאריות פיתוח (טקסט בדיקה, הערות בקוד).' },
      { id: 'TECH-D', name: 'תאימות', checklist: 'מובייל מול דסקטופ, קישורים שמתנהגים שונה בטלפון, רכיבים שנשברים ברוחב קטן.' },
    ],
  },
  {
    id: 'UX', name: 'חוויית משתמש', weight: 20,
    agents: [
      { id: 'UX-A', name: 'ניווט ומבנה מידע', checklist: 'האם משתמש חדש מוצא את 3 הדברים החשובים תוך 10 שניות? תפריטים עמוסים, שמות לא ברורים, כפילויות.' },
      { id: 'UX-B', name: 'היררכיה ועקביות ויזואלית', checklist: 'מה בולט ראשון, עקביות בכפתורים, צבעים וטיפוגרפיה, עומס.' },
      { id: 'UX-C', name: 'נגישות', checklist: 'מול תקן ישראלי 5568 / WCAG 2.1 AA: טקסט חלופי לתמונות, ניגודיות, כותרות, ניווט מקלדת, הצהרת נגישות.' },
      { id: 'UX-D', name: 'עברית, RTL ומיקרו-קופי', checklist: 'כיווניות, ערבוב עברית-אנגלית, מספרים ותאריכים, שגיאות כתיב, טון, תרגומים לשפות נוספות.' },
    ],
  },
  {
    id: 'PERF', name: 'ביצועים', weight: 10,
    agents: [
      { id: 'PERF-A', name: 'מהירות טעינה', checklist: 'Core Web Vitals (LCP, INP, CLS) אם יש נתונים; אחרת "לא נבדק" והמלצה להריץ Lighthouse.' },
      { id: 'PERF-B', name: 'משקל נכסים', checklist: 'תמונות כבדות, סקריפטים מיותרים, תוכן קריטי שנטען רק ב-JavaScript.' },
      { id: 'PERF-C', name: 'יציבות במובייל', checklist: 'קפיצות תוכן, תמונות ללא מידות, חוויה ברשת איטית.' },
    ],
  },
  {
    id: 'SEC', name: 'אבטחה ופרטיות', weight: 15,
    agents: [
      { id: 'SEC-A', name: 'תשתית', checklist: 'HTTPS, תעודה, הפניות, דומיינים ותת-דומיינים שונים בזרימה אחת.' },
      { id: 'SEC-B', name: 'חשיפה בצד הלקוח', checklist: 'מפתחות API, כתובות פנימיות, הערות מפתחים, מידע רגיש בקוד הגלוי.' },
      { id: 'SEC-C', name: 'פרטיות ועוגיות', checklist: 'באנר עוגיות (אפשרות סירוב?), מדיניות פרטיות, סקריפטים של צד שלישי, הסכמות בטפסים. לציין "לבדיקה מול עורך דין", לא קביעה משפטית.' },
      { id: 'SEC-D', name: 'אמון בתשלום', checklist: 'האם התשלום או התרומה עוברים לדומיין מוכר? סימני אמון, פרטי קשר ברורים.' },
    ],
  },
  {
    id: 'CONV', name: 'המרה', weight: 20,
    agents: [
      { id: 'CONV-A', name: 'הצעת ערך', checklist: 'האם במסך הראשון ברור מה זה, למי זה ולמה עכשיו?' },
      { id: 'CONV-B', name: 'משפך', checklist: 'מספר שלבים עד המטרה העסקית, חיכוכים, דרישות מיותרות (הרשמה מוקדמת, שדות מיותרים), נקודות נטישה צפויות.' },
      { id: 'CONV-C', name: 'קריאות לפעולה', checklist: 'האם יש CTA ראשי אחד ברור בכל מסך? ניסוח, מיקום, התחרות בין CTAs.' },
      { id: 'CONV-D', name: 'אמון והוכחה חברתית', checklist: 'המלצות, מספרים, לוגואים, אחריות ומדיניות החזרות, תמונות אמיתיות.' },
    ],
  },
  {
    id: 'BIZ', name: 'עסקי', weight: 15,
    agents: [
      { id: 'BIZ-A', name: 'תמחור וחבילות', checklist: 'בהירות מחירים, השוואה בין חבילות, עוגן מחיר, עלויות מוסתרות.' },
      { id: 'BIZ-B', name: 'מתחרים ובידול', checklist: 'מול המתחרים שהוגדרו, במה המוצר עדיף או נחות, והאם הבידול מוצג בכלל.' },
      { id: 'BIZ-C', name: 'גילוי ו-SEO', checklist: 'כותרות דפים, תיאורים, תצוגת שיתוף ברשתות (og), מבנה כותרות, תוכן שגוגל רואה.' },
      { id: 'BIZ-D', name: 'צמיחה ושימור', checklist: 'ניוזלטר, מנויים, הפניות, חזרה למוצר. מה חסר כדי שמשתמש יחזור?' },
    ],
  },
];

export const ALL_AGENTS = DEPARTMENTS.flatMap(d => d.agents.map(a => ({ ...a, dept: d.id, deptName: d.name })));

export const SEVERITY = {
  critical: { rank: 0, icon: '🔴', label: 'קריטי' },
  high:     { rank: 1, icon: '🟠', label: 'גבוה' },
  medium:   { rank: 2, icon: '🟡', label: 'בינוני' },
  low:      { rank: 3, icon: '⚪', label: 'נמוך' },
};

export const CERTAINTY = {
  verified:   { icon: '✅', label: 'מאומת' },
  likely:     { icon: '🟡', label: 'סביר' },
  hypothesis: { icon: '⚪', label: 'השערה' },
};

export const EFFORT = {
  S: { rank: 0, label: 'S (עד שעה)' },
  M: { rank: 1, label: 'M (עד יום)' },
  L: { rank: 2, label: 'L (יותר מיום)' },
};

export const COVERAGE = {
  yes:     'כן',
  partial: 'חלקי',
  no:      'לא',
};

export const CLIENT_FIELDS = [
  { key: 'name',        label: 'שם העסק / המוצר', required: true },
  { key: 'url',         label: 'כתובת / קישור לחנות' },
  { key: 'productType', label: 'סוג מוצר', options: ['אתר', 'אפליקציית ווב', 'אפליקציית מובייל', 'SaaS'] },
  { key: 'oneLiner',    label: 'מה המוצר עושה במשפט', required: true },
  { key: 'audience',    label: 'קהל יעד' },
  { key: 'goal',        label: 'מטרה עסקית עיקרית', options: ['מכירות', 'הרשמות', 'מנויים', 'לידים', 'הורדות'] },
  { key: 'flows',       label: '2–3 זרימות קריטיות לבדיקה' },
  { key: 'knownIssues', label: 'בעיות שהלקוח כבר מכיר' },
  { key: 'competitors', label: 'מתחרים עיקריים' },
  { key: 'scope',       label: 'היקף מאושר', options: ['בדיקה פסיבית בלבד', 'כולל חשבון בדיקה שהלקוח סיפק'] },
];

export const MODEL = process.env.AUDIT_MODEL || 'claude-opus-5';
export const EFFORT_SUBAGENT = process.env.AUDIT_EFFORT_SUBAGENT || 'medium';
export const EFFORT_SUPERVISOR = process.env.AUDIT_EFFORT_SUPERVISOR || 'high';
export const EFFORT_COORDINATOR = process.env.AUDIT_EFFORT_COORDINATOR || 'high';
export const CONCURRENCY = Number(process.env.AUDIT_CONCURRENCY || 6);
export const MAX_PAGES = Number(process.env.AUDIT_MAX_PAGES || 8);
export const MAX_HTML_CHARS = Number(process.env.AUDIT_MAX_HTML_CHARS || 60000);
