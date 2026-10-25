/* === PETO WEB (carpeta web-app/) ===
   Copia de app.js (raíz, Compilación 37) con textos adaptados a la
   web (cuenta en la nube y sincronización en vez de «solo en tu
   teléfono»: claves footer, set_data_help, lock_note, ob_intro_2 y
   ob_intro_3 en ES/EN/IT; en los otros 9 idiomas se usa la
   traducción normal de esas claves). La lógica es la misma; lo
   específico de navegador vive en web.js y web.css. Al actualizar
   la app hay que re-copiar y re-aplicar estos textos (ver LEEME.md).
   Sincronizado el 25-oct-2026 con la Compilación 37: Widgets v3
   (los widgets son nativos de Android; su código y las claves
   widget_* viajan aquí como paridad, sin ejecutarse en el
   navegador), la mini barra de marca del visor público del san,
   fija arriba al bajar por el enlace, y el acordeón de rondas
   del organizador, con solo la de esta semana abierta
   (709 claves por idioma, con la línea news_c37). Sobre la base
   de la Compilación 36 ya sincronizada (Podcast y vitrina). */
/* ============================================================
   PETO Finanzas · Compilación 31
   - 100% local: sin red, sin cuentas, sin rastreadores, sin SDKs.
   - Los datos viven solo en localStorage de este dispositivo.
   - Todo texto del usuario se pinta con textContent (sin innerHTML),
     y toda entrada se valida y se limita antes de guardarse.
   ============================================================ */
'use strict';

/* ---------------- Constantes ---------------- */
const DB_KEY = 'cgastos.db.v1';
const BUILD_LABEL = 'Compilación 37'; // marca visible de diagnóstico (bloqueo y Ajustes): confirma qué código corre el teléfono
const DEFAULT_CATEGORIES = ['Renta', 'Comida', 'Comida fuera', 'Gasolina', 'Transporte', 'Salud', 'Ropa', 'Otros'];
const SECTION_DEFS = [
  { id: 'gastos',      group: 'daily',    icon: '🧾' },
  { id: 'ingresos',    group: 'daily',    icon: '💵' },
  { id: 'ahorros',     group: 'daily',    icon: '🐷' },
  { id: 'buscar',      group: 'daily',    icon: '🔍' },
  { id: 'resumen',     group: 'plan',     icon: '📊' },
  { id: 'presupuesto', group: 'plan',     icon: '🎯' },
  { id: 'pagos',       group: 'plan',     icon: '🗓️' },
  { id: 'cuentas',     group: 'accounts', icon: '🏦' },
  { id: 'deudas',      group: 'accounts', icon: '📉' },
  { id: 'remesas',     group: 'accounts', icon: '🌎' },
  { id: 'san',         group: 'accounts', icon: '🤝' },
  { id: 'podcast',     group: 'plan',     icon: '🎙️' }
];
const MAX_ITEMS = 5000;
const MAX_MONEY_CENTS = 999999900; // $9,999,999.00

/* ---------------- Estado ---------------- */
let db = null;
let expMonth = currentMonthKey();
let hiddenAt = 0;

function defaultData() {
  return {
    version: 1,
    settings: {
      name: '',
      onboarded: false,
      textSize: 'normal',
      lang: 'auto',
      payday: null,
      reminders: true,
      theme: 'auto',
      accent: 'verde',
      autoFixed: true,
      notifications: false,
      summaryDaily: true,
      summaryTime: '08:00',
      summaryEmail: false,
      summaryTz: '',
      biometric: false,
      pro: false,
      proWaitlist: false,
      reviewPromptDone: false,
      challengeTargetCents: 2000,
      split: { ahorro: 25, negocio: 10, gastos: 55, familia: 10 },
      sections: { gastos: true, ingresos: true, ahorros: true, buscar: true, resumen: true, presupuesto: true, pagos: true, cuentas: true, deudas: true, san: true, podcast: true },
      pinSalt: null,
      pinHash: null
    },
    lastExportAt: null,
    customCategories: [],
    expenses: [],
    incomes: [],
    savings: [],
    savingsGoal: null,
    goals: [],
    remittances: [],
    alertsSent: {},
    san: null,
    sanOrg: null,
    budgets: {},
    fixed: [],
    accounts: [],
    debts: []
  };
}

function save() {
  try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) { /* almacenamiento lleno o bloqueado: la app sigue en memoria */ return false; }
  noteLocalChange();
  try { scheduleDailySummary(); } catch (e) { /* sin plugin: no-op seguro */ }
  return true;
}

function load() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) { db = defaultData(); return; }
    db = validateData(JSON.parse(raw)) || defaultData();
  } catch (e) { db = defaultData(); }
}

/* ---------------- Validación / saneamiento ----------------
   Se usa al cargar y al importar: nada entra a la app sin pasar por aquí. */
function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function cleanCents(value, allowNegative) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const c = Math.trunc(n);
  if (!allowNegative && c < 0) return 0;
  return Math.max(-MAX_MONEY_CENTS, Math.min(MAX_MONEY_CENTS, c));
}
function cleanDate(value) {
  if (typeof value !== 'string') return todayStr();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return todayStr();
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return todayStr();
  return value;
}
function cleanId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(value) ? value : uid();
}
function cleanPct(value) {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}
/* Interés anual de una deuda: número 0–100, hasta 2 decimales. */
function cleanRate(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.max(0, Math.min(100, n)) * 100) / 100;
}
/* Monedas destino de remesa (Fase 3). Lo viejo sin moneda = DOP, que era
   la única destino posible; cualquier código fuera de la lista cae a DOP. */
const REM_CURRENCIES = ['DOP', 'MXN', 'COP', 'GTQ', 'HNL', 'PEN', 'EUR', 'BRL', 'CLP', 'ARS'];
function cleanCurrency(value) {
  const c = cleanText(value, 3).toUpperCase();
  return REM_CURRENCIES.includes(c) ? c : 'DOP';
}
const MAX_PHOTO_CHARS = 1000000;
/* Foto de recibo: solo se acepta un dataURL de imagen con tope de tamaño. */
function cleanPhoto(value) {
  if (typeof value !== 'string') return null;
  if (value.indexOf('data:image/') !== 0) return null;
  if (value.length > MAX_PHOTO_CHARS) return null;
  return value;
}
/* Meta de ahorro: {name, targetCents} o null si falta o no es válida. */
function cleanSavingsGoal(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const name = cleanText(raw.name, 60);
  const target = cleanCents(raw.targetCents, false);
  if (!name || target <= 0) return null;
  return { name: name, targetCents: target };
}
/* San / tanda: un solo san activo. Participantes en orden; una semana por
   participante; en cada semana se anota quién ya pagó (paid por nombre). */
function cleanSan(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const name = cleanText(raw.name, 60);
  const aporte = cleanCents(raw.aporteCents, false);
  if (!name || aporte <= 0) return null;
  const participants = (Array.isArray(raw.participants) ? raw.participants : [])
    .map((p) => cleanText(p, 40)).filter((p) => p).slice(0, 52);
  if (participants.length === 0) return null;
  const srcWeeks = Array.isArray(raw.weeks) ? raw.weeks : [];
  const weeks = participants.map((unused, i) => {
    const paid = {};
    const src = srcWeeks[i];
    if (src && typeof src === 'object' && src.paid && typeof src.paid === 'object') {
      for (const p of participants) if (src.paid[p] === true) paid[p] = true;
    }
    return { paid: paid };
  });
  let currentWeek = Math.trunc(Number(raw.currentWeek));
  if (!Number.isFinite(currentWeek) || currentWeek < 0) currentWeek = 0;
  if (currentWeek > participants.length) currentWeek = participants.length;
  return { name: name, aporteCents: aporte, participants: participants, weeks: weeks, currentWeek: currentWeek };
}
/* San ORGANIZADO (Fase 4, función Pro): la tanda de TODO el grupo.
   Estructura hermana del san personal: participantes en orden de
   turno y una ronda por participante; cada ronda trae fecha porque
   el san guarda startDate y frecuencia (semanal/quincenal/mensual),
   y los pagos se marcan por ronda. Vive solo en el db local. */
const ORG_FREQUENCIES = ['semanal', 'quincenal', 'mensual'];
function cleanSanOrg(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const name = cleanText(raw.name, 60);
  const aporte = cleanCents(raw.aporteCents, false);
  if (!name || aporte <= 0) return null;
  const frequency = ORG_FREQUENCIES.includes(raw.frequency) ? raw.frequency : 'semanal';
  const startDate = cleanDate(raw.startDate);
  const participants = (Array.isArray(raw.participants) ? raw.participants : [])
    .map((p) => cleanText(p, 40)).filter((p) => p).slice(0, 52);
  if (participants.length === 0) return null;
  const srcRounds = Array.isArray(raw.rounds) ? raw.rounds : [];
  const rounds = participants.map((unused, i) => {
    const paid = {};
    const info = {};
    const src = srcRounds[i];
    if (src && typeof src === 'object' && src.paid && typeof src.paid === 'object') {
      for (const p of participants) if (src.paid[p] === true) paid[p] = true;
    }
    if (src && typeof src === 'object' && src.info && typeof src.info === 'object' && !Array.isArray(src.info)) {
      for (const p of participants) {
        const inf = src.info[p];
        if (inf && typeof inf === 'object' && (inf.st === 'reported' || inf.st === 'confirmed')) {
          const entry = { st: inf.st };
          if (typeof inf.photo === 'string' && inf.photo.indexOf('data:image/') === 0 && inf.photo.length <= 700000) entry.photo = inf.photo;
          if (entry.st === 'confirmed') { info[p] = entry; paid[p] = true; }
          else if (!paid[p]) { info[p] = entry; }
        }
      }
    }
    for (const p of participants) if (paid[p] && !info[p]) info[p] = { st: 'confirmed' };
    return { paid: paid, info: info };
  });
  const compModes = ['none', 'first', 'last', 'extra'];
  const rawComp = (raw.comp && typeof raw.comp === 'object' && !Array.isArray(raw.comp)) ? raw.comp : {};
  const comp = { mode: compModes.includes(rawComp.mode) ? rawComp.mode : 'none', amountCents: cleanCents(rawComp.amountCents, false) };
  const penModes = ['none', 'fixed', 'percent'];
  const rawPen = (raw.penalty && typeof raw.penalty === 'object' && !Array.isArray(raw.penalty)) ? raw.penalty : {};
  const penalty = { mode: penModes.includes(rawPen.mode) ? rawPen.mode : 'none', amountCents: cleanCents(rawPen.amountCents, false), percent: cleanPct(rawPen.percent) };
  const zelle = {};
  if (raw.zelle && typeof raw.zelle === 'object' && !Array.isArray(raw.zelle)) {
    for (const p of participants) { const zv = cleanText(raw.zelle[p], 60); if (zv) zelle[p] = zv; }
  }
  const history = [];
  if (Array.isArray(raw.history)) {
    for (const h of raw.history.slice(-100)) {
      if (!h || typeof h !== 'object') continue;
      if (h.kind !== 'swap' && h.kind !== 'started') continue;
      history.push({ ts: cleanDate(h.ts), kind: h.kind, a: cleanText(h.a, 40), b: cleanText(h.b, 40) });
    }
  }
  const linkToken = (typeof raw.linkToken === 'string' && /^[A-Za-z0-9]{1,40}$/.test(raw.linkToken)) ? raw.linkToken : null;
  return { name: name, aporteCents: aporte, frequency: frequency, startDate: startDate, participants: participants, rounds: rounds, comp: comp, penalty: penalty, started: raw.started === true, zelle: zelle, history: history, linkToken: linkToken };
}

function validateData(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const d = defaultData();
  const s = (raw.settings && typeof raw.settings === 'object') ? raw.settings : {};
  d.settings.name = cleanText(s.name, 40);
  d.settings.onboarded = s.onboarded === true;
  d.settings.textSize = s.textSize === 'grande' ? 'grande' : 'normal';
  if (s.split && typeof s.split === 'object') {
    d.settings.split = {
      ahorro: cleanPct(s.split.ahorro), negocio: cleanPct(s.split.negocio),
      gastos: cleanPct(s.split.gastos), familia: cleanPct(s.split.familia)
    };
  }
  if (s.sections && typeof s.sections === 'object') {
    for (const def of SECTION_DEFS) d.settings.sections[def.id] = s.sections[def.id] !== false;
  }
  d.settings.pinSalt = (typeof s.pinSalt === 'string' && /^[0-9a-f]{32}$/.test(s.pinSalt)) ? s.pinSalt : null;
  d.settings.pinHash = (typeof s.pinHash === 'string' && /^[0-9a-f]{64}$/.test(s.pinHash)) ? s.pinHash : null;
  if (!d.settings.pinSalt || !d.settings.pinHash) { d.settings.pinSalt = null; d.settings.pinHash = null; }
  d.settings.lang = (s.lang === 'auto' || LANGS.includes(s.lang)) ? s.lang : 'auto';
  d.settings.payday = (typeof s.payday === 'number' && Number.isFinite(s.payday) &&
    Math.trunc(s.payday) >= 0 && Math.trunc(s.payday) <= 6) ? Math.trunc(s.payday) : null;
  d.settings.reminders = s.reminders !== false;
  d.settings.autoFixed = s.autoFixed !== false;
  d.settings.notifications = s.notifications === true;
  d.settings.summaryDaily = s.summaryDaily !== false;
  d.settings.summaryTime = (() => {
    const v = (typeof s.summaryTime === 'string') ? s.summaryTime : '';
    const m = /^(\d{2}):(\d{2})$/.exec(v);
    if (!m) return '08:00';
    const hh = Number(m[1]); const mm = Number(m[2]);
    return (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) ? v : '08:00';
  })();
  d.settings.summaryEmail = s.summaryEmail === true;
  d.settings.summaryTz = (typeof s.summaryTz === 'string') ? s.summaryTz.slice(0, 64) : '';
  d.settings.biometric = s.biometric === true;
  d.settings.pro = s.pro === true;
  d.settings.proWaitlist = s.proWaitlist === true;
  d.settings.reviewPromptDone = s.reviewPromptDone === true;
  d.settings.theme = (s.theme === 'claro' || s.theme === 'oscuro' || s.theme === 'auto') ? s.theme : 'auto';
  d.settings.accent = ['verde', 'azul', 'morado', 'naranja'].includes(s.accent) ? s.accent : 'verde';
  const chalTarget = cleanCents(s.challengeTargetCents, false);
  d.settings.challengeTargetCents = chalTarget > 0 ? chalTarget : 2000;
  d.lastExportAt = (typeof raw.lastExportAt === 'string' && Number.isFinite(Date.parse(raw.lastExportAt)))
    ? raw.lastExportAt : null;

  const arr = (v) => Array.isArray(v) ? v.slice(0, MAX_ITEMS) : [];
  d.customCategories = arr(raw.customCategories)
    .map((c) => cleanText(c, 30)).filter((c) => c && !DEFAULT_CATEGORIES.includes(c));
  d.customCategories = Array.from(new Set(d.customCategories)).slice(0, 50);

  const okCat = (c) => allCategories(d).includes(c) ? c : 'Otros';
  d.expenses = arr(raw.expenses).filter((x) => x && typeof x === 'object').map((x) => ({
    id: cleanId(x.id), amountCents: cleanCents(x.amountCents, false),
    category: okCat(cleanText(x.category, 30)), date: cleanDate(x.date), note: cleanText(x.note, 120),
    photo: cleanPhoto(x.photo), biz: x.biz === true
  }));
  d.incomes = arr(raw.incomes).filter((x) => x && typeof x === 'object').map((x) => {
    const amount = cleanCents(x.amountCents, false);
    /* El ahorro es manual: se guarda lo que la persona anotó. Los ingresos
       viejos sin savingsCents conservan el valor que la app ya mostraba
       (la sugerencia del porcentaje) para no cambiar ningún total al cargar. */
    const savings = (typeof x.savingsCents === 'number' && Number.isFinite(x.savingsCents))
      ? cleanCents(x.savingsCents, false)
      : splitCents(amount, d.settings.split).ahorro;
    return {
      id: cleanId(x.id), amountCents: amount, savingsCents: savings,
      date: cleanDate(x.date), note: cleanText(x.note, 120), biz: x.biz === true
    };
  });
  d.savings = arr(raw.savings).filter((x) => x && typeof x === 'object').map((x) => ({
    id: cleanId(x.id), amountCents: cleanCents(x.amountCents, false),
    date: cleanDate(x.date), note: cleanText(x.note, 120),
    /* Meta a la que está asignado el ahorro (Paquete 3). Los datos
       viejos no traen goalId: quedan en null = ahorro general. La
       limpieza contra las metas existentes va al final de esta
       función, cuando d.goals ya está saneado. */
    goalId: (typeof x.goalId === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(x.goalId)) ? x.goalId : null
  }));
  d.savingsGoal = cleanSavingsGoal(raw.savingsGoal);
  d.san = cleanSan(raw.san);
  d.sanOrg = cleanSanOrg(raw.sanOrg);
  if (raw.budgets && typeof raw.budgets === 'object' && !Array.isArray(raw.budgets)) {
    for (const k of Object.keys(raw.budgets)) {
      const cat = cleanText(k, 30);
      if (allCategories(d).includes(cat)) d.budgets[cat] = cleanCents(raw.budgets[k], false);
    }
  }
  d.fixed = arr(raw.fixed).filter((x) => x && typeof x === 'object').map((x) => {
    const paid = {};
    if (x.paidMonths && typeof x.paidMonths === 'object') {
      for (const k of Object.keys(x.paidMonths)) {
        if (/^\d{4}-(0[1-9]|1[0-2])$/.test(k) && x.paidMonths[k] === true) paid[k] = true;
      }
    }
    const auto = {};
    if (x.autoMonths && typeof x.autoMonths === 'object') {
      for (const k of Object.keys(x.autoMonths)) {
        if (/^\d{4}-(0[1-9]|1[0-2])$/.test(k) && x.autoMonths[k] === true) auto[k] = true;
      }
    }
    return {
      id: cleanId(x.id), name: cleanText(x.name, 60) || 'Pago fijo',
      amountCents: cleanCents(x.amountCents, false),
      day: Math.max(1, Math.min(31, Math.trunc(Number(x.day)) || 1)), paidMonths: paid, autoMonths: auto
    };
  });
  d.accounts = arr(raw.accounts).filter((x) => x && typeof x === 'object').map((x) => ({
    id: cleanId(x.id), name: cleanText(x.name, 60) || 'Cuenta',
    balanceCents: cleanCents(x.balanceCents, true)
  }));
  d.debts = arr(raw.debts).filter((x) => x && typeof x === 'object').map((x) => ({
    id: cleanId(x.id), name: cleanText(x.name, 60) || 'Deuda',
    amountCents: cleanCents(x.amountCents, false),
    status: x.status === 'pagada' ? 'pagada' : 'pendiente',
    interesPct: cleanRate(x.interesPct),
    pagoMinCents: cleanCents(x.pagoMinCents, false)
  }));
  d.goals = arr(raw.goals).slice(0, 20).filter((x) => x && typeof x === 'object').map((x) => ({
    id: cleanId(x.id), name: cleanText(x.name, 60) || 'Meta',
    targetCents: Math.max(1, cleanCents(x.targetCents, false)),
    savedCents: cleanCents(x.savedCents, false)
  }));
  d.remittances = arr(raw.remittances).filter((x) => x && typeof x === 'object').map((x) => ({
    id: cleanId(x.id), date: cleanDate(x.date),
    usdCents: cleanCents(x.usdCents, false),
    rateCents: Math.max(1, Math.min(1000000, Math.trunc(Number(x.rateCents)) || 0)),
    currency: cleanCurrency(x.currency),
    recipient: cleanText(x.recipient, 60), note: cleanText(x.note, 120)
  })).filter((x) => x.rateCents > 0);
  d.alertsSent = {};
  if (raw.alertsSent && typeof raw.alertsSent === 'object') {
    for (const k of Object.keys(raw.alertsSent)) {
      if (/^\d{4}-\d{2}\|.+\|\d{2,3}$/.test(k) && raw.alertsSent[k] === true) d.alertsSent[k] = true;
    }
  }
  /* Un ahorro asignado a una meta que ya no existe vuelve a ser
     ahorro general: nunca se pierde el dinero, solo la etiqueta. */
  const goalIds = new Set(d.goals.map((g) => g.id));
  for (const s of d.savings) if (s.goalId && !goalIds.has(s.goalId)) s.goalId = null;
  return d;
}

/* ---------------- Utilidades ---------------- */
/* ---------------- Idioma (12 idiomas + automático) ----------------
   Todo texto visible pasa por t() o por data-i18n en el HTML. Los datos
   guardados (categorías, nombres) nunca se traducen: solo la interfaz.
   El ajuste de idioma puede ser un idioma concreto o 'auto' (el del
   teléfono): detectLang() resuelve el automático desde navigator.language
   y lang() devuelve siempre el idioma efectivo ya resuelto. */
const LANGS = ['es', 'en', 'it', 'pt', 'fr', 'de', 'zh', 'ja', 'ko', 'ru', 'hi', 'ar'];
const LOCALES = { es: 'es', en: 'en-US', it: 'it-IT', pt: 'pt', fr: 'fr-FR', de: 'de-DE', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR', ru: 'ru-RU', hi: 'hi-IN', ar: 'ar-EG' };
const I18N = {
es: {
  org_err_san_name: 'Escribe el nombre del san.', rep_promo_footer: 'Controla tus gastos con PETO Finanzas · petofinanzas.com', rep_saved: 'Imagen guardada.', set_sections_summary: '{visible} de {total} visibles',
  org_err_active_exists: 'Ya hay un san activo («{name}»). Bórralo primero desde su tarjeta si quieres crear otro.',
  app_title: 'PETO Finanzas', back: '← Todas las opciones', greeting: 'Hola', lock_btn: 'Bloquear',
  home_menu_heading: '¿Qué quieres ver?',
  group_daily: 'Día a día', group_plan: 'Planificación', group_accounts: 'Cuentas y compromisos', group_yourapp: 'Tu app',
  sec_gastos: 'Gastos del mes', sec_ingresos: 'Ingresos semanales', sec_ahorros: 'Ahorros', sec_resumen: 'Resumen',
  sec_presupuesto: 'Presupuesto por categoría', sec_pagos: 'Pagos fijos', sec_cuentas: 'Mis cuentas',
  sec_deudas: 'Mis deudas', sec_san: 'Mi san', sec_ajustes: 'Ajustes y personalización',
  menu_open_aria: 'Abrir menú', menu_close_aria: 'Cerrar menú', sec_home: 'Inicio', key_home: 'Tu pantalla principal',
  set_notif_label: 'Notificaciones con la app cerrada', set_notif_help: 'Avisos de tus pagos fijos un día antes y el mismo día, aunque PETO Finanzas esté cerrada.',
  set_autofixed_label: 'Registrar pagos fijos automáticamente', set_autofixed_help: 'Al vencer un pago fijo, el gasto se anota solo. Puedes deshacerlo al momento.',
  set_bio_label: 'Desbloqueo con huella', set_bio_help: 'Entra con tu huella además del PIN (necesitas tener un PIN activo).',
  bio_btn: '👆 Entrar con huella', bio_reason: 'Confirma que eres tú para abrir PETO Finanzas',
  bio_need_pin: 'La huella necesita un PIN activo: crea tu PIN en Ajustes → Seguridad y luego la huella funcionará al abrir la app.',
  bio_failed: 'La huella no se pudo verificar. Escribe tu PIN.',
  bio_unavailable: 'La huella no está disponible en este teléfono. Escribe tu PIN.',
  bio_not_enrolled: 'Este teléfono no tiene ninguna huella registrada. Regístrala en los ajustes del teléfono o escribe tu PIN.',
  bio_offer_title: '¿Desbloquear con tu huella?',
  bio_offer_text: 'Acabas de crear tu PIN. Si quieres, puedes entrar a PETO Finanzas con tu huella en vez de escribir el PIN cada vez. ¿Lo activamos ahora?',
  bio_offer_yes: 'Sí, activar la huella',
  bio_offer_no: 'Ahora no',
  bio_activated: 'Listo: el desbloqueo con huella quedó activado.',
  fix_auto_suffix: '(pago fijo automático)',
  backup_pass_label: 'Contraseña de la copia cifrada', backup_pass_ph: 'Mínimo 4 caracteres',
  data_export_enc: 'Exportar copia cifrada',
  backup_help: 'La copia cifrada se abre solo con tu contraseña. Sin ella no se puede recuperar: guárdala bien. Para importar una copia cifrada, escribe aquí su contraseña antes de elegir el archivo.',
  backup_err_short: 'La contraseña necesita al menos 4 caracteres.',
  backup_need_pass: 'Escribe la contraseña de la copia cifrada antes de importarla.',
  backup_err_pass: 'No se pudo abrir la copia: contraseña incorrecta o archivo dañado.',
  share_btn: 'Compartir resumen', share_copied: 'Resumen copiado. Pégalo donde quieras.',
  review_title: '¿Te gusta PETO Finanzas?',
  review_text: 'Si PETO Finanzas te ayuda a cuidar tu dinero, una reseña en Google Play nos ayuda muchísimo a llegar a más personas. ¡Gracias!',
  review_yes: '⭐ Calificar en Google Play', review_no: 'Ahora no',
  share_report_title: 'Mi resumen de PETO Finanzas',
  notif_fixed_title: 'Pago fijo mañana', notif_fixed_today: 'Pago fijo hoy', notif_fixed_body: '{name} · {amount}',
  notif_weekly_title: 'Tu semana en PETO Finanzas', notif_weekly_body: 'Anota tus gastos e ingresos de la semana para no perder el hilo.',
  summary_title: 'Resumen diario',
  summary_help: 'Un aviso con lo que gastaste ayer y lo que puedes gastar hoy, a la hora que elijas.',
  summary_notif_label: 'Resumen por notificación',
  summary_time_label: 'Hora del resumen',
  summary_email_label: 'Recibir también por correo',
  summary_email_help: 'Solo con tu cuenta en la nube activa: el mismo resumen llega también a tu correo.',
  notif_summary_title: '🌅 Tu resumen de PETO Finanzas',
  notif_summary_body: 'Ayer gastaste {spent} · Hoy puedes gastar {daily}',
  notif_summary_body_nodaily: 'Ayer gastaste {spent}',
  sec_remesas: 'Remesas', key_remesas: 'Enviado este mes: {amount}',
  rem_intro: 'El dinero que envías a tu gente: cuánto salió en dólares y cuánto llegó en su moneda.',
  rem_usd_label: 'Cantidad enviada ($ USD)', rem_rate_label: 'Tasa ({cur} por $1)', rem_recipient_label: '¿Para quién?',
  rem_currency_label: 'Moneda de destino', rem_arrives_label: 'Llega',
  rem_rate_suggested: 'Última tasa que usaste para {cur}: {rate}. Quedó puesta; cámbiala si hoy es otra.',
  rem_month_sent: 'Este mes enviaste {usd}', rem_totals_title: 'Totales por moneda (todo el historial)',
  rem_total_row: '{usd} enviados → {amount} recibidos · {n} envíos',
  rem_save: 'Guardar remesa', rem_empty: 'No tienes remesas registradas.',
  rem_delete_confirm: '¿Borrar la remesa a {name}?',
  csv_title: 'Importar estado de cuenta (CSV)',
  csv_help: 'Sube el archivo CSV de tu banco y revisa todo en una vista previa antes de importar: nada se guarda hasta que confirmes.',
  csv_file_label: 'Archivo CSV del banco', csv_preview_title: 'Vista previa de la importación',
  csv_summary: '{total} movimientos · {dups} duplicados (excluidos) · {sel} para importar',
  csv_dup_badge: 'Duplicado', csv_income_badge: 'Ingreso', csv_expense_badge: 'Gasto',
  csv_all: 'Marcar todos', csv_none: 'Desmarcar todos',
  csv_apply: 'Importar seleccionados', csv_cancel: 'Cancelar importación',
  csv_done: 'Se importaron {n} movimientos. ✅',
  csv_none_selected: 'No marcaste ningún movimiento para importar.',
  csv_err_parse: 'No se pudo leer ese archivo como CSV. Revisa que sea el estado de cuenta en formato CSV.',
  csv_err_headers: 'No encontré las columnas de fecha y monto en ese archivo.',
  csv_err_big: 'Ese archivo es demasiado grande para importarlo.',
  csv_err_empty: 'Ese archivo no trae movimientos que se puedan importar.',
  pdf_err_big: 'Ese PDF es muy grande (máximo 8 MB).',
  pdf_err_notext: 'Ese PDF no tiene texto que pueda leer (parece una foto o escaneo). Prueba con el CSV del banco o anota el gasto con la foto del recibo.',
  pdf_err_empty: 'No encontré movimientos con fecha y monto en ese PDF. Prueba con el CSV del banco.',
  shared_title: 'Presupuesto compartido',
  shared_preview_note: '🔧 Vista previa del diseño: todavía no se conecta con otras cuentas. Sirve para probar cómo se verá crear un hogar, unirse con un código y ver los miembros.',
  shared_create_label: 'Nombre del hogar', shared_create_btn: 'Crear hogar',
  shared_join_label: 'Código de invitación', shared_join_btn: 'Unirme con código',
  shared_members_title: 'Miembros', shared_code_label: 'Código para invitar: {code}',
  shared_role_dueno: 'Dueño/a', shared_role_admin: 'Admin', shared_role_miembro: 'Miembro', shared_role_lector: 'Solo lectura',
  shared_you: 'Tú', shared_host: 'Anfitrión/a',
  shared_leave_btn: 'Salir del hogar', shared_leave_confirm: '¿Salir de este hogar? (vista previa)',
  shared_err_name: 'Escribe un nombre para el hogar.', shared_err_code: 'El código tiene 6 letras o números.',
  shared_created: 'Hogar creado (vista previa). ✅', shared_joined: 'Te uniste al hogar (vista previa). ✅',
  shared_household_fallback: 'Hogar compartido',
  privacy_hide: 'Ocultar montos', privacy_show: 'Mostrar montos',
  ins_title: '💡 Ideas de tu dinero', ins_cat_up: '{cat} subió {pct}% vs el mes pasado ({from} → {to}).',
  ins_pace_down: 'Vas más tranquilo: tu ritmo de gasto bajó {pct}% vs el mes pasado.',
  ins_pace_up: 'Ojo: tu ritmo de gasto subió {pct}% vs el mes pasado.',
  ins_biggest: 'Tu mayor gasto del mes: {note} · {amount}.', ins_saved: 'Llevas ahorrado {amount} este mes. ¡Sigue así!',
  bud_alert_title: 'Presupuesto en riesgo', bud_alert_warn: '{cat}: vas en {pct}% del presupuesto.',
  bud_alert_over: '{cat}: ya pasaste el presupuesto ({pct}%).',
  voice_btn: '🎤 Dictar', voice_listening: 'Escuchando… di la cantidad y en qué fue.',
  voice_unavailable: 'La voz no está disponible en este dispositivo.', voice_heard: 'Escuché: «{text}». Revisa y guarda.',
  voice_no_amount: 'Escuché: «{text}», pero no encontré la cantidad.',
  ocr_found: 'Detecté {amount} en el recibo. Verifícalo antes de guardar.',
  goals_title: 'Otras metas', goal2_create: 'Crear meta', goal_add: '+ Aportar', goal_take: '− Retirar',
  goal_done: '🎉 ¡Meta cumplida!', goal_move_label: 'Cantidad', goal_delete_confirm: '¿Borrar la meta «{name}»?',
  err_limit_goals: 'Ya tienes el máximo de metas.',
  biz_label: 'Es de mi negocio', biz_title: 'Mi negocio este mes', biz_income: 'Ingresos del negocio',
  biz_expenses: 'Gastos del negocio', biz_profit: 'Ganancia', chal_share: 'Compartir mi reto',
  cloud_title: 'Cuenta en la nube',
  cloud_help: 'Con una cuenta, tus datos se guardan también en la nube y se sincronizan: si cambias de teléfono, entras con tu correo y todo sigue ahí. Sin cuenta, la app funciona solo en este teléfono, como siempre.',
  cloud_email: 'Correo electrónico', cloud_pass: 'Contraseña',
  cloud_signin: 'Entrar', cloud_signup: 'Crear cuenta', cloud_signout: 'Cerrar sesión',
  cloud_sync_now: 'Sincronizar ahora', cloud_wipe: 'Borrar mis datos de la nube',
  cloud_who: 'Sesión iniciada como {email}', cloud_synced: 'Sincronizado ✓ · {time}',
  cloud_never: 'Todavía no se sincronizó.', cloud_working: 'Trabajando…',
  cloud_ok_in: '¡Bienvenido de nuevo!', cloud_ok_up: '¡Cuenta creada! Tus datos ya están en la nube.',
  cloud_err_fields: 'Escribe tu correo y una contraseña de al menos 6 letras.',
  cloud_err_login: 'No se pudo entrar. Revisa tu correo y contraseña.',
  cloud_err_exists: 'Ese correo ya tiene cuenta. Usa «Entrar».',
  cloud_err_confirm: 'Cuenta creada. Revisa tu correo y confirma tu cuenta, luego entra.',
  cloud_err_generic: 'Algo falló con la nube. Revisa tu internet e inténtalo de nuevo.',
  cloud_conflict: 'Hay datos distintos en la nube y en este teléfono. ¿Quieres bajar los de la nube y reemplazar los de este teléfono? (Cancelar = subir los de este teléfono)',
  cloud_wipe_confirm: '¿Borrar TODOS tus datos de la nube? Lo de este teléfono se queda como está.',
  cloud_delete: 'Eliminar mi cuenta',
  cloud_delete_confirm1: '¿Eliminar tu cuenta de PETO Finanzas? Se borra tu cuenta, tu copia de datos en la nube y los hogares compartidos que sean tuyos. Los datos de ESTE teléfono se quedan aquí, sin borrarse (puedes borrarlos en Ajustes). No se puede deshacer.',
  cloud_delete_confirm2: 'Última confirmación: ¿eliminar tu cuenta para siempre?',
  cloud_deleted: 'Tu cuenta fue eliminada.',
  cloud_delete_err_auth: 'Tu sesión ya no es válida. Entra de nuevo e inténtalo otra vez.',
  cloud_unavailable: 'La nube no está disponible en esta versión.',
  key_settings: 'Nombre, reparto, texto, secciones, PIN',
  footer: 'PETO Web · Con tu cuenta en la nube, tus datos se sincronizan con tu teléfono',
  tile_available: 'Dinero disponible', tile_available_aria: 'Dinero disponible: ir a Mis cuentas',
  tile_savings: 'Ahorros del mes', tile_savings_aria: 'Ahorros del mes: ir a Ahorros',
  tile_debts: 'Deudas pendientes', tile_debts_aria: 'Deudas pendientes: ir a Mis deudas',
  tile_incomes: '💵 Ingresos', tile_incomes_aria: 'Ingresos: ir a Ingresos semanales',
  tile_expenses: '🧾 Gastos', tile_expenses_aria: 'Gastos: ir a Gastos del mes',
  tile_goal: "Meta '{name}': {pct}%",
  key_spent_month: '{amount} gastados este mes', key_income_month: '{amount} recibidos este mes',
  key_saved_total: '{amount} ahorrados en total', key_goal_suffix: " · Meta '{name}': {pct}%",
  key_budget_one: '{n} categoría con límite', key_budget_many: '{n} categorías con límite',
  key_fixed: '{amount} al mes · {n} por pagar', key_available: 'Disponible: {amount}', key_debts: '{amount} pendientes',
  key_san: 'Semana {x} de {n} · Le toca a {name}', key_san_done: 'San terminado 🎉', key_san_none: 'Sin san activo',
  banner_payday: 'Hoy es día de cobro: registra tu ingreso y tu ahorro.',
  banner_dues_title: 'Pagos por vencer:', banner_due_item: '{name} (día {day})', banner_close: 'Cerrar aviso',
  spend_title: '¿Cuánto puedes gastar hoy?',
  spend_note: 'Esto es lo que puedes gastar hoy sin pasarte.',
  spend_guide: 'Crea tu primer presupuesto por categoría y aquí verás cuánto puedes gastar cada día.',
  spend_left: 'Te quedan {amount} para los {days} días que faltan del mes.',
  spend_left_one: 'Te queda {amount} para hoy, el último día del mes.',
  spend_over: 'Ya alcanzaste el presupuesto del mes.', spend_over_by: 'Te pasaste por {amount}.',
  'cat_Renta': 'Renta', 'cat_Comida': 'Comida', 'cat_Comida fuera': 'Comida fuera', 'cat_Gasolina': 'Gasolina',
  'cat_Transporte': 'Transporte', 'cat_Salud': 'Salud', 'cat_Ropa': 'Ropa', 'cat_Otros': 'Otros',
  btn_cancel: 'Cancelar', btn_save: 'Guardar', btn_edit: 'Editar', btn_delete: 'Borrar',
  err_amount: 'Escribe una cantidad válida, mayor que $0.', err_amount_generic: 'Escribe una cantidad válida.',
  err_name: 'Escribe un nombre.', chip_paid: 'Pagado', chip_pending: 'Pendiente',
  month_prev_aria: 'Mes anterior', month_next_aria: 'Mes siguiente',
  exp_new: 'Nuevo gasto', exp_edit: 'Editar gasto', exp_total_label: 'Total del mes:',
  amount_label: 'Cantidad ($)', category_label: 'Categoría', date_label: 'Fecha', note_label: 'Nota (opcional)',
  exp_note_ph: '¿En qué fue?', exp_save: 'Guardar gasto',
  exp_empty: 'Todavía no hay gastos en este mes.\nRegistra el primero con el formulario de arriba. 👍',
  exp_delete_confirm: '¿Borrar este gasto de {amount}? Es de la categoría {cat}, del {date}. Solo se borra este gasto.',
  err_category: 'Elige una categoría válida.', err_limit_expenses: 'Llegaste al límite de gastos guardados.',
  inc_intro: 'El ahorro no se calcula solo: tú anotas cuánto ahorraste de verdad en cada ingreso. La app solo te sugiere una cantidad según tu porcentaje de Ajustes.',
  inc_new: 'Nuevo ingreso', inc_edit: 'Editar ingreso', inc_note_ph: '¿De dónde vino?',
  inc_savings_label: 'Ahorro ($)', inc_savings_label_sug: 'Ahorro (sugerido: {amount})',
  inc_savings_help: 'Sugerencia según tu porcentaje de ahorro — cámbialo por lo que realmente ahorraste. Puedes poner $0.',
  inc_split_line: 'Ahorro anotado: {sav} · Sugerencia: Negocio {biz} · Gastos {exp} · Familia {fam}',
  inc_split_preview: 'Reparto sugerido: Ahorro {sav} · Negocio {biz} · Gastos {exp} · Familia {fam}. El ahorro que cuenta es el que anotes abajo.',
  inc_save: 'Guardar ingreso',
  inc_empty: 'Todavía no hay ingresos registrados.\nAgrega tu primer ingreso y anota cuánto ahorraste de él. 💪',
  inc_delete_confirm: '¿Borrar este ingreso de {amount} del {date}? También se borra su ahorro anotado de {savings}.',
  err_inc_savings: 'Escribe cuánto ahorraste de este ingreso (puede ser $0).',
  err_limit_incomes: 'Llegaste al límite de ingresos guardados.',
  sav_intro_1: 'Aquí ves cada cantidad que ahorraste, una por una. También puedes agregar un ahorro suelto,',
  sav_intro_2: 'sin que venga de un ingreso', sav_intro_3: ', con el formulario de abajo. Si borras un ahorro, solo se borra esa cantidad:',
  sav_intro_4: 'el ingreso se queda igual', sav_intro_5: '.',
  sav_total_label: 'Total ahorrado:', sav_month_label: 'Ahorrado este mes:',
  sav_form_title: 'Agregar ahorro', sav_note_ph: '¿Para qué es este ahorro?', sav_save: 'Guardar ahorro',
  sav_goal_label: 'Asignar a una meta (opcional)', sav_goal_none: 'Sin meta · ahorro general',
  sav_empty: 'Todavía no tienes ahorros anotados.\nAgrega uno con el formulario de arriba, o anota el ahorro de un ingreso cuando lo registres y aparecerá aquí. 🌱',
  sav_from_title: 'Ahorro del {date}', sav_from_sub: 'De un ingreso de {amount}',
  sav_manual_title: 'Ahorro agregado', sav_manual_sub: 'Manual · agregado el {date}',
  sav_delete_income_confirm: '¿Borrar este ahorro de {amount} del {date}? Solo se borra esta cantidad de ahorro: el ingreso de {income} se queda igual.',
  sav_delete_manual_confirm: '¿Borrar este ahorro de {amount} del {date}? Es un ahorro que agregaste a mano en Ahorros; se borra solo esta entrada.',
  err_limit_savings: 'Llegaste al límite de ahorros guardados.',
  goal_prompt: '¿Para qué estás ahorrando?', goal_prompt_sub: 'Crea una meta y mira cómo tu ahorro se acerca a ella.',
  goal_form_create: 'Crear meta', goal_form_edit: 'Editar meta',
  goal_name_label: 'Nombre de la meta', goal_name_ph: 'Ej.: Fondo de emergencia', goal_target_label: 'Cantidad meta ($)',
  goal_create_btn: 'Crear meta', goal_save_btn: 'Guardar meta',
  goal_progress: 'Llevas {have} de {target}', goal_remaining: 'Te faltan {amount}', goal_done: '🎉 ¡Meta cumplida!',
  goal_edit: 'Editar meta', goal_delete: 'Borrar meta',
  goal_delete_confirm: '¿Borrar la meta "{name}"? Tus ahorros no se tocan: solo se borra la meta.',
  err_goal_name: 'Escribe un nombre para tu meta.',
  res_cats_title: 'Gastos por categoría', res_summary_title: 'Ingresos vs Gastos vs Ahorros',
  chart_income: 'Ingresos', chart_expenses: 'Gastos', chart_savings: 'Ahorros',
  res_cats_empty: 'No hay gastos en este mes.', res_summary_empty: 'Todavía no hay movimientos en este mes.',
  bud_intro: 'Pon un límite mensual por categoría y mira cuánto llevas gastado.',
  bud_spent_left: 'Gastado {spent} de {budget} · Quedan {left}', bud_spent_over: 'Gastado {spent} de {budget} · Te pasaste por {over}',
  bud_nolimit: 'Sin límite. Gastado este mes: {spent}', bud_placeholder: 'Límite mensual $', bud_aria: 'Límite mensual para {cat}',
  bud_delete_cat: 'Borrar categoría',
  bud_delete_cat_confirm: '¿Borrar la categoría "{cat}"? Los gastos que la usan pasarán a "{other}".',
  bud_alert_amount: 'Escribe una cantidad válida para el límite.',
  cat_form_title: 'Categoría personalizada', cat_name_label: 'Nombre de la categoría', cat_name_ph: 'Ej.: Mascotas',
  cat_save: 'Agregar categoría', err_cat_name: 'Escribe un nombre para la categoría.', err_cat_exists: 'Esa categoría ya existe.',
  fix_intro: 'Pagos que se repiten cada mes: renta, teléfono, suscripciones…',
  fix_new: 'Nuevo pago fijo', fix_edit: 'Editar pago fijo', fix_name_ph: 'Ej.: Renta', fix_day_label: 'Día del mes',
  fix_save: 'Guardar pago fijo', fix_empty: 'No tienes pagos fijos todavía.',
  fix_sub: 'Día {day} de cada mes · {month}', fix_mark: 'Marcar pagado', fix_unmark: 'Desmarcar',
  fix_delete_confirm: '¿Borrar el pago fijo "{name}"?', err_day: 'El día debe ser entre 1 y 31.',
  err_limit_fixed: 'Llegaste al límite de pagos fijos.',
  acc_new: 'Nueva cuenta', acc_edit: 'Editar cuenta', acc_balance_label: 'Saldo ($)',
  acc_name_ph: 'Ej.: Efectivo, Banco, Ahorros', acc_save: 'Guardar cuenta',
  acc_empty: 'No tienes cuentas todavía.\nAgrega una para ver tu dinero disponible en el resumen.',
  acc_delete_confirm: '¿Borrar la cuenta "{name}"?', err_balance: 'Escribe un saldo válido.',
  err_limit_accounts: 'Llegaste al límite de cuentas.',
  debt_new: 'Nueva deuda', debt_edit: 'Editar deuda', debt_name_ph: 'Ej.: Tarjeta, Préstamo',
  debt_status_label: 'Estado', debt_status_pending: 'Pendiente', debt_status_paid: 'Pagada',
  debt_save: 'Guardar deuda', debt_empty: 'No tienes deudas registradas. 🎉',
  debt_mark_paid: 'Marcar pagada', debt_mark_pending: 'Marcar pendiente',
  debt_delete_confirm: '¿Borrar la deuda "{name}"?', err_limit_debts: 'Llegaste al límite de deudas.',
  name_label: 'Nombre',
  san_intro: 'Un san (tanda) es un círculo de ahorro: cada semana todos aportan y una persona recibe el total, por turnos.',
  san_form_title: 'Crear un san', san_name_label: 'Nombre del san', san_name_ph: 'Ej.: San de la familia',
  san_aporte_label: 'Aporte por turno ($)', san_participants_label: 'Participantes (en orden de turno)',
  san_pname_ph: 'Nombre del participante', san_add_participant: 'Agregar', san_create_btn: 'Crear san',
  san_err_participants: 'Agrega al menos 2 participantes.', san_err_dup: 'Ese participante ya está en la lista.',
  san_err_active_exists: 'Ya hay un san en curso («{name}»). Bórralo primero si quieres crear otro.',
  san_err_pname: 'Escribe el nombre del participante.', san_remove: 'Quitar', san_draft_empty: 'Todavía no agregas participantes.',
  san_week: 'Semana {x} de {n}', san_finished: '🎉 ¡San terminado!',
  san_finished_note: 'Todas las semanas se completaron. Puedes borrar este san y crear uno nuevo.',
  san_total_line: 'Total reunido: {amount}', san_week_collected: 'Reunido esta semana: {amount} de {target}',
  san_receiver_line: 'Le toca a: {name}', san_aporte_line: 'Aporte por turno: {amount}',
  san_paid_title: '¿Quién ya pagó esta semana?', san_paid: 'ya pagó',
  san_advance: 'Marcar semana completa', san_delete: 'Borrar san',
  san_delete_confirm: '¿Borrar el san "{name}"? Se borra su registro de semanas y pagos.',
  san_new_btn: 'Crear un san nuevo', san_new_confirm: 'El san actual ya terminó. ¿Borrarlo y crear uno nuevo?',
  set_profile: 'Tu perfil', set_name_label: 'Tu nombre', set_textsize_label: 'Tamaño del texto',
  textsize_normal: 'Normal', textsize_large: 'Grande', set_lang_label: 'Idioma / Language', lang_auto: 'Automático (el del teléfono)',
  set_reminders_title: 'Recordatorios', set_payday_label: 'Día de cobro', set_reminders_label: 'Recordatorios en Inicio',
  wd_none: 'Sin día de cobro', wd_0: 'Domingo', wd_1: 'Lunes', wd_2: 'Martes', wd_3: 'Miércoles', wd_4: 'Jueves', wd_5: 'Viernes', wd_6: 'Sábado',
  set_split_title: 'Reparto sugerido de ingresos (%)',
  set_split_help: 'Los cuatro números deben sumar 100. Estos porcentajes son solo una sugerencia de cómo repartir tu ingreso: el ahorro nunca se guarda solo, siempre anotas tú cuánto ahorraste de verdad en cada ingreso.',
  split_ahorro: 'Ahorro', split_negocio: 'Negocio', split_gastos: 'Gastos', split_familia: 'Familia',
  set_save: 'Guardar ajustes', set_err_sum: 'Los porcentajes deben sumar 100. Ahora suman {total}.', set_saved: 'Ajustes guardados. ✅',
  set_sections_title: 'Secciones visibles', set_sections_help: 'Apaga las que no uses para tener una lista más corta.',
  set_pin_title: 'Seguridad (PIN)',
  pin_status_on: 'Tienes un PIN activo. La app se bloquea al abrirla.', pin_status_off: 'No tienes PIN. Puedes crear uno aquí para proteger tus datos.',
  pin_current_label: 'PIN actual (si ya tienes uno)', pin_new_label: 'PIN nuevo (vacío = quitar el PIN)', pin_update: 'Actualizar PIN',
  pin_err_current: 'El PIN actual no es correcto.', pin_err_format: 'El PIN nuevo debe tener de 4 a 6 números.',
  pin_off: 'PIN desactivado.', pin_updated: 'PIN actualizado. ✅',
  set_data_title: 'Tus datos', set_data_help: 'Tus datos se guardan en este navegador y, si entras con tu cuenta, también en la nube. Exporta una copia si quieres guardarla en otro lugar.',
  data_export: 'Exportar copia (JSON)', data_import: 'Importar copia', data_reset: 'Borrar todos los datos',
  data_err_big: 'Ese archivo es demasiado grande.', data_err_invalid: 'No se pudo importar: el archivo no es una copia válida de PETO Finanzas.',
  import_confirm: 'Importar reemplazará TODOS los datos actuales de la app. ¿Seguro?', import_done: 'Copia importada. ✅',
  reset_confirm1: 'Esto borra TODOS tus datos de la app en este teléfono. No se puede deshacer. ¿Seguro?',
  reset_confirm2: 'Última confirmación: ¿borrar todo y empezar de cero?',
  lock_prompt: 'Escribe tu PIN para entrar.', lock_pin_label: 'PIN', lock_enter: 'Entrar',
  lock_note: 'Tus datos están protegidos con tu PIN.', lock_err: 'PIN incorrecto. Inténtalo de nuevo.',
  ob_title: '¡Bienvenido a PETO Finanzas!',
  ob_intro_1: 'Organiza tu dinero en minutos: gastos, ingresos, presupuesto, cuentas y deudas.',
  ob_intro_2: 'Con tu cuenta en la nube.', ob_intro_3: 'Tus datos se sincronizan con tu teléfono.',
  ob_name_label: '¿Cómo te llamas?', ob_name_ph: 'Tu nombre',
  ob_pin_label: 'Crea un PIN de seguridad (opcional)', ob_pin_ph: '4 a 6 números, o déjalo vacío',
  ob_pin2_label: 'Repite el PIN', ob_pin2_ph: 'Repite el PIN', ob_start: 'Empezar',
  ob_note: 'Podrás cambiar el PIN cuando quieras en Ajustes.',
  ob_tour1_title: 'Anota un gasto en segundos',
  ob_tour1_text: 'Toca el botón +, escribe la cantidad y la categoría. Nada más: tu gasto queda registrado al instante.',
  ob_tour2_title: '¿Cuánto puedes gastar hoy?',
  ob_tour2_text: 'PETO Finanzas reparte tu presupuesto entre los días que quedan del mes y te dice un solo número: lo que puedes gastar hoy sin pasarte.',
  ob_tour3_title: 'Tu cuenta en la nube (opcional)',
  ob_tour3_text: 'Si quieres, crea una cuenta gratis para ver tus datos también en la web. Sin cuenta, todo queda solo en tu teléfono.',
  ob_tour_next: 'Siguiente', ob_tour_skip: 'Saltar', ob_tour_go: '¡Vamos!',
  ob_err_name: 'Escribe tu nombre para empezar.', ob_err_pin_format: 'El PIN debe tener de 4 a 6 números.',
  ob_err_pin_mismatch: 'Los dos PIN no coinciden.',
  set_theme_label: 'Tema', theme_light: 'Claro', theme_dark: 'Oscuro', theme_auto: 'Automático (según el sistema)',
  set_accent_label: 'Color principal', accent_verde: 'Verde', accent_azul: 'Azul', accent_morado: 'Morado', accent_naranja: 'Naranja',
  undo_done: 'Hecho', undo_btn: 'Deshacer', btn_repeat: 'Repetir',
  fab_aria: 'Agregar rápido', quick_title: '¿Qué quieres agregar?',
  quick_expense: '🧾 Gasto', quick_income: '💵 Ingreso', quick_savings: '🐷 Ahorro',
  sec_buscar: 'Buscar movimientos', search_label: 'Buscar', search_ph: 'Nota, categoría o cantidad…',
  search_month_label: 'Mes (vacío = todos)', search_type_label: 'Tipo',
  type_all: 'Todos', type_gastos: 'Gastos', type_ingresos: 'Ingresos', type_ahorros: 'Ahorros',
  search_empty: 'Sin resultados.', search_type_income: 'Ingreso', search_type_saving: 'Ahorro',
  chal_title: '🔥 Reto de ahorro semanal',
  chal_progress: 'Esta semana: {have} de {target}', chal_done: '🎉 ¡Reto de esta semana cumplido!',
  chal_streak_one: 'Racha: 1 semana cumplida', chal_streak_many: 'Racha: {n} semanas cumplidas',
  chal_streak_zero: 'Racha: 0 semanas. ¡Esta puede ser la primera!',
  streak_one: '🔥 1 día seguido anotando', streak_many: '🔥 {n} días seguidos anotando',
  chal_target_label: 'Meta semanal de ahorro ($)', chal_save: 'Guardar meta semanal',
  rep_title: 'Informe del mes', rep_download: 'Descargar imagen', rep_share_image: 'Compartir imagen',
  trend_title: 'Tendencia de gasto', trend_weeks: 'Semanas de este mes', trend_week: 'Semana {n}',
  trend_empty: 'Todavía no hay gastos para mostrar la tendencia.',
  rep_income: 'Ingresos', rep_expenses: 'Gastos', rep_savings: 'Ahorros',
  rep_top_cat: 'Categoría mayor', rep_top3: 'Top 3 categorías', rep_goal: 'Meta de ahorro', rep_none: 'Sin movimientos',
  calc_title: 'Calculadora de deudas',
  calc_intro: 'Compara dos planes para salir de deudas: pagar primero la más pequeña (bola de nieve) o la de mayor interés (avalancha). Cada mes pagas los mínimos de todas y el resto va a la deuda objetivo.',
  calc_budget_label: '¿Cuánto puedes pagar al mes en total a deudas? ($)', calc_run: 'Calcular',
  calc_snowball: 'Bola de nieve (menor saldo primero)', calc_avalanche: 'Avalancha (mayor interés primero)',
  calc_result: '{months} meses para salir · intereses aprox. {interest}',
  calc_months_one: '1 mes para salir · intereses aprox. {interest}',
  calc_order: 'Orden en que se pagan:', calc_free: '¡No tienes deudas pendientes! 🎉',
  calc_warn: 'Con ese pago mensual, alguna deuda nunca se termina: el pago no cubre ni los intereses. Sube el pago mensual.',
  calc_note_zero: 'Las deudas sin pago mínimo o sin interés anotados se calculan con mínimo $0 e interés 0%.',
  calc_err_budget: 'Escribe cuánto puedes pagar al mes.',
  debt_interest_label: 'Interés anual % (opcional)', debt_minpay_label: 'Pago mínimo mensual $ (opcional)',
  debt_terms: 'Interés {pct}% anual · Mínimo {min}/mes',
  exp_photo_label: 'Foto del recibo (opcional)', exp_photo_remove: 'Quitar foto', photo_close: 'Cerrar',
  err_photo_quota: 'No hubo espacio para guardar la foto: el gasto se guardó sin foto.',
  banner_backup: 'Hace tiempo que no guardas una copia de tus datos. Exporta tu respaldo en Ajustes.',
  /* --- Fase 4: PETO Pro, informe avanzado, organizador de san --- */
  pro_title: 'PETO Pro',
  pro_card_text: 'La nube sin límites, el informe avanzado, el presupuesto compartido y el modo organizador de san.',
  pro_status_free: 'Ahora tienes el plan Gratis.',
  pro_status_active: 'Tienes PETO Pro activo. ¡Gracias por apoyar PETO Finanzas! ⭐',
  pro_status_test: 'PETO Pro está abierto durante la prueba cerrada: tienes acceso completo mientras dure la prueba.',
  pro_status_waitlist: 'Estás en la lista de espera de PETO Pro.',
  pro_btn_see: 'Ver PETO Pro',
  pro_wall_title: 'Esto es de PETO Pro ⭐',
  pro_price_line: 'Solo $1.99 al mes',
  pro_benefit_cloud: '☁️ Nube sin límites para tus datos',
  pro_benefit_report: '📊 Informe avanzado: compara meses y exporta en CSV',
  pro_benefit_shared: '🏠 Presupuesto compartido con tu hogar',
  pro_benefit_org: '🤝 Modo organizador de san: la tanda de todo el grupo',
  pro_coming_text: 'La compra dentro de la app llega con el lanzamiento en Google Play. Mientras tanto puedes anotarte en la lista de espera: te avisaremos en cuanto puedas activar Pro por $1.99 al mes.',
  pro_waitlist_btn: 'Anotarme en la lista de espera',
  pro_waitlist_done: 'Ya estás en la lista ✅ Te avisaremos cuando Pro esté disponible.',
  pro_close: 'Ahora no',
  pro_tag: 'PRO',
  adv_title: 'Informe avanzado',
  adv_note: 'Función de PETO Pro: este mes contra el anterior, todas las categorías y exportar el mes en CSV.',
  adv_open_btn: 'Ver informe avanzado',
  adv_export_csv: 'Exportar mes en CSV',
  adv_this_month: 'Este mes',
  adv_prev_month: 'Mes anterior',
  adv_change: 'Cambio',
  adv_all_cats: 'Todas las categorías',
  adv_empty: 'Sin movimientos en estos dos meses.',
  org_title: 'Modo organizador de san',
  org_intro: 'Organiza la tanda de todo el grupo: turnos con fecha, marca quién ya pagó en cada ronda y comparte el estado con el grupo.',
  org_pro_note: 'El modo organizador es una función de PETO Pro.',
  org_form_title: 'Crear san del grupo',
  org_freq_label: 'Frecuencia de las rondas',
  org_freq_semanal: 'Semanal',
  org_freq_quincenal: 'Quincenal (cada 2 semanas)',
  org_freq_mensual: 'Mensual',
  org_start_label: 'Fecha de la primera ronda',
  org_create_btn: 'Crear san organizado',
  org_round: 'Ronda {x} de {n}',
  org_receiver_line: 'Recibe: {name}',
  org_pending_none: '¡Todos pagaron! 🎉',
  org_pending_list: 'Pendientes: {names}',
  org_pending_count_one: 'Queda 1 pendiente',
  org_pending_count_many: 'Quedan {n} pendientes',
  org_totals_title: 'Aportes por participante',
  org_paid_rounds: '{paid} de {n} rondas pagadas',
  org_delete: 'Borrar san organizado',
  org_delete_confirm: '¿Borrar el san organizado «{name}»? Se pierde el registro de pagos del grupo.',
  org_share_title: 'Estado del san',
  shared_live_note: 'Comparte el presupuesto con tu hogar: crea un hogar o únete con un código y verán los mismos miembros. Necesitas tu cuenta en la nube (arriba en Ajustes) y PETO Pro.',
  shared_leave_live: '¿Salir de este hogar? Dejarás de ver su presupuesto compartido.',
  shared_err_login: 'Primero entra con tu cuenta en la nube (arriba, en Ajustes) y vuelve a intentarlo.',
  shared_err_generic: 'No se pudo completar. Revisa tu conexión e inténtalo de nuevo.',
  shared_err_code_live: 'Ese código no existe. Revísalo e inténtalo de nuevo.',
  shared_err_member: 'Ya eres miembro de este hogar.',
  shared_err_owner_leave: 'Eres el dueño/la dueña del hogar: no puedes salir sin borrarlo. Pide a otro miembro que cree el hogar nuevo.',
  shared_created_live: 'Hogar creado ✅ Comparte el código para invitar a tu hogar.',
  shared_joined_live: 'Te uniste al hogar ✅',
  org_comp_label: 'Compensación del organizador',
  org_comp_none: 'Sin compensación',
  org_comp_first: 'El organizador cobra primero',
  org_comp_last: 'El organizador cobra de último',
  org_comp_extra: 'Cuota extra por ronda',
  org_comp_amount_label: 'Cuota extra por persona ($)',
  org_comp_line: 'Compensación del organizador: {mode}',
  org_sim_title: 'Simulación del pote',
  org_sim_pays: 'Cada participante pone por ronda: {amount}',
  org_sim_pot: 'Pote de cada ronda: {amount}',
  org_sim_total_in: 'Total que pone cada quien en todo el san: {amount}',
  org_sim_extra_org: 'El organizador recibe {amount} extra por ronda',
  org_sim_first: 'El organizador recibe el pote de la primera ronda',
  org_sim_last: 'El organizador recibe el pote de la última ronda',
  org_shuffle_btn: '🎲 Sortear orden',
  org_shuffled: '🎲 ¡Orden sorteado! Así quedó el turno.',
  org_shuffle_need: 'Agrega al menos 2 participantes para sortear el orden.',
  org_shuffle_blocked: 'Ya no se puede sortear: el san ya empezó o tiene pagos registrados.',
  org_start_btn: 'Iniciar san',
  org_started_line: 'San en curso · El orden está bloqueado',
  org_order_title: 'Orden de turnos',
  org_move_up: 'Subir',
  org_move_down: 'Bajar',
  org_swap_blocked: 'Ese turno ya tiene pagos y no se puede cambiar.',
  org_history_title: 'Historial de cambios',
  org_history_swap: '{a} y {b} intercambiaron turnos',
  org_history_started: 'El organizador inició el san',
  org_pay_pending: 'Pendiente',
  org_pay_reported: 'Reportado',
  org_pay_confirmed: 'Confirmado',
  org_status_btn: 'Estado: {status}',
  org_receipt_add: '📎 Comprobante',
  org_receipt_view: 'Ver comprobante',
  org_receipt_remove: 'Quitar',
  org_zelle_label: 'Zelle de cada participante (número o correo, opcional)',
  org_zelle_ph: 'Zelle (opcional)',
  org_zelle_line: 'Zelle: {zelle}',
  org_reminder_btn: '📲 Recordatorio por WhatsApp',
  org_reminder_head: '🤝 {san} · Ronda {x} de {n} · {date}',
  org_reminder_receiver: '💰 Esta semana cobra {name}',
  org_reminder_zelle: 'Zelle de {name}: {zelle}',
  org_reminder_amount: 'Aporte de la ronda: {amount}',
  org_antifraud: '🛡️ Un san nunca paga intereses ni más de lo aportado.',
  org_link_btn: '🔗 Enlace de solo lectura',
  org_link_publish: 'Crear enlace',
  org_link_update: 'Actualizar enlace',
  org_link_copied: '¡Enlace copiado!',
  org_link_need_cloud: 'El enlace necesita tu cuenta en la nube: entra en Ajustes y vuelve a intentarlo.',
  org_link_ready: 'San del grupo (solo lectura)',
  org_public_title: 'El enlace está listo para compartir.',
  org_public_updated: 'Actualizado el {date}',
  org_public_notfound: 'Este enlace ya no está disponible.',
  org_pub_pay_btn: 'Ya pagué',
  org_pub_confirm: '¿Ya pagaste tu aporte de esta ronda? El organizador lo confirmará.',
  org_pub_attach: '📎 Adjuntar foto del comprobante (opcional)',
  org_pub_send: 'Enviar reporte',
  org_pub_sent: '¡Listo! Tu pago quedó como reportado.',
  org_pub_reported_note: 'Reportado · esperando confirmación',
  org_pub_err: 'No se pudo enviar. Revisa tu conexión e inténtalo de nuevo.',
  org_pub_err_confirmed: 'Este pago ya fue confirmado por el organizador.',
  org_pub_err_photo: 'La foto es demasiado grande; prueba con una más pequeña.',
  org_penalty_label: 'Regla de atraso',
  org_penalty_none: 'Sin multa',
  org_penalty_fixed: 'Multa fija',
  org_penalty_percent: 'Porcentaje del aporte',
  org_penalty_amount_label: 'Monto de la multa ($)',
  org_penalty_percent_label: 'Porcentaje de multa (%)',
  org_penalty_line_fixed: 'Si alguien se atrasa: multa de {amount}',
  org_penalty_line_percent: 'Si alguien se atrasa: multa de {percent}% del aporte',
  set_news_title: 'Novedades',
  news_c24: 'Compilación 24: tutorial de bienvenida, racha de días anotando, metas de ahorro con barra de progreso y gráfico de tendencia.',
  news_c25: 'Compilación 25: widget en la pantalla de inicio y una app mucho más liviana (de 52 MB a 7 MB).',
  news_c26: 'Compilación 26: widgets en tres tamaños, con opciones por widget y botón para anotar un gasto sin abrir la app.',
  news_c27: 'Compilación 27: la app en 12 idiomas, siguiendo sola el idioma de tu teléfono.',
  news_c28: 'Compilación 28: letra más grande aplicada desde el arranque, esta sección de novedades, repaso del italiano y apertura más rápida.',
  news_c31: 'Compilación 31: el botón o gesto de atrás ahora se mueve dentro de la app: cierra lo que esté abierto y vuelve a la pantalla principal antes de salir.',
  news_c32: 'Compilación 32: la marca ahora se lee «PETO Finanzas» en toda la app (menú, bloqueo y widgets), el san quedó primero en la lista de Inicio, el enlace público del san abre directo en el estado del grupo y los botones del organizador siempre responden con un mensaje claro.',
  news_c33: 'Compilación 33: crear un san ya no puede borrar el que está en curso — si ya hay uno activo, la app lo dice y lo protege (pagos, comprobantes, historial y enlace público) — y la versión web quedó sincronizada con el teléfono.',
  news_c34: 'Compilación 34: nuevo logo de PETO Finanzas — la «P» blanca con barras y flecha en verde suave sobre fondo esmeralda, ya en el icono, la pantalla de bloqueo y toda la app.',
  news_c35: 'Compilación 35: desde el enlace público del san ya puedes reportar tu pago con «Ya pagué» y adjuntar tu comprobante (el organizador lo confirma), el visor se ve con el tema oscuro, la app se refresca deslizando hacia abajo y el lector de PDF ya no confunde los Zelle que envías con ingresos.',
  sec_podcast: 'Podcast',
  key_podcast: 'Finanzas Personales, el podcast',
  pod_hosts: 'con Lucía y Marco',
  pod_desc: 'Dinero sin enredos: consejos prácticos para ahorrar, salir de deudas y cuidar tu bolsillo, en episodios cortos.',
  pod_spotify_btn: 'Escuchar en Spotify',
  pod_loading: 'Cargando episodios…',
  pod_offline: 'Sin conexión: mostrando la última lista descargada',
  pod_error: 'No pudimos cargar los episodios. Revisa tu conexión e inténtalo de nuevo.',
  pod_empty: 'Todavía no hay episodios publicados.',
  pod_play_aria: 'Reproducir',
  pod_pause_aria: 'Pausar',
  pod_audio_error: 'No se pudo reproducir este episodio.',
  pub_tagline: 'El san, organizado y transparente',
  pub_progress: '{x} de {n} pagos confirmados',
  pub_progress_start: 'Recién empieza: todavía no hay pagos confirmados',
  pub_cta_title: '¿Quieres organizar tu propio san?',
  pub_cta_text: 'Con PETO Finanzas llevas el orden, los turnos y los comprobantes en un solo lugar, sin libretas ni enredos.',
  pub_cta_try: 'Probar PETO Finanzas',
  pub_cta_more: 'Conocer más',
  pub_bar_try: 'Probar la app',
  pub_footer: 'Hecho con PETO Finanzas · petofinanzas.com',
  news_c36: 'Compilación 36: nueva sección Podcast — escucha «Finanzas Personales» sin salir de la app, con reproductor integrado y la lista guardada para cuando no hay internet — la bienvenida ahora avanza sola, lámina a lámina — y la vista del enlace renovada: el san se presenta con su avance y acceso directo para probar la app.',
  news_c37: 'Compilación 37: widgets renovados — degradado de marca, barra de avance que cambia de color según tu presupuesto y la línea del próximo turno de tu san — y un widget nuevo del tamaño de un icono, con lo que puedes gastar hoy — y la marca siempre visible al bajar por el enlace público del san — y las rondas del organizador ahora se pliegan en acordeón, con solo la de esta semana abierta.',
  widget_today: 'hoy',
  widget_san_next: 'Próximo turno: {name} · {date}',
  widget_san_next_nodate: 'Próximo turno: {name}',
  back_exit_hint: 'Pulsa atrás otra vez para salir.'
},
en: {
  org_err_san_name: 'Enter the name of the san.', rep_promo_footer: 'Take control of your spending with PETO Finanzas · petofinanzas.com', rep_saved: 'Image saved.', set_sections_summary: '{visible} of {total} visible',
  org_err_active_exists: 'There is already an active san (“{name}”). Delete it first from its card if you want to create another one.',
  app_title: 'PETO Finanzas', back: '← All options', greeting: 'Hello', lock_btn: 'Lock',
  home_menu_heading: 'What do you want to see?',
  group_daily: 'Day to day', group_plan: 'Planning', group_accounts: 'Accounts & commitments', group_yourapp: 'Your app',
  sec_gastos: 'Monthly expenses', sec_ingresos: 'Weekly income', sec_ahorros: 'Savings', sec_resumen: 'Summary',
  sec_presupuesto: 'Budget by category', sec_pagos: 'Fixed payments', sec_cuentas: 'My accounts',
  sec_deudas: 'My debts', sec_san: 'My san (tanda)', sec_ajustes: 'Settings & personalization',
  menu_open_aria: 'Open menu', menu_close_aria: 'Close menu', sec_home: 'Home', key_home: 'Your main screen',
  set_notif_label: 'Notifications when the app is closed', set_notif_help: 'Alerts for your fixed payments the day before and on the day, even when PETO Finanzas is closed.',
  set_autofixed_label: 'Record fixed payments automatically', set_autofixed_help: 'When a fixed payment is due, the expense is recorded for you. You can undo it right away.',
  set_bio_label: 'Fingerprint unlock', set_bio_help: 'Unlock with your fingerprint as well as your PIN (an active PIN is required).',
  bio_btn: '👆 Unlock with fingerprint', bio_reason: 'Confirm it is you to open PETO Finanzas',
  bio_need_pin: 'Fingerprint unlock needs an active PIN: create your PIN in Settings → Security and fingerprint will work when you open the app.',
  bio_failed: 'Fingerprint could not be verified. Type your PIN.',
  bio_unavailable: 'Fingerprint is not available on this phone. Type your PIN.',
  bio_not_enrolled: 'This phone has no fingerprint enrolled. Enroll one in the phone settings or type your PIN.',
  bio_offer_title: 'Unlock with your fingerprint?',
  bio_offer_text: 'You just created your PIN. If you want, you can open PETO Finanzas with your fingerprint instead of typing your PIN every time. Turn it on now?',
  bio_offer_yes: 'Yes, turn on fingerprint',
  bio_offer_no: 'Not now',
  bio_activated: 'Done: fingerprint unlock is now on.',
  fix_auto_suffix: '(automatic fixed payment)',
  backup_pass_label: 'Encrypted backup password', backup_pass_ph: 'At least 4 characters',
  data_export_enc: 'Export encrypted backup',
  backup_help: 'The encrypted backup opens only with your password. Without it, it cannot be recovered: keep it safe. To import an encrypted backup, type its password here before choosing the file.',
  backup_err_short: 'The password needs at least 4 characters.',
  backup_need_pass: 'Type the encrypted backup password before importing it.',
  backup_err_pass: 'Could not open the backup: wrong password or damaged file.',
  share_btn: 'Share summary', share_copied: 'Summary copied. Paste it anywhere.',
  review_title: 'Do you like PETO Finanzas?',
  review_text: 'If PETO Finanzas helps you look after your money, a review on Google Play helps us a lot to reach more people. Thank you!',
  review_yes: '⭐ Rate on Google Play', review_no: 'Not now',
  share_report_title: 'My PETO Finanzas summary',
  notif_fixed_title: 'Fixed payment tomorrow', notif_fixed_today: 'Fixed payment today', notif_fixed_body: '{name} · {amount}',
  notif_weekly_title: 'Your week in PETO Finanzas', notif_weekly_body: 'Log this week’s expenses and income to stay on track.',
  summary_title: 'Daily summary',
  summary_help: 'A heads-up with what you spent yesterday and what you can spend today, at the time you choose.',
  summary_notif_label: 'Summary by notification',
  summary_time_label: 'Summary time',
  summary_email_label: 'Also receive it by email',
  summary_email_help: 'Only with your cloud account active: the same summary also arrives in your email.',
  notif_summary_title: '🌅 Your PETO Finanzas summary',
  notif_summary_body: 'Yesterday you spent {spent} · Today you can spend {daily}',
  notif_summary_body_nodaily: 'Yesterday you spent {spent}',
  sec_remesas: 'Remittances', key_remesas: 'Sent this month: {amount}',
  rem_intro: 'Money you send to your people: how much left in dollars and how much arrived in their currency.',
  rem_usd_label: 'Amount sent ($ USD)', rem_rate_label: 'Rate ({cur} per $1)', rem_recipient_label: 'For whom?',
  rem_currency_label: 'Destination currency', rem_arrives_label: 'Arrives',
  rem_rate_suggested: 'Last rate you used for {cur}: {rate}. It is filled in; change it if today’s is different.',
  rem_month_sent: 'This month you sent {usd}', rem_totals_title: 'Totals by currency (all history)',
  rem_total_row: '{usd} sent → {amount} received · {n} sends',
  rem_save: 'Save remittance', rem_empty: 'No remittances recorded yet.',
  rem_delete_confirm: 'Delete the remittance to {name}?',
  csv_title: 'Import bank statement (CSV)',
  csv_help: 'Upload your bank’s CSV file and review everything in a preview before importing: nothing is saved until you confirm.',
  csv_file_label: 'Bank CSV file', csv_preview_title: 'Import preview',
  csv_summary: '{total} transactions · {dups} duplicates (excluded) · {sel} to import',
  csv_dup_badge: 'Duplicate', csv_income_badge: 'Income', csv_expense_badge: 'Expense',
  csv_all: 'Check all', csv_none: 'Uncheck all',
  csv_apply: 'Import selected', csv_cancel: 'Cancel import',
  csv_done: '{n} transactions imported. ✅',
  csv_none_selected: 'You did not check any transaction to import.',
  csv_err_parse: 'That file could not be read as CSV. Check that it is the bank statement in CSV format.',
  csv_err_headers: 'The date and amount columns were not found in that file.',
  csv_err_big: 'That file is too large to import.',
  csv_err_empty: 'That file has no transactions that can be imported.',
  pdf_err_big: 'That PDF is too large (maximum 8 MB).',
  pdf_err_notext: 'That PDF has no text I can read (it looks like a photo or scan). Try your bank\'s CSV or log the expense with the receipt photo.',
  pdf_err_empty: 'I found no transactions with a date and amount in that PDF. Try your bank\'s CSV.',
  shared_title: 'Shared budget',
  shared_preview_note: '🔧 Design preview: it does not connect to other accounts yet. Use it to try how creating a household, joining with a code and seeing members will look.',
  shared_create_label: 'Household name', shared_create_btn: 'Create household',
  shared_join_label: 'Invite code', shared_join_btn: 'Join with code',
  shared_members_title: 'Members', shared_code_label: 'Invite code: {code}',
  shared_role_dueno: 'Owner', shared_role_admin: 'Admin', shared_role_miembro: 'Member', shared_role_lector: 'Read-only',
  shared_you: 'You', shared_host: 'Host',
  shared_leave_btn: 'Leave household', shared_leave_confirm: 'Leave this household? (preview)',
  shared_err_name: 'Enter a name for the household.', shared_err_code: 'The code has 6 letters or numbers.',
  shared_created: 'Household created (preview). ✅', shared_joined: 'You joined the household (preview). ✅',
  shared_household_fallback: 'Shared household',
  privacy_hide: 'Hide amounts', privacy_show: 'Show amounts',
  ins_title: '💡 Money insights', ins_cat_up: '{cat} is up {pct}% vs last month ({from} → {to}).',
  ins_pace_down: 'You are pacing better: spending is down {pct}% vs last month.',
  ins_pace_up: 'Heads up: your spending pace is up {pct}% vs last month.',
  ins_biggest: 'Your biggest expense this month: {note} · {amount}.', ins_saved: 'You have saved {amount} this month. Keep going!',
  bud_alert_title: 'Budget at risk', bud_alert_warn: '{cat}: you are at {pct}% of the budget.',
  bud_alert_over: '{cat}: you went over budget ({pct}%).',
  voice_btn: '🎤 Dictate', voice_listening: 'Listening… say the amount and what it was for.',
  voice_unavailable: 'Voice is not available on this device.', voice_heard: 'I heard: “{text}”. Check it and save.',
  voice_no_amount: 'I heard: “{text}”, but I could not find the amount.',
  ocr_found: 'I detected {amount} on the receipt. Check it before saving.',
  goals_title: 'More goals', goal2_create: 'Create goal', goal_add: '+ Add', goal_take: '− Take',
  goal_done: '🎉 Goal reached!', goal_move_label: 'Amount', goal_delete_confirm: 'Delete the goal “{name}”?',
  err_limit_goals: 'You already have the maximum number of goals.',
  biz_label: 'This is for my business', biz_title: 'My business this month', biz_income: 'Business income',
  biz_expenses: 'Business expenses', biz_profit: 'Profit', chal_share: 'Share my challenge',
  cloud_title: 'Cloud account',
  cloud_help: 'With an account, your data is also stored in the cloud and synced: switch phones, sign in with your email, and everything is there. Without an account, the app works only on this phone, as always.',
  cloud_email: 'Email', cloud_pass: 'Password',
  cloud_signin: 'Sign in', cloud_signup: 'Create account', cloud_signout: 'Sign out',
  cloud_sync_now: 'Sync now', cloud_wipe: 'Delete my cloud data',
  cloud_who: 'Signed in as {email}', cloud_synced: 'Synced ✓ · {time}',
  cloud_never: 'Not synced yet.', cloud_working: 'Working…',
  cloud_ok_in: 'Welcome back!', cloud_ok_up: 'Account created! Your data is now in the cloud.',
  cloud_err_fields: 'Enter your email and a password of at least 6 characters.',
  cloud_err_login: 'Could not sign in. Check your email and password.',
  cloud_err_exists: 'That email already has an account. Use “Sign in”.',
  cloud_err_confirm: 'Account created. Check your email to confirm your account, then sign in.',
  cloud_err_generic: 'Something failed with the cloud. Check your internet and try again.',
  cloud_conflict: 'The cloud and this phone hold different data. Download the cloud data and replace what is on this phone? (Cancel = upload this phone’s data)',
  cloud_wipe_confirm: 'Delete ALL your cloud data? What is on this phone stays as it is.',
  cloud_delete: 'Delete my account',
  cloud_delete_confirm1: 'Delete your PETO Finanzas account? This deletes your account, your copy of the data in the cloud and the shared households you own. The data on THIS phone stays here, untouched (you can erase it in Settings). This cannot be undone.',
  cloud_delete_confirm2: 'Final confirmation: delete your account for good?',
  cloud_deleted: 'Your account was deleted.',
  cloud_delete_err_auth: 'Your session is no longer valid. Sign in again and try again.',
  cloud_unavailable: 'The cloud is not available in this version.',
  key_settings: 'Name, split, text, sections, PIN',
  footer: 'PETO Web · With your cloud account, your data syncs with your phone',
  tile_available: 'Available money', tile_available_aria: 'Available money: go to My accounts',
  tile_savings: 'Savings this month', tile_savings_aria: 'Savings this month: go to Savings',
  tile_debts: 'Pending debts', tile_debts_aria: 'Pending debts: go to My debts',
  tile_incomes: '💵 Income', tile_incomes_aria: 'Income: go to Weekly income',
  tile_expenses: '🧾 Expenses', tile_expenses_aria: 'Expenses: go to Monthly expenses',
  tile_goal: "Goal '{name}': {pct}%",
  key_spent_month: '{amount} spent this month', key_income_month: '{amount} received this month',
  key_saved_total: '{amount} saved in total', key_goal_suffix: " · Goal '{name}': {pct}%",
  key_budget_one: '{n} category with a limit', key_budget_many: '{n} categories with a limit',
  key_fixed: '{amount} per month · {n} to pay', key_available: 'Available: {amount}', key_debts: '{amount} pending',
  key_san: 'Week {x} of {n} · Up next: {name}', key_san_done: 'San finished 🎉', key_san_none: 'No active san',
  banner_payday: 'Today is payday: log your income and your savings.',
  banner_dues_title: 'Payments due soon:', banner_due_item: '{name} (day {day})', banner_close: 'Dismiss',
  spend_title: 'How much can you spend today?',
  spend_note: 'This is what you can spend today without going over.',
  spend_guide: 'Create your first category budget and you will see here how much you can spend each day.',
  spend_left: 'You have {amount} left for the {days} remaining days of the month.',
  spend_left_one: 'You have {amount} left for today, the last day of the month.',
  spend_over: "You've reached this month's budget.", spend_over_by: "You're over by {amount}.",
  'cat_Renta': 'Rent', 'cat_Comida': 'Food', 'cat_Comida fuera': 'Eating out', 'cat_Gasolina': 'Gas',
  'cat_Transporte': 'Transport', 'cat_Salud': 'Health', 'cat_Ropa': 'Clothing', 'cat_Otros': 'Other',
  btn_cancel: 'Cancel', btn_save: 'Save', btn_edit: 'Edit', btn_delete: 'Delete',
  err_amount: 'Enter a valid amount, greater than $0.', err_amount_generic: 'Enter a valid amount.',
  err_name: 'Enter a name.', chip_paid: 'Paid', chip_pending: 'Pending',
  month_prev_aria: 'Previous month', month_next_aria: 'Next month',
  exp_new: 'New expense', exp_edit: 'Edit expense', exp_total_label: 'Month total:',
  amount_label: 'Amount ($)', category_label: 'Category', date_label: 'Date', note_label: 'Note (optional)',
  exp_note_ph: 'What was it for?', exp_save: 'Save expense',
  exp_empty: 'No expenses this month yet.\nAdd the first one with the form above. 👍',
  exp_delete_confirm: 'Delete this expense of {amount}? Category {cat}, on {date}. Only this expense is deleted.',
  err_category: 'Choose a valid category.', err_limit_expenses: 'You reached the saved expenses limit.',
  inc_intro: 'Savings are never automatic: you enter how much you really saved from each income. The app only suggests an amount based on your Settings percentage.',
  inc_new: 'New income', inc_edit: 'Edit income', inc_note_ph: 'Where did it come from?',
  inc_savings_label: 'Savings ($)', inc_savings_label_sug: 'Savings (suggested: {amount})',
  inc_savings_help: 'A suggestion based on your savings percentage — change it to what you actually saved. You can enter $0.',
  inc_split_line: 'Saved: {sav} · Suggestion: Business {biz} · Expenses {exp} · Family {fam}',
  inc_split_preview: 'Suggested split: Savings {sav} · Business {biz} · Expenses {exp} · Family {fam}. The savings that count are the ones you enter below.',
  inc_save: 'Save income',
  inc_empty: 'No income logged yet.\nAdd your first income and enter how much you saved from it. 💪',
  inc_delete_confirm: 'Delete this income of {amount} from {date}? Its noted savings of {savings} are also deleted.',
  err_inc_savings: 'Enter how much you saved from this income (it can be $0).',
  err_limit_incomes: 'You reached the saved income limit.',
  sav_intro_1: 'Here you see every amount you saved, one by one. You can also add a standalone saving,',
  sav_intro_2: 'not tied to any income', sav_intro_3: ', with the form below. If you delete a saving, only that amount is deleted:',
  sav_intro_4: 'the income stays the same', sav_intro_5: '.',
  sav_total_label: 'Total saved:', sav_month_label: 'Saved this month:',
  sav_form_title: 'Add a saving', sav_note_ph: 'What is this saving for?', sav_save: 'Save saving',
  sav_goal_label: 'Assign to a goal (optional)', sav_goal_none: 'No goal · general savings',
  sav_empty: 'No savings noted yet.\nAdd one with the form above, or note the savings of an income when you log it and it will show up here. 🌱',
  sav_from_title: 'Saving from {date}', sav_from_sub: 'From an income of {amount}',
  sav_manual_title: 'Added saving', sav_manual_sub: 'Manual · added on {date}',
  sav_delete_income_confirm: 'Delete this saving of {amount} from {date}? Only this savings amount is deleted: the income of {income} stays the same.',
  sav_delete_manual_confirm: 'Delete this saving of {amount} from {date}? It is a saving you added by hand in Savings; only this entry is deleted.',
  err_limit_savings: 'You reached the saved savings limit.',
  goal_prompt: 'What are you saving for?', goal_prompt_sub: 'Create a goal and watch your savings get closer to it.',
  goal_form_create: 'Create goal', goal_form_edit: 'Edit goal',
  goal_name_label: 'Goal name', goal_name_ph: 'E.g.: Emergency fund', goal_target_label: 'Goal amount ($)',
  goal_create_btn: 'Create goal', goal_save_btn: 'Save goal',
  goal_progress: "You've saved {have} of {target}", goal_remaining: '{amount} to go', goal_done: '🎉 Goal reached!',
  goal_edit: 'Edit goal', goal_delete: 'Delete goal',
  goal_delete_confirm: 'Delete the goal "{name}"? Your savings are not touched: only the goal is deleted.',
  err_goal_name: 'Enter a name for your goal.',
  res_cats_title: 'Expenses by category', res_summary_title: 'Income vs Expenses vs Savings',
  chart_income: 'Income', chart_expenses: 'Expenses', chart_savings: 'Savings',
  res_cats_empty: 'No expenses this month.', res_summary_empty: 'No activity this month yet.',
  bud_intro: 'Set a monthly limit per category and see how much you have spent.',
  bud_spent_left: 'Spent {spent} of {budget} · {left} left', bud_spent_over: 'Spent {spent} of {budget} · Over by {over}',
  bud_nolimit: 'No limit. Spent this month: {spent}', bud_placeholder: 'Monthly limit $', bud_aria: 'Monthly limit for {cat}',
  bud_delete_cat: 'Delete category',
  bud_delete_cat_confirm: 'Delete the category "{cat}"? Expenses using it will move to "{other}".',
  bud_alert_amount: 'Enter a valid amount for the limit.',
  cat_form_title: 'Custom category', cat_name_label: 'Category name', cat_name_ph: 'E.g.: Pets',
  cat_save: 'Add category', err_cat_name: 'Enter a name for the category.', err_cat_exists: 'That category already exists.',
  fix_intro: 'Payments that repeat every month: rent, phone, subscriptions…',
  fix_new: 'New fixed payment', fix_edit: 'Edit fixed payment', fix_name_ph: 'E.g.: Rent', fix_day_label: 'Day of the month',
  fix_save: 'Save fixed payment', fix_empty: 'No fixed payments yet.',
  fix_sub: 'Day {day} of every month · {month}', fix_mark: 'Mark paid', fix_unmark: 'Unmark',
  fix_delete_confirm: 'Delete the fixed payment "{name}"?', err_day: 'The day must be between 1 and 31.',
  err_limit_fixed: 'You reached the fixed payments limit.',
  acc_new: 'New account', acc_edit: 'Edit account', acc_balance_label: 'Balance ($)',
  acc_name_ph: 'E.g.: Cash, Bank, Savings', acc_save: 'Save account',
  acc_empty: 'No accounts yet.\nAdd one to see your available money in the summary.',
  acc_delete_confirm: 'Delete the account "{name}"?', err_balance: 'Enter a valid balance.',
  err_limit_accounts: 'You reached the accounts limit.',
  debt_new: 'New debt', debt_edit: 'Edit debt', debt_name_ph: 'E.g.: Card, Loan',
  debt_status_label: 'Status', debt_status_pending: 'Pending', debt_status_paid: 'Paid',
  debt_save: 'Save debt', debt_empty: 'No debts logged. 🎉',
  debt_mark_paid: 'Mark paid', debt_mark_pending: 'Mark pending',
  debt_delete_confirm: 'Delete the debt "{name}"?', err_limit_debts: 'You reached the debts limit.',
  name_label: 'Name',
  san_intro: 'A san (tanda) is a savings circle: every week everyone contributes and one person receives the pot, in turns.',
  san_form_title: 'Create a san', san_name_label: 'San name', san_name_ph: 'E.g.: Family san',
  san_aporte_label: 'Contribution per turn ($)', san_participants_label: 'Participants (in turn order)',
  san_pname_ph: "Participant's name", san_add_participant: 'Add', san_create_btn: 'Create san',
  san_err_participants: 'Add at least 2 participants.', san_err_dup: 'That participant is already on the list.',
  san_err_active_exists: 'There is already a san in progress (“{name}”). Delete it first if you want to create another one.',
  san_err_pname: "Enter the participant's name.", san_remove: 'Remove', san_draft_empty: 'No participants added yet.',
  san_week: 'Week {x} of {n}', san_finished: '🎉 San finished!',
  san_finished_note: 'All weeks are complete. You can delete this san and create a new one.',
  san_total_line: 'Total collected: {amount}', san_week_collected: 'Collected this week: {amount} of {target}',
  san_receiver_line: 'Up next: {name}', san_aporte_line: 'Contribution per turn: {amount}',
  san_paid_title: 'Who has paid this week?', san_paid: 'paid',
  san_advance: 'Mark week complete', san_delete: 'Delete san',
  san_delete_confirm: 'Delete the san "{name}"? Its week and payment records are deleted.',
  san_new_btn: 'Create a new san', san_new_confirm: 'The current san is finished. Delete it and create a new one?',
  set_profile: 'Your profile', set_name_label: 'Your name', set_textsize_label: 'Text size',
  textsize_normal: 'Normal', textsize_large: 'Large', set_lang_label: 'Language / Idioma', lang_auto: 'Automatic (phone language)',
  set_reminders_title: 'Reminders', set_payday_label: 'Payday', set_reminders_label: 'Reminders on Home',
  wd_none: 'No payday', wd_0: 'Sunday', wd_1: 'Monday', wd_2: 'Tuesday', wd_3: 'Wednesday', wd_4: 'Thursday', wd_5: 'Friday', wd_6: 'Saturday',
  set_split_title: 'Suggested income split (%)',
  set_split_help: 'The four numbers must add up to 100. These percentages are only a suggestion for splitting your income: savings are never saved automatically — you always enter how much you really saved from each income.',
  split_ahorro: 'Savings', split_negocio: 'Business', split_gastos: 'Expenses', split_familia: 'Family',
  set_save: 'Save settings', set_err_sum: 'The percentages must add up to 100. They now add up to {total}.', set_saved: 'Settings saved. ✅',
  set_sections_title: 'Visible sections', set_sections_help: 'Turn off the ones you do not use to keep a shorter list.',
  set_pin_title: 'Security (PIN)',
  pin_status_on: 'You have an active PIN. The app locks when opened.', pin_status_off: 'You have no PIN. You can create one here to protect your data.',
  pin_current_label: 'Current PIN (if you have one)', pin_new_label: 'New PIN (empty = remove the PIN)', pin_update: 'Update PIN',
  pin_err_current: 'The current PIN is not correct.', pin_err_format: 'The new PIN must be 4 to 6 digits.',
  pin_off: 'PIN disabled.', pin_updated: 'PIN updated. ✅',
  set_data_title: 'Your data', set_data_help: 'Your data is stored in this browser and, if you sign in, also in the cloud. Export a backup if you want to keep it somewhere else.',
  data_export: 'Export backup (JSON)', data_import: 'Import backup', data_reset: 'Delete all data',
  data_err_big: 'That file is too large.', data_err_invalid: 'Could not import: the file is not a valid PETO Finanzas backup.',
  import_confirm: 'Importing will replace ALL current app data. Are you sure?', import_done: 'Backup imported. ✅',
  reset_confirm1: 'This deletes ALL your app data on this phone. It cannot be undone. Are you sure?',
  reset_confirm2: 'Final confirmation: delete everything and start over?',
  lock_prompt: 'Enter your PIN to continue.', lock_pin_label: 'PIN', lock_enter: 'Unlock',
  lock_note: 'Your data is protected with your PIN.', lock_err: 'Incorrect PIN. Try again.',
  ob_title: 'Welcome to PETO Finanzas!',
  ob_intro_1: 'Organize your money in minutes: expenses, income, budget, accounts and debts.',
  ob_intro_2: 'With your cloud account.', ob_intro_3: 'Your data syncs with your phone.',
  ob_name_label: 'What is your name?', ob_name_ph: 'Your name',
  ob_pin_label: 'Create a security PIN (optional)', ob_pin_ph: '4 to 6 digits, or leave it empty',
  ob_pin2_label: 'Repeat the PIN', ob_pin2_ph: 'Repeat the PIN', ob_start: 'Get started',
  ob_note: 'You can change the PIN anytime in Settings.',
  ob_tour1_title: 'Log an expense in seconds',
  ob_tour1_text: 'Tap the + button, enter the amount and the category. That is all: your expense is saved right away.',
  ob_tour2_title: 'How much can you spend today?',
  ob_tour2_text: 'PETO Finanzas spreads your budget across the days left in the month and tells you one single number: what you can spend today without going over.',
  ob_tour3_title: 'Your cloud account (optional)',
  ob_tour3_text: 'If you want, create a free account to see your data on the web too. Without an account, everything stays only on your phone.',
  ob_tour_next: 'Next', ob_tour_skip: 'Skip', ob_tour_go: 'Let’s go!',
  ob_err_name: 'Enter your name to get started.', ob_err_pin_format: 'The PIN must be 4 to 6 digits.',
  ob_err_pin_mismatch: 'The two PINs do not match.',
  set_theme_label: 'Theme', theme_light: 'Light', theme_dark: 'Dark', theme_auto: 'Automatic (system)',
  set_accent_label: 'Main color', accent_verde: 'Green', accent_azul: 'Blue', accent_morado: 'Purple', accent_naranja: 'Orange',
  undo_done: 'Done', undo_btn: 'Undo', btn_repeat: 'Repeat',
  fab_aria: 'Quick add', quick_title: 'What do you want to add?',
  quick_expense: '🧾 Expense', quick_income: '💵 Income', quick_savings: '🐷 Saving',
  sec_buscar: 'Search activity', search_label: 'Search', search_ph: 'Note, category or amount…',
  search_month_label: 'Month (empty = all)', search_type_label: 'Type',
  type_all: 'All', type_gastos: 'Expenses', type_ingresos: 'Income', type_ahorros: 'Savings',
  search_empty: 'No results.', search_type_income: 'Income', search_type_saving: 'Saving',
  chal_title: '🔥 Weekly savings challenge',
  chal_progress: 'This week: {have} of {target}', chal_done: '🎉 This week\'s challenge is complete!',
  chal_streak_one: 'Streak: 1 week completed', chal_streak_many: 'Streak: {n} weeks completed',
  chal_streak_zero: 'Streak: 0 weeks. This can be the first!',
  streak_one: '🔥 1 day logging in a row', streak_many: '🔥 {n} days logging in a row',
  chal_target_label: 'Weekly savings target ($)', chal_save: 'Save weekly target',
  rep_title: 'Monthly report', rep_download: 'Download image', rep_share_image: 'Share image',
  trend_title: 'Spending trend', trend_weeks: 'Weeks in this month', trend_week: 'Week {n}',
  trend_empty: 'No expenses yet to show the trend.',
  rep_income: 'Income', rep_expenses: 'Expenses', rep_savings: 'Savings',
  rep_top_cat: 'Top category', rep_top3: 'Top 3 categories', rep_goal: 'Savings goal', rep_none: 'No activity',
  calc_title: 'Debt payoff calculator',
  calc_intro: 'Compare two plans to get out of debt: pay the smallest first (snowball) or the highest interest first (avalanche). Each month you pay every minimum and the rest goes to the target debt.',
  calc_budget_label: 'How much can you pay per month toward debts in total? ($)', calc_run: 'Calculate',
  calc_snowball: 'Snowball (smallest balance first)', calc_avalanche: 'Avalanche (highest interest first)',
  calc_result: '{months} months to be debt-free · approx. interest {interest}',
  calc_months_one: '1 month to be debt-free · approx. interest {interest}',
  calc_order: 'Payoff order:', calc_free: 'You have no pending debts! 🎉',
  calc_warn: 'With that monthly payment, some debt never gets paid off: the payment does not even cover the interest. Raise the monthly payment.',
  calc_note_zero: 'Debts without a noted minimum payment or interest are calculated with a $0 minimum and 0% interest.',
  calc_err_budget: 'Enter how much you can pay per month.',
  debt_interest_label: 'Annual interest % (optional)', debt_minpay_label: 'Monthly minimum payment $ (optional)',
  debt_terms: '{pct}% annual interest · Minimum {min}/month',
  exp_photo_label: 'Receipt photo (optional)', exp_photo_remove: 'Remove photo', photo_close: 'Close',
  err_photo_quota: 'There was no room to store the photo: the expense was saved without it.',
  banner_backup: 'It has been a while since you saved a backup of your data. Export your backup in Settings.',
  /* --- Phase 4: PETO Pro, advanced report, san organizer --- */
  pro_title: 'PETO Pro',
  pro_card_text: 'Unlimited cloud for your data, the advanced report, the shared budget and the san organizer mode.',
  pro_status_free: 'You are on the Free plan right now.',
  pro_status_active: 'PETO Pro is active. Thanks for supporting PETO Finanzas! ⭐',
  pro_status_test: 'PETO Pro is open during the closed test: you have full access while the test lasts.',
  pro_status_waitlist: 'You are on the PETO Pro waiting list.',
  pro_btn_see: 'See PETO Pro',
  pro_wall_title: 'This is a PETO Pro feature ⭐',
  pro_price_line: 'Only $1.99 a month',
  pro_benefit_cloud: '☁️ Unlimited cloud for your data',
  pro_benefit_report: '📊 Advanced report: compare months and export CSV',
  pro_benefit_shared: '🏠 Shared budget with your household',
  pro_benefit_org: '🤝 San organizer mode: the whole group’s tanda',
  pro_coming_text: 'In-app purchase arrives with the Google Play launch. Meanwhile you can join the waiting list: we will let you know as soon as you can turn on Pro for $1.99 a month.',
  pro_waitlist_btn: 'Join the waiting list',
  pro_waitlist_done: 'You are on the list ✅ We will let you know when Pro is available.',
  pro_close: 'Not now',
  pro_tag: 'PRO',
  adv_title: 'Advanced report',
  adv_note: 'A PETO Pro feature: this month vs the previous one, every category and a CSV export of the month.',
  adv_open_btn: 'View advanced report',
  adv_export_csv: 'Export month as CSV',
  adv_this_month: 'This month',
  adv_prev_month: 'Previous month',
  adv_change: 'Change',
  adv_all_cats: 'All categories',
  adv_empty: 'No activity in these two months.',
  org_title: 'San organizer mode',
  org_intro: 'Run the whole group’s tanda: dated turns, mark who has paid in each round and share the status with the group.',
  org_pro_note: 'Organizer mode is a PETO Pro feature.',
  org_form_title: 'Create the group san',
  org_freq_label: 'Round frequency',
  org_freq_semanal: 'Weekly',
  org_freq_quincenal: 'Every 2 weeks',
  org_freq_mensual: 'Monthly',
  org_start_label: 'Date of the first round',
  org_create_btn: 'Create organized san',
  org_round: 'Round {x} of {n}',
  org_receiver_line: 'Receives: {name}',
  org_pending_none: 'Everyone has paid! 🎉',
  org_pending_list: 'Still to pay: {names}',
  org_pending_count_one: '1 still to pay',
  org_pending_count_many: '{n} still to pay',
  org_totals_title: 'Contributions per participant',
  org_paid_rounds: '{paid} of {n} rounds paid',
  org_delete: 'Delete organized san',
  org_delete_confirm: 'Delete the organized san “{name}”? The group’s payment record will be lost.',
  org_share_title: 'San status',
  shared_live_note: 'Share the budget with your household: create a household or join with a code and you will see the same members. You need your cloud account (above, in Settings) and PETO Pro.',
  shared_leave_live: 'Leave this household? You will stop seeing its shared budget.',
  shared_err_login: 'First sign in with your cloud account (above, in Settings) and try again.',
  shared_err_generic: 'It could not be completed. Check your connection and try again.',
  shared_err_code_live: 'That code does not exist. Check it and try again.',
  shared_err_member: 'You are already a member of this household.',
  shared_err_owner_leave: 'You own this household: you cannot leave without deleting it. Ask another member to create the new household.',
  shared_created_live: 'Household created ✅ Share the code to invite your household.',
  shared_joined_live: 'You joined the household ✅',
  org_comp_label: 'Organizer compensation',
  org_comp_none: 'No compensation',
  org_comp_first: 'The organizer collects first',
  org_comp_last: 'The organizer collects last',
  org_comp_extra: 'Extra fee per round',
  org_comp_amount_label: 'Extra fee per person ($)',
  org_comp_line: 'Organizer compensation: {mode}',
  org_sim_title: 'Pot simulation',
  org_sim_pays: 'Each participant puts in per round: {amount}',
  org_sim_pot: 'Pot each round: {amount}',
  org_sim_total_in: 'Total each person puts in over the whole san: {amount}',
  org_sim_extra_org: 'The organizer receives an extra {amount} per round',
  org_sim_first: 'The organizer receives the first round’s pot',
  org_sim_last: 'The organizer receives the last round’s pot',
  org_shuffle_btn: '🎲 Shuffle the order',
  org_shuffled: '🎲 Order shuffled! This is the new turn order.',
  org_shuffle_need: 'Add at least 2 participants to shuffle the order.',
  org_shuffle_blocked: 'Shuffling is no longer possible: the san has started or already has payments.',
  org_start_btn: 'Start the san',
  org_started_line: 'San in progress · The order is locked',
  org_order_title: 'Turn order',
  org_move_up: 'Move up',
  org_move_down: 'Move down',
  org_swap_blocked: 'That turn already has payments and cannot be changed.',
  org_history_title: 'Change history',
  org_history_swap: '{a} and {b} swapped turns',
  org_history_started: 'The organizer started the san',
  org_pay_pending: 'Pending',
  org_pay_reported: 'Reported',
  org_pay_confirmed: 'Confirmed',
  org_status_btn: 'Status: {status}',
  org_receipt_add: '📎 Receipt',
  org_receipt_view: 'View receipt',
  org_receipt_remove: 'Remove',
  org_zelle_label: 'Each participant’s Zelle (number or email, optional)',
  org_zelle_ph: 'Zelle (optional)',
  org_zelle_line: 'Zelle: {zelle}',
  org_reminder_btn: '📲 WhatsApp reminder',
  org_reminder_head: '🤝 {san} · Round {x} of {n} · {date}',
  org_reminder_receiver: '💰 This week {name} collects',
  org_reminder_zelle: '{name}’s Zelle: {zelle}',
  org_reminder_amount: 'Round contribution: {amount}',
  org_antifraud: '🛡️ A san never pays interest or more than what was put in.',
  org_link_btn: '🔗 Read-only link',
  org_link_publish: 'Create link',
  org_link_update: 'Update link',
  org_link_copied: 'Link copied!',
  org_link_need_cloud: 'The link needs your cloud account: sign in under Settings and try again.',
  org_link_ready: 'Group san (read-only)',
  org_public_title: 'The link is ready to share.',
  org_public_updated: 'Updated on {date}',
  org_public_notfound: 'This link is no longer available.',
  org_pub_pay_btn: 'I paid',
  org_pub_confirm: 'Did you already pay your share for this round? The organizer will confirm it.',
  org_pub_attach: '📎 Attach receipt photo (optional)',
  org_pub_send: 'Send report',
  org_pub_sent: 'Done! Your payment was reported.',
  org_pub_reported_note: 'Reported · awaiting confirmation',
  org_pub_err: 'Could not send. Check your connection and try again.',
  org_pub_err_confirmed: 'This payment was already confirmed by the organizer.',
  org_pub_err_photo: 'That photo is too large; try a smaller one.',
  org_penalty_label: 'Late rule',
  org_penalty_none: 'No penalty',
  org_penalty_fixed: 'Fixed penalty',
  org_penalty_percent: 'Percentage of the contribution',
  org_penalty_amount_label: 'Penalty amount ($)',
  org_penalty_percent_label: 'Penalty percentage (%)',
  org_penalty_line_fixed: 'If someone is late: {amount} penalty',
  org_penalty_line_percent: 'If someone is late: {percent}% of the contribution penalty',
  set_news_title: 'What’s new',
  news_c24: 'Build 24: welcome tour, recording streak, savings goals with progress bars and a trend chart.',
  news_c25: 'Build 25: home-screen widget and a much lighter app (from 52 MB down to 7 MB).',
  news_c26: 'Build 26: widgets in three sizes, with per-widget options and a button to log an expense without opening the app.',
  news_c27: 'Build 27: the app in 12 languages, automatically following your phone’s language.',
  news_c28: 'Build 28: larger text applied from startup, this what’s-new section, a review of the Italian texts and a faster start.',
  news_c31: 'Build 31: the back button or gesture now moves inside the app: it closes whatever is open and returns to the main screen before exiting.',
  news_c32: 'Build 32: the brand now reads “PETO Finanzas” across the app (menu, lock screen and widgets), the san moved to the top of the Home list, the public san link opens straight into the group status, and the organizer buttons always answer with a clear message.',
  news_c33: 'Build 33: creating a san can no longer erase the one in progress — if one is already active, the app says so and protects it (payments, receipts, history and public link) — and the web version is now in sync with the phone.',
  news_c34: 'Build 34: new PETO Finanzas logo — the white “P” with bars and arrow in soft green on an emerald background, now on the icon, the lock screen and across the app.',
  news_c35: 'Build 35: from the public san link you can now report your payment with “I paid” and attach your receipt (the organizer confirms it), the viewer uses the dark theme, the app refreshes by pulling down, and the PDF reader no longer mistakes Zelle payments you send for income.',
  sec_podcast: 'Podcast',
  key_podcast: 'Finanzas Personales, the podcast',
  pod_hosts: 'with Lucía and Marco',
  pod_desc: 'Money without the mess: practical tips to save, get out of debt and look after your wallet, in short episodes.',
  pod_spotify_btn: 'Listen on Spotify',
  pod_loading: 'Loading episodes…',
  pod_offline: 'No connection: showing the last downloaded list',
  pod_error: 'We could not load the episodes. Check your connection and try again.',
  pod_empty: 'No episodes published yet.',
  pod_play_aria: 'Play',
  pod_pause_aria: 'Pause',
  pod_audio_error: 'This episode could not be played.',
  pub_tagline: 'Your san, organized and transparent',
  pub_progress: '{x} of {n} payments confirmed',
  pub_progress_start: 'Just getting started: no payments confirmed yet',
  pub_cta_title: 'Want to organize your own san?',
  pub_cta_text: 'With PETO Finanzas you keep the order, the turns and the receipts in one place — no notebooks, no mess.',
  pub_cta_try: 'Try PETO Finanzas',
  pub_cta_more: 'Learn more',
  pub_bar_try: 'Try the app',
  pub_footer: 'Made with PETO Finanzas · petofinanzas.com',
  news_c36: 'Build 36: new Podcast section — listen to “Finanzas Personales” without leaving the app, with a built-in player and the list saved for when there is no internet — the welcome now moves on its own, slide by slide — and the link view, renewed: the san is showcased with its progress and a direct way to try the app.',
  news_c37: 'Build 37: redesigned widgets — brand gradient, a progress bar that changes color with your budget and your san’s next-turn line — plus a brand-new app-icon-sized widget with what you can spend today — and the brand stays in view as you scroll the public san link — and the organizer’s rounds now fold into an accordion, with only this week’s open.',
  widget_today: 'today',
  widget_san_next: 'Next turn: {name} · {date}',
  widget_san_next_nodate: 'Next turn: {name}',
  back_exit_hint: 'Press back again to exit.'
},
it: {
  org_err_san_name: 'Scrivi il nome del san.', rep_promo_footer: 'Controlla le tue spese con PETO Finanzas · petofinanzas.com', rep_saved: 'Immagine salvata.', set_sections_summary: '{visible} di {total} visibili',
  org_err_active_exists: 'C’è già un san attivo («{name}»). Eliminalo prima dalla sua scheda se vuoi crearne un altro.',
  app_title: 'PETO Finanzas',
  back: '← Tutte le opzioni',
  greeting: 'Ciao',
  lock_btn: 'Blocca',
  home_menu_heading: 'Cosa vuoi vedere?',
  group_daily: 'Giorno per giorno',
  group_plan: 'Pianificazione',
  group_accounts: 'Conti e impegni',
  group_yourapp: 'La tua app',
  sec_gastos: 'Spese del mese',
  sec_ingresos: 'Entrate settimanali',
  sec_ahorros: 'Risparmi',
  sec_resumen: 'Riepilogo',
  sec_presupuesto: 'Budget per categoria',
  sec_pagos: 'Pagamenti fissi',
  sec_cuentas: 'I miei conti',
  sec_deudas: 'I miei debiti',
  sec_san: 'Il mio san',
  sec_ajustes: 'Impostazioni e personalizzazione',
  menu_open_aria: 'Apri il menu',
  menu_close_aria: 'Chiudi il menu',
  sec_home: 'Home',
  key_home: 'La tua schermata principale',
  set_notif_label: 'Notifiche con l’app chiusa',
  set_notif_help: 'Avvisi dei tuoi pagamenti fissi un giorno prima e lo stesso giorno, anche se PETO Finanzas è chiusa.',
  set_autofixed_label: 'Registra i pagamenti fissi automaticamente',
  set_autofixed_help: 'Quando un pagamento fisso scade, la spesa si registra da sola. Puoi annullarla subito.',
  set_bio_label: 'Sblocca con l’impronta digitale',
  set_bio_help: 'Entra con la tua impronta digitale oltre al PIN (devi avere un PIN attivo).',
  bio_btn: '👆 Entra con l’impronta digitale',
  bio_reason: 'Conferma che sei tu per aprire PETO Finanzas',
  bio_need_pin: 'L’impronta ha bisogno di un PIN attivo: crea il tuo PIN in Impostazioni → Sicurezza e poi l’impronta funzionerà all’apertura dell’app.',
  bio_failed: 'Non è stato possibile verificare l’impronta. Inserisci il PIN.',
  bio_unavailable: 'L’impronta non è disponibile su questo telefono. Inserisci il PIN.',
  bio_not_enrolled: 'Questo telefono non ha nessuna impronta registrata. Registrala nelle impostazioni del telefono o inserisci il PIN.',
  bio_offer_title: 'Sbloccare con l’impronta digitale?',
  bio_offer_text: 'Hai appena creato il tuo PIN. Se vuoi, puoi entrare in PETO Finanzas con l’impronta invece di digitare il PIN ogni volta. Lo attiviamo ora?',
  bio_offer_yes: 'Sì, attiva l’impronta',
  bio_offer_no: 'Non ora',
  bio_activated: 'Fatto: lo sblocco con l’impronta è attivo.',
  fix_auto_suffix: '(pagamento fisso automatico)',
  backup_pass_label: 'Password della copia crittografata',
  backup_pass_ph: 'Minimo 4 caratteri',
  data_export_enc: 'Esporta copia crittografata',
  backup_help: 'La copia crittografata si apre solo con la tua password. Senza di essa non si può recuperare: conservala bene. Per importare una copia crittografata, scrivi qui la sua password prima di scegliere il file.',
  backup_err_short: 'La password deve avere almeno 4 caratteri.',
  backup_need_pass: 'Scrivi la password della copia crittografata prima di importarla.',
  backup_err_pass: 'Non è stato possibile aprire la copia: password errata o file danneggiato.',
  share_btn: 'Condividi il riepilogo',
  share_copied: 'Riepilogo copiato. Incollalo dove vuoi.',
  review_title: 'Ti piace PETO Finanzas?',
  review_text: 'Se PETO Finanzas ti aiuta a prenderti cura dei tuoi soldi, una recensione su Google Play ci aiuta moltissimo a raggiungere più persone. Grazie!',
  review_yes: '⭐ Valuta su Google Play',
  review_no: 'Non ora',
  share_report_title: 'Il mio riepilogo di PETO Finanzas',
  notif_fixed_title: 'Pagamento fisso domani',
  notif_fixed_today: 'Pagamento fisso oggi',
  notif_fixed_body: '{name} · {amount}',
  notif_weekly_title: 'La tua settimana su PETO Finanzas',
  notif_weekly_body: 'Registra le spese e le entrate della settimana per non perdere il filo.',
  summary_title: 'Riepilogo giornaliero',
  summary_help: 'Un avviso con quanto hai speso ieri e quanto puoi spendere oggi, all’ora che scegli.',
  summary_notif_label: 'Riepilogo tramite notifica',
  summary_time_label: 'Ora del riepilogo',
  summary_email_label: 'Ricevilo anche via email',
  summary_email_help: 'Solo con il tuo account cloud attivo: lo stesso riepilogo arriva anche nella tua email.',
  notif_summary_title: '🌅 Il tuo riepilogo di PETO Finanzas',
  notif_summary_body: 'Ieri hai speso {spent} · Oggi puoi spendere {daily}',
  notif_summary_body_nodaily: 'Ieri hai speso {spent}',
  sec_remesas: 'Rimesse',
  key_remesas: 'Inviato questo mese: {amount}',
  rem_intro: 'I soldi che mandi ai tuoi cari: quanto è uscito in dollari e quanto è arrivato nella loro valuta.',
  rem_usd_label: 'Importo inviato ($ USD)',
  rem_rate_label: 'Tasso ({cur} per 1 $)',
  rem_recipient_label: 'Per chi è?',
  rem_currency_label: 'Valuta di destinazione',
  rem_arrives_label: 'Arriva',
  rem_rate_suggested: 'Ultimo tasso che hai usato per {cur}: {rate}. È già impostato; cambialo se oggi è diverso.',
  rem_month_sent: 'Questo mese hai inviato {usd}',
  rem_totals_title: 'Totali per valuta (tutta la cronologia)',
  rem_total_row: '{usd} inviati → {amount} ricevuti · {n} invii',
  rem_save: 'Salva rimessa',
  rem_empty: 'Non hai rimesse registrate.',
  rem_delete_confirm: 'Eliminare la rimessa a {name}?',
  csv_title: 'Importa estratto conto (CSV)',
  csv_help: 'Carica il file CSV della tua banca e controlla tutto in un’anteprima prima di importare: niente viene salvato finché non confermi.',
  csv_file_label: 'File CSV della banca',
  csv_preview_title: 'Anteprima dell’importazione',
  csv_summary: '{total} movimenti · {dups} duplicati (esclusi) · {sel} da importare',
  csv_dup_badge: 'Duplicato',
  csv_income_badge: 'Entrata',
  csv_expense_badge: 'Spesa',
  csv_all: 'Seleziona tutti',
  csv_none: 'Deseleziona tutti',
  csv_apply: 'Importa i selezionati',
  csv_cancel: 'Annulla importazione',
  csv_done: 'Sono stati importati {n} movimenti. ✅',
  csv_none_selected: 'Non hai selezionato nessun movimento da importare.',
  csv_err_parse: 'Non è stato possibile leggere quel file come CSV. Controlla che sia l’estratto conto in formato CSV.',
  csv_err_headers: 'Non ho trovato le colonne di data e importo in quel file.',
  csv_err_big: 'Quel file è troppo grande per essere importato.',
  csv_err_empty: 'Quel file non contiene movimenti importabili.',
  pdf_err_big: 'Quel PDF è troppo grande (massimo 8 MB).',
  pdf_err_notext: 'Quel PDF non ha testo leggibile (sembra una foto o una scansione). Prova con il CSV della banca o registra la spesa con la foto dello scontrino.',
  pdf_err_empty: 'Non ho trovato movimenti con data e importo in quel PDF. Prova con il CSV della banca.',
  shared_title: 'Budget condiviso',
  shared_preview_note: '🔧 Anteprima del design: non si collega ancora ad altri account. Serve per provare come sarà creare una casa, unirsi con un codice e vedere i membri.',
  shared_create_label: 'Nome della casa',
  shared_create_btn: 'Crea casa',
  shared_join_label: 'Codice di invito',
  shared_join_btn: 'Unisciti con codice',
  shared_members_title: 'Membri',
  shared_code_label: 'Codice per invitare: {code}',
  shared_role_dueno: 'Proprietario/a',
  shared_role_admin: 'Amministratore',
  shared_role_miembro: 'Membro',
  shared_role_lector: 'Solo lettura',
  shared_you: 'Tu',
  shared_host: 'Ospitante',
  shared_leave_btn: 'Lascia la casa',
  shared_leave_confirm: 'Lasciare questa casa? (anteprima)',
  shared_err_name: 'Scrivi un nome per la casa.',
  shared_err_code: 'Il codice ha 6 lettere o numeri.',
  shared_created: 'Casa creata (anteprima). ✅',
  shared_joined: 'Ti sei unito alla casa (anteprima). ✅',
  shared_household_fallback: 'Casa condivisa',
  privacy_hide: 'Nascondi importi',
  privacy_show: 'Mostra importi',
  ins_title: '💡 Idee per i tuoi soldi',
  ins_cat_up: '{cat} è salita del {pct}% rispetto al mese scorso ({from} → {to}).',
  ins_pace_down: 'Stai spendendo più lentamente: il tuo ritmo di spesa è sceso del {pct}% rispetto al mese scorso.',
  ins_pace_up: 'Attenzione: il tuo ritmo di spesa è salito del {pct}% rispetto al mese scorso.',
  ins_biggest: 'La tua spesa più grande del mese: {note} · {amount}.',
  ins_saved: 'Hai risparmiato {amount} questo mese. Continua così!',
  bud_alert_title: 'Budget a rischio',
  bud_alert_warn: '{cat}: sei al {pct}% del budget.',
  bud_alert_over: '{cat}: hai superato il budget ({pct}%).',
  voice_btn: '🎤 Detta',
  voice_listening: 'In ascolto… dì l’importo e per cosa è stato.',
  voice_unavailable: 'La voce non è disponibile su questo dispositivo.',
  voice_heard: 'Ho sentito: «{text}». Controlla e salva.',
  voice_no_amount: 'Ho sentito: «{text}», ma non ho trovato l’importo.',
  ocr_found: 'Ho rilevato {amount} nello scontrino. Verificalo prima di salvare.',
  goals_title: 'Altri obiettivi',
  goal2_create: 'Crea obiettivo',
  goal_add: '+ Versa',
  goal_take: '− Preleva',
  goal_done: '🎉 Obiettivo raggiunto!',
  goal_move_label: 'Importo',
  goal_delete_confirm: 'Eliminare l’obiettivo "{name}"? I tuoi risparmi non vengono toccati: si elimina solo l’obiettivo.',
  err_limit_goals: 'Hai già il massimo di obiettivi.',
  biz_label: 'È per la mia attività',
  biz_title: 'La mia attività questo mese',
  biz_income: 'Entrate dell’attività',
  biz_expenses: 'Spese dell’attività',
  biz_profit: 'Guadagno',
  chal_share: 'Condividi la mia sfida',
  cloud_title: 'Account nel cloud',
  cloud_help: 'Con un account, i tuoi dati si salvano anche nel cloud e si sincronizzano: se cambi telefono, accedi con la tua email e trovi tutto lì. Senza account, l’app funziona solo su questo telefono, come sempre.',
  cloud_email: 'Email',
  cloud_pass: 'Password',
  cloud_signin: 'Accedi',
  cloud_signup: 'Crea account',
  cloud_signout: 'Esci',
  cloud_sync_now: 'Sincronizza ora',
  cloud_wipe: 'Elimina i miei dati dal cloud',
  cloud_who: 'Accesso effettuato come {email}',
  cloud_synced: 'Sincronizzato ✓ · {time}',
  cloud_never: 'Non è ancora stato sincronizzato.',
  cloud_working: 'In corso…',
  cloud_ok_in: 'Bentornato!',
  cloud_ok_up: 'Account creato! I tuoi dati sono già nel cloud.',
  cloud_err_fields: 'Scrivi la tua email e una password di almeno 6 caratteri.',
  cloud_err_login: 'Non è stato possibile accedere. Controlla email e password.',
  cloud_err_exists: 'Questa email ha già un account. Usa «Accedi».',
  cloud_err_confirm: 'Account creato. Controlla la tua email e conferma l’account, poi accedi.',
  cloud_err_generic: 'Qualcosa è andato storto con il cloud. Controlla la connessione e riprova.',
  cloud_conflict: 'Ci sono dati diversi nel cloud e su questo telefono. Vuoi scaricare quelli del cloud e sostituire quelli di questo telefono? (Annulla = carica quelli di questo telefono)',
  cloud_wipe_confirm: 'Eliminare TUTTI i tuoi dati dal cloud? Quelli di questo telefono restano come sono.',
  cloud_delete: 'Elimina il mio account',
  cloud_delete_confirm1: 'Eliminare il tuo account PETO Finanzas? Si eliminano il tuo account, la tua copia dei dati nel cloud e le case condivise create da te. I dati di QUESTO telefono restano qui, senza essere eliminati (puoi cancellarli in Impostazioni). Non si può annullare.',
  cloud_delete_confirm2: 'Ultima conferma: eliminare il tuo account per sempre?',
  cloud_deleted: 'Il tuo account è stato eliminato.',
  cloud_delete_err_auth: 'La tua sessione non è più valida. Accedi di nuovo e riprova.',
  cloud_unavailable: 'Il cloud non è disponibile in questa versione.',
  key_settings: 'Nome, ripartizione, testo, sezioni, PIN',
  footer: 'PETO Web · Con il tuo account nel cloud, i tuoi dati si sincronizzano con il tuo telefono',
  tile_available: 'Denaro disponibile',
  tile_available_aria: 'Denaro disponibile: vai a I miei conti',
  tile_savings: 'Risparmi del mese',
  tile_savings_aria: 'Risparmi del mese: vai a Risparmi',
  tile_debts: 'Debiti in sospeso',
  tile_debts_aria: 'Debiti in sospeso: vai a I miei debiti',
  tile_incomes: '💵 Entrate',
  tile_incomes_aria: 'Entrate: vai a Entrate settimanali',
  tile_expenses: '🧾 Spese',
  tile_expenses_aria: 'Spese: vai a Spese del mese',
  tile_goal: 'Obiettivo \'{name}\': {pct}%',
  key_spent_month: '{amount} spesi questo mese',
  key_income_month: '{amount} ricevuti questo mese',
  key_saved_total: '{amount} risparmiati in totale',
  key_goal_suffix: ' · Obiettivo \'{name}\': {pct}%',
  key_budget_one: '{n} categoria con limite',
  key_budget_many: '{n} categorie con limite',
  key_fixed: '{amount} al mese · {n} da pagare',
  key_available: 'Disponibile: {amount}',
  key_debts: '{amount} in sospeso',
  key_san: 'Settimana {x} di {n} · Tocca a {name}',
  key_san_done: 'San terminato 🎉',
  key_san_none: 'Nessun san attivo',
  banner_payday: 'Oggi è giorno di paga: registra la tua entrata e il tuo risparmio.',
  banner_dues_title: 'Pagamenti in scadenza:',
  banner_due_item: '{name} (giorno {day})',
  banner_close: 'Chiudi avviso',
  spend_title: 'Quanto puoi spendere oggi?',
  spend_note: 'Questo è quanto puoi spendere oggi senza sforare.',
  spend_guide: 'Crea il tuo primo budget per categoria e qui vedrai quanto puoi spendere ogni giorno.',
  spend_left: 'Ti restano {amount} per i {days} giorni rimanenti del mese.',
  spend_left_one: 'Ti resta {amount} per oggi, l’ultimo giorno del mese.',
  spend_over: 'Hai raggiunto il budget del mese.',
  spend_over_by: 'Hai sforato di {amount}.',
  cat_Renta: 'Affitto',
  cat_Comida: 'Alimentari',
  'cat_Comida fuera': 'Mangiare fuori',
  cat_Gasolina: 'Benzina',
  cat_Transporte: 'Trasporti',
  cat_Salud: 'Salute',
  cat_Ropa: 'Abbigliamento',
  cat_Otros: 'Altro',
  btn_cancel: 'Annulla',
  btn_save: 'Salva',
  btn_edit: 'Modifica',
  btn_delete: 'Elimina',
  err_amount: 'Scrivi un importo valido, maggiore di $0.',
  err_amount_generic: 'Scrivi un importo valido.',
  err_name: 'Scrivi un nome.',
  chip_paid: 'Pagato',
  chip_pending: 'In sospeso',
  month_prev_aria: 'Mese precedente',
  month_next_aria: 'Mese successivo',
  exp_new: 'Nuova spesa',
  exp_edit: 'Modifica spesa',
  exp_total_label: 'Totale del mese:',
  amount_label: 'Importo ($)',
  category_label: 'Categoria',
  date_label: 'Data',
  note_label: 'Nota (facoltativa)',
  exp_note_ph: 'Per cosa è stato?',
  exp_save: 'Salva spesa',
  exp_empty: 'Non ci sono ancora spese in questo mese.\nRegistra la prima con il modulo qui sopra. 👍',
  exp_delete_confirm: 'Eliminare questa spesa di {amount}? È della categoria {cat}, del {date}. Si elimina solo questa spesa.',
  err_category: 'Scegli una categoria valida.',
  err_limit_expenses: 'Hai raggiunto il limite di spese salvate.',
  inc_intro: 'Il risparmio non si calcola da solo: sei tu a scrivere quanto hai risparmiato davvero da ogni entrata. L’app ti suggerisce solo un importo in base alla tua percentuale nelle Impostazioni.',
  inc_new: 'Nuova entrata',
  inc_edit: 'Modifica entrata',
  inc_note_ph: 'Da dove è arrivata?',
  inc_savings_label: 'Risparmio ($)',
  inc_savings_label_sug: 'Risparmio (suggerito: {amount})',
  inc_savings_help: 'Suggerimento in base alla tua percentuale di risparmio: cambialo con quanto hai risparmiato davvero. Puoi mettere $0.',
  inc_split_line: 'Risparmio registrato: {sav} · Suggerimento: Attività {biz} · Spese {exp} · Famiglia {fam}',
  inc_split_preview: 'Ripartizione suggerita: Risparmio {sav} · Attività {biz} · Spese {exp} · Famiglia {fam}. Il risparmio che conta è quello che scrivi qui sotto.',
  inc_save: 'Salva entrata',
  inc_empty: 'Non ci sono ancora entrate registrate.\nAggiungi la tua prima entrata e scrivi quanto ne hai risparmiato. 💪',
  inc_delete_confirm: 'Eliminare questa entrata di {amount} del {date}? Si elimina anche il suo risparmio registrato di {savings}.',
  err_inc_savings: 'Scrivi quanto hai risparmiato da questa entrata (può essere $0).',
  err_limit_incomes: 'Hai raggiunto il limite di entrate salvate.',
  sav_intro_1: 'Qui vedi ogni importo che hai risparmiato, uno per uno. Puoi anche aggiungere un risparmio a parte,',
  sav_intro_2: 'che non viene da un’entrata',
  sav_intro_3: ', con il modulo qui sotto. Se elimini un risparmio, si elimina solo quell’importo:',
  sav_intro_4: 'l’entrata resta uguale',
  sav_intro_5: '.',
  sav_total_label: 'Totale risparmiato:',
  sav_month_label: 'Risparmiato questo mese:',
  sav_form_title: 'Aggiungi risparmio',
  sav_note_ph: 'Per cosa è questo risparmio?',
  sav_save: 'Salva risparmio',
  sav_goal_label: 'Assegna a un obiettivo (facoltativo)',
  sav_goal_none: 'Senza obiettivo · risparmio generale',
  sav_empty: 'Non hai ancora risparmi annotati.\nAggiungine uno con il modulo qui sopra, oppure annota il risparmio di un’entrata quando la registri e apparirà qui. 🌱',
  sav_from_title: 'Risparmio del {date}',
  sav_from_sub: 'Da un’entrata di {amount}',
  sav_manual_title: 'Risparmio aggiunto',
  sav_manual_sub: 'Manuale · aggiunto il {date}',
  sav_delete_income_confirm: 'Eliminare questo risparmio di {amount} del {date}? Si elimina solo questo importo di risparmio: l’entrata di {income} resta uguale.',
  sav_delete_manual_confirm: 'Eliminare questo risparmio di {amount} del {date}? È un risparmio che hai aggiunto a mano in Risparmi; si elimina solo questa voce.',
  err_limit_savings: 'Hai raggiunto il limite di risparmi salvati.',
  goal_prompt: 'Per cosa stai risparmiando?',
  goal_prompt_sub: 'Crea un obiettivo e guarda il tuo risparmio avvicinarsi all’obiettivo.',
  goal_form_create: 'Crea obiettivo',
  goal_form_edit: 'Modifica obiettivo',
  goal_name_label: 'Nome dell’obiettivo',
  goal_name_ph: 'Es.: Fondo di emergenza',
  goal_target_label: 'Importo obiettivo ($)',
  goal_create_btn: 'Crea obiettivo',
  goal_save_btn: 'Salva obiettivo',
  goal_progress: 'Hai risparmiato {have} su {target}',
  goal_remaining: 'Ti mancano {amount}',
  goal_edit: 'Modifica obiettivo',
  goal_delete: 'Elimina obiettivo',
  err_goal_name: 'Scrivi un nome per il tuo obiettivo.',
  res_cats_title: 'Spese per categoria',
  res_summary_title: 'Entrate vs Spese vs Risparmi',
  chart_income: 'Entrate',
  chart_expenses: 'Spese',
  chart_savings: 'Risparmi',
  res_cats_empty: 'Non ci sono spese in questo mese.',
  res_summary_empty: 'Non ci sono ancora movimenti in questo mese.',
  bud_intro: 'Imposta un limite mensile per categoria e guarda quanto hai speso.',
  bud_spent_left: 'Spesi {spent} di {budget} · Restano {left}',
  bud_spent_over: 'Spesi {spent} di {budget} · Hai sforato di {over}',
  bud_nolimit: 'Senza limite. Speso questo mese: {spent}',
  bud_placeholder: 'Limite mensile $',
  bud_aria: 'Limite mensile per {cat}',
  bud_delete_cat: 'Elimina categoria',
  bud_delete_cat_confirm: 'Eliminare la categoria "{cat}"? Le spese che la usano passeranno a "{other}".',
  bud_alert_amount: 'Scrivi un importo valido per il limite.',
  cat_form_title: 'Categoria personalizzata',
  cat_name_label: 'Nome della categoria',
  cat_name_ph: 'Es.: Animali',
  cat_save: 'Aggiungi categoria',
  err_cat_name: 'Scrivi un nome per la categoria.',
  err_cat_exists: 'Questa categoria esiste già.',
  fix_intro: 'Pagamenti che si ripetono ogni mese: affitto, telefono, abbonamenti…',
  fix_new: 'Nuovo pagamento fisso',
  fix_edit: 'Modifica pagamento fisso',
  fix_name_ph: 'Es.: Affitto',
  fix_day_label: 'Giorno del mese',
  fix_save: 'Salva pagamento fisso',
  fix_empty: 'Non hai ancora pagamenti fissi.',
  fix_sub: 'Giorno {day} di ogni mese · {month}',
  fix_mark: 'Segna come pagato',
  fix_unmark: 'Segna come non pagato',
  fix_delete_confirm: 'Eliminare il pagamento fisso "{name}"?',
  err_day: 'Il giorno deve essere tra 1 e 31.',
  err_limit_fixed: 'Hai raggiunto il limite di pagamenti fissi.',
  acc_new: 'Nuovo conto',
  acc_edit: 'Modifica conto',
  acc_balance_label: 'Saldo ($)',
  acc_name_ph: 'Es.: Contanti, Banca, Risparmi',
  acc_save: 'Salva conto',
  acc_empty: 'Non hai ancora conti.\nAggiungine uno per vedere il tuo denaro disponibile nel riepilogo.',
  acc_delete_confirm: 'Eliminare il conto "{name}"?',
  err_balance: 'Scrivi un saldo valido.',
  err_limit_accounts: 'Hai raggiunto il limite di conti.',
  debt_new: 'Nuovo debito',
  debt_edit: 'Modifica debito',
  debt_name_ph: 'Es.: Carta, Prestito',
  debt_status_label: 'Stato',
  debt_status_pending: 'In sospeso',
  debt_status_paid: 'Pagato',
  debt_save: 'Salva debito',
  debt_empty: 'Non hai debiti registrati. 🎉',
  debt_mark_paid: 'Segna come pagato',
  debt_mark_pending: 'Segna come in sospeso',
  debt_delete_confirm: 'Eliminare il debito "{name}"?',
  err_limit_debts: 'Hai raggiunto il limite di debiti.',
  name_label: 'Nome',
  san_intro: 'Un san (tanda) è un circolo di risparmio: ogni settimana tutti versano un contributo e una persona riceve il totale, a turno.',
  san_form_title: 'Crea un san',
  san_name_label: 'Nome del san',
  san_name_ph: 'Es.: San della famiglia',
  san_aporte_label: 'Contributo per turno ($)',
  san_participants_label: 'Partecipanti (in ordine di turno)',
  san_pname_ph: 'Nome del partecipante',
  san_add_participant: 'Aggiungi',
  san_create_btn: 'Crea san',
  san_err_participants: 'Aggiungi almeno 2 partecipanti.',
  san_err_active_exists: 'C’è già un san in corso («{name}»). Eliminalo prima se vuoi crearne un altro.',
  san_err_dup: 'Questo partecipante è già nella lista.',
  san_err_pname: 'Scrivi il nome del partecipante.',
  san_remove: 'Rimuovi',
  san_draft_empty: 'Non hai ancora aggiunto partecipanti.',
  san_week: 'Settimana {x} di {n}',
  san_finished: '🎉 San terminato!',
  san_finished_note: 'Tutte le settimane sono state completate. Puoi eliminare questo san e crearne uno nuovo.',
  san_total_line: 'Totale raccolto: {amount}',
  san_week_collected: 'Raccolto questa settimana: {amount} di {target}',
  san_receiver_line: 'Tocca a: {name}',
  san_aporte_line: 'Contributo per turno: {amount}',
  san_paid_title: 'Chi ha già pagato questa settimana?',
  san_paid: 'ha già pagato',
  san_advance: 'Segna la settimana come completa',
  san_delete: 'Elimina san',
  san_delete_confirm: 'Eliminare il san "{name}"? Si elimina il suo registro di settimane e pagamenti.',
  san_new_btn: 'Crea un nuovo san',
  san_new_confirm: 'Il san attuale è già terminato. Eliminarlo e crearne uno nuovo?',
  set_profile: 'Il tuo profilo',
  set_name_label: 'Il tuo nome',
  set_textsize_label: 'Dimensione del testo',
  textsize_normal: 'Normale',
  textsize_large: 'Grande',
  set_lang_label: 'Lingua / Language', lang_auto: 'Automatico (lingua del telefono)',
  set_reminders_title: 'Promemoria',
  set_payday_label: 'Giorno di paga',
  set_reminders_label: 'Promemoria nella Home',
  wd_none: 'Nessun giorno di paga',
  wd_0: 'Domenica',
  wd_1: 'Lunedì',
  wd_2: 'Martedì',
  wd_3: 'Mercoledì',
  wd_4: 'Giovedì',
  wd_5: 'Venerdì',
  wd_6: 'Sabato',
  set_split_title: 'Ripartizione suggerita delle entrate (%)',
  set_split_help: 'La somma dei quattro numeri deve essere 100. Queste percentuali sono solo un suggerimento su come ripartire le tue entrate: il risparmio non si salva mai da solo, sei sempre tu a scrivere quanto hai risparmiato davvero da ogni entrata.',
  split_ahorro: 'Risparmio',
  split_negocio: 'Attività',
  split_gastos: 'Spese',
  split_familia: 'Famiglia',
  set_save: 'Salva impostazioni',
  set_err_sum: 'La somma delle percentuali deve essere 100. Ora è {total}.',
  set_saved: 'Impostazioni salvate. ✅',
  set_sections_title: 'Sezioni visibili',
  set_sections_help: 'Disattiva quelle che non usi per avere una lista più corta.',
  set_pin_title: 'Sicurezza (PIN)',
  pin_status_on: 'Hai un PIN attivo. L’app si blocca all’apertura.',
  pin_status_off: 'Non hai un PIN. Puoi crearne uno qui per proteggere i tuoi dati.',
  pin_current_label: 'PIN attuale (se ne hai già uno)',
  pin_new_label: 'PIN nuovo (vuoto = rimuovi il PIN)',
  pin_update: 'Aggiorna PIN',
  pin_err_current: 'Il PIN attuale non è corretto.',
  pin_err_format: 'Il PIN nuovo deve avere da 4 a 6 cifre.',
  pin_off: 'PIN disattivato.',
  pin_updated: 'PIN aggiornato. ✅',
  set_data_title: 'I tuoi dati',
  set_data_help: 'I tuoi dati si salvano in questo browser e, se accedi con il tuo account, anche nel cloud. Esporta una copia se vuoi conservarla altrove.',
  data_export: 'Esporta copia (JSON)',
  data_import: 'Importa copia',
  data_reset: 'Elimina tutti i dati',
  data_err_big: 'Quel file è troppo grande.',
  data_err_invalid: 'Non è stato possibile importare: il file non è una copia valida di PETO Finanzas.',
  import_confirm: 'L’importazione sostituirà TUTTI i dati attuali dell’app. Sei sicuro?',
  import_done: 'Copia importata. ✅',
  reset_confirm1: 'Questo elimina TUTTI i tuoi dati dell’app su questo telefono. Non si può annullare. Sei sicuro?',
  reset_confirm2: 'Ultima conferma: eliminare tutto e ricominciare da zero?',
  lock_prompt: 'Inserisci il tuo PIN per entrare.',
  lock_pin_label: 'PIN',
  lock_enter: 'Entra',
  lock_note: 'I tuoi dati sono protetti con il tuo PIN.',
  lock_err: 'PIN errato. Riprova.',
  ob_title: 'Benvenuto in PETO Finanzas!',
  ob_intro_1: 'Organizza i tuoi soldi in pochi minuti: spese, entrate, budget, conti e debiti.',
  ob_intro_2: 'Con il tuo account nel cloud.',
  ob_intro_3: 'I tuoi dati si sincronizzano con il tuo telefono.',
  ob_name_label: 'Come ti chiami?',
  ob_name_ph: 'Il tuo nome',
  ob_pin_label: 'Crea un PIN di sicurezza (facoltativo)',
  ob_pin_ph: 'Da 4 a 6 cifre, o lascialo vuoto',
  ob_pin2_label: 'Ripeti il PIN',
  ob_pin2_ph: 'Ripeti il PIN',
  ob_start: 'Inizia',
  ob_note: 'Potrai cambiare il PIN quando vuoi nelle Impostazioni.',
  ob_tour1_title: 'Annota una spesa in pochi secondi',
  ob_tour1_text: 'Tocca il pulsante +, scrivi l’importo e la categoria. Nient’altro: la spesa viene registrata subito.',
  ob_tour2_title: 'Quanto puoi spendere oggi?',
  ob_tour2_text: 'PETO Finanzas divide il tuo budget tra i giorni rimasti del mese e ti mostra un solo numero: quanto puoi spendere oggi senza sforare il budget.',
  ob_tour3_title: 'Il tuo account nel cloud (facoltativo)',
  ob_tour3_text: 'Se vuoi, crea un account gratuito per vedere i tuoi dati anche sul web. Senza account, tutto resta solo sul tuo telefono.',
  ob_tour_next: 'Avanti',
  ob_tour_skip: 'Salta',
  ob_tour_go: 'Andiamo!',
  ob_err_name: 'Scrivi il tuo nome per iniziare.',
  ob_err_pin_format: 'Il PIN deve avere da 4 a 6 cifre.',
  ob_err_pin_mismatch: 'I due PIN non coincidono.',
  set_theme_label: 'Tema',
  theme_light: 'Chiaro',
  theme_dark: 'Scuro',
  theme_auto: 'Automatico (in base al sistema)',
  set_accent_label: 'Colore principale',
  accent_verde: 'Verde',
  accent_azul: 'Blu',
  accent_morado: 'Viola',
  accent_naranja: 'Arancione',
  undo_done: 'Fatto',
  undo_btn: 'Annulla',
  btn_repeat: 'Ripeti',
  fab_aria: 'Aggiunta rapida',
  quick_title: 'Cosa vuoi aggiungere?',
  quick_expense: '🧾 Spesa',
  quick_income: '💵 Entrata',
  quick_savings: '🐷 Risparmio',
  sec_buscar: 'Cerca movimenti',
  search_label: 'Cerca',
  search_ph: 'Nota, categoria o importo…',
  search_month_label: 'Mese (vuoto = tutti)',
  search_type_label: 'Tipo',
  type_all: 'Tutti',
  type_gastos: 'Spese',
  type_ingresos: 'Entrate',
  type_ahorros: 'Risparmi',
  search_empty: 'Nessun risultato.',
  search_type_income: 'Entrata',
  search_type_saving: 'Risparmio',
  chal_title: '🔥 Sfida di risparmio settimanale',
  chal_progress: 'Questa settimana: {have} di {target}',
  chal_done: '🎉 Sfida di questa settimana completata!',
  chal_streak_one: 'Serie: 1 settimana completata',
  chal_streak_many: 'Serie: {n} settimane completate',
  chal_streak_zero: 'Serie: 0 settimane. Questa può essere la prima!',
  streak_one: '🔥 1 giorno consecutivo di registrazioni',
  streak_many: '🔥 {n} giorni consecutivi di registrazioni',
  chal_target_label: 'Obiettivo settimanale di risparmio ($)',
  chal_save: 'Salva obiettivo settimanale',
  rep_title: 'Resoconto del mese',
  rep_download: 'Scarica immagine',
  rep_share_image: 'Condividi immagine',
  trend_title: 'Andamento delle spese',
  trend_weeks: 'Settimane di questo mese',
  trend_week: 'Settimana {n}',
  trend_empty: 'Non ci sono ancora spese per mostrare l’andamento.',
  rep_income: 'Entrate',
  rep_expenses: 'Spese',
  rep_savings: 'Risparmi',
  rep_top_cat: 'Categoria principale',
  rep_top3: 'Top 3 categorie',
  rep_goal: 'Obiettivo di risparmio',
  rep_none: 'Nessun movimento',
  calc_title: 'Calcolatrice dei debiti',
  calc_intro: 'Confronta due piani per uscire dai debiti: pagare prima il più piccolo (palla di neve) o quello con l’interesse più alto (valanga). Ogni mese paghi i minimi di tutti e il resto va al debito obiettivo.',
  calc_budget_label: 'Quanto puoi pagare al mese in totale per i debiti? ($)',
  calc_run: 'Calcola',
  calc_snowball: 'Palla di neve (saldo minore prima)',
  calc_avalanche: 'Valanga (interesse maggiore prima)',
  calc_result: '{months} mesi per uscirne · interessi circa {interest}',
  calc_months_one: '1 mese per uscirne · interessi circa {interest}',
  calc_order: 'Ordine in cui si pagano:',
  calc_free: 'Non hai debiti in sospeso! 🎉',
  calc_warn: 'Con quel pagamento mensile, qualche debito non finisce mai: il pagamento non copre nemmeno gli interessi. Aumenta il pagamento mensile.',
  calc_note_zero: 'I debiti senza pagamento minimo o senza interesse annotati si calcolano con minimo $0 e interesse 0%.',
  calc_err_budget: 'Scrivi quanto puoi pagare al mese.',
  debt_interest_label: 'Interesse annuale % (facoltativo)',
  debt_minpay_label: 'Pagamento minimo mensile $ (facoltativo)',
  debt_terms: 'Interesse {pct}% annuale · Minimo {min}/mese',
  exp_photo_label: 'Foto dello scontrino (facoltativa)',
  exp_photo_remove: 'Rimuovi foto',
  photo_close: 'Chiudi',
  err_photo_quota: 'Non c’era spazio per salvare la foto: la spesa è stata salvata senza foto.',
  banner_backup: 'È da un po’ che non salvi una copia dei tuoi dati. Esporta il tuo backup nelle Impostazioni.',
  /* --- Fase 4: PETO Pro, resoconto avanzato, organizzatore del san --- */
  pro_title: 'PETO Pro',
  pro_card_text: 'Il cloud senza limiti per i tuoi dati, il resoconto avanzato, il budget condiviso e la modalità organizzatore del san.',
  pro_status_free: 'Ora hai il piano Gratuito.',
  pro_status_active: 'Hai PETO Pro attivo. Grazie per sostenere PETO Finanzas! ⭐',
  pro_status_test: 'PETO Pro è aperto durante il test chiuso: hai accesso completo per tutta la durata del test.',
  pro_status_waitlist: 'Sei nella lista d’attesa di PETO Pro.',
  pro_btn_see: 'Vedi PETO Pro',
  pro_wall_title: 'Questa è una funzione di PETO Pro ⭐',
  pro_price_line: 'Solo $1.99 al mese',
  pro_benefit_cloud: '☁️ Cloud senza limiti per i tuoi dati',
  pro_benefit_report: '📊 Resoconto avanzato: confronta i mesi ed esporta in CSV',
  pro_benefit_shared: '🏠 Budget condiviso con la tua casa',
  pro_benefit_org: '🤝 Modalità organizzatore del san: la tanda di tutto il gruppo',
  pro_coming_text: 'L’acquisto in-app arriva con il lancio su Google Play. Intanto puoi iscriverti alla lista d’attesa: ti avviseremo appena potrai attivare Pro a $1.99 al mese.',
  pro_waitlist_btn: 'Iscrivimi alla lista d’attesa',
  pro_waitlist_done: 'Sei in lista ✅ Ti avviseremo quando Pro sarà disponibile.',
  pro_close: 'Non ora',
  pro_tag: 'PRO',
  adv_title: 'Resoconto avanzato',
  adv_note: 'Funzione di PETO Pro: questo mese a confronto con il precedente, tutte le categorie ed esportazione del mese in CSV.',
  adv_open_btn: 'Vedi il resoconto avanzato',
  adv_export_csv: 'Esporta il mese in CSV',
  adv_this_month: 'Questo mese',
  adv_prev_month: 'Mese precedente',
  adv_change: 'Variazione',
  adv_all_cats: 'Tutte le categorie',
  adv_empty: 'Nessun movimento in questi due mesi.',
  org_title: 'Modalità organizzatore del san',
  org_intro: 'Organizza la tanda di tutto il gruppo: turni con data, segna chi ha già pagato in ogni turno e condividi lo stato con il gruppo.',
  org_pro_note: 'La modalità organizzatore è una funzione di PETO Pro.',
  org_form_title: 'Crea il san del gruppo',
  org_freq_label: 'Frequenza dei turni',
  org_freq_semanal: 'Settimanale',
  org_freq_quincenal: 'Ogni 2 settimane',
  org_freq_mensual: 'Mensile',
  org_start_label: 'Data del primo turno',
  org_create_btn: 'Crea san organizzato',
  org_round: 'Turno {x} di {n}',
  org_receiver_line: 'Riceve: {name}',
  org_pending_none: 'Hanno pagato tutti! 🎉',
  org_pending_list: 'Ancora da pagare: {names}',
  org_pending_count_one: 'Ne manca 1',
  org_pending_count_many: 'Ne mancano {n}',
  org_totals_title: 'Contributi per partecipante',
  org_paid_rounds: '{paid} di {n} turni pagati',
  org_delete: 'Elimina san organizzato',
  org_delete_confirm: 'Eliminare il san organizzato «{name}»? Si perderà il registro dei pagamenti del gruppo.',
  org_share_title: 'Stato del san',
  shared_live_note: 'Condividi il budget con la tua casa: crea una casa o unisciti con un codice e vedrete gli stessi membri. Servono il tuo account nel cloud (sopra, in Impostazioni) e PETO Pro.',
  shared_leave_live: 'Uscire da questa casa? Non vedrai più il suo budget condiviso.',
  shared_err_login: 'Prima accedi con il tuo account nel cloud (sopra, in Impostazioni) e riprova.',
  shared_err_generic: 'Non è stato possibile completare. Controlla la connessione e riprova.',
  shared_err_code_live: 'Quel codice non esiste. Controllalo e riprova.',
  shared_err_member: 'Sei già membro di questa casa.',
  shared_err_owner_leave: 'Sei il proprietario/la proprietaria della casa: non puoi uscire senza eliminarla. Chiedi a un altro membro di creare la nuova casa.',
  shared_created_live: 'Casa creata ✅ Condividi il codice per invitare i membri della tua casa.',
  shared_joined_live: 'Ti sei unito alla casa ✅',
  org_comp_label: 'Compensazione dell’organizzatore',
  org_comp_none: 'Nessuna compensazione',
  org_comp_first: 'L’organizzatore riscuote per primo',
  org_comp_last: 'L’organizzatore riscuote per ultimo',
  org_comp_extra: 'Quota extra per turno',
  org_comp_amount_label: 'Quota extra per persona ($)',
  org_comp_line: 'Compensazione dell’organizzatore: {mode}',
  org_sim_title: 'Simulazione del montepremi',
  org_sim_pays: 'Ogni partecipante versa per turno: {amount}',
  org_sim_pot: 'Montepremi di ogni turno: {amount}',
  org_sim_total_in: 'Totale versato da ciascuno in tutto il san: {amount}',
  org_sim_extra_org: 'L’organizzatore riceve {amount} extra per turno',
  org_sim_first: 'L’organizzatore riceve il montepremi del primo turno',
  org_sim_last: 'L’organizzatore riceve il montepremi dell’ultimo turno',
  org_shuffle_btn: '🎲 Sorteggia l’ordine',
  org_shuffled: '🎲 Ordine sorteggiato! Ecco il nuovo turno.',
  org_shuffle_need: 'Aggiungi almeno 2 partecipanti per sorteggiare l’ordine.',
  org_shuffle_blocked: 'Non si può più sorteggiare: il san è già iniziato o ha pagamenti registrati.',
  org_start_btn: 'Avvia il san',
  org_started_line: 'San in corso · L’ordine è bloccato',
  org_order_title: 'Ordine dei turni',
  org_move_up: 'Sposta su',
  org_move_down: 'Sposta giù',
  org_swap_blocked: 'Quel turno ha già pagamenti e non può essere cambiato.',
  org_history_title: 'Cronologia delle modifiche',
  org_history_swap: '{a} e {b} si sono scambiati i turni',
  org_history_started: 'L’organizzatore ha avviato il san',
  org_pay_pending: 'In attesa',
  org_pay_reported: 'Segnalato',
  org_pay_confirmed: 'Confermato',
  org_status_btn: 'Stato: {status}',
  org_receipt_add: '📎 Ricevuta',
  org_receipt_view: 'Vedi ricevuta',
  org_receipt_remove: 'Rimuovi',
  org_zelle_label: 'Zelle di ogni partecipante (numero o e-mail, facoltativo)',
  org_zelle_ph: 'Zelle (facoltativo)',
  org_zelle_line: 'Zelle: {zelle}',
  org_reminder_btn: '📲 Promemoria WhatsApp',
  org_reminder_head: '🤝 {san} · Turno {x} di {n} · {date}',
  org_reminder_receiver: '💰 Questa settimana riscuote {name}',
  org_reminder_zelle: 'Zelle di {name}: {zelle}',
  org_reminder_amount: 'Contributo del turno: {amount}',
  org_antifraud: '🛡️ Un san non paga mai interessi né più di quanto versato.',
  org_link_btn: '🔗 Link di sola lettura',
  org_link_publish: 'Crea link',
  org_link_update: 'Aggiorna link',
  org_link_copied: 'Link copiato!',
  org_link_need_cloud: 'Il link richiede il tuo account cloud: accedi in Impostazioni e riprova.',
  org_link_ready: 'San del gruppo (sola lettura)',
  org_public_title: 'Il link è pronto da condividere.',
  org_public_updated: 'Aggiornato il {date}',
  org_public_notfound: 'Questo link non è più disponibile.',
  org_pub_pay_btn: 'Ho pagato',
  org_pub_confirm: 'Hai già pagato la tua quota di questo turno? L’organizzatore lo confermerà.',
  org_pub_attach: '📎 Allega la foto della ricevuta (facoltativo)',
  org_pub_send: 'Invia segnalazione',
  org_pub_sent: 'Fatto! Il tuo pagamento è stato segnalato.',
  org_pub_reported_note: 'Segnalato · in attesa di conferma',
  org_pub_err: 'Invio non riuscito. Controlla la connessione e riprova.',
  org_pub_err_confirmed: 'Questo pagamento è già stato confermato dall’organizzatore.',
  org_pub_err_photo: 'La foto è troppo grande; provane una più piccola.',
  org_penalty_label: 'Regola per i ritardi',
  org_penalty_none: 'Nessuna multa',
  org_penalty_fixed: 'Multa fissa',
  org_penalty_percent: 'Percentuale del contributo',
  org_penalty_amount_label: 'Importo della multa ($)',
  org_penalty_percent_label: 'Percentuale della multa (%)',
  org_penalty_line_fixed: 'Se qualcuno è in ritardo: multa di {amount}',
  org_penalty_line_percent: 'Se qualcuno è in ritardo: multa del {percent}% del contributo',
  set_news_title: 'Novità',
  news_c24: 'Compilación 24: tutorial di benvenuto, giorni consecutivi di registrazione, obiettivi di risparmio con barra di avanzamento e grafico di tendenza.',
  news_c25: 'Compilación 25: widget nella schermata iniziale e un’app molto più leggera (da 52 MB a 7 MB).',
  news_c26: 'Compilación 26: widget in tre misure, con opzioni per ogni widget e un pulsante per registrare una spesa senza aprire l’app.',
  news_c27: 'Compilación 27: l’app in 12 lingue, con rilevamento automatico della lingua del telefono.',
  news_c28: 'Compilación 28: testo più grande applicato dall’avvio, questa sezione delle novità, revisione dell’italiano e avvio più rapido.',
  news_c31: 'Compilación 31: il tasto o gesto indietro ora si muove dentro l’app: chiude ciò che è aperto e torna alla schermata principale prima di uscire.',
  news_c32: 'Versione 32: il marchio ora è «PETO Finanzas» in tutta l’app (menu, blocco e widget), il san è passato in cima all’elenco della schermata iniziale, il link pubblico del san si apre direttamente sullo stato del gruppo e i pulsanti dell’organizzatore rispondono sempre con un messaggio chiaro.',
  news_c33: 'Versione 33: creare un san non può più cancellare quello in corso — se ce n’è già uno attivo, l’app lo dice e lo protegge (pagamenti, ricevute, cronologia e link pubblico) — e la versione web è ora sincronizzata con il telefono.',
  news_c34: 'Versione 34: nuovo logo di PETO Finanzas — la «P» bianca con barre e freccia in verde chiaro su fondo smeraldo, ora nell’icona, nella schermata di blocco e in tutta l’app.',
  news_c35: 'Versione 35: dal link pubblico del san ora puoi segnalare il tuo pagamento con «Ho pagato» e allegare la ricevuta (la conferma è dell’organizzatore), il visualizzatore usa il tema scuro, l’app si aggiorna scorrendo verso il basso e il lettore PDF non confonde più gli Zelle che invii con entrate.',
  sec_podcast: 'Podcast',
  key_podcast: 'Finanzas Personales, il podcast',
  pod_hosts: 'con Lucía e Marco',
  pod_desc: 'Soldi senza complicazioni: consigli pratici per risparmiare, uscire dai debiti e prenderti cura del tuo portafoglio, in episodi brevi.',
  pod_spotify_btn: 'Ascolta su Spotify',
  pod_loading: 'Caricamento episodi…',
  pod_offline: 'Nessuna connessione: vedi l’ultimo elenco scaricato',
  pod_error: 'Non siamo riusciti a caricare gli episodi. Controlla la connessione e riprova.',
  pod_empty: 'Nessun episodio pubblicato ancora.',
  pod_play_aria: 'Riproduci',
  pod_pause_aria: 'Pausa',
  pod_audio_error: 'Impossibile riprodurre questo episodio.',
  pub_tagline: 'Il tuo san, organizzato e trasparente',
  pub_progress: '{x} di {n} pagamenti confermati',
  pub_progress_start: 'È appena iniziato: nessun pagamento confermato ancora',
  pub_cta_title: 'Vuoi organizzare il tuo san?',
  pub_cta_text: 'Con PETO Finanzas tieni ordine, turni e ricevute in un unico posto, senza quaderni né confusione.',
  pub_cta_try: 'Prova PETO Finanzas',
  pub_cta_more: 'Scopri di più',
  pub_bar_try: 'Prova l’app',
  pub_footer: 'Fatto con PETO Finanzas · petofinanzas.com',
  news_c36: 'Versione 36: nuova sezione Podcast — ascolta «Finanzas Personales» senza uscire dall’app, con lettore integrato e l’elenco salvato per quando non c’è internet — la schermata di benvenuto ora avanza da sola, diapositiva dopo diapositiva — e la vista del link rinnovata: il san si presenta con il suo avanzamento e l’accesso diretto per provare l’app.',
  news_c37: 'Versione 37: widget ridisegnati — gradiente del marchio, barra di avanzamento che cambia colore in base al budget e la riga del prossimo turno del tuo san — e un widget nuovo grande quanto un’icona, con quanto puoi spendere oggi — e il marchio resta visibile mentre scorri il link pubblico del san — e i turni dell’organizzatore ora si piegano a fisarmonica, con aperto solo quello di questa settimana.',
  widget_today: 'oggi',
  widget_san_next: 'Prossimo turno: {name} · {date}',
  widget_san_next_nodate: 'Prossimo turno: {name}',
  back_exit_hint: 'Premi di nuovo indietro per uscire.'
},
pt: {
  org_err_san_name: 'Digite o nome do san.', rep_promo_footer: 'Controle seus gastos com o PETO Finanzas · petofinanzas.com', rep_saved: 'Imagem salva.', set_sections_summary: '{visible} de {total} visíveis',
  org_err_active_exists: 'Já existe um san ativo («{name}»). Exclua-o primeiro no cartão dele se quiser criar outro.',
  app_title: 'PETO Finanzas',
  back: '← Todas as opções',
  greeting: 'Olá',
  lock_btn: 'Bloquear',
  home_menu_heading: 'O que você quer ver?',
  group_daily: 'Dia a dia',
  group_plan: 'Planejamento',
  group_accounts: 'Contas e compromissos',
  group_yourapp: 'Seu app',
  sec_gastos: 'Gastos do mês',
  sec_ingresos: 'Renda semanal',
  sec_ahorros: 'Poupança',
  sec_resumen: 'Resumo',
  sec_presupuesto: 'Orçamento por categoria',
  sec_pagos: 'Pagamentos fixos',
  sec_cuentas: 'Minhas contas',
  sec_deudas: 'Minhas dívidas',
  sec_san: 'Meu san (tanda)',
  sec_ajustes: 'Ajustes e personalização',
  menu_open_aria: 'Abrir menu',
  menu_close_aria: 'Fechar menu',
  sec_home: 'Início',
  key_home: 'Sua tela principal',
  set_notif_label: 'Notificações com o app fechado',
  set_notif_help: 'Avisos dos seus pagamentos fixos um dia antes e no próprio dia, mesmo com o PETO Finanzas fechado.',
  set_autofixed_label: 'Registrar pagamentos fixos automaticamente',
  set_autofixed_help: 'Quando um pagamento fixo vence, o gasto é registrado para você. Você pode desfazer na hora.',
  set_bio_label: 'Desbloqueio com impressão digital',
  set_bio_help: 'Entre com sua impressão digital além do PIN (é necessário um PIN ativo).',
  bio_btn: '👆 Entrar com impressão digital',
  bio_reason: 'Confirme que é você para abrir o PETO Finanzas',
  bio_need_pin: 'A impressão digital precisa de um PIN ativo: crie seu PIN em Ajustes → Segurança e a digital funcionará ao abrir o app.',
  bio_failed: 'Não foi possível verificar a impressão digital. Digite seu PIN.',
  bio_unavailable: 'A impressão digital não está disponível neste telefone. Digite seu PIN.',
  bio_not_enrolled: 'Este telefone não tem nenhuma impressão digital cadastrada. Cadastre uma nos ajustes do telefone ou digite seu PIN.',
  bio_offer_title: 'Desbloquear com sua impressão digital?',
  bio_offer_text: 'Você acabou de criar seu PIN. Se quiser, pode abrir o PETO Finanzas com sua impressão digital em vez de digitar o PIN toda vez. Ativamos agora?',
  bio_offer_yes: 'Sim, ativar a impressão digital',
  bio_offer_no: 'Agora não',
  bio_activated: 'Pronto: o desbloqueio com impressão digital está ativado.',
  fix_auto_suffix: '(pagamento fixo automático)',
  backup_pass_label: 'Senha da cópia criptografada',
  backup_pass_ph: 'Mínimo de 4 caracteres',
  data_export_enc: 'Exportar cópia criptografada',
  backup_help: 'A cópia criptografada só abre com sua senha. Sem ela, não pode ser recuperada: guarde-a bem. Para importar uma cópia criptografada, digite a senha aqui antes de escolher o arquivo.',
  backup_err_short: 'A senha precisa de pelo menos 4 caracteres.',
  backup_need_pass: 'Digite a senha da cópia criptografada antes de importá-la.',
  backup_err_pass: 'Não foi possível abrir a cópia: senha incorreta ou arquivo danificado.',
  share_btn: 'Compartilhar resumo',
  share_copied: 'Resumo copiado. Cole onde quiser.',
  review_title: 'Você gosta do PETO Finanzas?',
  review_text: 'Se o PETO Finanzas te ajuda a cuidar do seu dinheiro, uma avaliação no Google Play nos ajuda muito a alcançar mais pessoas. Obrigado!',
  review_yes: '⭐ Avaliar no Google Play',
  review_no: 'Agora não',
  share_report_title: 'Meu resumo do PETO Finanzas',
  notif_fixed_title: 'Pagamento fixo amanhã',
  notif_fixed_today: 'Pagamento fixo hoje',
  notif_fixed_body: '{name} · {amount}',
  notif_weekly_title: 'Sua semana no PETO Finanzas',
  notif_weekly_body: 'Registre os gastos e a renda desta semana para manter o controle.',
  summary_title: 'Resumo diário',
  summary_help: 'Um aviso com o que você gastou ontem e o que pode gastar hoje, na hora que escolher.',
  summary_notif_label: 'Resumo por notificação',
  summary_time_label: 'Hora do resumo',
  summary_email_label: 'Receber também por e-mail',
  summary_email_help: 'Apenas com sua conta na nuvem ativa: o mesmo resumo também chega ao seu e-mail.',
  notif_summary_title: '🌅 Seu resumo PETO Finanzas',
  notif_summary_body: 'Ontem você gastou {spent} · Hoje você pode gastar {daily}',
  notif_summary_body_nodaily: 'Ontem você gastou {spent}',
  sec_remesas: 'Remessas',
  key_remesas: 'Enviado este mês: {amount}',
  rem_intro: 'Dinheiro que você envia para os seus: quanto saiu em dólares e quanto chegou na moeda deles.',
  rem_usd_label: 'Valor enviado ($ USD)',
  rem_rate_label: 'Câmbio ({cur} por $1)',
  rem_recipient_label: 'Para quem?',
  rem_currency_label: 'Moeda de destino',
  rem_arrives_label: 'Chega',
  rem_rate_suggested: 'Último câmbio que você usou para {cur}: {rate}. Já vem preenchido; altere se o de hoje for diferente.',
  rem_month_sent: 'Este mês você enviou {usd}',
  rem_totals_title: 'Totais por moeda (todo o histórico)',
  rem_total_row: '{usd} enviados → {amount} recebidos · {n} envios',
  rem_save: 'Salvar remessa',
  rem_empty: 'Nenhuma remessa registrada ainda.',
  rem_delete_confirm: 'Excluir a remessa para {name}?',
  csv_title: 'Importar extrato do banco (CSV)',
  csv_help: 'Envie o arquivo CSV do seu banco e revise tudo em uma prévia antes de importar: nada é salvo até você confirmar.',
  csv_file_label: 'Arquivo CSV do banco',
  csv_preview_title: 'Prévia da importação',
  csv_summary: '{total} transações · {dups} duplicadas (excluídas) · {sel} para importar',
  csv_dup_badge: 'Duplicada',
  csv_income_badge: 'Renda',
  csv_expense_badge: 'Gasto',
  csv_all: 'Marcar todas',
  csv_none: 'Desmarcar todas',
  csv_apply: 'Importar selecionadas',
  csv_cancel: 'Cancelar importação',
  csv_done: '{n} transações importadas. ✅',
  csv_none_selected: 'Você não marcou nenhuma transação para importar.',
  csv_err_parse: 'Não foi possível ler esse arquivo como CSV. Verifique se é o extrato do banco em formato CSV.',
  csv_err_headers: 'As colunas de data e valor não foram encontradas nesse arquivo.',
  csv_err_big: 'Esse arquivo é grande demais para importar.',
  csv_err_empty: 'Esse arquivo não tem transações que possam ser importadas.',
  pdf_err_big: 'Esse PDF é grande demais (máximo 8 MB).',
  pdf_err_notext: 'Esse PDF não tem texto que eu consiga ler (parece uma foto ou digitalização). Tente o CSV do banco ou anote o gasto com a foto do recibo.',
  pdf_err_empty: 'Não encontrei transações com data e valor nesse PDF. Tente o CSV do banco.',
  shared_title: 'Orçamento compartilhado',
  shared_preview_note: '🔧 Prévia do design: ainda não conecta com outras contas. Use para experimentar como vai ficar criar uma casa, entrar com um código e ver os membros.',
  shared_create_label: 'Nome da casa',
  shared_create_btn: 'Criar casa',
  shared_join_label: 'Código de convite',
  shared_join_btn: 'Entrar com código',
  shared_members_title: 'Membros',
  shared_code_label: 'Código de convite: {code}',
  shared_role_dueno: 'Proprietário',
  shared_role_admin: 'Administrador',
  shared_role_miembro: 'Membro',
  shared_role_lector: 'Somente leitura',
  shared_you: 'Você',
  shared_host: 'Anfitrião',
  shared_leave_btn: 'Sair da casa',
  shared_leave_confirm: 'Sair desta casa? (prévia)',
  shared_err_name: 'Digite um nome para a casa.',
  shared_err_code: 'O código tem 6 letras ou números.',
  shared_created: 'Casa criada (prévia). ✅',
  shared_joined: 'Você entrou na casa (prévia). ✅',
  shared_household_fallback: 'Casa compartilhada',
  privacy_hide: 'Ocultar valores',
  privacy_show: 'Mostrar valores',
  ins_title: '💡 Ideias sobre seu dinheiro',
  ins_cat_up: '{cat} subiu {pct}% em relação ao mês passado ({from} → {to}).',
  ins_pace_down: 'Seu ritmo está melhor: os gastos caíram {pct}% em relação ao mês passado.',
  ins_pace_up: 'Atenção: seu ritmo de gastos subiu {pct}% em relação ao mês passado.',
  ins_biggest: 'Seu maior gasto este mês: {note} · {amount}.',
  ins_saved: 'Você poupou {amount} este mês. Continue assim!',
  bud_alert_title: 'Orçamento em risco',
  bud_alert_warn: '{cat}: você está em {pct}% do orçamento.',
  bud_alert_over: '{cat}: você passou do orçamento ({pct}%).',
  voice_btn: '🎤 Ditar',
  voice_listening: 'Ouvindo… diga o valor e para quê foi.',
  voice_unavailable: 'A voz não está disponível neste aparelho.',
  voice_heard: 'Ouvi: “{text}”. Confira e salve.',
  voice_no_amount: 'Ouvi: “{text}”, mas não encontrei o valor.',
  ocr_found: 'Detectei {amount} no recibo. Confira antes de salvar.',
  goals_title: 'Mais metas',
  goal2_create: 'Criar meta',
  goal_add: '+ Adicionar',
  goal_take: '− Retirar',
  goal_done: '🎉 Meta alcançada!',
  goal_move_label: 'Valor',
  goal_delete_confirm: 'Excluir a meta "{name}"? Sua poupança não é tocada: só a meta é excluída.',
  err_limit_goals: 'Você já tem o número máximo de metas.',
  biz_label: 'Isto é para o meu negócio',
  biz_title: 'Meu negócio este mês',
  biz_income: 'Renda do negócio',
  biz_expenses: 'Gastos do negócio',
  biz_profit: 'Lucro',
  chal_share: 'Compartilhar meu desafio',
  cloud_title: 'Conta na nuvem',
  cloud_help: 'Com uma conta, seus dados também ficam guardados na nuvem e sincronizados: troque de telefone, entre com seu e-mail e tudo estará lá. Sem conta, o app funciona só neste telefone, como sempre.',
  cloud_email: 'E-mail',
  cloud_pass: 'Senha',
  cloud_signin: 'Entrar',
  cloud_signup: 'Criar conta',
  cloud_signout: 'Sair',
  cloud_sync_now: 'Sincronizar agora',
  cloud_wipe: 'Excluir meus dados da nuvem',
  cloud_who: 'Entrou como {email}',
  cloud_synced: 'Sincronizado ✓ · {time}',
  cloud_never: 'Ainda não sincronizado.',
  cloud_working: 'Trabalhando…',
  cloud_ok_in: 'Bem-vindo de novo!',
  cloud_ok_up: 'Conta criada! Seus dados agora estão na nuvem.',
  cloud_err_fields: 'Digite seu e-mail e uma senha de pelo menos 6 caracteres.',
  cloud_err_login: 'Não foi possível entrar. Verifique seu e-mail e senha.',
  cloud_err_exists: 'Esse e-mail já tem uma conta. Use «Entrar».',
  cloud_err_confirm: 'Conta criada. Verifique seu e-mail para confirmar a conta e depois entre.',
  cloud_err_generic: 'Algo falhou com a nuvem. Verifique sua internet e tente de novo.',
  cloud_conflict: 'A nuvem e este telefone têm dados diferentes. Baixar os dados da nuvem e substituir os deste telefone? (Cancelar = enviar os dados deste telefone)',
  cloud_wipe_confirm: 'Excluir TODOS os seus dados da nuvem? O que está neste telefone fica como está.',
  cloud_delete: 'Excluir minha conta',
  cloud_delete_confirm1: 'Excluir sua conta PETO Finanzas? Isso apaga sua conta, sua cópia dos dados na nuvem e as casas compartilhadas que são suas. Os dados DESTE telefone ficam aqui, intactos (você pode apagá-los em Ajustes). Isso não pode ser desfeito.',
  cloud_delete_confirm2: 'Confirmação final: excluir sua conta de vez?',
  cloud_deleted: 'Sua conta foi excluída.',
  cloud_delete_err_auth: 'Sua sessão não é mais válida. Entre de novo e tente outra vez.',
  cloud_unavailable: 'A nuvem não está disponível nesta versão.',
  key_settings: 'Nome, divisão, texto, seções, PIN',
  footer: 'PETO Finanzas · Funciona sem internet · A nuvem é opcional: seus dados, sua decisão',
  tile_available: 'Dinheiro disponível',
  tile_available_aria: 'Dinheiro disponível: ir para Minhas contas',
  tile_savings: 'Poupança deste mês',
  tile_savings_aria: 'Poupança deste mês: ir para Poupança',
  tile_debts: 'Dívidas pendentes',
  tile_debts_aria: 'Dívidas pendentes: ir para Minhas dívidas',
  tile_incomes: '💵 Renda',
  tile_incomes_aria: 'Renda: ir para Renda semanal',
  tile_expenses: '🧾 Gastos',
  tile_expenses_aria: 'Gastos: ir para Gastos do mês',
  tile_goal: 'Meta \'{name}\': {pct}%',
  key_spent_month: '{amount} gastos este mês',
  key_income_month: '{amount} recebidos este mês',
  key_saved_total: '{amount} poupados no total',
  key_goal_suffix: ' · Meta \'{name}\': {pct}%',
  key_budget_one: '{n} categoria com limite',
  key_budget_many: '{n} categorias com limite',
  key_fixed: '{amount} por mês · {n} a pagar',
  key_available: 'Disponível: {amount}',
  key_debts: '{amount} pendente',
  key_san: 'Semana {x} de {n} · Vez de: {name}',
  key_san_done: 'San finalizado 🎉',
  key_san_none: 'Nenhum san ativo',
  banner_payday: 'Hoje é dia de pagamento: registre sua renda e sua poupança.',
  banner_dues_title: 'Pagamentos próximos:',
  banner_due_item: '{name} (dia {day})',
  banner_close: 'Fechar',
  spend_title: 'Quanto você pode gastar hoje?',
  spend_note: 'Isto é o que você pode gastar hoje sem passar do limite.',
  spend_guide: 'Crie o orçamento da sua primeira categoria e você verá aqui quanto pode gastar por dia.',
  spend_left: 'Restam {amount} para os {days} dias restantes do mês.',
  spend_left_one: 'Resta {amount} para hoje, o último dia do mês.',
  spend_over: 'Você atingiu o orçamento deste mês.',
  spend_over_by: 'Você passou em {amount}.',
  cat_Renta: 'Aluguel',
  cat_Comida: 'Comida',
  "cat_Comida fuera": 'Comer fora',
  cat_Gasolina: 'Combustível',
  cat_Transporte: 'Transporte',
  cat_Salud: 'Saúde',
  cat_Ropa: 'Roupas',
  cat_Otros: 'Outros',
  btn_cancel: 'Cancelar',
  btn_save: 'Salvar',
  btn_edit: 'Editar',
  btn_delete: 'Excluir',
  err_amount: 'Digite um valor válido, maior que $0.',
  err_amount_generic: 'Digite um valor válido.',
  err_name: 'Digite um nome.',
  chip_paid: 'Pago',
  chip_pending: 'Pendente',
  month_prev_aria: 'Mês anterior',
  month_next_aria: 'Mês seguinte',
  exp_new: 'Novo gasto',
  exp_edit: 'Editar gasto',
  exp_total_label: 'Total do mês:',
  amount_label: 'Valor ($)',
  category_label: 'Categoria',
  date_label: 'Data',
  note_label: 'Nota (opcional)',
  exp_note_ph: 'Para quê foi?',
  exp_save: 'Salvar gasto',
  exp_empty: 'Nenhum gasto este mês ainda.\nAdicione o primeiro com o formulário acima. 👍',
  exp_delete_confirm: 'Excluir este gasto de {amount}? Categoria {cat}, em {date}. Só este gasto é excluído.',
  err_category: 'Escolha uma categoria válida.',
  err_limit_expenses: 'Você atingiu o limite de gastos salvos.',
  inc_intro: 'A poupança nunca é automática: você digita quanto realmente poupou de cada renda. O app só sugere um valor com base na sua porcentagem dos Ajustes.',
  inc_new: 'Nova renda',
  inc_edit: 'Editar renda',
  inc_note_ph: 'De onde veio?',
  inc_savings_label: 'Poupança ($)',
  inc_savings_label_sug: 'Poupança (sugerida: {amount})',
  inc_savings_help: 'Uma sugestão com base na sua porcentagem de poupança — altere para o que você realmente poupou. Pode digitar $0.',
  inc_split_line: 'Poupado: {sav} · Sugestão: Negócio {biz} · Gastos {exp} · Família {fam}',
  inc_split_preview: 'Divisão sugerida: Poupança {sav} · Negócio {biz} · Gastos {exp} · Família {fam}. A poupança que conta é a que você digita abaixo.',
  inc_save: 'Salvar renda',
  inc_empty: 'Nenhuma renda registrada ainda.\nAdicione sua primeira renda e digite quanto poupou dela. 💪',
  inc_delete_confirm: 'Excluir esta renda de {amount} de {date}? A poupança anotada de {savings} também é excluída.',
  err_inc_savings: 'Digite quanto você poupou desta renda (pode ser $0).',
  err_limit_incomes: 'Você atingiu o limite de rendas salvas.',
  sav_intro_1: 'Aqui você vê cada valor que poupou, um por um. Você também pode adicionar uma poupança avulsa,',
  sav_intro_2: 'não vinculada a nenhuma renda',
  sav_intro_3: ', com o formulário abaixo. Se você excluir uma poupança, só aquele valor é excluído:',
  sav_intro_4: 'a renda continua a mesma',
  sav_intro_5: '.',
  sav_total_label: 'Total poupado:',
  sav_month_label: 'Poupado este mês:',
  sav_form_title: 'Adicionar uma poupança',
  sav_note_ph: 'Para quê é esta poupança?',
  sav_save: 'Salvar poupança',
  sav_goal_label: 'Atribuir a uma meta (opcional)',
  sav_goal_none: 'Sem meta · poupança geral',
  sav_empty: 'Nenhuma poupança anotada ainda.\nAdicione uma com o formulário acima, ou anote a poupança de uma renda ao registrá-la e ela aparecerá aqui. 🌱',
  sav_from_title: 'Poupança de {date}',
  sav_from_sub: 'De uma renda de {amount}',
  sav_manual_title: 'Poupança adicionada',
  sav_manual_sub: 'Manual · adicionada em {date}',
  sav_delete_income_confirm: 'Excluir esta poupança de {amount} de {date}? Só este valor de poupança é excluído: a renda de {income} continua a mesma.',
  sav_delete_manual_confirm: 'Excluir esta poupança de {amount} de {date}? É uma poupança que você adicionou manualmente em Poupança; só este registro é excluído.',
  err_limit_savings: 'Você atingiu o limite de poupanças salvas.',
  goal_prompt: 'Para quê você está poupando?',
  goal_prompt_sub: 'Crie uma meta e veja sua poupança se aproximar dela.',
  goal_form_create: 'Criar meta',
  goal_form_edit: 'Editar meta',
  goal_name_label: 'Nome da meta',
  goal_name_ph: 'Ex.: Fundo de emergência',
  goal_target_label: 'Valor da meta ($)',
  goal_create_btn: 'Criar meta',
  goal_save_btn: 'Salvar meta',
  goal_progress: 'Você poupou {have} de {target}',
  goal_remaining: 'Faltam {amount}',
  goal_edit: 'Editar meta',
  goal_delete: 'Excluir meta',
  err_goal_name: 'Digite um nome para a sua meta.',
  res_cats_title: 'Gastos por categoria',
  res_summary_title: 'Renda vs Gastos vs Poupança',
  chart_income: 'Renda',
  chart_expenses: 'Gastos',
  chart_savings: 'Poupança',
  res_cats_empty: 'Nenhum gasto este mês.',
  res_summary_empty: 'Nenhuma atividade este mês ainda.',
  bud_intro: 'Defina um limite mensal por categoria e veja quanto você gastou.',
  bud_spent_left: 'Gasto {spent} de {budget} · restam {left}',
  bud_spent_over: 'Gasto {spent} de {budget} · passou em {over}',
  bud_nolimit: 'Sem limite. Gasto este mês: {spent}',
  bud_placeholder: 'Limite mensal $',
  bud_aria: 'Limite mensal para {cat}',
  bud_delete_cat: 'Excluir categoria',
  bud_delete_cat_confirm: 'Excluir a categoria "{cat}"? Os gastos que a usam irão para "{other}".',
  bud_alert_amount: 'Digite um valor válido para o limite.',
  cat_form_title: 'Categoria personalizada',
  cat_name_label: 'Nome da categoria',
  cat_name_ph: 'Ex.: Pets',
  cat_save: 'Adicionar categoria',
  err_cat_name: 'Digite um nome para a categoria.',
  err_cat_exists: 'Essa categoria já existe.',
  fix_intro: 'Pagamentos que se repetem todo mês: aluguel, telefone, assinaturas…',
  fix_new: 'Novo pagamento fixo',
  fix_edit: 'Editar pagamento fixo',
  fix_name_ph: 'Ex.: Aluguel',
  fix_day_label: 'Dia do mês',
  fix_save: 'Salvar pagamento fixo',
  fix_empty: 'Nenhum pagamento fixo ainda.',
  fix_sub: 'Dia {day} de cada mês · {month}',
  fix_mark: 'Marcar pago',
  fix_unmark: 'Desmarcar',
  fix_delete_confirm: 'Excluir o pagamento fixo "{name}"?',
  err_day: 'O dia deve estar entre 1 e 31.',
  err_limit_fixed: 'Você atingiu o limite de pagamentos fixos.',
  acc_new: 'Nova conta',
  acc_edit: 'Editar conta',
  acc_balance_label: 'Saldo ($)',
  acc_name_ph: 'Ex.: Dinheiro, Banco, Poupança',
  acc_save: 'Salvar conta',
  acc_empty: 'Nenhuma conta ainda.\nAdicione uma para ver seu dinheiro disponível no resumo.',
  acc_delete_confirm: 'Excluir a conta "{name}"?',
  err_balance: 'Digite um saldo válido.',
  err_limit_accounts: 'Você atingiu o limite de contas.',
  debt_new: 'Nova dívida',
  debt_edit: 'Editar dívida',
  debt_name_ph: 'Ex.: Cartão, Empréstimo',
  debt_status_label: 'Estado',
  debt_status_pending: 'Pendente',
  debt_status_paid: 'Paga',
  debt_save: 'Salvar dívida',
  debt_empty: 'Nenhuma dívida registrada. 🎉',
  debt_mark_paid: 'Marcar paga',
  debt_mark_pending: 'Marcar pendente',
  debt_delete_confirm: 'Excluir a dívida "{name}"?',
  err_limit_debts: 'Você atingiu o limite de dívidas.',
  name_label: 'Nome',
  san_intro: 'Um san (tanda) é um círculo de poupança: toda semana todos contribuem e uma pessoa recebe o montante, em turnos.',
  san_form_title: 'Criar um san',
  san_name_label: 'Nome do san',
  san_name_ph: 'Ex.: San da família',
  san_aporte_label: 'Contribuição por vez ($)',
  san_participants_label: 'Participantes (na ordem dos turnos)',
  san_pname_ph: 'Nome do participante',
  san_add_participant: 'Adicionar',
  san_create_btn: 'Criar san',
  san_err_participants: 'Adicione pelo menos 2 participantes.',
  san_err_active_exists: 'Já existe um san em andamento («{name}»). Exclua-o primeiro se quiser criar outro.',
  san_err_dup: 'Esse participante já está na lista.',
  san_err_pname: 'Digite o nome do participante.',
  san_remove: 'Remover',
  san_draft_empty: 'Nenhum participante adicionado ainda.',
  san_week: 'Semana {x} de {n}',
  san_finished: '🎉 San finalizado!',
  san_finished_note: 'Todas as semanas estão completas. Você pode excluir este san e criar um novo.',
  san_total_line: 'Total arrecadado: {amount}',
  san_week_collected: 'Arrecadado esta semana: {amount} de {target}',
  san_receiver_line: 'Vez de: {name}',
  san_aporte_line: 'Contribuição por vez: {amount}',
  san_paid_title: 'Quem já pagou esta semana?',
  san_paid: 'pagou',
  san_advance: 'Marcar semana completa',
  san_delete: 'Excluir san',
  san_delete_confirm: 'Excluir o san "{name}"? Seus registros de semanas e pagamentos são excluídos.',
  san_new_btn: 'Criar um novo san',
  san_new_confirm: 'O san atual terminou. Excluí-lo e criar um novo?',
  set_profile: 'Seu perfil',
  set_name_label: 'Seu nome',
  set_textsize_label: 'Tamanho do texto',
  textsize_normal: 'Normal',
  textsize_large: 'Grande',
  set_lang_label: 'Idioma / Language',
  set_reminders_title: 'Lembretes',
  set_payday_label: 'Dia de pagamento',
  set_reminders_label: 'Lembretes em Início',
  wd_none: 'Sem dia de pagamento',
  wd_0: 'Domingo',
  wd_1: 'Segunda',
  wd_2: 'Terça',
  wd_3: 'Quarta',
  wd_4: 'Quinta',
  wd_5: 'Sexta',
  wd_6: 'Sábado',
  set_split_title: 'Divisão sugerida da renda (%)',
  set_split_help: 'Os quatro números devem somar 100. Essas porcentagens são só uma sugestão para dividir sua renda: a poupança nunca é salva automaticamente — você sempre digita quanto realmente poupou de cada renda.',
  split_ahorro: 'Poupança',
  split_negocio: 'Negócio',
  split_gastos: 'Gastos',
  split_familia: 'Família',
  set_save: 'Salvar ajustes',
  set_err_sum: 'As porcentagens devem somar 100. Agora somam {total}.',
  set_saved: 'Ajustes salvos. ✅',
  set_sections_title: 'Seções visíveis',
  set_sections_help: 'Desative as que você não usa para manter uma lista mais curta.',
  set_pin_title: 'Segurança (PIN)',
  pin_status_on: 'Você tem um PIN ativo. O app bloqueia ao abrir.',
  pin_status_off: 'Você não tem PIN. Pode criar um aqui para proteger seus dados.',
  pin_current_label: 'PIN atual (se tiver um)',
  pin_new_label: 'Novo PIN (vazio = remover o PIN)',
  pin_update: 'Atualizar PIN',
  pin_err_current: 'O PIN atual não está correto.',
  pin_err_format: 'O novo PIN deve ter de 4 a 6 números.',
  pin_off: 'PIN desativado.',
  pin_updated: 'PIN atualizado. ✅',
  set_data_title: 'Seus dados',
  set_data_help: 'Tudo fica somente neste telefone. Exporte uma cópia se quiser guardá-la em outro lugar.',
  data_export: 'Exportar cópia (JSON)',
  data_import: 'Importar cópia',
  data_reset: 'Excluir todos os dados',
  data_err_big: 'Esse arquivo é grande demais.',
  data_err_invalid: 'Não foi possível importar: o arquivo não é uma cópia válida do PETO Finanzas.',
  import_confirm: 'Importar substituirá TODOS os dados atuais do app. Tem certeza?',
  import_done: 'Cópia importada. ✅',
  reset_confirm1: 'Isso apaga TODOS os dados do seu app neste telefone. Não pode ser desfeito. Tem certeza?',
  reset_confirm2: 'Confirmação final: apagar tudo e começar do zero?',
  lock_prompt: 'Digite seu PIN para continuar.',
  lock_pin_label: 'PIN',
  lock_enter: 'Desbloquear',
  lock_note: 'Seus dados ficam somente neste telefone.',
  lock_err: 'PIN incorreto. Tente de novo.',
  ob_title: 'Bem-vindo ao PETO Finanzas!',
  ob_intro_1: 'Organize seu dinheiro em minutos: gastos, renda, orçamento, contas e dívidas.',
  ob_intro_2: 'Sem conta, sem internet.',
  ob_intro_3: 'Tudo fica guardado só no seu telefone.',
  ob_name_label: 'Qual é o seu nome?',
  ob_name_ph: 'Seu nome',
  ob_pin_label: 'Crie um PIN de segurança (opcional)',
  ob_pin_ph: '4 a 6 números, ou deixe vazio',
  ob_pin2_label: 'Repita o PIN',
  ob_pin2_ph: 'Repita o PIN',
  ob_start: 'Começar',
  ob_note: 'Você pode trocar o PIN quando quiser em Ajustes.',
  ob_tour1_title: 'Registre um gasto em segundos',
  ob_tour1_text: 'Toque no botão +, digite o valor e a categoria. Só isso: seu gasto fica salvo na hora.',
  ob_tour2_title: 'Quanto você pode gastar hoje?',
  ob_tour2_text: 'O PETO Finanzas distribui seu orçamento pelos dias que restam do mês e te diz um único número: o que você pode gastar hoje sem passar do limite.',
  ob_tour3_title: 'Sua conta na nuvem (opcional)',
  ob_tour3_text: 'Se quiser, crie uma conta grátis para ver seus dados na web também. Sem conta, tudo fica só no seu telefone.',
  ob_tour_next: 'Seguinte',
  ob_tour_skip: 'Pular',
  ob_tour_go: 'Vamos!',
  ob_err_name: 'Digite seu nome para começar.',
  ob_err_pin_format: 'O PIN deve ter de 4 a 6 números.',
  ob_err_pin_mismatch: 'Os dois PINs não coincidem.',
  set_theme_label: 'Tema',
  theme_light: 'Claro',
  theme_dark: 'Escuro',
  theme_auto: 'Automático (sistema)',
  set_accent_label: 'Cor principal',
  accent_verde: 'Verde',
  accent_azul: 'Azul',
  accent_morado: 'Roxo',
  accent_naranja: 'Laranja',
  undo_done: 'Feito',
  undo_btn: 'Desfazer',
  btn_repeat: 'Repetir',
  fab_aria: 'Adicionar rápido',
  quick_title: 'O que você quer adicionar?',
  quick_expense: '🧾 Gasto',
  quick_income: '💵 Renda',
  quick_savings: '🐷 Poupança',
  sec_buscar: 'Buscar atividade',
  search_label: 'Buscar',
  search_ph: 'Nota, categoria ou valor…',
  search_month_label: 'Mês (vazio = todos)',
  search_type_label: 'Tipo',
  type_all: 'Todos',
  type_gastos: 'Gastos',
  type_ingresos: 'Renda',
  type_ahorros: 'Poupança',
  search_empty: 'Sem resultados.',
  search_type_income: 'Renda',
  search_type_saving: 'Poupança',
  chal_title: '🔥 Desafio de poupança semanal',
  chal_progress: 'Esta semana: {have} de {target}',
  chal_done: '🎉 O desafio desta semana está completo!',
  chal_streak_one: 'Sequência: 1 semana completa',
  chal_streak_many: 'Sequência: {n} semanas completas',
  chal_streak_zero: 'Sequência: 0 semanas. Esta pode ser a primeira!',
  streak_one: '🔥 1 dia registrando seguido',
  streak_many: '🔥 {n} dias registrando seguidos',
  chal_target_label: 'Meta de poupança semanal ($)',
  chal_save: 'Salvar meta semanal',
  rep_title: 'Relatório mensal',
  rep_download: 'Baixar imagem',
  rep_share_image: 'Compartilhar imagem',
  trend_title: 'Tendência de gastos',
  trend_weeks: 'Semanas deste mês',
  trend_week: 'Semana {n}',
  trend_empty: 'Nenhum gasto ainda para mostrar a tendência.',
  rep_income: 'Renda',
  rep_expenses: 'Gastos',
  rep_savings: 'Poupança',
  rep_top_cat: 'Categoria principal',
  rep_top3: 'Top 3 categorias',
  rep_goal: 'Meta de poupança',
  rep_none: 'Sem atividade',
  calc_title: 'Calculadora para quitar dívidas',
  calc_intro: 'Compare dois planos para sair das dívidas: pagar a menor primeiro (bola de neve) ou a de maior juro primeiro (avalanche). Cada mês você paga todos os mínimos e o resto vai para a dívida alvo.',
  calc_budget_label: 'Quanto você pode pagar por mês para as dívidas no total? ($)',
  calc_run: 'Calcular',
  calc_snowball: 'Bola de neve (menor saldo primeiro)',
  calc_avalanche: 'Avalanche (maior juro primeiro)',
  calc_result: '{months} meses para ficar sem dívidas · juros aprox. {interest}',
  calc_months_one: '1 mês para ficar sem dívidas · juros aprox. {interest}',
  calc_order: 'Ordem de pagamento:',
  calc_free: 'Você não tem dívidas pendentes! 🎉',
  calc_warn: 'Com esse pagamento mensal, alguma dívida nunca se paga: o pagamento não cobre nem os juros. Aumente o pagamento mensal.',
  calc_note_zero: 'Dívidas sem pagamento mínimo ou juro anotado são calculadas com mínimo de $0 e juro de 0%.',
  calc_err_budget: 'Digite quanto você pode pagar por mês.',
  debt_interest_label: 'Juro anual % (opcional)',
  debt_minpay_label: 'Pagamento mínimo mensal $ (opcional)',
  debt_terms: '{pct}% de juro anual · Mínimo {min}/mês',
  exp_photo_label: 'Foto do recibo (opcional)',
  exp_photo_remove: 'Remover foto',
  photo_close: 'Fechar',
  err_photo_quota: 'Não houve espaço para guardar a foto: o gasto foi salvo sem ela.',
  banner_backup: 'Faz um tempo que você não salva uma cópia dos seus dados. Exporte sua cópia em Ajustes.',
  pro_title: 'PETO Pro',
  pro_card_text: 'Nuvem ilimitada para seus dados, o relatório avançado, o orçamento compartilhado e o modo organizador de san.',
  pro_status_free: 'Você está no plano Grátis agora.',
  pro_status_active: 'O PETO Pro está ativo. Obrigado por apoiar o PETO Finanzas! ⭐',
  pro_status_test: 'O PETO Pro está aberto durante o teste fechado: você tem acesso completo enquanto o teste durar.',
  pro_status_waitlist: 'Você está na lista de espera do PETO Pro.',
  pro_btn_see: 'Ver PETO Pro',
  pro_wall_title: 'Isto é uma função do PETO Pro ⭐',
  pro_price_line: 'Só $1.99 por mês',
  pro_benefit_cloud: '☁️ Nuvem ilimitada para seus dados',
  pro_benefit_report: '📊 Relatório avançado: compare meses e exporte CSV',
  pro_benefit_shared: '🏠 Orçamento compartilhado com sua casa',
  pro_benefit_org: '🤝 Modo organizador de san: a tanda de todo o grupo',
  pro_coming_text: 'A compra dentro do app chega com o lançamento no Google Play. Enquanto isso você pode entrar na lista de espera: avisaremos assim que você puder ativar o Pro por $1.99 por mês.',
  pro_waitlist_btn: 'Entrar na lista de espera',
  pro_waitlist_done: 'Você está na lista ✅ Avisaremos quando o Pro estiver disponível.',
  pro_close: 'Agora não',
  pro_tag: 'PRO',
  adv_title: 'Relatório avançado',
  adv_note: 'Uma função do PETO Pro: este mês vs o anterior, cada categoria e uma exportação CSV do mês.',
  adv_open_btn: 'Ver relatório avançado',
  adv_export_csv: 'Exportar o mês como CSV',
  adv_this_month: 'Este mês',
  adv_prev_month: 'Mês anterior',
  adv_change: 'Variação',
  adv_all_cats: 'Todas as categorias',
  adv_empty: 'Nenhuma atividade nestes dois meses.',
  org_title: 'Modo organizador de san',
  org_intro: 'Administre a tanda de todo o grupo: turnos com datas, marque quem já pagou em cada rodada e compartilhe o estado com o grupo.',
  org_pro_note: 'O modo organizador é uma função do PETO Pro.',
  org_form_title: 'Criar o san do grupo',
  org_freq_label: 'Frequência das rodadas',
  org_freq_semanal: 'Semanal',
  org_freq_quincenal: 'A cada 2 semanas',
  org_freq_mensual: 'Mensal',
  org_start_label: 'Data da primeira rodada',
  org_create_btn: 'Criar san organizado',
  org_round: 'Rodada {x} de {n}',
  org_receiver_line: 'Recebe: {name}',
  org_pending_none: 'Todos pagaram! 🎉',
  org_pending_list: 'Falta pagar: {names}',
  org_pending_count_one: 'Falta 1',
  org_pending_count_many: 'Faltam {n}',
  org_totals_title: 'Contribuições por participante',
  org_paid_rounds: '{paid} de {n} rodadas pagas',
  org_delete: 'Excluir san organizado',
  org_delete_confirm: 'Excluir o san organizado "{name}"? O registro de pagamentos do grupo será perdido.',
  org_share_title: 'Estado do san',
  shared_live_note: 'Compartilhe o orçamento com sua casa: crie uma casa ou entre com um código e vocês verão os mesmos membros. Você precisa da sua conta na nuvem (acima, em Ajustes) e do PETO Pro.',
  shared_leave_live: 'Sair desta casa? Você deixará de ver seu orçamento compartilhado.',
  shared_err_login: 'Primeiro entre com sua conta na nuvem (acima, em Ajustes) e tente de novo.',
  shared_err_generic: 'Não pôde ser concluído. Verifique sua conexão e tente de novo.',
  shared_err_code_live: 'Esse código não existe. Verifique e tente de novo.',
  shared_err_member: 'Você já é membro desta casa.',
  shared_err_owner_leave: 'Você é o dono desta casa: não pode sair sem excluí-la. Peça a outro membro para criar a nova casa.',
  shared_created_live: 'Casa criada ✅ Compartilhe o código para convidar sua casa.',
  shared_joined_live: 'Você entrou na casa ✅',
  lang_auto: 'Automático (idioma do telefone)',
  org_comp_label: 'Compensação do organizador',
  org_comp_none: 'Sem compensação',
  org_comp_first: 'O organizador recebe primeiro',
  org_comp_last: 'O organizador recebe por último',
  org_comp_extra: 'Taxa extra por rodada',
  org_comp_amount_label: 'Taxa extra por pessoa ($)',
  org_comp_line: 'Compensação do organizador: {mode}',
  org_sim_title: 'Simulação do pote',
  org_sim_pays: 'Cada participante coloca por rodada: {amount}',
  org_sim_pot: 'Pote de cada rodada: {amount}',
  org_sim_total_in: 'Total que cada um coloca em todo o san: {amount}',
  org_sim_extra_org: 'O organizador recebe {amount} extra por rodada',
  org_sim_first: 'O organizador recebe o pote da primeira rodada',
  org_sim_last: 'O organizador recebe o pote da última rodada',
  org_shuffle_btn: '🎲 Sortear a ordem',
  org_shuffled: '🎲 Ordem sorteada! Assim ficou o turno.',
  org_shuffle_need: 'Adicione pelo menos 2 participantes para sortear a ordem.',
  org_shuffle_blocked: 'Não dá mais para sortear: o san já começou ou já tem pagamentos registrados.',
  org_start_btn: 'Iniciar o san',
  org_started_line: 'San em andamento · A ordem está bloqueada',
  org_order_title: 'Ordem dos turnos',
  org_move_up: 'Subir',
  org_move_down: 'Descer',
  org_swap_blocked: 'Esse turno já tem pagamentos e não pode ser alterado.',
  org_history_title: 'Histórico de alterações',
  org_history_swap: '{a} e {b} trocaram de turno',
  org_history_started: 'O organizador iniciou o san',
  org_pay_pending: 'Pendente',
  org_pay_reported: 'Reportado',
  org_pay_confirmed: 'Confirmado',
  org_status_btn: 'Estado: {status}',
  org_receipt_add: '📎 Comprovante',
  org_receipt_view: 'Ver comprovante',
  org_receipt_remove: 'Remover',
  org_zelle_label: 'Zelle de cada participante (número ou e-mail, opcional)',
  org_zelle_ph: 'Zelle (opcional)',
  org_zelle_line: 'Zelle: {zelle}',
  org_reminder_btn: '📲 Lembrete pelo WhatsApp',
  org_reminder_head: '🤝 {san} · Rodada {x} de {n} · {date}',
  org_reminder_receiver: '💰 Nesta semana recebe {name}',
  org_reminder_zelle: 'Zelle de {name}: {zelle}',
  org_reminder_amount: 'Contribuição da rodada: {amount}',
  org_antifraud: '🛡️ Um san nunca paga juros nem mais do que foi contribuído.',
  org_link_btn: '🔗 Link somente leitura',
  org_link_publish: 'Criar link',
  org_link_update: 'Atualizar link',
  org_link_copied: 'Link copiado!',
  org_link_need_cloud: 'O link precisa da sua conta na nuvem: entre em Configurações e tente novamente.',
  org_link_ready: 'San do grupo (somente leitura)',
  org_public_title: 'O link está pronto para compartilhar.',
  org_public_updated: 'Atualizado em {date}',
  org_public_notfound: 'Este link não está mais disponível.',
  org_pub_pay_btn: 'Já paguei',
  org_pub_confirm: 'Você já pagou sua parte desta rodada? O organizador vai confirmar.',
  org_pub_attach: '📎 Anexar foto do comprovante (opcional)',
  org_pub_send: 'Enviar reporte',
  org_pub_sent: 'Pronto! Seu pagamento foi reportado.',
  org_pub_reported_note: 'Reportado · aguardando confirmação',
  org_pub_err: 'Não foi possível enviar. Verifique sua conexão e tente de novo.',
  org_pub_err_confirmed: 'Este pagamento já foi confirmado pelo organizador.',
  org_pub_err_photo: 'A foto é grande demais; tente uma menor.',
  org_penalty_label: 'Regra de atraso',
  org_penalty_none: 'Sem multa',
  org_penalty_fixed: 'Multa fixa',
  org_penalty_percent: 'Porcentagem da contribuição',
  org_penalty_amount_label: 'Valor da multa ($)',
  org_penalty_percent_label: 'Porcentagem da multa (%)',
  org_penalty_line_fixed: 'Se alguém atrasar: multa de {amount}',
  org_penalty_line_percent: 'Se alguém atrasar: multa de {percent}% da contribuição',
  set_news_title: 'Novidades',
  news_c24: 'Compilación 24: tutorial de boas-vindas, sequência de dias registrando, metas de poupança com barra de progresso e gráfico de tendência.',
  news_c25: 'Compilación 25: widget na tela inicial e um app muito mais leve (de 52 MB para 7 MB).',
  news_c26: 'Compilación 26: widgets em três tamanhos, com opções por widget e botão para registrar uma despesa sem abrir o app.',
  news_c27: 'Compilación 27: o app em 12 idiomas, seguindo sozinho o idioma do seu telefone.',
  news_c28: 'Compilación 28: letra maior aplicada desde a abertura, esta seção de novidades, revisão do italiano e abertura mais rápida.',
  news_c31: 'Compilación 31: o botão ou gesto de voltar agora se move dentro do app: fecha o que estiver aberto e volta à tela principal antes de sair.',
  news_c32: 'Compilação 32: a marca agora é «PETO Finanzas» em todo o app (menu, bloqueio e widgets), o san ficou em primeiro na lista do Início, o link público do san abre direto no estado do grupo e os botões do organizador sempre respondem com uma mensagem clara.',
  news_c33: 'Compilação 33: criar um san já não pode apagar o que está em andamento — se já houver um ativo, o app avisa e o protege (pagamentos, comprovantes, histórico e link público) — e a versão web ficou sincronizada com o telefone.',
  news_c34: 'Compilação 34: novo logo do PETO Finanzas — o “P” branco com barras e seta em verde suave sobre fundo esmeralda, já no ícone, na tela de bloqueio e em todo o app.',
  news_c35: 'Compilação 35: pelo link público do san agora você pode reportar seu pagamento com «Já paguei» e anexar o comprovante (o organizador confirma), o visualizador usa o tema escuro, o app atualiza ao puxar para baixo e o leitor de PDF não confunde mais os Zelle que você envia com receita.',
  sec_podcast: 'Podcast',
  key_podcast: 'Finanzas Personales, o podcast',
  pod_hosts: 'com Lucía e Marco',
  pod_desc: 'Dinheiro sem complicação: dicas práticas para poupar, sair das dívidas e cuidar do seu bolso, em episódios curtos.',
  pod_spotify_btn: 'Ouvir no Spotify',
  pod_loading: 'Carregando episódios…',
  pod_offline: 'Sem conexão: mostrando a última lista baixada',
  pod_error: 'Não foi possível carregar os episódios. Verifique sua conexão e tente novamente.',
  pod_empty: 'Ainda não há episódios publicados.',
  pod_play_aria: 'Reproduzir',
  pod_pause_aria: 'Pausar',
  pod_audio_error: 'Não foi possível reproduzir este episódio.',
  pub_tagline: 'Seu san, organizado e transparente',
  pub_progress: '{x} de {n} pagamentos confirmados',
  pub_progress_start: 'Está só começando: ainda não há pagamentos confirmados',
  pub_cta_title: 'Quer organizar seu próprio san?',
  pub_cta_text: 'Com o PETO Finanzas você mantém a ordem, os turnos e os comprovantes em um só lugar, sem cadernos nem confusão.',
  pub_cta_try: 'Testar o PETO Finanzas',
  pub_cta_more: 'Saiba mais',
  pub_bar_try: 'Testar o app',
  pub_footer: 'Feito com PETO Finanzas · petofinanzas.com',
  news_c36: 'Compilação 36: nova seção Podcast — ouça «Finanzas Personales» sem sair do app, com reprodutor integrado e a lista salva para quando não há internet — a boas-vindas agora avança sozinha, tela a tela — e a vista do link renovada: o san se apresenta com seu progresso e acesso direto para testar o app.',
  news_c37: 'Compilação 37: widgets renovados — degradê da marca, barra de progresso que muda de cor conforme seu orçamento e a linha do próximo turno do seu san — e um widget novo do tamanho de um ícone, com o que você pode gastar hoje — e a marca sempre visível ao rolar o link público do san — e as rodadas do organizador agora dobram em acordeão, com só a desta semana aberta.',
  widget_today: 'hoje',
  widget_san_next: 'Próximo turno: {name} · {date}',
  widget_san_next_nodate: 'Próximo turno: {name}',
  back_exit_hint: 'Toque em voltar outra vez para sair.'
},
fr: {
  org_err_san_name: 'Saisis le nom du san.', rep_promo_footer: 'Contrôle tes dépenses avec PETO Finanzas · petofinanzas.com', rep_saved: 'Image enregistrée.', set_sections_summary: '{visible} sur {total} visibles',
  org_err_active_exists: 'Il existe déjà un san actif (« {name} »). Supprime-le d’abord depuis sa fiche si tu veux en créer un autre.',
  app_title: 'PETO Finanzas',
  back: '← Toutes les options',
  greeting: 'Bonjour',
  lock_btn: 'Verrouiller',
  home_menu_heading: 'Que veux-tu voir ?',
  group_daily: 'Au quotidien',
  group_plan: 'Planification',
  group_accounts: 'Comptes et engagements',
  group_yourapp: 'Ton appli',
  sec_gastos: 'Dépenses du mois',
  sec_ingresos: 'Revenus hebdomadaires',
  sec_ahorros: 'Épargne',
  sec_resumen: 'Résumé',
  sec_presupuesto: 'Budget par catégorie',
  sec_pagos: 'Paiements fixes',
  sec_cuentas: 'Mes comptes',
  sec_deudas: 'Mes dettes',
  sec_san: 'Mon san (tanda)',
  sec_ajustes: 'Réglages et personnalisation',
  menu_open_aria: 'Ouvrir le menu',
  menu_close_aria: 'Fermer le menu',
  sec_home: 'Accueil',
  key_home: 'Ton écran principal',
  set_notif_label: 'Notifications quand l’appli est fermée',
  set_notif_help: 'Des alertes pour tes paiements fixes la veille et le jour même, même quand PETO Finanzas est fermée.',
  set_autofixed_label: 'Enregistrer les paiements fixes automatiquement',
  set_autofixed_help: 'Quand un paiement fixe arrive à échéance, la dépense est enregistrée pour toi. Tu peux l’annuler aussitôt.',
  set_bio_label: 'Déverrouillage par empreinte digitale',
  set_bio_help: 'Entre avec ton empreinte en plus de ton code PIN (un code PIN actif est nécessaire).',
  bio_btn: '👆 Entrer avec l’empreinte digitale',
  bio_reason: 'Confirme que c’est bien toi pour ouvrir PETO Finanzas',
  bio_need_pin: 'L’empreinte digitale nécessite un code PIN actif : crée ton code PIN dans Réglages → Sécurité et l’empreinte fonctionnera à l’ouverture de l’appli.',
  bio_failed: 'L’empreinte n’a pas pu être vérifiée. Tape ton code PIN.',
  bio_unavailable: 'L’empreinte digitale n’est pas disponible sur ce téléphone. Tape ton code PIN.',
  bio_not_enrolled: 'Ce téléphone n’a aucune empreinte enregistrée. Enregistres-en une dans les réglages du téléphone ou tape ton code PIN.',
  bio_offer_title: 'Déverrouiller avec ton empreinte ?',
  bio_offer_text: 'Tu viens de créer ton code PIN. Si tu veux, tu peux ouvrir PETO Finanzas avec ton empreinte au lieu de taper ton code PIN à chaque fois. On l’active maintenant ?',
  bio_offer_yes: 'Oui, activer l’empreinte',
  bio_offer_no: 'Pas maintenant',
  bio_activated: 'C’est fait : le déverrouillage par empreinte est activé.',
  fix_auto_suffix: '(paiement fixe automatique)',
  backup_pass_label: 'Mot de passe de la copie chiffrée',
  backup_pass_ph: 'Au moins 4 caractères',
  data_export_enc: 'Exporter la copie chiffrée',
  backup_help: 'La copie chiffrée ne s’ouvre qu’avec ton mot de passe. Sans lui, elle est irrécupérable : garde-le en lieu sûr. Pour importer une copie chiffrée, tape son mot de passe ici avant de choisir le fichier.',
  backup_err_short: 'Le mot de passe doit contenir au moins 4 caractères.',
  backup_need_pass: 'Tape le mot de passe de la copie chiffrée avant de l’importer.',
  backup_err_pass: 'Impossible d’ouvrir la copie : mot de passe incorrect ou fichier endommagé.',
  share_btn: 'Partager le résumé',
  share_copied: 'Résumé copié. Colle-le où tu veux.',
  review_title: 'Tu aimes PETO Finanzas ?',
  review_text: 'Si PETO Finanzas t’aide à prendre soin de ton argent, un avis sur Google Play nous aide beaucoup à toucher plus de monde. Merci !',
  review_yes: '⭐ Noter sur Google Play',
  review_no: 'Pas maintenant',
  share_report_title: 'Mon résumé PETO Finanzas',
  notif_fixed_title: 'Paiement fixe demain',
  notif_fixed_today: 'Paiement fixe aujourd’hui',
  notif_fixed_body: '{name} · {amount}',
  notif_weekly_title: 'Ta semaine dans PETO Finanzas',
  notif_weekly_body: 'Enregistre les dépenses et les revenus de cette semaine pour garder le cap.',
  summary_title: 'Résumé quotidien',
  summary_help: 'Un avis avec ce que tu as dépensé hier et ce que tu peux dépenser aujourd’hui, à l’heure que tu choisis.',
  summary_notif_label: 'Résumé par notification',
  summary_time_label: 'Heure du résumé',
  summary_email_label: 'Le recevoir aussi par e-mail',
  summary_email_help: 'Uniquement avec ton compte cloud actif : le même résumé arrive aussi dans ta boîte e-mail.',
  notif_summary_title: '🌅 Ton résumé PETO Finanzas',
  notif_summary_body: 'Hier tu as dépensé {spent} · Aujourd’hui tu peux dépenser {daily}',
  notif_summary_body_nodaily: 'Hier tu as dépensé {spent}',
  sec_remesas: 'Envois d’argent',
  key_remesas: 'Envoyé ce mois-ci : {amount}',
  rem_intro: 'L’argent que tu envoies à tes proches : combien est parti en dollars et combien est arrivé dans leur devise.',
  rem_usd_label: 'Montant envoyé ($ USD)',
  rem_rate_label: 'Taux ({cur} pour 1 $)',
  rem_recipient_label: 'Pour qui ?',
  rem_currency_label: 'Devise de destination',
  rem_arrives_label: 'Arrive',
  rem_rate_suggested: 'Dernier taux utilisé pour {cur} : {rate}. Il est déjà rempli ; modifie-le si celui d’aujourd’hui est différent.',
  rem_month_sent: 'Ce mois-ci, tu as envoyé {usd}',
  rem_totals_title: 'Totaux par devise (tout l’historique)',
  rem_total_row: '{usd} envoyés → {amount} reçus · {n} envois',
  rem_save: 'Enregistrer l’envoi',
  rem_empty: 'Aucun envoi enregistré pour le moment.',
  rem_delete_confirm: 'Supprimer l’envoi pour {name} ?',
  csv_title: 'Importer un relevé bancaire (CSV)',
  csv_help: 'Envoie le fichier CSV de ta banque et vérifie tout dans un aperçu avant d’importer : rien n’est enregistré tant que tu n’as pas confirmé.',
  csv_file_label: 'Fichier CSV de la banque',
  csv_preview_title: 'Aperçu de l’importation',
  csv_summary: '{total} opérations · {dups} doublons (exclus) · {sel} à importer',
  csv_dup_badge: 'Doublon',
  csv_income_badge: 'Revenu',
  csv_expense_badge: 'Dépense',
  csv_all: 'Tout cocher',
  csv_none: 'Tout décocher',
  csv_apply: 'Importer la sélection',
  csv_cancel: 'Annuler l’importation',
  csv_done: '{n} opérations importées. ✅',
  csv_none_selected: 'Tu n’as coché aucune opération à importer.',
  csv_err_parse: 'Ce fichier n’a pas pu être lu comme un CSV. Vérifie qu’il s’agit bien du relevé bancaire au format CSV.',
  csv_err_headers: 'Les colonnes de date et de montant n’ont pas été trouvées dans ce fichier.',
  csv_err_big: 'Ce fichier est trop volumineux pour être importé.',
  csv_err_empty: 'Ce fichier ne contient aucune opération importable.',
  pdf_err_big: 'Ce PDF est trop volumineux (maximum 8 Mo).',
  pdf_err_notext: 'Ce PDF n’a pas de texte lisible (on dirait une photo ou un scan). Essaie le CSV de la banque ou note la dépense avec la photo du reçu.',
  pdf_err_empty: 'Je n’ai trouvé aucune opération avec date et montant dans ce PDF. Essaie le CSV de la banque.',
  shared_title: 'Budget partagé',
  shared_preview_note: '🔧 Aperçu du design : il ne se connecte pas encore à d’autres comptes. Utilise-le pour essayer à quoi ressembleront la création d’un foyer, l’entrée avec un code et la liste des membres.',
  shared_create_label: 'Nom du foyer',
  shared_create_btn: 'Créer un foyer',
  shared_join_label: 'Code d’invitation',
  shared_join_btn: 'Rejoindre avec un code',
  shared_members_title: 'Membres',
  shared_code_label: 'Code d’invitation : {code}',
  shared_role_dueno: 'Propriétaire',
  shared_role_admin: 'Administrateur',
  shared_role_miembro: 'Membre',
  shared_role_lector: 'Lecture seule',
  shared_you: 'Toi',
  shared_host: 'Hôte',
  shared_leave_btn: 'Quitter le foyer',
  shared_leave_confirm: 'Quitter ce foyer ? (aperçu)',
  shared_err_name: 'Donne un nom au foyer.',
  shared_err_code: 'Le code comporte 6 lettres ou chiffres.',
  shared_created: 'Foyer créé (aperçu). ✅',
  shared_joined: 'Tu as rejoint le foyer (aperçu). ✅',
  shared_household_fallback: 'Foyer partagé',
  privacy_hide: 'Masquer les montants',
  privacy_show: 'Afficher les montants',
  ins_title: '💡 Idées pour ton argent',
  ins_cat_up: '{cat} a augmenté de {pct} % par rapport au mois dernier ({from} → {to}).',
  ins_pace_down: 'Ton rythme s’améliore : les dépenses ont baissé de {pct} % par rapport au mois dernier.',
  ins_pace_up: 'Attention : ton rythme de dépenses a augmenté de {pct} % par rapport au mois dernier.',
  ins_biggest: 'Ta plus grosse dépense ce mois-ci : {note} · {amount}.',
  ins_saved: 'Tu as épargné {amount} ce mois-ci. Continue comme ça !',
  bud_alert_title: 'Budget en danger',
  bud_alert_warn: '{cat} : tu es à {pct} % du budget.',
  bud_alert_over: '{cat} : tu as dépassé le budget ({pct} %).',
  voice_btn: '🎤 Dicter',
  voice_listening: 'J’écoute… dis le montant et à quoi ça correspond.',
  voice_unavailable: 'La voix n’est pas disponible sur cet appareil.',
  voice_heard: 'J’ai entendu : « {text} ». Vérifie et enregistre.',
  voice_no_amount: 'J’ai entendu : « {text} », mais je n’ai pas trouvé le montant.',
  ocr_found: 'J’ai détecté {amount} sur le ticket. Vérifie avant d’enregistrer.',
  goals_title: 'Plus d’objectifs',
  goal2_create: 'Créer un objectif',
  goal_add: '+ Ajouter',
  goal_take: '− Retirer',
  goal_done: '🎉 Objectif atteint !',
  goal_move_label: 'Montant',
  goal_delete_confirm: 'Supprimer l’objectif « {name} » ? Ton épargne n’est pas touchée : seul l’objectif est supprimé.',
  err_limit_goals: 'Tu as déjà le nombre maximal d’objectifs.',
  biz_label: 'C’est pour mon activité',
  biz_title: 'Mon activité ce mois-ci',
  biz_income: 'Revenus de l’activité',
  biz_expenses: 'Dépenses de l’activité',
  biz_profit: 'Bénéfice',
  chal_share: 'Partager mon défi',
  cloud_title: 'Compte cloud',
  cloud_help: 'Avec un compte, tes données sont aussi gardées dans le cloud et synchronisées : change de téléphone, connecte-toi avec ton e-mail et tout est là. Sans compte, l’appli fonctionne seulement sur ce téléphone, comme toujours.',
  cloud_email: 'E-mail',
  cloud_pass: 'Mot de passe',
  cloud_signin: 'Se connecter',
  cloud_signup: 'Créer un compte',
  cloud_signout: 'Se déconnecter',
  cloud_sync_now: 'Synchroniser maintenant',
  cloud_wipe: 'Supprimer mes données du cloud',
  cloud_who: 'Connecté en tant que {email}',
  cloud_synced: 'Synchronisé ✓ · {time}',
  cloud_never: 'Pas encore synchronisé.',
  cloud_working: 'En cours…',
  cloud_ok_in: 'Bon retour !',
  cloud_ok_up: 'Compte créé ! Tes données sont maintenant dans le cloud.',
  cloud_err_fields: 'Saisis ton e-mail et un mot de passe d’au moins 6 caractères.',
  cloud_err_login: 'Connexion impossible. Vérifie ton e-mail et ton mot de passe.',
  cloud_err_exists: 'Cet e-mail a déjà un compte. Utilise « Se connecter ».',
  cloud_err_confirm: 'Compte créé. Vérifie ton e-mail pour confirmer ton compte, puis connecte-toi.',
  cloud_err_generic: 'Quelque chose a échoué avec le cloud. Vérifie ta connexion et réessaie.',
  cloud_conflict: 'Le cloud et ce téléphone contiennent des données différentes. Télécharger les données du cloud et remplacer celles de ce téléphone ? (Annuler = envoyer les données de ce téléphone)',
  cloud_wipe_confirm: 'Supprimer TOUTES tes données du cloud ? Ce qui est sur ce téléphone reste tel quel.',
  cloud_delete: 'Supprimer mon compte',
  cloud_delete_confirm1: 'Supprimer ton compte PETO Finanzas ? Cela supprime ton compte, ta copie des données dans le cloud et les foyers partagés dont tu es propriétaire. Les données de CE téléphone restent ici, intactes (tu peux les effacer dans Réglages). C’est irréversible.',
  cloud_delete_confirm2: 'Confirmation finale : supprimer ton compte pour de bon ?',
  cloud_deleted: 'Ton compte a été supprimé.',
  cloud_delete_err_auth: 'Ta session n’est plus valable. Reconnecte-toi et réessaie.',
  cloud_unavailable: 'Le cloud n’est pas disponible dans cette version.',
  key_settings: 'Nom, répartition, texte, sections, PIN',
  footer: 'PETO Finanzas · Fonctionne hors ligne · Le cloud est facultatif : tes données, ton choix',
  tile_available: 'Argent disponible',
  tile_available_aria: 'Argent disponible : aller à Mes comptes',
  tile_savings: 'Épargne de ce mois-ci',
  tile_savings_aria: 'Épargne de ce mois-ci : aller à Épargne',
  tile_debts: 'Dettes en attente',
  tile_debts_aria: 'Dettes en attente : aller à Mes dettes',
  tile_incomes: '💵 Revenus',
  tile_incomes_aria: 'Revenus : aller à Revenus hebdomadaires',
  tile_expenses: '🧾 Dépenses',
  tile_expenses_aria: 'Dépenses : aller à Dépenses du mois',
  tile_goal: 'Objectif « {name} » : {pct} %',
  key_spent_month: '{amount} dépensés ce mois-ci',
  key_income_month: '{amount} reçus ce mois-ci',
  key_saved_total: '{amount} épargnés au total',
  key_goal_suffix: ' · Objectif « {name} » : {pct} %',
  key_budget_one: '{n} catégorie avec une limite',
  key_budget_many: '{n} catégories avec une limite',
  key_fixed: '{amount} par mois · {n} à payer',
  key_available: 'Disponible : {amount}',
  key_debts: '{amount} en attente',
  key_san: 'Semaine {x} sur {n} · Au tour de : {name}',
  key_san_done: 'San terminé 🎉',
  key_san_none: 'Aucun san actif',
  banner_payday: 'Aujourd’hui c’est jour de paie : enregistre tes revenus et ton épargne.',
  banner_dues_title: 'Paiements bientôt dus :',
  banner_due_item: '{name} (jour {day})',
  banner_close: 'Ignorer',
  spend_title: 'Combien peux-tu dépenser aujourd’hui ?',
  spend_note: 'C’est ce que tu peux dépenser aujourd’hui sans dépasser.',
  spend_guide: 'Crée le budget de ta première catégorie et tu verras ici combien tu peux dépenser chaque jour.',
  spend_left: 'Il te reste {amount} pour les {days} jours restants du mois.',
  spend_left_one: 'Il te reste {amount} pour aujourd’hui, le dernier jour du mois.',
  spend_over: 'Tu as atteint le budget de ce mois-ci.',
  spend_over_by: 'Tu dépasses de {amount}.',
  cat_Renta: 'Loyer',
  cat_Comida: 'Nourriture',
  "cat_Comida fuera": 'Restaurants',
  cat_Gasolina: 'Essence',
  cat_Transporte: 'Transport',
  cat_Salud: 'Santé',
  cat_Ropa: 'Vêtements',
  cat_Otros: 'Autre',
  btn_cancel: 'Annuler',
  btn_save: 'Enregistrer',
  btn_edit: 'Modifier',
  btn_delete: 'Supprimer',
  err_amount: 'Saisis un montant valide, supérieur à 0 $.',
  err_amount_generic: 'Saisis un montant valide.',
  err_name: 'Saisis un nom.',
  chip_paid: 'Payé',
  chip_pending: 'En attente',
  month_prev_aria: 'Mois précédent',
  month_next_aria: 'Mois suivant',
  exp_new: 'Nouvelle dépense',
  exp_edit: 'Modifier la dépense',
  exp_total_label: 'Total du mois :',
  amount_label: 'Montant ($)',
  category_label: 'Catégorie',
  date_label: 'Date',
  note_label: 'Note (facultatif)',
  exp_note_ph: 'C’était pour quoi ?',
  exp_save: 'Enregistrer la dépense',
  exp_empty: 'Aucune dépense ce mois-ci pour le moment.\nAjoute la première avec le formulaire ci-dessus. 👍',
  exp_delete_confirm: 'Supprimer cette dépense de {amount} ? Catégorie {cat}, le {date}. Seule cette dépense est supprimée.',
  err_category: 'Choisis une catégorie valide.',
  err_limit_expenses: 'Tu as atteint la limite de dépenses enregistrées.',
  inc_intro: 'L’épargne n’est jamais automatique : tu saisis combien tu as vraiment épargné de chaque revenu. L’appli suggère seulement un montant basé sur ton pourcentage dans les Réglages.',
  inc_new: 'Nouveau revenu',
  inc_edit: 'Modifier le revenu',
  inc_note_ph: 'D’où vient-il ?',
  inc_savings_label: 'Épargne ($)',
  inc_savings_label_sug: 'Épargne (suggérée : {amount})',
  inc_savings_help: 'Une suggestion basée sur ton pourcentage d’épargne — change-la pour ce que tu as vraiment épargné. Tu peux saisir 0 $.',
  inc_split_line: 'Épargné : {sav} · Suggestion : Activité {biz} · Dépenses {exp} · Famille {fam}',
  inc_split_preview: 'Répartition suggérée : Épargne {sav} · Activité {biz} · Dépenses {exp} · Famille {fam}. L’épargne qui compte est celle que tu saisis ci-dessous.',
  inc_save: 'Enregistrer le revenu',
  inc_empty: 'Aucun revenu enregistré pour le moment.\nAjoute ton premier revenu et saisis combien tu en as épargné. 💪',
  inc_delete_confirm: 'Supprimer ce revenu de {amount} du {date} ? Son épargne notée de {savings} est aussi supprimée.',
  err_inc_savings: 'Saisis combien tu as épargné de ce revenu (ça peut être 0 $).',
  err_limit_incomes: 'Tu as atteint la limite de revenus enregistrés.',
  sav_intro_1: 'Ici tu vois chaque montant épargné, un par un. Tu peux aussi ajouter une épargne indépendante,',
  sav_intro_2: 'non liée à un revenu',
  sav_intro_3: ', avec le formulaire ci-dessous. Si tu supprimes une épargne, seul ce montant est supprimé :',
  sav_intro_4: 'le revenu reste le même',
  sav_intro_5: '.',
  sav_total_label: 'Total épargné :',
  sav_month_label: 'Épargné ce mois-ci :',
  sav_form_title: 'Ajouter une épargne',
  sav_note_ph: 'À quoi sert cette épargne ?',
  sav_save: 'Enregistrer l’épargne',
  sav_goal_label: 'Attribuer à un objectif (facultatif)',
  sav_goal_none: 'Sans objectif · épargne générale',
  sav_empty: 'Aucune épargne notée pour le moment.\nAjoutes-en une avec le formulaire ci-dessus, ou note l’épargne d’un revenu quand tu l’enregistres et elle apparaîtra ici. 🌱',
  sav_from_title: 'Épargne du {date}',
  sav_from_sub: 'D’un revenu de {amount}',
  sav_manual_title: 'Épargne ajoutée',
  sav_manual_sub: 'Manuelle · ajoutée le {date}',
  sav_delete_income_confirm: 'Supprimer cette épargne de {amount} du {date} ? Seul ce montant d’épargne est supprimé : le revenu de {income} reste le même.',
  sav_delete_manual_confirm: 'Supprimer cette épargne de {amount} du {date} ? C’est une épargne que tu as ajoutée à la main dans Épargne ; seule cette entrée est supprimée.',
  err_limit_savings: 'Tu as atteint la limite d’épargnes enregistrées.',
  goal_prompt: 'Pour quoi épargnes-tu ?',
  goal_prompt_sub: 'Crée un objectif et regarde ton épargne s’en approcher.',
  goal_form_create: 'Créer un objectif',
  goal_form_edit: 'Modifier l’objectif',
  goal_name_label: 'Nom de l’objectif',
  goal_name_ph: 'Ex. : Fonds d’urgence',
  goal_target_label: 'Montant de l’objectif ($)',
  goal_create_btn: 'Créer l’objectif',
  goal_save_btn: 'Enregistrer l’objectif',
  goal_progress: 'Tu as épargné {have} sur {target}',
  goal_remaining: 'Il reste {amount}',
  goal_edit: 'Modifier l’objectif',
  goal_delete: 'Supprimer l’objectif',
  err_goal_name: 'Donne un nom à ton objectif.',
  res_cats_title: 'Dépenses par catégorie',
  res_summary_title: 'Revenus vs Dépenses vs Épargne',
  chart_income: 'Revenus',
  chart_expenses: 'Dépenses',
  chart_savings: 'Épargne',
  res_cats_empty: 'Aucune dépense ce mois-ci.',
  res_summary_empty: 'Aucune activité ce mois-ci pour le moment.',
  bud_intro: 'Fixe une limite mensuelle par catégorie et vois combien tu as dépensé.',
  bud_spent_left: 'Dépensé {spent} sur {budget} · il reste {left}',
  bud_spent_over: 'Dépensé {spent} sur {budget} · dépassement de {over}',
  bud_nolimit: 'Pas de limite. Dépensé ce mois-ci : {spent}',
  bud_placeholder: 'Limite mensuelle $',
  bud_aria: 'Limite mensuelle pour {cat}',
  bud_delete_cat: 'Supprimer la catégorie',
  bud_delete_cat_confirm: 'Supprimer la catégorie « {cat} » ? Les dépenses qui l’utilisent iront dans « {other} ».',
  bud_alert_amount: 'Saisis un montant valide pour la limite.',
  cat_form_title: 'Catégorie personnalisée',
  cat_name_label: 'Nom de la catégorie',
  cat_name_ph: 'Ex. : Animaux',
  cat_save: 'Ajouter la catégorie',
  err_cat_name: 'Donne un nom à la catégorie.',
  err_cat_exists: 'Cette catégorie existe déjà.',
  fix_intro: 'Les paiements qui se répètent chaque mois : loyer, téléphone, abonnements…',
  fix_new: 'Nouveau paiement fixe',
  fix_edit: 'Modifier le paiement fixe',
  fix_name_ph: 'Ex. : Loyer',
  fix_day_label: 'Jour du mois',
  fix_save: 'Enregistrer le paiement fixe',
  fix_empty: 'Aucun paiement fixe pour le moment.',
  fix_sub: 'Jour {day} de chaque mois · {month}',
  fix_mark: 'Marquer payé',
  fix_unmark: 'Démarquer',
  fix_delete_confirm: 'Supprimer le paiement fixe « {name} » ?',
  err_day: 'Le jour doit être entre 1 et 31.',
  err_limit_fixed: 'Tu as atteint la limite de paiements fixes.',
  acc_new: 'Nouveau compte',
  acc_edit: 'Modifier le compte',
  acc_balance_label: 'Solde ($)',
  acc_name_ph: 'Ex. : Espèces, Banque, Épargne',
  acc_save: 'Enregistrer le compte',
  acc_empty: 'Aucun compte pour le moment.\nAjoutes-en un pour voir ton argent disponible dans le résumé.',
  acc_delete_confirm: 'Supprimer le compte « {name} » ?',
  err_balance: 'Saisis un solde valide.',
  err_limit_accounts: 'Tu as atteint la limite de comptes.',
  debt_new: 'Nouvelle dette',
  debt_edit: 'Modifier la dette',
  debt_name_ph: 'Ex. : Carte, Prêt',
  debt_status_label: 'Statut',
  debt_status_pending: 'En attente',
  debt_status_paid: 'Payée',
  debt_save: 'Enregistrer la dette',
  debt_empty: 'Aucune dette enregistrée. 🎉',
  debt_mark_paid: 'Marquer payée',
  debt_mark_pending: 'Marquer en attente',
  debt_delete_confirm: 'Supprimer la dette « {name} » ?',
  err_limit_debts: 'Tu as atteint la limite de dettes.',
  name_label: 'Nom',
  san_intro: 'Un san (tanda) est un cercle d’épargne : chaque semaine, tout le monde contribue et une personne reçoit la cagnotte, à tour de rôle.',
  san_form_title: 'Créer un san',
  san_name_label: 'Nom du san',
  san_name_ph: 'Ex. : San de famille',
  san_aporte_label: 'Contribution par tour ($)',
  san_participants_label: 'Participants (dans l’ordre des tours)',
  san_pname_ph: 'Nom du participant',
  san_add_participant: 'Ajouter',
  san_create_btn: 'Créer le san',
  san_err_participants: 'Ajoute au moins 2 participants.',
  san_err_active_exists: 'Il existe déjà un san en cours (« {name} »). Supprime-le d’abord si tu veux en créer un autre.',
  san_err_dup: 'Ce participant est déjà sur la liste.',
  san_err_pname: 'Saisis le nom du participant.',
  san_remove: 'Retirer',
  san_draft_empty: 'Aucun participant ajouté pour le moment.',
  san_week: 'Semaine {x} sur {n}',
  san_finished: '🎉 San terminé !',
  san_finished_note: 'Toutes les semaines sont terminées. Tu peux supprimer ce san et en créer un nouveau.',
  san_total_line: 'Total collecté : {amount}',
  san_week_collected: 'Collecté cette semaine : {amount} sur {target}',
  san_receiver_line: 'Au tour de : {name}',
  san_aporte_line: 'Contribution par tour : {amount}',
  san_paid_title: 'Qui a déjà payé cette semaine ?',
  san_paid: 'a payé',
  san_advance: 'Marquer la semaine comme terminée',
  san_delete: 'Supprimer le san',
  san_delete_confirm: 'Supprimer le san « {name} » ? Ses registres de semaines et de paiements sont supprimés.',
  san_new_btn: 'Créer un nouveau san',
  san_new_confirm: 'Le san actuel est terminé. Le supprimer et en créer un nouveau ?',
  set_profile: 'Ton profil',
  set_name_label: 'Ton nom',
  set_textsize_label: 'Taille du texte',
  textsize_normal: 'Normale',
  textsize_large: 'Grande',
  set_lang_label: 'Langue / Language',
  set_reminders_title: 'Rappels',
  set_payday_label: 'Jour de paie',
  set_reminders_label: 'Rappels sur l’Accueil',
  wd_none: 'Pas de jour de paie',
  wd_0: 'Dimanche',
  wd_1: 'Lundi',
  wd_2: 'Mardi',
  wd_3: 'Mercredi',
  wd_4: 'Jeudi',
  wd_5: 'Vendredi',
  wd_6: 'Samedi',
  set_split_title: 'Répartition suggérée des revenus (%)',
  set_split_help: 'Les quatre nombres doivent totaliser 100. Ces pourcentages ne sont qu’une suggestion pour répartir tes revenus : l’épargne n’est jamais enregistrée automatiquement — tu saisis toujours combien tu as vraiment épargné de chaque revenu.',
  split_ahorro: 'Épargne',
  split_negocio: 'Activité',
  split_gastos: 'Dépenses',
  split_familia: 'Famille',
  set_save: 'Enregistrer les réglages',
  set_err_sum: 'Les pourcentages doivent totaliser 100. Ils totalisent maintenant {total}.',
  set_saved: 'Réglages enregistrés. ✅',
  set_sections_title: 'Sections visibles',
  set_sections_help: 'Désactive celles que tu n’utilises pas pour garder une liste plus courte.',
  set_pin_title: 'Sécurité (code PIN)',
  pin_status_on: 'Tu as un code PIN actif. L’appli se verrouille à l’ouverture.',
  pin_status_off: 'Tu n’as pas de code PIN. Tu peux en créer un ici pour protéger tes données.',
  pin_current_label: 'Code PIN actuel (si tu en as un)',
  pin_new_label: 'Nouveau code PIN (vide = supprimer le code PIN)',
  pin_update: 'Mettre à jour le code PIN',
  pin_err_current: 'Le code PIN actuel n’est pas correct.',
  pin_err_format: 'Le nouveau code PIN doit comporter 4 à 6 chiffres.',
  pin_off: 'Code PIN désactivé.',
  pin_updated: 'Code PIN mis à jour. ✅',
  set_data_title: 'Tes données',
  set_data_help: 'Tout reste uniquement sur ce téléphone. Exporte une copie si tu veux la garder ailleurs.',
  data_export: 'Exporter la copie (JSON)',
  data_import: 'Importer une copie',
  data_reset: 'Supprimer toutes les données',
  data_err_big: 'Ce fichier est trop volumineux.',
  data_err_invalid: 'Importation impossible : le fichier n’est pas une copie PETO Finanzas valide.',
  import_confirm: 'L’importation remplacera TOUTES les données actuelles de l’appli. Tu es sûr ?',
  import_done: 'Copie importée. ✅',
  reset_confirm1: 'Cela supprime TOUTES les données de ton appli sur ce téléphone. C’est irréversible. Tu es sûr ?',
  reset_confirm2: 'Confirmation finale : tout supprimer et repartir de zéro ?',
  lock_prompt: 'Saisis ton code PIN pour continuer.',
  lock_pin_label: 'Code PIN',
  lock_enter: 'Déverrouiller',
  lock_note: 'Tes données restent uniquement sur ce téléphone.',
  lock_err: 'Code PIN incorrect. Réessaie.',
  ob_title: 'Bienvenue dans PETO Finanzas !',
  ob_intro_1: 'Organise ton argent en quelques minutes : dépenses, revenus, budget, comptes et dettes.',
  ob_intro_2: 'Sans compte, sans internet.',
  ob_intro_3: 'Tout est gardé uniquement sur ton téléphone.',
  ob_name_label: 'Quel est ton nom ?',
  ob_name_ph: 'Ton nom',
  ob_pin_label: 'Crée un code PIN de sécurité (facultatif)',
  ob_pin_ph: '4 à 6 chiffres, ou laisse-le vide',
  ob_pin2_label: 'Répète le code PIN',
  ob_pin2_ph: 'Répète le code PIN',
  ob_start: 'Commencer',
  ob_note: 'Tu peux changer le code PIN à tout moment dans les Réglages.',
  ob_tour1_title: 'Enregistre une dépense en quelques secondes',
  ob_tour1_text: 'Touche le bouton +, saisis le montant et la catégorie. C’est tout : ta dépense est enregistrée tout de suite.',
  ob_tour2_title: 'Combien peux-tu dépenser aujourd’hui ?',
  ob_tour2_text: 'PETO Finanzas répartit ton budget sur les jours restants du mois et te donne un seul chiffre : ce que tu peux dépenser aujourd’hui sans dépasser.',
  ob_tour3_title: 'Ton compte cloud (facultatif)',
  ob_tour3_text: 'Si tu veux, crée un compte gratuit pour voir aussi tes données sur le web. Sans compte, tout reste uniquement sur ton téléphone.',
  ob_tour_next: 'Suivant',
  ob_tour_skip: 'Passer',
  ob_tour_go: 'C’est parti !',
  ob_err_name: 'Saisis ton nom pour commencer.',
  ob_err_pin_format: 'Le code PIN doit comporter 4 à 6 chiffres.',
  ob_err_pin_mismatch: 'Les deux codes PIN ne correspondent pas.',
  set_theme_label: 'Thème',
  theme_light: 'Clair',
  theme_dark: 'Sombre',
  theme_auto: 'Automatique (système)',
  set_accent_label: 'Couleur principale',
  accent_verde: 'Vert',
  accent_azul: 'Bleu',
  accent_morado: 'Violet',
  accent_naranja: 'Orange',
  undo_done: 'C’est fait',
  undo_btn: 'Annuler',
  btn_repeat: 'Répéter',
  fab_aria: 'Ajout rapide',
  quick_title: 'Que veux-tu ajouter ?',
  quick_expense: '🧾 Dépense',
  quick_income: '💵 Revenu',
  quick_savings: '🐷 Épargne',
  sec_buscar: 'Rechercher une activité',
  search_label: 'Rechercher',
  search_ph: 'Note, catégorie ou montant…',
  search_month_label: 'Mois (vide = tous)',
  search_type_label: 'Type',
  type_all: 'Tous',
  type_gastos: 'Dépenses',
  type_ingresos: 'Revenus',
  type_ahorros: 'Épargne',
  search_empty: 'Aucun résultat.',
  search_type_income: 'Revenu',
  search_type_saving: 'Épargne',
  chal_title: '🔥 Défi d’épargne hebdomadaire',
  chal_progress: 'Cette semaine : {have} sur {target}',
  chal_done: '🎉 Le défi de cette semaine est terminé !',
  chal_streak_one: 'Série : 1 semaine terminée',
  chal_streak_many: 'Série : {n} semaines terminées',
  chal_streak_zero: 'Série : 0 semaine. Celle-ci peut être la première !',
  streak_one: '🔥 1 jour d’enregistrement d’affilée',
  streak_many: '🔥 {n} jours d’enregistrement d’affilée',
  chal_target_label: 'Objectif d’épargne hebdomadaire ($)',
  chal_save: 'Enregistrer l’objectif hebdomadaire',
  rep_title: 'Rapport mensuel',
  rep_download: 'Télécharger l’image',
  rep_share_image: 'Partager l’image',
  trend_title: 'Tendance des dépenses',
  trend_weeks: 'Semaines de ce mois-ci',
  trend_week: 'Semaine {n}',
  trend_empty: 'Pas encore de dépenses pour montrer la tendance.',
  rep_income: 'Revenus',
  rep_expenses: 'Dépenses',
  rep_savings: 'Épargne',
  rep_top_cat: 'Catégorie principale',
  rep_top3: 'Top 3 des catégories',
  rep_goal: 'Objectif d’épargne',
  rep_none: 'Aucune activité',
  calc_title: 'Calculatrice pour solder les dettes',
  calc_intro: 'Compare deux plans pour sortir des dettes : payer la plus petite d’abord (boule de neige) ou celle au taux le plus élevé d’abord (avalanche). Chaque mois tu paies tous les minimums et le reste va à la dette ciblée.',
  calc_budget_label: 'Combien peux-tu payer par mois pour les dettes au total ? ($)',
  calc_run: 'Calculer',
  calc_snowball: 'Boule de neige (le plus petit solde d’abord)',
  calc_avalanche: 'Avalanche (le taux le plus élevé d’abord)',
  calc_result: '{months} mois pour être sans dettes · intérêts approx. {interest}',
  calc_months_one: '1 mois pour être sans dettes · intérêts approx. {interest}',
  calc_order: 'Ordre de paiement :',
  calc_free: 'Tu n’as aucune dette en attente ! 🎉',
  calc_warn: 'Avec ce paiement mensuel, une dette ne se rembourse jamais : le paiement ne couvre même pas les intérêts. Augmente le paiement mensuel.',
  calc_note_zero: 'Les dettes sans paiement minimum ni taux notés sont calculées avec un minimum de 0 $ et un taux de 0 %.',
  calc_err_budget: 'Saisis combien tu peux payer par mois.',
  debt_interest_label: 'Taux annuel % (facultatif)',
  debt_minpay_label: 'Paiement minimum mensuel $ (facultatif)',
  debt_terms: '{pct} % de taux annuel · Minimum {min}/mois',
  exp_photo_label: 'Photo du ticket (facultatif)',
  exp_photo_remove: 'Retirer la photo',
  photo_close: 'Fermer',
  err_photo_quota: 'Il n’y avait pas de place pour garder la photo : la dépense a été enregistrée sans elle.',
  banner_backup: 'Cela fait un moment que tu n’as pas sauvegardé de copie de tes données. Exporte ta copie dans les Réglages.',
  pro_title: 'PETO Pro',
  pro_card_text: 'Cloud illimité pour tes données, le rapport avancé, le budget partagé et le mode organisateur de san.',
  pro_status_free: 'Tu es sur le plan Gratuit en ce moment.',
  pro_status_active: 'PETO Pro est actif. Merci de soutenir PETO Finanzas ! ⭐',
  pro_status_test: 'PETO Pro est ouvert pendant le test fermé : tu as un accès complet tant que le test dure.',
  pro_status_waitlist: 'Tu es sur la liste d’attente de PETO Pro.',
  pro_btn_see: 'Voir PETO Pro',
  pro_wall_title: 'Ceci est une fonction PETO Pro ⭐',
  pro_price_line: 'Seulement 1,99 $ par mois',
  pro_benefit_cloud: '☁️ Cloud illimité pour tes données',
  pro_benefit_report: '📊 Rapport avancé : compare les mois et exporte en CSV',
  pro_benefit_shared: '🏠 Budget partagé avec ton foyer',
  pro_benefit_org: '🤝 Mode organisateur de san : la tanda de tout le groupe',
  pro_coming_text: 'L’achat dans l’appli arrive avec le lancement sur Google Play. En attendant, tu peux rejoindre la liste d’attente : nous te préviendrons dès que tu pourras activer Pro pour 1,99 $ par mois.',
  pro_waitlist_btn: 'Rejoindre la liste d’attente',
  pro_waitlist_done: 'Tu es sur la liste ✅ Nous te préviendrons quand Pro sera disponible.',
  pro_close: 'Pas maintenant',
  pro_tag: 'PRO',
  adv_title: 'Rapport avancé',
  adv_note: 'Une fonction PETO Pro : ce mois-ci contre le mois précédent, chaque catégorie et un export CSV du mois.',
  adv_open_btn: 'Voir le rapport avancé',
  adv_export_csv: 'Exporter le mois en CSV',
  adv_this_month: 'Ce mois-ci',
  adv_prev_month: 'Mois précédent',
  adv_change: 'Variation',
  adv_all_cats: 'Toutes les catégories',
  adv_empty: 'Aucune activité sur ces deux mois.',
  org_title: 'Mode organisateur de san',
  org_intro: 'Gère la tanda de tout le groupe : des tours datés, marque qui a payé à chaque tour et partage l’état avec le groupe.',
  org_pro_note: 'Le mode organisateur est une fonction PETO Pro.',
  org_form_title: 'Créer le san du groupe',
  org_freq_label: 'Fréquence des tours',
  org_freq_semanal: 'Hebdomadaire',
  org_freq_quincenal: 'Toutes les 2 semaines',
  org_freq_mensual: 'Mensuelle',
  org_start_label: 'Date du premier tour',
  org_create_btn: 'Créer le san organisé',
  org_round: 'Tour {x} sur {n}',
  org_receiver_line: 'Reçoit : {name}',
  org_pending_none: 'Tout le monde a payé ! 🎉',
  org_pending_list: 'Reste à payer : {names}',
  org_pending_count_one: 'Plus que 1 à payer',
  org_pending_count_many: 'Plus que {n} à payer',
  org_totals_title: 'Contributions par participant',
  org_paid_rounds: '{paid} tours payés sur {n}',
  org_delete: 'Supprimer le san organisé',
  org_delete_confirm: 'Supprimer le san organisé « {name} » ? Le registre des paiements du groupe sera perdu.',
  org_share_title: 'État du san',
  shared_live_note: 'Partage le budget avec ton foyer : crée un foyer ou rejoins-le avec un code et vous verrez les mêmes membres. Il te faut ton compte cloud (ci-dessus, dans les Réglages) et PETO Pro.',
  shared_leave_live: 'Quitter ce foyer ? Tu ne verras plus son budget partagé.',
  shared_err_login: 'Connecte-toi d’abord avec ton compte cloud (ci-dessus, dans les Réglages) et réessaie.',
  shared_err_generic: 'Cela n’a pas pu être terminé. Vérifie ta connexion et réessaie.',
  shared_err_code_live: 'Ce code n’existe pas. Vérifie-le et réessaie.',
  shared_err_member: 'Tu es déjà membre de ce foyer.',
  shared_err_owner_leave: 'Tu es le propriétaire de ce foyer : tu ne peux pas le quitter sans le supprimer. Demande à un autre membre de créer le nouveau foyer.',
  shared_created_live: 'Foyer créé ✅ Partage le code pour inviter ton foyer.',
  shared_joined_live: 'Tu as rejoint le foyer ✅',
  lang_auto: 'Automatique (langue du téléphone)',
  org_comp_label: 'Compensation de l’organisateur',
  org_comp_none: 'Aucune compensation',
  org_comp_first: 'L’organisateur encaisse en premier',
  org_comp_last: 'L’organisateur encaisse en dernier',
  org_comp_extra: 'Frais supplémentaires par tour',
  org_comp_amount_label: 'Frais supplémentaires par personne ($)',
  org_comp_line: 'Compensation de l’organisateur : {mode}',
  org_sim_title: 'Simulation de la cagnotte',
  org_sim_pays: 'Chaque participant met par tour : {amount}',
  org_sim_pot: 'Cagnotte de chaque tour : {amount}',
  org_sim_total_in: 'Total mis par chacun sur tout le san : {amount}',
  org_sim_extra_org: 'L’organisateur reçoit {amount} supplémentaires par tour',
  org_sim_first: 'L’organisateur reçoit la cagnotte du premier tour',
  org_sim_last: 'L’organisateur reçoit la cagnotte du dernier tour',
  org_shuffle_btn: '🎲 Tirer l’ordre au sort',
  org_shuffled: '🎲 Ordre tiré au sort ! Voici le nouveau tour.',
  org_shuffle_need: 'Ajoutez au moins 2 participants pour tirer l’ordre au sort.',
  org_shuffle_blocked: 'Le tirage n’est plus possible : le san a déjà commencé ou a des paiements enregistrés.',
  org_start_btn: 'Démarrer le san',
  org_started_line: 'San en cours · L’ordre est verrouillé',
  org_order_title: 'Ordre des tours',
  org_move_up: 'Monter',
  org_move_down: 'Descendre',
  org_swap_blocked: 'Ce tour a déjà des paiements et ne peut pas être modifié.',
  org_history_title: 'Historique des modifications',
  org_history_swap: '{a} et {b} ont échangé leurs tours',
  org_history_started: 'L’organisateur a démarré le san',
  org_pay_pending: 'En attente',
  org_pay_reported: 'Signalé',
  org_pay_confirmed: 'Confirmé',
  org_status_btn: 'Statut : {status}',
  org_receipt_add: '📎 Reçu',
  org_receipt_view: 'Voir le reçu',
  org_receipt_remove: 'Retirer',
  org_zelle_label: 'Zelle de chaque participant (numéro ou e-mail, facultatif)',
  org_zelle_ph: 'Zelle (facultatif)',
  org_zelle_line: 'Zelle : {zelle}',
  org_reminder_btn: '📲 Rappel WhatsApp',
  org_reminder_head: '🤝 {san} · Tour {x} sur {n} · {date}',
  org_reminder_receiver: '💰 Cette semaine, {name} encaisse',
  org_reminder_zelle: 'Zelle de {name} : {zelle}',
  org_reminder_amount: 'Cotisation du tour : {amount}',
  org_antifraud: '🛡️ Un san ne paie jamais d’intérêts ni plus que ce qui a été mis.',
  org_link_btn: '🔗 Lien en lecture seule',
  org_link_publish: 'Créer le lien',
  org_link_update: 'Mettre à jour le lien',
  org_link_copied: 'Lien copié !',
  org_link_need_cloud: 'Le lien nécessite votre compte cloud : connectez-vous dans Réglages et réessayez.',
  org_link_ready: 'San du groupe (lecture seule)',
  org_public_title: 'Le lien est prêt à partager.',
  org_public_updated: 'Mis à jour le {date}',
  org_public_notfound: 'Ce lien n’est plus disponible.',
  org_pub_pay_btn: 'J’ai payé',
  org_pub_confirm: 'Avez-vous déjà payé votre part de ce tour ? L’organisateur le confirmera.',
  org_pub_attach: '📎 Joindre la photo du reçu (facultatif)',
  org_pub_send: 'Envoyer',
  org_pub_sent: 'C’est fait ! Votre paiement a été signalé.',
  org_pub_reported_note: 'Signalé · en attente de confirmation',
  org_pub_err: 'Envoi impossible. Vérifiez votre connexion et réessayez.',
  org_pub_err_confirmed: 'Ce paiement a déjà été confirmé par l’organisateur.',
  org_pub_err_photo: 'La photo est trop lourde ; essayez-en une plus petite.',
  org_penalty_label: 'Règle de retard',
  org_penalty_none: 'Aucune pénalité',
  org_penalty_fixed: 'Pénalité fixe',
  org_penalty_percent: 'Pourcentage de la cotisation',
  org_penalty_amount_label: 'Montant de la pénalité ($)',
  org_penalty_percent_label: 'Pourcentage de pénalité (%)',
  org_penalty_line_fixed: 'Si quelqu’un est en retard : pénalité de {amount}',
  org_penalty_line_percent: 'Si quelqu’un est en retard : pénalité de {percent} % de la cotisation',
  set_news_title: 'Nouveautés',
  news_c24: 'Compilación 24 : visite de bienvenue, série de jours d’enregistrement, objectifs d’épargne avec barre de progression et graphique de tendance.',
  news_c25: 'Compilación 25 : widget sur l’écran d’accueil et une appli beaucoup plus légère (de 52 Mo à 7 Mo).',
  news_c26: 'Compilación 26 : widgets en trois tailles, avec des options par widget et un bouton pour noter une dépense sans ouvrir l’appli.',
  news_c27: 'Compilación 27 : l’appli en 12 langues, suivant automatiquement la langue de votre téléphone.',
  news_c28: 'Compilación 28 : texte plus grand appliqué dès le démarrage, cette section des nouveautés, relecture de l’italien et démarrage plus rapide.',
  news_c31: 'Compilación 31 : le bouton ou le geste retour se déplace maintenant dans l’app : il ferme ce qui est ouvert et revient à l’écran principal avant de quitter.',
  news_c32: 'Version 32 : la marque affiche désormais « PETO Finanzas » dans toute l’appli (menu, verrouillage et widgets), le san passe en tête de la liste d’accueil, le lien public du san s’ouvre directement sur l’état du groupe et les boutons de l’organisateur répondent toujours par un message clair.',
  news_c33: 'Version 33 : créer un san ne peut plus effacer celui en cours — s’il y en a déjà un actif, l’appli le dit et le protège (paiements, justificatifs, historique et lien public) — et la version web est maintenant synchronisée avec le téléphone.',
  news_c34: 'Version 34 : nouveau logo de PETO Finanzas — le «P» blanc avec barres et flèche en vert doux sur fond émeraude, désormais sur l’icône, l’écran de verrouillage et dans toute l’appli.',
  news_c35: 'Version 35 : depuis le lien public du san, vous pouvez maintenant signaler votre paiement avec « J’ai payé » et joindre votre reçu (l’organisateur confirme), la vue publique utilise le thème sombre, l’appli se rafraîchit en tirant vers le bas et le lecteur PDF ne confond plus les Zelle que vous envoyez avec des revenus.',
  sec_podcast: 'Podcast',
  key_podcast: 'Finanzas Personales, le podcast',
  pod_hosts: 'avec Lucía et Marco',
  pod_desc: 'L’argent sans prise de tête : des conseils pratiques pour épargner, sortir des dettes et prendre soin de votre portefeuille, en épisodes courts.',
  pod_spotify_btn: 'Écouter sur Spotify',
  pod_loading: 'Chargement des épisodes…',
  pod_offline: 'Pas de connexion : affichage de la dernière liste téléchargée',
  pod_error: 'Impossible de charger les épisodes. Vérifiez votre connexion et réessayez.',
  pod_empty: 'Aucun épisode publié pour le moment.',
  pod_play_aria: 'Lecture',
  pod_pause_aria: 'Pause',
  pod_audio_error: 'Impossible de lire cet épisode.',
  pub_tagline: 'Votre san, organisé et transparent',
  pub_progress: '{x} paiements confirmés sur {n}',
  pub_progress_start: 'Ça vient de commencer : aucun paiement confirmé pour l’instant',
  pub_cta_title: 'Vous voulez organiser votre propre san ?',
  pub_cta_text: 'Avec PETO Finanzas, vous gardez l’ordre, les tours et les reçus au même endroit, sans cahiers ni confusion.',
  pub_cta_try: 'Essayer PETO Finanzas',
  pub_cta_more: 'En savoir plus',
  pub_bar_try: 'Essayer l’appli',
  pub_footer: 'Fait avec PETO Finanzas · petofinanzas.com',
  news_c36: 'Version 36 : nouvelle section Podcast — écoutez « Finanzas Personales » sans quitter l’appli, avec lecteur intégré et la liste enregistrée pour quand il n’y a pas internet — l’écran d’accueil avance maintenant tout seul, diapositive après diapositive — et la vue du lien renouvelée : le san se présente avec sa progression et un accès direct pour essayer l’appli.',
  news_c37: 'Version 37 : widgets repensés — dégradé de la marque, barre de progression qui change de couleur selon votre budget et la ligne du prochain tour de votre san — et un nouveau widget de la taille d’une icône, avec ce que vous pouvez dépenser aujourd’hui — et la marque reste visible quand on fait défiler le lien public du san — et les tours de l’organisateur se plient en accordéon, avec seul celui de cette semaine ouvert.',
  widget_today: 'aujourd’hui',
  widget_san_next: 'Prochain tour : {name} · {date}',
  widget_san_next_nodate: 'Prochain tour : {name}',
  back_exit_hint: 'Appuyez à nouveau sur retour pour quitter.'
},
de: {
  org_err_san_name: 'Gib den Namen des Sans ein.', rep_promo_footer: 'Kontrolliere deine Ausgaben mit PETO Finanzas · petofinanzas.com', rep_saved: 'Bild gespeichert.', set_sections_summary: '{visible} von {total} sichtbar',
  org_err_active_exists: 'Es gibt bereits einen aktiven San („{name}“). Lösche ihn zuerst auf seiner Karte, wenn du einen neuen erstellen willst.',
  app_title: 'PETO Finanzas',
  back: '← Alle Optionen',
  greeting: 'Hallo',
  lock_btn: 'Sperren',
  home_menu_heading: 'Was möchtest du sehen?',
  group_daily: 'Alltag',
  group_plan: 'Planung',
  group_accounts: 'Konten & Verpflichtungen',
  group_yourapp: 'Deine App',
  sec_gastos: 'Ausgaben des Monats',
  sec_ingresos: 'Wöchentliche Einnahmen',
  sec_ahorros: 'Ersparnisse',
  sec_resumen: 'Übersicht',
  sec_presupuesto: 'Budget nach Kategorie',
  sec_pagos: 'Festzahlungen',
  sec_cuentas: 'Meine Konten',
  sec_deudas: 'Meine Schulden',
  sec_san: 'Mein San (Tanda)',
  sec_ajustes: 'Einstellungen & Personalisierung',
  menu_open_aria: 'Menü öffnen',
  menu_close_aria: 'Menü schließen',
  sec_home: 'Start',
  key_home: 'Dein Hauptbildschirm',
  set_notif_label: 'Benachrichtigungen bei geschlossener App',
  set_notif_help: 'Hinweise zu deinen Festzahlungen am Vortag und am Fälligkeitstag, auch wenn PETO Finanzas geschlossen ist.',
  set_autofixed_label: 'Festzahlungen automatisch eintragen',
  set_autofixed_help: 'Wenn eine Festzahlung fällig wird, wird die Ausgabe für dich eingetragen. Du kannst es sofort rückgängig machen.',
  set_bio_label: 'Entsperrung per Fingerabdruck',
  set_bio_help: 'Entsperre mit deinem Fingerabdruck zusätzlich zur PIN (eine aktive PIN ist nötig).',
  bio_btn: '👆 Mit Fingerabdruck entsperren',
  bio_reason: 'Bestätige, dass du es bist, um PETO Finanzas zu öffnen',
  bio_need_pin: 'Die Fingerabdruck-Entsperrung braucht eine aktive PIN: Erstelle deine PIN in Einstellungen → Sicherheit, dann funktioniert der Fingerabdruck beim Öffnen der App.',
  bio_failed: 'Der Fingerabdruck konnte nicht bestätigt werden. Gib deine PIN ein.',
  bio_unavailable: 'Fingerabdruck ist auf diesem Telefon nicht verfügbar. Gib deine PIN ein.',
  bio_not_enrolled: 'Auf diesem Telefon ist kein Fingerabdruck gespeichert. Speichere einen in den Telefoneinstellungen oder gib deine PIN ein.',
  bio_offer_title: 'Mit Fingerabdruck entsperren?',
  bio_offer_text: 'Du hast gerade deine PIN erstellt. Wenn du möchtest, kannst du PETO Finanzas mit deinem Fingerabdruck öffnen, statt jedes Mal die PIN zu tippen. Jetzt aktivieren?',
  bio_offer_yes: 'Ja, Fingerabdruck aktivieren',
  bio_offer_no: 'Nicht jetzt',
  bio_activated: 'Fertig: Die Entsperrung per Fingerabdruck ist jetzt an.',
  fix_auto_suffix: '(automatische Festzahlung)',
  backup_pass_label: 'Passwort der verschlüsselten Kopie',
  backup_pass_ph: 'Mindestens 4 Zeichen',
  data_export_enc: 'Verschlüsselte Kopie exportieren',
  backup_help: 'Die verschlüsselte Kopie öffnet sich nur mit deinem Passwort. Ohne Passwort kann sie nicht wiederhergestellt werden: Bewahre es gut auf. Um eine verschlüsselte Kopie zu importieren, gib ihr Passwort hier ein, bevor du die Datei auswählst.',
  backup_err_short: 'Das Passwort braucht mindestens 4 Zeichen.',
  backup_need_pass: 'Gib das Passwort der verschlüsselten Kopie ein, bevor du sie importierst.',
  backup_err_pass: 'Die Kopie konnte nicht geöffnet werden: falsches Passwort oder beschädigte Datei.',
  share_btn: 'Übersicht teilen',
  share_copied: 'Übersicht kopiert. Füge sie ein, wo du willst.',
  review_title: 'Gefällt dir PETO Finanzas?',
  review_text: 'Wenn dir PETO Finanzas hilft, auf dein Geld aufzupassen, hilft uns eine Bewertung bei Google Play sehr, mehr Menschen zu erreichen. Danke!',
  review_yes: '⭐ Bei Google Play bewerten',
  review_no: 'Nicht jetzt',
  share_report_title: 'Meine PETO Finanzas-Übersicht',
  notif_fixed_title: 'Festzahlung morgen',
  notif_fixed_today: 'Festzahlung heute',
  notif_fixed_body: '{name} · {amount}',
  notif_weekly_title: 'Deine Woche in PETO Finanzas',
  notif_weekly_body: 'Trage die Ausgaben und Einnahmen dieser Woche ein, um auf Kurs zu bleiben.',
  summary_title: 'Tägliche Übersicht',
  summary_help: 'Ein Hinweis mit dem, was du gestern ausgegeben hast und was du heute ausgeben kannst, zu der von dir gewählten Zeit.',
  summary_notif_label: 'Übersicht per Benachrichtigung',
  summary_time_label: 'Uhrzeit der Übersicht',
  summary_email_label: 'Auch per E-Mail erhalten',
  summary_email_help: 'Nur mit aktivem Cloud-Konto: dieselbe Übersicht kommt auch per E-Mail bei dir an.',
  notif_summary_title: '🌅 Deine PETO Finanzas-Übersicht',
  notif_summary_body: 'Gestern hast du {spent} ausgegeben · Heute kannst du {daily} ausgeben',
  notif_summary_body_nodaily: 'Gestern hast du {spent} ausgegeben',
  sec_remesas: 'Überweisungen',
  key_remesas: 'Diesen Monat gesendet: {amount}',
  rem_intro: 'Geld, das du an deine Leute sendest: wie viel in Dollar abging und wie viel in ihrer Währung ankam.',
  rem_usd_label: 'Gesendeter Betrag ($ USD)',
  rem_rate_label: 'Kurs ({cur} pro 1 $)',
  rem_recipient_label: 'Für wen?',
  rem_currency_label: 'Zielwährung',
  rem_arrives_label: 'Kommt an',
  rem_rate_suggested: 'Zuletzt von dir verwendeter Kurs für {cur}: {rate}. Er ist schon eingetragen; ändere ihn, wenn der heutige anders ist.',
  rem_month_sent: 'Diesen Monat hast du {usd} gesendet',
  rem_totals_title: 'Summen nach Währung (gesamter Verlauf)',
  rem_total_row: '{usd} gesendet → {amount} erhalten · {n} Sendungen',
  rem_save: 'Überweisung speichern',
  rem_empty: 'Noch keine Überweisungen eingetragen.',
  rem_delete_confirm: 'Die Überweisung an {name} löschen?',
  csv_title: 'Kontoauszug importieren (CSV)',
  csv_help: 'Lade die CSV-Datei deiner Bank hoch und prüfe alles in einer Vorschau, bevor du importierst: Nichts wird gespeichert, bis du bestätigst.',
  csv_file_label: 'CSV-Datei der Bank',
  csv_preview_title: 'Importvorschau',
  csv_summary: '{total} Buchungen · {dups} doppelt (ausgeschlossen) · {sel} zu importieren',
  csv_dup_badge: 'Doppelt',
  csv_income_badge: 'Einnahme',
  csv_expense_badge: 'Ausgabe',
  csv_all: 'Alle auswählen',
  csv_none: 'Auswahl aufheben',
  csv_apply: 'Auswahl importieren',
  csv_cancel: 'Import abbrechen',
  csv_done: '{n} Buchungen importiert. ✅',
  csv_none_selected: 'Du hast keine Buchung zum Importieren ausgewählt.',
  csv_err_parse: 'Diese Datei konnte nicht als CSV gelesen werden. Prüfe, ob es der Kontoauszug im CSV-Format ist.',
  csv_err_headers: 'Die Spalten für Datum und Betrag wurden in dieser Datei nicht gefunden.',
  csv_err_big: 'Diese Datei ist zu groß zum Importieren.',
  csv_err_empty: 'Diese Datei enthält keine importierbaren Buchungen.',
  pdf_err_big: 'Diese PDF ist zu groß (maximal 8 MB).',
  pdf_err_notext: 'Diese PDF enthält keinen lesbaren Text (sie wirkt wie ein Foto oder Scan). Versuche es mit der CSV deiner Bank oder erfasse die Ausgabe mit dem Belegfoto.',
  pdf_err_empty: 'Ich habe in dieser PDF keine Buchungen mit Datum und Betrag gefunden. Versuche es mit der CSV deiner Bank.',
  shared_title: 'Gemeinsames Budget',
  shared_preview_note: '🔧 Designvorschau: Es verbindet sich noch nicht mit anderen Konten. Probiere aus, wie es aussehen wird, einen Haushalt zu erstellen, mit einem Code beizutreten und die Mitglieder zu sehen.',
  shared_create_label: 'Name des Haushalts',
  shared_create_btn: 'Haushalt erstellen',
  shared_join_label: 'Einladungscode',
  shared_join_btn: 'Mit Code beitreten',
  shared_members_title: 'Mitglieder',
  shared_code_label: 'Einladungscode: {code}',
  shared_role_dueno: 'Eigentümer',
  shared_role_admin: 'Admin',
  shared_role_miembro: 'Mitglied',
  shared_role_lector: 'Nur lesen',
  shared_you: 'Du',
  shared_host: 'Gastgeber',
  shared_leave_btn: 'Haushalt verlassen',
  shared_leave_confirm: 'Diesen Haushalt verlassen? (Vorschau)',
  shared_err_name: 'Gib dem Haushalt einen Namen.',
  shared_err_code: 'Der Code hat 6 Buchstaben oder Zahlen.',
  shared_created: 'Haushalt erstellt (Vorschau). ✅',
  shared_joined: 'Du bist dem Haushalt beigetreten (Vorschau). ✅',
  shared_household_fallback: 'Gemeinsamer Haushalt',
  privacy_hide: 'Beträge ausblenden',
  privacy_show: 'Beträge anzeigen',
  ins_title: '💡 Ideen zu deinem Geld',
  ins_cat_up: '{cat} ist um {pct} % gegenüber dem Vormonat gestiegen ({from} → {to}).',
  ins_pace_down: 'Dein Tempo wird besser: Die Ausgaben sind um {pct} % gegenüber dem Vormonat gesunken.',
  ins_pace_up: 'Achtung: Dein Ausgabentempo ist um {pct} % gegenüber dem Vormonat gestiegen.',
  ins_biggest: 'Deine größte Ausgabe in diesem Monat: {note} · {amount}.',
  ins_saved: 'Du hast in diesem Monat {amount} gespart. Weiter so!',
  bud_alert_title: 'Budget in Gefahr',
  bud_alert_warn: '{cat}: Du bist bei {pct} % des Budgets.',
  bud_alert_over: '{cat}: Du bist über dem Budget ({pct} %).',
  voice_btn: '🎤 Diktieren',
  voice_listening: 'Ich höre zu… sag den Betrag und wofür es war.',
  voice_unavailable: 'Sprache ist auf diesem Gerät nicht verfügbar.',
  voice_heard: 'Ich habe gehört: „{text}“. Prüfe es und speichere.',
  voice_no_amount: 'Ich habe gehört: „{text}“, aber den Betrag nicht gefunden.',
  ocr_found: 'Ich habe {amount} auf dem Beleg erkannt. Prüfe es vor dem Speichern.',
  goals_title: 'Weitere Ziele',
  goal2_create: 'Ziel erstellen',
  goal_add: '+ Hinzufügen',
  goal_take: '− Entnehmen',
  goal_done: '🎉 Ziel erreicht!',
  goal_move_label: 'Betrag',
  goal_delete_confirm: 'Das Ziel „{name}“ löschen? Deine Ersparnisse bleiben unberührt: Nur das Ziel wird gelöscht.',
  err_limit_goals: 'Du hast bereits die maximale Anzahl an Zielen.',
  biz_label: 'Das ist für mein Geschäft',
  biz_title: 'Mein Geschäft in diesem Monat',
  biz_income: 'Geschäftseinnahmen',
  biz_expenses: 'Geschäftsausgaben',
  biz_profit: 'Gewinn',
  chal_share: 'Meine Challenge teilen',
  cloud_title: 'Cloud-Konto',
  cloud_help: 'Mit einem Konto werden deine Daten auch in der Cloud gespeichert und synchronisiert: Wechsle das Telefon, melde dich mit deiner E-Mail an, und alles ist da. Ohne Konto funktioniert die App nur auf diesem Telefon, wie immer.',
  cloud_email: 'E-Mail',
  cloud_pass: 'Passwort',
  cloud_signin: 'Anmelden',
  cloud_signup: 'Konto erstellen',
  cloud_signout: 'Abmelden',
  cloud_sync_now: 'Jetzt synchronisieren',
  cloud_wipe: 'Meine Cloud-Daten löschen',
  cloud_who: 'Angemeldet als {email}',
  cloud_synced: 'Synchronisiert ✓ · {time}',
  cloud_never: 'Noch nicht synchronisiert.',
  cloud_working: 'Arbeite…',
  cloud_ok_in: 'Willkommen zurück!',
  cloud_ok_up: 'Konto erstellt! Deine Daten sind jetzt in der Cloud.',
  cloud_err_fields: 'Gib deine E-Mail und ein Passwort mit mindestens 6 Zeichen ein.',
  cloud_err_login: 'Anmeldung nicht möglich. Prüfe deine E-Mail und dein Passwort.',
  cloud_err_exists: 'Für diese E-Mail gibt es bereits ein Konto. Nutze „Anmelden“.',
  cloud_err_confirm: 'Konto erstellt. Prüfe deine E-Mail, um dein Konto zu bestätigen, und melde dich dann an.',
  cloud_err_generic: 'Mit der Cloud ist etwas fehlgeschlagen. Prüfe deine Internetverbindung und versuche es erneut.',
  cloud_conflict: 'Die Cloud und dieses Telefon enthalten unterschiedliche Daten. Die Cloud-Daten herunterladen und die Daten auf diesem Telefon ersetzen? (Abbrechen = Daten dieses Telefons hochladen)',
  cloud_wipe_confirm: 'ALLE deine Daten in der Cloud löschen? Was auf diesem Telefon ist, bleibt, wie es ist.',
  cloud_delete: 'Mein Konto löschen',
  cloud_delete_confirm1: 'Dein PETO Finanzas-Konto löschen? Das löscht dein Konto, deine Kopie der Daten in der Cloud und die gemeinsamen Haushalte, die dir gehören. Die Daten auf DIESEM Telefon bleiben hier, unberührt (du kannst sie in den Einstellungen löschen). Das kann nicht rückgängig gemacht werden.',
  cloud_delete_confirm2: 'Letzte Bestätigung: Dein Konto endgültig löschen?',
  cloud_deleted: 'Dein Konto wurde gelöscht.',
  cloud_delete_err_auth: 'Deine Sitzung ist nicht mehr gültig. Melde dich erneut an und versuche es noch einmal.',
  cloud_unavailable: 'Die Cloud ist in dieser Version nicht verfügbar.',
  key_settings: 'Name, Aufteilung, Text, Abschnitte, PIN',
  footer: 'PETO Finanzas · Funktioniert offline · Die Cloud ist optional: deine Daten, deine Entscheidung',
  tile_available: 'Verfügbares Geld',
  tile_available_aria: 'Verfügbares Geld: zu Meine Konten',
  tile_savings: 'Ersparnisse in diesem Monat',
  tile_savings_aria: 'Ersparnisse in diesem Monat: zu Ersparnisse',
  tile_debts: 'Offene Schulden',
  tile_debts_aria: 'Offene Schulden: zu Meine Schulden',
  tile_incomes: '💵 Einnahmen',
  tile_incomes_aria: 'Einnahmen: zu Wöchentliche Einnahmen',
  tile_expenses: '🧾 Ausgaben',
  tile_expenses_aria: 'Ausgaben: zu Ausgaben des Monats',
  tile_goal: 'Ziel „{name}“: {pct} %',
  key_spent_month: '{amount} in diesem Monat ausgegeben',
  key_income_month: '{amount} in diesem Monat erhalten',
  key_saved_total: '{amount} insgesamt gespart',
  key_goal_suffix: ' · Ziel „{name}“: {pct} %',
  key_budget_one: '{n} Kategorie mit Limit',
  key_budget_many: '{n} Kategorien mit Limit',
  key_fixed: '{amount} pro Monat · {n} zu zahlen',
  key_available: 'Verfügbar: {amount}',
  key_debts: '{amount} offen',
  key_san: 'Woche {x} von {n} · Als Nächstes: {name}',
  key_san_done: 'San beendet 🎉',
  key_san_none: 'Kein aktiver San',
  banner_payday: 'Heute ist Zahltag: Trage deine Einnahmen und deine Ersparnisse ein.',
  banner_dues_title: 'Bald fällige Zahlungen:',
  banner_due_item: '{name} (Tag {day})',
  banner_close: 'Schließen',
  spend_title: 'Wie viel kannst du heute ausgeben?',
  spend_note: 'So viel kannst du heute ausgeben, ohne drüber zu kommen.',
  spend_guide: 'Erstelle dein erstes Kategorie-Budget, und du siehst hier, wie viel du jeden Tag ausgeben kannst.',
  spend_left: 'Dir bleiben {amount} für die verbleibenden {days} Tage des Monats.',
  spend_left_one: 'Dir bleibt {amount} für heute, den letzten Tag des Monats.',
  spend_over: 'Du hast das Budget dieses Monats erreicht.',
  spend_over_by: 'Du bist {amount} darüber.',
  cat_Renta: 'Miete',
  cat_Comida: 'Essen',
  "cat_Comida fuera": 'Essen gehen',
  cat_Gasolina: 'Benzin',
  cat_Transporte: 'Transport',
  cat_Salud: 'Gesundheit',
  cat_Ropa: 'Kleidung',
  cat_Otros: 'Sonstiges',
  btn_cancel: 'Abbrechen',
  btn_save: 'Speichern',
  btn_edit: 'Bearbeiten',
  btn_delete: 'Löschen',
  err_amount: 'Gib einen gültigen Betrag ein, größer als 0 $.',
  err_amount_generic: 'Gib einen gültigen Betrag ein.',
  err_name: 'Gib einen Namen ein.',
  chip_paid: 'Bezahlt',
  chip_pending: 'Offen',
  month_prev_aria: 'Vorheriger Monat',
  month_next_aria: 'Nächster Monat',
  exp_new: 'Neue Ausgabe',
  exp_edit: 'Ausgabe bearbeiten',
  exp_total_label: 'Monatssumme:',
  amount_label: 'Betrag ($)',
  category_label: 'Kategorie',
  date_label: 'Datum',
  note_label: 'Notiz (optional)',
  exp_note_ph: 'Wofür war es?',
  exp_save: 'Ausgabe speichern',
  exp_empty: 'Noch keine Ausgaben in diesem Monat.\nFüge die erste mit dem Formular oben hinzu. 👍',
  exp_delete_confirm: 'Diese Ausgabe von {amount} löschen? Kategorie {cat}, am {date}. Nur diese Ausgabe wird gelöscht.',
  err_category: 'Wähle eine gültige Kategorie.',
  err_limit_expenses: 'Du hast das Limit gespeicherter Ausgaben erreicht.',
  inc_intro: 'Ersparnisse sind nie automatisch: Du gibst ein, wie viel du von jeder Einnahme wirklich gespart hast. Die App schlägt nur einen Betrag auf Basis deines Prozentsatzes in den Einstellungen vor.',
  inc_new: 'Neue Einnahme',
  inc_edit: 'Einnahme bearbeiten',
  inc_note_ph: 'Woher kam es?',
  inc_savings_label: 'Ersparnis ($)',
  inc_savings_label_sug: 'Ersparnis (Vorschlag: {amount})',
  inc_savings_help: 'Ein Vorschlag auf Basis deines Sparprozentsatzes — ändere ihn auf das, was du wirklich gespart hast. Du kannst 0 $ eingeben.',
  inc_split_line: 'Gespart: {sav} · Vorschlag: Geschäft {biz} · Ausgaben {exp} · Familie {fam}',
  inc_split_preview: 'Vorgeschlagene Aufteilung: Ersparnis {sav} · Geschäft {biz} · Ausgaben {exp} · Familie {fam}. Die Ersparnis, die zählt, ist die, die du unten eingibst.',
  inc_save: 'Einnahme speichern',
  inc_empty: 'Noch keine Einnahmen eingetragen.\nFüge deine erste Einnahme hinzu und gib ein, wie viel du davon gespart hast. 💪',
  inc_delete_confirm: 'Diese Einnahme von {amount} vom {date} löschen? Ihre vermerkte Ersparnis von {savings} wird auch gelöscht.',
  err_inc_savings: 'Gib ein, wie viel du von dieser Einnahme gespart hast (es kann 0 $ sein).',
  err_limit_incomes: 'Du hast das Limit gespeicherter Einnahmen erreicht.',
  sav_intro_1: 'Hier siehst du jeden gesparten Betrag, einen nach dem anderen. Du kannst auch eine einzelne Ersparnis hinzufügen,',
  sav_intro_2: 'die an keine Einnahme gebunden ist',
  sav_intro_3: ', mit dem Formular unten. Wenn du eine Ersparnis löschst, wird nur dieser Betrag gelöscht:',
  sav_intro_4: 'die Einnahme bleibt gleich',
  sav_intro_5: '.',
  sav_total_label: 'Insgesamt gespart:',
  sav_month_label: 'In diesem Monat gespart:',
  sav_form_title: 'Eine Ersparnis hinzufügen',
  sav_note_ph: 'Wofür ist diese Ersparnis?',
  sav_save: 'Ersparnis speichern',
  sav_goal_label: 'Einem Ziel zuordnen (optional)',
  sav_goal_none: 'Kein Ziel · allgemeine Ersparnis',
  sav_empty: 'Noch keine Ersparnisse vermerkt.\nFüge eine mit dem Formular oben hinzu, oder vermerke die Ersparnis einer Einnahme beim Eintragen, dann erscheint sie hier. 🌱',
  sav_from_title: 'Ersparnis vom {date}',
  sav_from_sub: 'Von einer Einnahme von {amount}',
  sav_manual_title: 'Hinzugefügte Ersparnis',
  sav_manual_sub: 'Manuell · hinzugefügt am {date}',
  sav_delete_income_confirm: 'Diese Ersparnis von {amount} vom {date} löschen? Nur dieser Sparbetrag wird gelöscht: Die Einnahme von {income} bleibt gleich.',
  sav_delete_manual_confirm: 'Diese Ersparnis von {amount} vom {date} löschen? Es ist eine Ersparnis, die du von Hand unter Ersparnisse hinzugefügt hast; nur dieser Eintrag wird gelöscht.',
  err_limit_savings: 'Du hast das Limit gespeicherter Ersparnisse erreicht.',
  goal_prompt: 'Wofür sparst du?',
  goal_prompt_sub: 'Erstelle ein Ziel und sieh zu, wie deine Ersparnisse näher kommen.',
  goal_form_create: 'Ziel erstellen',
  goal_form_edit: 'Ziel bearbeiten',
  goal_name_label: 'Name des Ziels',
  goal_name_ph: 'Z. B.: Notfallfonds',
  goal_target_label: 'Zielbetrag ($)',
  goal_create_btn: 'Ziel erstellen',
  goal_save_btn: 'Ziel speichern',
  goal_progress: 'Du hast {have} von {target} gespart',
  goal_remaining: 'Noch {amount}',
  goal_edit: 'Ziel bearbeiten',
  goal_delete: 'Ziel löschen',
  err_goal_name: 'Gib einen Namen für dein Ziel ein.',
  res_cats_title: 'Ausgaben nach Kategorie',
  res_summary_title: 'Einnahmen vs. Ausgaben vs. Ersparnisse',
  chart_income: 'Einnahmen',
  chart_expenses: 'Ausgaben',
  chart_savings: 'Ersparnisse',
  res_cats_empty: 'Keine Ausgaben in diesem Monat.',
  res_summary_empty: 'Noch keine Aktivität in diesem Monat.',
  bud_intro: 'Lege ein Monatslimit pro Kategorie fest und sieh, wie viel du ausgegeben hast.',
  bud_spent_left: '{spent} von {budget} ausgegeben · {left} übrig',
  bud_spent_over: '{spent} von {budget} ausgegeben · {over} darüber',
  bud_nolimit: 'Kein Limit. In diesem Monat ausgegeben: {spent}',
  bud_placeholder: 'Monatslimit $',
  bud_aria: 'Monatslimit für {cat}',
  bud_delete_cat: 'Kategorie löschen',
  bud_delete_cat_confirm: 'Die Kategorie „{cat}“ löschen? Ausgaben, die sie nutzen, wandern zu „{other}“.',
  bud_alert_amount: 'Gib einen gültigen Betrag für das Limit ein.',
  cat_form_title: 'Eigene Kategorie',
  cat_name_label: 'Name der Kategorie',
  cat_name_ph: 'Z. B.: Haustiere',
  cat_save: 'Kategorie hinzufügen',
  err_cat_name: 'Gib der Kategorie einen Namen.',
  err_cat_exists: 'Diese Kategorie gibt es schon.',
  fix_intro: 'Zahlungen, die sich jeden Monat wiederholen: Miete, Telefon, Abos…',
  fix_new: 'Neue Festzahlung',
  fix_edit: 'Festzahlung bearbeiten',
  fix_name_ph: 'Z. B.: Miete',
  fix_day_label: 'Tag des Monats',
  fix_save: 'Festzahlung speichern',
  fix_empty: 'Noch keine Festzahlungen.',
  fix_sub: 'Tag {day} jedes Monats · {month}',
  fix_mark: 'Als bezahlt markieren',
  fix_unmark: 'Markierung entfernen',
  fix_delete_confirm: 'Die Festzahlung „{name}“ löschen?',
  err_day: 'Der Tag muss zwischen 1 und 31 liegen.',
  err_limit_fixed: 'Du hast das Limit der Festzahlungen erreicht.',
  acc_new: 'Neues Konto',
  acc_edit: 'Konto bearbeiten',
  acc_balance_label: 'Kontostand ($)',
  acc_name_ph: 'Z. B.: Bargeld, Bank, Ersparnisse',
  acc_save: 'Konto speichern',
  acc_empty: 'Noch keine Konten.\nFüge eines hinzu, um dein verfügbares Geld in der Übersicht zu sehen.',
  acc_delete_confirm: 'Das Konto „{name}“ löschen?',
  err_balance: 'Gib einen gültigen Kontostand ein.',
  err_limit_accounts: 'Du hast das Kontenlimit erreicht.',
  debt_new: 'Neue Schuld',
  debt_edit: 'Schuld bearbeiten',
  debt_name_ph: 'Z. B.: Karte, Kredit',
  debt_status_label: 'Status',
  debt_status_pending: 'Offen',
  debt_status_paid: 'Bezahlt',
  debt_save: 'Schuld speichern',
  debt_empty: 'Keine Schulden eingetragen. 🎉',
  debt_mark_paid: 'Als bezahlt markieren',
  debt_mark_pending: 'Als offen markieren',
  debt_delete_confirm: 'Die Schuld „{name}“ löschen?',
  err_limit_debts: 'Du hast das Schuldenlimit erreicht.',
  name_label: 'Name',
  san_intro: 'Ein San (Tanda) ist ein Sparzirkel: Jede Woche zahlen alle ein, und eine Person erhält den Topf, der Reihe nach.',
  san_form_title: 'Einen San erstellen',
  san_name_label: 'Name des Sans',
  san_name_ph: 'Z. B.: Familien-San',
  san_aporte_label: 'Beitrag pro Runde ($)',
  san_participants_label: 'Teilnehmer (in Reihenfolge der Runden)',
  san_pname_ph: 'Name des Teilnehmers',
  san_add_participant: 'Hinzufügen',
  san_create_btn: 'San erstellen',
  san_err_participants: 'Füge mindestens 2 Teilnehmer hinzu.',
  san_err_active_exists: 'Es gibt bereits einen laufenden San („{name}“). Lösche ihn zuerst, wenn du einen neuen erstellen willst.',
  san_err_dup: 'Dieser Teilnehmer ist schon auf der Liste.',
  san_err_pname: 'Gib den Namen des Teilnehmers ein.',
  san_remove: 'Entfernen',
  san_draft_empty: 'Noch keine Teilnehmer hinzugefügt.',
  san_week: 'Woche {x} von {n}',
  san_finished: '🎉 San beendet!',
  san_finished_note: 'Alle Wochen sind abgeschlossen. Du kannst diesen San löschen und einen neuen erstellen.',
  san_total_line: 'Gesamt gesammelt: {amount}',
  san_week_collected: 'Diese Woche gesammelt: {amount} von {target}',
  san_receiver_line: 'Als Nächstes: {name}',
  san_aporte_line: 'Beitrag pro Runde: {amount}',
  san_paid_title: 'Wer hat diese Woche schon bezahlt?',
  san_paid: 'bezahlt',
  san_advance: 'Woche als komplett markieren',
  san_delete: 'San löschen',
  san_delete_confirm: 'Den San „{name}“ löschen? Seine Wochen- und Zahlungsdaten werden gelöscht.',
  san_new_btn: 'Einen neuen San erstellen',
  san_new_confirm: 'Der aktuelle San ist beendet. Ihn löschen und einen neuen erstellen?',
  set_profile: 'Dein Profil',
  set_name_label: 'Dein Name',
  set_textsize_label: 'Textgröße',
  textsize_normal: 'Normal',
  textsize_large: 'Groß',
  set_lang_label: 'Sprache / Language',
  set_reminders_title: 'Erinnerungen',
  set_payday_label: 'Zahltag',
  set_reminders_label: 'Erinnerungen auf der Startseite',
  wd_none: 'Kein Zahltag',
  wd_0: 'Sonntag',
  wd_1: 'Montag',
  wd_2: 'Dienstag',
  wd_3: 'Mittwoch',
  wd_4: 'Donnerstag',
  wd_5: 'Freitag',
  wd_6: 'Samstag',
  set_split_title: 'Vorgeschlagene Einnahmen-Aufteilung (%)',
  set_split_help: 'Die vier Zahlen müssen 100 ergeben. Diese Prozentsätze sind nur ein Vorschlag zur Aufteilung deiner Einnahmen: Ersparnisse werden nie automatisch gespeichert — du gibst immer ein, wie viel du von jeder Einnahme wirklich gespart hast.',
  split_ahorro: 'Ersparnisse',
  split_negocio: 'Geschäft',
  split_gastos: 'Ausgaben',
  split_familia: 'Familie',
  set_save: 'Einstellungen speichern',
  set_err_sum: 'Die Prozentsätze müssen 100 ergeben. Jetzt ergeben sie {total}.',
  set_saved: 'Einstellungen gespeichert. ✅',
  set_sections_title: 'Sichtbare Abschnitte',
  set_sections_help: 'Schalte die aus, die du nicht nutzt, für eine kürzere Liste.',
  set_pin_title: 'Sicherheit (PIN)',
  pin_status_on: 'Du hast eine aktive PIN. Die App sperrt sich beim Öffnen.',
  pin_status_off: 'Du hast keine PIN. Du kannst hier eine erstellen, um deine Daten zu schützen.',
  pin_current_label: 'Aktuelle PIN (wenn du eine hast)',
  pin_new_label: 'Neue PIN (leer = PIN entfernen)',
  pin_update: 'PIN aktualisieren',
  pin_err_current: 'Die aktuelle PIN ist nicht richtig.',
  pin_err_format: 'Die neue PIN muss 4 bis 6 Ziffern haben.',
  pin_off: 'PIN deaktiviert.',
  pin_updated: 'PIN aktualisiert. ✅',
  set_data_title: 'Deine Daten',
  set_data_help: 'Alles bleibt nur auf diesem Telefon. Exportiere eine Kopie, wenn du sie woanders aufbewahren willst.',
  data_export: 'Kopie exportieren (JSON)',
  data_import: 'Kopie importieren',
  data_reset: 'Alle Daten löschen',
  data_err_big: 'Diese Datei ist zu groß.',
  data_err_invalid: 'Import nicht möglich: Die Datei ist keine gültige PETO Finanzas-Kopie.',
  import_confirm: 'Der Import ersetzt ALLE aktuellen App-Daten. Bist du sicher?',
  import_done: 'Kopie importiert. ✅',
  reset_confirm1: 'Das löscht ALLE deine App-Daten auf diesem Telefon. Das kann nicht rückgängig gemacht werden. Bist du sicher?',
  reset_confirm2: 'Letzte Bestätigung: Alles löschen und von vorne beginnen?',
  lock_prompt: 'Gib deine PIN ein, um fortzufahren.',
  lock_pin_label: 'PIN',
  lock_enter: 'Entsperren',
  lock_note: 'Deine Daten bleiben nur auf diesem Telefon.',
  lock_err: 'Falsche PIN. Versuche es erneut.',
  ob_title: 'Willkommen bei PETO Finanzas!',
  ob_intro_1: 'Organisiere dein Geld in Minuten: Ausgaben, Einnahmen, Budget, Konten und Schulden.',
  ob_intro_2: 'Kein Konto, kein Internet.',
  ob_intro_3: 'Alles wird nur auf deinem Telefon gespeichert.',
  ob_name_label: 'Wie ist dein Name?',
  ob_name_ph: 'Dein Name',
  ob_pin_label: 'Erstelle eine Sicherheits-PIN (optional)',
  ob_pin_ph: '4 bis 6 Ziffern, oder leer lassen',
  ob_pin2_label: 'PIN wiederholen',
  ob_pin2_ph: 'PIN wiederholen',
  ob_start: 'Loslegen',
  ob_note: 'Du kannst die PIN jederzeit in den Einstellungen ändern.',
  ob_tour1_title: 'Eine Ausgabe in Sekunden eintragen',
  ob_tour1_text: 'Tippe auf den +-Knopf, gib den Betrag und die Kategorie ein. Das ist alles: Deine Ausgabe ist sofort gespeichert.',
  ob_tour2_title: 'Wie viel kannst du heute ausgeben?',
  ob_tour2_text: 'PETO Finanzas verteilt dein Budget auf die verbleibenden Tage des Monats und nennt dir eine einzige Zahl: wie viel du heute ausgeben kannst, ohne drüber zu kommen.',
  ob_tour3_title: 'Dein Cloud-Konto (optional)',
  ob_tour3_text: 'Wenn du möchtest, erstelle ein kostenloses Konto, um deine Daten auch im Web zu sehen. Ohne Konto bleibt alles nur auf deinem Telefon.',
  ob_tour_next: 'Weiter',
  ob_tour_skip: 'Überspringen',
  ob_tour_go: 'Los geht\'s!',
  ob_err_name: 'Gib deinen Namen ein, um zu starten.',
  ob_err_pin_format: 'Die PIN muss 4 bis 6 Ziffern haben.',
  ob_err_pin_mismatch: 'Die beiden PINs stimmen nicht überein.',
  set_theme_label: 'Design',
  theme_light: 'Hell',
  theme_dark: 'Dunkel',
  theme_auto: 'Automatisch (System)',
  set_accent_label: 'Hauptfarbe',
  accent_verde: 'Grün',
  accent_azul: 'Blau',
  accent_morado: 'Lila',
  accent_naranja: 'Orange',
  undo_done: 'Erledigt',
  undo_btn: 'Rückgängig',
  btn_repeat: 'Wiederholen',
  fab_aria: 'Schnell hinzufügen',
  quick_title: 'Was möchtest du hinzufügen?',
  quick_expense: '🧾 Ausgabe',
  quick_income: '💵 Einnahme',
  quick_savings: '🐷 Ersparnis',
  sec_buscar: 'Aktivität suchen',
  search_label: 'Suchen',
  search_ph: 'Notiz, Kategorie oder Betrag…',
  search_month_label: 'Monat (leer = alle)',
  search_type_label: 'Typ',
  type_all: 'Alle',
  type_gastos: 'Ausgaben',
  type_ingresos: 'Einnahmen',
  type_ahorros: 'Ersparnisse',
  search_empty: 'Keine Ergebnisse.',
  search_type_income: 'Einnahme',
  search_type_saving: 'Ersparnis',
  chal_title: '🔥 Wöchentliche Spar-Challenge',
  chal_progress: 'Diese Woche: {have} von {target}',
  chal_done: '🎉 Die Challenge dieser Woche ist komplett!',
  chal_streak_one: 'Serie: 1 Woche abgeschlossen',
  chal_streak_many: 'Serie: {n} Wochen abgeschlossen',
  chal_streak_zero: 'Serie: 0 Wochen. Diese kann die erste sein!',
  streak_one: '🔥 1 Tag Eintragen in Folge',
  streak_many: '🔥 {n} Tage Eintragen in Folge',
  chal_target_label: 'Wöchentliches Sparziel ($)',
  chal_save: 'Wochenziel speichern',
  rep_title: 'Monatsbericht',
  rep_download: 'Bild herunterladen',
  rep_share_image: 'Bild teilen',
  trend_title: 'Ausgabentrend',
  trend_weeks: 'Wochen in diesem Monat',
  trend_week: 'Woche {n}',
  trend_empty: 'Noch keine Ausgaben, um den Trend zu zeigen.',
  rep_income: 'Einnahmen',
  rep_expenses: 'Ausgaben',
  rep_savings: 'Ersparnisse',
  rep_top_cat: 'Top-Kategorie',
  rep_top3: 'Top 3 Kategorien',
  rep_goal: 'Sparziel',
  rep_none: 'Keine Aktivität',
  calc_title: 'Rechner zum Schuldenabbau',
  calc_intro: 'Vergleiche zwei Pläne, um aus den Schulden zu kommen: zuerst die kleinste zahlen (Schneeball) oder zuerst die mit dem höchsten Zins (Lawine). Jeden Monat zahlst du alle Mindestbeträge, und der Rest geht an die Zielschuld.',
  calc_budget_label: 'Wie viel kannst du pro Monat insgesamt für Schulden zahlen? ($)',
  calc_run: 'Berechnen',
  calc_snowball: 'Schneeball (kleinster Saldo zuerst)',
  calc_avalanche: 'Lawine (höchster Zins zuerst)',
  calc_result: '{months} Monate bis schuldenfrei · Zinsen ca. {interest}',
  calc_months_one: '1 Monat bis schuldenfrei · Zinsen ca. {interest}',
  calc_order: 'Reihenfolge der Rückzahlung:',
  calc_free: 'Du hast keine offenen Schulden! 🎉',
  calc_warn: 'Mit dieser Monatszahlung wird eine Schuld nie getilgt: Die Zahlung deckt nicht einmal die Zinsen. Erhöhe die Monatszahlung.',
  calc_note_zero: 'Schulden ohne vermerkten Mindestbetrag oder Zins werden mit 0 $ Mindestbetrag und 0 % Zins berechnet.',
  calc_err_budget: 'Gib ein, wie viel du pro Monat zahlen kannst.',
  debt_interest_label: 'Jahreszins % (optional)',
  debt_minpay_label: 'Monatlicher Mindestbetrag $ (optional)',
  debt_terms: '{pct} % Jahreszins · Mindestbetrag {min}/Monat',
  exp_photo_label: 'Foto des Belegs (optional)',
  exp_photo_remove: 'Foto entfernen',
  photo_close: 'Schließen',
  err_photo_quota: 'Es war kein Platz, um das Foto zu speichern: Die Ausgabe wurde ohne Foto gespeichert.',
  banner_backup: 'Es ist eine Weile her, seit du eine Kopie deiner Daten gespeichert hast. Exportiere deine Kopie in den Einstellungen.',
  pro_title: 'PETO Pro',
  pro_card_text: 'Unbegrenzte Cloud für deine Daten, der erweiterte Bericht, das gemeinsame Budget und der San-Organisator-Modus.',
  pro_status_free: 'Du bist gerade im Gratis-Plan.',
  pro_status_active: 'PETO Pro ist aktiv. Danke, dass du PETO Finanzas unterstützt! ⭐',
  pro_status_test: 'PETO Pro ist während des geschlossenen Tests offen: Du hast vollen Zugang, solange der Test dauert.',
  pro_status_waitlist: 'Du bist auf der Warteliste von PETO Pro.',
  pro_btn_see: 'PETO Pro ansehen',
  pro_wall_title: 'Das ist eine PETO-Pro-Funktion ⭐',
  pro_price_line: 'Nur 1,99 $ pro Monat',
  pro_benefit_cloud: '☁️ Unbegrenzte Cloud für deine Daten',
  pro_benefit_report: '📊 Erweiterter Bericht: Monate vergleichen und CSV exportieren',
  pro_benefit_shared: '🏠 Gemeinsames Budget mit deinem Haushalt',
  pro_benefit_org: '🤝 San-Organisator-Modus: die Tanda der ganzen Gruppe',
  pro_coming_text: 'Der In-App-Kauf kommt mit dem Start bei Google Play. Inzwischen kannst du dich auf die Warteliste setzen: Wir geben dir Bescheid, sobald du Pro für 1,99 $ pro Monat aktivieren kannst.',
  pro_waitlist_btn: 'Auf die Warteliste',
  pro_waitlist_done: 'Du bist auf der Liste ✅ Wir geben dir Bescheid, wenn Pro verfügbar ist.',
  pro_close: 'Nicht jetzt',
  pro_tag: 'PRO',
  adv_title: 'Erweiterter Bericht',
  adv_note: 'Eine PETO-Pro-Funktion: dieser Monat gegen den vorigen, jede Kategorie und ein CSV-Export des Monats.',
  adv_open_btn: 'Erweiterten Bericht ansehen',
  adv_export_csv: 'Monat als CSV exportieren',
  adv_this_month: 'Dieser Monat',
  adv_prev_month: 'Voriger Monat',
  adv_change: 'Änderung',
  adv_all_cats: 'Alle Kategorien',
  adv_empty: 'Keine Aktivität in diesen zwei Monaten.',
  org_title: 'San-Organisator-Modus',
  org_intro: 'Führe die Tanda der ganzen Gruppe: Runden mit Daten, markiere, wer in jeder Runde gezahlt hat, und teile den Stand mit der Gruppe.',
  org_pro_note: 'Der Organisator-Modus ist eine PETO-Pro-Funktion.',
  org_form_title: 'Den Gruppen-San erstellen',
  org_freq_label: 'Häufigkeit der Runden',
  org_freq_semanal: 'Wöchentlich',
  org_freq_quincenal: 'Alle 2 Wochen',
  org_freq_mensual: 'Monatlich',
  org_start_label: 'Datum der ersten Runde',
  org_create_btn: 'Organisierten San erstellen',
  org_round: 'Runde {x} von {n}',
  org_receiver_line: 'Erhält: {name}',
  org_pending_none: 'Alle haben gezahlt! 🎉',
  org_pending_list: 'Noch zu zahlen: {names}',
  org_pending_count_one: 'Noch 1 offen',
  org_pending_count_many: 'Noch {n} offen',
  org_totals_title: 'Beiträge pro Teilnehmer',
  org_paid_rounds: '{paid} von {n} Runden bezahlt',
  org_delete: 'Organisierten San löschen',
  org_delete_confirm: 'Den organisierten San „{name}“ löschen? Das Zahlungsregister der Gruppe geht verloren.',
  org_share_title: 'Stand des Sans',
  shared_live_note: 'Teile das Budget mit deinem Haushalt: Erstelle einen Haushalt oder tritt mit einem Code bei, und ihr seht dieselben Mitglieder. Du brauchst dein Cloud-Konto (oben, in den Einstellungen) und PETO Pro.',
  shared_leave_live: 'Diesen Haushalt verlassen? Du siehst sein gemeinsames Budget dann nicht mehr.',
  shared_err_login: 'Melde dich zuerst mit deinem Cloud-Konto an (oben, in den Einstellungen) und versuche es erneut.',
  shared_err_generic: 'Es konnte nicht abgeschlossen werden. Prüfe deine Verbindung und versuche es erneut.',
  shared_err_code_live: 'Dieser Code existiert nicht. Prüfe ihn und versuche es erneut.',
  shared_err_member: 'Du bist schon Mitglied dieses Haushalts.',
  shared_err_owner_leave: 'Du besitzt diesen Haushalt: Du kannst ihn nicht verlassen, ohne ihn zu löschen. Bitte ein anderes Mitglied, den neuen Haushalt zu erstellen.',
  shared_created_live: 'Haushalt erstellt ✅ Teile den Code, um deinen Haushalt einzuladen.',
  shared_joined_live: 'Du bist dem Haushalt beigetreten ✅',
  lang_auto: 'Automatisch (Telefonsprache)',
  org_comp_label: 'Entschädigung des Organisators',
  org_comp_none: 'Keine Entschädigung',
  org_comp_first: 'Der Organisator kassiert zuerst',
  org_comp_last: 'Der Organisator kassiert zuletzt',
  org_comp_extra: 'Extragebühr pro Runde',
  org_comp_amount_label: 'Extragebühr pro Person ($)',
  org_comp_line: 'Entschädigung des Organisators: {mode}',
  org_sim_title: 'Topf-Simulation',
  org_sim_pays: 'Jeder Teilnehmer zahlt pro Runde: {amount}',
  org_sim_pot: 'Topf jeder Runde: {amount}',
  org_sim_total_in: 'Gesamtbetrag, den jeder im ganzen San einzahlt: {amount}',
  org_sim_extra_org: 'Der Organisator erhält {amount} extra pro Runde',
  org_sim_first: 'Der Organisator erhält den Topf der ersten Runde',
  org_sim_last: 'Der Organisator erhält den Topf der letzten Runde',
  org_shuffle_btn: '🎲 Reihenfolge auslosen',
  org_shuffled: '🎲 Reihenfolge ausgelost! So ist die neue Reihenfolge.',
  org_shuffle_need: 'Füge mindestens 2 Teilnehmer hinzu, um die Reihenfolge auszulosen.',
  org_shuffle_blocked: 'Auslosen ist nicht mehr möglich: Der San läuft schon oder hat bereits Zahlungen.',
  org_start_btn: 'San starten',
  org_started_line: 'San läuft · Die Reihenfolge ist gesperrt',
  org_order_title: 'Reihenfolge der Runden',
  org_move_up: 'Nach oben',
  org_move_down: 'Nach unten',
  org_swap_blocked: 'Diese Runde hat bereits Zahlungen und kann nicht geändert werden.',
  org_history_title: 'Änderungsverlauf',
  org_history_swap: '{a} und {b} haben die Runden getauscht',
  org_history_started: 'Der Organisator hat den San gestartet',
  org_pay_pending: 'Ausstehend',
  org_pay_reported: 'Gemeldet',
  org_pay_confirmed: 'Bestätigt',
  org_status_btn: 'Status: {status}',
  org_receipt_add: '📎 Beleg',
  org_receipt_view: 'Beleg ansehen',
  org_receipt_remove: 'Entfernen',
  org_zelle_label: 'Zelle jedes Teilnehmers (Nummer oder E-Mail, optional)',
  org_zelle_ph: 'Zelle (optional)',
  org_zelle_line: 'Zelle: {zelle}',
  org_reminder_btn: '📲 WhatsApp-Erinnerung',
  org_reminder_head: '🤝 {san} · Runde {x} von {n} · {date}',
  org_reminder_receiver: '💰 Diese Woche kassiert {name}',
  org_reminder_zelle: 'Zelle von {name}: {zelle}',
  org_reminder_amount: 'Rundenbeitrag: {amount}',
  org_antifraud: '🛡️ Ein San zahlt nie Zinsen und nie mehr als eingezahlt wurde.',
  org_link_btn: '🔗 Nur-Lesen-Link',
  org_link_publish: 'Link erstellen',
  org_link_update: 'Link aktualisieren',
  org_link_copied: 'Link kopiert!',
  org_link_need_cloud: 'Der Link braucht dein Cloud-Konto: Melde dich in den Einstellungen an und versuche es erneut.',
  org_link_ready: 'Gruppen-San (nur Lesen)',
  org_public_title: 'Der Link ist bereit zum Teilen.',
  org_public_updated: 'Aktualisiert am {date}',
  org_public_notfound: 'Dieser Link ist nicht mehr verfügbar.',
  org_pub_pay_btn: 'Bezahlt',
  org_pub_confirm: 'Hast du deinen Anteil für diese Runde schon bezahlt? Der Organisator bestätigt ihn.',
  org_pub_attach: '📎 Foto des Belegs anhängen (optional)',
  org_pub_send: 'Meldung senden',
  org_pub_sent: 'Fertig! Deine Zahlung wurde gemeldet.',
  org_pub_reported_note: 'Gemeldet · wartet auf Bestätigung',
  org_pub_err: 'Senden fehlgeschlagen. Prüfe deine Verbindung und versuche es erneut.',
  org_pub_err_confirmed: 'Diese Zahlung wurde vom Organisator bereits bestätigt.',
  org_pub_err_photo: 'Das Foto ist zu groß; versuche ein kleineres.',
  org_penalty_label: 'Verspätungsregel',
  org_penalty_none: 'Keine Strafe',
  org_penalty_fixed: 'Feste Strafe',
  org_penalty_percent: 'Prozentsatz des Beitrags',
  org_penalty_amount_label: 'Strafbetrag ($)',
  org_penalty_percent_label: 'Strafprozentsatz (%)',
  org_penalty_line_fixed: 'Bei Verspätung: Strafe von {amount}',
  org_penalty_line_percent: 'Bei Verspätung: Strafe von {percent}% des Beitrags',
  set_news_title: 'Neuigkeiten',
  news_c24: 'Compilación 24: Willkommens-Tour, Aufzeichnungsserie, Sparziele mit Fortschrittsbalken und Trenddiagramm.',
  news_c25: 'Compilación 25: Widget auf dem Startbildschirm und eine viel leichtere App (von 52 MB auf 7 MB).',
  news_c26: 'Compilación 26: Widgets in drei Größen, mit Optionen pro Widget und einer Taste, um eine Ausgabe zu erfassen, ohne die App zu öffnen.',
  news_c27: 'Compilación 27: die App in 12 Sprachen, automatisch in der Sprache deines Telefons.',
  news_c28: 'Compilación 28: größere Schrift ab dem Start, dieser Neuigkeiten-Bereich, überarbeitetes Italienisch und ein schnellerer Start.',
  news_c31: 'Compilación 31: Die Zurück-Taste oder -Geste bewegt sich jetzt in der App: sie schließt Geöffnetes und kehrt vor dem Beenden zum Hauptbildschirm zurück.',
  news_c32: 'Version 32: Die Marke heißt jetzt überall in der App „PETO Finanzas“ (Menü, Sperrbildschirm und Widgets), der San steht jetzt oben in der Startliste, der öffentliche San-Link öffnet direkt den Gruppenstatus und die Organisator-Schaltflächen antworten immer mit einer klaren Meldung.',
  news_c33: 'Version 33: Einen San zu erstellen kann den laufenden nicht mehr löschen — ist schon einer aktiv, sagt die App Bescheid und schützt ihn (Zahlungen, Belege, Verlauf und öffentlicher Link) — und die Webversion ist jetzt mit dem Telefon synchron.',
  news_c34: 'Version 34: neues Logo von PETO Finanzas — das weiße „P“ mit Balken und Pfeil in sanftem Grün auf Smaragdgrün, jetzt auf dem Symbol, dem Sperrbildschirm und in der ganzen App.',
  news_c35: 'Version 35: Über den öffentlichen San-Link kannst du jetzt deine Zahlung mit „Bezahlt“ melden und deinen Beleg anhängen (der Organisator bestätigt), die öffentliche Ansicht nutzt das dunkle Design, die App aktualisiert sich durch Herunterziehen und der PDF-Leser verwechselt gesendete Zelle-Zahlungen nicht mehr mit Einnahmen.',
  sec_podcast: 'Podcast',
  key_podcast: 'Finanzas Personales, der Podcast',
  pod_hosts: 'mit Lucía und Marco',
  pod_desc: 'Geld ohne Stress: praktische Tipps zum Sparen, Schulden abbauen und auf dein Geld achten – in kurzen Episoden.',
  pod_spotify_btn: 'Auf Spotify hören',
  pod_loading: 'Episoden werden geladen…',
  pod_offline: 'Keine Verbindung: die zuletzt geladene Liste wird angezeigt',
  pod_error: 'Die Episoden konnten nicht geladen werden. Prüfe deine Verbindung und versuche es erneut.',
  pod_empty: 'Noch keine Episoden veröffentlicht.',
  pod_play_aria: 'Abspielen',
  pod_pause_aria: 'Pause',
  pod_audio_error: 'Diese Episode konnte nicht abgespielt werden.',
  pub_tagline: 'Dein San, organisiert und transparent',
  pub_progress: '{x} von {n} Zahlungen bestätigt',
  pub_progress_start: 'Es geht gerade erst los: noch keine Zahlung bestätigt',
  pub_cta_title: 'Willst du deinen eigenen San organisieren?',
  pub_cta_text: 'Mit PETO Finanzas hast du Reihenfolge, Runden und Belege an einem Ort – ohne Notizbücher und ohne Durcheinander.',
  pub_cta_try: 'PETO Finanzas testen',
  pub_cta_more: 'Mehr erfahren',
  pub_bar_try: 'App testen',
  pub_footer: 'Gemacht mit PETO Finanzas · petofinanzas.com',
  news_c36: 'Version 36: neuer Bereich Podcast — höre „Finanzas Personales“, ohne die App zu verlassen, mit integriertem Player und gespeicherter Liste für Zeiten ohne Internet — der Willkommensbildschirm wechselt jetzt von selbst, Folie für Folie — und die erneuerte Link-Ansicht: Der San zeigt seinen Fortschritt und einen direkten Zugang, um die App zu testen.',
  news_c37: 'Version 37: Widgets im neuen Look — Marken-Farbverlauf, ein Fortschrittsbalken, der je nach Budget die Farbe wechselt, und die Zeile zum nächsten Zug deines San — plus ein neues Widget in App-Symbol-Größe mit deinem heutigen Budget — und die Marke bleibt beim Scrollen im öffentlichen San-Link sichtbar — und die Runden des Organisators klappen jetzt als Akkordeon, mit nur der dieser Woche offen.',
  widget_today: 'heute',
  widget_san_next: 'Nächster Zug: {name} · {date}',
  widget_san_next_nodate: 'Nächster Zug: {name}',
  back_exit_hint: 'Nochmals Zurück drücken zum Beenden.'
},
zh: {
  org_err_san_name: '请输入 san 的名称。', rep_promo_footer: '用 PETO Finanzas 控制你的支出 · petofinanzas.com', rep_saved: '图片已保存。', set_sections_summary: '共 {total} 个，已显示 {visible} 个',
  org_err_active_exists: '已有一个正在进行的 san（“{name}”）。如需新建，请先在其卡片中删除它。',
  app_title: 'PETO Finanzas',
  back: '← 全部选项',
  greeting: '你好',
  lock_btn: '锁定',
  home_menu_heading: '你想看什么？',
  group_daily: '日常',
  group_plan: '规划',
  group_accounts: '账户与义务',
  group_yourapp: '你的应用',
  sec_gastos: '本月支出',
  sec_ingresos: '每周收入',
  sec_ahorros: '储蓄',
  sec_resumen: '汇总',
  sec_presupuesto: '按类别预算',
  sec_pagos: '固定付款',
  sec_cuentas: '我的账户',
  sec_deudas: '我的债务',
  sec_san: '我的 san（tanda）',
  sec_ajustes: '设置与个性化',
  menu_open_aria: '打开菜单',
  menu_close_aria: '关闭菜单',
  sec_home: '首页',
  key_home: '你的主屏幕',
  set_notif_label: '应用关闭时的通知',
  set_notif_help: '即使 PETO Finanzas 已关闭，也会在固定付款的前一天和当天提醒你。',
  set_autofixed_label: '自动记录固定付款',
  set_autofixed_help: '固定付款到期时，支出会自动为你记下。你可以立即撤销。',
  set_bio_label: '指纹解锁',
  set_bio_help: '除 PIN 外还可用指纹进入（需要已启用的 PIN）。',
  bio_btn: '👆 用指纹进入',
  bio_reason: '确认是你本人，以打开 PETO Finanzas',
  bio_need_pin: '指纹解锁需要已启用的 PIN：请先在「设置 → 安全」中创建 PIN，之后打开应用时即可用指纹。',
  bio_failed: '指纹无法验证。请输入你的 PIN。',
  bio_unavailable: '这部手机不支持指纹。请输入你的 PIN。',
  bio_not_enrolled: '这部手机没有录入任何指纹。请在手机设置中录入指纹，或输入你的 PIN。',
  bio_offer_title: '用指纹解锁？',
  bio_offer_text: '你刚刚创建了 PIN。如果你愿意，可以用指纹打开 PETO Finanzas，不必每次都输入 PIN。现在开启吗？',
  bio_offer_yes: '好，开启指纹',
  bio_offer_no: '以后再说',
  bio_activated: '完成：指纹解锁已开启。',
  fix_auto_suffix: '（自动固定付款）',
  backup_pass_label: '加密备份密码',
  backup_pass_ph: '至少 4 个字符',
  data_export_enc: '导出加密备份',
  backup_help: '加密备份只能用你的密码打开。没有密码就无法恢复：请妥善保管。要导入加密备份，请先在这里输入它的密码，再选择文件。',
  backup_err_short: '密码至少需要 4 个字符。',
  backup_need_pass: '请先输入加密备份的密码再导入。',
  backup_err_pass: '无法打开备份：密码错误或文件已损坏。',
  share_btn: '分享汇总',
  share_copied: '汇总已复制。粘贴到任何地方吧。',
  review_title: '你喜欢 PETO Finanzas 吗？',
  review_text: '如果 PETO Finanzas 帮你管好了钱，在 Google Play 上留个评价能帮我们触达更多人。谢谢！',
  review_yes: '⭐ 在 Google Play 上评价',
  review_no: '以后再说',
  share_report_title: '我的 PETO Finanzas 汇总',
  notif_fixed_title: '明天有固定付款',
  notif_fixed_today: '今天有固定付款',
  notif_fixed_body: '{name} · {amount}',
  notif_weekly_title: '你在 PETO Finanzas 的一周',
  notif_weekly_body: '记下本周的支出和收入，保持步调。',
  summary_title: '每日摘要',
  summary_help: '在你选择的时间提醒你昨天花了多少、今天可以花多少。',
  summary_notif_label: '通过通知发送摘要',
  summary_time_label: '摘要时间',
  summary_email_label: '同时通过电子邮件接收',
  summary_email_help: '仅当你的云账户已激活时可用：同一份摘要也会发送到你的电子邮箱。',
  notif_summary_title: '🌅 你的 PETO Finanzas 摘要',
  notif_summary_body: '昨天你花了 {spent} · 今天你可以花 {daily}',
  notif_summary_body_nodaily: '昨天你花了 {spent}',
  sec_remesas: '汇款',
  key_remesas: '本月已发送：{amount}',
  rem_intro: '你寄给亲友的钱：寄出了多少美元，到账多少当地货币。',
  rem_usd_label: '寄出金额（$ USD）',
  rem_rate_label: '汇率（每 $1 兑 {cur}）',
  rem_recipient_label: '寄给谁？',
  rem_currency_label: '目标货币',
  rem_arrives_label: '到账',
  rem_rate_suggested: '你上次用于 {cur} 的汇率：{rate}。已为你填好；如果今天不同可以修改。',
  rem_month_sent: '本月你寄了 {usd}',
  rem_totals_title: '按货币汇总（全部历史）',
  rem_total_row: '寄出 {usd} → 收到 {amount} · 共 {n} 次',
  rem_save: '保存汇款',
  rem_empty: '还没有汇款记录。',
  rem_delete_confirm: '删除给 {name} 的汇款？',
  csv_title: '导入银行对账单 (CSV)',
  csv_help: '上传你银行的 CSV 文件，在导入前预览全部内容：你确认之前不会保存任何内容。',
  csv_file_label: '银行 CSV 文件',
  csv_preview_title: '导入预览',
  csv_summary: '共 {total} 笔交易 · {dups} 笔重复（已排除）· {sel} 笔待导入',
  csv_dup_badge: '重复',
  csv_income_badge: '收入',
  csv_expense_badge: '支出',
  csv_all: '全选',
  csv_none: '全不选',
  csv_apply: '导入所选',
  csv_cancel: '取消导入',
  csv_done: '已导入 {n} 笔交易。✅',
  csv_none_selected: '你没有勾选任何要导入的交易。',
  csv_err_parse: '无法将该文件读取为 CSV。请确认它是银行对账单的 CSV 格式。',
  csv_err_headers: '在该文件中没有找到日期和金额列。',
  csv_err_big: '该文件太大，无法导入。',
  csv_err_empty: '该文件没有可导入的交易。',
  pdf_err_big: '该 PDF 太大（最大 8 MB）。',
  pdf_err_notext: '该 PDF 没有我能读取的文字（看起来像照片或扫描件）。请试试银行的 CSV，或用收据照片记录这笔支出。',
  pdf_err_empty: '我在该 PDF 中没有找到带日期和金额的交易。请试试银行的 CSV。',
  shared_title: '共享预算',
  shared_preview_note: '🔧 设计预览：尚未与其他账户连接。可以用它体验创建家庭、用代码加入和查看成员的样子。',
  shared_create_label: '家庭名称',
  shared_create_btn: '创建家庭',
  shared_join_label: '邀请码',
  shared_join_btn: '用代码加入',
  shared_members_title: '成员',
  shared_code_label: '邀请码：{code}',
  shared_role_dueno: '拥有者',
  shared_role_admin: '管理员',
  shared_role_miembro: '成员',
  shared_role_lector: '只读',
  shared_you: '你',
  shared_host: '主持人',
  shared_leave_btn: '退出家庭',
  shared_leave_confirm: '退出这个家庭？（预览）',
  shared_err_name: '请为家庭输入名称。',
  shared_err_code: '代码为 6 个字母或数字。',
  shared_created: '家庭已创建（预览）。✅',
  shared_joined: '你已加入该家庭（预览）。✅',
  shared_household_fallback: '共享家庭',
  privacy_hide: '隐藏金额',
  privacy_show: '显示金额',
  ins_title: '💡 关于你的钱的小提示',
  ins_cat_up: '{cat} 比上月上涨 {pct}%（{from} → {to}）。',
  ins_pace_down: '你的节奏变好了：支出比上月下降 {pct}%。',
  ins_pace_up: '注意：你的支出节奏比上月上升 {pct}%。',
  ins_biggest: '本月最大支出：{note} · {amount}。',
  ins_saved: '本月你已存下 {amount}。继续保持！',
  bud_alert_title: '预算有风险',
  bud_alert_warn: '{cat}：你已用了预算的 {pct}%。',
  bud_alert_over: '{cat}：你已超出预算（{pct}%）。',
  voice_btn: '🎤 语音输入',
  voice_listening: '正在聆听…请说出金额和用途。',
  voice_unavailable: '此设备不支持语音。',
  voice_heard: '我听到：「{text}」。请核对后保存。',
  voice_no_amount: '我听到：「{text}」，但没有找到金额。',
  ocr_found: '我在小票上识别到 {amount}。请在保存前核对。',
  goals_title: '更多目标',
  goal2_create: '创建目标',
  goal_add: '+ 添加',
  goal_take: '− 取出',
  goal_done: '🎉 目标达成！',
  goal_move_label: '金额',
  goal_delete_confirm: '删除目标「{name}」？你的储蓄不受影响：只删除目标本身。',
  err_limit_goals: '你已达到目标数量上限。',
  biz_label: '这是我生意的',
  biz_title: '本月我的生意',
  biz_income: '生意收入',
  biz_expenses: '生意支出',
  biz_profit: '利润',
  chal_share: '分享我的挑战',
  cloud_title: '云账户',
  cloud_help: '有了账户，你的数据也会保存在云端并同步：换手机时用邮箱登录，一切都在。没有账户时，应用只在这部手机上使用，一如既往。',
  cloud_email: '电子邮箱',
  cloud_pass: '密码',
  cloud_signin: '登录',
  cloud_signup: '创建账户',
  cloud_signout: '退出登录',
  cloud_sync_now: '立即同步',
  cloud_wipe: '删除我的云端数据',
  cloud_who: '已登录为 {email}',
  cloud_synced: '已同步 ✓ · {time}',
  cloud_never: '尚未同步。',
  cloud_working: '处理中…',
  cloud_ok_in: '欢迎回来！',
  cloud_ok_up: '账户已创建！你的数据现在已在云端。',
  cloud_err_fields: '请输入你的邮箱和至少 6 个字符的密码。',
  cloud_err_login: '无法登录。请检查你的邮箱和密码。',
  cloud_err_exists: '该邮箱已有账户。请使用「登录」。',
  cloud_err_confirm: '账户已创建。请查收邮件确认你的账户，然后登录。',
  cloud_err_generic: '云端出错了。请检查网络后重试。',
  cloud_conflict: '云端和这部手机的数据不同。下载云端数据并替换这部手机的数据吗？（取消 = 上传这部手机的数据）',
  cloud_wipe_confirm: '删除你在云端的全部数据？这部手机上的数据保持不变。',
  cloud_delete: '删除我的账户',
  cloud_delete_confirm1: '删除你的 PETO Finanzas 账户？这会删除你的账户、你在云端的数据副本以及你拥有的共享家庭。这部手机上的数据会原样保留（你可以在「设置」中清除）。此操作无法撤销。',
  cloud_delete_confirm2: '最后确认：永久删除你的账户？',
  cloud_deleted: '你的账户已删除。',
  cloud_delete_err_auth: '你的会话已失效。请重新登录后再试。',
  cloud_unavailable: '此版本中没有云服务。',
  key_settings: '姓名、分配、文字、版块、PIN',
  footer: 'PETO Finanzas · 离线可用 · 云端可选：你的数据，你做主',
  tile_available: '可用资金',
  tile_available_aria: '可用资金：前往我的账户',
  tile_savings: '本月储蓄',
  tile_savings_aria: '本月储蓄：前往储蓄',
  tile_debts: '待还债务',
  tile_debts_aria: '待还债务：前往我的债务',
  tile_incomes: '💵 收入',
  tile_incomes_aria: '收入：前往每周收入',
  tile_expenses: '🧾 支出',
  tile_expenses_aria: '支出：前往本月支出',
  tile_goal: '目标「{name}」：{pct}%',
  key_spent_month: '本月已花 {amount}',
  key_income_month: '本月已收到 {amount}',
  key_saved_total: '共已存 {amount}',
  key_goal_suffix: ' · 目标「{name}」：{pct}%',
  key_budget_one: '{n} 个类别有上限',
  key_budget_many: '{n} 个类别有上限',
  key_fixed: '每月 {amount} · 待付 {n} 项',
  key_available: '可用：{amount}',
  key_debts: '待付 {amount}',
  key_san: '第 {x} 周，共 {n} 周 · 下一位：{name}',
  key_san_done: 'San 已结束 🎉',
  key_san_none: '没有进行中的 san',
  banner_payday: '今天是发薪日：记下你的收入和储蓄。',
  banner_dues_title: '即将到期的付款：',
  banner_due_item: '{name}（{day} 日）',
  banner_close: '关闭',
  spend_title: '今天可以花多少？',
  spend_note: '这是你今天不超支可以花的金额。',
  spend_guide: '创建你的第一个类别预算，这里就会显示你每天可以花多少。',
  spend_left: '本月剩余 {days} 天，你还剩 {amount}。',
  spend_left_one: '今天是本月最后一天，你还剩 {amount}。',
  spend_over: '你已用完本月预算。',
  spend_over_by: '你已超出 {amount}。',
  cat_Renta: '房租',
  cat_Comida: '食物',
  "cat_Comida fuera": '外出就餐',
  cat_Gasolina: '汽油',
  cat_Transporte: '交通',
  cat_Salud: '健康',
  cat_Ropa: '服装',
  cat_Otros: '其他',
  btn_cancel: '取消',
  btn_save: '保存',
  btn_edit: '编辑',
  btn_delete: '删除',
  err_amount: '请输入有效金额，大于 $0。',
  err_amount_generic: '请输入有效金额。',
  err_name: '请输入名称。',
  chip_paid: '已付',
  chip_pending: '待付',
  month_prev_aria: '上个月',
  month_next_aria: '下个月',
  exp_new: '新支出',
  exp_edit: '编辑支出',
  exp_total_label: '本月总计：',
  amount_label: '金额 ($)',
  category_label: '类别',
  date_label: '日期',
  note_label: '备注（可选）',
  exp_note_ph: '这笔钱花在什么上？',
  exp_save: '保存支出',
  exp_empty: '本月尚无支出。\n用上面的表单添加第一笔。👍',
  exp_delete_confirm: '删除这笔 {amount} 的支出？类别 {cat}，日期 {date}。只删除这一笔支出。',
  err_category: '请选择有效类别。',
  err_limit_expenses: '已达到保存的支出上限。',
  inc_intro: '储蓄从不自动：你输入每笔收入中真正存下的金额。应用只根据你在「设置」中的百分比建议一个金额。',
  inc_new: '新收入',
  inc_edit: '编辑收入',
  inc_note_ph: '这笔钱从哪来？',
  inc_savings_label: '储蓄 ($)',
  inc_savings_label_sug: '储蓄（建议：{amount}）',
  inc_savings_help: '根据你的储蓄百分比给出的建议——改成你实际存下的金额。可以输入 $0。',
  inc_split_line: '已存：{sav} · 建议：生意 {biz} · 支出 {exp} · 家庭 {fam}',
  inc_split_preview: '建议分配：储蓄 {sav} · 生意 {biz} · 支出 {exp} · 家庭 {fam}。计入的是你在下面输入的储蓄。',
  inc_save: '保存收入',
  inc_empty: '尚未记录任何收入。\n添加你的第一笔收入，并输入你从中存下的金额。💪',
  inc_delete_confirm: '删除这笔 {date} 的 {amount} 收入？它记下的储蓄 {savings} 也会被删除。',
  err_inc_savings: '请输入你从这笔收入中存下的金额（可以是 $0）。',
  err_limit_incomes: '已达到保存的收入上限。',
  sav_intro_1: '在这里你可以看到你存下的每一笔金额。你也可以添加一笔独立的储蓄，',
  sav_intro_2: '不与任何收入绑定',
  sav_intro_3: '，用下面的表单。如果删除一笔储蓄，只删除那个金额：',
  sav_intro_4: '收入保持不变',
  sav_intro_5: '。',
  sav_total_label: '共存下：',
  sav_month_label: '本月已存：',
  sav_form_title: '添加一笔储蓄',
  sav_note_ph: '这笔储蓄是为了什么？',
  sav_save: '保存储蓄',
  sav_goal_label: '分配给目标（可选）',
  sav_goal_none: '无目标 · 一般储蓄',
  sav_empty: '尚未记下任何储蓄。\n用上面的表单添加一笔，或在记录收入时记下它的储蓄，它会出现在这里。🌱',
  sav_from_title: '{date} 的储蓄',
  sav_from_sub: '来自一笔 {amount} 的收入',
  sav_manual_title: '已添加的储蓄',
  sav_manual_sub: '手动 · 添加于 {date}',
  sav_delete_income_confirm: '删除这笔 {date} 的 {amount} 储蓄？只删除这一笔储蓄金额：{income} 的收入保持不变。',
  sav_delete_manual_confirm: '删除这笔 {date} 的 {amount} 储蓄？这是你在「储蓄」中手动添加的一笔；只删除这一条记录。',
  err_limit_savings: '已达到保存的储蓄上限。',
  goal_prompt: '你在为什么存钱？',
  goal_prompt_sub: '创建一个目标，看着你的储蓄一步步接近它。',
  goal_form_create: '创建目标',
  goal_form_edit: '编辑目标',
  goal_name_label: '目标名称',
  goal_name_ph: '例如：应急基金',
  goal_target_label: '目标金额 ($)',
  goal_create_btn: '创建目标',
  goal_save_btn: '保存目标',
  goal_progress: '你已存 {have} / {target}',
  goal_remaining: '还差 {amount}',
  goal_edit: '编辑目标',
  goal_delete: '删除目标',
  err_goal_name: '请输入目标名称。',
  res_cats_title: '按类别支出',
  res_summary_title: '收入 vs 支出 vs 储蓄',
  chart_income: '收入',
  chart_expenses: '支出',
  chart_savings: '储蓄',
  res_cats_empty: '本月没有支出。',
  res_summary_empty: '本月尚无活动。',
  bud_intro: '为每个类别设置每月上限，查看你已花了多少。',
  bud_spent_left: '已花 {spent} / {budget} · 还剩 {left}',
  bud_spent_over: '已花 {spent} / {budget} · 超出 {over}',
  bud_nolimit: '无上限。本月已花：{spent}',
  bud_placeholder: '每月上限 $',
  bud_aria: '{cat} 的每月上限',
  bud_delete_cat: '删除类别',
  bud_delete_cat_confirm: '删除类别「{cat}」？使用它的支出将移到「{other}」。',
  bud_alert_amount: '请输入有效的上限金额。',
  cat_form_title: '自定义类别',
  cat_name_label: '类别名称',
  cat_name_ph: '例如：宠物',
  cat_save: '添加类别',
  err_cat_name: '请输入类别名称。',
  err_cat_exists: '该类别已存在。',
  fix_intro: '每月重复的付款：房租、电话、订阅…',
  fix_new: '新固定付款',
  fix_edit: '编辑固定付款',
  fix_name_ph: '例如：房租',
  fix_day_label: '每月日期',
  fix_save: '保存固定付款',
  fix_empty: '尚无固定付款。',
  fix_sub: '每月 {day} 日 · {month}',
  fix_mark: '标记为已付',
  fix_unmark: '取消标记',
  fix_delete_confirm: '删除固定付款「{name}」？',
  err_day: '日期必须在 1 到 31 之间。',
  err_limit_fixed: '已达到固定付款上限。',
  acc_new: '新账户',
  acc_edit: '编辑账户',
  acc_balance_label: '余额 ($)',
  acc_name_ph: '例如：现金、银行、储蓄',
  acc_save: '保存账户',
  acc_empty: '尚无账户。\n添加一个，即可在汇总中查看你的可用资金。',
  acc_delete_confirm: '删除账户「{name}」？',
  err_balance: '请输入有效余额。',
  err_limit_accounts: '已达到账户上限。',
  debt_new: '新债务',
  debt_edit: '编辑债务',
  debt_name_ph: '例如：信用卡、贷款',
  debt_status_label: '状态',
  debt_status_pending: '待还',
  debt_status_paid: '已还清',
  debt_save: '保存债务',
  debt_empty: '没有记录的债务。🎉',
  debt_mark_paid: '标记为已还',
  debt_mark_pending: '标记为待还',
  debt_delete_confirm: '删除债务「{name}」？',
  err_limit_debts: '已达到债务上限。',
  name_label: '姓名',
  san_intro: 'San（tanda）是一个储蓄圈：每周大家都出资，一人轮流领取总额。',
  san_form_title: '创建一个 san',
  san_name_label: 'San 名称',
  san_name_ph: '例如：家庭 san',
  san_aporte_label: '每轮出资 ($)',
  san_participants_label: '参与者（按轮次顺序）',
  san_pname_ph: '参与者姓名',
  san_add_participant: '添加',
  san_create_btn: '创建 san',
  san_err_participants: '请至少添加 2 名参与者。',
  san_err_active_exists: '已有一个进行中的 san（“{name}”）。如需新建，请先删除它。',
  san_err_dup: '该参与者已在名单中。',
  san_err_pname: '请输入参与者姓名。',
  san_remove: '移除',
  san_draft_empty: '尚未添加参与者。',
  san_week: '第 {x} 周，共 {n} 周',
  san_finished: '🎉 San 已结束！',
  san_finished_note: '所有周都已完成。你可以删除这个 san 并创建一个新的。',
  san_total_line: '共收集：{amount}',
  san_week_collected: '本周已收集：{amount} / {target}',
  san_receiver_line: '下一位：{name}',
  san_aporte_line: '每轮出资：{amount}',
  san_paid_title: '本周谁已付款？',
  san_paid: '已付',
  san_advance: '标记本周完成',
  san_delete: '删除 san',
  san_delete_confirm: '删除 san「{name}」？它的周记录和付款记录会被删除。',
  san_new_btn: '创建一个新 san',
  san_new_confirm: '当前的 san 已结束。删除它并创建新的吗？',
  set_profile: '你的资料',
  set_name_label: '你的名字',
  set_textsize_label: '文字大小',
  textsize_normal: '正常',
  textsize_large: '大',
  set_lang_label: '语言 / Language',
  set_reminders_title: '提醒',
  set_payday_label: '发薪日',
  set_reminders_label: '首页提醒',
  wd_none: '没有发薪日',
  wd_0: '星期日',
  wd_1: '星期一',
  wd_2: '星期二',
  wd_3: '星期三',
  wd_4: '星期四',
  wd_5: '星期五',
  wd_6: '星期六',
  set_split_title: '建议收入分配 (%)',
  set_split_help: '四个数字总和必须为 100。这些百分比只是分配收入的建议：储蓄从不自动保存——你始终输入每笔收入中真正存下的金额。',
  split_ahorro: '储蓄',
  split_negocio: '生意',
  split_gastos: '支出',
  split_familia: '家庭',
  set_save: '保存设置',
  set_err_sum: '百分比总和必须为 100。现在总和是 {total}。',
  set_saved: '设置已保存。✅',
  set_sections_title: '可见版块',
  set_sections_help: '关闭你不用的版块，列表会更短。',
  set_pin_title: '安全 (PIN)',
  pin_status_on: '你有一个已启用的 PIN。应用打开时会锁定。',
  pin_status_off: '你没有 PIN。你可以在这里创建一个来保护你的数据。',
  pin_current_label: '当前 PIN（如果有的话）',
  pin_new_label: '新 PIN（留空 = 移除 PIN）',
  pin_update: '更新 PIN',
  pin_err_current: '当前 PIN 不正确。',
  pin_err_format: '新 PIN 必须是 4 到 6 位数字。',
  pin_off: 'PIN 已关闭。',
  pin_updated: 'PIN 已更新。✅',
  set_data_title: '你的数据',
  set_data_help: '一切都只保存在这部手机上。如想在别处保存，请导出备份。',
  data_export: '导出备份 (JSON)',
  data_import: '导入备份',
  data_reset: '删除全部数据',
  data_err_big: '该文件太大。',
  data_err_invalid: '无法导入：该文件不是有效的 PETO Finanzas 备份。',
  import_confirm: '导入将替换当前应用的全部数据。确定吗？',
  import_done: '备份已导入。✅',
  reset_confirm1: '这会删除这部手机上应用的全部数据。无法撤销。确定吗？',
  reset_confirm2: '最后确认：删除一切并重新开始？',
  lock_prompt: '请输入 PIN 继续。',
  lock_pin_label: 'PIN',
  lock_enter: '解锁',
  lock_note: '你的数据只保存在这部手机上。',
  lock_err: 'PIN 不正确。请再试一次。',
  ob_title: '欢迎来到 PETO Finanzas！',
  ob_intro_1: '几分钟内打理好你的钱：支出、收入、预算、账户和债务。',
  ob_intro_2: '无需账户，无需网络。',
  ob_intro_3: '一切都只保存在你的手机上。',
  ob_name_label: '你叫什么名字？',
  ob_name_ph: '你的名字',
  ob_pin_label: '创建一个安全 PIN（可选）',
  ob_pin_ph: '4 到 6 位数字，或留空',
  ob_pin2_label: '重复 PIN',
  ob_pin2_ph: '重复 PIN',
  ob_start: '开始',
  ob_note: '你可以随时在「设置」中更改 PIN。',
  ob_tour1_title: '几秒钟记下一笔支出',
  ob_tour1_text: '点 + 按钮，输入金额和类别。就是这么简单：你的支出立即保存。',
  ob_tour2_title: '今天可以花多少？',
  ob_tour2_text: 'PETO Finanzas 把你的预算分摊到本月剩余的每一天，只告诉你一个数字：今天不超支可以花多少。',
  ob_tour3_title: '你的云账户（可选）',
  ob_tour3_text: '如果你愿意，可以创建一个免费账户，在网页上也能查看你的数据。没有账户时，一切都只在你的手机上。',
  ob_tour_next: '下一步',
  ob_tour_skip: '跳过',
  ob_tour_go: '开始吧！',
  ob_err_name: '请输入你的名字以开始。',
  ob_err_pin_format: 'PIN 必须是 4 到 6 位数字。',
  ob_err_pin_mismatch: '两个 PIN 不一致。',
  set_theme_label: '主题',
  theme_light: '浅色',
  theme_dark: '深色',
  theme_auto: '自动（系统）',
  set_accent_label: '主色',
  accent_verde: '绿色',
  accent_azul: '蓝色',
  accent_morado: '紫色',
  accent_naranja: '橙色',
  undo_done: '已完成',
  undo_btn: '撤销',
  btn_repeat: '重复',
  fab_aria: '快速添加',
  quick_title: '你想添加什么？',
  quick_expense: '🧾 支出',
  quick_income: '💵 收入',
  quick_savings: '🐷 储蓄',
  sec_buscar: '搜索活动',
  search_label: '搜索',
  search_ph: '备注、类别或金额…',
  search_month_label: '月份（留空 = 全部）',
  search_type_label: '类型',
  type_all: '全部',
  type_gastos: '支出',
  type_ingresos: '收入',
  type_ahorros: '储蓄',
  search_empty: '无结果。',
  search_type_income: '收入',
  search_type_saving: '储蓄',
  chal_title: '🔥 每周储蓄挑战',
  chal_progress: '本周：{have} / {target}',
  chal_done: '🎉 本周挑战已完成！',
  chal_streak_one: '连续：已完成 1 周',
  chal_streak_many: '连续：已完成 {n} 周',
  chal_streak_zero: '连续：0 周。这周可以是第一周！',
  streak_one: '🔥 连续记录 1 天',
  streak_many: '🔥 连续记录 {n} 天',
  chal_target_label: '每周储蓄目标 ($)',
  chal_save: '保存每周目标',
  rep_title: '月度报告',
  rep_download: '下载图片',
  rep_share_image: '分享图片',
  trend_title: '支出趋势',
  trend_weeks: '本月的周',
  trend_week: '第 {n} 周',
  trend_empty: '尚无支出可显示趋势。',
  rep_income: '收入',
  rep_expenses: '支出',
  rep_savings: '储蓄',
  rep_top_cat: '首要类别',
  rep_top3: '前 3 类别',
  rep_goal: '储蓄目标',
  rep_none: '无活动',
  calc_title: '还债计算器',
  calc_intro: '比较两种还债计划：先还最小的（滚雪球法），或先还利息最高的（雪崩法）。每月你支付所有最低还款额，其余的用于目标债务。',
  calc_budget_label: '你每月总共能还多少债务？($)',
  calc_run: '计算',
  calc_snowball: '滚雪球法（先还余额最小的）',
  calc_avalanche: '雪崩法（先还利息最高的）',
  calc_result: '{months} 个月即可无债 · 利息约 {interest}',
  calc_months_one: '1 个月即可无债 · 利息约 {interest}',
  calc_order: '还款顺序：',
  calc_free: '你没有待还的债务！🎉',
  calc_warn: '按这个每月还款额，有些债务永远还不完：还款甚至不够付利息。请提高每月还款额。',
  calc_note_zero: '没有记录最低还款额或利息的债务，按 $0 最低还款和 0% 利息计算。',
  calc_err_budget: '请输入你每月能还的金额。',
  debt_interest_label: '年利率 %（可选）',
  debt_minpay_label: '每月最低还款 $（可选）',
  debt_terms: '年利率 {pct}% · 最低 {min}/月',
  exp_photo_label: '小票照片（可选）',
  exp_photo_remove: '移除照片',
  photo_close: '关闭',
  err_photo_quota: '没有空间保存照片：支出已在没有照片的情况下保存。',
  banner_backup: '你已经有一段时间没有保存数据备份了。请在「设置」中导出备份。',
  pro_title: 'PETO Pro',
  pro_card_text: '为你的数据提供无限云存储、高级报告、共享预算和 san 组织者模式。',
  pro_status_free: '你目前使用免费计划。',
  pro_status_active: 'PETO Pro 已启用。感谢你支持 PETO Finanzas！⭐',
  pro_status_test: 'PETO Pro 在封闭测试期间开放：测试期间你拥有完整访问权限。',
  pro_status_waitlist: '你在 PETO Pro 等候名单上。',
  pro_btn_see: '查看 PETO Pro',
  pro_wall_title: '这是 PETO Pro 功能 ⭐',
  pro_price_line: '每月仅 $1.99',
  pro_benefit_cloud: '☁️ 为你的数据提供无限云存储',
  pro_benefit_report: '📊 高级报告：比较月份并导出 CSV',
  pro_benefit_shared: '🏠 与你的家庭共享预算',
  pro_benefit_org: '🤝 San 组织者模式：整个小组的 tanda',
  pro_coming_text: '应用内购买将随 Google Play 上线而来。在此之前你可以加入等候名单：当你可以以每月 $1.99 启用 Pro 时，我们会通知你。',
  pro_waitlist_btn: '加入等候名单',
  pro_waitlist_done: '你已在名单上 ✅ 当 Pro 可用时我们会通知你。',
  pro_close: '以后再说',
  pro_tag: 'PRO',
  adv_title: '高级报告',
  adv_note: '这是 PETO Pro 功能：本月与上月对比、每个类别，以及本月的 CSV 导出。',
  adv_open_btn: '查看高级报告',
  adv_export_csv: '将本月导出为 CSV',
  adv_this_month: '本月',
  adv_prev_month: '上个月',
  adv_change: '变化',
  adv_all_cats: '全部类别',
  adv_empty: '这两个月没有活动。',
  org_title: 'San 组织者模式',
  org_intro: '管理整个小组的 tanda：带日期的轮次，标记每轮谁已付款，并与小组分享状态。',
  org_pro_note: '组织者模式是 PETO Pro 功能。',
  org_form_title: '创建小组 san',
  org_freq_label: '轮次频率',
  org_freq_semanal: '每周',
  org_freq_quincenal: '每 2 周',
  org_freq_mensual: '每月',
  org_start_label: '第一轮日期',
  org_create_btn: '创建有组织的 san',
  org_round: '第 {x} 轮，共 {n} 轮',
  org_receiver_line: '领取者：{name}',
  org_pending_none: '大家都付了！🎉',
  org_pending_list: '尚未付款：{names}',
  org_pending_count_one: '还剩 1 人未付',
  org_pending_count_many: '还剩 {n} 人未付',
  org_totals_title: '每位参与者的出资',
  org_paid_rounds: '已付 {paid} / {n} 轮',
  org_delete: '删除有组织的 san',
  org_delete_confirm: '删除有组织的 san「{name}」？小组的付款记录将丢失。',
  org_share_title: 'San 状态',
  shared_live_note: '与你的家庭共享预算：创建一个家庭或用代码加入，你们将看到相同的成员。你需要你的云账户（上方「设置」中）和 PETO Pro。',
  shared_leave_live: '退出这个家庭？你将不再看到它的共享预算。',
  shared_err_login: '请先用你的云账户登录（上方「设置」中），然后再试。',
  shared_err_generic: '无法完成。请检查网络后重试。',
  shared_err_code_live: '该代码不存在。请核对后重试。',
  shared_err_member: '你已经是这个家庭的成员。',
  shared_err_owner_leave: '你拥有这个家庭：不删除它就无法退出。请让另一位成员创建新家庭。',
  shared_created_live: '家庭已创建 ✅ 分享代码邀请你的家庭。',
  shared_joined_live: '你已加入该家庭 ✅',
  lang_auto: '自动（手机语言）',
  org_comp_label: '组织者补偿',
  org_comp_none: '无补偿',
  org_comp_first: '组织者第一个领取',
  org_comp_last: '组织者最后一个领取',
  org_comp_extra: '每轮额外费用',
  org_comp_amount_label: '每人额外费用 ($)',
  org_comp_line: '组织者补偿：{mode}',
  org_sim_title: '奖池模拟',
  org_sim_pays: '每位参与者每轮出资：{amount}',
  org_sim_pot: '每轮奖池：{amount}',
  org_sim_total_in: '每人在整个 san 中总共出资：{amount}',
  org_sim_extra_org: '组织者每轮额外获得 {amount}',
  org_sim_first: '组织者获得第一轮奖池',
  org_sim_last: '组织者获得最后一轮奖池',
  org_shuffle_btn: '🎲 随机排序',
  org_shuffled: '🎲 已随机排序！这是新的轮次顺序。',
  org_shuffle_need: '请至少添加 2 位参与者才能随机排序。',
  org_shuffle_blocked: '无法再随机排序：san 已开始或已有付款记录。',
  org_start_btn: '开始 san',
  org_started_line: 'San 进行中 · 顺序已锁定',
  org_order_title: '轮次顺序',
  org_move_up: '上移',
  org_move_down: '下移',
  org_swap_blocked: '该轮次已有付款，无法更改。',
  org_history_title: '变更历史',
  org_history_swap: '{a} 和 {b} 交换了轮次',
  org_history_started: '组织者已开始 san',
  org_pay_pending: '待处理',
  org_pay_reported: '已报告',
  org_pay_confirmed: '已确认',
  org_status_btn: '状态：{status}',
  org_receipt_add: '📎 收据',
  org_receipt_view: '查看收据',
  org_receipt_remove: '移除',
  org_zelle_label: '每位参与者的 Zelle（号码或邮箱，可选）',
  org_zelle_ph: 'Zelle（可选）',
  org_zelle_line: 'Zelle：{zelle}',
  org_reminder_btn: '📲 WhatsApp 提醒',
  org_reminder_head: '🤝 {san} · 第 {x} 轮，共 {n} 轮 · {date}',
  org_reminder_receiver: '💰 本周由 {name} 领取',
  org_reminder_zelle: '{name} 的 Zelle：{zelle}',
  org_reminder_amount: '本轮出资：{amount}',
  org_antifraud: '🛡️ San 从不支付利息，也不会超过出资总额。',
  org_link_btn: '🔗 只读链接',
  org_link_publish: '创建链接',
  org_link_update: '更新链接',
  org_link_copied: '链接已复制！',
  org_link_need_cloud: '该链接需要你的云账户：请在设置中登录后重试。',
  org_link_ready: '群组 san（只读）',
  org_public_title: '链接已准备好分享。',
  org_public_updated: '更新于 {date}',
  org_public_notfound: '此链接已不可用。',
  org_pub_pay_btn: '我已付款',
  org_pub_confirm: '你已经支付了这一轮的份额吗？组织者会确认。',
  org_pub_attach: '📎 附上收据照片（可选）',
  org_pub_send: '发送报告',
  org_pub_sent: '完成！你的付款已报告。',
  org_pub_reported_note: '已报告 · 等待确认',
  org_pub_err: '发送失败。请检查网络后重试。',
  org_pub_err_confirmed: '这笔付款已被组织者确认。',
  org_pub_err_photo: '照片太大；请换一张更小的。',
  org_penalty_label: '迟交规则',
  org_penalty_none: '无罚款',
  org_penalty_fixed: '固定罚款',
  org_penalty_percent: '出资百分比',
  org_penalty_amount_label: '罚款金额 ($)',
  org_penalty_percent_label: '罚款百分比 (%)',
  org_penalty_line_fixed: '如有人迟交：罚款 {amount}',
  org_penalty_line_percent: '如有人迟交：罚款为出资的 {percent}%',
  set_news_title: '更新内容',
  news_c24: 'Compilación 24：欢迎导览、连续记录天数、带进度条的储蓄目标和趋势图表。',
  news_c25: 'Compilación 25：主屏幕小部件，以及体积小得多的应用（从 52 MB 降到 7 MB）。',
  news_c26: 'Compilación 26：三种尺寸的小部件，每个小部件可单独设置，还有无需打开应用即可记一笔支出的按钮。',
  news_c27: 'Compilación 27：应用支持 12 种语言，自动跟随手机的语言。',
  news_c28: 'Compilación 28：启动即应用大号文字、这个更新内容板块、意大利语文本校订，以及更快的启动速度。',
  news_c31: 'Compilación 31：返回键或返回手势现在会在应用内移动：先关闭打开的内容，回到主屏幕，然后才退出。',
  news_c32: '第 32 版：品牌名称现已在整个应用中统一为“PETO Finanzas”（菜单、锁定屏幕和小部件），san 已移到主页列表顶部，san 公开链接可直接打开群组状态，组织者按钮始终会给出明确提示。',
  news_c33: '第 33 版：新建 san 不再会误删正在进行的 san——如果已有一个活跃的 san，应用会明确提示并保护它（付款、凭证、历史和公开链接）——网页版现已与手机同步。',
  news_c34: '第 34 版：PETO Finanzas 全新标志——翠绿底色上白色的“P”配浅绿色柱条与箭头，现已出现在图标、锁屏和整个应用中。',
  news_c35: '第 35 版：通过 san 公开链接，现在可以用"我已付款"报告付款并附上收据（由组织者确认）；公开查看器采用深色主题；下拉即可刷新应用；PDF 读取器不再把你发出的 Zelle 付款误认为收入。',
  sec_podcast: '播客',
  key_podcast: 'Finanzas Personales 播客',
  pod_hosts: '主播：Lucía 与 Marco',
  pod_desc: '轻松聊钱：简短节目，实用建议，帮你存钱、摆脱债务、管好钱包。',
  pod_spotify_btn: '在 Spotify 收听',
  pod_loading: '正在加载节目…',
  pod_offline: '无连接：显示上次下载的列表',
  pod_error: '无法加载节目。请检查网络后重试。',
  pod_empty: '尚未发布任何节目。',
  pod_play_aria: '播放',
  pod_pause_aria: '暂停',
  pod_audio_error: '无法播放这一集。',
  pub_tagline: '你的 san，井井有条、公开透明',
  pub_progress: '已确认 {x}/{n} 笔付款',
  pub_progress_start: '刚刚开始：尚无已确认的付款',
  pub_cta_title: '想组织你自己的 san 吗？',
  pub_cta_text: '有了 PETO Finanzas，顺序、轮次和收据都集中在一处——不用笔记本，不混乱。',
  pub_cta_try: '试用 PETO Finanzas',
  pub_cta_more: '了解更多',
  pub_bar_try: '试用应用',
  pub_footer: '由 PETO Finanzas 制作 · petofinanzas.com',
  news_c36: '第 36 版：新增播客版块——无需离开应用即可收听《Finanzas Personales》，内置播放器，列表会保存以便离线查看；欢迎页现在会自动逐页切换；链接视图也焕然一新：san 展示进度，并可直接试用应用。',
  news_c37: '第 37 版：小部件全新设计——品牌渐变、会随预算变色的进度条，以及 san 下一轮的提示行——还有一个全新的、只有一个图标大小的小部件，显示你今天能花多少；在 san 公开链接中下滑时，品牌始终可见；组织者的轮次现在折叠成手风琴，仅展开本周一轮。',
  widget_today: '今日',
  widget_san_next: '下一轮：{name} · {date}',
  widget_san_next_nodate: '下一轮：{name}',
  back_exit_hint: '再按一次返回即可退出。'
},
ja: {
  org_err_san_name: 'sanの名前を入力してください。', rep_promo_footer: 'PETO Finanzasで支出を管理しよう · petofinanzas.com', rep_saved: '画像を保存しました。', set_sections_summary: '{total}件中{visible}件を表示',
  org_err_active_exists: 'すでにアクティブな san（「{name}」）があります。新しく作るには、まずそのカードから削除してください。',
  app_title: 'PETO Finanzas',
  back: '← すべてのオプション',
  greeting: 'こんにちは',
  lock_btn: 'ロック',
  home_menu_heading: '何を見たいですか？',
  group_daily: '日常',
  group_plan: 'プランニング',
  group_accounts: '口座と支払い義務',
  group_yourapp: 'あなたのアプリ',
  sec_gastos: '今月の支出',
  sec_ingresos: '毎週の収入',
  sec_ahorros: '貯蓄',
  sec_resumen: '概要',
  sec_presupuesto: 'カテゴリ別予算',
  sec_pagos: '固定支払い',
  sec_cuentas: '私の口座',
  sec_deudas: '私の借金',
  sec_san: '私のsan（tanda）',
  sec_ajustes: '設定とカスタマイズ',
  menu_open_aria: 'メニューを開く',
  menu_close_aria: 'メニューを閉じる',
  sec_home: 'ホーム',
  key_home: 'メイン画面',
  set_notif_label: 'アプリを閉じているときの通知',
  set_notif_help: 'PETO Finanzasを閉じていても、固定支払いの前日と当日に知らせます。',
  set_autofixed_label: '固定支払いを自動で記録',
  set_autofixed_help: '固定支払いの期日が来ると、支出が自動で記録されます。すぐに元に戻すこともできます。',
  set_bio_label: '指紋ロック解除',
  set_bio_help: 'PINに加えて指紋でも入れるようにします（有効なPINが必要です）。',
  bio_btn: '👆 指紋で入る',
  bio_reason: 'PETO Finanzasを開くために本人確認をしてください',
  bio_need_pin: '指紋ロック解除には有効なPINが必要です。「設定 → セキュリティ」でPINを作成すると、アプリを開くときに指紋が使えます。',
  bio_failed: '指紋を確認できませんでした。PINを入力してください。',
  bio_unavailable: 'このスマートフォンでは指紋は使えません。PINを入力してください。',
  bio_not_enrolled: 'このスマートフォンには指紋が登録されていません。スマートフォンの設定で登録するか、PINを入力してください。',
  bio_offer_title: '指紋でロック解除しますか？',
  bio_offer_text: 'PINを作成しました。よければ、毎回PINを入力する代わりに指紋でPETO Finanzasを開けます。今すぐオンにしますか？',
  bio_offer_yes: 'はい、指紋をオンにする',
  bio_offer_no: '後で',
  bio_activated: '完了：指紋ロック解除がオンになりました。',
  fix_auto_suffix: '（自動の固定支払い）',
  backup_pass_label: '暗号化バックアップのパスワード',
  backup_pass_ph: '4文字以上',
  data_export_enc: '暗号化バックアップを書き出す',
  backup_help: '暗号化バックアップはあなたのパスワードでしか開けません。パスワードがなければ復元できません。大切に保管してください。暗号化バックアップを読み込むには、ファイルを選ぶ前にここでそのパスワードを入力してください。',
  backup_err_short: 'パスワードは4文字以上必要です。',
  backup_need_pass: '暗号化バックアップを読み込む前に、そのパスワードを入力してください。',
  backup_err_pass: 'バックアップを開けませんでした：パスワードが違うか、ファイルが壊れています。',
  share_btn: '概要を共有',
  share_copied: '概要をコピーしました。どこにでも貼り付けてください。',
  review_title: 'PETO Finanzasは気に入りましたか？',
  review_text: 'PETO Finanzasがお金の管理に役立っているなら、Google Playでのレビューがより多くの人に届ける大きな助けになります。ありがとうございます！',
  review_yes: '⭐ Google Playで評価',
  review_no: '後で',
  share_report_title: '私のPETO Finanzas概要',
  notif_fixed_title: '明日は固定支払い',
  notif_fixed_today: '今日は固定支払い',
  notif_fixed_body: '{name} · {amount}',
  notif_weekly_title: 'PETO Finanzasでのあなたの1週間',
  notif_weekly_body: '今週の支出と収入を記録して、ペースを保ちましょう。',
  summary_title: '毎日のまとめ',
  summary_help: '選んだ時間に、昨日使った金額と今日使える金額をお知らせします。',
  summary_notif_label: '通知でまとめを受け取る',
  summary_time_label: 'まとめの時刻',
  summary_email_label: 'メールでも受け取る',
  summary_email_help: 'クラウドアカウントが有効な場合のみ：同じまとめがメールにも届きます。',
  notif_summary_title: '🌅 あなたの PETO Finanzas まとめ',
  notif_summary_body: '昨日は {spent} を使いました · 今日は {daily} まで使えます',
  notif_summary_body_nodaily: '昨日は {spent} を使いました',
  sec_remesas: '送金',
  key_remesas: '今月の送金：{amount}',
  rem_intro: 'あなたの大切な人へ送るお金：ドルでいくら出て、相手の通貨でいくら届いたか。',
  rem_usd_label: '送金額（$ USD）',
  rem_rate_label: 'レート（$1あたり{cur}）',
  rem_recipient_label: '誰に？',
  rem_currency_label: '送金先の通貨',
  rem_arrives_label: '届く金額',
  rem_rate_suggested: '{cur}で前回使ったレート：{rate}。入力済みです。今日のレートが違えば変更してください。',
  rem_month_sent: '今月は{usd}送りました',
  rem_totals_title: '通貨別の合計（全履歴）',
  rem_total_row: '{usd}送信 → {amount}受取 · {n}回',
  rem_save: '送金を保存',
  rem_empty: 'まだ送金の記録がありません。',
  rem_delete_confirm: '{name}への送金を削除しますか？',
  csv_title: '銀行明細を取り込む（CSV）',
  csv_help: '銀行のCSVファイルをアップロードし、読み込む前にプレビューで全部確認できます。確定するまで何も保存されません。',
  csv_file_label: '銀行のCSVファイル',
  csv_preview_title: '読み込みのプレビュー',
  csv_summary: '全{total}件 · 重複{dups}件（除外）· 読み込み{sel}件',
  csv_dup_badge: '重複',
  csv_income_badge: '収入',
  csv_expense_badge: '支出',
  csv_all: 'すべて選択',
  csv_none: 'すべて解除',
  csv_apply: '選択したものを読み込む',
  csv_cancel: '読み込みをキャンセル',
  csv_done: '{n}件の明細を読み込みました。✅',
  csv_none_selected: '読み込む明細が選択されていません。',
  csv_err_parse: 'そのファイルをCSVとして読み取れませんでした。銀行明細のCSV形式か確認してください。',
  csv_err_headers: 'そのファイルに日付と金額の列が見つかりませんでした。',
  csv_err_big: 'そのファイルは大きすぎて読み込めません。',
  csv_err_empty: 'そのファイルには読み込める明細がありません。',
  pdf_err_big: 'そのPDFは大きすぎます（最大8 MB）。',
  pdf_err_notext: 'そのPDFには読み取れるテキストがありません（写真やスキャンのようです）。銀行のCSVを試すか、レシートの写真で支出を記録してください。',
  pdf_err_empty: 'そのPDFに日付と金額のある明細が見つかりませんでした。銀行のCSVをお試しください。',
  shared_title: '共有予算',
  shared_preview_note: '🔧 デザインプレビュー：まだ他のアカウントには接続しません。世帯の作成、コードでの参加、メンバーの表示がどうなるか試すためのものです。',
  shared_create_label: '世帯の名前',
  shared_create_btn: '世帯を作成',
  shared_join_label: '招待コード',
  shared_join_btn: 'コードで参加',
  shared_members_title: 'メンバー',
  shared_code_label: '招待コード：{code}',
  shared_role_dueno: 'オーナー',
  shared_role_admin: '管理者',
  shared_role_miembro: 'メンバー',
  shared_role_lector: '閲覧のみ',
  shared_you: 'あなた',
  shared_host: 'ホスト',
  shared_leave_btn: '世帯を退出',
  shared_leave_confirm: 'この世帯を退出しますか？（プレビュー）',
  shared_err_name: '世帯の名前を入力してください。',
  shared_err_code: 'コードは6文字の英数字です。',
  shared_created: '世帯が作成されました（プレビュー）。✅',
  shared_joined: '世帯に参加しました（プレビュー）。✅',
  shared_household_fallback: '共有世帯',
  privacy_hide: '金額を隠す',
  privacy_show: '金額を表示',
  ins_title: '💡 お金のヒント',
  ins_cat_up: '{cat}は先月より{pct}%増えました（{from} → {to}）。',
  ins_pace_down: 'ペースが良くなっています。支出は先月より{pct}%減りました。',
  ins_pace_up: '注意：支出のペースが先月より{pct}%上がっています。',
  ins_biggest: '今月の最大の支出：{note} · {amount}。',
  ins_saved: '今月は{amount}貯蓄しました。その調子です！',
  bud_alert_title: '予算が危険です',
  bud_alert_warn: '{cat}：予算の{pct}%まで来ています。',
  bud_alert_over: '{cat}：予算を超えました（{pct}%）。',
  voice_btn: '🎤 音声入力',
  voice_listening: '聞き取り中…金額と何に使ったか言ってください。',
  voice_unavailable: 'このデバイスでは音声は使えません。',
  voice_heard: '聞き取りました：「{text}」。確認して保存してください。',
  voice_no_amount: '聞き取りました：「{text}」。でも金額が見つかりませんでした。',
  ocr_found: 'レシートで{amount}を検出しました。保存前に確認してください。',
  goals_title: 'その他の目標',
  goal2_create: '目標を作成',
  goal_add: '+ 追加',
  goal_take: '− 引き出す',
  goal_done: '🎉 目標達成！',
  goal_move_label: '金額',
  goal_delete_confirm: '目標「{name}」を削除しますか？貯蓄には影響しません。削除されるのは目標だけです。',
  err_limit_goals: '目標の上限数に達しています。',
  biz_label: 'これは私の事業用です',
  biz_title: '今月の私の事業',
  biz_income: '事業の収入',
  biz_expenses: '事業の支出',
  biz_profit: '利益',
  chal_share: '私のチャレンジを共有',
  cloud_title: 'クラウドアカウント',
  cloud_help: 'アカウントがあれば、データはクラウドにも保存され同期されます。スマートフォンを替えても、メールでログインすればすべてそこにあります。アカウントがなければ、アプリはこのスマートフォンだけで動作します。今まで通りです。',
  cloud_email: 'メールアドレス',
  cloud_pass: 'パスワード',
  cloud_signin: 'ログイン',
  cloud_signup: 'アカウントを作成',
  cloud_signout: 'ログアウト',
  cloud_sync_now: '今すぐ同期',
  cloud_wipe: 'クラウドのデータを削除',
  cloud_who: '{email}としてログイン中',
  cloud_synced: '同期済み ✓ · {time}',
  cloud_never: 'まだ同期されていません。',
  cloud_working: '処理中…',
  cloud_ok_in: 'おかえりなさい！',
  cloud_ok_up: 'アカウントが作成されました！データはクラウドにあります。',
  cloud_err_fields: 'メールアドレスと6文字以上のパスワードを入力してください。',
  cloud_err_login: 'ログインできませんでした。メールアドレスとパスワードを確認してください。',
  cloud_err_exists: 'そのメールアドレスには既にアカウントがあります。「ログイン」を使ってください。',
  cloud_err_confirm: 'アカウントが作成されました。メールを確認してアカウントを確定し、ログインしてください。',
  cloud_err_generic: 'クラウドで問題が発生しました。インターネット接続を確認して、もう一度お試しください。',
  cloud_conflict: 'クラウドとこのスマートフォンでデータが異なります。クラウドのデータをダウンロードして、このスマートフォンのデータと置き換えますか？（キャンセル＝このスマートフォンのデータをアップロード）',
  cloud_wipe_confirm: 'クラウド上のあなたのデータをすべて削除しますか？このスマートフォン上のデータはそのままです。',
  cloud_delete: '私のアカウントを削除',
  cloud_delete_confirm1: 'PETO Finanzasアカウントを削除しますか？アカウント、クラウド上のデータのコピー、あなたが所有する共有世帯が削除されます。このスマートフォン上のデータはそのまま残ります（設定で消去できます）。これは取り消せません。',
  cloud_delete_confirm2: '最終確認：アカウントを完全に削除しますか？',
  cloud_deleted: 'アカウントが削除されました。',
  cloud_delete_err_auth: 'セッションの有効期限が切れました。再度ログインして、もう一度お試しください。',
  cloud_unavailable: 'このバージョンではクラウドは利用できません。',
  key_settings: '名前、配分、文字、セクション、PIN',
  footer: 'PETO Finanzas · オフラインで動作 · クラウドは任意：あなたのデータ、あなたの選択',
  tile_available: '利用可能なお金',
  tile_available_aria: '利用可能なお金：私の口座へ',
  tile_savings: '今月の貯蓄',
  tile_savings_aria: '今月の貯蓄：貯蓄へ',
  tile_debts: '未払いの借金',
  tile_debts_aria: '未払いの借金：私の借金へ',
  tile_incomes: '💵 収入',
  tile_incomes_aria: '収入：毎週の収入へ',
  tile_expenses: '🧾 支出',
  tile_expenses_aria: '支出：今月の支出へ',
  tile_goal: '目標「{name}」：{pct}%',
  key_spent_month: '今月{amount}使いました',
  key_income_month: '今月{amount}受け取りました',
  key_saved_total: '合計{amount}貯蓄済み',
  key_goal_suffix: ' · 目標「{name}」：{pct}%',
  key_budget_one: '上限のあるカテゴリが{n}件',
  key_budget_many: '上限のあるカテゴリが{n}件',
  key_fixed: '月{amount} · 支払い{n}件',
  key_available: '利用可能：{amount}',
  key_debts: '未払い{amount}',
  key_san: '{n}週中{x}週目 · 次は：{name}',
  key_san_done: 'sanが終了しました 🎉',
  key_san_none: '進行中のsanはありません',
  banner_payday: '今日は給料日です。収入と貯蓄を記録しましょう。',
  banner_dues_title: 'まもなく支払い：',
  banner_due_item: '{name}（{day}日）',
  banner_close: '閉じる',
  spend_title: '今日はいくら使えますか？',
  spend_note: 'これは、予算を超えずに今日使える金額です。',
  spend_guide: '最初のカテゴリ予算を作成すると、ここに1日いくら使えるか表示されます。',
  spend_left: '今月の残り{days}日で{amount}残っています。',
  spend_left_one: '今月最後の日の今日、{amount}残っています。',
  spend_over: '今月の予算に達しました。',
  spend_over_by: '{amount}超過しています。',
  cat_Renta: '家賃',
  cat_Comida: '食費',
  "cat_Comida fuera": '外食',
  cat_Gasolina: 'ガソリン',
  cat_Transporte: '交通',
  cat_Salud: '健康',
  cat_Ropa: '衣類',
  cat_Otros: 'その他',
  btn_cancel: 'キャンセル',
  btn_save: '保存',
  btn_edit: '編集',
  btn_delete: '削除',
  err_amount: '0ドルより大きい有効な金額を入力してください。',
  err_amount_generic: '有効な金額を入力してください。',
  err_name: '名前を入力してください。',
  chip_paid: '支払い済み',
  chip_pending: '未払い',
  month_prev_aria: '前の月',
  month_next_aria: '次の月',
  exp_new: '新しい支出',
  exp_edit: '支出を編集',
  exp_total_label: '今月の合計：',
  amount_label: '金額（$）',
  category_label: 'カテゴリ',
  date_label: '日付',
  note_label: 'メモ（任意）',
  exp_note_ph: '何に使いましたか？',
  exp_save: '支出を保存',
  exp_empty: '今月はまだ支出がありません。\n上のフォームで最初の1件を追加しましょう。👍',
  exp_delete_confirm: 'この{amount}の支出を削除しますか？カテゴリ{cat}、{date}。削除されるのはこの支出だけです。',
  err_category: '有効なカテゴリを選んでください。',
  err_limit_expenses: '保存できる支出の上限に達しました。',
  inc_intro: '貯蓄は決して自動ではありません。各収入から実際にいくら貯蓄したかを入力します。アプリは設定のパーセンテージに基づいた金額を提案するだけです。',
  inc_new: '新しい収入',
  inc_edit: '収入を編集',
  inc_note_ph: 'どこから来ましたか？',
  inc_savings_label: '貯蓄（$）',
  inc_savings_label_sug: '貯蓄（提案：{amount}）',
  inc_savings_help: 'あなたの貯蓄パーセンテージに基づく提案です。実際に貯蓄した額に変更してください。0ドルでも入力できます。',
  inc_split_line: '貯蓄済み：{sav} · 提案：事業{biz} · 支出{exp} · 家族{fam}',
  inc_split_preview: '提案される配分：貯蓄{sav} · 事業{biz} · 支出{exp} · 家族{fam}。数えられる貯蓄は下で入力したものです。',
  inc_save: '収入を保存',
  inc_empty: 'まだ収入が記録されていません。\n最初の収入を追加し、そのうちいくら貯蓄したか入力しましょう。💪',
  inc_delete_confirm: '{date}のこの{amount}の収入を削除しますか？記録された貯蓄{savings}も削除されます。',
  err_inc_savings: 'この収入からいくら貯蓄したか入力してください（0ドルでもかまいません）。',
  err_limit_incomes: '保存できる収入の上限に達しました。',
  sav_intro_1: 'ここでは貯蓄した金額を1件ずつすべて見られます。独立した貯蓄を追加することもできます。',
  sav_intro_2: 'どの収入にも結びついていない',
  sav_intro_3: '、下のフォームで。貯蓄を削除しても、削除されるのはその金額だけです：',
  sav_intro_4: '収入はそのままです',
  sav_intro_5: '。',
  sav_total_label: '合計貯蓄：',
  sav_month_label: '今月の貯蓄：',
  sav_form_title: '貯蓄を追加',
  sav_note_ph: 'この貯蓄は何のためですか？',
  sav_save: '貯蓄を保存',
  sav_goal_label: '目標に割り当てる（任意）',
  sav_goal_none: '目標なし · 一般の貯蓄',
  sav_empty: 'まだ貯蓄が記録されていません。\n上のフォームで追加するか、収入を記録するときにその貯蓄を記録すると、ここに表示されます。🌱',
  sav_from_title: '{date}の貯蓄',
  sav_from_sub: '{amount}の収入から',
  sav_manual_title: '追加した貯蓄',
  sav_manual_sub: '手動 · {date}に追加',
  sav_delete_income_confirm: '{date}のこの{amount}の貯蓄を削除しますか？削除されるのはこの貯蓄額だけです。{income}の収入はそのままです。',
  sav_delete_manual_confirm: '{date}のこの{amount}の貯蓄を削除しますか？これは貯蓄で手動で追加したものです。削除されるのはこの項目だけです。',
  err_limit_savings: '保存できる貯蓄の上限に達しました。',
  goal_prompt: '何のために貯蓄していますか？',
  goal_prompt_sub: '目標を作成して、貯蓄が近づいていくのを見守りましょう。',
  goal_form_create: '目標を作成',
  goal_form_edit: '目標を編集',
  goal_name_label: '目標の名前',
  goal_name_ph: '例：緊急用資金',
  goal_target_label: '目標金額（$）',
  goal_create_btn: '目標を作成',
  goal_save_btn: '目標を保存',
  goal_progress: '{target}中{have}貯蓄しました',
  goal_remaining: 'あと{amount}',
  goal_edit: '目標を編集',
  goal_delete: '目標を削除',
  err_goal_name: '目標の名前を入力してください。',
  res_cats_title: 'カテゴリ別支出',
  res_summary_title: '収入 vs 支出 vs 貯蓄',
  chart_income: '収入',
  chart_expenses: '支出',
  chart_savings: '貯蓄',
  res_cats_empty: '今月は支出がありません。',
  res_summary_empty: '今月はまだ活動がありません。',
  bud_intro: 'カテゴリごとに月の上限を設定し、いくら使ったか確認できます。',
  bud_spent_left: '{budget}中{spent}支出 · 残り{left}',
  bud_spent_over: '{budget}中{spent}支出 · {over}超過',
  bud_nolimit: '上限なし。今月の支出：{spent}',
  bud_placeholder: '月の上限 $',
  bud_aria: '{cat}の月間上限',
  bud_delete_cat: 'カテゴリを削除',
  bud_delete_cat_confirm: 'カテゴリ「{cat}」を削除しますか？それを使う支出は「{other}」に移ります。',
  bud_alert_amount: '上限の有効な金額を入力してください。',
  cat_form_title: 'カスタムカテゴリ',
  cat_name_label: 'カテゴリ名',
  cat_name_ph: '例：ペット',
  cat_save: 'カテゴリを追加',
  err_cat_name: 'カテゴリの名前を入力してください。',
  err_cat_exists: 'そのカテゴリは既に存在します。',
  fix_intro: '毎月繰り返される支払い：家賃、電話、サブスク…',
  fix_new: '新しい固定支払い',
  fix_edit: '固定支払いを編集',
  fix_name_ph: '例：家賃',
  fix_day_label: '月の何日',
  fix_save: '固定支払いを保存',
  fix_empty: 'まだ固定支払いがありません。',
  fix_sub: '毎月{day}日 · {month}',
  fix_mark: '支払い済みにする',
  fix_unmark: '取り消す',
  fix_delete_confirm: '固定支払い「{name}」を削除しますか？',
  err_day: '日は1から31の間でなければなりません。',
  err_limit_fixed: '固定支払いの上限に達しました。',
  acc_new: '新しい口座',
  acc_edit: '口座を編集',
  acc_balance_label: '残高（$）',
  acc_name_ph: '例：現金、銀行、貯蓄',
  acc_save: '口座を保存',
  acc_empty: 'まだ口座がありません。\n追加すると、概要で利用可能なお金が見られます。',
  acc_delete_confirm: '口座「{name}」を削除しますか？',
  err_balance: '有効な残高を入力してください。',
  err_limit_accounts: '口座の上限に達しました。',
  debt_new: '新しい借金',
  debt_edit: '借金を編集',
  debt_name_ph: '例：カード、ローン',
  debt_status_label: 'ステータス',
  debt_status_pending: '未払い',
  debt_status_paid: '支払い済み',
  debt_save: '借金を保存',
  debt_empty: '借金は記録されていません。🎉',
  debt_mark_paid: '支払い済みにする',
  debt_mark_pending: '未払いにする',
  debt_delete_confirm: '借金「{name}」を削除しますか？',
  err_limit_debts: '借金の上限に達しました。',
  name_label: '名前',
  san_intro: 'san（tanda）は貯蓄サークルです。毎週みんなが拠出し、順番に1人が総額を受け取ります。',
  san_form_title: 'sanを作成',
  san_name_label: 'sanの名前',
  san_name_ph: '例：家族のsan',
  san_aporte_label: '1回あたりの拠出金（$）',
  san_participants_label: '参加者（順番通り）',
  san_pname_ph: '参加者の名前',
  san_add_participant: '追加',
  san_create_btn: 'sanを作成',
  san_err_participants: '参加者を2人以上追加してください。',
  san_err_active_exists: 'すでに進行中の san（「{name}」）があります。新しく作るには、まず削除してください。',
  san_err_dup: 'その参加者は既にリストにいます。',
  san_err_pname: '参加者の名前を入力してください。',
  san_remove: '削除',
  san_draft_empty: 'まだ参加者が追加されていません。',
  san_week: '{n}週中{x}週目',
  san_finished: '🎉 sanが終了しました！',
  san_finished_note: 'すべての週が完了しました。このsanを削除して新しいものを作成できます。',
  san_total_line: '集まった合計：{amount}',
  san_week_collected: '今週集まった額：{target}中{amount}',
  san_receiver_line: '次は：{name}',
  san_aporte_line: '1回あたりの拠出金：{amount}',
  san_paid_title: '今週は誰が既に払いましたか？',
  san_paid: '支払い済み',
  san_advance: '週を完了にする',
  san_delete: 'sanを削除',
  san_delete_confirm: 'san「{name}」を削除しますか？週と支払いの記録が削除されます。',
  san_new_btn: '新しいsanを作成',
  san_new_confirm: '現在のsanは終了しました。削除して新しいものを作成しますか？',
  set_profile: 'あなたのプロフィール',
  set_name_label: 'あなたの名前',
  set_textsize_label: '文字サイズ',
  textsize_normal: '標準',
  textsize_large: '大',
  set_lang_label: '言語 / Language',
  set_reminders_title: 'リマインダー',
  set_payday_label: '給料日',
  set_reminders_label: 'ホームのリマインダー',
  wd_none: '給料日なし',
  wd_0: '日曜日',
  wd_1: '月曜日',
  wd_2: '火曜日',
  wd_3: '水曜日',
  wd_4: '木曜日',
  wd_5: '金曜日',
  wd_6: '土曜日',
  set_split_title: '提案される収入の配分（%）',
  set_split_help: '4つの数字の合計は100でなければなりません。これらのパーセンテージは収入の配分の提案にすぎません。貯蓄が自動で保存されることは決してありません。各収入から実際にいくら貯蓄したかを常に入力します。',
  split_ahorro: '貯蓄',
  split_negocio: '事業',
  split_gastos: '支出',
  split_familia: '家族',
  set_save: '設定を保存',
  set_err_sum: 'パーセンテージの合計は100でなければなりません。現在は{total}です。',
  set_saved: '設定が保存されました。✅',
  set_sections_title: '表示するセクション',
  set_sections_help: '使わないものはオフにして、短いリストにしましょう。',
  set_pin_title: 'セキュリティ（PIN）',
  pin_status_on: '有効なPINがあります。アプリは開くとロックされます。',
  pin_status_off: 'PINがありません。ここで作成してデータを守れます。',
  pin_current_label: '現在のPIN（あれば）',
  pin_new_label: '新しいPIN（空欄＝PINを削除）',
  pin_update: 'PINを更新',
  pin_err_current: '現在のPINが正しくありません。',
  pin_err_format: '新しいPINは4〜6桁の数字でなければなりません。',
  pin_off: 'PINが無効になりました。',
  pin_updated: 'PINが更新されました。✅',
  set_data_title: 'あなたのデータ',
  set_data_help: 'すべてこのスマートフォンだけに残ります。別の場所に保管したい場合はバックアップを書き出してください。',
  data_export: 'バックアップを書き出す（JSON）',
  data_import: 'バックアップを読み込む',
  data_reset: 'すべてのデータを削除',
  data_err_big: 'そのファイルは大きすぎます。',
  data_err_invalid: '読み込めません：そのファイルは有効なPETO Finanzasバックアップではありません。',
  import_confirm: '読み込むと現在のアプリデータがすべて置き換わります。よろしいですか？',
  import_done: 'バックアップを読み込みました。✅',
  reset_confirm1: 'このスマートフォン上のアプリデータがすべて削除されます。取り消せません。よろしいですか？',
  reset_confirm2: '最終確認：すべて削除して最初からやり直しますか？',
  lock_prompt: '続けるにはPINを入力してください。',
  lock_pin_label: 'PIN',
  lock_enter: 'ロック解除',
  lock_note: 'データはこのスマートフォンだけに残ります。',
  lock_err: 'PINが違います。もう一度お試しください。',
  ob_title: 'PETO Finanzasへようこそ！',
  ob_intro_1: '支出、収入、予算、口座、借金を、数分で整理できます。',
  ob_intro_2: 'アカウント不要、インターネット不要。',
  ob_intro_3: 'すべてこのスマートフォンだけに保存されます。',
  ob_name_label: 'お名前は何ですか？',
  ob_name_ph: 'あなたの名前',
  ob_pin_label: 'セキュリティPINを作成（任意）',
  ob_pin_ph: '4〜6桁の数字、または空欄のまま',
  ob_pin2_label: 'PINをもう一度',
  ob_pin2_ph: 'PINをもう一度',
  ob_start: '始める',
  ob_note: 'PINは設定でいつでも変更できます。',
  ob_tour1_title: '数秒で支出を記録',
  ob_tour1_text: '+ボタンをタップし、金額とカテゴリを入力します。それだけです。支出はすぐ保存されます。',
  ob_tour2_title: '今日はいくら使えますか？',
  ob_tour2_text: 'PETO Finanzasは予算を月の残りの日に割り振り、1つの数字だけを伝えます。予算を超えずに今日使える金額です。',
  ob_tour3_title: 'あなたのクラウドアカウント（任意）',
  ob_tour3_text: 'よければ、無料アカウントを作成して、Webでもデータを見られます。アカウントがなければ、すべてこのスマートフォンだけに残ります。',
  ob_tour_next: '次へ',
  ob_tour_skip: 'スキップ',
  ob_tour_go: 'さあ、始めましょう！',
  ob_err_name: '始めるには名前を入力してください。',
  ob_err_pin_format: 'PINは4〜6桁の数字でなければなりません。',
  ob_err_pin_mismatch: '2つのPINが一致しません。',
  set_theme_label: 'テーマ',
  theme_light: 'ライト',
  theme_dark: 'ダーク',
  theme_auto: '自動（システム）',
  set_accent_label: 'メインカラー',
  accent_verde: '緑',
  accent_azul: '青',
  accent_morado: '紫',
  accent_naranja: 'オレンジ',
  undo_done: '完了',
  undo_btn: '元に戻す',
  btn_repeat: '繰り返す',
  fab_aria: 'クイック追加',
  quick_title: '何を追加しますか？',
  quick_expense: '🧾 支出',
  quick_income: '💵 収入',
  quick_savings: '🐷 貯蓄',
  sec_buscar: '活動を検索',
  search_label: '検索',
  search_ph: 'メモ、カテゴリ、金額…',
  search_month_label: '月（空欄＝すべて）',
  search_type_label: '種類',
  type_all: 'すべて',
  type_gastos: '支出',
  type_ingresos: '収入',
  type_ahorros: '貯蓄',
  search_empty: '結果がありません。',
  search_type_income: '収入',
  search_type_saving: '貯蓄',
  chal_title: '🔥 毎週の貯蓄チャレンジ',
  chal_progress: '今週：{target}中{have}',
  chal_done: '🎉 今週のチャレンジが完了しました！',
  chal_streak_one: '連続：1週完了',
  chal_streak_many: '連続：{n}週完了',
  chal_streak_zero: '連続：0週。これが最初になれます！',
  streak_one: '🔥 1日連続で記録中',
  streak_many: '🔥 {n}日連続で記録中',
  chal_target_label: '週の貯蓄目標（$）',
  chal_save: '週の目標を保存',
  rep_title: '月次レポート',
  rep_download: '画像をダウンロード',
  rep_share_image: '画像を共有',
  trend_title: '支出の傾向',
  trend_weeks: '今月の週',
  trend_week: '第{n}週',
  trend_empty: '傾向を示す支出がまだありません。',
  rep_income: '収入',
  rep_expenses: '支出',
  rep_savings: '貯蓄',
  rep_top_cat: 'トップカテゴリ',
  rep_top3: 'トップ3カテゴリ',
  rep_goal: '貯蓄目標',
  rep_none: '活動なし',
  calc_title: '借金返済シミュレーター',
  calc_intro: '借金をなくす2つのプランを比べましょう。小さいものから払う（雪だるま法）か、金利の高いものから払う（雪崩法）か。毎月すべての最低額を払い、残りは対象の借金に回します。',
  calc_budget_label: '借金に毎月合計いくら払えますか？（$）',
  calc_run: '計算',
  calc_snowball: '雪だるま法（残高の小さい順）',
  calc_avalanche: '雪崩法（金利の高い順）',
  calc_result: '{months}か月で借金ゼロ · 金利は約{interest}',
  calc_months_one: '1か月で借金ゼロ · 金利は約{interest}',
  calc_order: '返済の順序：',
  calc_free: '未払いの借金はありません！🎉',
  calc_warn: 'その毎月の支払額では、ある借金は決して完済できません。支払いが金利すらカバーしていません。毎月の支払額を増やしてください。',
  calc_note_zero: '最低支払額や金利が記録されていない借金は、最低額0ドル、金利0%で計算されます。',
  calc_err_budget: '毎月いくら払えるか入力してください。',
  debt_interest_label: '年利%（任意）',
  debt_minpay_label: '月の最低支払額$（任意）',
  debt_terms: '年利{pct}% · 最低{min}/月',
  exp_photo_label: 'レシートの写真（任意）',
  exp_photo_remove: '写真を削除',
  photo_close: '閉じる',
  err_photo_quota: '写真を保存する容量がありませんでした。支出は写真なしで保存されました。',
  banner_backup: 'データのバックアップを保存してからしばらく経っています。設定でバックアップを書き出してください。',
  pro_title: 'PETO Pro',
  pro_card_text: 'データの無制限クラウド、高度なレポート、共有予算、san主催者モード。',
  pro_status_free: '現在は無料プランです。',
  pro_status_active: 'PETO Proが有効です。PETO Finanzasの応援ありがとうございます！⭐',
  pro_status_test: 'クローズドテスト中はPETO Proが開放されています。テストの間、フルアクセスがあります。',
  pro_status_waitlist: 'PETO Proの待機リストに登録されています。',
  pro_btn_see: 'PETO Proを見る',
  pro_wall_title: 'これはPETO Proの機能です ⭐',
  pro_price_line: '月額わずか1.99ドル',
  pro_benefit_cloud: '☁️ データの無制限クラウド',
  pro_benefit_report: '📊 高度なレポート：月を比較しCSVで書き出し',
  pro_benefit_shared: '🏠 世帯との共有予算',
  pro_benefit_org: '🤝 san主催者モード：グループ全体のtanda',
  pro_coming_text: 'アプリ内購入はGoogle Playでの公開とともに来ます。それまでは待機リストに参加できます。月額1.99ドルでProを有効化できるようになったらお知らせします。',
  pro_waitlist_btn: '待機リストに参加',
  pro_waitlist_done: 'リストに登録されました ✅ Proが利用可能になったらお知らせします。',
  pro_close: '後で',
  pro_tag: 'PRO',
  adv_title: '高度なレポート',
  adv_note: 'PETO Proの機能です。今月と先月の比較、すべてのカテゴリ、月のCSVエクスポート。',
  adv_open_btn: '高度なレポートを見る',
  adv_export_csv: '月をCSVで書き出す',
  adv_this_month: '今月',
  adv_prev_month: '先月',
  adv_change: '変化',
  adv_all_cats: 'すべてのカテゴリ',
  adv_empty: 'この2か月間は活動がありません。',
  org_title: 'san主催者モード',
  org_intro: 'グループ全体のtandaを運営します。日付付きのラウンド、各ラウンドで誰が払ったか記録し、状態をグループと共有します。',
  org_pro_note: '主催者モードはPETO Proの機能です。',
  org_form_title: 'グループのsanを作成',
  org_freq_label: 'ラウンドの頻度',
  org_freq_semanal: '毎週',
  org_freq_quincenal: '2週間ごと',
  org_freq_mensual: '毎月',
  org_start_label: '最初のラウンドの日付',
  org_create_btn: '組織化されたsanを作成',
  org_round: '{n}ラウンド中{x}ラウンド目',
  org_receiver_line: '受け取る人：{name}',
  org_pending_none: '全員払いました！🎉',
  org_pending_list: 'まだの人：{names}',
  org_pending_count_one: 'あと1人未払い',
  org_pending_count_many: 'あと{n}人未払い',
  org_totals_title: '参加者ごとの拠出金',
  org_paid_rounds: '{n}ラウンド中{paid}ラウンド支払い済み',
  org_delete: '組織化されたsanを削除',
  org_delete_confirm: '組織化されたsan「{name}」を削除しますか？グループの支払い記録が失われます。',
  org_share_title: 'sanの状態',
  shared_live_note: '予算を世帯と共有しましょう。世帯を作成するかコードで参加すると、同じメンバーが見られます。クラウドアカウント（上記、設定内）とPETO Proが必要です。',
  shared_leave_live: 'この世帯を退出しますか？その共有予算は見られなくなります。',
  shared_err_login: 'まずクラウドアカウントでログイン（上記、設定内）してから、もう一度お試しください。',
  shared_err_generic: '完了できませんでした。接続を確認してもう一度お試しください。',
  shared_err_code_live: 'そのコードは存在しません。確認してもう一度お試しください。',
  shared_err_member: 'あなたは既にこの世帯のメンバーです。',
  shared_err_owner_leave: 'あなたはこの世帯のオーナーです。削除せずに退出はできません。他のメンバーに新しい世帯を作成してもらってください。',
  shared_created_live: '世帯が作成されました ✅ コードを共有して世帯を招待しましょう。',
  shared_joined_live: '世帯に参加しました ✅',
  lang_auto: '自動（スマートフォンの言語）',
  org_comp_label: '主催者への報酬',
  org_comp_none: '報酬なし',
  org_comp_first: '主催者が最初に受け取る',
  org_comp_last: '主催者が最後に受け取る',
  org_comp_extra: 'ラウンドごとの追加料金',
  org_comp_amount_label: '1人あたりの追加料金 ($)',
  org_comp_line: '主催者への報酬：{mode}',
  org_sim_title: 'ポット試算',
  org_sim_pays: '各参加者がラウンドごとに拠出：{amount}',
  org_sim_pot: '各ラウンドのポット：{amount}',
  org_sim_total_in: '各人が san 全体で拠出する合計：{amount}',
  org_sim_extra_org: '主催者はラウンドごとに {amount} を追加で受け取る',
  org_sim_first: '主催者は最初のラウンドのポットを受け取る',
  org_sim_last: '主催者は最後のラウンドのポットを受け取る',
  org_shuffle_btn: '🎲 順番をシャッフル',
  org_shuffled: '🎲 順番をシャッフルしました！新しい順番です。',
  org_shuffle_need: '順番をシャッフルするには参加者を2人以上追加してください。',
  org_shuffle_blocked: 'シャッフルできません：sanは開始済みか、支払い記録があります。',
  org_start_btn: 'San を開始',
  org_started_line: 'San 進行中 · 順番はロックされています',
  org_order_title: 'ターンの順番',
  org_move_up: '上へ',
  org_move_down: '下へ',
  org_swap_blocked: 'そのターンにはすでに支払いがあり、変更できません。',
  org_history_title: '変更履歴',
  org_history_swap: '{a} と {b} がターンを交換しました',
  org_history_started: '主催者が san を開始しました',
  org_pay_pending: '保留中',
  org_pay_reported: '報告済み',
  org_pay_confirmed: '確認済み',
  org_status_btn: 'ステータス：{status}',
  org_receipt_add: '📎 レシート',
  org_receipt_view: 'レシートを見る',
  org_receipt_remove: '削除',
  org_zelle_label: '各参加者の Zelle（番号またはメール、任意）',
  org_zelle_ph: 'Zelle（任意）',
  org_zelle_line: 'Zelle：{zelle}',
  org_reminder_btn: '📲 WhatsApp リマインダー',
  org_reminder_head: '🤝 {san} · {n} ラウンド中 {x} ラウンド目 · {date}',
  org_reminder_receiver: '💰 今週は {name} が受け取ります',
  org_reminder_zelle: '{name} の Zelle：{zelle}',
  org_reminder_amount: 'ラウンドの拠出額：{amount}',
  org_antifraud: '🛡️ San が利息や拠出額を超えて支払うことはありません。',
  org_link_btn: '🔗 読み取り専用リンク',
  org_link_publish: 'リンクを作成',
  org_link_update: 'リンクを更新',
  org_link_copied: 'リンクをコピーしました！',
  org_link_need_cloud: 'リンクにはクラウドアカウントが必要です：設定でサインインして再試行してください。',
  org_link_ready: 'グループ san（読み取り専用）',
  org_public_title: 'リンクを共有する準備ができました。',
  org_public_updated: '{date} に更新',
  org_public_notfound: 'このリンクはもう利用できません。',
  org_pub_pay_btn: '支払いました',
  org_pub_confirm: 'このラウンドの負担分はもう支払いましたか？主催者が確認します。',
  org_pub_attach: '📎 領収書の写真を添付（任意）',
  org_pub_send: '報告を送信',
  org_pub_sent: '完了！支払いを報告しました。',
  org_pub_reported_note: '報告済み · 確認待ち',
  org_pub_err: '送信できませんでした。接続を確認してもう一度お試しください。',
  org_pub_err_confirmed: 'この支払いは主催者がすでに確認済みです。',
  org_pub_err_photo: '写真が大きすぎます。小さいものをお試しください。',
  org_penalty_label: '遅延ルール',
  org_penalty_none: '罰金なし',
  org_penalty_fixed: '固定罰金',
  org_penalty_percent: '拠出額の割合',
  org_penalty_amount_label: '罰金額 ($)',
  org_penalty_percent_label: '罰金の割合 (%)',
  org_penalty_line_fixed: '遅れた場合：{amount} の罰金',
  org_penalty_line_percent: '遅れた場合：拠出額の {percent}% の罰金',
  set_news_title: '新着情報',
  news_c24: 'Compilación 24：ウェルカムツアー、記録の連続日数、進捗バー付きの貯蓄目標と傾向グラフ。',
  news_c25: 'Compilación 25：ホーム画面ウィジェットと、はるかに軽くなったアプリ（52 MBから7 MBへ）。',
  news_c26: 'Compilación 26：3サイズのウィジェット、ウィジェットごとの設定、アプリを開かずに支出を記録できるボタン。',
  news_c27: 'Compilación 27：アプリが12言語に対応し、スマートフォンの言語に自動で合わせます。',
  news_c28: 'Compilación 28：起動時から適用される大きな文字、この新着情報セクション、イタリア語の見直しと高速な起動。',
  news_c31: 'Compilación 31：戻るボタンやジェスチャーがアプリ内で動くようになりました：開いているものを閉じ、メイン画面に戻ってから終了します。',
  news_c32: 'バージョン32：ブランド名がアプリ全体（メニュー、ロック画面、ウィジェット）で「PETO Finanzas」に統一され、sanがホームのリストの一番上に移動し、sanの公開リンクはグループの状態を直接開き、主催者ボタンは常に明確なメッセージで応答します。',
  news_c33: 'バージョン33：sanを新規作成しても、進行中のsanが消えることはなくなりました。すでにアクティブなsanがある場合、アプリが知らせて保護します（支払い、領収書、履歴、公開リンク）。ウェブ版もスマートフォンと同期されました。',
  news_c34: 'バージョン34：PETO Finanzasの新しいロゴ——エメラルドの背景に白い「P」と淡い緑のバーと矢印が、アイコン、ロック画面、アプリ全体に登場しました。',
  news_c35: 'バージョン35：sanの公開リンクから「支払いました」で支払いを報告し、領収書を添付できるようになりました（確認は主催者）。公開ビューアはダークテーマになり、下に引っ張るとアプリが更新され、PDFリーダーが送信したZelle支払いを収入と間違えなくなりました。',
  sec_podcast: 'ポッドキャスト',
  key_podcast: 'Finanzas Personales ポッドキャスト',
  pod_hosts: '出演：Lucía と Marco',
  pod_desc: 'お金の話をシンプルに：短いエピソードで、貯金、借金返済、家計管理のコツをお届けします。',
  pod_spotify_btn: 'Spotifyで聴く',
  pod_loading: 'エピソードを読み込み中…',
  pod_offline: '接続なし：前回ダウンロードしたリストを表示しています',
  pod_error: 'エピソードを読み込めませんでした。接続を確認して、もう一度お試しください。',
  pod_empty: 'まだエピソードが公開されていません。',
  pod_play_aria: '再生',
  pod_pause_aria: '一時停止',
  pod_audio_error: 'このエピソードを再生できませんでした。',
  pub_tagline: 'あなたの san、整理されて透明',
  pub_progress: '{n}件中{x}件の支払いが確認済み',
  pub_progress_start: '始まったばかり：確認済みの支払いはまだありません',
  pub_cta_title: '自分の san を組織したいですか？',
  pub_cta_text: 'PETO Finanzas なら、順番、ラウンド、領収書を一か所で管理。ノートも混乱も不要です。',
  pub_cta_try: 'PETO Finanzas を試す',
  pub_cta_more: '詳しく見る',
  pub_bar_try: 'アプリを試す',
  pub_footer: 'PETO Finanzas で作成 · petofinanzas.com',
  news_c36: 'バージョン36：新しいポッドキャストセクション——アプリを離れずに「Finanzas Personales」を聴けます。プレーヤー内蔵、リストはオフライン用に保存。ようこそ画面は自動で切り替わるようになりました。リンク表示も一新：sanの進み具合と、アプリを試す直接アクセス付き。',
  news_c37: 'バージョン37：ウィジェットを一新——ブランドのグラデーション、予算に合わせて色が変わる進捗バー、sanの次のターンの行——そして、今日使える金額を表示するアイコンサイズの新しいウィジェット。公開リンクをスクロールしてもブランドが常に表示されます。主催者のラウンドはアコーディオン式になり、今週分だけが開きます。',
  widget_today: '今日',
  widget_san_next: '次のターン：{name} · {date}',
  widget_san_next_nodate: '次のターン：{name}',
  back_exit_hint: 'もう一度戻るを押すと終了します。'
},
ko: {
  org_err_san_name: 'san 이름을 입력하세요.', rep_promo_footer: 'PETO Finanzas로 지출을 관리하세요 · petofinanzas.com', rep_saved: '이미지가 저장되었습니다.', set_sections_summary: '{total}개 중 {visible}개 표시',
  org_err_active_exists: '이미 활성 san("{name}")이 있습니다. 새로 만들려면 먼저 해당 카드에서 삭제하세요.',
  app_title: 'PETO Finanzas',
  back: '← 모든 옵션',
  greeting: '안녕하세요',
  lock_btn: '잠그기',
  home_menu_heading: '무엇을 보시겠어요?',
  group_daily: '일상',
  group_plan: '계획',
  group_accounts: '계좌와 약정',
  group_yourapp: '내 앱',
  sec_gastos: '이번 달 지출',
  sec_ingresos: '주간 수입',
  sec_ahorros: '저축',
  sec_resumen: '요약',
  sec_presupuesto: '카테고리별 예산',
  sec_pagos: '고정 지출',
  sec_cuentas: '내 계좌',
  sec_deudas: '내 빚',
  sec_san: '내 san(tanda)',
  sec_ajustes: '설정 및 개인 맞춤',
  menu_open_aria: '메뉴 열기',
  menu_close_aria: '메뉴 닫기',
  sec_home: '홈',
  key_home: '메인 화면',
  set_notif_label: '앱이 닫혀 있을 때 알림',
  set_notif_help: 'PETO Finanzas가 닫혀 있어도 고정 지출 전날과 당일에 알려줍니다.',
  set_autofixed_label: '고정 지출 자동 기록',
  set_autofixed_help: '고정 지출 기한이 되면 지출이 자동으로 기록됩니다. 바로 되돌릴 수도 있습니다.',
  set_bio_label: '지문 잠금 해제',
  set_bio_help: 'PIN과 함께 지문으로도 들어갑니다(활성화된 PIN 필요).',
  bio_btn: '👆 지문으로 들어가기',
  bio_reason: 'PETO Finanzas를 열기 위해 본인임을 확인하세요',
  bio_need_pin: '지문 잠금 해제에는 활성화된 PIN이 필요합니다. 설정 → 보안에서 PIN을 만들면 앱을 열 때 지문이 작동합니다.',
  bio_failed: '지문을 확인할 수 없습니다. PIN을 입력하세요.',
  bio_unavailable: '이 휴대전화에서는 지문을 사용할 수 없습니다. PIN을 입력하세요.',
  bio_not_enrolled: '이 휴대전화에는 등록된 지문이 없습니다. 휴대전화 설정에서 등록하거나 PIN을 입력하세요.',
  bio_offer_title: '지문으로 잠금을 풀까요?',
  bio_offer_text: '방금 PIN을 만들었습니다. 원하면 매번 PIN을 입력하는 대신 지문으로 PETO Finanzas를 열 수 있습니다. 지금 켤까요?',
  bio_offer_yes: '네, 지문 켜기',
  bio_offer_no: '나중에',
  bio_activated: '완료: 지문 잠금 해제가 켜졌습니다.',
  fix_auto_suffix: '(자동 고정 지출)',
  backup_pass_label: '암호화 백업 비밀번호',
  backup_pass_ph: '최소 4자',
  data_export_enc: '암호화 백업 내보내기',
  backup_help: '암호화 백업은 비밀번호로만 열 수 있습니다. 비밀번호가 없으면 복구할 수 없으니 잘 보관하세요. 암호화 백업을 가져오려면 파일을 선택하기 전에 여기에 비밀번호를 입력하세요.',
  backup_err_short: '비밀번호는 최소 4자 이상이어야 합니다.',
  backup_need_pass: '암호화 백업을 가져오기 전에 비밀번호를 입력하세요.',
  backup_err_pass: '백업을 열 수 없습니다: 비밀번호가 틀렸거나 파일이 손상되었습니다.',
  share_btn: '요약 공유',
  share_copied: '요약이 복사되었습니다. 원하는 곳에 붙여넣으세요.',
  review_title: 'PETO Finanzas가 마음에 드세요?',
  review_text: 'PETO Finanzas가 돈 관리에 도움이 된다면 Google Play 리뷰가 더 많은 사람에게 닿는 큰 힘이 됩니다. 감사합니다!',
  review_yes: '⭐ Google Play에서 평가하기',
  review_no: '나중에',
  share_report_title: '내 PETO Finanzas 요약',
  notif_fixed_title: '내일 고정 지출',
  notif_fixed_today: '오늘 고정 지출',
  notif_fixed_body: '{name} · {amount}',
  notif_weekly_title: 'PETO Finanzas에서의 한 주',
  notif_weekly_body: '이번 주 지출과 수입을 기록해 흐름을 유지하세요.',
  summary_title: '일일 요약',
  summary_help: '선택한 시간에 어제 쓴 금액과 오늘 쓸 수 있는 금액을 알려줍니다.',
  summary_notif_label: '알림으로 요약 받기',
  summary_time_label: '요약 시간',
  summary_email_label: '이메일로도 받기',
  summary_email_help: '클라우드 계정이 활성화된 경우에만: 같은 요약이 이메일로도 도착합니다.',
  notif_summary_title: '🌅 당신의 PETO Finanzas 요약',
  notif_summary_body: '어제 {spent}를 썼습니다 · 오늘은 {daily}까지 쓸 수 있습니다',
  notif_summary_body_nodaily: '어제 {spent}를 썼습니다',
  sec_remesas: '송금',
  key_remesas: '이번 달 보낸 금액: {amount}',
  rem_intro: '소중한 사람들에게 보내는 돈: 달러로 얼마가 나갔고 그들의 통화로 얼마가 도착했는지.',
  rem_usd_label: '보낸 금액($ USD)',
  rem_rate_label: '환율($1당 {cur})',
  rem_recipient_label: '누구에게?',
  rem_currency_label: '받는 통화',
  rem_arrives_label: '도착 금액',
  rem_rate_suggested: '{cur}에 마지막으로 사용한 환율: {rate}. 이미 채워져 있으니 오늘 환율이 다르면 바꾸세요.',
  rem_month_sent: '이번 달에 {usd}를 보냈습니다',
  rem_totals_title: '통화별 합계(전체 기록)',
  rem_total_row: '{usd} 보냄 → {amount} 받음 · {n}회',
  rem_save: '송금 저장',
  rem_empty: '아직 송금 기록이 없습니다.',
  rem_delete_confirm: '{name}님에게 보낸 송금을 삭제할까요?',
  csv_title: '은행 명세서 가져오기(CSV)',
  csv_help: '은행의 CSV 파일을 올리고 가져오기 전에 미리보기로 모두 검토하세요. 확인하기 전까지는 아무것도 저장되지 않습니다.',
  csv_file_label: '은행 CSV 파일',
  csv_preview_title: '가져오기 미리보기',
  csv_summary: '총 {total}건 · 중복 {dups}건(제외) · 가져올 {sel}건',
  csv_dup_badge: '중복',
  csv_income_badge: '수입',
  csv_expense_badge: '지출',
  csv_all: '모두 선택',
  csv_none: '모두 선택 해제',
  csv_apply: '선택 항목 가져오기',
  csv_cancel: '가져오기 취소',
  csv_done: '{n}건의 거래를 가져왔습니다. ✅',
  csv_none_selected: '가져올 거래를 선택하지 않았습니다.',
  csv_err_parse: '그 파일을 CSV로 읽을 수 없습니다. 은행 명세서의 CSV 형식인지 확인하세요.',
  csv_err_headers: '그 파일에서 날짜와 금액 열을 찾지 못했습니다.',
  csv_err_big: '그 파일은 너무 커서 가져올 수 없습니다.',
  csv_err_empty: '그 파일에는 가져올 수 있는 거래가 없습니다.',
  pdf_err_big: '그 PDF는 너무 큽니다(최대 8MB).',
  pdf_err_notext: '그 PDF에는 읽을 수 있는 텍스트가 없습니다(사진이나 스캔으로 보입니다). 은행 CSV를 시도하거나 영수증 사진으로 지출을 기록하세요.',
  pdf_err_empty: '그 PDF에서 날짜와 금액이 있는 거래를 찾지 못했습니다. 은행 CSV를 시도하세요.',
  shared_title: '공유 예산',
  shared_preview_note: '🔧 디자인 미리보기: 아직 다른 계정과 연결되지 않습니다. 가구를 만들고, 코드로 참여하고, 구성원을 보는 모습이 어떨지 체험해 보세요.',
  shared_create_label: '가구 이름',
  shared_create_btn: '가구 만들기',
  shared_join_label: '초대 코드',
  shared_join_btn: '코드로 참여',
  shared_members_title: '구성원',
  shared_code_label: '초대 코드: {code}',
  shared_role_dueno: '소유자',
  shared_role_admin: '관리자',
  shared_role_miembro: '구성원',
  shared_role_lector: '읽기 전용',
  shared_you: '나',
  shared_host: '호스트',
  shared_leave_btn: '가구 나가기',
  shared_leave_confirm: '이 가구에서 나갈까요?(미리보기)',
  shared_err_name: '가구 이름을 입력하세요.',
  shared_err_code: '코드는 6자의 문자 또는 숫자입니다.',
  shared_created: '가구가 만들어졌습니다(미리보기). ✅',
  shared_joined: '가구에 참여했습니다(미리보기). ✅',
  shared_household_fallback: '공유 가구',
  privacy_hide: '금액 숨기기',
  privacy_show: '금액 보이기',
  ins_title: '💡 돈에 대한 아이디어',
  ins_cat_up: '{cat}이(가) 지난달보다 {pct}% 올랐습니다({from} → {to}).',
  ins_pace_down: '흐름이 좋아지고 있습니다. 지출이 지난달보다 {pct}% 줄었습니다.',
  ins_pace_up: '주의: 지출 흐름이 지난달보다 {pct}% 올랐습니다.',
  ins_biggest: '이번 달 가장 큰 지출: {note} · {amount}.',
  ins_saved: '이번 달에 {amount}를 저축했습니다. 계속 가세요!',
  bud_alert_title: '예산 위험',
  bud_alert_warn: '{cat}: 예산의 {pct}%에 도달했습니다.',
  bud_alert_over: '{cat}: 예산을 초과했습니다({pct}%).',
  voice_btn: '🎤 말하기',
  voice_listening: '듣고 있습니다… 금액과 용도를 말하세요.',
  voice_unavailable: '이 기기에서는 음성을 사용할 수 없습니다.',
  voice_heard: '들었습니다: \'{text}\'. 확인하고 저장하세요.',
  voice_no_amount: '들었습니다: \'{text}\'. 하지만 금액을 찾지 못했습니다.',
  ocr_found: '영수증에서 {amount}를 찾았습니다. 저장하기 전에 확인하세요.',
  goals_title: '다른 목표',
  goal2_create: '목표 만들기',
  goal_add: '+ 추가',
  goal_take: '− 빼기',
  goal_done: '🎉 목표 달성!',
  goal_move_label: '금액',
  goal_delete_confirm: '목표 \'{name}\'을(를) 삭제할까요? 저축은 건드리지 않습니다. 목표만 삭제됩니다.',
  err_limit_goals: '이미 목표 최대 개수에 도달했습니다.',
  biz_label: '이것은 내 사업용입니다',
  biz_title: '이번 달 내 사업',
  biz_income: '사업 수입',
  biz_expenses: '사업 지출',
  biz_profit: '이익',
  chal_share: '내 챌린지 공유',
  cloud_title: '클라우드 계정',
  cloud_help: '계정이 있으면 데이터가 클라우드에도 저장되고 동기화됩니다. 휴대전화를 바꿔도 이메일로 로그인하면 모든 것이 그대로 있습니다. 계정이 없으면 앱은 이 휴대전화에서만 작동합니다. 평소처럼요.',
  cloud_email: '이메일',
  cloud_pass: '비밀번호',
  cloud_signin: '로그인',
  cloud_signup: '계정 만들기',
  cloud_signout: '로그아웃',
  cloud_sync_now: '지금 동기화',
  cloud_wipe: '내 클라우드 데이터 삭제',
  cloud_who: '{email}(으)로 로그인됨',
  cloud_synced: '동기화됨 ✓ · {time}',
  cloud_never: '아직 동기화되지 않았습니다.',
  cloud_working: '작업 중…',
  cloud_ok_in: '다시 오신 것을 환영합니다!',
  cloud_ok_up: '계정이 만들어졌습니다! 데이터가 이제 클라우드에 있습니다.',
  cloud_err_fields: '이메일과 최소 6자 이상의 비밀번호를 입력하세요.',
  cloud_err_login: '로그인할 수 없습니다. 이메일과 비밀번호를 확인하세요.',
  cloud_err_exists: '그 이메일에는 이미 계정이 있습니다. \'로그인\'을 사용하세요.',
  cloud_err_confirm: '계정이 만들어졌습니다. 이메일에서 계정을 확인한 뒤 로그인하세요.',
  cloud_err_generic: '클라우드에 문제가 생겼습니다. 인터넷을 확인하고 다시 시도하세요.',
  cloud_conflict: '클라우드와 이 휴대전화의 데이터가 다릅니다. 클라우드 데이터를 내려받아 이 휴대전화의 데이터를 바꿀까요?(취소 = 이 휴대전화의 데이터 올리기)',
  cloud_wipe_confirm: '클라우드에 있는 모든 데이터를 삭제할까요? 이 휴대전화에 있는 것은 그대로 둡니다.',
  cloud_delete: '내 계정 삭제',
  cloud_delete_confirm1: 'PETO Finanzas 계정을 삭제할까요? 계정, 클라우드에 있는 데이터 사본, 소유한 공유 가구가 삭제됩니다. 이 휴대전화에 있는 데이터는 그대로 남습니다(설정에서 지울 수 있습니다). 되돌릴 수 없습니다.',
  cloud_delete_confirm2: '최종 확인: 계정을 완전히 삭제할까요?',
  cloud_deleted: '계정이 삭제되었습니다.',
  cloud_delete_err_auth: '세션이 더 이상 유효하지 않습니다. 다시 로그인하고 시도하세요.',
  cloud_unavailable: '이 버전에서는 클라우드를 사용할 수 없습니다.',
  key_settings: '이름, 분배, 글자, 섹션, PIN',
  footer: 'PETO Finanzas · 오프라인으로 작동 · 클라우드는 선택 사항: 내 데이터, 내 결정',
  tile_available: '사용 가능한 돈',
  tile_available_aria: '사용 가능한 돈: 내 계좌로 이동',
  tile_savings: '이번 달 저축',
  tile_savings_aria: '이번 달 저축: 저축으로 이동',
  tile_debts: '남은 빚',
  tile_debts_aria: '남은 빚: 내 빚으로 이동',
  tile_incomes: '💵 수입',
  tile_incomes_aria: '수입: 주간 수입으로 이동',
  tile_expenses: '🧾 지출',
  tile_expenses_aria: '지출: 이번 달 지출로 이동',
  tile_goal: '목표 \'{name}\': {pct}%',
  key_spent_month: '이번 달 {amount} 지출',
  key_income_month: '이번 달 {amount} 받음',
  key_saved_total: '총 {amount} 저축됨',
  key_goal_suffix: ' · 목표 \'{name}\': {pct}%',
  key_budget_one: '한도가 있는 카테고리 {n}개',
  key_budget_many: '한도가 있는 카테고리 {n}개',
  key_fixed: '매월 {amount} · 낼 것 {n}개',
  key_available: '사용 가능: {amount}',
  key_debts: '미납 {amount}',
  key_san: '{n}주 중 {x}주차 · 다음 차례: {name}',
  key_san_done: 'san 종료 🎉',
  key_san_none: '진행 중인 san 없음',
  banner_payday: '오늘은 월급날입니다. 수입과 저축을 기록하세요.',
  banner_dues_title: '곧 다가오는 지출:',
  banner_due_item: '{name}({day}일)',
  banner_close: '닫기',
  spend_title: '오늘 얼마를 쓸 수 있나요?',
  spend_note: '오늘 예산을 넘지 않고 쓸 수 있는 금액입니다.',
  spend_guide: '첫 카테고리 예산을 만들면 여기서 매일 얼마를 쓸 수 있는지 보입니다.',
  spend_left: '이번 달 남은 {days}일 동안 {amount}가 남았습니다.',
  spend_left_one: '이번 달 마지막 날인 오늘, {amount}가 남았습니다.',
  spend_over: '이번 달 예산에 도달했습니다.',
  spend_over_by: '{amount} 초과했습니다.',
  cat_Renta: '월세',
  cat_Comida: '식비',
  "cat_Comida fuera": '외식',
  cat_Gasolina: '주유',
  cat_Transporte: '교통',
  cat_Salud: '건강',
  cat_Ropa: '의류',
  cat_Otros: '기타',
  btn_cancel: '취소',
  btn_save: '저장',
  btn_edit: '편집',
  btn_delete: '삭제',
  err_amount: '$0보다 큰 유효한 금액을 입력하세요.',
  err_amount_generic: '유효한 금액을 입력하세요.',
  err_name: '이름을 입력하세요.',
  chip_paid: '납부됨',
  chip_pending: '미납',
  month_prev_aria: '이전 달',
  month_next_aria: '다음 달',
  exp_new: '새 지출',
  exp_edit: '지출 편집',
  exp_total_label: '이번 달 합계:',
  amount_label: '금액($)',
  category_label: '카테고리',
  date_label: '날짜',
  note_label: '메모(선택)',
  exp_note_ph: '무엇에 썼나요?',
  exp_save: '지출 저장',
  exp_empty: '이번 달에는 아직 지출이 없습니다.\n위의 양식으로 첫 번째를 추가하세요. 👍',
  exp_delete_confirm: '{amount}의 이 지출을 삭제할까요? 카테고리 {cat}, 날짜 {date}. 이 지출만 삭제됩니다.',
  err_category: '유효한 카테고리를 선택하세요.',
  err_limit_expenses: '저장된 지출 한도에 도달했습니다.',
  inc_intro: '저축은 절대 자동이 아닙니다. 각 수입에서 실제로 얼마를 저축했는지 직접 입력합니다. 앱은 설정의 비율에 따라 금액을 제안할 뿐입니다.',
  inc_new: '새 수입',
  inc_edit: '수입 편집',
  inc_note_ph: '어디에서 왔나요?',
  inc_savings_label: '저축($)',
  inc_savings_label_sug: '저축(제안: {amount})',
  inc_savings_help: '저축 비율에 따른 제안입니다. 실제로 저축한 금액으로 바꾸세요. $0을 입력해도 됩니다.',
  inc_split_line: '저축됨: {sav} · 제안: 사업 {biz} · 지출 {exp} · 가족 {fam}',
  inc_split_preview: '제안된 분배: 저축 {sav} · 사업 {biz} · 지출 {exp} · 가족 {fam}. 실제로 세는 저축은 아래에 입력한 것입니다.',
  inc_save: '수입 저장',
  inc_empty: '아직 기록된 수입이 없습니다.\n첫 수입을 추가하고 그중 얼마를 저축했는지 입력하세요. 💪',
  inc_delete_confirm: '{date}의 이 {amount} 수입을 삭제할까요? 기록된 저축 {savings}도 함께 삭제됩니다.',
  err_inc_savings: '이 수입에서 얼마를 저축했는지 입력하세요($0도 됩니다).',
  err_limit_incomes: '저장된 수입 한도에 도달했습니다.',
  sav_intro_1: '여기에서 저축한 모든 금액을 하나씩 볼 수 있습니다. 독립적인 저축을 추가할 수도 있습니다.',
  sav_intro_2: '어떤 수입과도 연결되지 않은',
  sav_intro_3: ', 아래 양식으로요. 저축을 삭제해도 그 금액만 삭제됩니다:',
  sav_intro_4: '수입은 그대로입니다',
  sav_intro_5: '.',
  sav_total_label: '총 저축:',
  sav_month_label: '이번 달 저축:',
  sav_form_title: '저축 추가',
  sav_note_ph: '이 저축은 무엇을 위한 것인가요?',
  sav_save: '저축 저장',
  sav_goal_label: '목표에 배정(선택)',
  sav_goal_none: '목표 없음 · 일반 저축',
  sav_empty: '아직 기록된 저축이 없습니다.\n위의 양식으로 하나 추가하거나, 수입을 기록할 때 그 저축을 기록하면 여기에 나타납니다. 🌱',
  sav_from_title: '{date}의 저축',
  sav_from_sub: '{amount} 수입에서',
  sav_manual_title: '추가된 저축',
  sav_manual_sub: '수동 · {date}에 추가됨',
  sav_delete_income_confirm: '{date}의 이 {amount} 저축을 삭제할까요? 이 저축 금액만 삭제됩니다. {income}의 수입은 그대로입니다.',
  sav_delete_manual_confirm: '{date}의 이 {amount} 저축을 삭제할까요? 저축에서 직접 추가한 것입니다. 이 항목만 삭제됩니다.',
  err_limit_savings: '저장된 저축 한도에 도달했습니다.',
  goal_prompt: '무엇을 위해 저축하나요?',
  goal_prompt_sub: '목표를 만들면 저축이 목표에 가까워지는 것을 볼 수 있습니다.',
  goal_form_create: '목표 만들기',
  goal_form_edit: '목표 편집',
  goal_name_label: '목표 이름',
  goal_name_ph: '예: 비상금',
  goal_target_label: '목표 금액($)',
  goal_create_btn: '목표 만들기',
  goal_save_btn: '목표 저장',
  goal_progress: '{target} 중 {have}를 저축했습니다',
  goal_remaining: '{amount} 남음',
  goal_edit: '목표 편집',
  goal_delete: '목표 삭제',
  err_goal_name: '목표의 이름을 입력하세요.',
  res_cats_title: '카테고리별 지출',
  res_summary_title: '수입 vs 지출 vs 저축',
  chart_income: '수입',
  chart_expenses: '지출',
  chart_savings: '저축',
  res_cats_empty: '이번 달 지출이 없습니다.',
  res_summary_empty: '이번 달에는 아직 활동이 없습니다.',
  bud_intro: '카테고리마다 월 한도를 정하고 얼마를 썼는지 확인하세요.',
  bud_spent_left: '{budget} 중 {spent} 지출 · {left} 남음',
  bud_spent_over: '{budget} 중 {spent} 지출 · {over} 초과',
  bud_nolimit: '한도 없음. 이번 달 지출: {spent}',
  bud_placeholder: '월 한도 $',
  bud_aria: '{cat}의 월 한도',
  bud_delete_cat: '카테고리 삭제',
  bud_delete_cat_confirm: '카테고리 \'{cat}\'을(를) 삭제할까요? 이를 사용하는 지출은 \'{other}\'(으)로 이동합니다.',
  bud_alert_amount: '한도에 유효한 금액을 입력하세요.',
  cat_form_title: '사용자 지정 카테고리',
  cat_name_label: '카테고리 이름',
  cat_name_ph: '예: 반려동물',
  cat_save: '카테고리 추가',
  err_cat_name: '카테고리 이름을 입력하세요.',
  err_cat_exists: '그 카테고리는 이미 있습니다.',
  fix_intro: '매월 반복되는 지출: 월세, 전화, 구독…',
  fix_new: '새 고정 지출',
  fix_edit: '고정 지출 편집',
  fix_name_ph: '예: 월세',
  fix_day_label: '매월 며칠',
  fix_save: '고정 지출 저장',
  fix_empty: '아직 고정 지출이 없습니다.',
  fix_sub: '매월 {day}일 · {month}',
  fix_mark: '납부로 표시',
  fix_unmark: '표시 취소',
  fix_delete_confirm: '고정 지출 \'{name}\'을(를) 삭제할까요?',
  err_day: '날짜는 1에서 31 사이여야 합니다.',
  err_limit_fixed: '고정 지출 한도에 도달했습니다.',
  acc_new: '새 계좌',
  acc_edit: '계좌 편집',
  acc_balance_label: '잔액($)',
  acc_name_ph: '예: 현금, 은행, 저축',
  acc_save: '계좌 저장',
  acc_empty: '아직 계좌가 없습니다.\n하나를 추가하면 요약에서 사용 가능한 돈을 볼 수 있습니다.',
  acc_delete_confirm: '계좌 \'{name}\'을(를) 삭제할까요?',
  err_balance: '유효한 잔액을 입력하세요.',
  err_limit_accounts: '계좌 한도에 도달했습니다.',
  debt_new: '새 빚',
  debt_edit: '빚 편집',
  debt_name_ph: '예: 카드, 대출',
  debt_status_label: '상태',
  debt_status_pending: '미납',
  debt_status_paid: '갚음',
  debt_save: '빚 저장',
  debt_empty: '기록된 빚이 없습니다. 🎉',
  debt_mark_paid: '갚음으로 표시',
  debt_mark_pending: '미납으로 표시',
  debt_delete_confirm: '빚 \'{name}\'을(를) 삭제할까요?',
  err_limit_debts: '빚 한도에 도달했습니다.',
  name_label: '이름',
  san_intro: 'san(tanda)은 저축 모임입니다. 매주 모두가 기여하고 한 사람이 차례대로 총액을 받습니다.',
  san_form_title: 'san 만들기',
  san_name_label: 'san 이름',
  san_name_ph: '예: 가족 san',
  san_aporte_label: '차례당 기여금($)',
  san_participants_label: '참가자(차례 순서대로)',
  san_pname_ph: '참가자 이름',
  san_add_participant: '추가',
  san_create_btn: 'san 만들기',
  san_err_participants: '참가자를 최소 2명 추가하세요.',
  san_err_active_exists: '이미 진행 중인 san("{name}")이 있습니다. 새로 만들려면 먼저 삭제하세요.',
  san_err_dup: '그 참가자는 이미 목록에 있습니다.',
  san_err_pname: '참가자의 이름을 입력하세요.',
  san_remove: '제거',
  san_draft_empty: '아직 추가된 참가자가 없습니다.',
  san_week: '{n}주 중 {x}주차',
  san_finished: '🎉 san이 종료되었습니다!',
  san_finished_note: '모든 주가 완료되었습니다. 이 san을 삭제하고 새것을 만들 수 있습니다.',
  san_total_line: '모인 총액: {amount}',
  san_week_collected: '이번 주 모인 금액: {target} 중 {amount}',
  san_receiver_line: '다음 차례: {name}',
  san_aporte_line: '차례당 기여금: {amount}',
  san_paid_title: '이번 주에 누가 이미 냈나요?',
  san_paid: '냄',
  san_advance: '주 완료로 표시',
  san_delete: 'san 삭제',
  san_delete_confirm: 'san \'{name}\'을(를) 삭제할까요? 주와 납부 기록이 삭제됩니다.',
  san_new_btn: '새 san 만들기',
  san_new_confirm: '현재 san이 종료되었습니다. 삭제하고 새것을 만들까요?',
  set_profile: '내 프로필',
  set_name_label: '당신의 이름',
  set_textsize_label: '글자 크기',
  textsize_normal: '보통',
  textsize_large: '크게',
  set_lang_label: '언어 / Language',
  set_reminders_title: '알림',
  set_payday_label: '월급날',
  set_reminders_label: '홈의 알림',
  wd_none: '월급날 없음',
  wd_0: '일요일',
  wd_1: '월요일',
  wd_2: '화요일',
  wd_3: '수요일',
  wd_4: '목요일',
  wd_5: '금요일',
  wd_6: '토요일',
  set_split_title: '제안된 수입 분배(%)',
  set_split_help: '네 숫자의 합은 100이어야 합니다. 이 백분율은 수입을 나누는 제안일 뿐입니다. 저축은 절대 자동으로 저장되지 않습니다. 각 수입에서 실제로 얼마를 저축했는지 항상 직접 입력합니다.',
  split_ahorro: '저축',
  split_negocio: '사업',
  split_gastos: '지출',
  split_familia: '가족',
  set_save: '설정 저장',
  set_err_sum: '백분율의 합은 100이어야 합니다. 지금은 {total}입니다.',
  set_saved: '설정이 저장되었습니다. ✅',
  set_sections_title: '보이는 섹션',
  set_sections_help: '사용하지 않는 것은 꺼서 목록을 짧게 유지하세요.',
  set_pin_title: '보안(PIN)',
  pin_status_on: '활성화된 PIN이 있습니다. 앱을 열면 잠깁니다.',
  pin_status_off: 'PIN이 없습니다. 여기서 만들어 데이터를 보호할 수 있습니다.',
  pin_current_label: '현재 PIN(있는 경우)',
  pin_new_label: '새 PIN(비우면 PIN 제거)',
  pin_update: 'PIN 업데이트',
  pin_err_current: '현재 PIN이 맞지 않습니다.',
  pin_err_format: '새 PIN은 4~6자리 숫자여야 합니다.',
  pin_off: 'PIN이 비활성화되었습니다.',
  pin_updated: 'PIN이 업데이트되었습니다. ✅',
  set_data_title: '내 데이터',
  set_data_help: '모든 것은 이 휴대전화에만 남습니다. 다른 곳에 보관하고 싶으면 백업을 내보내세요.',
  data_export: '백업 내보내기(JSON)',
  data_import: '백업 가져오기',
  data_reset: '모든 데이터 삭제',
  data_err_big: '그 파일은 너무 큽니다.',
  data_err_invalid: '가져올 수 없습니다. 그 파일은 유효한 PETO Finanzas 백업이 아닙니다.',
  import_confirm: '가져오면 현재 앱 데이터가 모두 바뀝니다. 확실한가요?',
  import_done: '백업을 가져왔습니다. ✅',
  reset_confirm1: '이 휴대전화의 앱 데이터가 모두 삭제됩니다. 되돌릴 수 없습니다. 확실한가요?',
  reset_confirm2: '최종 확인: 모두 삭제하고 처음부터 시작할까요?',
  lock_prompt: '계속하려면 PIN을 입력하세요.',
  lock_pin_label: 'PIN',
  lock_enter: '잠금 해제',
  lock_note: '데이터는 이 휴대전화에만 남습니다.',
  lock_err: 'PIN이 틀립니다. 다시 시도하세요.',
  ob_title: 'PETO Finanzas에 오신 것을 환영합니다!',
  ob_intro_1: '몇 분 만에 돈을 정리하세요: 지출, 수입, 예산, 계좌와 빚.',
  ob_intro_2: '계정도, 인터넷도 필요 없습니다.',
  ob_intro_3: '모든 것은 이 휴대전화에만 저장됩니다.',
  ob_name_label: '이름이 무엇인가요?',
  ob_name_ph: '당신의 이름',
  ob_pin_label: '보안 PIN 만들기(선택)',
  ob_pin_ph: '4~6자리 숫자, 또는 비워 두기',
  ob_pin2_label: 'PIN 반복',
  ob_pin2_ph: 'PIN 반복',
  ob_start: '시작하기',
  ob_note: 'PIN은 설정에서 언제든 바꿀 수 있습니다.',
  ob_tour1_title: '몇 초 만에 지출 기록',
  ob_tour1_text: '+ 버튼을 누르고 금액과 카테고리를 입력하세요. 그게 다입니다. 지출이 바로 저장됩니다.',
  ob_tour2_title: '오늘 얼마를 쓸 수 있나요?',
  ob_tour2_text: 'PETO Finanzas는 예산을 이번 달 남은 날들에 나누고 단 하나의 숫자만 알려줍니다. 오늘 예산을 넘지 않고 쓸 수 있는 금액입니다.',
  ob_tour3_title: '클라우드 계정(선택)',
  ob_tour3_text: '원하면 무료 계정을 만들어 웹에서도 데이터를 볼 수 있습니다. 계정이 없으면 모든 것이 이 휴대전화에만 남습니다.',
  ob_tour_next: '다음',
  ob_tour_skip: '건너뛰기',
  ob_tour_go: '시작합시다!',
  ob_err_name: '시작하려면 이름을 입력하세요.',
  ob_err_pin_format: 'PIN은 4~6자리 숫자여야 합니다.',
  ob_err_pin_mismatch: '두 PIN이 일치하지 않습니다.',
  set_theme_label: '테마',
  theme_light: '밝게',
  theme_dark: '어둡게',
  theme_auto: '자동(시스템)',
  set_accent_label: '메인 색상',
  accent_verde: '초록',
  accent_azul: '파랑',
  accent_morado: '보라',
  accent_naranja: '주황',
  undo_done: '완료',
  undo_btn: '실행 취소',
  btn_repeat: '반복',
  fab_aria: '빠른 추가',
  quick_title: '무엇을 추가하시겠어요?',
  quick_expense: '🧾 지출',
  quick_income: '💵 수입',
  quick_savings: '🐷 저축',
  sec_buscar: '활동 검색',
  search_label: '검색',
  search_ph: '메모, 카테고리 또는 금액…',
  search_month_label: '월(비우면 전체)',
  search_type_label: '유형',
  type_all: '전체',
  type_gastos: '지출',
  type_ingresos: '수입',
  type_ahorros: '저축',
  search_empty: '결과가 없습니다.',
  search_type_income: '수입',
  search_type_saving: '저축',
  chal_title: '🔥 주간 저축 챌린지',
  chal_progress: '이번 주: {target} 중 {have}',
  chal_done: '🎉 이번 주 챌린지가 완료되었습니다!',
  chal_streak_one: '연속: 1주 완료',
  chal_streak_many: '연속: {n}주 완료',
  chal_streak_zero: '연속: 0주. 이번 주가 첫 번째가 될 수 있습니다!',
  streak_one: '🔥 1일 연속 기록 중',
  streak_many: '🔥 {n}일 연속 기록 중',
  chal_target_label: '주간 저축 목표($)',
  chal_save: '주간 목표 저장',
  rep_title: '월간 보고서',
  rep_download: '이미지 다운로드',
  rep_share_image: '이미지 공유',
  trend_title: '지출 추세',
  trend_weeks: '이번 달의 주',
  trend_week: '{n}주차',
  trend_empty: '추세를 보여줄 지출이 아직 없습니다.',
  rep_income: '수입',
  rep_expenses: '지출',
  rep_savings: '저축',
  rep_top_cat: '최상위 카테고리',
  rep_top3: '상위 3개 카테고리',
  rep_goal: '저축 목표',
  rep_none: '활동 없음',
  calc_title: '빚 상환 계산기',
  calc_intro: '빚에서 벗어나는 두 가지 계획을 비교하세요. 가장 작은 것부터 갚기(눈덩이 방식) 또는 이자가 가장 높은 것부터 갚기(눈사태 방식). 매월 모든 최소 금액을 내고 나머지는 목표 빚으로 갑니다.',
  calc_budget_label: '빚에 매월 총 얼마를 낼 수 있나요?($)',
  calc_run: '계산',
  calc_snowball: '눈덩이 방식(잔액이 가장 작은 것부터)',
  calc_avalanche: '눈사태 방식(이자가 가장 높은 것부터)',
  calc_result: '{months}개월이면 빚 없음 · 이자 약 {interest}',
  calc_months_one: '1개월이면 빚 없음 · 이자 약 {interest}',
  calc_order: '상환 순서:',
  calc_free: '남은 빚이 없습니다! 🎉',
  calc_warn: '그 월 납부액으로는 어떤 빚이 절대 끝나지 않습니다. 납부액이 이자조차 감당하지 못합니다. 월 납부액을 올리세요.',
  calc_note_zero: '최소 납부액이나 이자가 기록되지 않은 빚은 최소 $0, 이자 0%로 계산됩니다.',
  calc_err_budget: '매월 얼마를 낼 수 있는지 입력하세요.',
  debt_interest_label: '연 이자 %(선택)',
  debt_minpay_label: '월 최소 납부액 $(선택)',
  debt_terms: '연 이자 {pct}% · 최소 {min}/월',
  exp_photo_label: '영수증 사진(선택)',
  exp_photo_remove: '사진 제거',
  photo_close: '닫기',
  err_photo_quota: '사진을 저장할 공간이 없었습니다. 지출은 사진 없이 저장되었습니다.',
  banner_backup: '데이터 백업을 저장한 지 오래되었습니다. 설정에서 백업을 내보내세요.',
  pro_title: 'PETO Pro',
  pro_card_text: '데이터를 위한 무제한 클라우드, 고급 보고서, 공유 예산, 그리고 san 주최자 모드.',
  pro_status_free: '지금은 무료 요금제입니다.',
  pro_status_active: 'PETO Pro가 활성화되어 있습니다. PETO Finanzas를 응원해 주셔서 감사합니다! ⭐',
  pro_status_test: '비공개 테스트 동안 PETO Pro가 열려 있습니다. 테스트가 지속되는 동안 전체 접근 권한이 있습니다.',
  pro_status_waitlist: 'PETO Pro 대기자 명단에 있습니다.',
  pro_btn_see: 'PETO Pro 보기',
  pro_wall_title: '이것은 PETO Pro 기능입니다 ⭐',
  pro_price_line: '월 $1.99에 불과',
  pro_benefit_cloud: '☁️ 데이터를 위한 무제한 클라우드',
  pro_benefit_report: '📊 고급 보고서: 월 비교와 CSV 내보내기',
  pro_benefit_shared: '🏠 가구와의 공유 예산',
  pro_benefit_org: '🤝 san 주최자 모드: 그룹 전체의 tanda',
  pro_coming_text: '인앱 구매는 Google Play 출시와 함께 옵니다. 그전까지 대기자 명단에 참여할 수 있습니다. 월 $1.99로 Pro를 켤 수 있게 되면 알려드리겠습니다.',
  pro_waitlist_btn: '대기자 명단에 참여',
  pro_waitlist_done: '명단에 올랐습니다 ✅ Pro를 사용할 수 있게 되면 알려드리겠습니다.',
  pro_close: '나중에',
  pro_tag: 'PRO',
  adv_title: '고급 보고서',
  adv_note: 'PETO Pro 기능입니다. 이번 달과 지난달 비교, 모든 카테고리, 그리고 월의 CSV 내보내기.',
  adv_open_btn: '고급 보고서 보기',
  adv_export_csv: '월을 CSV로 내보내기',
  adv_this_month: '이번 달',
  adv_prev_month: '지난달',
  adv_change: '변화',
  adv_all_cats: '모든 카테고리',
  adv_empty: '이 두 달 동안 활동이 없습니다.',
  org_title: 'san 주최자 모드',
  org_intro: '그룹 전체의 tanda를 운영하세요. 날짜가 있는 라운드, 각 라운드에서 누가 냈는지 표시하고, 상태를 그룹과 공유합니다.',
  org_pro_note: '주최자 모드는 PETO Pro 기능입니다.',
  org_form_title: '그룹 san 만들기',
  org_freq_label: '라운드 주기',
  org_freq_semanal: '매주',
  org_freq_quincenal: '2주마다',
  org_freq_mensual: '매월',
  org_start_label: '첫 라운드 날짜',
  org_create_btn: '조직된 san 만들기',
  org_round: '{n}라운드 중 {x}라운드',
  org_receiver_line: '받는 사람: {name}',
  org_pending_none: '모두 냈습니다! 🎉',
  org_pending_list: '아직 내지 않음: {names}',
  org_pending_count_one: '1명 남음',
  org_pending_count_many: '{n}명 남음',
  org_totals_title: '참가자별 기여금',
  org_paid_rounds: '{n}라운드 중 {paid}라운드 납부됨',
  org_delete: '조직된 san 삭제',
  org_delete_confirm: '조직된 san \'{name}\'을(를) 삭제할까요? 그룹의 납부 기록이 사라집니다.',
  org_share_title: 'san 상태',
  shared_live_note: '예산을 가구와 공유하세요. 가구를 만들거나 코드로 참여하면 같은 구성원을 볼 수 있습니다. 클라우드 계정(위, 설정에서)과 PETO Pro가 필요합니다.',
  shared_leave_live: '이 가구에서 나갈까요? 공유 예산을 더 이상 볼 수 없습니다.',
  shared_err_login: '먼저 클라우드 계정으로 로그인하고(위, 설정에서) 다시 시도하세요.',
  shared_err_generic: '완료할 수 없었습니다. 연결을 확인하고 다시 시도하세요.',
  shared_err_code_live: '그 코드는 존재하지 않습니다. 확인하고 다시 시도하세요.',
  shared_err_member: '이미 이 가구의 구성원입니다.',
  shared_err_owner_leave: '이 가구의 소유자입니다. 삭제하지 않고는 나갈 수 없습니다. 다른 구성원에게 새 가구를 만들어 달라고 하세요.',
  shared_created_live: '가구가 만들어졌습니다 ✅ 코드를 공유해 가구를 초대하세요.',
  shared_joined_live: '가구에 참여했습니다 ✅',
  lang_auto: '자동(휴대전화 언어)',
  org_comp_label: '주최자 보상',
  org_comp_none: '보상 없음',
  org_comp_first: '주최자가 먼저 받음',
  org_comp_last: '주최자가 마지막에 받음',
  org_comp_extra: '라운드별 추가 요금',
  org_comp_amount_label: '1인당 추가 요금 ($)',
  org_comp_line: '주최자 보상: {mode}',
  org_sim_title: '팟 시뮬레이션',
  org_sim_pays: '각 참가자가 라운드마다 내는 금액: {amount}',
  org_sim_pot: '각 라운드의 팟: {amount}',
  org_sim_total_in: '각자가 전체 san에서 내는 총액: {amount}',
  org_sim_extra_org: '주최자가 라운드마다 {amount}를 추가로 받음',
  org_sim_first: '주최자가 첫 라운드의 팟을 받음',
  org_sim_last: '주최자가 마지막 라운드의 팟을 받음',
  org_shuffle_btn: '🎲 순서 섞기',
  org_shuffled: '🎲 순서를 섞었습니다! 새 순서입니다.',
  org_shuffle_need: '순서를 섞으려면 참가자를 2명 이상 추가하세요.',
  org_shuffle_blocked: '더 이상 섞을 수 없습니다: san이 시작되었거나 결제 기록이 있습니다.',
  org_start_btn: 'San 시작',
  org_started_line: 'San 진행 중 · 순서가 잠겼습니다',
  org_order_title: '차례 순서',
  org_move_up: '위로',
  org_move_down: '아래로',
  org_swap_blocked: '그 차례는 이미 결제가 있어 변경할 수 없습니다.',
  org_history_title: '변경 내역',
  org_history_swap: '{a}님과 {b}님이 차례를 바꿨습니다',
  org_history_started: '주최자가 san을 시작했습니다',
  org_pay_pending: '대기 중',
  org_pay_reported: '보고됨',
  org_pay_confirmed: '확인됨',
  org_status_btn: '상태: {status}',
  org_receipt_add: '📎 영수증',
  org_receipt_view: '영수증 보기',
  org_receipt_remove: '제거',
  org_zelle_label: '각 참가자의 Zelle(번호 또는 이메일, 선택)',
  org_zelle_ph: 'Zelle(선택)',
  org_zelle_line: 'Zelle: {zelle}',
  org_reminder_btn: '📲 WhatsApp 알림',
  org_reminder_head: '🤝 {san} · {n}라운드 중 {x}라운드 · {date}',
  org_reminder_receiver: '💰 이번 주는 {name}님이 받습니다',
  org_reminder_zelle: '{name}님의 Zelle: {zelle}',
  org_reminder_amount: '라운드 납입금: {amount}',
  org_antifraud: '🛡️ San은 이자를 지급하지 않으며 납입액보다 많이 지급하지 않습니다.',
  org_link_btn: '🔗 읽기 전용 링크',
  org_link_publish: '링크 만들기',
  org_link_update: '링크 업데이트',
  org_link_copied: '링크가 복사되었습니다!',
  org_link_need_cloud: '링크를 만들려면 클라우드 계정이 필요합니다: 설정에서 로그인한 뒤 다시 시도하세요.',
  org_link_ready: '그룹 san(읽기 전용)',
  org_public_title: '링크를 공유할 준비가 되었습니다.',
  org_public_updated: '{date}에 업데이트됨',
  org_public_notfound: '이 링크는 더 이상 사용할 수 없습니다.',
  org_pub_pay_btn: '결제했어요',
  org_pub_confirm: '이번 라운드의 몫을 이미 결제하셨나요? 주최자가 확인할 거예요.',
  org_pub_attach: '📎 영수증 사진 첨부(선택)',
  org_pub_send: '보고 보내기',
  org_pub_sent: '완료! 결제가 보고되었습니다.',
  org_pub_reported_note: '보고됨 · 확인 대기 중',
  org_pub_err: '보낼 수 없습니다. 연결을 확인하고 다시 시도하세요.',
  org_pub_err_confirmed: '이 결제는 주최자가 이미 확인했습니다.',
  org_pub_err_photo: '사진이 너무 큽니다. 더 작은 사진으로 시도하세요.',
  org_penalty_label: '연체 규칙',
  org_penalty_none: '벌금 없음',
  org_penalty_fixed: '고정 벌금',
  org_penalty_percent: '납입금의 비율',
  org_penalty_amount_label: '벌금 금액 ($)',
  org_penalty_percent_label: '벌금 비율 (%)',
  org_penalty_line_fixed: '늦으면: {amount} 벌금',
  org_penalty_line_percent: '늦으면: 납입금의 {percent}% 벌금',
  set_news_title: '새 소식',
  news_c24: 'Compilación 24: 환영 투어, 기록 연속 일수, 진행 표시줄이 있는 저축 목표와 추세 그래프.',
  news_c25: 'Compilación 25: 홈 화면 위젯과 훨씬 가벼워진 앱(52MB에서 7MB로).',
  news_c26: 'Compilación 26: 세 가지 크기의 위젯, 위젯별 옵션, 앱을 열지 않고 지출을 기록하는 버튼.',
  news_c27: 'Compilación 27: 12개 언어를 지원하고 휴대전화 언어를 자동으로 따라가는 앱.',
  news_c28: 'Compilación 28: 시작부터 적용되는 큰 글자, 이 새 소식 섹션, 이탈리아어 검토와 더 빠른 시작.',
  news_c31: 'Compilación 31: 뒤로 가기 버튼이나 제스처가 이제 앱 안에서 이동합니다: 열려 있는 것을 닫고 메인 화면으로 돌아간 뒤 종료합니다.',
  news_c32: '버전 32: 이제 앱 전체(메뉴, 잠금 화면, 위젯)에서 브랜드가 "PETO Finanzas"로 표시되고, san이 홈 목록 맨 위로 이동했으며, san 공개 링크가 그룹 상태를 바로 열고, 조직자 버튼이 항상 명확한 메시지로 응답합니다.',
  news_c33: '버전 33: san을 새로 만들어도 진행 중인 san이 지워지지 않습니다. 이미 활성 san이 있으면 앱이 알려주고 보호합니다(결제, 영수증, 기록, 공개 링크). 웹 버전도 이제 휴대전화와 동기화됩니다.',
  news_c34: '버전 34: PETO Finanzas의 새 로고 — 에메랄드 배경에 흰색 "P"와 연한 녹색 막대와 화살표가 이제 아이콘, 잠금 화면, 앱 전체에 적용됩니다.',
  news_c35: '버전 35: san 공개 링크에서 "결제했어요"로 결제를 보고하고 영수증을 첨부할 수 있습니다(주최자가 확인). 공개 뷰어는 다크 테마를 사용하고, 아래로 당기면 앱이 새로고침되며, PDF 리더가 보낸 Zelle 결제를 수입으로 착각하지 않습니다.',
  sec_podcast: '팟캐스트',
  key_podcast: 'Finanzas Personales 팟캐스트',
  pod_hosts: '진행: Lucía와 Marco',
  pod_desc: '돈 이야기, 쉽게: 짧은 에피소드로 저축, 빚 탈출, 지갑 관리 팁을 전합니다.',
  pod_spotify_btn: 'Spotify에서 듣기',
  pod_loading: '에피소드를 불러오는 중…',
  pod_offline: '연결 없음: 마지막으로 받은 목록을 표시합니다',
  pod_error: '에피소드를 불러오지 못했습니다. 연결을 확인하고 다시 시도하세요.',
  pod_empty: '아직 공개된 에피소드가 없습니다.',
  pod_play_aria: '재생',
  pod_pause_aria: '일시정지',
  pod_audio_error: '이 에피소드를 재생할 수 없습니다.',
  pub_tagline: '당신의 san, 체계적이고 투명하게',
  pub_progress: '{n}개 중 {x}개 결제 확인됨',
  pub_progress_start: '이제 시작 단계: 아직 확인된 결제가 없습니다',
  pub_cta_title: '나만의 san을 조직하고 싶나요?',
  pub_cta_text: 'PETO Finanzas와 함께라면 순서, 차례, 영수증을 한곳에서 관리할 수 있습니다. 공책도, 혼란도 없이요.',
  pub_cta_try: 'PETO Finanzas 사용해 보기',
  pub_cta_more: '자세히 보기',
  pub_bar_try: '앱 사용해 보기',
  pub_footer: 'PETO Finanzas로 제작 · petofinanzas.com',
  news_c36: '버전 36: 새로운 팟캐스트 섹션 — 앱을 떠나지 않고 "Finanzas Personales"를 들을 수 있고, 내장 플레이어와 오프라인용 저장 목록을 제공합니다. 시작 화면이 이제 슬라이드마다 자동으로 넘어갑니다. 링크 화면도 새로워졌습니다: san의 진행 상황과 앱을 바로 써볼 수 있는 접근을 보여줍니다.',
  news_c37: '버전 37: 새로워진 위젯 — 브랜드 그라데이션, 예산에 따라 색이 바뀌는 진행 바, san 다음 차례 줄 — 그리고 오늘 쓸 수 있는 금액을 보여주는 아이콘 크기의 새 위젯. 공개 san 링크를 스크롤해도 브랜드가 계속 보입니다. 주최자 라운드는 아코디언으로 접히고, 이번 주 것만 열립니다.',
  widget_today: '오늘',
  widget_san_next: '다음 차례: {name} · {date}',
  widget_san_next_nodate: '다음 차례: {name}',
  back_exit_hint: '한 번 더 뒤로를 누르면 종료됩니다.'
},
ru: {
  org_err_san_name: 'Введите название сана.', rep_promo_footer: 'Контролируйте свои расходы с PETO Finanzas · petofinanzas.com', rep_saved: 'Изображение сохранено.', set_sections_summary: 'Видимо {visible} из {total}',
  org_err_active_exists: 'Уже есть активный san («{name}»). Сначала удалите его на его карточке, если хотите создать другой.',
  app_title: 'PETO Finanzas',
  back: '← Все параметры',
  greeting: 'Здравствуйте',
  lock_btn: 'Заблокировать',
  home_menu_heading: 'Что вы хотите посмотреть?',
  group_daily: 'День за днём',
  group_plan: 'Планирование',
  group_accounts: 'Счета и обязательства',
  group_yourapp: 'Ваше приложение',
  sec_gastos: 'Расходы месяца',
  sec_ingresos: 'Еженедельные доходы',
  sec_ahorros: 'Сбережения',
  sec_resumen: 'Сводка',
  sec_presupuesto: 'Бюджет по категориям',
  sec_pagos: 'Постоянные платежи',
  sec_cuentas: 'Мои счета',
  sec_deudas: 'Мои долги',
  sec_san: 'Мой сан (танда)',
  sec_ajustes: 'Настройки и персонализация',
  menu_open_aria: 'Открыть меню',
  menu_close_aria: 'Закрыть меню',
  sec_home: 'Главная',
  key_home: 'Ваш главный экран',
  set_notif_label: 'Уведомления при закрытом приложении',
  set_notif_help: 'Напоминания о ваших постоянных платежах за день и в день оплаты, даже когда PETO Finanzas закрыто.',
  set_autofixed_label: 'Записывать постоянные платежи автоматически',
  set_autofixed_help: 'Когда наступает срок постоянного платежа, расход записывается за вас. Его можно сразу отменить.',
  set_bio_label: 'Вход по отпечатку пальца',
  set_bio_help: 'Вход по отпечатку пальца в дополнение к PIN (нужен активный PIN).',
  bio_btn: '👆 Войти по отпечатку',
  bio_reason: 'Подтвердите, что это вы, чтобы открыть PETO Finanzas',
  bio_need_pin: 'Для входа по отпечатку нужен активный PIN: создайте PIN в «Настройки → Безопасность», и отпечаток будет работать при открытии приложения.',
  bio_failed: 'Не удалось подтвердить отпечаток. Введите ваш PIN.',
  bio_unavailable: 'Отпечаток пальца недоступен на этом телефоне. Введите ваш PIN.',
  bio_not_enrolled: 'На этом телефоне не зарегистрирован ни один отпечаток. Зарегистрируйте его в настройках телефона или введите PIN.',
  bio_offer_title: 'Входить по отпечатку пальца?',
  bio_offer_text: 'Вы только что создали PIN. Если хотите, можете открывать PETO Finanzas отпечатком пальца вместо ввода PIN каждый раз. Включить сейчас?',
  bio_offer_yes: 'Да, включить отпечаток',
  bio_offer_no: 'Не сейчас',
  bio_activated: 'Готово: вход по отпечатку пальца включён.',
  fix_auto_suffix: '(автоматический постоянный платёж)',
  backup_pass_label: 'Пароль зашифрованной копии',
  backup_pass_ph: 'Минимум 4 символа',
  data_export_enc: 'Экспорт зашифрованной копии',
  backup_help: 'Зашифрованная копия открывается только вашим паролем. Без него восстановить её нельзя: храните его бережно. Чтобы импортировать зашифрованную копию, введите её пароль здесь до выбора файла.',
  backup_err_short: 'Пароль должен содержать не менее 4 символов.',
  backup_need_pass: 'Введите пароль зашифрованной копии перед её импортом.',
  backup_err_pass: 'Не удалось открыть копию: неверный пароль или повреждённый файл.',
  share_btn: 'Поделиться сводкой',
  share_copied: 'Сводка скопирована. Вставьте её куда угодно.',
  review_title: 'Вам нравится PETO Finanzas?',
  review_text: 'Если PETO Finanzas помогает вам беречь деньги, отзыв в Google Play очень поможет нам охватить больше людей. Спасибо!',
  review_yes: '⭐ Оценить в Google Play',
  review_no: 'Не сейчас',
  share_report_title: 'Моя сводка PETO Finanzas',
  notif_fixed_title: 'Постоянный платёж завтра',
  notif_fixed_today: 'Постоянный платёж сегодня',
  notif_fixed_body: '{name} · {amount}',
  notif_weekly_title: 'Ваша неделя в PETO Finanzas',
  notif_weekly_body: 'Записывайте расходы и доходы этой недели, чтобы не сбиться с курса.',
  summary_title: 'Ежедневная сводка',
  summary_help: 'Напоминание о том, сколько вы потратили вчера и сколько можете потратить сегодня, в выбранное вами время.',
  summary_notif_label: 'Сводка уведомлением',
  summary_time_label: 'Время сводки',
  summary_email_label: 'Получать также по почте',
  summary_email_help: 'Только при активной облачной учётной записи: та же сводка приходит и на вашу почту.',
  notif_summary_title: '🌅 Ваша сводка PETO Finanzas',
  notif_summary_body: 'Вчера вы потратили {spent} · Сегодня вы можете потратить {daily}',
  notif_summary_body_nodaily: 'Вчера вы потратили {spent}',
  sec_remesas: 'Переводы',
  key_remesas: 'Отправлено в этом месяце: {amount}',
  rem_intro: 'Деньги, которые вы отправляете своим близким: сколько ушло в долларах и сколько пришло в их валюте.',
  rem_usd_label: 'Сумма отправки ($ USD)',
  rem_rate_label: 'Курс ({cur} за $1)',
  rem_recipient_label: 'Кому?',
  rem_currency_label: 'Валюта назначения',
  rem_arrives_label: 'Поступает',
  rem_rate_suggested: 'Последний использованный вами курс для {cur}: {rate}. Он уже подставлен; измените, если сегодня курс другой.',
  rem_month_sent: 'В этом месяце вы отправили {usd}',
  rem_totals_title: 'Итоги по валютам (вся история)',
  rem_total_row: 'Отправлено {usd} → получено {amount} · {n} отправок',
  rem_save: 'Сохранить перевод',
  rem_empty: 'Переводы пока не записаны.',
  rem_delete_confirm: 'Удалить перевод для {name}?',
  csv_title: 'Импорт банковской выписки (CSV)',
  csv_help: 'Загрузите CSV-файл вашего банка и проверьте всё в предпросмотре перед импортом: ничего не сохраняется, пока вы не подтвердите.',
  csv_file_label: 'CSV-файл банка',
  csv_preview_title: 'Предпросмотр импорта',
  csv_summary: '{total} операций · {dups} дубликатов (исключены) · {sel} к импорту',
  csv_dup_badge: 'Дубликат',
  csv_income_badge: 'Доход',
  csv_expense_badge: 'Расход',
  csv_all: 'Отметить все',
  csv_none: 'Снять все отметки',
  csv_apply: 'Импортировать выбранное',
  csv_cancel: 'Отменить импорт',
  csv_done: 'Импортировано операций: {n}. ✅',
  csv_none_selected: 'Вы не отметили ни одной операции для импорта.',
  csv_err_parse: 'Не удалось прочитать этот файл как CSV. Проверьте, что это выписка банка в формате CSV.',
  csv_err_headers: 'В этом файле не найдены столбцы даты и суммы.',
  csv_err_big: 'Этот файл слишком большой для импорта.',
  csv_err_empty: 'В этом файле нет операций, которые можно импортировать.',
  pdf_err_big: 'Этот PDF слишком большой (максимум 8 МБ).',
  pdf_err_notext: 'В этом PDF нет текста, который я мог бы прочитать (похоже на фото или скан). Попробуйте CSV банка или запишите расход по фото чека.',
  pdf_err_empty: 'Я не нашёл в этом PDF операций с датой и суммой. Попробуйте CSV банка.',
  shared_title: 'Общий бюджет',
  shared_preview_note: '🔧 Предпросмотр дизайна: пока не подключается к другим аккаунтам. Используйте, чтобы попробовать, как будет выглядеть создание домохозяйства, вступление по коду и список участников.',
  shared_create_label: 'Название домохозяйства',
  shared_create_btn: 'Создать домохозяйство',
  shared_join_label: 'Код приглашения',
  shared_join_btn: 'Вступить по коду',
  shared_members_title: 'Участники',
  shared_code_label: 'Код приглашения: {code}',
  shared_role_dueno: 'Владелец',
  shared_role_admin: 'Администратор',
  shared_role_miembro: 'Участник',
  shared_role_lector: 'Только чтение',
  shared_you: 'Вы',
  shared_host: 'Хозяин',
  shared_leave_btn: 'Покинуть домохозяйство',
  shared_leave_confirm: 'Покинуть это домохозяйство? (предпросмотр)',
  shared_err_name: 'Введите название домохозяйства.',
  shared_err_code: 'Код состоит из 6 букв или цифр.',
  shared_created: 'Домохозяйство создано (предпросмотр). ✅',
  shared_joined: 'Вы вступили в домохозяйство (предпросмотр). ✅',
  shared_household_fallback: 'Общее домохозяйство',
  privacy_hide: 'Скрыть суммы',
  privacy_show: 'Показать суммы',
  ins_title: '💡 Мысли о ваших деньгах',
  ins_cat_up: '{cat} вырос на {pct}% по сравнению с прошлым месяцем ({from} → {to}).',
  ins_pace_down: 'Ваш темп улучшается: расходы снизились на {pct}% по сравнению с прошлым месяцем.',
  ins_pace_up: 'Внимание: темп ваших расходов вырос на {pct}% по сравнению с прошлым месяцем.',
  ins_biggest: 'Ваш самый большой расход в этом месяце: {note} · {amount}.',
  ins_saved: 'Вы сберегли {amount} в этом месяце. Так держать!',
  bud_alert_title: 'Бюджет под угрозой',
  bud_alert_warn: '{cat}: вы на {pct}% бюджета.',
  bud_alert_over: '{cat}: вы вышли за бюджет ({pct}%).',
  voice_btn: '🎤 Надиктовать',
  voice_listening: 'Слушаю… назовите сумму и на что.',
  voice_unavailable: 'Голос недоступен на этом устройстве.',
  voice_heard: 'Я услышал: «{text}». Проверьте и сохраните.',
  voice_no_amount: 'Я услышал: «{text}», но не нашёл сумму.',
  ocr_found: 'Я нашёл {amount} на чеке. Проверьте перед сохранением.',
  goals_title: 'Ещё цели',
  goal2_create: 'Создать цель',
  goal_add: '+ Добавить',
  goal_take: '− Забрать',
  goal_done: '🎉 Цель достигнута!',
  goal_move_label: 'Сумма',
  goal_delete_confirm: 'Удалить цель «{name}»? Ваши сбережения не затрагиваются: удаляется только цель.',
  err_limit_goals: 'У вас уже максимальное число целей.',
  biz_label: 'Это для моего бизнеса',
  biz_title: 'Мой бизнес в этом месяце',
  biz_income: 'Доходы бизнеса',
  biz_expenses: 'Расходы бизнеса',
  biz_profit: 'Прибыль',
  chal_share: 'Поделиться моим вызовом',
  cloud_title: 'Облачный аккаунт',
  cloud_help: 'С аккаунтом ваши данные также хранятся в облаке и синхронизируются: смените телефон, войдите по почте — и всё на месте. Без аккаунта приложение работает только на этом телефоне, как всегда.',
  cloud_email: 'Эл. почта',
  cloud_pass: 'Пароль',
  cloud_signin: 'Войти',
  cloud_signup: 'Создать аккаунт',
  cloud_signout: 'Выйти',
  cloud_sync_now: 'Синхронизировать сейчас',
  cloud_wipe: 'Удалить мои данные из облака',
  cloud_who: 'Вы вошли как {email}',
  cloud_synced: 'Синхронизировано ✓ · {time}',
  cloud_never: 'Ещё не синхронизировано.',
  cloud_working: 'Работаю…',
  cloud_ok_in: 'С возвращением!',
  cloud_ok_up: 'Аккаунт создан! Ваши данные теперь в облаке.',
  cloud_err_fields: 'Введите почту и пароль не короче 6 символов.',
  cloud_err_login: 'Не удалось войти. Проверьте почту и пароль.',
  cloud_err_exists: 'На эту почту уже есть аккаунт. Используйте «Войти».',
  cloud_err_confirm: 'Аккаунт создан. Проверьте почту, чтобы подтвердить аккаунт, а затем войдите.',
  cloud_err_generic: 'Что-то пошло не так с облаком. Проверьте интернет и попробуйте снова.',
  cloud_conflict: 'В облаке и на этом телефоне разные данные. Загрузить данные из облака и заменить те, что на этом телефоне? (Отмена = загрузить данные этого телефона)',
  cloud_wipe_confirm: 'Удалить ВСЕ ваши данные из облака? То, что на этом телефоне, останется как есть.',
  cloud_delete: 'Удалить мой аккаунт',
  cloud_delete_confirm1: 'Удалить ваш аккаунт PETO Finanzas? Это удалит ваш аккаунт, вашу копию данных в облаке и общие домохозяйства, которыми вы владеете. Данные на ЭТОМ телефоне останутся здесь нетронутыми (их можно стереть в настройках). Это нельзя отменить.',
  cloud_delete_confirm2: 'Окончательное подтверждение: удалить аккаунт навсегда?',
  cloud_deleted: 'Ваш аккаунт был удалён.',
  cloud_delete_err_auth: 'Ваша сессия больше недействительна. Войдите снова и попробуйте ещё раз.',
  cloud_unavailable: 'Облако недоступно в этой версии.',
  key_settings: 'Имя, распределение, текст, разделы, PIN',
  footer: 'PETO Finanzas · Работает офлайн · Облако необязательно: ваши данные — ваш выбор',
  tile_available: 'Доступные деньги',
  tile_available_aria: 'Доступные деньги: перейти в Мои счета',
  tile_savings: 'Сбережения в этом месяце',
  tile_savings_aria: 'Сбережения в этом месяце: перейти в Сбережения',
  tile_debts: 'Непогашенные долги',
  tile_debts_aria: 'Непогашенные долги: перейти в Мои долги',
  tile_incomes: '💵 Доходы',
  tile_incomes_aria: 'Доходы: перейти в Еженедельные доходы',
  tile_expenses: '🧾 Расходы',
  tile_expenses_aria: 'Расходы: перейти в Расходы месяца',
  tile_goal: 'Цель «{name}»: {pct}%',
  key_spent_month: '{amount} потрачено в этом месяце',
  key_income_month: '{amount} получено в этом месяце',
  key_saved_total: '{amount} сбережено всего',
  key_goal_suffix: ' · Цель «{name}»: {pct}%',
  key_budget_one: 'Категория с лимитом: {n}',
  key_budget_many: 'Категорий с лимитом: {n}',
  key_fixed: '{amount} в месяц · к оплате: {n}',
  key_available: 'Доступно: {amount}',
  key_debts: 'Осталось {amount}',
  key_san: 'Неделя {x} из {n} · Следующий: {name}',
  key_san_done: 'Сан завершён 🎉',
  key_san_none: 'Нет активного сана',
  banner_payday: 'Сегодня день зарплаты: запишите доход и сбережения.',
  banner_dues_title: 'Скоро платежи:',
  banner_due_item: '{name} (день {day})',
  banner_close: 'Закрыть',
  spend_title: 'Сколько можно потратить сегодня?',
  spend_note: 'Столько вы можете потратить сегодня, не выходя за рамки.',
  spend_guide: 'Создайте бюджет первой категории, и здесь вы увидите, сколько можно тратить каждый день.',
  spend_left: 'У вас осталось {amount} на оставшиеся {days} дн. месяца.',
  spend_left_one: 'У вас осталось {amount} на сегодня, последний день месяца.',
  spend_over: 'Вы достигли бюджета этого месяца.',
  spend_over_by: 'Вы превысили на {amount}.',
  cat_Renta: 'Аренда',
  cat_Comida: 'Еда',
  "cat_Comida fuera": 'Еда вне дома',
  cat_Gasolina: 'Бензин',
  cat_Transporte: 'Транспорт',
  cat_Salud: 'Здоровье',
  cat_Ropa: 'Одежда',
  cat_Otros: 'Прочее',
  btn_cancel: 'Отмена',
  btn_save: 'Сохранить',
  btn_edit: 'Изменить',
  btn_delete: 'Удалить',
  err_amount: 'Введите действительную сумму, больше $0.',
  err_amount_generic: 'Введите действительную сумму.',
  err_name: 'Введите название.',
  chip_paid: 'Оплачено',
  chip_pending: 'Ожидает',
  month_prev_aria: 'Предыдущий месяц',
  month_next_aria: 'Следующий месяц',
  exp_new: 'Новый расход',
  exp_edit: 'Изменить расход',
  exp_total_label: 'Итого за месяц:',
  amount_label: 'Сумма ($)',
  category_label: 'Категория',
  date_label: 'Дата',
  note_label: 'Заметка (необязательно)',
  exp_note_ph: 'На что это было?',
  exp_save: 'Сохранить расход',
  exp_empty: 'В этом месяце расходов пока нет.\nДобавьте первый с помощью формы выше. 👍',
  exp_delete_confirm: 'Удалить этот расход в {amount}? Категория {cat}, дата {date}. Удаляется только этот расход.',
  err_category: 'Выберите действительную категорию.',
  err_limit_expenses: 'Вы достигли лимита сохранённых расходов.',
  inc_intro: 'Сбережения никогда не бывают автоматическими: вы вводите, сколько вы на самом деле сберегли из каждого дохода. Приложение лишь предлагает сумму на основе вашего процента в настройках.',
  inc_new: 'Новый доход',
  inc_edit: 'Изменить доход',
  inc_note_ph: 'Откуда это пришло?',
  inc_savings_label: 'Сбережения ($)',
  inc_savings_label_sug: 'Сбережения (предложение: {amount})',
  inc_savings_help: 'Предложение на основе вашего процента сбережений — измените на то, что вы действительно сберегли. Можно ввести $0.',
  inc_split_line: 'Сбережено: {sav} · Предложение: Бизнес {biz} · Расходы {exp} · Семья {fam}',
  inc_split_preview: 'Предлагаемое распределение: Сбережения {sav} · Бизнес {biz} · Расходы {exp} · Семья {fam}. Сбережения, которые засчитываются, — те, что вы вводите ниже.',
  inc_save: 'Сохранить доход',
  inc_empty: 'Доходы пока не записаны.\nДобавьте ваш первый доход и введите, сколько вы из него сберегли. 💪',
  inc_delete_confirm: 'Удалить этот доход в {amount} от {date}? Его отмеченные сбережения в {savings} также будут удалены.',
  err_inc_savings: 'Введите, сколько вы сберегли из этого дохода (может быть $0).',
  err_limit_incomes: 'Вы достигли лимита сохранённых доходов.',
  sav_intro_1: 'Здесь вы видите каждую сбережённую сумму, одну за другой. Вы также можете добавить отдельное сбережение,',
  sav_intro_2: 'не привязанное ни к какому доходу',
  sav_intro_3: ', с помощью формы ниже. Если вы удалите сбережение, удаляется только эта сумма:',
  sav_intro_4: 'доход остаётся тем же',
  sav_intro_5: '.',
  sav_total_label: 'Всего сбережено:',
  sav_month_label: 'Сбережено в этом месяце:',
  sav_form_title: 'Добавить сбережение',
  sav_note_ph: 'Для чего это сбережение?',
  sav_save: 'Сохранить сбережение',
  sav_goal_label: 'Назначить цели (необязательно)',
  sav_goal_none: 'Без цели · общие сбережения',
  sav_empty: 'Сбережения пока не отмечены.\nДобавьте одно с помощью формы выше, или отметьте сбережение дохода при его записи, и оно появится здесь. 🌱',
  sav_from_title: 'Сбережение от {date}',
  sav_from_sub: 'Из дохода в {amount}',
  sav_manual_title: 'Добавленное сбережение',
  sav_manual_sub: 'Вручную · добавлено {date}',
  sav_delete_income_confirm: 'Удалить это сбережение в {amount} от {date}? Удаляется только эта сумма сбережения: доход в {income} остаётся тем же.',
  sav_delete_manual_confirm: 'Удалить это сбережение в {amount} от {date}? Это сбережение, которое вы добавили вручную в «Сбережениях»; удаляется только эта запись.',
  err_limit_savings: 'Вы достигли лимита сохранённых сбережений.',
  goal_prompt: 'На что вы копите?',
  goal_prompt_sub: 'Создайте цель и наблюдайте, как ваши сбережения приближаются к ней.',
  goal_form_create: 'Создать цель',
  goal_form_edit: 'Изменить цель',
  goal_name_label: 'Название цели',
  goal_name_ph: 'Например: Резервный фонд',
  goal_target_label: 'Сумма цели ($)',
  goal_create_btn: 'Создать цель',
  goal_save_btn: 'Сохранить цель',
  goal_progress: 'Вы сберегли {have} из {target}',
  goal_remaining: 'Осталось {amount}',
  goal_edit: 'Изменить цель',
  goal_delete: 'Удалить цель',
  err_goal_name: 'Введите название для вашей цели.',
  res_cats_title: 'Расходы по категориям',
  res_summary_title: 'Доходы против расходов против сбережений',
  chart_income: 'Доходы',
  chart_expenses: 'Расходы',
  chart_savings: 'Сбережения',
  res_cats_empty: 'В этом месяце нет расходов.',
  res_summary_empty: 'В этом месяце активности пока нет.',
  bud_intro: 'Установите месячный лимит по каждой категории и смотрите, сколько вы потратили.',
  bud_spent_left: 'Потрачено {spent} из {budget} · осталось {left}',
  bud_spent_over: 'Потрачено {spent} из {budget} · превышение {over}',
  bud_nolimit: 'Без лимита. Потрачено в этом месяце: {spent}',
  bud_placeholder: 'Месячный лимит $',
  bud_aria: 'Месячный лимит для {cat}',
  bud_delete_cat: 'Удалить категорию',
  bud_delete_cat_confirm: 'Удалить категорию «{cat}»? Расходы, которые её используют, перейдут в «{other}».',
  bud_alert_amount: 'Введите действительную сумму для лимита.',
  cat_form_title: 'Своя категория',
  cat_name_label: 'Название категории',
  cat_name_ph: 'Например: Питомцы',
  cat_save: 'Добавить категорию',
  err_cat_name: 'Введите название категории.',
  err_cat_exists: 'Такая категория уже есть.',
  fix_intro: 'Платежи, которые повторяются каждый месяц: аренда, телефон, подписки…',
  fix_new: 'Новый постоянный платёж',
  fix_edit: 'Изменить постоянный платёж',
  fix_name_ph: 'Например: Аренда',
  fix_day_label: 'День месяца',
  fix_save: 'Сохранить постоянный платёж',
  fix_empty: 'Постоянных платежей пока нет.',
  fix_sub: 'День {day} каждого месяца · {month}',
  fix_mark: 'Отметить оплаченным',
  fix_unmark: 'Снять отметку',
  fix_delete_confirm: 'Удалить постоянный платёж «{name}»?',
  err_day: 'День должен быть от 1 до 31.',
  err_limit_fixed: 'Вы достигли лимита постоянных платежей.',
  acc_new: 'Новый счёт',
  acc_edit: 'Изменить счёт',
  acc_balance_label: 'Баланс ($)',
  acc_name_ph: 'Например: Наличные, Банк, Сбережения',
  acc_save: 'Сохранить счёт',
  acc_empty: 'Счетов пока нет.\nДобавьте один, чтобы видеть доступные деньги в сводке.',
  acc_delete_confirm: 'Удалить счёт «{name}»?',
  err_balance: 'Введите действительный баланс.',
  err_limit_accounts: 'Вы достигли лимита счетов.',
  debt_new: 'Новый долг',
  debt_edit: 'Изменить долг',
  debt_name_ph: 'Например: Карта, Кредит',
  debt_status_label: 'Статус',
  debt_status_pending: 'Ожидает',
  debt_status_paid: 'Оплачен',
  debt_save: 'Сохранить долг',
  debt_empty: 'Долги не записаны. 🎉',
  debt_mark_paid: 'Отметить оплаченным',
  debt_mark_pending: 'Отметить ожидающим',
  debt_delete_confirm: 'Удалить долг «{name}»?',
  err_limit_debts: 'Вы достигли лимита долгов.',
  name_label: 'Имя',
  san_intro: 'Сан (танда) — это круг сбережений: каждую неделю все вносят взнос, и один человек по очереди получает всю сумму.',
  san_form_title: 'Создать сан',
  san_name_label: 'Название сана',
  san_name_ph: 'Например: Семейный сан',
  san_aporte_label: 'Взнос за раунд ($)',
  san_participants_label: 'Участники (в порядке очереди)',
  san_pname_ph: 'Имя участника',
  san_add_participant: 'Добавить',
  san_create_btn: 'Создать сан',
  san_err_participants: 'Добавьте не менее 2 участников.',
  san_err_active_exists: 'Уже есть текущий san («{name}»). Сначала удалите его, если хотите создать другой.',
  san_err_dup: 'Этот участник уже в списке.',
  san_err_pname: 'Введите имя участника.',
  san_remove: 'Убрать',
  san_draft_empty: 'Участники ещё не добавлены.',
  san_week: 'Неделя {x} из {n}',
  san_finished: '🎉 Сан завершён!',
  san_finished_note: 'Все недели завершены. Вы можете удалить этот сан и создать новый.',
  san_total_line: 'Всего собрано: {amount}',
  san_week_collected: 'Собрано на этой неделе: {amount} из {target}',
  san_receiver_line: 'Следующий: {name}',
  san_aporte_line: 'Взнос за раунд: {amount}',
  san_paid_title: 'Кто уже оплатил на этой неделе?',
  san_paid: 'оплатил',
  san_advance: 'Отметить неделю завершённой',
  san_delete: 'Удалить сан',
  san_delete_confirm: 'Удалить сан «{name}»? Его записи недель и платежей будут удалены.',
  san_new_btn: 'Создать новый сан',
  san_new_confirm: 'Текущий сан завершён. Удалить его и создать новый?',
  set_profile: 'Ваш профиль',
  set_name_label: 'Ваше имя',
  set_textsize_label: 'Размер текста',
  textsize_normal: 'Обычный',
  textsize_large: 'Крупный',
  set_lang_label: 'Язык / Language',
  set_reminders_title: 'Напоминания',
  set_payday_label: 'День зарплаты',
  set_reminders_label: 'Напоминания на главной',
  wd_none: 'Нет дня зарплаты',
  wd_0: 'Воскресенье',
  wd_1: 'Понедельник',
  wd_2: 'Вторник',
  wd_3: 'Среда',
  wd_4: 'Четверг',
  wd_5: 'Пятница',
  wd_6: 'Суббота',
  set_split_title: 'Предлагаемое распределение дохода (%)',
  set_split_help: 'Четыре числа должны давать в сумме 100. Эти проценты — лишь предложение по распределению вашего дохода: сбережения никогда не сохраняются автоматически — вы всегда вводите, сколько вы на самом деле сберегли из каждого дохода.',
  split_ahorro: 'Сбережения',
  split_negocio: 'Бизнес',
  split_gastos: 'Расходы',
  split_familia: 'Семья',
  set_save: 'Сохранить настройки',
  set_err_sum: 'Проценты должны давать в сумме 100. Сейчас они дают {total}.',
  set_saved: 'Настройки сохранены. ✅',
  set_sections_title: 'Видимые разделы',
  set_sections_help: 'Отключите те, которыми не пользуетесь, чтобы список был короче.',
  set_pin_title: 'Безопасность (PIN)',
  pin_status_on: 'У вас активный PIN. Приложение блокируется при открытии.',
  pin_status_off: 'У вас нет PIN. Вы можете создать его здесь, чтобы защитить данные.',
  pin_current_label: 'Текущий PIN (если он у вас есть)',
  pin_new_label: 'Новый PIN (пусто = удалить PIN)',
  pin_update: 'Обновить PIN',
  pin_err_current: 'Текущий PIN неверен.',
  pin_err_format: 'Новый PIN должен содержать от 4 до 6 цифр.',
  pin_off: 'PIN отключён.',
  pin_updated: 'PIN обновлён. ✅',
  set_data_title: 'Ваши данные',
  set_data_help: 'Всё остаётся только на этом телефоне. Экспортируйте копию, если хотите хранить её где-то ещё.',
  data_export: 'Экспорт копии (JSON)',
  data_import: 'Импорт копии',
  data_reset: 'Удалить все данные',
  data_err_big: 'Этот файл слишком большой.',
  data_err_invalid: 'Не удалось импортировать: файл не является действительной копией PETO Finanzas.',
  import_confirm: 'Импорт заменит ВСЕ текущие данные приложения. Вы уверены?',
  import_done: 'Копия импортирована. ✅',
  reset_confirm1: 'Это удалит ВСЕ данные вашего приложения на этом телефоне. Это нельзя отменить. Вы уверены?',
  reset_confirm2: 'Окончательное подтверждение: удалить всё и начать сначала?',
  lock_prompt: 'Введите ваш PIN, чтобы продолжить.',
  lock_pin_label: 'PIN',
  lock_enter: 'Разблокировать',
  lock_note: 'Ваши данные остаются только на этом телефоне.',
  lock_err: 'Неверный PIN. Попробуйте снова.',
  ob_title: 'Добро пожаловать в PETO Finanzas!',
  ob_intro_1: 'Наведите порядок в деньгах за несколько минут: расходы, доходы, бюджет, счета и долги.',
  ob_intro_2: 'Без аккаунта, без интернета.',
  ob_intro_3: 'Всё хранится только на вашем телефоне.',
  ob_name_label: 'Как вас зовут?',
  ob_name_ph: 'Ваше имя',
  ob_pin_label: 'Создайте PIN безопасности (необязательно)',
  ob_pin_ph: 'От 4 до 6 цифр, или оставьте пустым',
  ob_pin2_label: 'Повторите PIN',
  ob_pin2_ph: 'Повторите PIN',
  ob_start: 'Начать',
  ob_note: 'Вы можете изменить PIN в любое время в настройках.',
  ob_tour1_title: 'Запишите расход за секунды',
  ob_tour1_text: 'Нажмите кнопку +, введите сумму и категорию. Это всё: ваш расход сразу сохраняется.',
  ob_tour2_title: 'Сколько можно потратить сегодня?',
  ob_tour2_text: 'PETO Finanzas распределяет ваш бюджет по оставшимся дням месяца и называет одно-единственное число: сколько вы можете потратить сегодня, не выходя за рамки.',
  ob_tour3_title: 'Ваш облачный аккаунт (необязательно)',
  ob_tour3_text: 'Если хотите, создайте бесплатный аккаунт, чтобы видеть ваши данные и в вебе. Без аккаунта всё остаётся только на вашем телефоне.',
  ob_tour_next: 'Далее',
  ob_tour_skip: 'Пропустить',
  ob_tour_go: 'Поехали!',
  ob_err_name: 'Введите ваше имя, чтобы начать.',
  ob_err_pin_format: 'PIN должен содержать от 4 до 6 цифр.',
  ob_err_pin_mismatch: 'Два PIN не совпадают.',
  set_theme_label: 'Тема',
  theme_light: 'Светлая',
  theme_dark: 'Тёмная',
  theme_auto: 'Автоматически (система)',
  set_accent_label: 'Основной цвет',
  accent_verde: 'Зелёный',
  accent_azul: 'Синий',
  accent_morado: 'Фиолетовый',
  accent_naranja: 'Оранжевый',
  undo_done: 'Готово',
  undo_btn: 'Отменить',
  btn_repeat: 'Повторить',
  fab_aria: 'Быстрое добавление',
  quick_title: 'Что вы хотите добавить?',
  quick_expense: '🧾 Расход',
  quick_income: '💵 Доход',
  quick_savings: '🐷 Сбережение',
  sec_buscar: 'Поиск активности',
  search_label: 'Поиск',
  search_ph: 'Заметка, категория или сумма…',
  search_month_label: 'Месяц (пусто = все)',
  search_type_label: 'Тип',
  type_all: 'Все',
  type_gastos: 'Расходы',
  type_ingresos: 'Доходы',
  type_ahorros: 'Сбережения',
  search_empty: 'Нет результатов.',
  search_type_income: 'Доход',
  search_type_saving: 'Сбережение',
  chal_title: '🔥 Еженедельный вызов сбережений',
  chal_progress: 'На этой неделе: {have} из {target}',
  chal_done: '🎉 Вызов этой недели выполнен!',
  chal_streak_one: 'Серия: завершена 1 неделя',
  chal_streak_many: 'Серия: завершено недель: {n}',
  chal_streak_zero: 'Серия: 0 недель. Эта может стать первой!',
  streak_one: '🔥 1 день записей подряд',
  streak_many: '🔥 {n} дн. записей подряд',
  chal_target_label: 'Недельная цель сбережений ($)',
  chal_save: 'Сохранить недельную цель',
  rep_title: 'Месячный отчёт',
  rep_download: 'Скачать изображение',
  rep_share_image: 'Поделиться изображением',
  trend_title: 'Тенденция расходов',
  trend_weeks: 'Недели этого месяца',
  trend_week: 'Неделя {n}',
  trend_empty: 'Пока нет расходов, чтобы показать тенденцию.',
  rep_income: 'Доходы',
  rep_expenses: 'Расходы',
  rep_savings: 'Сбережения',
  rep_top_cat: 'Главная категория',
  rep_top3: 'Топ-3 категории',
  rep_goal: 'Цель сбережений',
  rep_none: 'Нет активности',
  calc_title: 'Калькулятор погашения долгов',
  calc_intro: 'Сравните два плана выхода из долгов: сначала платить самый маленький (снежный ком) или сначала с самым высоким процентом (лавина). Каждый месяц вы платите все минимумы, а остаток идёт на целевой долг.',
  calc_budget_label: 'Сколько вы можете платить в месяц по долгам в общей сложности? ($)',
  calc_run: 'Рассчитать',
  calc_snowball: 'Снежный ком (сначала самый маленький баланс)',
  calc_avalanche: 'Лавина (сначала самый высокий процент)',
  calc_result: '{months} мес. до жизни без долгов · проценты прим. {interest}',
  calc_months_one: '1 месяц до жизни без долгов · проценты прим. {interest}',
  calc_order: 'Порядок погашения:',
  calc_free: 'У вас нет непогашенных долгов! 🎉',
  calc_warn: 'При таком ежемесячном платеже какой-то долг никогда не погасится: платёж не покрывает даже проценты. Увеличьте ежемесячный платёж.',
  calc_note_zero: 'Долги без отмеченного минимального платежа или процента рассчитываются с минимумом $0 и процентом 0%.',
  calc_err_budget: 'Введите, сколько вы можете платить в месяц.',
  debt_interest_label: 'Годовой процент % (необязательно)',
  debt_minpay_label: 'Ежемесячный минимальный платёж $ (необязательно)',
  debt_terms: '{pct}% годовых · Минимум {min}/мес.',
  exp_photo_label: 'Фото чека (необязательно)',
  exp_photo_remove: 'Убрать фото',
  photo_close: 'Закрыть',
  err_photo_quota: 'Не нашлось места, чтобы сохранить фото: расход был сохранён без него.',
  banner_backup: 'Прошло время с тех пор, как вы сохраняли копию ваших данных. Экспортируйте копию в настройках.',
  pro_title: 'PETO Pro',
  pro_card_text: 'Безлимитное облако для ваших данных, расширенный отчёт, общий бюджет и режим организатора сана.',
  pro_status_free: 'Сейчас вы на бесплатном плане.',
  pro_status_active: 'PETO Pro активен. Спасибо за поддержку PETO Finanzas! ⭐',
  pro_status_test: 'PETO Pro открыт во время закрытого теста: у вас полный доступ, пока длится тест.',
  pro_status_waitlist: 'Вы в списке ожидания PETO Pro.',
  pro_btn_see: 'Смотреть PETO Pro',
  pro_wall_title: 'Это функция PETO Pro ⭐',
  pro_price_line: 'Всего $1,99 в месяц',
  pro_benefit_cloud: '☁️ Безлимитное облако для ваших данных',
  pro_benefit_report: '📊 Расширенный отчёт: сравнение месяцев и экспорт в CSV',
  pro_benefit_shared: '🏠 Общий бюджет с вашим домохозяйством',
  pro_benefit_org: '🤝 Режим организатора сана: танда всей группы',
  pro_coming_text: 'Покупка в приложении появится с запуском в Google Play. А пока вы можете вступить в список ожидания: мы сообщим, как только вы сможете включить Pro за $1,99 в месяц.',
  pro_waitlist_btn: 'Вступить в список ожидания',
  pro_waitlist_done: 'Вы в списке ✅ Мы сообщим, когда Pro станет доступен.',
  pro_close: 'Не сейчас',
  pro_tag: 'PRO',
  adv_title: 'Расширенный отчёт',
  adv_note: 'Функция PETO Pro: этот месяц против предыдущего, каждая категория и экспорт месяца в CSV.',
  adv_open_btn: 'Смотреть расширенный отчёт',
  adv_export_csv: 'Экспорт месяца в CSV',
  adv_this_month: 'Этот месяц',
  adv_prev_month: 'Предыдущий месяц',
  adv_change: 'Изменение',
  adv_all_cats: 'Все категории',
  adv_empty: 'В эти два месяца нет активности.',
  org_title: 'Режим организатора сана',
  org_intro: 'Ведите танду всей группы: раунды с датами, отмечайте, кто заплатил в каждом раунде, и делитесь состоянием с группой.',
  org_pro_note: 'Режим организатора — это функция PETO Pro.',
  org_form_title: 'Создать групповой сан',
  org_freq_label: 'Частота раундов',
  org_freq_semanal: 'Еженедельно',
  org_freq_quincenal: 'Каждые 2 недели',
  org_freq_mensual: 'Ежемесячно',
  org_start_label: 'Дата первого раунда',
  org_create_btn: 'Создать организованный сан',
  org_round: 'Раунд {x} из {n}',
  org_receiver_line: 'Получает: {name}',
  org_pending_none: 'Все оплатили! 🎉',
  org_pending_list: 'Ещё не оплатили: {names}',
  org_pending_count_one: 'Остался 1',
  org_pending_count_many: 'Осталось: {n}',
  org_totals_title: 'Взносы по участникам',
  org_paid_rounds: 'Оплачено {paid} из {n} раундов',
  org_delete: 'Удалить организованный сан',
  org_delete_confirm: 'Удалить организованный сан «{name}»? Запись платежей группы будет потеряна.',
  org_share_title: 'Состояние сана',
  shared_live_note: 'Поделитесь бюджетом с вашим домохозяйством: создайте домохозяйство или вступите по коду, и вы увидите тех же участников. Вам нужен ваш облачный аккаунт (выше, в настройках) и PETO Pro.',
  shared_leave_live: 'Покинуть это домохозяйство? Вы перестанете видеть его общий бюджет.',
  shared_err_login: 'Сначала войдите с вашим облачным аккаунтом (выше, в настройках) и попробуйте снова.',
  shared_err_generic: 'Не удалось завершить. Проверьте соединение и попробуйте снова.',
  shared_err_code_live: 'Такого кода не существует. Проверьте и попробуйте снова.',
  shared_err_member: 'Вы уже участник этого домохозяйства.',
  shared_err_owner_leave: 'Вы владеете этим домохозяйством: вы не можете выйти, не удалив его. Попросите другого участника создать новое домохозяйство.',
  shared_created_live: 'Домохозяйство создано ✅ Поделитесь кодом, чтобы пригласить ваше домохозяйство.',
  shared_joined_live: 'Вы вступили в домохозяйство ✅',
  lang_auto: 'Автоматически (язык телефона)',
  org_comp_label: 'Компенсация организатора',
  org_comp_none: 'Без компенсации',
  org_comp_first: 'Организатор получает первым',
  org_comp_last: 'Организатор получает последним',
  org_comp_extra: 'Дополнительный взнос за раунд',
  org_comp_amount_label: 'Дополнительный взнос с человека ($)',
  org_comp_line: 'Компенсация организатора: {mode}',
  org_sim_title: 'Симуляция банка',
  org_sim_pays: 'Каждый участник вносит за раунд: {amount}',
  org_sim_pot: 'Банк каждого раунда: {amount}',
  org_sim_total_in: 'Всего каждый вносит за весь san: {amount}',
  org_sim_extra_org: 'Организатор получает дополнительно {amount} за раунд',
  org_sim_first: 'Организатор получает банк первого раунда',
  org_sim_last: 'Организатор получает банк последнего раунда',
  org_shuffle_btn: '🎲 Перемешать порядок',
  org_shuffled: '🎲 Порядок перемешан! Вот новый порядок ходов.',
  org_shuffle_need: 'Добавьте не менее 2 участников, чтобы перемешать порядок.',
  org_shuffle_blocked: 'Перемешать больше нельзя: san уже начался или в нём есть платежи.',
  org_start_btn: 'Начать san',
  org_started_line: 'San идёт · Порядок заблокирован',
  org_order_title: 'Порядок ходов',
  org_move_up: 'Вверх',
  org_move_down: 'Вниз',
  org_swap_blocked: 'У этого хода уже есть платежи, его нельзя изменить.',
  org_history_title: 'История изменений',
  org_history_swap: '{a} и {b} поменялись ходами',
  org_history_started: 'Организатор начал san',
  org_pay_pending: 'Ожидает',
  org_pay_reported: 'Сообщено',
  org_pay_confirmed: 'Подтверждено',
  org_status_btn: 'Статус: {status}',
  org_receipt_add: '📎 Чек',
  org_receipt_view: 'Посмотреть чек',
  org_receipt_remove: 'Убрать',
  org_zelle_label: 'Zelle каждого участника (номер или почта, необязательно)',
  org_zelle_ph: 'Zelle (необязательно)',
  org_zelle_line: 'Zelle: {zelle}',
  org_reminder_btn: '📲 Напоминание в WhatsApp',
  org_reminder_head: '🤝 {san} · Раунд {x} из {n} · {date}',
  org_reminder_receiver: '💰 На этой неделе получает {name}',
  org_reminder_zelle: 'Zelle участника {name}: {zelle}',
  org_reminder_amount: 'Взнос раунда: {amount}',
  org_antifraud: '🛡️ San никогда не платит проценты и не больше внесённого.',
  org_link_btn: '🔗 Ссылка только для чтения',
  org_link_publish: 'Создать ссылку',
  org_link_update: 'Обновить ссылку',
  org_link_copied: 'Ссылка скопирована!',
  org_link_need_cloud: 'Для ссылки нужен облачный аккаунт: войдите в Настройках и попробуйте снова.',
  org_link_ready: 'Групповой san (только чтение)',
  org_public_title: 'Ссылка готова к отправке.',
  org_public_updated: 'Обновлено {date}',
  org_public_notfound: 'Эта ссылка больше недоступна.',
  org_pub_pay_btn: 'Я заплатил',
  org_pub_confirm: 'Вы уже заплатили свою долю за этот раунд? Организатор её подтвердит.',
  org_pub_attach: '📎 Приложить фото чека (необязательно)',
  org_pub_send: 'Отправить отчёт',
  org_pub_sent: 'Готово! Ваш платёж отмечен как отправленный.',
  org_pub_reported_note: 'Отправлено · ожидает подтверждения',
  org_pub_err: 'Не удалось отправить. Проверьте соединение и попробуйте ещё раз.',
  org_pub_err_confirmed: 'Этот платёж уже подтверждён организатором.',
  org_pub_err_photo: 'Фото слишком большое; попробуйте меньшее.',
  org_penalty_label: 'Правило опоздания',
  org_penalty_none: 'Без штрафа',
  org_penalty_fixed: 'Фиксированный штраф',
  org_penalty_percent: 'Процент от взноса',
  org_penalty_amount_label: 'Сумма штрафа ($)',
  org_penalty_percent_label: 'Процент штрафа (%)',
  org_penalty_line_fixed: 'При опоздании: штраф {amount}',
  org_penalty_line_percent: 'При опоздании: штраф {percent}% от взноса',
  set_news_title: 'Что нового',
  news_c24: 'Compilación 24: ознакомительный тур, серия дней записей, цели накоплений с полосой прогресса и график тенденции.',
  news_c25: 'Compilación 25: виджет на главном экране и намного более лёгкое приложение (с 52 МБ до 7 МБ).',
  news_c26: 'Compilación 26: виджеты трёх размеров, с настройками для каждого и кнопкой записи расхода без открытия приложения.',
  news_c27: 'Compilación 27: приложение на 12 языках, автоматически следует за языком телефона.',
  news_c28: 'Compilación 28: крупный текст с самого запуска, этот раздел новостей, проверка итальянских текстов и более быстрый старт.',
  news_c31: 'Compilación 31: кнопка или жест «назад» теперь перемещаются внутри приложения: закрывают открытое и возвращают на главный экран перед выходом.',
  news_c32: 'Версия 32: бренд теперь отображается как «PETO Finanzas» по всему приложению (меню, экран блокировки и виджеты), san переехал наверх списка главного экрана, публичная ссылка san открывает сразу статус группы, а кнопки организатора всегда отвечают понятным сообщением.',
  news_c33: 'Версия 33: создание san больше не может стереть текущий — если один уже активен, приложение сообщает об этом и защищает его (платежи, чеки, историю и публичную ссылку) — а веб-версия теперь синхронизирована с телефоном.',
  news_c34: 'Версия 34: новый логотип PETO Finanzas — белая «P» с полосками и стрелкой нежно-зелёного цвета на изумрудном фоне, теперь на значке, экране блокировки и во всём приложении.',
  news_c35: 'Версия 35: по публичной ссылке san теперь можно сообщить о платеже кнопкой «Я заплатил» и приложить чек (подтверждает организатор), публичный просмотр в тёмной теме, приложение обновляется свайпом вниз, а PDF-читалка больше не путает отправленные вами платежи Zelle с доходом.',
  sec_podcast: 'Подкаст',
  key_podcast: 'Finanzas Personales — подкаст',
  pod_hosts: 'с ведущими Lucía и Marco',
  pod_desc: 'Деньги без сложностей: практичные советы, как копить, выходить из долгов и беречь кошелёк, в коротких выпусках.',
  pod_spotify_btn: 'Слушать в Spotify',
  pod_loading: 'Загрузка выпусков…',
  pod_offline: 'Нет соединения: показан последний загруженный список',
  pod_error: 'Не удалось загрузить выпуски. Проверьте соединение и попробуйте снова.',
  pod_empty: 'Выпуски пока не опубликованы.',
  pod_play_aria: 'Слушать',
  pod_pause_aria: 'Пауза',
  pod_audio_error: 'Не удалось воспроизвести этот выпуск.',
  pub_tagline: 'Ваш san — организованно и прозрачно',
  pub_progress: 'Подтверждено платежей: {x} из {n}',
  pub_progress_start: 'Всё только начинается: подтверждённых платежей пока нет',
  pub_cta_title: 'Хотите организовать свой san?',
  pub_cta_text: 'С PETO Finanzas порядок, очерёдность и чеки хранятся в одном месте — без тетрадей и путаницы.',
  pub_cta_try: 'Попробовать PETO Finanzas',
  pub_cta_more: 'Узнать больше',
  pub_bar_try: 'Попробовать приложение',
  pub_footer: 'Сделано в PETO Finanzas · petofinanzas.com',
  news_c36: 'Версия 36: новый раздел «Подкаст» — слушайте «Finanzas Personales», не выходя из приложения, со встроенным плеером и сохранённым списком на случай отсутствия интернета — экран приветствия теперь листается сам, слайд за слайдом — и обновлённый вид ссылки: san показывает свой прогресс и прямой доступ, чтобы попробовать приложение.',
  news_c37: 'Версия 37: обновлённые виджеты — градиент бренда, полоса прогресса, меняющая цвет в зависимости от бюджета, и строка следующего хода вашего san — плюс новый виджет размером со значок с суммой на сегодня. А в публичной ссылке san бренд остаётся на виду при прокрутке. Раунды организатора теперь складываются аккордеоном: открыт только раунд этой недели.',
  widget_today: 'сегодня',
  widget_san_next: 'Следующий ход: {name} · {date}',
  widget_san_next_nodate: 'Следующий ход: {name}',
  back_exit_hint: 'Нажмите «назад» ещё раз, чтобы выйти.'
},
hi: {
  org_err_san_name: 'San का नाम लिखें।', rep_promo_footer: 'PETO Finanzas के साथ अपने खर्चों पर नियंत्रण रखें · petofinanzas.com', rep_saved: 'छवि सहेजी गई।', set_sections_summary: '{total} में से {visible} दिख रहे हैं',
  org_err_active_exists: 'पहले से एक सक्रिय san है ("{name}")। नया बनाने के लिए पहले उसे उसके कार्ड से हटाएँ।',
  app_title: 'PETO Finanzas',
  back: '← सभी विकल्प',
  greeting: 'नमस्ते',
  lock_btn: 'लॉक करें',
  home_menu_heading: 'आप क्या देखना चाहते हैं?',
  group_daily: 'रोज़मर्रा',
  group_plan: 'योजना',
  group_accounts: 'खाते और प्रतिबद्धताएँ',
  group_yourapp: 'आपका ऐप',
  sec_gastos: 'माह के खर्च',
  sec_ingresos: 'साप्ताहिक आय',
  sec_ahorros: 'बचत',
  sec_resumen: 'सारांश',
  sec_presupuesto: 'श्रेणी अनुसार बजट',
  sec_pagos: 'निश्चित भुगतान',
  sec_cuentas: 'मेरे खाते',
  sec_deudas: 'मेरे कर्ज़',
  sec_san: 'मेरा san (tanda)',
  sec_ajustes: 'सेटिंग और निजीकरण',
  menu_open_aria: 'मेनू खोलें',
  menu_close_aria: 'मेनू बंद करें',
  sec_home: 'होम',
  key_home: 'आपकी मुख्य स्क्रीन',
  set_notif_label: 'ऐप बंद होने पर सूचनाएँ',
  set_notif_help: 'PETO Finanzas बंद होने पर भी, आपके निश्चित भुगतानों की सूचना एक दिन पहले और उसी दिन।',
  set_autofixed_label: 'निश्चित भुगतान स्वचालित दर्ज करें',
  set_autofixed_help: 'जब कोई निश्चित भुगतान देय होता है, तो खर्च आपके लिए दर्ज हो जाता है। आप तुरंत उसे वापस कर सकते हैं।',
  set_bio_label: 'फ़िंगरप्रिंट अनलॉक',
  set_bio_help: 'PIN के साथ फ़िंगरप्रिंट से भी प्रवेश करें (सक्रिय PIN आवश्यक है)।',
  bio_btn: '👆 फ़िंगरप्रिंट से प्रवेश करें',
  bio_reason: 'PETO Finanzas खोलने के लिए पुष्टि करें कि यह आप ही हैं',
  bio_need_pin: 'फ़िंगरप्रिंट अनलॉक के लिए सक्रिय PIN चाहिए: सेटिंग → सुरक्षा में अपना PIN बनाएँ, फिर ऐप खोलते समय फ़िंगरप्रिंट काम करेगा।',
  bio_failed: 'फ़िंगरप्रिंट सत्यापित नहीं हो सका। अपना PIN लिखें।',
  bio_unavailable: 'इस फ़ोन पर फ़िंगरप्रिंट उपलब्ध नहीं है। अपना PIN लिखें।',
  bio_not_enrolled: 'इस फ़ोन में कोई फ़िंगरप्रिंट दर्ज नहीं है। फ़ोन की सेटिंग में दर्ज करें या अपना PIN लिखें।',
  bio_offer_title: 'फ़िंगरप्रिंट से अनलॉक करें?',
  bio_offer_text: 'आपने अभी अपना PIN बनाया है। चाहें तो हर बार PIN लिखने के बजाय फ़िंगरप्रिंट से PETO Finanzas खोल सकते हैं। अभी चालू करें?',
  bio_offer_yes: 'हाँ, फ़िंगरप्रिंट चालू करें',
  bio_offer_no: 'अभी नहीं',
  bio_activated: 'हो गया: फ़िंगरप्रिंट अनलॉक अब चालू है।',
  fix_auto_suffix: '(स्वचालित निश्चित भुगतान)',
  backup_pass_label: 'एन्क्रिप्ट किए बैकअप का पासवर्ड',
  backup_pass_ph: 'कम से कम 4 अक्षर',
  data_export_enc: 'एन्क्रिप्ट किया बैकअप निर्यात करें',
  backup_help: 'एन्क्रिप्ट किया बैकअप केवल आपके पासवर्ड से खुलता है। उसके बिना इसे वापस नहीं पाया जा सकता: इसे संभालकर रखें। एन्क्रिप्ट किया बैकअप आयात करने के लिए, फ़ाइल चुनने से पहले उसका पासवर्ड यहाँ लिखें।',
  backup_err_short: 'पासवर्ड में कम से कम 4 अक्षर होने चाहिए।',
  backup_need_pass: 'एन्क्रिप्ट किया बैकअप आयात करने से पहले उसका पासवर्ड लिखें।',
  backup_err_pass: 'बैकअप नहीं खुल सका: गलत पासवर्ड या क्षतिग्रस्त फ़ाइल।',
  share_btn: 'सारांश साझा करें',
  share_copied: 'सारांश कॉपी हो गया। कहीं भी चिपकाएँ।',
  review_title: 'क्या आपको PETO Finanzas पसंद है?',
  review_text: 'अगर PETO Finanzas आपके पैसे की देखभाल में मदद करता है, तो Google Play पर समीक्षा हमें ज़्यादा लोगों तक पहुँचने में बहुत मदद करेगी। धन्यवाद!',
  review_yes: '⭐ Google Play पर रेट करें',
  review_no: 'अभी नहीं',
  share_report_title: 'मेरा PETO Finanzas सारांश',
  notif_fixed_title: 'कल निश्चित भुगतान',
  notif_fixed_today: 'आज निश्चित भुगतान',
  notif_fixed_body: '{name} · {amount}',
  notif_weekly_title: 'PETO Finanzas में आपका सप्ताह',
  notif_weekly_body: 'इस सप्ताह के खर्च और आय दर्ज करें ताकि हिसाब बना रहे।',
  summary_title: 'दैनिक सारांश',
  summary_help: 'आपके चुने समय पर, कल आपने कितना खर्च किया और आज कितना खर्च कर सकते हैं, इसकी सूचना।',
  summary_notif_label: 'सूचना द्वारा सारांश',
  summary_time_label: 'सारांश का समय',
  summary_email_label: 'ईमेल से भी प्राप्त करें',
  summary_email_help: 'केवल आपका क्लाउड खाता सक्रिय होने पर: वही सारांश आपके ईमेल पर भी आता है।',
  notif_summary_title: '🌅 आपका PETO Finanzas सारांश',
  notif_summary_body: 'कल आपने {spent} खर्च किए · आज आप {daily} खर्च कर सकते हैं',
  notif_summary_body_nodaily: 'कल आपने {spent} खर्च किए',
  sec_remesas: 'प्रेषण',
  key_remesas: 'इस माह भेजा: {amount}',
  rem_intro: 'आप अपने लोगों को जो पैसे भेजते हैं: डॉलर में कितने गए और उनकी मुद्रा में कितने पहुँचे।',
  rem_usd_label: 'भेजी राशि ($ USD)',
  rem_rate_label: 'दर ($1 पर {cur})',
  rem_recipient_label: 'किसके लिए?',
  rem_currency_label: 'गंतव्य मुद्रा',
  rem_arrives_label: 'पहुँचता है',
  rem_rate_suggested: '{cur} के लिए आपकी पिछली दर: {rate}। यह भरी हुई है; आज की दर अलग हो तो बदल दें।',
  rem_month_sent: 'इस माह आपने {usd} भेजे',
  rem_totals_title: 'मुद्रा अनुसार कुल (पूरा इतिहास)',
  rem_total_row: '{usd} भेजे → {amount} मिले · {n} बार',
  rem_save: 'प्रेषण सहेजें',
  rem_empty: 'अभी तक कोई प्रेषण दर्ज नहीं है।',
  rem_delete_confirm: '{name} के लिए भेजी राशि हटाएँ?',
  csv_title: 'बैंक स्टेटमेंट आयात करें (CSV)',
  csv_help: 'अपने बैंक की CSV फ़ाइल अपलोड करें और आयात से पहले पूर्वावलोकन में सब कुछ देखें: जब तक आप पुष्टि नहीं करते, कुछ भी सहेजा नहीं जाता।',
  csv_file_label: 'बैंक की CSV फ़ाइल',
  csv_preview_title: 'आयात का पूर्वावलोकन',
  csv_summary: '{total} लेन-देन · {dups} दोहरे (छोड़े गए) · {sel} आयात के लिए',
  csv_dup_badge: 'दोहरा',
  csv_income_badge: 'आय',
  csv_expense_badge: 'खर्च',
  csv_all: 'सभी चुनें',
  csv_none: 'सभी अचयनित करें',
  csv_apply: 'चुने हुए आयात करें',
  csv_cancel: 'आयात रद्द करें',
  csv_done: '{n} लेन-देन आयात हुए। ✅',
  csv_none_selected: 'आपने आयात के लिए कोई लेन-देन नहीं चुना।',
  csv_err_parse: 'उस फ़ाइल को CSV की तरह नहीं पढ़ा जा सका। जाँचें कि यह बैंक स्टेटमेंट का CSV प्रारूप है।',
  csv_err_headers: 'उस फ़ाइल में तारीख और राशि के कॉलम नहीं मिले।',
  csv_err_big: 'वह फ़ाइल आयात करने के लिए बहुत बड़ी है।',
  csv_err_empty: 'उस फ़ाइल में आयात योग्य कोई लेन-देन नहीं है।',
  pdf_err_big: 'वह PDF बहुत बड़ा है (अधिकतम 8 MB)।',
  pdf_err_notext: 'उस PDF में पढ़ा जा सकने वाला टेक्स्ट नहीं है (यह फ़ोटो या स्कैन लगता है)। बैंक का CSV आज़माएँ या रसीद की फ़ोटो से खर्च दर्ज करें।',
  pdf_err_empty: 'मुझे उस PDF में तारीख और राशि वाला कोई लेन-देन नहीं मिला। बैंक का CSV आज़माएँ।',
  shared_title: 'साझा बजट',
  shared_preview_note: '🔧 डिज़ाइन पूर्वावलोकन: यह अभी अन्य खातों से नहीं जुड़ता। इसका उपयोग यह आज़माने के लिए करें कि घर बनाना, कोड से जुड़ना और सदस्यों को देखना कैसा दिखेगा।',
  shared_create_label: 'घर का नाम',
  shared_create_btn: 'घर बनाएँ',
  shared_join_label: 'आमंत्रण कोड',
  shared_join_btn: 'कोड से जुड़ें',
  shared_members_title: 'सदस्य',
  shared_code_label: 'आमंत्रण कोड: {code}',
  shared_role_dueno: 'मालिक',
  shared_role_admin: 'प्रशासक',
  shared_role_miembro: 'सदस्य',
  shared_role_lector: 'केवल पढ़ने के लिए',
  shared_you: 'आप',
  shared_host: 'मेज़बान',
  shared_leave_btn: 'घर छोड़ें',
  shared_leave_confirm: 'यह घर छोड़ें? (पूर्वावलोकन)',
  shared_err_name: 'घर का नाम लिखें।',
  shared_err_code: 'कोड में 6 अक्षर या अंक होते हैं।',
  shared_created: 'घर बन गया (पूर्वावलोकन)। ✅',
  shared_joined: 'आप घर से जुड़ गए (पूर्वावलोकन)। ✅',
  shared_household_fallback: 'साझा घर',
  privacy_hide: 'राशियाँ छिपाएँ',
  privacy_show: 'राशियाँ दिखाएँ',
  ins_title: '💡 आपके पैसों पर विचार',
  ins_cat_up: '{cat} पिछले माह की तुलना में {pct}% बढ़ा ({from} → {to})।',
  ins_pace_down: 'आपकी गति बेहतर हो रही है: खर्च पिछले माह की तुलना में {pct}% घटा।',
  ins_pace_up: 'ध्यान दें: आपकी खर्च की गति पिछले माह की तुलना में {pct}% बढ़ी।',
  ins_biggest: 'इस माह आपका सबसे बड़ा खर्च: {note} · {amount}।',
  ins_saved: 'आपने इस माह {amount} बचाए। ऐसे ही चलते रहें!',
  bud_alert_title: 'बजट खतरे में',
  bud_alert_warn: '{cat}: आप बजट के {pct}% पर हैं।',
  bud_alert_over: '{cat}: आप बजट से आगे निकल गए ({pct}%)।',
  voice_btn: '🎤 बोलकर लिखें',
  voice_listening: 'सुन रहा हूँ… राशि और किस लिए था, बोलें।',
  voice_unavailable: 'इस डिवाइस पर आवाज़ उपलब्ध नहीं है।',
  voice_heard: 'मैंने सुना: “{text}”। जाँचकर सहेजें।',
  voice_no_amount: 'मैंने सुना: “{text}”, लेकिन राशि नहीं मिली।',
  ocr_found: 'मुझे रसीद पर {amount} मिला। सहेजने से पहले जाँच लें।',
  goals_title: 'और लक्ष्य',
  goal2_create: 'लक्ष्य बनाएँ',
  goal_add: '+ जोड़ें',
  goal_take: '− निकालें',
  goal_done: '🎉 लक्ष्य पूरा!',
  goal_move_label: 'राशि',
  goal_delete_confirm: 'लक्ष्य "{name}" हटाएँ? आपकी बचत को कुछ नहीं होगा: केवल लक्ष्य हटेगा।',
  err_limit_goals: 'आपके पास पहले से ही अधिकतम लक्ष्य हैं।',
  biz_label: 'यह मेरे व्यवसाय के लिए है',
  biz_title: 'इस माह मेरा व्यवसाय',
  biz_income: 'व्यवसाय की आय',
  biz_expenses: 'व्यवसाय के खर्च',
  biz_profit: 'लाभ',
  chal_share: 'मेरी चुनौती साझा करें',
  cloud_title: 'क्लाउड खाता',
  cloud_help: 'खाते के साथ आपका डेटा क्लाउड में भी रहता है और सिंक होता है: फ़ोन बदलें, अपने ईमेल से साइन इन करें, और सब कुछ वहीं मिलेगा। बिना खाते के ऐप केवल इस फ़ोन पर काम करता है, हमेशा की तरह।',
  cloud_email: 'ईमेल',
  cloud_pass: 'पासवर्ड',
  cloud_signin: 'साइन इन',
  cloud_signup: 'खाता बनाएँ',
  cloud_signout: 'साइन आउट',
  cloud_sync_now: 'अभी सिंक करें',
  cloud_wipe: 'मेरा क्लाउड डेटा हटाएँ',
  cloud_who: '{email} के रूप में साइन इन',
  cloud_synced: 'सिंक हुआ ✓ · {time}',
  cloud_never: 'अभी तक सिंक नहीं हुआ।',
  cloud_working: 'काम चल रहा है…',
  cloud_ok_in: 'फिर से स्वागत है!',
  cloud_ok_up: 'खाता बन गया! आपका डेटा अब क्लाउड में है।',
  cloud_err_fields: 'अपना ईमेल और कम से कम 6 अक्षरों का पासवर्ड लिखें।',
  cloud_err_login: 'साइन इन नहीं हो सका। अपना ईमेल और पासवर्ड जाँचें।',
  cloud_err_exists: 'उस ईमेल पर पहले से खाता है। «साइन इन» का उपयोग करें।',
  cloud_err_confirm: 'खाता बन गया। अपना खाता पुष्ट करने के लिए ईमेल देखें, फिर साइन इन करें।',
  cloud_err_generic: 'क्लाउड में कुछ गड़बड़ हुई। अपना इंटरनेट जाँचकर फिर कोशिश करें।',
  cloud_conflict: 'क्लाउड और इस फ़ोन में अलग-अलग डेटा है। क्लाउड का डेटा डाउनलोड करके इस फ़ोन के डेटा से बदलें? (रद्द = इस फ़ोन का डेटा अपलोड करें)',
  cloud_wipe_confirm: 'क्लाउड में आपका सारा डेटा हटाएँ? इस फ़ोन पर जो है, वह वैसा ही रहेगा।',
  cloud_delete: 'मेरा खाता हटाएँ',
  cloud_delete_confirm1: 'अपना PETO Finanzas खाता हटाएँ? इससे आपका खाता, क्लाउड में आपके डेटा की प्रति और आपके स्वामित्व वाले साझा घर हट जाएँगे। इस फ़ोन का डेटा यहीं, अछूता रहेगा (आप सेटिंग में उसे मिटा सकते हैं)। यह वापस नहीं हो सकता।',
  cloud_delete_confirm2: 'अंतिम पुष्टि: अपना खाता हमेशा के लिए हटाएँ?',
  cloud_deleted: 'आपका खाता हटा दिया गया।',
  cloud_delete_err_auth: 'आपका सत्र अब मान्य नहीं है। फिर से साइन इन करके कोशिश करें।',
  cloud_unavailable: 'इस संस्करण में क्लाउड उपलब्ध नहीं है।',
  key_settings: 'नाम, बँटवारा, अक्षर, अनुभाग, PIN',
  footer: 'PETO Finanzas · ऑफ़लाइन काम करता है · क्लाउड वैकल्पिक है: आपका डेटा, आपका फ़ैसला',
  tile_available: 'उपलब्ध पैसे',
  tile_available_aria: 'उपलब्ध पैसे: मेरे खातों पर जाएँ',
  tile_savings: 'इस माह की बचत',
  tile_savings_aria: 'इस माह की बचत: बचत पर जाएँ',
  tile_debts: 'बाकी कर्ज़',
  tile_debts_aria: 'बाकी कर्ज़: मेरे कर्ज़ पर जाएँ',
  tile_incomes: '💵 आय',
  tile_incomes_aria: 'आय: साप्ताहिक आय पर जाएँ',
  tile_expenses: '🧾 खर्च',
  tile_expenses_aria: 'खर्च: माह के खर्च पर जाएँ',
  tile_goal: 'लक्ष्य \'{name}\': {pct}%',
  key_spent_month: 'इस माह {amount} खर्च',
  key_income_month: 'इस माह {amount} मिले',
  key_saved_total: 'कुल {amount} बचाए',
  key_goal_suffix: ' · लक्ष्य \'{name}\': {pct}%',
  key_budget_one: '{n} श्रेणी पर सीमा',
  key_budget_many: '{n} श्रेणियों पर सीमा',
  key_fixed: '{amount} प्रति माह · {n} देने हैं',
  key_available: 'उपलब्ध: {amount}',
  key_debts: '{amount} बाकी',
  key_san: 'सप्ताह {x} / {n} · अगली बारी: {name}',
  key_san_done: 'San पूरा हुआ 🎉',
  key_san_none: 'कोई सक्रिय san नहीं',
  banner_payday: 'आज वेतन का दिन है: अपनी आय और बचत दर्ज करें।',
  banner_dues_title: 'जल्द आने वाले भुगतान:',
  banner_due_item: '{name} (दिन {day})',
  banner_close: 'बंद करें',
  spend_title: 'आज आप कितना खर्च कर सकते हैं?',
  spend_note: 'आज आप बिना सीमा पार किए इतना खर्च कर सकते हैं।',
  spend_guide: 'अपनी पहली श्रेणी का बजट बनाएँ और आप यहाँ देखेंगे कि रोज़ कितना खर्च कर सकते हैं।',
  spend_left: 'माह के बचे {days} दिनों के लिए आपके पास {amount} बचे हैं।',
  spend_left_one: 'आज, माह के आखिरी दिन के लिए आपके पास {amount} बचे हैं।',
  spend_over: 'आप इस माह के बजट तक पहुँच गए हैं।',
  spend_over_by: 'आप {amount} ज़्यादा खर्च कर चुके हैं।',
  cat_Renta: 'किराया',
  cat_Comida: 'खाना',
  "cat_Comida fuera": 'बाहर खाना',
  cat_Gasolina: 'पेट्रोल',
  cat_Transporte: 'यातायात',
  cat_Salud: 'स्वास्थ्य',
  cat_Ropa: 'कपड़े',
  cat_Otros: 'अन्य',
  btn_cancel: 'रद्द करें',
  btn_save: 'सहेजें',
  btn_edit: 'संपादित करें',
  btn_delete: 'हटाएँ',
  err_amount: 'मान्य राशि लिखें, $0 से अधिक।',
  err_amount_generic: 'मान्य राशि लिखें।',
  err_name: 'नाम लिखें।',
  chip_paid: 'दिया गया',
  chip_pending: 'बाकी',
  month_prev_aria: 'पिछला माह',
  month_next_aria: 'अगला माह',
  exp_new: 'नया खर्च',
  exp_edit: 'खर्च संपादित करें',
  exp_total_label: 'माह का कुल:',
  amount_label: 'राशि ($)',
  category_label: 'श्रेणी',
  date_label: 'तारीख',
  note_label: 'टिप्पणी (वैकल्पिक)',
  exp_note_ph: 'यह किस लिए था?',
  exp_save: 'खर्च सहेजें',
  exp_empty: 'इस माह अभी कोई खर्च नहीं।\nऊपर के फ़ॉर्म से पहला जोड़ें। 👍',
  exp_delete_confirm: '{amount} का यह खर्च हटाएँ? श्रेणी {cat}, {date} को। केवल यही खर्च हटेगा।',
  err_category: 'मान्य श्रेणी चुनें।',
  err_limit_expenses: 'आप सहेजे गए खर्चों की सीमा तक पहुँच गए।',
  inc_intro: 'बचत कभी स्वचालित नहीं होती: आप लिखते हैं कि हर आय से आपने सच में कितना बचाया। ऐप केवल आपकी सेटिंग प्रतिशत के आधार पर राशि सुझाता है।',
  inc_new: 'नई आय',
  inc_edit: 'आय संपादित करें',
  inc_note_ph: 'यह कहाँ से आई?',
  inc_savings_label: 'बचत ($)',
  inc_savings_label_sug: 'बचत (सुझाई: {amount})',
  inc_savings_help: 'आपके बचत प्रतिशत पर आधारित सुझाव — इसे उससे बदलें जो आपने सच में बचाया। आप $0 लिख सकते हैं।',
  inc_split_line: 'बचाया: {sav} · सुझाव: व्यवसाय {biz} · खर्च {exp} · परिवार {fam}',
  inc_split_preview: 'सुझाया बँटवारा: बचत {sav} · व्यवसाय {biz} · खर्च {exp} · परिवार {fam}। जो बचत गिनी जाती है वह वही है जो आप नीचे लिखते हैं।',
  inc_save: 'आय सहेजें',
  inc_empty: 'अभी कोई आय दर्ज नहीं।\nअपनी पहली आय जोड़ें और लिखें कि आपने उसमें से कितना बचाया। 💪',
  inc_delete_confirm: '{date} की {amount} की यह आय हटाएँ? इसके दर्ज {savings} की बचत भी हट जाएगी।',
  err_inc_savings: 'इस आय से आपने कितना बचाया, लिखें ($0 भी हो सकता है)।',
  err_limit_incomes: 'आप सहेजी गई आय की सीमा तक पहुँच गए।',
  sav_intro_1: 'यहाँ आप अपनी बचाई हर राशि एक-एक करके देखते हैं। आप अलग से एक बचत भी जोड़ सकते हैं,',
  sav_intro_2: 'जो किसी आय से जुड़ी न हो',
  sav_intro_3: ', नीचे के फ़ॉर्म से। अगर आप कोई बचत हटाते हैं, तो केवल वही राशि हटती है:',
  sav_intro_4: 'आय वैसी ही रहती है',
  sav_intro_5: '।',
  sav_total_label: 'कुल बचाया:',
  sav_month_label: 'इस माह बचाया:',
  sav_form_title: 'बचत जोड़ें',
  sav_note_ph: 'यह बचत किस लिए है?',
  sav_save: 'बचत सहेजें',
  sav_goal_label: 'लक्ष्य को सौंपें (वैकल्पिक)',
  sav_goal_none: 'कोई लक्ष्य नहीं · सामान्य बचत',
  sav_empty: 'अभी कोई बचत दर्ज नहीं।\nऊपर के फ़ॉर्म से एक जोड़ें, या आय दर्ज करते समय उसकी बचत दर्ज करें और वह यहाँ दिखेगी। 🌱',
  sav_from_title: '{date} की बचत',
  sav_from_sub: '{amount} की आय से',
  sav_manual_title: 'जोड़ी गई बचत',
  sav_manual_sub: 'हाथ से · {date} को जोड़ी',
  sav_delete_income_confirm: '{date} की {amount} की यह बचत हटाएँ? केवल यह बचत राशि हटेगी: {income} की आय वैसी ही रहेगी।',
  sav_delete_manual_confirm: '{date} की {amount} की यह बचत हटाएँ? यह वह बचत है जो आपने बचत में हाथ से जोड़ी थी; केवल यही प्रविष्टि हटेगी।',
  err_limit_savings: 'आप सहेजी गई बचत की सीमा तक पहुँच गए।',
  goal_prompt: 'आप किस लिए बचा रहे हैं?',
  goal_prompt_sub: 'लक्ष्य बनाएँ और देखें कि आपकी बचत उसके करीब कैसे पहुँचती है।',
  goal_form_create: 'लक्ष्य बनाएँ',
  goal_form_edit: 'लक्ष्य संपादित करें',
  goal_name_label: 'लक्ष्य का नाम',
  goal_name_ph: 'जैसे: आपातकालीन निधि',
  goal_target_label: 'लक्ष्य राशि ($)',
  goal_create_btn: 'लक्ष्य बनाएँ',
  goal_save_btn: 'लक्ष्य सहेजें',
  goal_progress: 'आपने {target} में से {have} बचाए',
  goal_remaining: '{amount} बाकी',
  goal_edit: 'लक्ष्य संपादित करें',
  goal_delete: 'लक्ष्य हटाएँ',
  err_goal_name: 'अपने लक्ष्य का नाम लिखें।',
  res_cats_title: 'श्रेणी अनुसार खर्च',
  res_summary_title: 'आय बनाम खर्च बनाम बचत',
  chart_income: 'आय',
  chart_expenses: 'खर्च',
  chart_savings: 'बचत',
  res_cats_empty: 'इस माह कोई खर्च नहीं।',
  res_summary_empty: 'इस माह अभी कोई गतिविधि नहीं।',
  bud_intro: 'प्रत्येक श्रेणी के लिए मासिक सीमा तय करें और देखें कि आपने कितना खर्च किया।',
  bud_spent_left: '{budget} में से {spent} खर्च · {left} बचे',
  bud_spent_over: '{budget} में से {spent} खर्च · {over} ज़्यादा',
  bud_nolimit: 'कोई सीमा नहीं। इस माह खर्च: {spent}',
  bud_placeholder: 'मासिक सीमा $',
  bud_aria: '{cat} के लिए मासिक सीमा',
  bud_delete_cat: 'श्रेणी हटाएँ',
  bud_delete_cat_confirm: 'श्रेणी "{cat}" हटाएँ? इसका उपयोग करने वाले खर्च "{other}" में चले जाएँगे।',
  bud_alert_amount: 'सीमा के लिए मान्य राशि लिखें।',
  cat_form_title: 'अपनी श्रेणी',
  cat_name_label: 'श्रेणी का नाम',
  cat_name_ph: 'जैसे: पालतू',
  cat_save: 'श्रेणी जोड़ें',
  err_cat_name: 'श्रेणी का नाम लिखें।',
  err_cat_exists: 'वह श्रेणी पहले से है।',
  fix_intro: 'हर माह दोहराए जाने वाले भुगतान: किराया, फ़ोन, सदस्यताएँ…',
  fix_new: 'नया निश्चित भुगतान',
  fix_edit: 'निश्चित भुगतान संपादित करें',
  fix_name_ph: 'जैसे: किराया',
  fix_day_label: 'माह का दिन',
  fix_save: 'निश्चित भुगतान सहेजें',
  fix_empty: 'अभी कोई निश्चित भुगतान नहीं।',
  fix_sub: 'हर माह का दिन {day} · {month}',
  fix_mark: 'दिया हुआ चिह्नित करें',
  fix_unmark: 'चिह्न हटाएँ',
  fix_delete_confirm: 'निश्चित भुगतान "{name}" हटाएँ?',
  err_day: 'दिन 1 से 31 के बीच होना चाहिए।',
  err_limit_fixed: 'आप निश्चित भुगतानों की सीमा तक पहुँच गए।',
  acc_new: 'नया खाता',
  acc_edit: 'खाता संपादित करें',
  acc_balance_label: 'शेष ($)',
  acc_name_ph: 'जैसे: नकद, बैंक, बचत',
  acc_save: 'खाता सहेजें',
  acc_empty: 'अभी कोई खाता नहीं है।\nएक जोड़ें ताकि सारांश में अपने उपलब्ध पैसे देख सकें।',
  acc_delete_confirm: 'खाता "{name}" हटाएँ?',
  err_balance: 'मान्य शेष लिखें।',
  err_limit_accounts: 'आप खातों की सीमा तक पहुँच गए।',
  debt_new: 'नया कर्ज़',
  debt_edit: 'कर्ज़ संपादित करें',
  debt_name_ph: 'जैसे: कार्ड, ऋण',
  debt_status_label: 'स्थिति',
  debt_status_pending: 'बाकी',
  debt_status_paid: 'दिया गया',
  debt_save: 'कर्ज़ सहेजें',
  debt_empty: 'कोई कर्ज़ दर्ज नहीं। 🎉',
  debt_mark_paid: 'दिया हुआ चिह्नित करें',
  debt_mark_pending: 'बाकी चिह्नित करें',
  debt_delete_confirm: 'कर्ज़ "{name}" हटाएँ?',
  err_limit_debts: 'आप कर्ज़ों की सीमा तक पहुँच गए।',
  name_label: 'नाम',
  san_intro: 'San (tanda) एक बचत मंडल है: हर सप्ताह सभी योगदान देते हैं और बारी-बारी से एक व्यक्ति कुल राशि पाता है।',
  san_form_title: 'San बनाएँ',
  san_name_label: 'San का नाम',
  san_name_ph: 'जैसे: पारिवारिक san',
  san_aporte_label: 'प्रति बारी योगदान ($)',
  san_participants_label: 'प्रतिभागी (बारी के क्रम में)',
  san_pname_ph: 'प्रतिभागी का नाम',
  san_add_participant: 'जोड़ें',
  san_create_btn: 'San बनाएँ',
  san_err_participants: 'कम से कम 2 प्रतिभागी जोड़ें।',
  san_err_active_exists: 'पहले से एक san चल रहा है ("{name}")। नया बनाने के लिए पहले उसे हटाएँ।',
  san_err_dup: 'वह प्रतिभागी पहले से सूची में है।',
  san_err_pname: 'प्रतिभागी का नाम लिखें।',
  san_remove: 'हटाएँ',
  san_draft_empty: 'अभी कोई प्रतिभागी नहीं जोड़ा गया।',
  san_week: 'सप्ताह {x} / {n}',
  san_finished: '🎉 San पूरा हुआ!',
  san_finished_note: 'सभी सप्ताह पूरे हो गए। आप इस san को हटाकर नया बना सकते हैं।',
  san_total_line: 'कुल जमा: {amount}',
  san_week_collected: 'इस सप्ताह जमा: {target} में से {amount}',
  san_receiver_line: 'अगली बारी: {name}',
  san_aporte_line: 'प्रति बारी योगदान: {amount}',
  san_paid_title: 'इस सप्ताह किसने दे दिया है?',
  san_paid: 'दिया',
  san_advance: 'सप्ताह पूरा चिह्नित करें',
  san_delete: 'San हटाएँ',
  san_delete_confirm: 'San "{name}" हटाएँ? इसके सप्ताह और भुगतान के रिकॉर्ड हट जाएँगे।',
  san_new_btn: 'नया san बनाएँ',
  san_new_confirm: 'वर्तमान san पूरा हो गया है। उसे हटाकर नया बनाएँ?',
  set_profile: 'आपकी प्रोफ़ाइल',
  set_name_label: 'आपका नाम',
  set_textsize_label: 'अक्षरों का आकार',
  textsize_normal: 'सामान्य',
  textsize_large: 'बड़ा',
  set_lang_label: 'भाषा / Language',
  set_reminders_title: 'अनुस्मारक',
  set_payday_label: 'वेतन का दिन',
  set_reminders_label: 'होम पर अनुस्मारक',
  wd_none: 'कोई वेतन-दिन नहीं',
  wd_0: 'रविवार',
  wd_1: 'सोमवार',
  wd_2: 'मंगलवार',
  wd_3: 'बुधवार',
  wd_4: 'गुरुवार',
  wd_5: 'शुक्रवार',
  wd_6: 'शनिवार',
  set_split_title: 'सुझाया आय बँटवारा (%)',
  set_split_help: 'चारों संख्याओं का योग 100 होना चाहिए। ये प्रतिशत आपकी आय बाँटने का केवल सुझाव हैं: बचत कभी स्वचालित रूप से नहीं सहेजी जाती — आप हमेशा लिखते हैं कि हर आय से आपने सच में कितना बचाया।',
  split_ahorro: 'बचत',
  split_negocio: 'व्यवसाय',
  split_gastos: 'खर्च',
  split_familia: 'परिवार',
  set_save: 'सेटिंग सहेजें',
  set_err_sum: 'प्रतिशतों का योग 100 होना चाहिए। अभी योग {total} है।',
  set_saved: 'सेटिंग सहेजी गई। ✅',
  set_sections_title: 'दिखने वाले अनुभाग',
  set_sections_help: 'जिनका उपयोग नहीं करते उन्हें बंद करें ताकि सूची छोटी रहे।',
  set_pin_title: 'सुरक्षा (PIN)',
  pin_status_on: 'आपके पास सक्रिय PIN है। ऐप खुलते समय लॉक होता है।',
  pin_status_off: 'आपके पास PIN नहीं है। अपने डेटा की रक्षा के लिए यहाँ एक बना सकते हैं।',
  pin_current_label: 'वर्तमान PIN (यदि है)',
  pin_new_label: 'नया PIN (खाली = PIN हटाएँ)',
  pin_update: 'PIN बदलें',
  pin_err_current: 'वर्तमान PIN सही नहीं है।',
  pin_err_format: 'नया PIN 4 से 6 अंकों का होना चाहिए।',
  pin_off: 'PIN बंद हो गया।',
  pin_updated: 'PIN बदल गया। ✅',
  set_data_title: 'आपका डेटा',
  set_data_help: 'सब कुछ केवल इस फ़ोन पर रहता है। कहीं और रखना चाहें तो बैकअप निर्यात करें।',
  data_export: 'बैकअप निर्यात करें (JSON)',
  data_import: 'बैकअप आयात करें',
  data_reset: 'सारा डेटा हटाएँ',
  data_err_big: 'वह फ़ाइल बहुत बड़ी है।',
  data_err_invalid: 'आयात नहीं हो सका: वह फ़ाइल मान्य PETO Finanzas बैकअप नहीं है।',
  import_confirm: 'आयात करने से ऐप का सारा वर्तमान डेटा बदल जाएगा। क्या आप निश्चित हैं?',
  import_done: 'बैकअप आयात हुआ। ✅',
  reset_confirm1: 'इससे इस फ़ोन पर आपके ऐप का सारा डेटा हट जाएगा। यह वापस नहीं हो सकता। क्या आप निश्चित हैं?',
  reset_confirm2: 'अंतिम पुष्टि: सब कुछ हटाकर नए सिरे से शुरू करें?',
  lock_prompt: 'जारी रखने के लिए अपना PIN लिखें।',
  lock_pin_label: 'PIN',
  lock_enter: 'अनलॉक करें',
  lock_note: 'आपका डेटा केवल इस फ़ोन पर रहता है।',
  lock_err: 'गलत PIN। फिर से कोशिश करें।',
  ob_title: 'PETO Finanzas में आपका स्वागत है!',
  ob_intro_1: 'मिनटों में अपने पैसे व्यवस्थित करें: खर्च, आय, बजट, खाते और कर्ज़।',
  ob_intro_2: 'कोई खाता नहीं, कोई इंटरनेट नहीं।',
  ob_intro_3: 'सब कुछ केवल आपके फ़ोन पर रहता है।',
  ob_name_label: 'आपका नाम क्या है?',
  ob_name_ph: 'आपका नाम',
  ob_pin_label: 'सुरक्षा PIN बनाएँ (वैकल्पिक)',
  ob_pin_ph: '4 से 6 अंक, या खाली छोड़ें',
  ob_pin2_label: 'PIN दोहराएँ',
  ob_pin2_ph: 'PIN दोहराएँ',
  ob_start: 'शुरू करें',
  ob_note: 'आप सेटिंग में कभी भी PIN बदल सकते हैं।',
  ob_tour1_title: 'सेकंडों में खर्च दर्ज करें',
  ob_tour1_text: '+ बटन दबाएँ, राशि और श्रेणी लिखें। बस इतना ही: आपका खर्च तुरंत सहेजा जाता है।',
  ob_tour2_title: 'आज आप कितना खर्च कर सकते हैं?',
  ob_tour2_text: 'PETO Finanzas आपके बजट को माह के बचे दिनों में बाँटता है और आपको एक ही संख्या बताता है: आज बिना सीमा पार किए आप कितना खर्च कर सकते हैं।',
  ob_tour3_title: 'आपका क्लाउड खाता (वैकल्पिक)',
  ob_tour3_text: 'चाहें तो मुफ़्त खाता बनाएँ ताकि वेब पर भी अपना डेटा देख सकें। बिना खाते के सब कुछ केवल आपके फ़ोन पर रहता है।',
  ob_tour_next: 'आगे',
  ob_tour_skip: 'छोड़ें',
  ob_tour_go: 'चलें!',
  ob_err_name: 'शुरू करने के लिए अपना नाम लिखें।',
  ob_err_pin_format: 'PIN 4 से 6 अंकों का होना चाहिए।',
  ob_err_pin_mismatch: 'दोनों PIN मेल नहीं खाते।',
  set_theme_label: 'थीम',
  theme_light: 'हल्का',
  theme_dark: 'गहरा',
  theme_auto: 'स्वचालित (सिस्टम)',
  set_accent_label: 'मुख्य रंग',
  accent_verde: 'हरा',
  accent_azul: 'नीला',
  accent_morado: 'बैंगनी',
  accent_naranja: 'नारंगी',
  undo_done: 'हो गया',
  undo_btn: 'वापस लें',
  btn_repeat: 'दोहराएँ',
  fab_aria: 'जल्दी जोड़ें',
  quick_title: 'आप क्या जोड़ना चाहते हैं?',
  quick_expense: '🧾 खर्च',
  quick_income: '💵 आय',
  quick_savings: '🐷 बचत',
  sec_buscar: 'गतिविधि खोजें',
  search_label: 'खोजें',
  search_ph: 'टिप्पणी, श्रेणी या राशि…',
  search_month_label: 'माह (खाली = सभी)',
  search_type_label: 'प्रकार',
  type_all: 'सभी',
  type_gastos: 'खर्च',
  type_ingresos: 'आय',
  type_ahorros: 'बचत',
  search_empty: 'कोई परिणाम नहीं।',
  search_type_income: 'आय',
  search_type_saving: 'बचत',
  chal_title: '🔥 साप्ताहिक बचत चुनौती',
  chal_progress: 'इस सप्ताह: {target} में से {have}',
  chal_done: '🎉 इस सप्ताह की चुनौती पूरी हो गई!',
  chal_streak_one: 'सिलसिला: 1 सप्ताह पूरा',
  chal_streak_many: 'सिलसिला: {n} सप्ताह पूरे',
  chal_streak_zero: 'सिलसिला: 0 सप्ताह. यह पहला हो सकता है!',
  streak_one: '🔥 लगातार 1 दिन दर्ज',
  streak_many: '🔥 लगातार {n} दिन दर्ज',
  chal_target_label: 'साप्ताहिक बचत लक्ष्य ($)',
  chal_save: 'साप्ताहिक लक्ष्य सहेजें',
  rep_title: 'मासिक रिपोर्ट',
  rep_download: 'छवि डाउनलोड करें',
  rep_share_image: 'छवि साझा करें',
  trend_title: 'खर्च की प्रवृत्ति',
  trend_weeks: 'इस माह के सप्ताह',
  trend_week: 'सप्ताह {n}',
  trend_empty: 'प्रवृत्ति दिखाने के लिए अभी कोई खर्च नहीं।',
  rep_income: 'आय',
  rep_expenses: 'खर्च',
  rep_savings: 'बचत',
  rep_top_cat: 'शीर्ष श्रेणी',
  rep_top3: 'शीर्ष 3 श्रेणियाँ',
  rep_goal: 'बचत लक्ष्य',
  rep_none: 'कोई गतिविधि नहीं',
  calc_title: 'कर्ज़ चुकाने का कैलकुलेटर',
  calc_intro: 'कर्ज़ से बाहर निकलने की दो योजनाओं की तुलना करें: सबसे छोटा पहले चुकाएँ (स्नोबॉल) या सबसे अधिक ब्याज वाला पहले (हिमस्खलन)। हर माह आप सभी न्यूनतम चुकाते हैं और बाकी लक्षित कर्ज़ में जाता है।',
  calc_budget_label: 'आप कर्ज़ों के लिए प्रति माह कुल कितना दे सकते हैं? ($)',
  calc_run: 'गणना करें',
  calc_snowball: 'स्नोबॉल (सबसे छोटा शेष पहले)',
  calc_avalanche: 'हिमस्खलन (सबसे अधिक ब्याज पहले)',
  calc_result: 'कर्ज़-मुक्त होने में {months} माह · लगभग ब्याज {interest}',
  calc_months_one: 'कर्ज़-मुक्त होने में 1 माह · लगभग ब्याज {interest}',
  calc_order: 'चुकाने का क्रम:',
  calc_free: 'आपके पास कोई बाकी कर्ज़ नहीं है! 🎉',
  calc_warn: 'उस मासिक भुगतान से कोई कर्ज़ कभी नहीं चुकता: भुगतान ब्याज तक को नहीं ढकता। मासिक भुगतान बढ़ाएँ।',
  calc_note_zero: 'जिन कर्ज़ों का न्यूनतम भुगतान या ब्याज दर्ज नहीं है, उनकी गणना $0 न्यूनतम और 0% ब्याज से होती है।',
  calc_err_budget: 'लिखें कि आप प्रति माह कितना दे सकते हैं।',
  debt_interest_label: 'वार्षिक ब्याज % (वैकल्पिक)',
  debt_minpay_label: 'मासिक न्यूनतम भुगतान $ (वैकल्पिक)',
  debt_terms: '{pct}% वार्षिक ब्याज · न्यूनतम {min}/माह',
  exp_photo_label: 'रसीद की फ़ोटो (वैकल्पिक)',
  exp_photo_remove: 'फ़ोटो हटाएँ',
  photo_close: 'बंद करें',
  err_photo_quota: 'फ़ोटो रखने की जगह नहीं थी: खर्च उसके बिना सहेजा गया।',
  banner_backup: 'आपके डेटा का बैकअप सहेजे हुए कुछ समय हो गया है। सेटिंग में अपना बैकअप निर्यात करें।',
  pro_title: 'PETO Pro',
  pro_card_text: 'आपके डेटा के लिए असीमित क्लाउड, उन्नत रिपोर्ट, साझा बजट और san आयोजक मोड।',
  pro_status_free: 'आप अभी मुफ़्त योजना पर हैं।',
  pro_status_active: 'PETO Pro सक्रिय है। PETO Finanzas का समर्थन करने के लिए धन्यवाद! ⭐',
  pro_status_test: 'बंद परीक्षण के दौरान PETO Pro खुला है: जब तक परीक्षण चले, आपके पास पूरी पहुँच है।',
  pro_status_waitlist: 'आप PETO Pro की प्रतीक्षा सूची में हैं।',
  pro_btn_see: 'PETO Pro देखें',
  pro_wall_title: 'यह PETO Pro की सुविधा है ⭐',
  pro_price_line: 'केवल $1.99 प्रति माह',
  pro_benefit_cloud: '☁️ आपके डेटा के लिए असीमित क्लाउड',
  pro_benefit_report: '📊 उन्नत रिपोर्ट: माहों की तुलना और CSV निर्यात',
  pro_benefit_shared: '🏠 अपने घर के साथ साझा बजट',
  pro_benefit_org: '🤝 San आयोजक मोड: पूरे समूह की tanda',
  pro_coming_text: 'ऐप में ख़रीद Google Play लॉन्च के साथ आएगी। तब तक आप प्रतीक्षा सूची में जुड़ सकते हैं: जैसे ही आप $1.99 प्रति माह पर Pro चालू कर सकेंगे, हम आपको बता देंगे।',
  pro_waitlist_btn: 'प्रतीक्षा सूची में जुड़ें',
  pro_waitlist_done: 'आप सूची में हैं ✅ जब Pro उपलब्ध होगा, तो हम आपको बता देंगे।',
  pro_close: 'अभी नहीं',
  pro_tag: 'PRO',
  adv_title: 'उन्नत रिपोर्ट',
  adv_note: 'यह PETO Pro की सुविधा है: यह माह बनाम पिछला माह, हर श्रेणी और माह का CSV निर्यात।',
  adv_open_btn: 'उन्नत रिपोर्ट देखें',
  adv_export_csv: 'माह को CSV में निर्यात करें',
  adv_this_month: 'इस माह',
  adv_prev_month: 'पिछला माह',
  adv_change: 'बदलाव',
  adv_all_cats: 'सभी श्रेणियाँ',
  adv_empty: 'इन दो महीनों में कोई गतिविधि नहीं।',
  org_title: 'San आयोजक मोड',
  org_intro: 'पूरे समूह की tanda चलाएँ: तारीख वाले चक्र, हर चक्र में किसने दिया यह चिह्नित करें और स्थिति समूह के साथ साझा करें।',
  org_pro_note: 'आयोजक मोड PETO Pro की सुविधा है।',
  org_form_title: 'समूह का san बनाएँ',
  org_freq_label: 'चक्रों की आवृत्ति',
  org_freq_semanal: 'साप्ताहिक',
  org_freq_quincenal: 'हर 2 सप्ताह',
  org_freq_mensual: 'मासिक',
  org_start_label: 'पहले चक्र की तारीख',
  org_create_btn: 'संगठित san बनाएँ',
  org_round: 'चक्र {x} / {n}',
  org_receiver_line: 'पाता है: {name}',
  org_pending_none: 'सबने दे दिया! 🎉',
  org_pending_list: 'अभी देना बाकी: {names}',
  org_pending_count_one: '1 बाकी है',
  org_pending_count_many: '{n} बाकी हैं',
  org_totals_title: 'प्रतिभागी अनुसार योगदान',
  org_paid_rounds: '{n} चक्रों में से {paid} दिए गए',
  org_delete: 'संगठित san हटाएँ',
  org_delete_confirm: 'संगठित san "{name}" हटाएँ? समूह के भुगतान का रिकॉर्ड खो जाएगा।',
  org_share_title: 'San की स्थिति',
  shared_live_note: 'बजट अपने घर के साथ साझा करें: घर बनाएँ या कोड से जुड़ें और आप वही सदस्य देखेंगे। आपको अपना क्लाउड खाता (ऊपर, सेटिंग में) और PETO Pro चाहिए।',
  shared_leave_live: 'यह घर छोड़ें? आप इसका साझा बजट नहीं देख पाएँगे।',
  shared_err_login: 'पहले अपने क्लाउड खाते से साइन इन करें (ऊपर, सेटिंग में) और फिर कोशिश करें।',
  shared_err_generic: 'यह पूरा नहीं हो सका। अपना कनेक्शन जाँचकर फिर कोशिश करें।',
  shared_err_code_live: 'वह कोड मौजूद नहीं है। जाँचकर फिर कोशिश करें।',
  shared_err_member: 'आप पहले से इस घर के सदस्य हैं।',
  shared_err_owner_leave: 'आप इस घर के मालिक हैं: इसे हटाए बिना आप नहीं छोड़ सकते। किसी अन्य सदस्य से नया घर बनाने को कहें।',
  shared_created_live: 'घर बन गया ✅ अपने घर को आमंत्रित करने के लिए कोड साझा करें।',
  shared_joined_live: 'आप घर से जुड़ गए ✅',
  lang_auto: 'स्वचालित (फ़ोन की भाषा)',
  org_comp_label: 'आयोजक मुआवज़ा',
  org_comp_none: 'कोई मुआवज़ा नहीं',
  org_comp_first: 'आयोजक सबसे पहले लेता है',
  org_comp_last: 'आयोजक सबसे आखिर में लेता है',
  org_comp_extra: 'प्रति राउंड अतिरिक्त शुल्क',
  org_comp_amount_label: 'प्रति व्यक्ति अतिरिक्त शुल्क ($)',
  org_comp_line: 'आयोजक मुआवज़ा: {mode}',
  org_sim_title: 'पॉट सिमुलेशन',
  org_sim_pays: 'प्रत्येक प्रतिभागी प्रति राउंड देता है: {amount}',
  org_sim_pot: 'प्रत्येक राउंड का पॉट: {amount}',
  org_sim_total_in: 'पूरे san में प्रत्येक व्यक्ति कुल देता है: {amount}',
  org_sim_extra_org: 'आयोजक को प्रति राउंड {amount} अतिरिक्त मिलता है',
  org_sim_first: 'आयोजक को पहले राउंड का पॉट मिलता है',
  org_sim_last: 'आयोजक को आखिरी राउंड का पॉट मिलता है',
  org_shuffle_btn: '🎲 क्रम शफ़ल करें',
  org_shuffled: '🎲 क्रम शफ़ल हो गया! यह नया क्रम है।',
  org_shuffle_need: 'क्रम शफ़ल करने के लिए कम से कम 2 प्रतिभागी जोड़ें।',
  org_shuffle_blocked: 'अब शफ़ल नहीं हो सकता: san शुरू हो चुका है या उसमें भुगतान दर्ज हैं।',
  org_start_btn: 'San शुरू करें',
  org_started_line: 'San चल रहा है · क्रम लॉक है',
  org_order_title: 'बारी का क्रम',
  org_move_up: 'ऊपर',
  org_move_down: 'नीचे',
  org_swap_blocked: 'उस बारी में पहले से भुगतान हैं और उसे बदला नहीं जा सकता।',
  org_history_title: 'बदलाव इतिहास',
  org_history_swap: '{a} और {b} ने बारी बदली',
  org_history_started: 'आयोजक ने san शुरू किया',
  org_pay_pending: 'लंबित',
  org_pay_reported: 'रिपोर्ट किया गया',
  org_pay_confirmed: 'पुष्टि हुई',
  org_status_btn: 'स्थिति: {status}',
  org_receipt_add: '📎 रसीद',
  org_receipt_view: 'रसीद देखें',
  org_receipt_remove: 'हटाएँ',
  org_zelle_label: 'प्रत्येक प्रतिभागी का Zelle (नंबर या ईमेल, वैकल्पिक)',
  org_zelle_ph: 'Zelle (वैकल्पिक)',
  org_zelle_line: 'Zelle: {zelle}',
  org_reminder_btn: '📲 WhatsApp रिमाइंडर',
  org_reminder_head: '🤝 {san} · राउंड {x} / {n} · {date}',
  org_reminder_receiver: '💰 इस सप्ताह {name} को मिलेगा',
  org_reminder_zelle: '{name} का Zelle: {zelle}',
  org_reminder_amount: 'राउंड योगदान: {amount}',
  org_antifraud: '🛡️ San कभी ब्याज या जमा राशि से ज़्यादा नहीं देता।',
  org_link_btn: '🔗 केवल पढ़ने वाला लिंक',
  org_link_publish: 'लिंक बनाएँ',
  org_link_update: 'लिंक अपडेट करें',
  org_link_copied: 'लिंक कॉपी हो गया!',
  org_link_need_cloud: 'लिंक के लिए आपका क्लाउड खाता चाहिए: सेटिंग में साइन इन करके फिर कोशिश करें।',
  org_link_ready: 'समूह san (केवल पढ़ने के लिए)',
  org_public_title: 'लिंक साझा करने के लिए तैयार है।',
  org_public_updated: '{date} को अपडेट हुआ',
  org_public_notfound: 'यह लिंक अब उपलब्ध नहीं है।',
  org_pub_pay_btn: 'मैंने भुगतान किया',
  org_pub_confirm: 'क्या आपने इस राउंड का अपना हिस्सा चुका दिया है? आयोजक इसकी पुष्टि करेगा।',
  org_pub_attach: '📎 रसीद की फ़ोटो जोड़ें (वैकल्पिक)',
  org_pub_send: 'रिपोर्ट भेजें',
  org_pub_sent: 'हो गया! आपका भुगतान रिपोर्ट कर दिया गया है।',
  org_pub_reported_note: 'रिपोर्ट किया गया · पुष्टि की प्रतीक्षा',
  org_pub_err: 'भेजा नहीं जा सका। अपना कनेक्शन जाँचकर फिर से कोशिश करें।',
  org_pub_err_confirmed: 'इस भुगतान की पुष्टि आयोजक पहले ही कर चुका है।',
  org_pub_err_photo: 'फ़ोटो बहुत बड़ी है; छोटी वाली आज़माएँ।',
  org_penalty_label: 'देरी का नियम',
  org_penalty_none: 'कोई जुर्माना नहीं',
  org_penalty_fixed: 'तय जुर्माना',
  org_penalty_percent: 'योगदान का प्रतिशत',
  org_penalty_amount_label: 'जुर्माने की राशि ($)',
  org_penalty_percent_label: 'जुर्माने का प्रतिशत (%)',
  org_penalty_line_fixed: 'देरी होने पर: {amount} जुर्माना',
  org_penalty_line_percent: 'देरी होने पर: योगदान का {percent}% जुर्माना',
  set_news_title: 'नया क्या है',
  news_c24: 'Compilación 24: स्वागत टूर, रिकॉर्डिंग की लगातार श्रृंखला, प्रगति पट्टी वाले बचत लक्ष्य और रुझान ग्राफ़.',
  news_c25: 'Compilación 25: होम स्क्रीन विजेट और बहुत हल्का ऐप (52 MB से 7 MB तक).',
  news_c26: 'Compilación 26: तीन आकारों के विजेट, हर विजेट के विकल्प और ऐप खोले बिना खर्च लिखने का बटन.',
  news_c27: 'Compilación 27: ऐप 12 भाषाओं में, अपने आप आपके फ़ोन की भाषा के अनुसार.',
  news_c28: 'Compilación 28: शुरुआत से लागू बड़ा टेक्स्ट, यह नया-क्या-है अनुभाग, इतालवी पाठों की समीक्षा और तेज़ शुरुआत.',
  news_c31: 'Compilación 31: बैक बटन या जेस्चर अब ऐप के अंदर चलता है: जो खुला है उसे बंद करता है और बाहर निकलने से पहले मुख्य स्क्रीन पर लौटता है।',
  news_c32: 'संस्करण 32: अब पूरे ऐप (मेनू, लॉक स्क्रीन और विजेट) में ब्रांड "PETO Finanzas" दिखता है, san होम सूची में सबसे ऊपर आ गया है, san का सार्वजनिक लिंक सीधे समूह की स्थिति खोलता है और आयोजक बटन हमेशा स्पष्ट संदेश के साथ जवाब देते हैं।',
  news_c33: 'संस्करण 33: नया san बनाना अब चल रहे san को नहीं मिटा सकता — अगर पहले से एक सक्रिय है, तो ऐप बताता है और उसे सुरक्षित रखता है (भुगतान, रसीदें, इतिहास और सार्वजनिक लिंक) — और वेब संस्करण अब फ़ोन के साथ सिंक हो गया है।',
  news_c34: 'संस्करण 34: PETO Finanzas का नया लोगो — पन्ना हरे रंग की पृष्ठभूमि पर हल्के हरे रंग की पट्टियों और तीर वाला सफ़ेद "P", अब आइकन, लॉक स्क्रीन और पूरे ऐप में।',
  news_c35: 'संस्करण 35: san के सार्वजनिक लिंक से अब आप "मैंने भुगतान किया" से अपने भुगतान की रिपोर्ट कर सकते हैं और रसीद जोड़ सकते हैं (आयोजक पुष्टि करता है), सार्वजनिक व्यूअर डार्क थीम में है, नीचे खींचने से ऐप रीफ़्रेश होता है, और PDF रीडर अब आपके भेजे Zelle भुगतान को आय नहीं समझता।',
  sec_podcast: 'पॉडकास्ट',
  key_podcast: 'Finanzas Personales, पॉडकास्ट',
  pod_hosts: 'Lucía और Marco के साथ',
  pod_desc: 'पैसे की बात, आसान भाषा में: बचत, कर्ज़ से निकलने और जेब का ख्याल रखने के व्यावहारिक सुझाव, छोटे एपिसोड में।',
  pod_spotify_btn: 'Spotify पर सुनें',
  pod_loading: 'एपिसोड लोड हो रहे हैं…',
  pod_offline: 'कनेक्शन नहीं है: आखिरी डाउनलोड की गई सूची दिखाई जा रही है',
  pod_error: 'एपिसोड लोड नहीं हो सके। अपना कनेक्शन जांचें और फिर से कोशिश करें।',
  pod_empty: 'अभी तक कोई एपिसोड प्रकाशित नहीं हुआ है।',
  pod_play_aria: 'चलाएँ',
  pod_pause_aria: 'रोकें',
  pod_audio_error: 'यह एपिसोड नहीं चलाया जा सका।',
  pub_tagline: 'आपका san, व्यवस्थित और पारदर्शी',
  pub_progress: '{n} में से {x} भुगतानों की पुष्टि हो गई है',
  pub_progress_start: 'अभी शुरुआत है: अभी तक किसी भुगतान की पुष्टि नहीं हुई है',
  pub_cta_title: 'क्या आप अपना खुद का san आयोजित करना चाहते हैं?',
  pub_cta_text: 'PETO Finanzas के साथ क्रम, बारी और रसीदें एक ही जगह रहती हैं — बिना नोटबुक, बिना उलझन।',
  pub_cta_try: 'PETO Finanzas आज़माएँ',
  pub_cta_more: 'और जानें',
  pub_bar_try: 'ऐप आज़माएँ',
  pub_footer: 'PETO Finanzas से बनाया गया · petofinanzas.com',
  news_c36: 'संस्करण 36: नया पॉडकास्ट सेक्शन — ऐप छोड़े बिना "Finanzas Personales" सुनें, इन-बिल्ट प्लेयर और बिना इंटरनेट के लिए सहेजी गई सूची के साथ — स्वागत स्क्रीन अब खुद-ब-खुद स्लाइड-दर-स्लाइड आगे बढ़ती है — और लिंक का नया रूप: san अपनी प्रगति और ऐप आज़माने का सीधा एक्सेस दिखाता है।',
  news_c37: 'संस्करण 37: नए रूप में विजेट — ब्रांड ग्रेडिएंट, आपके बजट के अनुसार रंग बदलने वाली प्रगति पट्टी और आपके san की अगली बारी की पंक्ति — साथ ही एक नया आइकन-आकार का विजेट, जिसमें आज आप कितना खर्च कर सकते हैं। और san के सार्वजनिक लिंक में स्क्रॉल करते समय ब्रांड हमेशा दिखता है। आयोजक के राउंड अब अकॉर्डियन में मुड़ते हैं: केवल इस सप्ताह वाला खुला रहता है।',
  widget_today: 'आज',
  widget_san_next: 'अगली बारी: {name} · {date}',
  widget_san_next_nodate: 'अगली बारी: {name}',
  back_exit_hint: 'बाहर निकलने के लिए फिर से बैक दबाएँ।'
},
ar: {
  org_err_san_name: 'اكتب اسم الـ san.', rep_promo_footer: 'تحكّم في مصاريفك مع PETO Finanzas · petofinanzas.com', rep_saved: 'تم حفظ الصورة.', set_sections_summary: '{visible} من {total} ظاهرة',
  org_err_active_exists: 'يوجد سان نشط بالفعل («{name}»). احذفه أولاً من بطاقته إذا أردت إنشاء آخر.',
  app_title: 'PETO Finanzas',
  back: '← كل الخيارات',
  greeting: 'مرحبًا',
  lock_btn: 'قفل',
  home_menu_heading: 'ما الذي تريد رؤيته؟',
  group_daily: 'يومًا بيوم',
  group_plan: 'التخطيط',
  group_accounts: 'الحسابات والالتزامات',
  group_yourapp: 'تطبيقك',
  sec_gastos: 'مصروفات الشهر',
  sec_ingresos: 'الدخل الأسبوعي',
  sec_ahorros: 'المدّخرات',
  sec_resumen: 'الملخص',
  sec_presupuesto: 'الميزانية حسب الفئة',
  sec_pagos: 'الدفعات الثابتة',
  sec_cuentas: 'حساباتي',
  sec_deudas: 'ديوني',
  sec_san: 'صندوقي san (tanda)',
  sec_ajustes: 'الإعدادات والتخصيص',
  menu_open_aria: 'فتح القائمة',
  menu_close_aria: 'إغلاق القائمة',
  sec_home: 'الرئيسية',
  key_home: 'شاشتك الرئيسية',
  set_notif_label: 'الإشعارات والتطبيق مغلق',
  set_notif_help: 'تنبيهات بدفعاتك الثابتة قبلها بيوم وفي يومها، حتى عندما يكون PETO Finanzas مغلقًا.',
  set_autofixed_label: 'تسجيل الدفعات الثابتة تلقائيًا',
  set_autofixed_help: 'عند استحقاق دفعة ثابتة، يُسجَّل المصروف عنك تلقائيًا. ويمكنك التراجع فورًا.',
  set_bio_label: 'فتح القفل بالبصمة',
  set_bio_help: 'ادخل ببصمتك بالإضافة إلى رمز PIN (يلزم رمز PIN مفعّل).',
  bio_btn: '👆 ادخل بالبصمة',
  bio_reason: 'أكّد أنك أنت لفتح PETO Finanzas',
  bio_need_pin: 'فتح القفل بالبصمة يحتاج إلى رمز PIN مفعّل: أنشئ رمز PIN في الإعدادات ← الأمان وستعمل البصمة عند فتح التطبيق.',
  bio_failed: 'تعذّر التحقق من البصمة. اكتب رمز PIN.',
  bio_unavailable: 'البصمة غير متاحة في هذا الهاتف. اكتب رمز PIN.',
  bio_not_enrolled: 'لا توجد بصمة مسجّلة في هذا الهاتف. سجّل واحدة في إعدادات الهاتف أو اكتب رمز PIN.',
  bio_offer_title: 'فتح القفل ببصمتك؟',
  bio_offer_text: 'لقد أنشأت للتو رمز PIN. إذا أردت، يمكنك فتح PETO Finanzas ببصمتك بدلًا من كتابة الرمز في كل مرة. هل نفعّله الآن؟',
  bio_offer_yes: 'نعم، فعّل البصمة',
  bio_offer_no: 'ليس الآن',
  bio_activated: 'تم: فتح القفل بالبصمة أصبح مفعّلًا.',
  fix_auto_suffix: '(دفعة ثابتة تلقائية)',
  backup_pass_label: 'كلمة مرور النسخة المشفّرة',
  backup_pass_ph: '4 أحرف على الأقل',
  data_export_enc: 'تصدير نسخة مشفّرة',
  backup_help: 'النسخة المشفّرة لا تُفتح إلا بكلمة مرورك. بدونها لا يمكن استعادتها: احتفظ بها في مكان آمن. لاستيراد نسخة مشفّرة، اكتب كلمة مرورها هنا قبل اختيار الملف.',
  backup_err_short: 'يجب أن تكون كلمة المرور 4 أحرف على الأقل.',
  backup_need_pass: 'اكتب كلمة مرور النسخة المشفّرة قبل استيرادها.',
  backup_err_pass: 'تعذّر فتح النسخة: كلمة مرور خاطئة أو ملف تالف.',
  share_btn: 'مشاركة الملخص',
  share_copied: 'تم نسخ الملخص. الصقه في أي مكان.',
  review_title: 'هل يعجبك PETO Finanzas؟',
  review_text: 'إذا كان PETO Finanzas يساعدك في العناية بأموالك، فتقييمك على Google Play يساعدنا كثيرًا في الوصول إلى المزيد من الناس. شكرًا!',
  review_yes: '⭐ التقييم على Google Play',
  review_no: 'ليس الآن',
  share_report_title: 'ملخصي في PETO Finanzas',
  notif_fixed_title: 'دفعة ثابتة غدًا',
  notif_fixed_today: 'دفعة ثابتة اليوم',
  notif_fixed_body: '{name} · {amount}',
  notif_weekly_title: 'أسبوعك في PETO Finanzas',
  notif_weekly_body: 'سجّل مصروفات ودخل هذا الأسبوع لتبقى على المسار.',
  summary_title: 'الملخص اليومي',
  summary_help: 'تنبيه بما أنفقته أمس وما يمكنك إنفاقه اليوم، في الوقت الذي تختاره.',
  summary_notif_label: 'الملخص عبر الإشعار',
  summary_time_label: 'وقت الملخص',
  summary_email_label: 'استلامه أيضًا عبر البريد الإلكتروني',
  summary_email_help: 'فقط مع تفعيل حسابك السحابي: يصل الملخص نفسه أيضًا إلى بريدك الإلكتروني.',
  notif_summary_title: '🌅 ملخص PETO Finanzas الخاص بك',
  notif_summary_body: 'أمس أنفقت {spent} · اليوم يمكنك إنفاق {daily}',
  notif_summary_body_nodaily: 'أمس أنفقت {spent}',
  sec_remesas: 'الحوالات',
  key_remesas: 'أُرسل هذا الشهر: {amount}',
  rem_intro: 'الأموال التي ترسلها إلى أهلك: كم خرج بالدولار وكم وصل بعملتهم.',
  rem_usd_label: 'المبلغ المرسل ($ USD)',
  rem_rate_label: 'السعر ({cur} مقابل كل $1)',
  rem_recipient_label: 'لمن؟',
  rem_currency_label: 'عملة الوجهة',
  rem_arrives_label: 'يصل',
  rem_rate_suggested: 'آخر سعر استخدمته لـ {cur}: {rate}. إنه مملوء مسبقًا؛ غيّره إذا كان سعر اليوم مختلفًا.',
  rem_month_sent: 'أرسلت هذا الشهر {usd}',
  rem_totals_title: 'المجاميع حسب العملة (كل السجل)',
  rem_total_row: 'أُرسل {usd} ← وصل {amount} · {n} مرة',
  rem_save: 'حفظ الحوالة',
  rem_empty: 'لا توجد حوالات مسجّلة بعد.',
  rem_delete_confirm: 'حذف الحوالة المرسلة إلى {name}؟',
  csv_title: 'استيراد كشف الحساب (CSV)',
  csv_help: 'ارفع ملف CSV من بنكك وراجع كل شيء في معاينة قبل الاستيراد: لا يُحفظ أي شيء حتى تؤكّد.',
  csv_file_label: 'ملف CSV من البنك',
  csv_preview_title: 'معاينة الاستيراد',
  csv_summary: '{total} معاملة · {dups} مكرّرة (مستبعدة) · {sel} للاستيراد',
  csv_dup_badge: 'مكرّرة',
  csv_income_badge: 'دخل',
  csv_expense_badge: 'مصروف',
  csv_all: 'تحديد الكل',
  csv_none: 'إلغاء تحديد الكل',
  csv_apply: 'استيراد المحدّد',
  csv_cancel: 'إلغاء الاستيراد',
  csv_done: 'تم استيراد {n} معاملة. ✅',
  csv_none_selected: 'لم تحدّد أي معاملة لاستيرادها.',
  csv_err_parse: 'تعذّرت قراءة ذلك الملف كـ CSV. تأكد أنه كشف حساب البنك بصيغة CSV.',
  csv_err_headers: 'لم يتم العثور على عمودي التاريخ والمبلغ في ذلك الملف.',
  csv_err_big: 'ذلك الملف كبير جدًا للاستيراد.',
  csv_err_empty: 'لا يحتوي ذلك الملف على معاملات يمكن استيرادها.',
  pdf_err_big: 'ملف PDF هذا كبير جدًا (الحد الأقصى 8 ميغابايت).',
  pdf_err_notext: 'لا يحتوي ملف PDF هذا على نص يمكنني قراءته (يبدو كصورة أو مسح ضوئي). جرّب ملف CSV من البنك أو سجّل المصروف بصورة الإيصال.',
  pdf_err_empty: 'لم أجد حركات بتاريخ ومبلغ في ملف PDF هذا. جرّب ملف CSV من البنك.',
  shared_title: 'ميزانية مشتركة',
  shared_preview_note: '🔧 معاينة للتصميم: لا يتصل بعد بحسابات أخرى. استخدمه لتجربة كيف سيبدو إنشاء منزل والانضمام برمز ورؤية الأعضاء.',
  shared_create_label: 'اسم المنزل',
  shared_create_btn: 'إنشاء منزل',
  shared_join_label: 'رمز الدعوة',
  shared_join_btn: 'الانضمام برمز',
  shared_members_title: 'الأعضاء',
  shared_code_label: 'رمز الدعوة: {code}',
  shared_role_dueno: 'المالك',
  shared_role_admin: 'مسؤول',
  shared_role_miembro: 'عضو',
  shared_role_lector: 'للقراءة فقط',
  shared_you: 'أنت',
  shared_host: 'المضيف',
  shared_leave_btn: 'مغادرة المنزل',
  shared_leave_confirm: 'مغادرة هذا المنزل؟ (معاينة)',
  shared_err_name: 'اكتب اسمًا للمنزل.',
  shared_err_code: 'الرمز مكوّن من 6 أحرف أو أرقام.',
  shared_created: 'تم إنشاء المنزل (معاينة). ✅',
  shared_joined: 'انضممت إلى المنزل (معاينة). ✅',
  shared_household_fallback: 'منزل مشترك',
  privacy_hide: 'إخفاء المبالغ',
  privacy_show: 'إظهار المبالغ',
  ins_title: '💡 أفكار حول أموالك',
  ins_cat_up: 'ارتفع {cat} بنسبة {pct}% مقارنة بالشهر الماضي ({from} ← {to}).',
  ins_pace_down: 'إيقاعك يتحسّن: انخفض الإنفاق بنسبة {pct}% مقارنة بالشهر الماضي.',
  ins_pace_up: 'تنبيه: ارتفع إيقاع إنفاقك بنسبة {pct}% مقارنة بالشهر الماضي.',
  ins_biggest: 'أكبر مصروف لك هذا الشهر: {note} · {amount}.',
  ins_saved: 'لقد ادّخرت {amount} هذا الشهر. واصل هكذا!',
  bud_alert_title: 'الميزانية في خطر',
  bud_alert_warn: '{cat}: أنت عند {pct}% من الميزانية.',
  bud_alert_over: '{cat}: تجاوزت الميزانية ({pct}%).',
  voice_btn: '🎤 إملاء',
  voice_listening: 'أستمع… قل المبلغ وما كان من أجله.',
  voice_unavailable: 'الصوت غير متاح على هذا الجهاز.',
  voice_heard: 'سمعت: «{text}». تحقق منه واحفظه.',
  voice_no_amount: 'سمعت: «{text}»، لكنني لم أجد المبلغ.',
  ocr_found: 'رصدت {amount} على الإيصال. تحقق منه قبل الحفظ.',
  goals_title: 'أهداف أخرى',
  goal2_create: 'إنشاء هدف',
  goal_add: '+ إضافة',
  goal_take: '− سحب',
  goal_done: '🎉 تم بلوغ الهدف!',
  goal_move_label: 'المبلغ',
  goal_delete_confirm: 'حذف الهدف «{name}»؟ مدّخراتك لا تُمسّ: يُحذف الهدف فقط.',
  err_limit_goals: 'لديك بالفعل الحد الأقصى من الأهداف.',
  biz_label: 'هذا لنشاطي التجاري',
  biz_title: 'نشاطي التجاري هذا الشهر',
  biz_income: 'دخل النشاط التجاري',
  biz_expenses: 'مصروفات النشاط التجاري',
  biz_profit: 'الربح',
  chal_share: 'مشاركة تحدّيّ',
  cloud_title: 'الحساب السحابي',
  cloud_help: 'مع الحساب، تُحفظ بياناتك أيضًا في السحابة وتتزامن: غيّر هاتفك، سجّل الدخول ببريدك، وستجد كل شيء هناك. بدون حساب، يعمل التطبيق على هذا الهاتف فقط، كما هو الحال دائمًا.',
  cloud_email: 'البريد الإلكتروني',
  cloud_pass: 'كلمة المرور',
  cloud_signin: 'تسجيل الدخول',
  cloud_signup: 'إنشاء حساب',
  cloud_signout: 'تسجيل الخروج',
  cloud_sync_now: 'المزامنة الآن',
  cloud_wipe: 'حذف بياناتي من السحابة',
  cloud_who: 'مسجّل الدخول باسم {email}',
  cloud_synced: 'تمت المزامنة ✓ · {time}',
  cloud_never: 'لم تتم المزامنة بعد.',
  cloud_working: 'جارٍ العمل…',
  cloud_ok_in: 'مرحبًا بعودتك!',
  cloud_ok_up: 'تم إنشاء الحساب! بياناتك الآن في السحابة.',
  cloud_err_fields: 'اكتب بريدك وكلمة مرور من 6 أحرف على الأقل.',
  cloud_err_login: 'تعذّر تسجيل الدخول. تحقق من بريدك وكلمة المرور.',
  cloud_err_exists: 'ذلك البريد له حساب بالفعل. استخدم «تسجيل الدخول».',
  cloud_err_confirm: 'تم إنشاء الحساب. تحقق من بريدك لتأكيد حسابك ثم سجّل الدخول.',
  cloud_err_generic: 'حدث خطأ ما مع السحابة. تحقق من اتصالك بالإنترنت وحاول مجددًا.',
  cloud_conflict: 'السحابة وهذا الهاتف فيهما بيانات مختلفة. تنزيل بيانات السحابة واستبدال ما في هذا الهاتف؟ (إلغاء = رفع بيانات هذا الهاتف)',
  cloud_wipe_confirm: 'حذف كل بياناتك من السحابة؟ ما في هذا الهاتف يبقى كما هو.',
  cloud_delete: 'حذف حسابي',
  cloud_delete_confirm1: 'حذف حسابك في PETO Finanzas؟ سيحذف هذا حسابك ونسخة بياناتك في السحابة والمنازل المشتركة التي تملكها. البيانات في هذا الهاتف تبقى هنا دون مساس (يمكنك مسحها من الإعدادات). لا يمكن التراجع عن هذا.',
  cloud_delete_confirm2: 'تأكيد أخير: حذف حسابك نهائيًا؟',
  cloud_deleted: 'تم حذف حسابك.',
  cloud_delete_err_auth: 'جلستك لم تعد صالحة. سجّل الدخول من جديد وحاول مرة أخرى.',
  cloud_unavailable: 'السحابة غير متاحة في هذا الإصدار.',
  key_settings: 'الاسم، التقسيم، النص، الأقسام، PIN',
  footer: 'PETO Finanzas · يعمل دون إنترنت · السحابة اختيارية: بياناتك، قرارك',
  tile_available: 'الأموال المتاحة',
  tile_available_aria: 'الأموال المتاحة: الذهاب إلى حساباتي',
  tile_savings: 'مدّخرات هذا الشهر',
  tile_savings_aria: 'مدّخرات هذا الشهر: الذهاب إلى المدّخرات',
  tile_debts: 'ديون متبقية',
  tile_debts_aria: 'ديون متبقية: الذهاب إلى ديوني',
  tile_incomes: '💵 الدخل',
  tile_incomes_aria: 'الدخل: الذهاب إلى الدخل الأسبوعي',
  tile_expenses: '🧾 المصروفات',
  tile_expenses_aria: 'المصروفات: الذهاب إلى مصروفات الشهر',
  tile_goal: 'الهدف «{name}»: {pct}%',
  key_spent_month: 'أنفقت {amount} هذا الشهر',
  key_income_month: 'استلمت {amount} هذا الشهر',
  key_saved_total: 'ادّخرت {amount} في المجموع',
  key_goal_suffix: ' · الهدف «{name}»: {pct}%',
  key_budget_one: '{n} فئة بحدّ',
  key_budget_many: '{n} فئات بحدّ',
  key_fixed: '{amount} شهريًا · {n} للدفع',
  key_available: 'المتاح: {amount}',
  key_debts: '{amount} متبقٍّ',
  key_san: 'الأسبوع {x} من {n} · التالي: {name}',
  key_san_done: 'انتهى الـ san 🎉',
  key_san_none: 'لا يوجد san نشط',
  banner_payday: 'اليوم يوم الراتب: سجّل دخلك ومدّخراتك.',
  banner_dues_title: 'دفعات قريبة:',
  banner_due_item: '{name} (يوم {day})',
  banner_close: 'تجاهل',
  spend_title: 'كم يمكنك أن تنفق اليوم؟',
  spend_note: 'هذا ما يمكنك إنفاقه اليوم دون تجاوز الحد.',
  spend_guide: 'أنشئ ميزانية فئتك الأولى وسترى هنا كم يمكنك أن تنفق كل يوم.',
  spend_left: 'تبقّى لك {amount} للأيام الـ {days} المتبقية من الشهر.',
  spend_left_one: 'تبقّى لك {amount} لليوم، آخر يوم في الشهر.',
  spend_over: 'لقد بلغت ميزانية هذا الشهر.',
  spend_over_by: 'لقد تجاوزت بـ {amount}.',
  cat_Renta: 'الإيجار',
  cat_Comida: 'طعام',
  "cat_Comida fuera": 'الأكل خارجًا',
  cat_Gasolina: 'بنزين',
  cat_Transporte: 'مواصلات',
  cat_Salud: 'صحة',
  cat_Ropa: 'ملابس',
  cat_Otros: 'أخرى',
  btn_cancel: 'إلغاء',
  btn_save: 'حفظ',
  btn_edit: 'تعديل',
  btn_delete: 'حذف',
  err_amount: 'اكتب مبلغًا صالحًا أكبر من $0.',
  err_amount_generic: 'اكتب مبلغًا صالحًا.',
  err_name: 'اكتب اسمًا.',
  chip_paid: 'مدفوعة',
  chip_pending: 'قيد الانتظار',
  month_prev_aria: 'الشهر السابق',
  month_next_aria: 'الشهر التالي',
  exp_new: 'مصروف جديد',
  exp_edit: 'تعديل المصروف',
  exp_total_label: 'مجموع الشهر:',
  amount_label: 'المبلغ ($)',
  category_label: 'الفئة',
  date_label: 'التاريخ',
  note_label: 'ملاحظة (اختياري)',
  exp_note_ph: 'ما كان من أجله؟',
  exp_save: 'حفظ المصروف',
  exp_empty: 'لا توجد مصروفات هذا الشهر بعد.\nأضف الأول بالنموذج أعلاه. 👍',
  exp_delete_confirm: 'حذف هذا المصروف البالغ {amount}؟ الفئة {cat}، بتاريخ {date}. يُحذف هذا المصروف فقط.',
  err_category: 'اختر فئة صالحة.',
  err_limit_expenses: 'لقد بلغت حدّ المصروفات المحفوظة.',
  inc_intro: 'الادّخار ليس تلقائيًا أبدًا: أنت تكتب كم ادّخرت فعلًا من كل دخل. التطبيق يقترح فقط مبلغًا بناءً على نسبتك في الإعدادات.',
  inc_new: 'دخل جديد',
  inc_edit: 'تعديل الدخل',
  inc_note_ph: 'من أين جاء؟',
  inc_savings_label: 'المدّخرات ($)',
  inc_savings_label_sug: 'المدّخرات (المقترحة: {amount})',
  inc_savings_help: 'اقتراح بناءً على نسبة ادّخارك — غيّره إلى ما ادّخرته فعلًا. يمكنك كتابة $0.',
  inc_split_line: 'المُدّخر: {sav} · الاقتراح: العمل {biz} · المصروفات {exp} · العائلة {fam}',
  inc_split_preview: 'التقسيم المقترح: المدّخرات {sav} · العمل {biz} · المصروفات {exp} · العائلة {fam}. المدّخرات التي تُحسَب هي التي تكتبها أدناه.',
  inc_save: 'حفظ الدخل',
  inc_empty: 'لا يوجد دخل مسجّل بعد.\nأضف دخلك الأول واكتب كم ادّخرت منه. 💪',
  inc_delete_confirm: 'حذف هذا الدخل البالغ {amount} من {date}؟ تُحذف أيضًا مدّخراته المسجّلة البالغة {savings}.',
  err_inc_savings: 'اكتب كم ادّخرت من هذا الدخل (يمكن أن يكون $0).',
  err_limit_incomes: 'لقد بلغت حدّ الدخل المحفوظ.',
  sav_intro_1: 'هنا ترى كل مبلغ ادّخرته، واحدًا تلو الآخر. يمكنك أيضًا إضافة مدّخرات منفصلة،',
  sav_intro_2: 'غير مرتبطة بأي دخل',
  sav_intro_3: '، بالنموذج أدناه. إذا حذفت مدّخرات، يُحذف ذلك المبلغ فقط:',
  sav_intro_4: 'يبقى الدخل كما هو',
  sav_intro_5: '.',
  sav_total_label: 'مجموع المدّخر:',
  sav_month_label: 'ادّخرت هذا الشهر:',
  sav_form_title: 'إضافة مدّخرات',
  sav_note_ph: 'من أجل ماذا هذه المدّخرات؟',
  sav_save: 'حفظ المدّخرات',
  sav_goal_label: 'إسناد إلى هدف (اختياري)',
  sav_goal_none: 'بدون هدف · مدّخرات عامة',
  sav_empty: 'لا توجد مدّخرات مسجّلة بعد.\nأضف واحدة بالنموذج أعلاه، أو سجّل مدّخرات دخل عند تسجيله وستظهر هنا. 🌱',
  sav_from_title: 'مدّخرات {date}',
  sav_from_sub: 'من دخل قدره {amount}',
  sav_manual_title: 'مدّخرات مضافة',
  sav_manual_sub: 'يدوي · أُضيفت في {date}',
  sav_delete_income_confirm: 'حذف هذه المدّخرات البالغة {amount} من {date}؟ تُحذف هذه المدّخرات فقط: دخل {income} يبقى كما هو.',
  sav_delete_manual_confirm: 'حذف هذه المدّخرات البالغة {amount} من {date}؟ إنها مدّخرات أضفتها يدويًا في المدّخرات؛ تُحذف هذه الإدخالة فقط.',
  err_limit_savings: 'لقد بلغت حدّ المدّخرات المحفوظة.',
  goal_prompt: 'من أجل ماذا تدّخر؟',
  goal_prompt_sub: 'أنشئ هدفًا وشاهد مدّخراتك تقترب منه.',
  goal_form_create: 'إنشاء هدف',
  goal_form_edit: 'تعديل الهدف',
  goal_name_label: 'اسم الهدف',
  goal_name_ph: 'مثال: صندوق الطوارئ',
  goal_target_label: 'مبلغ الهدف ($)',
  goal_create_btn: 'إنشاء الهدف',
  goal_save_btn: 'حفظ الهدف',
  goal_progress: 'لقد ادّخرت {have} من {target}',
  goal_remaining: 'تبقّى {amount}',
  goal_edit: 'تعديل الهدف',
  goal_delete: 'حذف الهدف',
  err_goal_name: 'اكتب اسمًا لهدفك.',
  res_cats_title: 'المصروفات حسب الفئة',
  res_summary_title: 'الدخل مقابل المصروفات مقابل المدّخرات',
  chart_income: 'الدخل',
  chart_expenses: 'المصروفات',
  chart_savings: 'المدّخرات',
  res_cats_empty: 'لا توجد مصروفات هذا الشهر.',
  res_summary_empty: 'لا نشاط هذا الشهر بعد.',
  bud_intro: 'حدّد حدًّا شهريًا لكل فئة واطّلع على كم أنفقت.',
  bud_spent_left: 'أنفقت {spent} من {budget} · تبقّى {left}',
  bud_spent_over: 'أنفقت {spent} من {budget} · تجاوزت بـ {over}',
  bud_nolimit: 'لا يوجد حدّ. أنفقت هذا الشهر: {spent}',
  bud_placeholder: 'الحد الشهري $',
  bud_aria: 'الحد الشهري لـ {cat}',
  bud_delete_cat: 'حذف الفئة',
  bud_delete_cat_confirm: 'حذف فئة «{cat}»؟ المصروفات التي تستخدمها ستنتقل إلى «{other}».',
  bud_alert_amount: 'اكتب مبلغًا صالحًا للحدّ.',
  cat_form_title: 'فئة مخصّصة',
  cat_name_label: 'اسم الفئة',
  cat_name_ph: 'مثال: حيوانات أليفة',
  cat_save: 'إضافة فئة',
  err_cat_name: 'اكتب اسمًا للفئة.',
  err_cat_exists: 'تلك الفئة موجودة بالفعل.',
  fix_intro: 'دفعات تتكرر كل شهر: إيجار، هاتف، اشتراكات…',
  fix_new: 'دفعة ثابتة جديدة',
  fix_edit: 'تعديل الدفعة الثابتة',
  fix_name_ph: 'مثال: إيجار',
  fix_day_label: 'يوم الشهر',
  fix_save: 'حفظ الدفعة الثابتة',
  fix_empty: 'لا توجد دفعات ثابتة بعد.',
  fix_sub: 'يوم {day} من كل شهر · {month}',
  fix_mark: 'وضع علامة مدفوعة',
  fix_unmark: 'إزالة العلامة',
  fix_delete_confirm: 'حذف الدفعة الثابتة «{name}»؟',
  err_day: 'يجب أن يكون اليوم بين 1 و 31.',
  err_limit_fixed: 'لقد بلغت حدّ الدفعات الثابتة.',
  acc_new: 'حساب جديد',
  acc_edit: 'تعديل الحساب',
  acc_balance_label: 'الرصيد ($)',
  acc_name_ph: 'مثال: نقدًا، بنك، مدّخرات',
  acc_save: 'حفظ الحساب',
  acc_empty: 'لا توجد حسابات بعد.\nأضف واحدًا لترى أموالك المتاحة في الملخص.',
  acc_delete_confirm: 'حذف الحساب «{name}»؟',
  err_balance: 'اكتب رصيدًا صالحًا.',
  err_limit_accounts: 'لقد بلغت حدّ الحسابات.',
  debt_new: 'دين جديد',
  debt_edit: 'تعديل الدين',
  debt_name_ph: 'مثال: بطاقة، قرض',
  debt_status_label: 'الحالة',
  debt_status_pending: 'قيد الانتظار',
  debt_status_paid: 'مدفوع',
  debt_save: 'حفظ الدين',
  debt_empty: 'لا توجد ديون مسجّلة. 🎉',
  debt_mark_paid: 'وضع علامة مدفوع',
  debt_mark_pending: 'وضع علامة قيد الانتظار',
  debt_delete_confirm: 'حذف الدين «{name}»؟',
  err_limit_debts: 'لقد بلغت حدّ الديون.',
  name_label: 'الاسم',
  san_intro: 'الـ san (tanda) هو دائرة ادّخار: كل أسبوع يساهم الجميع ويستلم شخص واحد المبلغ كاملًا، بالتناوب.',
  san_form_title: 'إنشاء san',
  san_name_label: 'اسم الـ san',
  san_name_ph: 'مثال: san العائلة',
  san_aporte_label: 'المساهمة في كل دور ($)',
  san_participants_label: 'المشاركون (بترتيب الأدوار)',
  san_pname_ph: 'اسم المشارك',
  san_add_participant: 'إضافة',
  san_create_btn: 'إنشاء san',
  san_err_participants: 'أضف مشاركين اثنين على الأقل.',
  san_err_active_exists: 'يوجد سان جارٍ بالفعل («{name}»). احذفه أولاً إذا أردت إنشاء آخر.',
  san_err_dup: 'ذلك المشارك موجود في القائمة بالفعل.',
  san_err_pname: 'اكتب اسم المشارك.',
  san_remove: 'إزالة',
  san_draft_empty: 'لم يُضَف أي مشارك بعد.',
  san_week: 'الأسبوع {x} من {n}',
  san_finished: '🎉 انتهى الـ san!',
  san_finished_note: 'اكتملت كل الأسابيع. يمكنك حذف هذا الـ san وإنشاء واحد جديد.',
  san_total_line: 'المجموع المُجمَع: {amount}',
  san_week_collected: 'المُجمَع هذا الأسبوع: {amount} من {target}',
  san_receiver_line: 'التالي: {name}',
  san_aporte_line: 'المساهمة في كل دور: {amount}',
  san_paid_title: 'من دفع هذا الأسبوع؟',
  san_paid: 'دفع',
  san_advance: 'وضع علامة اكتمال الأسبوع',
  san_delete: 'حذف الـ san',
  san_delete_confirm: 'حذف الـ san «{name}»؟ ستُحذف سجلات أسابيعه ودفعاته.',
  san_new_btn: 'إنشاء san جديد',
  san_new_confirm: 'انتهى الـ san الحالي. حذفه وإنشاء واحد جديد؟',
  set_profile: 'ملفّك',
  set_name_label: 'اسمك',
  set_textsize_label: 'حجم النص',
  textsize_normal: 'عادي',
  textsize_large: 'كبير',
  set_lang_label: 'اللغة / Language',
  set_reminders_title: 'التذكيرات',
  set_payday_label: 'يوم الراتب',
  set_reminders_label: 'التذكيرات في الرئيسية',
  wd_none: 'لا يوجد يوم راتب',
  wd_0: 'الأحد',
  wd_1: 'الاثنين',
  wd_2: 'الثلاثاء',
  wd_3: 'الأربعاء',
  wd_4: 'الخميس',
  wd_5: 'الجمعة',
  wd_6: 'السبت',
  set_split_title: 'التقسيم المقترح للدخل (%)',
  set_split_help: 'يجب أن يكون مجموع الأرقام الأربعة 100. هذه النسب مجرد اقتراح لتقسيم دخلك: لا تُحفظ المدّخرات تلقائيًا أبدًا — أنت دائمًا تكتب كم ادّخرت فعلًا من كل دخل.',
  split_ahorro: 'المدّخرات',
  split_negocio: 'العمل التجاري',
  split_gastos: 'المصروفات',
  split_familia: 'العائلة',
  set_save: 'حفظ الإعدادات',
  set_err_sum: 'يجب أن يكون مجموع النسب 100. المجموع الآن {total}.',
  set_saved: 'تم حفظ الإعدادات. ✅',
  set_sections_title: 'الأقسام الظاهرة',
  set_sections_help: 'أوقف التي لا تستخدمها لتحافظ على قائمة أقصر.',
  set_pin_title: 'الأمان (PIN)',
  pin_status_on: 'لديك رمز PIN مفعّل. يُقفل التطبيق عند فتحه.',
  pin_status_off: 'ليس لديك رمز PIN. يمكنك إنشاء واحد هنا لحماية بياناتك.',
  pin_current_label: 'رمز PIN الحالي (إن وُجد)',
  pin_new_label: 'رمز PIN الجديد (فارغ = إزالة الرمز)',
  pin_update: 'تحديث رمز PIN',
  pin_err_current: 'رمز PIN الحالي غير صحيح.',
  pin_err_format: 'يجب أن يكون رمز PIN الجديد من 4 إلى 6 أرقام.',
  pin_off: 'تم تعطيل رمز PIN.',
  pin_updated: 'تم تحديث رمز PIN. ✅',
  set_data_title: 'بياناتك',
  set_data_help: 'كل شيء يبقى على هذا الهاتف فقط. صدّر نسخة إذا أردت الاحتفاظ بها في مكان آخر.',
  data_export: 'تصدير نسخة (JSON)',
  data_import: 'استيراد نسخة',
  data_reset: 'حذف كل البيانات',
  data_err_big: 'ذلك الملف كبير جدًا.',
  data_err_invalid: 'تعذّر الاستيراد: ذلك الملف ليس نسخة PETO Finanzas صالحة.',
  import_confirm: 'الاستيراد سيستبدل كل بيانات التطبيق الحالية. هل أنت متأكد؟',
  import_done: 'تم استيراد النسخة. ✅',
  reset_confirm1: 'سيحذف هذا كل بيانات تطبيقك على هذا الهاتف. لا يمكن التراجع عنه. هل أنت متأكد؟',
  reset_confirm2: 'تأكيد أخير: حذف كل شيء والبدء من جديد؟',
  lock_prompt: 'اكتب رمز PIN للمتابعة.',
  lock_pin_label: 'PIN',
  lock_enter: 'فتح القفل',
  lock_note: 'بياناتك تبقى على هذا الهاتف فقط.',
  lock_err: 'رمز PIN غير صحيح. حاول مجددًا.',
  ob_title: 'مرحبًا بك في PETO Finanzas!',
  ob_intro_1: 'نظّم أموالك في دقائق: مصروفات، دخل، ميزانية، حسابات وديون.',
  ob_intro_2: 'بدون حساب، بدون إنترنت.',
  ob_intro_3: 'كل شيء يُحفظ على هاتفك فقط.',
  ob_name_label: 'ما اسمك؟',
  ob_name_ph: 'اسمك',
  ob_pin_label: 'أنشئ رمز PIN للأمان (اختياري)',
  ob_pin_ph: 'من 4 إلى 6 أرقام، أو اتركه فارغًا',
  ob_pin2_label: 'كرّر رمز PIN',
  ob_pin2_ph: 'كرّر رمز PIN',
  ob_start: 'ابدأ',
  ob_note: 'يمكنك تغيير رمز PIN في أي وقت من الإعدادات.',
  ob_tour1_title: 'سجّل مصروفًا في ثوانٍ',
  ob_tour1_text: 'المس زر +، واكتب المبلغ والفئة. هذا كل شيء: يُحفظ مصروفك فورًا.',
  ob_tour2_title: 'كم يمكنك أن تنفق اليوم؟',
  ob_tour2_text: 'يوزّع PETO Finanzas ميزانيتك على الأيام المتبقية من الشهر ويخبرك برقم واحد فقط: كم يمكنك أن تنفق اليوم دون تجاوز الحد.',
  ob_tour3_title: 'حسابك السحابي (اختياري)',
  ob_tour3_text: 'إذا أردت، أنشئ حسابًا مجانيًا لترى بياناتك على الويب أيضًا. بدون حساب، يبقى كل شيء على هاتفك فقط.',
  ob_tour_next: 'التالي',
  ob_tour_skip: 'تخطٍّ',
  ob_tour_go: 'هيا بنا!',
  ob_err_name: 'اكتب اسمك للبدء.',
  ob_err_pin_format: 'يجب أن يكون رمز PIN من 4 إلى 6 أرقام.',
  ob_err_pin_mismatch: 'رمزا PIN غير متطابقين.',
  set_theme_label: 'المظهر',
  theme_light: 'فاتح',
  theme_dark: 'داكن',
  theme_auto: 'تلقائي (النظام)',
  set_accent_label: 'اللون الرئيسي',
  accent_verde: 'أخضر',
  accent_azul: 'أزرق',
  accent_morado: 'بنفسجي',
  accent_naranja: 'برتقالي',
  undo_done: 'تم',
  undo_btn: 'تراجع',
  btn_repeat: 'تكرار',
  fab_aria: 'إضافة سريعة',
  quick_title: 'ما الذي تريد إضافته؟',
  quick_expense: '🧾 مصروف',
  quick_income: '💵 دخل',
  quick_savings: '🐷 ادّخار',
  sec_buscar: 'بحث النشاط',
  search_label: 'بحث',
  search_ph: 'ملاحظة أو فئة أو مبلغ…',
  search_month_label: 'الشهر (فارغ = الكل)',
  search_type_label: 'النوع',
  type_all: 'الكل',
  type_gastos: 'المصروفات',
  type_ingresos: 'الدخل',
  type_ahorros: 'المدّخرات',
  search_empty: 'لا توجد نتائج.',
  search_type_income: 'دخل',
  search_type_saving: 'ادّخار',
  chal_title: '🔥 تحدّي الادّخار الأسبوعي',
  chal_progress: 'هذا الأسبوع: {have} من {target}',
  chal_done: '🎉 اكتمل تحدّي هذا الأسبوع!',
  chal_streak_one: 'السلسلة: أسبوع واحد مكتمل',
  chal_streak_many: 'السلسلة: {n} أسابيع مكتملة',
  chal_streak_zero: 'السلسلة: 0 أسابيع. يمكن أن يكون هذا هو الأول!',
  streak_one: '🔥 يوم واحد من التسجيل المتتالي',
  streak_many: '🔥 {n} أيام تسجيل متتالية',
  chal_target_label: 'هدف الادّخار الأسبوعي ($)',
  chal_save: 'حفظ الهدف الأسبوعي',
  rep_title: 'التقرير الشهري',
  rep_download: 'تنزيل الصورة',
  rep_share_image: 'مشاركة الصورة',
  trend_title: 'اتجاه الإنفاق',
  trend_weeks: 'أسابيع هذا الشهر',
  trend_week: 'الأسبوع {n}',
  trend_empty: 'لا توجد مصروفات بعد لإظهار الاتجاه.',
  rep_income: 'الدخل',
  rep_expenses: 'المصروفات',
  rep_savings: 'المدّخرات',
  rep_top_cat: 'الفئة الأولى',
  rep_top3: 'أفضل 3 فئات',
  rep_goal: 'هدف الادّخار',
  rep_none: 'لا نشاط',
  calc_title: 'حاسبة سداد الديون',
  calc_intro: 'قارن بين خطتين للخروج من الديون: ادفع الأصغر أولًا (كرة الثلج) أو الأعلى فائدة أولًا (الانهيار). كل شهر تدفع كل الحدود الدنيا والباقي يذهب إلى الدين المستهدف.',
  calc_budget_label: 'كم يمكنك أن تدفع شهريًا للديون في المجموع؟ ($)',
  calc_run: 'احسب',
  calc_snowball: 'كرة الثلج (الرصيد الأصغر أولًا)',
  calc_avalanche: 'الانهيار (الأعلى فائدة أولًا)',
  calc_result: '{months} أشهر لتصبح بلا ديون · الفائدة تقريبًا {interest}',
  calc_months_one: 'شهر واحد لتصبح بلا ديون · الفائدة تقريبًا {interest}',
  calc_order: 'ترتيب السداد:',
  calc_free: 'ليس لديك ديون متبقية! 🎉',
  calc_warn: 'بذلك الدفع الشهري، لن يُسدَّد بعض الديون أبدًا: الدفع لا يغطّي حتى الفائدة. ارفع الدفع الشهري.',
  calc_note_zero: 'الديون التي ليس لها حد أدنى أو فائدة مسجّلة تُحسَب بحد أدنى $0 وفائدة 0%.',
  calc_err_budget: 'اكتب كم يمكنك أن تدفع شهريًا.',
  debt_interest_label: 'الفائدة السنوية % (اختياري)',
  debt_minpay_label: 'الحد الأدنى الشهري $ (اختياري)',
  debt_terms: 'فائدة سنوية {pct}% · الحد الأدنى {min}/شهر',
  exp_photo_label: 'صورة الإيصال (اختياري)',
  exp_photo_remove: 'إزالة الصورة',
  photo_close: 'إغلاق',
  err_photo_quota: 'لم تكن هناك مساحة لحفظ الصورة: حُفظ المصروف بدونها.',
  banner_backup: 'مرّ وقت منذ حفظت نسخة من بياناتك. صدّر نسختك من الإعدادات.',
  pro_title: 'PETO Pro',
  pro_card_text: 'سحابة غير محدودة لبياناتك، التقرير المتقدّم، الميزانية المشتركة ووضع منظّم الـ san.',
  pro_status_free: 'أنت على الخطة المجانية الآن.',
  pro_status_active: 'PETO Pro مفعّل. شكرًا لدعمك PETO Finanzas! ⭐',
  pro_status_test: 'PETO Pro مفتوح أثناء الاختبار المغلق: لديك وصول كامل ما دام الاختبار قائمًا.',
  pro_status_waitlist: 'أنت على قائمة انتظار PETO Pro.',
  pro_btn_see: 'عرض PETO Pro',
  pro_wall_title: 'هذه ميزة من PETO Pro ⭐',
  pro_price_line: 'فقط $1.99 شهريًا',
  pro_benefit_cloud: '☁️ سحابة غير محدودة لبياناتك',
  pro_benefit_report: '📊 التقرير المتقدّم: قارن الأشهر وصدّر CSV',
  pro_benefit_shared: '🏠 ميزانية مشتركة مع منزلك',
  pro_benefit_org: '🤝 وضع منظّم الـ san: tanda المجموعة كلها',
  pro_coming_text: 'تصل الشراءات داخل التطبيق مع إطلاق Google Play. في هذه الأثناء يمكنك الانضمام إلى قائمة الانتظار: سنعلمك فور أن تتمكن من تفعيل Pro مقابل $1.99 شهريًا.',
  pro_waitlist_btn: 'الانضمام إلى قائمة الانتظار',
  pro_waitlist_done: 'أنت على القائمة ✅ سنعلمك عندما يتاح Pro.',
  pro_close: 'ليس الآن',
  pro_tag: 'PRO',
  adv_title: 'التقرير المتقدّم',
  adv_note: 'ميزة من PETO Pro: هذا الشهر مقابل السابق، كل فئة وتصدير CSV للشهر.',
  adv_open_btn: 'عرض التقرير المتقدّم',
  adv_export_csv: 'تصدير الشهر كـ CSV',
  adv_this_month: 'هذا الشهر',
  adv_prev_month: 'الشهر السابق',
  adv_change: 'التغيّر',
  adv_all_cats: 'كل الفئات',
  adv_empty: 'لا نشاط في هذين الشهرين.',
  org_title: 'وضع منظّم الـ san',
  org_intro: 'أدر tanda المجموعة كلها: جولات مؤرّخة، ضع علامة على من دفع في كل جولة وشارك الحالة مع المجموعة.',
  org_pro_note: 'وضع المنظّم ميزة من PETO Pro.',
  org_form_title: 'إنشاء san المجموعة',
  org_freq_label: 'تكرار الجولات',
  org_freq_semanal: 'أسبوعيًا',
  org_freq_quincenal: 'كل أسبوعين',
  org_freq_mensual: 'شهريًا',
  org_start_label: 'تاريخ الجولة الأولى',
  org_create_btn: 'إنشاء san منظّم',
  org_round: 'الجولة {x} من {n}',
  org_receiver_line: 'يستلم: {name}',
  org_pending_none: 'دفع الجميع! 🎉',
  org_pending_list: 'ما زال عليهم الدفع: {names}',
  org_pending_count_one: 'تبقّى 1',
  org_pending_count_many: 'تبقّى {n}',
  org_totals_title: 'المساهمات حسب المشارك',
  org_paid_rounds: 'دُفعت {paid} من {n} جولات',
  org_delete: 'حذف الـ san المنظّم',
  org_delete_confirm: 'حذف الـ san المنظّم «{name}»؟ سيُفقد سجل دفعات المجموعة.',
  org_share_title: 'حالة الـ san',
  shared_live_note: 'شارك الميزانية مع منزلك: أنشئ منزلًا أو انضم برمز وسترون الأعضاء أنفسهم. تحتاج إلى حسابك السحابي (أعلاه، في الإعدادات) وPETO Pro.',
  shared_leave_live: 'مغادرة هذا المنزل؟ لن ترى ميزانيته المشتركة بعد الآن.',
  shared_err_login: 'سجّل الدخول أولًا بحسابك السحابي (أعلاه، في الإعدادات) وحاول مجددًا.',
  shared_err_generic: 'تعذّر الإكمال. تحقق من اتصالك وحاول مجددًا.',
  shared_err_code_live: 'ذلك الرمز غير موجود. تحقق منه وحاول مجددًا.',
  shared_err_member: 'أنت عضو في هذا المنزل بالفعل.',
  shared_err_owner_leave: 'أنت مالك هذا المنزل: لا يمكنك المغادرة دون حذفه. اطلب من عضو آخر إنشاء المنزل الجديد.',
  shared_created_live: 'تم إنشاء المنزل ✅ شارك الرمز لدعوة منزلك.',
  shared_joined_live: 'انضممت إلى المنزل ✅',
  lang_auto: 'تلقائي (لغة الهاتف)',
  org_comp_label: 'تعويض المنظم',
  org_comp_none: 'بدون تعويض',
  org_comp_first: 'المنظم يقبض أولًا',
  org_comp_last: 'المنظم يقبض أخيرًا',
  org_comp_extra: 'رسوم إضافية لكل جولة',
  org_comp_amount_label: 'رسوم إضافية لكل شخص ($)',
  org_comp_line: 'تعويض المنظم: {mode}',
  org_sim_title: 'محاكاة الوعاء',
  org_sim_pays: 'كل مشارك يضع في كل جولة: {amount}',
  org_sim_pot: 'وعاء كل جولة: {amount}',
  org_sim_total_in: 'المجموع الذي يضعه كل شخص في كامل الـ san: {amount}',
  org_sim_extra_org: 'يتلقى المنظم {amount} إضافية في كل جولة',
  org_sim_first: 'يتلقى المنظم وعاء الجولة الأولى',
  org_sim_last: 'يتلقى المنظم وعاء الجولة الأخيرة',
  org_shuffle_btn: '🎲 خلط الترتيب',
  org_shuffled: '🎲 تم خلط الترتيب! هذا هو الترتيب الجديد.',
  org_shuffle_need: 'أضف مشاركَين على الأقل لخلط الترتيب.',
  org_shuffle_blocked: 'لم يعد الخلط ممكنًا: بدأ السان أو توجد مدفوعات مسجلة.',
  org_start_btn: 'بدء الـ san',
  org_started_line: 'الـ san جارٍ · الترتيب مقفل',
  org_order_title: 'ترتيب الأدوار',
  org_move_up: 'لأعلى',
  org_move_down: 'لأسفل',
  org_swap_blocked: 'ذلك الدور فيه مدفوعات بالفعل ولا يمكن تغييره.',
  org_history_title: 'سجل التغييرات',
  org_history_swap: 'تبادل {a} و{b} الأدوار',
  org_history_started: 'بدأ المنظم الـ san',
  org_pay_pending: 'قيد الانتظار',
  org_pay_reported: 'تم الإبلاغ',
  org_pay_confirmed: 'تم التأكيد',
  org_status_btn: 'الحالة: {status}',
  org_receipt_add: '📎 الإيصال',
  org_receipt_view: 'عرض الإيصال',
  org_receipt_remove: 'إزالة',
  org_zelle_label: 'Zelle لكل مشارك (رقم أو بريد، اختياري)',
  org_zelle_ph: 'Zelle (اختياري)',
  org_zelle_line: 'Zelle: {zelle}',
  org_reminder_btn: '📲 تذكير واتساب',
  org_reminder_head: '🤝 {san} · الجولة {x} من {n} · {date}',
  org_reminder_receiver: '💰 هذا الأسبوع يقبض {name}',
  org_reminder_zelle: 'Zelle الخاص بـ {name}: {zelle}',
  org_reminder_amount: 'مساهمة الجولة: {amount}',
  org_antifraud: '🛡️ الـ san لا يدفع فوائد أبدًا ولا أكثر مما تم وضعه.',
  org_link_btn: '🔗 رابط للقراءة فقط',
  org_link_publish: 'إنشاء الرابط',
  org_link_update: 'تحديث الرابط',
  org_link_copied: 'تم نسخ الرابط!',
  org_link_need_cloud: 'يحتاج الرابط إلى حسابك السحابي: سجّل الدخول في الإعدادات وحاول مجددًا.',
  org_link_ready: 'San المجموعة (للقراءة فقط)',
  org_public_title: 'الرابط جاهز للمشاركة.',
  org_public_updated: 'تم التحديث في {date}',
  org_public_notfound: 'هذا الرابط لم يعد متاحًا.',
  org_pub_pay_btn: 'دفعت',
  org_pub_confirm: 'هل دفعت حصتك في هذه الجولة بالفعل؟ سيؤكدها المنظم.',
  org_pub_attach: '📎 إرفاق صورة الإيصال (اختياري)',
  org_pub_send: 'إرسال الإبلاغ',
  org_pub_sent: 'تم! تم الإبلاغ عن دفعتك.',
  org_pub_reported_note: 'تم الإبلاغ · بانتظار التأكيد',
  org_pub_err: 'تعذر الإرسال. تحقق من اتصالك وحاول مجددًا.',
  org_pub_err_confirmed: 'لقد أكد المنظم هذه الدفعة بالفعل.',
  org_pub_err_photo: 'الصورة كبيرة جدًا؛ جرّب صورة أصغر.',
  org_penalty_label: 'قاعدة التأخير',
  org_penalty_none: 'بدون غرامة',
  org_penalty_fixed: 'غرامة ثابتة',
  org_penalty_percent: 'نسبة من المساهمة',
  org_penalty_amount_label: 'مبلغ الغرامة ($)',
  org_penalty_percent_label: 'نسبة الغرامة (%)',
  org_penalty_line_fixed: 'إذا تأخر أحد: غرامة {amount}',
  org_penalty_line_percent: 'إذا تأخر أحد: غرامة {percent}% من المساهمة',
  set_news_title: 'ما الجديد',
  news_c24: 'Compilación 24: جولة ترحيبية، سلسلة أيام التسجيل، أهداف ادخار مع شريط تقدم ورسم بياني للاتجاه.',
  news_c25: 'Compilación 25: ودجت على الشاشة الرئيسية وتطبيق أخف بكثير (من 52 ميغابايت إلى 7 ميغابايت).',
  news_c26: 'Compilación 26: ودجت بثلاثة أحجام، مع خيارات لكل ودجت وزر لتسجيل مصروف دون فتح التطبيق.',
  news_c27: 'Compilación 27: التطبيق بـ12 لغة، يتبع تلقائيًا لغة هاتفك.',
  news_c28: 'Compilación 28: نص أكبر يُطبَّق من بدء التشغيل، قسم «ما الجديد» هذا، مراجعة النصوص الإيطالية وبدء أسرع.',
  news_c31: 'Compilación 31: زر الرجوع أو إيماءته يتحرك الآن داخل التطبيق: يغلق ما هو مفتوح ويعود إلى الشاشة الرئيسية قبل الخروج.',
  news_c32: 'الإصدار 32: تظهر العلامة الآن باسم «PETO Finanzas» في التطبيق بأكمله (القائمة وشاشة القفل والأدوات)، وأصبح السان في أعلى قائمة الشاشة الرئيسية، ويفتح الرابط العام للسان حالة المجموعة مباشرة، وترد أزرار المنظّم دائمًا برسالة واضحة.',
  news_c33: 'الإصدار 33: إنشاء سان لم يعد بإمكانه مسح السان الجاري — إذا كان هناك سان نشط، يخبرك التطبيق ويحميه (المدفوعات والإيصالات والسجل والرابط العام) — وأصبحت نسخة الويب متزامنة الآن مع الهاتف.',
  news_c34: 'الإصدار 34: شعار PETO Finanzas الجديد — حرف «P» الأبيض مع أشرطة وسهم باللون الأخضر الفاتح على خلفية زمردية، الآن في الأيقونة وشاشة القفل وفي التطبيق بأكمله.',
  news_c35: 'الإصدار 35: من رابط san العام يمكنك الآن الإبلاغ عن دفعتك بزر «دفعت» وإرفاق الإيصال (يؤكده المنظم)، وأصبح العارض العام بالمظهر الداكن، ويُحدَّث التطبيق بالسحب لأسفل، وقارئ PDF لم يعد يخلط مدفوعات Zelle التي ترسلها بالدخل.',
  sec_podcast: 'بودكاست',
  key_podcast: 'Finanzas Personales، البودكاست',
  pod_hosts: 'مع Lucía و Marco',
  pod_desc: 'المال بلا تعقيد: نصائح عملية للادخار والخروج من الديون والعناية بمحفظتك، في حلقات قصيرة.',
  pod_spotify_btn: 'استمع على Spotify',
  pod_loading: 'جارٍ تحميل الحلقات…',
  pod_offline: 'لا يوجد اتصال: يتم عرض آخر قائمة تم تنزيلها',
  pod_error: 'تعذر تحميل الحلقات. تحقق من اتصالك وحاول مرة أخرى.',
  pod_empty: 'لا توجد حلقات منشورة بعد.',
  pod_play_aria: 'تشغيل',
  pod_pause_aria: 'إيقاف مؤقت',
  pod_audio_error: 'تعذر تشغيل هذه الحلقة.',
  pub_tagline: 'سانك منظم وشفاف',
  pub_progress: 'تم تأكيد {x} من {n} دفعة',
  pub_progress_start: 'البداية فقط: لا توجد دفعات مؤكدة بعد',
  pub_cta_title: 'هل تريد تنظيم السان الخاص بك؟',
  pub_cta_text: 'مع PETO Finanzas يبقى الترتيب والأدوار والإيصالات في مكان واحد — بلا دفاتر ولا فوضى.',
  pub_cta_try: 'جرّب PETO Finanzas',
  pub_cta_more: 'اعرف المزيد',
  pub_bar_try: 'جرّب التطبيق',
  pub_footer: 'صُنع بواسطة PETO Finanzas · petofinanzas.com',
  news_c36: 'الإصدار 36: قسم بودكاست جديد — استمع إلى «Finanzas Personales» دون مغادرة التطبيق، مع مشغّل مدمج وقائمة محفوظة لأوقات عدم وجود إنترنت — شاشة الترحيب الآن تتقدّم من تلقاء نفسها، شريحة بعد شريحة — ومظهر الرابط متجدد: يعرض san تقدّمه ووصولًا مباشرًا لتجربة التطبيق.',
  news_c37: 'الإصدار 37: ويدجت بمظهر جديد — تدرّج العلامة، شريط تقدّم يتغيّر لونه حسب ميزانيتك وسطر الدور التالي في san الخاص بك — وويدجت جديد بحجم أيقونة يعرض ما يمكنك إنفاقه اليوم. وتبقى العلامة ظاهرة أثناء التمرير في رابط san العام. وجولات المنظّم الآن تُطوى كالأكورديون: جولة هذا الأسبوع فقط مفتوحة.',
  widget_today: 'اليوم',
  widget_san_next: 'الدور التالي: {name} · {date}',
  widget_san_next_nodate: 'الدور التالي: {name}',
  back_exit_hint: 'اضغط رجوع مرة أخرى للخروج.'
}
};
/* Resuelve el idioma automático: coincidencia exacta con un idioma
   soportado, luego el idioma base (es-DO → es, zh-Hans → zh); si el
   teléfono está en un idioma no soportado, inglés. */
function detectLang(tag) {
  const raw = String(tag != null ? tag : (typeof navigator !== 'undefined' ? navigator.language : '') || '').trim().toLowerCase().replace(/_/g, '-');
  if (!raw) return 'en';
  if (LANGS.includes(raw)) return raw;
  const base = raw.split('-')[0];
  return LANGS.includes(base) ? base : 'en';
}
/* El idioma efectivo: el ajuste concreto manda; 'auto' se resuelve. */
function lang() {
  const s = db && db.settings ? db.settings.lang : null;
  return (s && s !== 'auto' && LANGS.includes(s)) ? s : detectLang();
}
/* Valida un valor del selector: un idioma concreto o 'auto'. */
function validLangSetting(v) { return (v === 'auto' || LANGS.includes(v)) ? v : 'auto'; }
function localeTag() { return LOCALES[lang()] || 'en-US'; }
function t(key, vars) {
  let s = (I18N[lang()] && I18N[lang()][key]) || I18N.es[key] || key;
  if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(String(vars[k]));
  return s;
}
/* Nombre visible de una categoría: las predefinidas se traducen; las
   personalizadas se muestran tal como la persona las escribió. */
function catName(cat) { return DEFAULT_CATEGORIES.includes(cat) ? t('cat_' + cat) : cat; }
function applyStaticI18n() {
  document.querySelectorAll('[data-i18n]').forEach((n) => { const k = n.getAttribute('data-i18n'); n.textContent = k === 'footer' ? t('footer') + ' · ' + BUILD_LABEL : t(k); });
  document.querySelectorAll('[data-i18n-ph]').forEach((n) => { n.setAttribute('placeholder', t(n.getAttribute('data-i18n-ph'))); });
  document.querySelectorAll('[data-i18n-aria]').forEach((n) => { n.setAttribute('aria-label', t(n.getAttribute('data-i18n-aria'))); });
  document.documentElement.lang = lang();
  /* Árabe: la base RTL v1 pone la dirección del documento; el CSS no se
     reescribe por idioma (limitación conocida). */
  document.documentElement.dir = lang() === 'ar' ? 'rtl' : 'ltr';
  document.title = t('app_title');
}

function uid() {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
const _fmtCache = {};
function fmtMoney(cents) {
  const l = localeTag();
  if (!_fmtCache[l]) _fmtCache[l] = new Intl.NumberFormat(l, { style: 'currency', currency: 'USD' });
  return _fmtCache[l].format((cents || 0) / 100);
}
/* Modo privacidad: con un toque en el ojo de la cabecera, todos los
   montos EN PANTALLA se muestran como ••••. No se guarda: al cerrar la
   app vuelve a la vista normal. Lo que el usuario exporta o comparte a
   propósito usa fmtMoney y sale con sus números. */
let privacyOn = false;
function fmt(cents) {
  return privacyOn ? '••••' : fmtMoney(cents);
}
function togglePrivacy() {
  privacyOn = !privacyOn;
  const btn = document.getElementById('btn-privacy');
  if (btn) {
    btn.textContent = privacyOn ? '🙈' : '👁';
    btn.setAttribute('aria-label', t(privacyOn ? 'privacy_show' : 'privacy_hide'));
  }
  showView(currentView);
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function currentMonthKey() { return todayStr().slice(0, 7); }
function monthKeyOf(dateStr) { return String(dateStr).slice(0, 7); }
function monthLabel(key) {
  const parts = key.split('-');
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
  const s = new Intl.DateTimeFormat(localeTag(), { month: 'long', year: 'numeric' }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function shiftMonth(key, delta) {
  const parts = key.split('-');
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1 + delta, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function prettyDate(dateStr) {
  const parts = String(dateStr).split('-');
  if (parts.length !== 3) return dateStr;
  return lang() === 'en'
    ? parts[1] + '/' + parts[2] + '/' + parts[0]
    : parts[2] + '/' + parts[1] + '/' + parts[0];
}
/* Cantidad escrita por el usuario -> centavos (o null si no es válida). */
function parseAmount(raw, allowNegative) {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().replace(',', '.');
  if (!/^-?\d{1,7}(\.\d{1,2})?$/.test(t)) return null;
  const cents = Math.round(Number(t) * 100);
  if (!Number.isFinite(cents)) return null;
  if (!allowNegative && cents <= 0) return null;
  if (Math.abs(cents) > MAX_MONEY_CENTS) return null;
  return cents;
}
function splitCents(amountCents, split) {
  const ahorro = Math.round(amountCents * split.ahorro / 100);
  const negocio = Math.round(amountCents * split.negocio / 100);
  const gastos = Math.round(amountCents * split.gastos / 100);
  const familia = amountCents - ahorro - negocio - gastos;
  return { ahorro, negocio, gastos, familia };
}
function allCategories(data) { return DEFAULT_CATEGORIES.concat((data || db).customCategories); }

/* Crea un elemento con texto seguro (nunca innerHTML con datos del usuario). */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}
function clearNode(node) { while (node.firstChild) node.removeChild(node.firstChild); }
function actionButton(label, className, onClick) {
  const b = el('button', 'btn btn-small ' + (className || 'btn-ghost'), label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}
function showError(id, msg) {
  const e = document.getElementById(id);
  if (!e) return;
  e.textContent = msg || '';
  e.hidden = !msg;
}

/* ---------------- PIN (hash con sal, nunca en texto plano) ---------------- */
async function hashPin(pin, saltHex) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(saltHex + ':' + pin));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
function newSalt() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
async function setPin(pin) {
  if (!pin) { db.settings.pinSalt = null; db.settings.pinHash = null; return; }
  const salt = newSalt();
  db.settings.pinSalt = salt;
  db.settings.pinHash = await hashPin(pin, salt);
}
async function checkPin(pin) {
  if (!db.settings.pinHash) return true;
  return (await hashPin(pin, db.settings.pinSalt)) === db.settings.pinHash;
}
function validPinFormat(pin) { return /^[0-9]{4,6}$/.test(pin); }

/* ---------------- Navegación ---------------- */
const VIEW_IDS = ['home', 'gastos', 'ingresos', 'ahorros', 'buscar', 'resumen', 'presupuesto', 'pagos', 'cuentas', 'deudas', 'remesas', 'san', 'podcast', 'ajustes'];
let currentView = 'home';
function showView(name) {
  /* Compilación 36: al salir de la vista del Podcast, la reproducción
     se pausa (decisión documentada en el bloque del Podcast). */
  if (currentView === 'podcast' && name !== 'podcast') podcastPause();
  if (name !== 'home' && name !== 'ajustes' && db.settings.sections[name] === false) name = 'home';
  currentView = name;
  for (const v of VIEW_IDS) {
    const node = document.getElementById('view-' + v);
    if (node) node.hidden = v !== name;
  }
  window.scrollTo(0, 0);
  if (name === 'home') renderHome();
  if (name === 'gastos') { renderExpenses(); checkBudgetAlerts(); }
  if (name === 'ingresos') renderIncomes();
  if (name === 'ahorros') renderSavings();
  if (name === 'buscar') renderSearch();
  if (name === 'resumen') renderResumen();
  if (name === 'presupuesto') { renderBudgets(); checkBudgetAlerts(); }
  if (name === 'pagos') renderFixed();
  if (name === 'cuentas') renderAccounts();
  if (name === 'deudas') renderDebts();
  if (name === 'remesas') renderRemittances();
  if (name === 'san') { renderSan(); renderSanOrg(); }
  if (name === 'podcast') renderPodcast();
  if (name === 'ajustes') renderSettings();
}

/* ---------------- Menú lateral (botón ☰) ----------------
   El botón de la cabecera abre este panel desde cualquier pantalla.
   Se vuelve a dibujar en cada apertura: respeta las secciones apagadas
   en Ajustes, marca la pantalla actual e incluye Ajustes y Bloquear. */
function drawerItem(id, icon, nameKey, keyText) {
  const item = el('button', 'menu-item' + (currentView === id ? ' active' : ''));
  item.type = 'button';
  item.appendChild(el('span', 'menu-icon', icon));
  const text = el('span', 'menu-text');
  text.appendChild(el('span', 'menu-name', t(nameKey)));
  if (keyText) text.appendChild(el('span', 'menu-key', keyText));
  item.appendChild(text);
  item.appendChild(el('span', 'menu-arrow', '›'));
  item.addEventListener('click', () => { closeMenu(); showView(id); });
  return item;
}
function renderDrawer() {
  const list = document.getElementById('drawer-list');
  clearNode(list);
  document.getElementById('drawer-user').textContent =
    db.settings.name ? t('greeting') + ', ' + db.settings.name : '';
  const homeGroup = el('div', 'menu-group');
  homeGroup.appendChild(drawerItem('home', '🏠', 'sec_home', t('key_home')));
  list.appendChild(homeGroup);
  const groups = [];
  for (const def of SECTION_DEFS) {
    if (db.settings.sections[def.id] === false) continue;
    if (!groups.includes(def.group)) groups.push(def.group);
  }
  for (const group of groups) {
    const wrap = el('div');
    wrap.appendChild(el('p', 'menu-group-title', t('group_' + group)));
    const gl = el('div', 'menu-group');
    for (const def of SECTION_DEFS) {
      if (def.group !== group || db.settings.sections[def.id] === false) continue;
      gl.appendChild(drawerItem(def.id, def.icon, 'sec_' + def.id, menuKeyText(def.id)));
    }
    wrap.appendChild(gl);
    list.appendChild(wrap);
  }
  const adjWrap = el('div');
  adjWrap.appendChild(el('p', 'menu-group-title', t('group_yourapp')));
  const adjList = el('div', 'menu-group');
  adjList.appendChild(drawerItem('ajustes', '⚙️', 'sec_ajustes', t('key_settings')));
  if (db.settings.pinHash) {
    const lock = el('button', 'menu-item');
    lock.type = 'button';
    lock.appendChild(el('span', 'menu-icon', '🔒'));
    const lt = el('span', 'menu-text');
    lt.appendChild(el('span', 'menu-name', t('lock_btn')));
    lock.appendChild(lt);
    lock.addEventListener('click', () => { closeMenu(); showLock(); });
    adjList.appendChild(lock);
  }
  adjWrap.appendChild(adjList);
  list.appendChild(adjWrap);
}
function openMenu() {
  renderDrawer();
  const wrap = document.getElementById('menu-drawer-wrap');
  wrap.hidden = false;
  requestAnimationFrame(() => wrap.classList.add('open'));
  document.getElementById('btn-menu').setAttribute('aria-expanded', 'true');
}
function closeMenu() {
  const wrap = document.getElementById('menu-drawer-wrap');
  if (!wrap || wrap.hidden) return;
  wrap.classList.remove('open');
  wrap.hidden = true;
  document.getElementById('btn-menu').setAttribute('aria-expanded', 'false');
}

/* ---------------- Botón / gesto de atrás del teléfono (Compilación 31) ----------------
   Pedido de Sterlin: que el atrás navegue DENTRO de la app en vez de
   cerrarla de golpe. Lo escucha el plugin App de Capacitor
   (@capacitor/app, evento «backButton»): al registrar el listener,
   Android ya no aplica su comportamiento por defecto y la app decide
   cada pulsación con handleHardwareBack(). En web no hay plugin y no
   se toca nada: el historial del navegador sigue mandando.
   Orden de cada pulsación (de lo más externo a lo más interno):
   1. Pantallas raíz (visor público del san, bloqueo o bienvenida,
      cuando #app-shell está oculto): salir, como siempre.
   2. Menú lateral abierto: cerrarlo.
   3. Visor de foto abierto: cerrarlo.
   4. Hoja inferior abierta (selector «+», oferta de huella o muro
      Pro): cerrarla.
   5. Vista previa de importar (CSV/PDF) visible: cancelarla.
   6. Panel «Secciones visibles» abierto en Ajustes: plegarlo.
   7. Cualquier sección que no sea la principal: volver a ella.
   8. Ya en la principal: la primera pulsación avisa con un mensaje
      breve («Pulsa atrás otra vez para salir») y solo la segunda,
      dentro de 2,5 s, sale con App.exitApp(). Nadie queda atrapado:
      dos atrás seguidos salen, sin más fricción.
   handleHardwareBack() devuelve qué hizo ('exit', 'drawer', 'photo',
   'sheet', 'panel', 'home' o 'arm-exit') para que las pruebas lo
   verifiquen sin teléfono. */
let backExitArmedAt = 0;
function handleHardwareBack() {
  const shell = document.getElementById('app-shell');
  if (!shell || shell.hidden) return 'exit';
  const drawer = document.getElementById('menu-drawer-wrap');
  if (drawer && !drawer.hidden) { closeMenu(); return 'drawer'; }
  const photo = document.getElementById('photo-overlay');
  if (photo && !photo.hidden) { photo.hidden = true; return 'photo'; }
  for (const id of ['quick-chooser', 'bio-offer', 'pro-paywall']) {
    const sheet = document.getElementById(id);
    if (sheet && !sheet.hidden) { sheet.hidden = true; return 'sheet'; }
  }
  const csvPrev = document.getElementById('csv-preview');
  if (csvPrev && !csvPrev.hidden) { onCsvCancel(); return 'panel'; }
  if (currentView === 'ajustes') {
    const body = document.getElementById('sections-body');
    if (body && !body.hidden) { toggleSectionsBody(); return 'panel'; }
  }
  if (currentView !== 'home') { showView('home'); return 'home'; }
  const now = Date.now();
  if (now - backExitArmedAt < 2500) { backExitArmedAt = 0; return 'exit'; }
  backExitArmedAt = now;
  showToastMsg(t('back_exit_hint'));
  return 'arm-exit';
}
function initHardwareBack() {
  const App = capPlugin('App');
  if (!App || typeof App.addListener !== 'function') return;
  try {
    App.addListener('backButton', () => {
      if (handleHardwareBack() === 'exit') {
        try {
          const p = App.exitApp();
          if (p && typeof p.catch === 'function') p.catch(() => { /* sin salida nativa no se insiste */ });
        } catch (e) { /* sin salida nativa no se insiste */ }
      }
    });
  } catch (e) { /* sin listener, Android aplica su comportamiento de siempre */ }
}

function monthIncomes(key) { return db.incomes.filter((i) => monthKeyOf(i.date) === key); }
function monthExpenses(key) { return db.expenses.filter((e) => monthKeyOf(e.date) === key); }
function sumCents(list) { return list.reduce((t, x) => t + x.amountCents, 0); }
/* El ahorro NUNCA se calcula solo: el total del mes suma lo que la persona
   anotó en cada ingreso (savingsCents) más los ahorros sueltos que agregó a
   mano en la sección Ahorros (db.savings). El porcentaje solo es sugerencia. */
function monthSavings(key) {
  const fromIncomes = monthIncomes(key).reduce((t, i) => t + (i.savingsCents || 0), 0);
  const standalone = db.savings.filter((s) => monthKeyOf(s.date) === key)
    .reduce((t, s) => t + s.amountCents, 0);
  return fromIncomes + standalone;
}
function pendingDebtsTotal() {
  return db.debts.filter((d) => d.status === 'pendiente').reduce((t, d) => t + d.amountCents, 0);
}
function availableMoney(key) {
  if (db.accounts.length > 0) return db.accounts.reduce((t, a) => t + a.balanceCents, 0);
  return sumCents(monthIncomes(key)) - sumCents(monthExpenses(key));
}

function goalPct() {
  if (!db.savingsGoal) return 0;
  return Math.min(100, Math.floor(allSavingsTotal() / db.savingsGoal.targetCents * 100));
}
function menuKeyText(id) {
  const key = currentMonthKey();
  if (id === 'gastos') return t('key_spent_month', { amount: fmt(sumCents(monthExpenses(key))) });
  if (id === 'ingresos') return t('key_income_month', { amount: fmt(sumCents(monthIncomes(key))) });
  if (id === 'ahorros') {
    let s = t('key_saved_total', { amount: fmt(allSavingsTotal()) });
    if (db.savingsGoal) s += t('key_goal_suffix', { name: db.savingsGoal.name, pct: goalPct() });
    return s;
  }
  if (id === 'resumen') return t('key_spent_month', { amount: fmt(sumCents(monthExpenses(key))) });
  if (id === 'presupuesto') {
    const n = Object.keys(db.budgets).filter((k) => db.budgets[k] > 0).length;
    return t(n === 1 ? 'key_budget_one' : 'key_budget_many', { n: n });
  }
  if (id === 'pagos') {
    const pend = db.fixed.filter((f) => !f.paidMonths[key]).length;
    return t('key_fixed', { amount: fmt(sumCents(db.fixed)), n: pend });
  }
  if (id === 'cuentas') return t('key_available', { amount: fmt(availableMoney(key)) });
  if (id === 'deudas') return t('key_debts', { amount: fmt(pendingDebtsTotal()) });
  if (id === 'remesas') {
    const m = monthRemittances(currentMonthKey());
    return t('key_remesas', { amount: fmt(m.reduce((t2, r) => t2 + r.usdCents, 0)) });
  }
  if (id === 'san') {
    if (db.san) {
      if (db.san.currentWeek >= db.san.participants.length) return t('key_san_done');
      return t('key_san', { x: db.san.currentWeek + 1, n: db.san.participants.length, name: db.san.participants[db.san.currentWeek] });
    }
    /* Compilación 32: si solo hay san del organizador, el subtítulo
       también va vivo: ronda actual, quién recibe y la fecha. */
    if (db.sanOrg) {
      const org = db.sanOrg;
      const n = org.participants.length;
      const cur = orgCurrentRound(org);
      if (cur >= n) return t('key_san_done');
      return t('key_san', { x: cur + 1, n: n, name: org.participants[cur] }) + ' · ' + prettyDate(orgRoundDate(org, cur));
    }
    return t('key_san_none');
  }
  if (id === 'podcast') return t('key_podcast');
  return '';
}

/* ---------------- Recordatorios (avisos en Inicio) ----------------
   Sin notificaciones push (imposible en un archivo local): son avisos
   dentro de la app. Cerrar un aviso lo oculta solo por hoy. */
const BANNER_KEY = 'cgastos.banners.v1';
function bannerState() {
  try {
    const raw = JSON.parse(localStorage.getItem(BANNER_KEY) || 'null');
    if (raw && raw.date === todayStr()) return raw;
  } catch (e) { /* estado dañado: se ignora */ }
  return { date: todayStr(), payday: false, dues: false };
}
function dismissBanner(kind) {
  const st = bannerState();
  st[kind] = true;
  try { localStorage.setItem(BANNER_KEY, JSON.stringify(st)); } catch (e) { /* sin espacio: se ignora */ }
  renderHome();
}
function dueSoonFixed() {
  const key = currentMonthKey();
  const todayDay = Number(todayStr().slice(8, 10));
  return db.fixed.filter((f) => !f.paidMonths[key] && f.day <= todayDay + 2);
}
function makeBanner(text, onClose) {
  const box = el('div', 'banner');
  box.appendChild(el('span', 'banner-text', text));
  const close = el('button', 'banner-close', '✕');
  close.type = 'button';
  close.setAttribute('aria-label', t('banner_close'));
  close.addEventListener('click', onClose);
  box.appendChild(close);
  return box;
}
/* ---------------- Aviso de respaldo ----------------
   Si hay datos y nunca se exportó una copia (o la última fue hace más
   de 30 días), Inicio recuerda exportar. Cerrar el aviso lo oculta
   solo por esta semana. */
const BACKUP_BANNER_KEY = 'cgastos.backupbanner.v1';
function hasAnyData() {
  return db.expenses.length + db.incomes.length + db.savings.length +
    db.fixed.length + db.accounts.length + db.debts.length > 0;
}
function backupStale() {
  if (!hasAnyData()) return false;
  if (!db.lastExportAt) return true;
  return (Date.now() - Date.parse(db.lastExportAt)) / 86400000 > 30;
}
function backupBannerDismissed() {
  try { return localStorage.getItem(BACKUP_BANNER_KEY) === weekStartOf(todayStr()); }
  catch (e) { return false; }
}
function dismissBackupBanner() {
  try { localStorage.setItem(BACKUP_BANNER_KEY, weekStartOf(todayStr())); } catch (e) { /* sin espacio: se ignora */ }
  renderHome();
}
function renderBanners() {
  const wrap = document.getElementById('home-banners');
  clearNode(wrap);
  if (!db.settings.reminders) return;
  const st = bannerState();
  if (db.settings.payday !== null && db.settings.payday !== undefined &&
      new Date().getDay() === db.settings.payday && !st.payday) {
    wrap.appendChild(makeBanner(t('banner_payday'), () => dismissBanner('payday')));
  }
  const dues = dueSoonFixed();
  if (dues.length > 0 && !st.dues) {
    const list = dues.map((f) => t('banner_due_item', { name: f.name, day: f.day })).join(', ');
    wrap.appendChild(makeBanner(t('banner_dues_title') + ' ' + list, () => dismissBanner('dues')));
  }
  const bals = budgetAlerts();
  if (bals.length && !st.budget) {
    const a = bals[0];
    wrap.appendChild(makeBanner(
      t(a.over ? 'bud_alert_over' : 'bud_alert_warn', { cat: catName(a.cat), pct: a.pct }),
      () => dismissBanner('budget')));
  }
  if (backupStale() && !backupBannerDismissed()) {
    wrap.appendChild(makeBanner(t('banner_backup'), dismissBackupBanner));
  }
}

/* ---------------- ¿Cuánto puedes gastar hoy? ---------------- */
function daysInMonth(key) {
  const p = key.split('-');
  return new Date(Number(p[0]), Number(p[1]), 0).getDate();
}
/* Presupuesto total del mes según la Fase 1: la suma de los presupuestos
   por categoría (db.budgets) si hay alguno; si no hay ninguno, el total
   de ingresos registrados en el mes; si tampoco hay, 0 (sin base). */
function monthlyBudgetTotalCents(key) {
  let total = 0;
  for (const cat of Object.keys(db.budgets)) {
    const b = db.budgets[cat] || 0;
    if (b > 0) total += b;
  }
  if (total > 0) return total;
  return sumCents(monthIncomes(key));
}
/* Días que quedan del mes en curso, incluido hoy. */
function daysLeftInMonth(key) {
  return daysInMonth(key) - Number(todayStr().slice(8, 10)) + 1;
}
/* Número diario de Inicio: (presupuesto total del mes − gastos del mes)
   ÷ días restantes, nunca negativo. Si ya se gastó todo el presupuesto,
   el diario es $0 y la tarjeta avisa. Sin presupuestos ni ingresos
   devuelve null: la tarjeta muestra la guía y ningún número inventado. */
function dailySpendInfo() {
  const key = currentMonthKey();
  const total = monthlyBudgetTotalCents(key);
  if (total <= 0) return null;
  const spent = sumCents(monthExpenses(key));
  const left = total - spent;
  return {
    total: total, spent: spent, left: left,
    daysLeft: daysLeftInMonth(key), over: left <= 0,
    daily: left > 0 ? Math.floor(left / daysLeftInMonth(key)) : 0
  };
}
function renderSpendToday() {
  const valueEl = document.getElementById('spend-today');
  const noteEl = document.getElementById('spend-today-note');
  const leftEl = document.getElementById('spend-today-left');
  if (!valueEl || !noteEl) return;
  const info = dailySpendInfo();
  if (!info) {
    valueEl.textContent = '—';
    noteEl.textContent = t('spend_guide');
    if (leftEl) leftEl.textContent = '';
    syncWidgetSummary(null);
    return;
  }
  valueEl.textContent = fmt(info.daily);
  noteEl.textContent = info.over ? t('spend_over') : t('spend_note');
  if (leftEl) {
    if (info.left < 0) {
      leftEl.textContent = t('spend_over_by', { amount: fmt(-info.left) });
    } else if (info.over) {
      leftEl.textContent = '';
    } else if (info.daysLeft === 1) {
      leftEl.textContent = t('spend_left_one', { amount: fmt(info.left) });
    } else {
      leftEl.textContent = t('spend_left', { amount: fmt(info.left), days: info.daysLeft });
    }
  }
  syncWidgetSummary(info);
}

/* ---------------- Widget de inicio (Paquete 3, Android) ----------------
   Empuja al widget nativo los mismos textos de esta tarjeta: el plugin
   propio PetoWidget los guarda en el teléfono y el widget de la
   pantalla de inicio los pinta sin abrir la app. Sin plugin (web o
   iOS) no hace nada. Los textos van ya formateados y en el idioma de
   la app; la racha viaja como texto listo («🔥 12»). Widgets v3 suma:
   el porcentaje de uso del presupuesto del mes (para la barra y el
   punto de estado que pinta el lado nativo), la línea del próximo
   turno del san si hay uno activo y la etiqueta «hoy» del widget
   Tamaño app. */

/* Punto de color por categoría para los últimos gastos del widget
   Grande: cada categoría base tiene su círculo; las personalizadas
   y cualquier otra caen en el círculo blanco. */
const WIDGET_CAT_DOTS = {
  'Renta': '🟣', 'Comida': '🟢', 'Comida fuera': '🟠', 'Gasolina': '🔵',
  'Transporte': '🟡', 'Salud': '🔴', 'Ropa': '🟤', 'Otros': '⚪'
};
function widgetCatDot(cat) { return WIDGET_CAT_DOTS[cat] || '⚪'; }

function syncWidgetSummary(info) {
  try {
    const W = capPlugin('PetoWidget');
    if (!W || typeof W.setSummary !== 'function') return;
    let amount, note;
    if (!info) {
      amount = 'PETO Finanzas';
      note = t('spend_guide');
    } else {
      amount = fmt(info.daily);
      note = info.over ? t('spend_over') : t('spend_note');
    }
    let streak = '';
    try {
      const s = (typeof recordingStreak === 'function') ? recordingStreak() : 0;
      if (s > 0) streak = '🔥 ' + s;
    } catch (e) { /* sin racha: va vacío */ }
    /* Widgets v2 (tamaño Grande): cuánto queda del mes, con las
       mismas frases de la tarjeta de Inicio, y los últimos 3 gastos
       de hoy ya formateados (desde Widgets v3: «🟢 Café  $4.50», con
       punto de color por categoría y montos alineados). */
    let monthLeft = '';
    if (info) {
      if (info.left < 0) {
        monthLeft = t('spend_over_by', { amount: fmt(-info.left) });
      } else if (!info.over) {
        monthLeft = info.daysLeft === 1
          ? t('spend_left_one', { amount: fmt(info.left) })
          : t('spend_left', { amount: fmt(info.left), days: info.daysLeft });
      }
    }
    let recent = '';
    try {
      const today = todayStr();
      const todays = (db && db.expenses) ? db.expenses.filter((e) => e.date === today) : [];
      /* Widgets v3: cada gasto con su punto de color por categoría y
         los montos alineados a la derecha (etiquetas y montos se
         rellenan con espacios al ancho mayor de las tres líneas). */
      const rows = todays.slice(-3).reverse().map((e) => ({
        dot: widgetCatDot(e.category),
        label: e.note ? e.note : catName(e.category),
        amt: fmt(e.amountCents)
      }));
      const labelW = rows.reduce((m, r2) => Math.max(m, r2.label.length), 0);
      const amtW = rows.reduce((m, r2) => Math.max(m, r2.amt.length), 0);
      recent = rows.map((r2) =>
        r2.dot + ' ' + r2.label.padEnd(labelW) + '  ' + r2.amt.padStart(amtW)).join('\n');
    } catch (e) { recent = ''; }
    /* Widgets v3: porcentaje de uso del presupuesto del mes (la
       barra y el punto del lado nativo cambian de color con los
       cortes 80/100 de las alertas). Sin presupuesto: -1. */
    const progressPct = info ? Math.round(info.spent / info.total * 100) : -1;
    /* Widgets v3: línea del próximo turno del san, solo si hay un
       san activo sin terminar. El personal no guarda fechas: va sin
       fecha. El del organizador lleva quién recibe y cuándo, con
       las mismas funciones de la tarjeta del san en Inicio. */
    let sanText = '';
    try {
      if (db && db.san && db.san.currentWeek < db.san.participants.length) {
        sanText = t('widget_san_next_nodate', { name: db.san.participants[db.san.currentWeek] });
      } else if (db && db.sanOrg) {
        const org = db.sanOrg;
        const cur = orgCurrentRound(org);
        if (cur < org.participants.length) {
          sanText = t('widget_san_next', {
            name: org.participants[cur], date: prettyDate(orgRoundDate(org, cur))
          });
        }
      }
    } catch (e) { sanText = ''; }
    const r = W.setSummary({
      amountText: amount, noteText: note, streakText: streak,
      recentText: recent, monthLeftText: monthLeft,
      progressPct: progressPct, sanText: sanText, todayLabel: t('widget_today')
    });
    if (r && typeof r.catch === 'function') r.catch(function () {});
  } catch (e) { /* el widget nunca debe romper la app */ }
}

/* ---------------- Widget: botón «+» de anotar rápido (Widgets v2) ----
   El botón «+» del widget abre la app y deja una acción pendiente en
   el lado nativo; al entrar (enterApp) o al volver a primer plano se
   consume aquí y se abre el formulario de agregar gasto. Si la app
   está bloqueada o en la bienvenida, la bandera NO se consume: queda
   para cuando enterApp() corra tras desbloquear. Sin plugin (web o
   iOS) no hace nada. */
function checkWidgetPendingAction() {
  try {
    const shell = document.getElementById('app-shell');
    if (!shell || shell.hidden) return;
    const W = capPlugin('PetoWidget');
    if (!W || typeof W.getPendingAction !== 'function') return;
    const r = W.getPendingAction({});
    if (r && typeof r.then === 'function') {
      r.then((res) => {
        if (res && res.action === 'add_expense') openWidgetAddExpense();
      }).catch(function () {});
    }
  } catch (e) { /* el widget nunca debe romper la app */ }
}
function openWidgetAddExpense() {
  try {
    resetExpenseForm();
    showView('gastos');
    window.scrollTo(0, 0);
    setTimeout(() => {
      const a = document.getElementById('exp-amount');
      if (a) a.focus();
    }, 60);
  } catch (e) { /* sin formulario: la app sigue igual */ }
}

/* ---------------- Racha de días anotando (Paquete 3) ----------------
   Días consecutivos con al menos un movimiento registrado (gasto,
   ingreso o ahorro suelto). La racha sigue viva si el último día con
   movimiento es hoy o ayer: nadie anota siempre a la misma hora y la
   racha no debe morir mientras duermes. Sin movimientos: 0. */
function recordingStreak() {
  if (!db) return 0;
  const days = new Set();
  for (const e of db.expenses) days.add(e.date);
  for (const i of db.incomes) days.add(i.date);
  for (const s of db.savings) days.add(s.date);
  let cursor = todayStr();
  if (!days.has(cursor)) cursor = addDaysStr(cursor, -1);
  let streak = 0;
  while (days.has(cursor)) { streak++; cursor = addDaysStr(cursor, -1); }
  return streak;
}
function renderStreak() {
  const pill = document.getElementById('home-streak');
  if (!pill) return;
  const n = recordingStreak();
  pill.hidden = n < 1;
  if (n >= 1) pill.textContent = n === 1 ? t('streak_one') : t('streak_many', { n: n });
}

/* Una entrada de la lista de secciones de Inicio (icono, nombre y
   subtítulo de estado vivo). La usan tanto el san destacado como los
   grupos; data-section identifica la entrada en el DOM. */
function homeMenuItem(def) {
  const item = el('button', 'menu-item');
  item.type = 'button';
  item.setAttribute('data-section', def.id);
  item.appendChild(el('span', 'menu-icon', def.icon));
  const text = el('span', 'menu-text');
  text.appendChild(el('span', 'menu-name', t('sec_' + def.id)));
  text.appendChild(el('span', 'menu-key', menuKeyText(def.id)));
  item.appendChild(text);
  item.appendChild(el('span', 'menu-arrow', '›'));
  item.addEventListener('click', () => showView(def.id));
  return item;
}

function renderHome() {
  const key = currentMonthKey();
  document.getElementById('sum-available').textContent = fmt(availableMoney(key));
  document.getElementById('sum-savings').textContent = fmt(monthSavings(key));
  document.getElementById('sum-debts').textContent = fmt(pendingDebtsTotal());
  document.getElementById('sum-incomes').textContent = fmt(sumCents(monthIncomes(key)));
  document.getElementById('sum-expenses').textContent = fmt(sumCents(monthExpenses(key)));
  /* Accesos rápidos de Inicio: si una sección está apagada en Ajustes,
     su acceso también se esconde. */
  document.getElementById('tile-available').hidden = db.settings.sections.cuentas === false;
  document.getElementById('tile-savings').hidden = db.settings.sections.ahorros === false;
  document.getElementById('tile-debts').hidden = db.settings.sections.deudas === false;
  document.getElementById('tile-incomes').hidden = db.settings.sections.ingresos === false;
  document.getElementById('tile-expenses').hidden = db.settings.sections.gastos === false;
  const goalLine = document.getElementById('sum-savings-goal');
  if (db.savingsGoal) {
    goalLine.hidden = false;
    goalLine.textContent = t('tile_goal', { name: db.savingsGoal.name, pct: goalPct() });
  } else {
    goalLine.hidden = true;
    goalLine.textContent = '';
  }
  renderBanners();
  renderSpendToday();
  renderStreak();
  renderInsights();
  document.getElementById('greeting').textContent =
    db.settings.name ? t('greeting') + ', ' + db.settings.name : t('greeting');
  document.getElementById('btn-lock-now').hidden = !db.settings.pinHash;

  const menu = document.getElementById('menu-list');
  clearNode(menu);
  /* Compilación 32 (pedido de Sterlin): el san va PRIMERO en la lista
     de secciones de Inicio, destacado sobre los grupos — quedaba al
     final, dentro de «Cuentas y compromisos», y había que bajar mucho
     para encontrarlo. El orden de la lista no se guarda en los datos
     (sale de SECTION_DEFS al dibujar), así que las instalaciones
     existentes reciben el cambio sin migración de datos y sin
     duplicar la entrada: el san se dibuja una sola vez, aquí, y se
     salta en su grupo. La visibilidad guardada sí manda: con la
     sección apagada en Ajustes no aparece ni primero ni en el grupo. */
  const sanDef = SECTION_DEFS.find((d) => d.id === 'san');
  if (sanDef && db.settings.sections.san !== false) {
    const firstGroup = el('div', 'menu-group');
    firstGroup.appendChild(homeMenuItem(sanDef));
    menu.appendChild(firstGroup);
  }
  const groups = [];
  for (const def of SECTION_DEFS) {
    if (def.id === 'san') continue;
    if (db.settings.sections[def.id] === false) continue;
    if (!groups.includes(def.group)) groups.push(def.group);
  }
  for (const group of groups) {
    const wrap = el('div');
    wrap.appendChild(el('p', 'menu-group-title', t('group_' + group)));
    const list = el('div', 'menu-group');
    for (const def of SECTION_DEFS) {
      if (def.id === 'san') continue;
      if (def.group !== group || db.settings.sections[def.id] === false) continue;
      list.appendChild(homeMenuItem(def));
    }
    wrap.appendChild(list);
    menu.appendChild(wrap);
  }
  const adjWrap = el('div');
  adjWrap.appendChild(el('p', 'menu-group-title', t('group_yourapp')));
  const adjList = el('div', 'menu-group');
  const adj = el('button', 'menu-item');
  adj.type = 'button';
  adj.appendChild(el('span', 'menu-icon', '⚙️'));
  const adjText = el('span', 'menu-text');
  adjText.appendChild(el('span', 'menu-name', t('sec_ajustes')));
  adjText.appendChild(el('span', 'menu-key', t('key_settings')));
  adj.appendChild(adjText);
  adj.appendChild(el('span', 'menu-arrow', '›'));
  adj.addEventListener('click', () => showView('ajustes'));
  adjList.appendChild(adj);
  adjWrap.appendChild(adjList);
  menu.appendChild(adjWrap);
}

/* ---------------- GASTOS ---------------- */
function fillCategorySelect() {
  const sel = document.getElementById('exp-category');
  const prev = sel.value;
  clearNode(sel);
  for (const cat of allCategories(db)) {
    const opt = el('option', null, catName(cat));
    opt.value = cat;
    sel.appendChild(opt);
  }
  if (allCategories(db).includes(prev)) sel.value = prev;
}
function resetExpenseForm() {
  document.getElementById('expense-form').reset();
  document.getElementById('exp-id').value = '';
  document.getElementById('exp-date').value = todayStr();
  document.getElementById('expense-form-title').textContent = t('exp_new');
  document.getElementById('exp-cancel-edit').hidden = true;
  showError('exp-error', '');
  setExpensePhoto(null);
  fillCategorySelect();
}
function renderExpenses() {
  document.getElementById('expense-form-title').textContent =
    document.getElementById('exp-id').value ? t('exp_edit') : t('exp_new');
  document.getElementById('exp-month-label').textContent = monthLabel(expMonth);
  document.getElementById('exp-next').disabled = expMonth >= currentMonthKey();
  const list = monthExpenses(expMonth).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  document.getElementById('exp-total').textContent = fmt(sumCents(list));
  const ul = document.getElementById('expense-list');
  clearNode(ul);
  document.getElementById('expense-empty').hidden = list.length > 0;
  for (const item of list) {
    const li = el('li', 'item');
    const main = el('div', 'item-main');
    main.appendChild(el('div', 'item-title', catName(item.category) + (item.biz ? ' 💼' : '')));
    main.appendChild(el('div', 'item-sub', prettyDate(item.date) + (item.note ? ' · ' + item.note : '')));
    li.appendChild(main);
    li.appendChild(el('span', 'item-amount', fmt(item.amountCents)));
    if (item.photo) {
      const thumb = document.createElement('img');
      thumb.className = 'receipt-thumb';
      thumb.src = item.photo;
      thumb.alt = '';
      thumb.addEventListener('click', () => openPhoto(item.photo));
      li.appendChild(thumb);
    }
    const acts = el('div', 'item-actions');
    acts.appendChild(actionButton(t('btn_repeat'), 'btn-ghost', () => {
      beginUndo();
      db.expenses.push({ id: uid(), amountCents: item.amountCents, category: item.category, date: todayStr(), note: item.note, photo: item.photo || null });
      save(); renderExpenses(); showUndoToast();
    }));
    acts.appendChild(actionButton(t('btn_edit'), 'btn-ghost', () => {
      document.getElementById('exp-id').value = item.id;
      document.getElementById('exp-amount').value = (item.amountCents / 100).toFixed(2);
      fillCategorySelect();
      document.getElementById('exp-category').value = item.category;
      document.getElementById('exp-date').value = item.date;
      document.getElementById('exp-note').value = item.note;
      document.getElementById('exp-biz').checked = item.biz === true;
      setExpensePhoto(item.photo || null);
      document.getElementById('expense-form-title').textContent = t('exp_edit');
      document.getElementById('exp-cancel-edit').hidden = false;
      window.scrollTo(0, 0);
    }));
    acts.appendChild(actionButton(t('btn_delete'), 'btn-ghost', () => {
      if (!window.confirm(t('exp_delete_confirm', { amount: fmt(item.amountCents), cat: catName(item.category), date: prettyDate(item.date) }))) return;
      beginUndo();
      db.expenses = db.expenses.filter((x) => x.id !== item.id);
      save(); resetExpenseForm(); renderExpenses(); showUndoToast();
    }));
    li.appendChild(acts);
    ul.appendChild(li);
  }
}
function onExpenseSubmit(ev) {
  ev.preventDefault();
  const cents = parseAmount(document.getElementById('exp-amount').value, false);
  if (cents === null) { showError('exp-error', t('err_amount')); return; }
  const category = document.getElementById('exp-category').value;
  if (!allCategories(db).includes(category)) { showError('exp-error', t('err_category')); return; }
  const date = cleanDate(document.getElementById('exp-date').value);
  const note = cleanText(document.getElementById('exp-note').value, 120);
  const id = document.getElementById('exp-id').value;
  if (!id && db.expenses.length >= MAX_ITEMS) { showError('exp-error', t('err_limit_expenses')); return; }
  beginUndo();
  let savedItem = null;
  if (id) {
    const found = db.expenses.find((x) => x.id === id);
    if (found) { found.amountCents = cents; found.category = category; found.date = date; found.note = note; found.photo = expPhotoData; found.biz = document.getElementById('exp-biz').checked === true; savedItem = found; }
  } else {
    savedItem = { id: uid(), amountCents: cents, category, date, note, photo: expPhotoData, biz: document.getElementById('exp-biz').checked === true };
    db.expenses.push(savedItem);
  }
  expMonth = monthKeyOf(date);
  let photoFailed = false;
  if (!save() && savedItem && savedItem.photo) {
    /* Sin espacio (casi seguro por la foto): se guarda el gasto sin foto. */
    savedItem.photo = null;
    photoFailed = true;
    save();
  }
  resetExpenseForm(); renderExpenses();
  if (photoFailed) showError('exp-error', t('err_photo_quota'));
  showUndoToast();
}

/* ---------------- INGRESOS ---------------- */
/* La sugerencia de ahorro sale del porcentaje de Ajustes, pero el ahorro
   que cuenta es el que la persona escribe en el campo Ahorro del ingreso. */
let incSavingsTouched = false;
function suggestedSavings(amountCents) {
  return splitCents(amountCents, db.settings.split).ahorro;
}
function splitLine(item) {
  const s = splitCents(item.amountCents, db.settings.split);
  return t('inc_split_line', {
    sav: fmt(item.savingsCents || 0), biz: fmt(s.negocio), exp: fmt(s.gastos), fam: fmt(s.familia)
  });
}
function resetIncomeForm() {
  document.getElementById('income-form').reset();
  document.getElementById('inc-id').value = '';
  document.getElementById('inc-date').value = todayStr();
  document.getElementById('income-form-title').textContent = t('inc_new');
  document.getElementById('inc-cancel-edit').hidden = true;
  document.getElementById('inc-split-preview').textContent = '';
  incSavingsTouched = false;
  document.getElementById('inc-savings-label').textContent = t('inc_savings_label');
  showError('inc-error', '');
}
function renderIncomes() {
  document.getElementById('income-form-title').textContent =
    document.getElementById('inc-id').value ? t('inc_edit') : t('inc_new');
  updateSavingsSuggestion();
  const list = db.incomes.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  const ul = document.getElementById('income-list');
  clearNode(ul);
  document.getElementById('income-empty').hidden = list.length > 0;
  for (const item of list) {
    const li = el('li', 'item');
    const main = el('div', 'item-main');
    main.appendChild(el('div', 'item-title', fmt(item.amountCents) + (item.biz ? ' 💼' : '')));
    main.appendChild(el('div', 'item-sub', prettyDate(item.date) + (item.note ? ' · ' + item.note : '')));
    main.appendChild(el('div', 'item-sub', splitLine(item)));
    li.appendChild(main);
    const acts = el('div', 'item-actions');
    acts.appendChild(actionButton(t('btn_repeat'), 'btn-ghost', () => {
      beginUndo();
      db.incomes.push({ id: uid(), amountCents: item.amountCents, savingsCents: item.savingsCents || 0, date: todayStr(), note: item.note });
      save(); renderIncomes(); showUndoToast();
    }));
    acts.appendChild(actionButton(t('btn_edit'), 'btn-ghost', () => {
      document.getElementById('inc-id').value = item.id;
      document.getElementById('inc-amount').value = (item.amountCents / 100).toFixed(2);
      document.getElementById('inc-date').value = item.date;
      document.getElementById('inc-note').value = item.note;
      document.getElementById('inc-biz').checked = item.biz === true;
      incSavingsTouched = true;
      document.getElementById('inc-savings').value = ((item.savingsCents || 0) / 100).toFixed(2);
      document.getElementById('income-form-title').textContent = t('inc_edit');
      document.getElementById('inc-cancel-edit').hidden = false;
      updateSplitPreview();
      window.scrollTo(0, 0);
    }));
    acts.appendChild(actionButton(t('btn_delete'), 'btn-ghost', () => {
      if (!window.confirm(t('inc_delete_confirm', { amount: fmt(item.amountCents), date: prettyDate(item.date), savings: fmt(item.savingsCents || 0) }))) return;
      beginUndo();
      db.incomes = db.incomes.filter((x) => x.id !== item.id);
      save(); resetIncomeForm(); renderIncomes(); showUndoToast();
    }));
    li.appendChild(acts);
    ul.appendChild(li);
  }
}
/* Actualiza la etiqueta del campo Ahorro con la sugerencia y, mientras la
   persona no haya escrito su propio ahorro, lo rellena con esa sugerencia. */
function updateSavingsSuggestion() {
  const cents = parseAmount(document.getElementById('inc-amount').value, false);
  const label = document.getElementById('inc-savings-label');
  if (cents === null) { label.textContent = t('inc_savings_label'); return; }
  const sug = suggestedSavings(cents);
  label.textContent = t('inc_savings_label_sug', { amount: fmt(sug) });
  if (!incSavingsTouched) {
    document.getElementById('inc-savings').value = (sug / 100).toFixed(2);
  }
}
function updateSplitPreview() {
  const cents = parseAmount(document.getElementById('inc-amount').value, false);
  if (cents === null) {
    document.getElementById('inc-split-preview').textContent = '';
    updateSavingsSuggestion();
    return;
  }
  const s = splitCents(cents, db.settings.split);
  document.getElementById('inc-split-preview').textContent =
    t('inc_split_preview', { sav: fmt(s.ahorro), biz: fmt(s.negocio), exp: fmt(s.gastos), fam: fmt(s.familia) });
  updateSavingsSuggestion();
}
/* Ahorro escrito por la persona: válido desde $0, nunca negativo. */
function parseSavings(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().replace(',', '.');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) return null;
  const cents = Math.round(Number(t) * 100);
  if (!Number.isFinite(cents) || cents < 0 || cents > MAX_MONEY_CENTS) return null;
  return cents;
}
function onIncomeSubmit(ev) {
  ev.preventDefault();
  const cents = parseAmount(document.getElementById('inc-amount').value, false);
  if (cents === null) { showError('inc-error', t('err_amount')); return; }
  const savingsCents = parseSavings(document.getElementById('inc-savings').value);
  if (savingsCents === null) {
    showError('inc-error', t('err_inc_savings'));
    return;
  }
  const date = cleanDate(document.getElementById('inc-date').value);
  const note = cleanText(document.getElementById('inc-note').value, 120);
  const id = document.getElementById('inc-id').value;
  if (!id && db.incomes.length >= MAX_ITEMS) { showError('inc-error', t('err_limit_incomes')); return; }
  beginUndo();
  if (id) {
    const found = db.incomes.find((x) => x.id === id);
    if (found) { found.amountCents = cents; found.savingsCents = savingsCents; found.date = date; found.note = note; found.biz = document.getElementById('inc-biz').checked === true; }
  } else {
    db.incomes.push({ id: uid(), amountCents: cents, savingsCents, date, note, biz: document.getElementById('inc-biz').checked === true });
  }
  save(); resetIncomeForm(); renderIncomes(); showUndoToast();
}

/* ---------------- AHORROS ----------------
   Hay dos orígenes: (1) el ahorro anotado en cada ingreso (savingsCents) y
   (2) los ahorros sueltos que la persona agrega a mano en esta sección
   (db.savings), sin ningún ingreso detrás. La lista muestra una fila por
   cada cantidad, con su origen. Borrar una fila de ingreso pone SOLO ese
   savingsCents en 0 (el ingreso queda intacto, con su misma cantidad);
   borrar una fila suelta elimina solo esa entrada de db.savings. */
function allSavingsTotal() {
  const fromIncomes = db.incomes.reduce((t, i) => t + (i.savingsCents || 0), 0);
  const standalone = db.savings.reduce((t, s) => t + s.amountCents, 0);
  return fromIncomes + standalone;
}
/* Selector de meta del formulario de ahorro (Paquete 3): la primera
   opción es «sin meta» (ahorro general, como siempre); el resto son
   las metas múltiples vivas. Se repuebla en cada dibujo porque las
   metas pueden nacer o borrarse sin salir de la vista. */
function fillSavingsGoalSelect() {
  const sel = document.getElementById('sav-goal');
  if (!sel) return;
  const prev = sel.value;
  clearNode(sel);
  const none = el('option', null, t('sav_goal_none'));
  none.value = '';
  sel.appendChild(none);
  for (const g of db.goals) {
    const opt = el('option', null, g.name);
    opt.value = g.id;
    sel.appendChild(opt);
  }
  if (prev && db.goals.some((g) => g.id === prev)) sel.value = prev;
}
function resetSavingsForm() {
  document.getElementById('savings-form').reset();
  document.getElementById('sav-date').value = todayStr();
  fillSavingsGoalSelect();
  showError('sav-error', '');
}
function renderSavings() {
  renderGoal();
  renderChallenge();
  renderGoals();
  fillSavingsGoalSelect();
  const rows = [];
  for (const item of db.incomes) {
    if ((item.savingsCents || 0) > 0) rows.push({ kind: 'ingreso', date: item.date, item: item });
  }
  for (const item of db.savings) rows.push({ kind: 'manual', date: item.date, item: item });
  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  document.getElementById('sav-total').textContent = fmt(allSavingsTotal());
  document.getElementById('sav-month-total').textContent = fmt(monthSavings(currentMonthKey()));
  const ul = document.getElementById('savings-list');
  clearNode(ul);
  document.getElementById('savings-empty').hidden = rows.length > 0;
  for (const row of rows) {
    const item = row.item;
    const li = el('li', 'item');
    const main = el('div', 'item-main');
    const acts = el('div', 'item-actions');
    if (row.kind === 'ingreso') {
      main.appendChild(el('div', 'item-title', t('sav_from_title', { date: prettyDate(item.date) })));
      main.appendChild(el('div', 'item-sub',
        t('sav_from_sub', { amount: fmt(item.amountCents) }) + (item.note ? ' · ' + item.note : '')));
      li.appendChild(main);
      li.appendChild(el('span', 'item-amount', fmt(item.savingsCents)));
      acts.appendChild(actionButton(t('btn_repeat'), 'btn-ghost', () => {
        beginUndo();
        db.savings.push({ id: uid(), amountCents: item.savingsCents, date: todayStr(), note: item.note, goalId: null });
        save(); renderSavings(); showUndoToast();
      }));
      acts.appendChild(actionButton(t('btn_delete'), 'btn-ghost', () => {
        if (!window.confirm(t('sav_delete_income_confirm', { amount: fmt(item.savingsCents), date: prettyDate(item.date), income: fmt(item.amountCents) }))) return;
        beginUndo();
        item.savingsCents = 0;
        save(); renderSavings(); showUndoToast();
      }));
    } else {
      main.appendChild(el('div', 'item-title', item.note ? item.note : t('sav_manual_title')));
      main.appendChild(el('div', 'item-sub', t('sav_manual_sub', { date: prettyDate(item.date) })));
      const assignedGoal = item.goalId ? db.goals.find((g) => g.id === item.goalId) : null;
      if (assignedGoal) main.appendChild(el('div', 'item-sub', '🎯 ' + assignedGoal.name));
      li.appendChild(main);
      li.appendChild(el('span', 'item-amount', fmt(item.amountCents)));
      acts.appendChild(actionButton(t('btn_repeat'), 'btn-ghost', () => {
        beginUndo();
        db.savings.push({ id: uid(), amountCents: item.amountCents, date: todayStr(), note: item.note, goalId: item.goalId || null });
        save(); renderSavings(); showUndoToast();
      }));
      acts.appendChild(actionButton(t('btn_delete'), 'btn-ghost', () => {
        if (!window.confirm(t('sav_delete_manual_confirm', { amount: fmt(item.amountCents), date: prettyDate(item.date) }))) return;
        beginUndo();
        db.savings = db.savings.filter((x) => x.id !== item.id);
        save(); renderSavings(); showUndoToast();
      }));
    }
    li.appendChild(acts);
    ul.appendChild(li);
  }
}
function onSavingsSubmit(ev) {
  ev.preventDefault();
  const cents = parseAmount(document.getElementById('sav-amount').value, false);
  if (cents === null) { showError('sav-error', t('err_amount')); return; }
  const date = cleanDate(document.getElementById('sav-date').value);
  const note = cleanText(document.getElementById('sav-note').value, 120);
  if (db.savings.length >= MAX_ITEMS) { showError('sav-error', t('err_limit_savings')); return; }
  const goalSel = document.getElementById('sav-goal');
  const wantedGoal = goalSel ? goalSel.value : '';
  const goalId = db.goals.some((g) => g.id === wantedGoal) ? wantedGoal : null;
  beginUndo();
  db.savings.push({ id: uid(), amountCents: cents, date, note, goalId });
  save(); resetSavingsForm(); renderSavings(); showUndoToast();
}

/* ---------------- META DE AHORRO ----------------
   Una sola meta {name, targetCents}. El progreso se mide con el ahorro
   TOTAL de todos los tiempos (allSavingsTotal). Borrar la meta nunca
   toca los ahorros: solo se borra la meta. */
let goalEditing = false;
function resetGoalForm() {
  document.getElementById('goal-form').reset();
  goalEditing = false;
  showError('goal-error', '');
}
function renderGoal() {
  const card = document.getElementById('goal-card');
  clearNode(card);
  const form = document.getElementById('goal-form');
  const goal = db.savingsGoal;
  if (!goal) {
    goalEditing = false;
    card.appendChild(el('h3', null, t('goal_prompt')));
    card.appendChild(el('p', 'muted', t('goal_prompt_sub')));
    form.hidden = false;
    document.getElementById('goal-form-title').textContent = t('goal_form_create');
    document.getElementById('goal-submit').textContent = t('goal_create_btn');
    document.getElementById('goal-cancel-edit').hidden = true;
    return;
  }
  const total = allSavingsTotal();
  const pct = goalPct();
  card.appendChild(el('h3', null, '🎯 ' + goal.name));
  if (total >= goal.targetCents) card.appendChild(el('p', 'goal-done', t('goal_done')));
  card.appendChild(el('p', 'total-line',
    t('goal_progress', { have: fmt(total), target: fmt(goal.targetCents) }) + ' · ' + pct + '%'));
  const bar = el('div', 'budget-bar goal-bar');
  const fill = el('div', 'budget-fill');
  fill.style.width = pct + '%';
  bar.appendChild(fill);
  card.appendChild(bar);
  if (total < goal.targetCents) {
    card.appendChild(el('p', 'muted', t('goal_remaining', { amount: fmt(goal.targetCents - total) })));
  }
  const acts = el('div', 'form-actions');
  acts.appendChild(actionButton(t('goal_edit'), 'btn-secondary', () => {
    goalEditing = true;
    document.getElementById('goal-name').value = goal.name;
    document.getElementById('goal-target').value = (goal.targetCents / 100).toFixed(2);
    document.getElementById('goal-form-title').textContent = t('goal_form_edit');
    document.getElementById('goal-submit').textContent = t('goal_save_btn');
    document.getElementById('goal-cancel-edit').hidden = false;
    showError('goal-error', '');
    form.hidden = false;
  }));
  acts.appendChild(actionButton(t('goal_delete'), 'btn-ghost', () => {
    if (!window.confirm(t('goal_delete_confirm', { name: goal.name }))) return;
    beginUndo();
    db.savingsGoal = null;
    goalEditing = false;
    document.getElementById('goal-form').reset();
    save(); renderSavings(); showUndoToast();
  }));
  card.appendChild(acts);
  form.hidden = !goalEditing;
}
function onGoalSubmit(ev) {
  ev.preventDefault();
  const name = cleanText(document.getElementById('goal-name').value, 60);
  if (!name) { showError('goal-error', t('err_goal_name')); return; }
  const cents = parseAmount(document.getElementById('goal-target').value, false);
  if (cents === null) { showError('goal-error', t('err_amount')); return; }
  beginUndo();
  db.savingsGoal = { name: name, targetCents: cents };
  goalEditing = false;
  document.getElementById('goal-form').reset();
  showError('goal-error', '');
  save(); renderSavings(); showUndoToast();
}

/* ---------------- RESUMEN (GRÁFICAS) ----------------
   Barras en CSS puro, sin librerías: gastos del mes por categoría
   (cantidad y % del total gastado) e Ingresos vs Gastos vs Ahorros. */
let chartMonth = currentMonthKey();
function chartBarRow(label, amountText, pct) {
  const row = el('div', 'chart-row');
  const head = el('div', 'chart-row-head');
  head.appendChild(el('span', null, label));
  head.appendChild(el('span', 'item-amount', amountText));
  row.appendChild(head);
  const bar = el('div', 'budget-bar');
  const fill = el('div', 'budget-fill');
  fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
  bar.appendChild(fill);
  row.appendChild(bar);
  return row;
}
function renderResumen() {
  document.getElementById('res-month-label').textContent = monthLabel(chartMonth);
  document.getElementById('res-next').disabled = chartMonth >= currentMonthKey();
  const key = chartMonth;
  renderBizCard(key);
  const exps = monthExpenses(key);
  const totalSpent = sumCents(exps);
  const byCat = {};
  for (const e of exps) byCat[e.category] = (byCat[e.category] || 0) + e.amountCents;
  const entries = Object.keys(byCat).map((c) => ({ cat: c, amount: byCat[c] }))
    .sort((a, b) => b.amount - a.amount);
  const catsBox = document.getElementById('chart-cats');
  clearNode(catsBox);
  document.getElementById('chart-cats-empty').hidden = entries.length > 0;
  for (const entry of entries) {
    const pct = totalSpent > 0 ? Math.round(entry.amount / totalSpent * 100) : 0;
    catsBox.appendChild(chartBarRow(catName(entry.cat), fmt(entry.amount) + ' · ' + pct + '%', pct));
  }
  const income = sumCents(monthIncomes(key));
  const savings = monthSavings(key);
  const max = Math.max(income, totalSpent, savings);
  const sumBox = document.getElementById('chart-summary');
  clearNode(sumBox);
  document.getElementById('chart-summary-empty').hidden = max > 0;
  if (max > 0) {
    sumBox.appendChild(chartBarRow(t('chart_income'), fmt(income), Math.round(income / max * 100)));
    sumBox.appendChild(chartBarRow(t('chart_expenses'), fmt(totalSpent), Math.round(totalSpent / max * 100)));
    sumBox.appendChild(chartBarRow(t('chart_savings'), fmt(savings), Math.round(savings / max * 100)));
  }
  renderReport();
  renderTrend();
}

/* ---------------- TENDENCIA (Paquete 3) ----------------
   Los datos van separados del dibujo: los últimos 6 meses terminando
   en el mes visible (totales de gasto) y las semanas lunes–domingo
   de ese mes (solo las que caen dentro del mes cuentan gasto). */
function trendData(key) {
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const k = shiftMonth(key, -i);
    const p = k.split('-');
    const label = new Intl.DateTimeFormat(localeTag(), { month: 'short' })
      .format(new Date(Number(p[0]), Number(p[1]) - 1, 1));
    months.push({ key: k, label: label, cents: sumCents(monthExpenses(k)) });
  }
  const byWeek = {};
  for (const e of monthExpenses(key)) {
    const ws = weekStartOf(e.date);
    byWeek[ws] = (byWeek[ws] || 0) + e.amountCents;
  }
  const starts = [];
  const lastDay = key + '-' + String(daysInMonth(key)).padStart(2, '0');
  let cursor = weekStartOf(key + '-01');
  while (cursor <= lastDay) { starts.push(cursor); cursor = addDaysStr(cursor, 7); }
  const weeks = starts.map((ws, i) => ({ start: ws, n: i + 1, cents: byWeek[ws] || 0 }));
  return { months: months, weeks: weeks };
}
/* Barras de los 6 meses en un lienzo, con los colores del tema activo
   (canvasPalette): acento para las barras, tinta para los montos y
   tono suave para los nombres de mes. Sin contexto 2d no se dibuja
   nada y la vista sigue con las barras CSS de las semanas. */
function drawTrendCanvas(canvas, months) {
  const ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) return;
  const P = canvasPalette();
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const max = Math.max.apply(null, months.map((m) => m.cents).concat([1]));
  const base = H - 30, top = 30;
  const slot = W / months.length;
  const bw = Math.min(64, slot * 0.55);
  ctx.textAlign = 'center';
  months.forEach((m, i) => {
    const cx = slot * i + slot / 2;
    const h = Math.max(2, Math.round((base - top) * m.cents / max));
    ctx.fillStyle = P.header;
    ctx.fillRect(cx - bw / 2, base - h, bw, h);
    ctx.fillStyle = P.ink;
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText('$' + Math.round(m.cents / 100), cx, base - h - 8);
    ctx.fillStyle = P.muted;
    ctx.font = '14px sans-serif';
    ctx.fillText(m.label, cx, base + 20);
  });
  ctx.fillStyle = P.muted;
  ctx.fillRect(0, base + 1, W, 1);
}
function renderTrend() {
  const canvas = document.getElementById('trend-canvas');
  const weeksBox = document.getElementById('trend-weeks');
  if (!canvas || !weeksBox) return;
  const data = trendData(chartMonth);
  const has = data.months.some((m) => m.cents > 0);
  const emptyEl = document.getElementById('trend-empty');
  if (emptyEl) emptyEl.hidden = has;
  canvas.hidden = !has;
  if (has) drawTrendCanvas(canvas, data.months);
  clearNode(weeksBox);
  const maxW = Math.max.apply(null, data.weeks.map((w) => w.cents).concat([0]));
  for (const w of data.weeks) {
    weeksBox.appendChild(chartBarRow(
      t('trend_week', { n: w.n }), fmt(w.cents),
      maxW > 0 ? Math.round(w.cents / maxW * 100) : 0));
  }
}

/* ---------------- PRESUPUESTO ---------------- */
function renderBudgets() {
  const key = currentMonthKey();
  const spentByCat = {};
  for (const e of monthExpenses(key)) spentByCat[e.category] = (spentByCat[e.category] || 0) + e.amountCents;
  const ul = document.getElementById('budget-list');
  clearNode(ul);
  for (const cat of allCategories(db)) {
    const budget = db.budgets[cat] || 0;
    const spent = spentByCat[cat] || 0;
    const li = el('li', 'item');
    const main = el('div', 'item-main');
    main.appendChild(el('div', 'item-title', catName(cat)));
    if (budget > 0) {
      main.appendChild(el('div', 'item-sub',
        spent <= budget
          ? t('bud_spent_left', { spent: fmt(spent), budget: fmt(budget), left: fmt(budget - spent) })
          : t('bud_spent_over', { spent: fmt(spent), budget: fmt(budget), over: fmt(spent - budget) })));
      const bar = el('div', 'budget-bar');
      const fill = el('div', 'budget-fill' + (spent > budget ? ' over' : ''));
      fill.style.width = Math.min(100, Math.round(spent / budget * 100)) + '%';
      bar.appendChild(fill);
      main.appendChild(bar);
    } else {
      main.appendChild(el('div', 'item-sub', t('bud_nolimit', { spent: fmt(spent) })));
    }
    const row = el('div', 'budget-input-row');
    const input = document.createElement('input');
    input.type = 'number'; input.inputMode = 'decimal'; input.min = '0'; input.step = '0.01';
    input.placeholder = t('bud_placeholder');
    input.value = budget > 0 ? (budget / 100).toFixed(2) : '';
    input.setAttribute('aria-label', t('bud_aria', { cat: catName(cat) }));
    const saveBtn = actionButton(t('btn_save'), 'btn-secondary', () => {
      const raw = input.value.trim();
      if (raw === '') { delete db.budgets[cat]; save(); renderBudgets(); return; }
      const cents = parseAmount(raw, false);
      if (cents === null) { window.alert(t('bud_alert_amount')); return; }
      db.budgets[cat] = cents;
      save(); renderBudgets();
    });
    row.appendChild(input);
    row.appendChild(saveBtn);
    if (db.customCategories.includes(cat)) {
      row.appendChild(actionButton(t('bud_delete_cat'), 'btn-ghost', () => {
        if (!window.confirm(t('bud_delete_cat_confirm', { cat: cat, other: catName('Otros') }))) return;
        db.customCategories = db.customCategories.filter((c) => c !== cat);
        delete db.budgets[cat];
        for (const e of db.expenses) if (e.category === cat) e.category = 'Otros';
        save(); renderBudgets();
      }));
    }
    main.appendChild(row);
    li.appendChild(main);
    ul.appendChild(li);
  }
}
function onCategorySubmit(ev) {
  ev.preventDefault();
  const name = cleanText(document.getElementById('cat-name').value, 30);
  if (!name) { showError('cat-error', t('err_cat_name')); return; }
  if (allCategories(db).some((c) => c.toLowerCase() === name.toLowerCase())) {
    showError('cat-error', t('err_cat_exists')); return;
  }
  db.customCategories.push(name);
  save();
  document.getElementById('category-form').reset();
  showError('cat-error', '');
  renderBudgets();
}

/* ---------------- PAGOS FIJOS ---------------- */
function resetFixedForm() {
  document.getElementById('fixed-form').reset();
  document.getElementById('fix-id').value = '';
  document.getElementById('fixed-form-title').textContent = t('fix_new');
  document.getElementById('fix-cancel-edit').hidden = true;
  showError('fix-error', '');
}
function renderFixed() {
  document.getElementById('fixed-form-title').textContent =
    document.getElementById('fix-id').value ? t('fix_edit') : t('fix_new');
  const key = currentMonthKey();
  const list = db.fixed.slice().sort((a, b) => a.day - b.day);
  const ul = document.getElementById('fixed-list');
  clearNode(ul);
  document.getElementById('fixed-empty').hidden = list.length > 0;
  scheduleNotifications();
  for (const item of list) {
    const paid = item.paidMonths[key] === true;
    const li = el('li', 'item');
    const main = el('div', 'item-main');
    const titleRow = el('div');
    titleRow.appendChild(el('span', 'item-title', item.name));
    titleRow.appendChild(document.createTextNode(' '));
    titleRow.appendChild(el('span', 'chip ' + (paid ? 'chip-pagada' : 'chip-pendiente'), paid ? t('chip_paid') : t('chip_pending')));
    main.appendChild(titleRow);
    main.appendChild(el('div', 'item-sub', t('fix_sub', { day: item.day, month: monthLabel(key) })));
    li.appendChild(main);
    li.appendChild(el('span', 'item-amount', fmt(item.amountCents)));
    const acts = el('div', 'item-actions');
    acts.appendChild(actionButton(paid ? t('fix_unmark') : t('fix_mark'), 'btn-secondary', () => {
      if (paid) delete item.paidMonths[key]; else item.paidMonths[key] = true;
      save(); renderFixed();
    }));
    acts.appendChild(actionButton(t('btn_edit'), 'btn-ghost', () => {
      document.getElementById('fix-id').value = item.id;
      document.getElementById('fix-name').value = item.name;
      document.getElementById('fix-amount').value = (item.amountCents / 100).toFixed(2);
      document.getElementById('fix-day').value = item.day;
      document.getElementById('fixed-form-title').textContent = t('fix_edit');
      document.getElementById('fix-cancel-edit').hidden = false;
      window.scrollTo(0, 0);
    }));
    acts.appendChild(actionButton(t('btn_delete'), 'btn-ghost', () => {
      if (!window.confirm(t('fix_delete_confirm', { name: item.name }))) return;
      beginUndo();
      db.fixed = db.fixed.filter((x) => x.id !== item.id);
      save(); resetFixedForm(); renderFixed(); showUndoToast();
    }));
    li.appendChild(acts);
    ul.appendChild(li);
  }
}
function onFixedSubmit(ev) {
  ev.preventDefault();
  const name = cleanText(document.getElementById('fix-name').value, 60);
  const cents = parseAmount(document.getElementById('fix-amount').value, false);
  const day = Math.trunc(Number(document.getElementById('fix-day').value));
  if (!name) { showError('fix-error', t('err_name')); return; }
  if (cents === null) { showError('fix-error', t('err_amount')); return; }
  if (!Number.isFinite(day) || day < 1 || day > 31) { showError('fix-error', t('err_day')); return; }
  const id = document.getElementById('fix-id').value;
  if (!id && db.fixed.length >= MAX_ITEMS) { showError('fix-error', t('err_limit_fixed')); return; }
  beginUndo();
  if (id) {
    const found = db.fixed.find((x) => x.id === id);
    if (found) { found.name = name; found.amountCents = cents; found.day = day; }
  } else {
    db.fixed.push({ id: uid(), name, amountCents: cents, day, paidMonths: {} });
  }
  save(); resetFixedForm(); renderFixed(); showUndoToast();
}

/* ---------------- CUENTAS ---------------- */
function resetAccountForm() {
  document.getElementById('account-form').reset();
  document.getElementById('acc-id').value = '';
  document.getElementById('account-form-title').textContent = t('acc_new');
  document.getElementById('acc-cancel-edit').hidden = true;
  showError('acc-error', '');
}
function renderAccounts() {
  document.getElementById('account-form-title').textContent =
    document.getElementById('acc-id').value ? t('acc_edit') : t('acc_new');
  const ul = document.getElementById('account-list');
  clearNode(ul);
  document.getElementById('account-empty').hidden = db.accounts.length > 0;
  for (const item of db.accounts) {
    const li = el('li', 'item');
    const main = el('div', 'item-main');
    main.appendChild(el('div', 'item-title', item.name));
    li.appendChild(main);
    li.appendChild(el('span', 'item-amount', fmt(item.balanceCents)));
    const acts = el('div', 'item-actions');
    acts.appendChild(actionButton(t('btn_edit'), 'btn-ghost', () => {
      document.getElementById('acc-id').value = item.id;
      document.getElementById('acc-name').value = item.name;
      document.getElementById('acc-balance').value = (item.balanceCents / 100).toFixed(2);
      document.getElementById('account-form-title').textContent = t('acc_edit');
      document.getElementById('acc-cancel-edit').hidden = false;
      window.scrollTo(0, 0);
    }));
    acts.appendChild(actionButton(t('btn_delete'), 'btn-ghost', () => {
      if (!window.confirm(t('acc_delete_confirm', { name: item.name }))) return;
      beginUndo();
      db.accounts = db.accounts.filter((x) => x.id !== item.id);
      save(); resetAccountForm(); renderAccounts(); showUndoToast();
    }));
    li.appendChild(acts);
    ul.appendChild(li);
  }
}
function onAccountSubmit(ev) {
  ev.preventDefault();
  const name = cleanText(document.getElementById('acc-name').value, 60);
  const cents = parseAmount(document.getElementById('acc-balance').value, true);
  if (!name) { showError('acc-error', t('err_name')); return; }
  if (cents === null) { showError('acc-error', t('err_balance')); return; }
  const id = document.getElementById('acc-id').value;
  if (!id && db.accounts.length >= MAX_ITEMS) { showError('acc-error', t('err_limit_accounts')); return; }
  beginUndo();
  if (id) {
    const found = db.accounts.find((x) => x.id === id);
    if (found) { found.name = name; found.balanceCents = cents; }
  } else {
    db.accounts.push({ id: uid(), name, balanceCents: cents });
  }
  save(); resetAccountForm(); renderAccounts(); showUndoToast();
}

/* ---------------- DEUDAS ---------------- */
function resetDebtForm() {
  document.getElementById('debt-form').reset();
  document.getElementById('debt-id').value = '';
  document.getElementById('debt-form-title').textContent = t('debt_new');
  document.getElementById('debt-cancel-edit').hidden = true;
  showError('debt-error', '');
}
function renderDebts() {
  document.getElementById('debt-form-title').textContent =
    document.getElementById('debt-id').value ? t('debt_edit') : t('debt_new');
  const ul = document.getElementById('debt-list');
  clearNode(ul);
  document.getElementById('debt-empty').hidden = db.debts.length > 0;
  for (const item of db.debts) {
    const li = el('li', 'item');
    const main = el('div', 'item-main');
    const titleRow = el('div');
    titleRow.appendChild(el('span', 'item-title', item.name));
    titleRow.appendChild(document.createTextNode(' '));
    titleRow.appendChild(el('span', 'chip ' + (item.status === 'pagada' ? 'chip-pagada' : 'chip-pendiente'),
      item.status === 'pagada' ? t('chip_paid') : t('chip_pending')));
    main.appendChild(titleRow);
    if ((item.interesPct || 0) > 0 || (item.pagoMinCents || 0) > 0) {
      main.appendChild(el('div', 'item-sub', t('debt_terms', { pct: item.interesPct || 0, min: fmt(item.pagoMinCents || 0) })));
    }
    li.appendChild(main);
    li.appendChild(el('span', 'item-amount', fmt(item.amountCents)));
    const acts = el('div', 'item-actions');
    acts.appendChild(actionButton(item.status === 'pagada' ? t('debt_mark_pending') : t('debt_mark_paid'), 'btn-secondary', () => {
      item.status = item.status === 'pagada' ? 'pendiente' : 'pagada';
      save(); renderDebts();
    }));
    acts.appendChild(actionButton(t('btn_edit'), 'btn-ghost', () => {
      document.getElementById('debt-id').value = item.id;
      document.getElementById('debt-name').value = item.name;
      document.getElementById('debt-amount').value = (item.amountCents / 100).toFixed(2);
      document.getElementById('debt-interest').value = (item.interesPct || 0) > 0 ? String(item.interesPct) : '';
      document.getElementById('debt-minpay').value = (item.pagoMinCents || 0) > 0 ? (item.pagoMinCents / 100).toFixed(2) : '';
      document.getElementById('debt-status').value = item.status;
      document.getElementById('debt-form-title').textContent = t('debt_edit');
      document.getElementById('debt-cancel-edit').hidden = false;
      window.scrollTo(0, 0);
    }));
    acts.appendChild(actionButton(t('btn_delete'), 'btn-ghost', () => {
      if (!window.confirm(t('debt_delete_confirm', { name: item.name }))) return;
      beginUndo();
      db.debts = db.debts.filter((x) => x.id !== item.id);
      save(); resetDebtForm(); renderDebts(); showUndoToast();
    }));
    li.appendChild(acts);
    ul.appendChild(li);
  }
}
function onDebtSubmit(ev) {
  ev.preventDefault();
  const name = cleanText(document.getElementById('debt-name').value, 60);
  const rawAmt = document.getElementById('debt-amount').value.trim();
  const cents = rawAmt === '0' || rawAmt === '0.00' ? 0 : parseAmount(rawAmt, false);
  const status = document.getElementById('debt-status').value === 'pagada' ? 'pagada' : 'pendiente';
  if (!name) { showError('debt-error', t('err_name')); return; }
  if (cents === null) { showError('debt-error', t('err_amount_generic')); return; }
  const rawInt = document.getElementById('debt-interest').value.trim();
  let interesPct = 0;
  if (rawInt !== '') {
    const n = Number(rawInt.replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || n > 100) { showError('debt-error', t('err_amount_generic')); return; }
    interesPct = cleanRate(n);
  }
  const rawMin = document.getElementById('debt-minpay').value.trim();
  let pagoMinCents = 0;
  if (rawMin !== '' && rawMin !== '0' && rawMin !== '0.00') {
    pagoMinCents = parseAmount(rawMin, false);
    if (pagoMinCents === null) { showError('debt-error', t('err_amount_generic')); return; }
  }
  const id = document.getElementById('debt-id').value;
  if (!id && db.debts.length >= MAX_ITEMS) { showError('debt-error', t('err_limit_debts')); return; }
  beginUndo();
  if (id) {
    const found = db.debts.find((x) => x.id === id);
    if (found) { found.name = name; found.amountCents = cents; found.status = status; found.interesPct = interesPct; found.pagoMinCents = pagoMinCents; }
  } else {
    db.debts.push({ id: uid(), name, amountCents: cents, status, interesPct, pagoMinCents });
  }
  save(); resetDebtForm(); renderDebts(); showUndoToast();
}

/* ---------------- SAN / TANDA ----------------
   Un solo san activo. Los participantes van en orden: la semana 1 le
   toca al primero, la semana 2 al segundo, y así (semanas = número de
   participantes). En cada semana se marca quién ya pagó su aporte. */
let sanDraft = [];
function sanFinished() {
  return !!db.san && db.san.currentWeek >= db.san.participants.length;
}
function sanTotalReunido() {
  if (!db.san) return 0;
  let total = 0;
  for (const w of db.san.weeks) {
    for (const p of Object.keys(w.paid)) if (w.paid[p]) total += db.san.aporteCents;
  }
  return total;
}
function resetSanForm() {
  document.getElementById('san-form').reset();
  document.getElementById('san-pname').value = '';
  sanDraft = [];
  showError('san-error', '');
}
function renderSan() {
  const has = !!db.san;
  document.getElementById('san-create-wrap').hidden = has;
  document.getElementById('san-active-wrap').hidden = !has;
  if (!has) {
    const ul = document.getElementById('san-draft-list');
    clearNode(ul);
    for (const name of sanDraft) {
      const li = el('li', 'item');
      const main = el('div', 'item-main');
      main.appendChild(el('div', 'item-title', name));
      li.appendChild(main);
      const acts = el('div', 'item-actions');
      acts.appendChild(actionButton(t('san_remove'), 'btn-ghost', () => {
        sanDraft = sanDraft.filter((x) => x !== name);
        renderSan();
      }));
      li.appendChild(acts);
      ul.appendChild(li);
    }
    document.getElementById('san-draft-empty').hidden = sanDraft.length > 0;
    return;
  }
  const s = db.san;
  const n = s.participants.length;
  const finished = sanFinished();
  document.getElementById('san-title').textContent = s.name;
  document.getElementById('san-progress').textContent =
    finished ? t('san_finished') : t('san_week', { x: s.currentWeek + 1, n: n });
  document.getElementById('san-aporte-line').textContent = t('san_aporte_line', { amount: fmt(s.aporteCents) });
  document.getElementById('san-total-line').textContent = t('san_total_line', { amount: fmt(sanTotalReunido()) });
  document.getElementById('san-finished-note').hidden = !finished;
  document.getElementById('san-current').hidden = finished;
  document.getElementById('san-new').hidden = !finished;
  if (!finished) {
    const week = s.weeks[s.currentWeek];
    const paidCount = s.participants.filter((p) => week.paid[p]).length;
    document.getElementById('san-receiver-line').textContent =
      t('san_receiver_line', { name: s.participants[s.currentWeek] });
    document.getElementById('san-week-collected').textContent = t('san_week_collected', {
      amount: fmt(paidCount * s.aporteCents), target: fmt(n * s.aporteCents)
    });
    const ul = document.getElementById('san-paid-list');
    clearNode(ul);
    for (const p of s.participants) {
      const row = el('label', 'toggle-row');
      row.appendChild(el('span', null, p + ' · ' + t('san_paid')));
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = week.paid[p] === true;
      cb.setAttribute('aria-label', p);
      cb.addEventListener('change', () => {
        if (cb.checked) week.paid[p] = true; else delete week.paid[p];
        save(); renderSan();
      });
      row.appendChild(cb);
      ul.appendChild(row);
    }
  }
}
function onSanAddParticipant() {
  const input = document.getElementById('san-pname');
  const name = cleanText(input.value, 40);
  if (!name) { showError('san-error', t('san_err_pname')); return; }
  if (sanDraft.some((x) => x.toLowerCase() === name.toLowerCase())) {
    showError('san-error', t('san_err_dup')); return;
  }
  sanDraft.push(name);
  input.value = '';
  showError('san-error', '');
  renderSan();
}
function onSanCreateSubmit(ev) {
  ev.preventDefault();
  /* Compilación 33: el mismo candado que en el organizador — con un
     san personal en curso, este submit no lo reemplaza en silencio
     (antes se llevaba los pagos marcados sin ningún aviso). Para
     crear otro hay que borrar primero el actual (onSanDelete pide
     confirmación) o cerrarlo y usar «Crear un san nuevo». */
  if (db.san) { showError('san-error', t('san_err_active_exists', { name: db.san.name })); return; }
  const name = cleanText(document.getElementById('san-name').value, 60);
  if (!name) { showError('san-error', t('err_name')); return; }
  const cents = parseAmount(document.getElementById('san-amount').value, false);
  if (cents === null) { showError('san-error', t('err_amount')); return; }
  if (sanDraft.length < 2) { showError('san-error', t('san_err_participants')); return; }
  db.san = {
    name: name, aporteCents: cents,
    participants: sanDraft.slice(),
    weeks: sanDraft.map(() => ({ paid: {} })),
    currentWeek: 0
  };
  resetSanForm();
  save(); renderSan();
}
function onSanAdvance() {
  if (!db.san || sanFinished()) return;
  db.san.currentWeek += 1;
  save(); renderSan();
}
function onSanDelete() {
  if (!db.san) return;
  if (!window.confirm(t('san_delete_confirm', { name: db.san.name }))) return;
  db.san = null;
  save(); renderSan();
}
function onSanNew() {
  if (!window.confirm(t('san_new_confirm'))) return;
  db.san = null;
  save(); renderSan();
}

/* ---------------- MODO ORGANIZADOR DE SAN (Fase 4 · Pro) -------------
   La tanda de TODO el grupo (hermana del san personal de arriba, del
   que reutiliza estructura y textos): participantes en orden de turno
   y una ronda por participante; a diferencia del personal, cada ronda
   tiene fecha (inicio + índice × frecuencia: semanal, quincenal o
   mensual) y los pagos se pueden marcar en CUALQUIER ronda, no solo
   en la «actual». Vive en db.sanOrg (el mismo db local) y es función
   de PETO Pro: sin Pro se ve la nota con el botón al muro de pago. */
let sanOrgDraft = [];
function orgRoundDate(org, i) {
  const parts = String(org.startDate).split('-').map(Number);
  const y = parts[0], mo = (parts[1] || 1) - 1, day = parts[2] || 1;
  const d = new Date(y, mo, day);
  if (org.frequency === 'semanal') d.setDate(d.getDate() + i * 7);
  else if (org.frequency === 'quincenal') d.setDate(d.getDate() + i * 14);
  else {
    /* Mensual: mismo día en el mes destino, con tope al último día de
       ese mes (31 de enero → 28/29 de febrero, nunca 3 de marzo). */
    const target = new Date(y, mo + i, 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    d.setFullYear(target.getFullYear(), target.getMonth(), Math.min(day, lastDay));
  }
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function orgRoundPaidCount(org, i) {
  if (!org.rounds[i]) return 0;
  return org.participants.filter((p) => org.rounds[i].paid[p]).length;
}
function orgCurrentRound(org) {
  for (let i = 0; i < org.participants.length; i++) {
    if (orgRoundPaidCount(org, i) < org.participants.length) return i;
  }
  return org.participants.length; /* todas las rondas completas */
}
function orgTotalReunido() {
  if (!db.sanOrg) return 0;
  let total = 0;
  for (const r of db.sanOrg.rounds) {
    for (const p of Object.keys(r.paid)) if (r.paid[p]) total += db.sanOrg.aporteCents;
  }
  return total;
}

/* --- Compilación 30 «Paquete San»: compensación, simulación, estados --- */
function orgCompMode(org) { return (org && org.comp && ['none', 'first', 'last', 'extra'].includes(org.comp.mode)) ? org.comp.mode : 'none'; }
function orgCompLabel(orgOrMode) {
  const m = typeof orgOrMode === 'string' ? orgOrMode : orgCompMode(orgOrMode);
  return t('org_comp_' + m);
}
function orgPenaltyLine(org) {
  if (!org || !org.penalty) return '';
  if (org.penalty.mode === 'fixed') return t('org_penalty_line_fixed', { amount: fmtMoney(org.penalty.amountCents) });
  if (org.penalty.mode === 'percent') return t('org_penalty_line_percent', { percent: org.penalty.percent });
  return '';
}
/* Simulación pura del pote: con cuota extra E, cada quien pone
   aporte+E por ronda, el pote sigue siendo n*aporte y el organizador
   se queda con n*E por ronda. Sin extra, todo es n*aporte. */
function orgSimulation(n, aporteCents, comp) {
  const nn = Math.max(0, Math.trunc(Number(n)) || 0);
  const ap = cleanCents(aporteCents, false);
  const extra = (comp && comp.mode === 'extra') ? cleanCents(comp.amountCents, false) : 0;
  const perRoundPay = ap + extra;
  return { perRoundPay: perRoundPay, pot: nn * ap, totalIn: nn * perRoundPay, orgExtraPerRound: nn * extra };
}
function orgPayStatus(org, i, name) {
  const r = org && org.rounds ? org.rounds[i] : null;
  if (!r) return 'pending';
  if (r.paid && r.paid[name]) return 'confirmed';
  const inf = r.info && r.info[name];
  if (inf && inf.st === 'reported') return 'reported';
  if (inf && inf.st === 'confirmed') return 'confirmed';
  return 'pending';
}
/* Mantiene el invariante paid[name]===true ⇔ estado confirmado. */
function orgSetPayStatus(org, i, name, st) {
  if (!org || !org.rounds || !org.rounds[i] || !org.participants.includes(name)) return false;
  const r = org.rounds[i];
  if (!r.info || typeof r.info !== 'object') r.info = {};
  const prev = r.info[name] || {};
  if (st === 'confirmed') {
    r.paid[name] = true;
    r.info[name] = { st: 'confirmed' };
    if (prev.photo) r.info[name].photo = prev.photo;
  } else if (st === 'reported') {
    delete r.paid[name];
    r.info[name] = { st: 'reported' };
    if (prev.photo) r.info[name].photo = prev.photo;
  } else {
    delete r.paid[name];
    delete r.info[name];
  }
  return true;
}
function orgRoundHasActivity(org, i) {
  const r = org && org.rounds ? org.rounds[i] : null;
  if (!r) return false;
  if (r.paid && Object.keys(r.paid).some((k) => r.paid[k])) return true;
  if (r.info && Object.keys(r.info).length) return true;
  return false;
}
/* Intercambia dos turnos vecinos SOLO si ninguna de las dos rondas
   afectadas tiene pagos ni estados; registra el cambio en history. */
function orgMoveTurn(org, idx, dir) {
  if (!org || !Array.isArray(org.participants)) return false;
  const j = idx + dir;
  if (idx < 0 || j < 0 || idx >= org.participants.length || j >= org.participants.length) return false;
  if (orgRoundHasActivity(org, idx) || orgRoundHasActivity(org, j)) return false;
  const a = org.participants[idx];
  const b = org.participants[j];
  org.participants[idx] = b;
  org.participants[j] = a;
  const ra = org.rounds[idx];
  org.rounds[idx] = org.rounds[j];
  org.rounds[j] = ra;
  if (!Array.isArray(org.history)) org.history = [];
  org.history.push({ ts: todayStr(), kind: 'swap', a: a, b: b });
  if (org.history.length > 100) org.history = org.history.slice(-100);
  return true;
}
function orgShuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    try {
      const buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      j = buf[0] % (i + 1);
    } catch (e) { /* Math.random basta como respaldo */ }
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr;
}
/* Texto del recordatorio de WhatsApp para la ronda actual. */
function orgReminderText(org) {
  if (!org) return '';
  const n = org.participants.length;
  const cur = orgCurrentRound(org);
  if (cur >= n) return '🤝 ' + org.name + ' · ' + t('san_finished');
  const receiver = org.participants[cur];
  const lines = [];
  lines.push(t('org_reminder_head', { san: org.name, x: cur + 1, n: n, date: prettyDate(orgRoundDate(org, cur)) }));
  lines.push(t('org_reminder_receiver', { name: receiver }));
  const z = org.zelle && org.zelle[receiver];
  if (z) lines.push(t('org_reminder_zelle', { name: receiver, zelle: z }));
  const sim = orgSimulation(n, org.aporteCents, org.comp);
  lines.push(t('org_reminder_amount', { amount: fmtMoney(sim.perRoundPay) }));
  const pending = org.participants.filter((pp) => orgPayStatus(org, cur, pp) !== 'confirmed');
  if (pending.length) lines.push('⏳ ' + pending.join(', '));
  return lines.join('\n');
}
/* Foto del estado público: SIN fotos de comprobantes, solo estados. */
function orgPublicSnapshot(org) {
  if (!org) return null;
  return {
    v: 1,
    name: org.name,
    aporteCents: org.aporteCents,
    frequency: org.frequency,
    startDate: org.startDate,
    comp: org.comp ? { mode: org.comp.mode, amountCents: org.comp.amountCents } : { mode: 'none', amountCents: 0 },
    penalty: org.penalty ? { mode: org.penalty.mode, amountCents: org.penalty.amountCents, percent: org.penalty.percent } : { mode: 'none', amountCents: 0, percent: 0 },
    participants: org.participants.map((nm) => ({ name: nm, zelle: (org.zelle && org.zelle[nm]) || '' })),
    rounds: org.participants.map((unused, i) => ({
      confirmed: org.participants.filter((pp) => orgPayStatus(org, i, pp) === 'confirmed'),
      reported: org.participants.filter((pp) => orgPayStatus(org, i, pp) === 'reported')
    })),
    history: Array.isArray(org.history) ? org.history.slice(-100) : [],
    updatedAt: new Date().toISOString()
  };
}
function sanPublicLink(org) {
  if (!org || !org.linkToken) return '';
  return 'https://roblessantossterlin-lgtm.github.io/petofinanzas/app/#san=' + org.linkToken;
}
/* Compilación 35 · Invariante anti-pérdida: los reportes que los
   participantes hacen desde el enlace público viven SOLO en la foto
   del servidor. Antes de volver a publicar, el organizador importa a
   su base local todo pago «Reportado» (o con foto de comprobante) del
   servidor que localmente siga «Pendiente», para que la foto nueva
   que sube lo conserve en vez de pisarlo. Devuelve true si la base
   local cambió. No toca confirmados ni pendientes del servidor. */
function mergeSanPublicReports(org, snap) {
  if (!org || !snap || !Array.isArray(snap.rounds)) return false;
  let changed = false;
  snap.rounds.forEach((rd, i) => {
    if (!rd || typeof rd !== 'object' || !org.rounds || !org.rounds[i]) return;
    const reported = Array.isArray(rd.reported) ? rd.reported : [];
    for (const nm of reported) {
      if (!org.participants.includes(nm)) continue;
      if (orgPayStatus(org, i, nm) !== 'pending') continue;
      if (orgSetPayStatus(org, i, nm, 'reported')) changed = true;
    }
    const photos = (rd.photos && typeof rd.photos === 'object' && !Array.isArray(rd.photos)) ? rd.photos : {};
    for (const nm of Object.keys(photos)) {
      if (!org.participants.includes(nm)) continue;
      const ph = photos[nm];
      /* Mismo saneado que cleanSanOrg: solo data:image/ y ≤700 000. */
      if (typeof ph !== 'string' || ph.indexOf('data:image/') !== 0 || ph.length > 700000) continue;
      if (orgPayStatus(org, i, nm) === 'pending') {
        if (orgSetPayStatus(org, i, nm, 'reported')) changed = true;
      }
      if (orgPayStatus(org, i, nm) === 'reported') {
        const r = org.rounds[i];
        if (!r.info || typeof r.info !== 'object') r.info = {};
        if (!r.info[nm]) r.info[nm] = { st: 'reported' };
        if (r.info[nm].photo !== ph) { r.info[nm].photo = ph; changed = true; }
      }
    }
  });
  return changed;
}
async function sanPublishLink(silent) {
  const org = db && db.sanOrg;
  const msg = document.getElementById('org-link-msg');
  if (!org) return false;
  const sb = supa();
  if (!sb || !cloudUser) {
    if (!silent && msg) msg.textContent = t('org_link_need_cloud');
    return false;
  }
  const hadToken = !!org.linkToken;
  if (!org.linkToken) {
    const a = new Uint8Array(12);
    crypto.getRandomValues(a);
    org.linkToken = Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
    save();
  }
  /* Compilación 35: ANTES de subir, leer la foto actual del servidor
     y fusionar sus reportes (si la lectura falla, se aborta la
     publicación: mejor no publicar que pisar un reporte). */
  if (hadToken) {
    let serverSnap = null;
    try {
      const cur = await sb.from('san_public_links').select('data').eq('token', org.linkToken).maybeSingle();
      if (cur && cur.error) {
        if (!silent && msg) msg.textContent = t('cloud_err_generic');
        return false;
      }
      if (cur && cur.data && cur.data.data && typeof cur.data.data === 'object') serverSnap = cur.data.data;
    } catch (e) {
      if (!silent && msg) msg.textContent = t('cloud_err_generic');
      return false;
    }
    if (serverSnap && mergeSanPublicReports(org, serverSnap)) save();
  }
  try {
    const res = await sb.from('san_public_links').upsert(
      { token: org.linkToken, user_id: cloudUser.id, data: orgPublicSnapshot(org) },
      { onConflict: 'token' });
    if (res && res.error) {
      if (!silent && msg) msg.textContent = t('cloud_err_generic');
      return false;
    }
    if (msg) msg.textContent = t('org_link_ready');
    return true;
  } catch (e) {
    if (!silent && msg) msg.textContent = t('cloud_err_generic');
    return false;
  }
}
function orgMaybeRepublish() {
  if (db && db.sanOrg && db.sanOrg.linkToken && cloudUser) {
    sanPublishLink(true).catch(() => { /* best-effort: nunca rompe la app */ });
  }
}
let orgReceiptTarget = null;
const orgReceiptOpen = {};
/* Compilación 37: acordeón de rondas del organizador. Solo una
   ronda va expandida a la vez (orgOpenRound; -1 = ninguna) y las
   demás se ven como tarjeta compacta. Al aparecer un san (clave
   nueva: nombre|fecha|nº de participantes) la expandida por
   defecto es la que está corriendo; la elección del usuario manda
   mientras el san sea el mismo. */
let orgOpenRound = -1;
let orgOpenRoundFor = null;
function orgRoundKey(org) {
  return org.name + '|' + org.startDate + '|' + org.participants.length;
}
/* La ronda que está corriendo: sin iniciar, la primera; si no, la
   primera sin completar cuya fecha ya llegó; si las incompletas
   son futuras, la primera incompleta; si están todas completas,
   la última. */
function orgRunningRound(org) {
  const n = org.participants.length;
  if (!n) return -1;
  if (!org.started) return 0;
  const today = todayStr();
  for (let i = 0; i < n; i++) {
    if (orgRoundPaidCount(org, i) < n && orgRoundDate(org, i) <= today) return i;
  }
  const cur = orgCurrentRound(org);
  return cur >= n ? n - 1 : cur;
}

function orgParticipantPaidRounds(org, name) {
  return org.rounds.filter((r) => r.paid[name]).length;
}
function resetSanOrgForm() {
  const form = document.getElementById('org-form');
  if (!form) return;
  form.reset();
  const pname = document.getElementById('org-pname');
  if (pname) pname.value = '';
  const pzelle = document.getElementById('org-pzelle');
  if (pzelle) pzelle.value = '';
  const start = document.getElementById('org-start');
  if (start) start.value = todayStr();
  sanOrgDraft = [];
  showError('org-error', '');
  orgShuffleMsg('org-draft-shuffle-msg', null);
}

function readOrgCompFromForm() {
  const modeEl = document.getElementById('org-comp');
  const mode = modeEl && ['none', 'first', 'last', 'extra'].includes(modeEl.value) ? modeEl.value : 'none';
  const amtEl = document.getElementById('org-comp-amount');
  const cents = amtEl ? parseAmount(amtEl.value, false) : null;
  return { mode: mode, amountCents: mode === 'extra' ? (cents || 0) : 0 };
}
function readOrgPenaltyFromForm() {
  const modeEl = document.getElementById('org-penalty');
  const mode = modeEl && ['none', 'fixed', 'percent'].includes(modeEl.value) ? modeEl.value : 'none';
  const amtEl = document.getElementById('org-penalty-amount');
  const pctEl = document.getElementById('org-penalty-percent');
  const cents = amtEl ? parseAmount(amtEl.value, false) : null;
  const pct = pctEl ? cleanPct(pctEl.value) : 0;
  return { mode: mode, amountCents: mode === 'fixed' ? (cents || 0) : 0, percent: mode === 'percent' ? pct : 0 };
}
function updateOrgFormVisibility() {
  const comp = readOrgCompFromForm();
  const pen = readOrgPenaltyFromForm();
  const cw = document.getElementById('org-comp-amount-wrap');
  if (cw) cw.hidden = comp.mode !== 'extra';
  const paw = document.getElementById('org-penalty-amount-wrap');
  if (paw) paw.hidden = pen.mode !== 'fixed';
  const ppw = document.getElementById('org-penalty-percent-wrap');
  if (ppw) ppw.hidden = pen.mode !== 'percent';
}
function orgSimLines(n, aporteCents, comp) {
  const sim = orgSimulation(n, aporteCents, comp);
  const lines = [
    t('org_sim_pays', { amount: fmt(sim.perRoundPay) }),
    t('org_sim_pot', { amount: fmt(sim.pot) }),
    t('org_sim_total_in', { amount: fmt(sim.totalIn) })
  ];
  if (comp && comp.mode === 'extra') lines.push(t('org_sim_extra_org', { amount: fmt(sim.orgExtraPerRound) }));
  else if (comp && comp.mode === 'first') lines.push(t('org_sim_first'));
  else if (comp && comp.mode === 'last') lines.push(t('org_sim_last'));
  return lines;
}
function updateOrgSim() {
  updateOrgFormVisibility();
  const box = document.getElementById('org-sim');
  if (!box) return;
  clearNode(box);
  const amtEl = document.getElementById('org-amount');
  const amt = amtEl ? parseAmount(amtEl.value, false) : null;
  if (!amt || sanOrgDraft.length < 1) return;
  box.appendChild(el('h4', null, t('org_sim_title')));
  for (const line of orgSimLines(sanOrgDraft.length, amt, readOrgCompFromForm())) {
    box.appendChild(el('p', 'muted small', line));
  }
}
function renderOrgHistoryInto(box, history) {
  clearNode(box);
  if (!history || !history.length) return;
  box.appendChild(el('h4', null, t('org_history_title')));
  for (const h of history.slice().reverse()) {
    if (h.kind === 'swap') box.appendChild(el('p', 'muted small', t('org_history_swap', { a: h.a, b: h.b }) + ' · ' + prettyDate(h.ts)));
    else if (h.kind === 'started') box.appendChild(el('p', 'muted small', t('org_history_started') + ' · ' + prettyDate(h.ts)));
  }
}
function renderSanOrg() {
  const locked = document.getElementById('org-locked');
  const main = document.getElementById('org-main');
  if (!locked || !main) return;
  const pro = isPro();
  locked.hidden = pro;
  main.hidden = !pro;
  if (!pro) return;
  const has = !!db.sanOrg;
  document.getElementById('org-create-wrap').hidden = has;
  document.getElementById('org-active-wrap').hidden = !has;
  if (!has) {
    orgOpenRound = -1;
    orgOpenRoundFor = null;
    const ul = document.getElementById('org-draft-list');
    clearNode(ul);
    for (const item of sanOrgDraft) {
      const li = el('li', 'item');
      const mainLi = el('div', 'item-main');
      mainLi.appendChild(el('div', 'item-title', item.name));
      if (item.zelle) mainLi.appendChild(el('div', 'item-sub', item.zelle));
      li.appendChild(mainLi);
      const acts = el('div', 'item-actions');
      acts.appendChild(actionButton(t('san_remove'), 'btn-ghost', () => {
        sanOrgDraft = sanOrgDraft.filter((x) => x.name !== item.name);
        renderSanOrg();
      }));
      li.appendChild(acts);
      ul.appendChild(li);
    }
    document.getElementById('org-draft-empty').hidden = sanOrgDraft.length > 0;
    updateOrgSim();
    return;
  }
  const org = db.sanOrg;
  const n = org.participants.length;
  /* Compilación 37: al aparecer un san nuevo, el acordeón nace con
     la ronda que está corriendo expandida. */
  if (orgOpenRoundFor !== orgRoundKey(org)) {
    orgOpenRoundFor = orgRoundKey(org);
    orgOpenRound = orgRunningRound(org);
  }
  document.getElementById('org-title-line').textContent = org.name;
  document.getElementById('org-meta-line').textContent =
    t('san_aporte_line', { amount: fmt(org.aporteCents) }) + ' · ' + t('org_freq_' + org.frequency);
  document.getElementById('org-total-line').textContent =
    t('san_total_line', { amount: fmt(orgTotalReunido()) });
  const startedLine = document.getElementById('org-started-line');
  if (startedLine) { startedLine.hidden = !org.started; startedLine.textContent = t('org_started_line'); }
  const compLine = document.getElementById('org-comp-line');
  if (compLine) {
    compLine.hidden = orgCompMode(org) === 'none';
    compLine.textContent = orgCompMode(org) === 'none' ? '' : t('org_comp_line', { mode: orgCompLabel(org) });
  }
  const simBox = document.getElementById('org-sim-active');
  if (simBox) {
    clearNode(simBox);
    for (const line of orgSimLines(n, org.aporteCents, org.comp)) simBox.appendChild(el('p', 'muted small', line));
  }
  const penLine = document.getElementById('org-penalty-line');
  if (penLine) { const pl = orgPenaltyLine(org); penLine.hidden = !pl; penLine.textContent = pl; }
  /* Compilación 32: el botón se busca por su propio id (org-start-btn).
     Antes compartía id con el input de fecha del formulario y
     getElementById devolvía el input: el botón quedaba sin handler y
     sin ocultar, y el clic que «iniciaba» era el del campo de fecha. */
  const startBtn = document.getElementById('org-start-btn');
  if (startBtn) startBtn.hidden = !!org.started;
  const anyActivity = org.participants.some((unused, i) => orgRoundHasActivity(org, i));
  const shuffleBtn = document.getElementById('org-shuffle-active');
  if (shuffleBtn) shuffleBtn.hidden = !!org.started || anyActivity;
  /* Orden de turnos: subir/bajar con bloqueo si hay pagos. */
  const orderBox = document.getElementById('org-order');
  if (orderBox) {
    clearNode(orderBox);
    org.participants.forEach((name, i) => {
      const li = el('li', 'item');
      const mainLi = el('div', 'item-main');
      mainLi.appendChild(el('div', 'item-title', (i + 1) + '. ' + name));
      mainLi.appendChild(el('div', 'item-sub', prettyDate(orgRoundDate(org, i))));
      li.appendChild(mainLi);
      const acts = el('div', 'item-actions');
      const up = actionButton(t('org_move_up'), 'btn-ghost', () => onOrgMoveTurn(i, -1));
      if (i === 0) up.disabled = true;
      const down = actionButton(t('org_move_down'), 'btn-ghost', () => onOrgMoveTurn(i, 1));
      if (i === n - 1) down.disabled = true;
      acts.appendChild(up);
      acts.appendChild(down);
      li.appendChild(acts);
      orderBox.appendChild(li);
    });
  }
  const roundsBox = document.getElementById('org-rounds');
  clearNode(roundsBox);
  org.participants.forEach((receiver, i) => {
    /* Compilación 37: acordeón — la tarjeta retraída conserva el
       vistazo útil (ronda, fecha, quién recibe y el avance con los
       pendientes contados, sin nombres ni botones); la expandida
       trae todo lo de siempre. Tocar la cabecera abre o cierra, y
       al abrir una se retraen las demás. */
    const open = orgOpenRound === i;
    const card = el('div', 'card org-round-card' + (open ? ' org-round-open' : ''));
    const paidCount = orgRoundPaidCount(org, i);
    const head = el('h4', 'org-round-head',
      t('org_round', { x: i + 1, n: n }) + ' · ' + prettyDate(orgRoundDate(org, i)));
    head.appendChild(el('span', 'org-round-chevron', open ? '▾' : '▸'));
    head.setAttribute('role', 'button');
    head.setAttribute('data-org-round', String(i));
    head.addEventListener('click', () => {
      orgOpenRound = orgOpenRound === i ? -1 : i;
      renderSanOrg();
    });
    card.appendChild(head);
    card.appendChild(el('p', 'total-line', t('org_receiver_line', { name: receiver })));
    card.appendChild(el('p', 'muted', t('san_week_collected', {
      amount: fmt(paidCount * org.aporteCents), target: fmt(n * org.aporteCents)
    })));
    const pending = org.participants.filter((pp) => orgPayStatus(org, i, pp) !== 'confirmed');
    if (!open) {
      card.appendChild(el('p', 'muted small', pending.length
        ? t(pending.length === 1 ? 'org_pending_count_one' : 'org_pending_count_many', { n: pending.length })
        : t('org_pending_none')));
      roundsBox.appendChild(card);
      return;
    }
    const recvZelle = org.zelle && org.zelle[receiver];
    if (recvZelle) card.appendChild(el('p', 'muted small', t('org_zelle_line', { zelle: recvZelle })));
    card.appendChild(el('p', 'muted small', pending.length
      ? t('org_pending_list', { names: pending.join(', ') })
      : t('org_pending_none')));
    for (const pp of org.participants) {
      const st = orgPayStatus(org, i, pp);
      const row = el('div', 'toggle-row');
      row.appendChild(el('span', null, pp));
      const chip = actionButton(t('org_status_btn', { status: t('org_pay_' + st) }), 'btn-ghost', () => {
        const next = st === 'pending' ? 'reported' : (st === 'reported' ? 'confirmed' : 'pending');
        orgSetPayStatus(org, i, pp, next);
        save(); renderSanOrg(); orgMaybeRepublish();
      });
      chip.setAttribute('data-org-status', st);
      chip.setAttribute('data-org-name', pp);
      row.appendChild(chip);
      const recBtn = actionButton(t('org_receipt_add'), 'btn-ghost', () => {
        orgReceiptTarget = { round: i, name: pp };
        const fi = document.getElementById('org-receipt-file');
        if (fi) { fi.value = ''; fi.click(); }
      });
      row.appendChild(recBtn);
      card.appendChild(row);
      const info = org.rounds[i].info && org.rounds[i].info[pp];
      if (info && info.photo) {
        const key = i + ':' + pp;
        const viewBtn = actionButton(t('org_receipt_view'), 'btn-ghost', () => {
          orgReceiptOpen[key] = !orgReceiptOpen[key];
          renderSanOrg();
        });
        card.appendChild(viewBtn);
        const rmBtn = actionButton(t('org_receipt_remove'), 'btn-ghost', () => {
          if (org.rounds[i].info && org.rounds[i].info[pp]) delete org.rounds[i].info[pp].photo;
          save(); renderSanOrg(); orgMaybeRepublish();
        });
        card.appendChild(rmBtn);
        if (orgReceiptOpen[key]) {
          const img = document.createElement('img');
          img.className = 'receipt-preview';
          img.alt = '';
          img.src = info.photo;
          card.appendChild(img);
        }
      }
    }
    roundsBox.appendChild(card);
  });
  const totals = document.getElementById('org-totals');
  clearNode(totals);
  for (const pp of org.participants) {
    const paidRounds = orgParticipantPaidRounds(org, pp);
    const li = el('li', 'item');
    const mainLi = el('div', 'item-main');
    mainLi.appendChild(el('div', 'item-title', pp));
    mainLi.appendChild(el('div', 'item-sub', t('org_paid_rounds', { paid: paidRounds, n: n })));
    li.appendChild(mainLi);
    li.appendChild(el('div', 'item-amount', fmt(paidRounds * org.aporteCents)));
    totals.appendChild(li);
  }
  const histBox = document.getElementById('org-history');
  if (histBox) renderOrgHistoryInto(histBox, org.history);
  const linkPub = document.getElementById('org-link-publish');
  if (linkPub) linkPub.textContent = org.linkToken ? t('org_link_update') : t('org_link_publish');
  const linkCopy = document.getElementById('org-link-copy');
  if (linkCopy) linkCopy.hidden = !org.linkToken;
}
function onOrgMoveTurn(idx, dir) {
  const org = db.sanOrg;
  if (!org) return;
  const msg = document.getElementById('org-swap-msg');
  if (orgMoveTurn(org, idx, dir)) {
    if (msg) msg.textContent = '';
    save(); renderSanOrg(); orgMaybeRepublish();
  } else if (msg) {
    msg.textContent = t('org_swap_blocked');
  }
}
/* Compilación 32: ningún botón de esta pantalla queda mudo. El sorteo
   siempre deja un mensaje visible: confirmación cuando se sortea y el
   motivo exacto cuando no se puede (con 2 participantes el orden
   sorteado coincide la mitad de las veces y sin mensaje el botón
   parecía no responder). */
function orgShuffleMsg(id, key) {
  const m = document.getElementById(id);
  if (m) m.textContent = key ? t(key) : '';
}
function onOrgShuffleDraft() {
  if (sanOrgDraft.length < 2) { orgShuffleMsg('org-draft-shuffle-msg', 'org_shuffle_need'); return; }
  orgShuffleArray(sanOrgDraft);
  renderSanOrg();
  orgShuffleMsg('org-draft-shuffle-msg', 'org_shuffled');
}
function onOrgShuffleActive() {
  const org = db.sanOrg;
  if (!org) return;
  if (org.started || org.participants.some((unused, i) => orgRoundHasActivity(org, i))) {
    orgShuffleMsg('org-shuffle-msg', 'org_shuffle_blocked');
    return;
  }
  orgShuffleArray(org.participants);
  save(); renderSanOrg(); orgMaybeRepublish();
  orgShuffleMsg('org-shuffle-msg', 'org_shuffled');
}
function onSanOrgStart() {
  const org = db.sanOrg;
  if (!org || org.started) return;
  org.started = true;
  if (!Array.isArray(org.history)) org.history = [];
  org.history.push({ ts: todayStr(), kind: 'started', a: '', b: '' });
  save(); renderSanOrg(); orgMaybeRepublish();
  orgShuffleMsg('org-shuffle-msg', null);
}
function onOrgReminder() {
  const org = db.sanOrg;
  if (!org) return;
  window.open('https://wa.me/?text=' + encodeURIComponent(orgReminderText(org)));
}
async function onOrgLinkPublish() {
  await sanPublishLink(false);
  renderSanOrg();
}
function onOrgLinkCopy() {
  const org = db.sanOrg;
  if (!org || !org.linkToken) return;
  const url = sanPublicLink(org);
  const msg = document.getElementById('org-link-msg');
  const done = () => { if (msg) msg.textContent = t('org_link_copied'); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(done).catch(() => { shareText(org.name, url); done(); });
  } else {
    shareText(org.name, url);
    done();
  }
}


function onSanOrgAddParticipant() {
  const input = document.getElementById('org-pname');
  const name = cleanText(input.value, 40);
  if (!name || !/[\p{L}\p{N}]/u.test(name)) { showError('org-error', t('san_err_pname')); return; }
  if (sanOrgDraft.some((x) => x.name.toLowerCase() === name.toLowerCase())) {
    showError('org-error', t('san_err_dup')); return;
  }
  const pz = document.getElementById('org-pzelle');
  const zelle = pz ? cleanText(pz.value, 60) : '';
  sanOrgDraft.push({ name: name, zelle: zelle });
  input.value = '';
  if (pz) pz.value = '';
  showError('org-error', '');
  renderSanOrg();
}


function onSanOrgCreateSubmit(ev) {
  ev.preventDefault();
  /* Compilación 33: con un san del organizador ACTIVO, crear está
     bloqueado aquí, en el handler, no solo ocultando el formulario.
     La revisión de la Fase 2 demostró que un submit que llegara con
     un san en curso lo reemplazaba en silencio: se perdían los pagos,
     las fotos de comprobante, el historial y el token del enlace
     público (linkToken quedaba null y el enlace moría). Para crear
     otro hay que borrar primero el actual (esa baja sí pide
     confirmación: onSanOrgDelete). */
  if (db.sanOrg) { showError('org-error', t('org_err_active_exists', { name: db.sanOrg.name })); return; }
  if (!requirePro()) return; /* función Pro: sin Pro, muro y no se crea nada */
  const name = cleanText(document.getElementById('org-name').value, 60);
  if (!name) { showError('org-error', t('org_err_san_name')); return; }
  const cents = parseAmount(document.getElementById('org-amount').value, false);
  if (cents === null) { showError('org-error', t('err_amount')); return; }
  const pendingInput = document.getElementById('org-pname');
  const pending = pendingInput ? cleanText(pendingInput.value, 40) : '';
  if (pending) {
    if (/[\p{L}\p{N}]/u.test(pending)) {
      if (sanOrgDraft.some((x) => x.name.toLowerCase() === pending.toLowerCase())) {
        showError('org-error', t('san_err_dup')); return;
      }
      const pz = document.getElementById('org-pzelle');
      sanOrgDraft.push({ name: pending, zelle: pz ? cleanText(pz.value, 60) : '' });
    }
    pendingInput.value = '';
  }
  if (sanOrgDraft.length < 2) { showError('org-error', t('san_err_participants')); return; }
  const freqSel = document.getElementById('org-freq').value;
  const startRaw = document.getElementById('org-start').value;
  const participants = sanOrgDraft.map((x) => x.name);
  const zelle = {};
  for (const x of sanOrgDraft) if (x.zelle) zelle[x.name] = x.zelle;
  db.sanOrg = {
    name: name,
    aporteCents: cents,
    frequency: ORG_FREQUENCIES.includes(freqSel) ? freqSel : 'semanal',
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(startRaw || '') ? startRaw : todayStr(),
    participants: participants,
    rounds: participants.map(() => ({ paid: {}, info: {} })),
    comp: readOrgCompFromForm(),
    penalty: readOrgPenaltyFromForm(),
    started: false,
    zelle: zelle,
    history: [],
    linkToken: null
  };
  resetSanOrgForm();
  save(); renderSanOrg();
}


function onSanOrgDelete() {
  if (!db.sanOrg) return;
  if (!window.confirm(t('org_delete_confirm', { name: db.sanOrg.name }))) return;
  db.sanOrg = null;
  save(); renderSanOrg();
}
/* Líneas del estado del grupo: las usan el compartir por texto
   (WhatsApp y demás, vía shareText) y la imagen del estado. */
function orgShareLines() {
  const org = db.sanOrg;
  if (!org) return [];
  const n = org.participants.length;
  const lines = ['🤝 ' + org.name + ' · ' + t('org_share_title')];
  lines.push(t('san_aporte_line', { amount: fmtMoney(org.aporteCents) }) + ' · ' + t('org_freq_' + org.frequency));
  if (org.comp && org.comp.mode !== 'none') lines.push(t('org_comp_line', { mode: orgCompLabel(org) }));
  const penLineShare = orgPenaltyLine(org);
  if (penLineShare) lines.push(penLineShare);
  const cur = orgCurrentRound(org);
  if (cur >= n) {
    lines.push(t('san_finished'));
  } else {
    lines.push(t('org_round', { x: cur + 1, n: n }) + ' · ' + prettyDate(orgRoundDate(org, cur)));
    lines.push(t('org_receiver_line', { name: org.participants[cur] }));
    const recvZ = org.zelle && org.zelle[org.participants[cur]];
    if (recvZ) lines.push(t('org_zelle_line', { zelle: recvZ }));
    lines.push(t('san_week_collected', {
      amount: fmtMoney(orgRoundPaidCount(org, cur) * org.aporteCents),
      target: fmtMoney(n * org.aporteCents)
    }));
    const pending = org.participants.filter((p) => !org.rounds[cur].paid[p]);
    if (pending.length) lines.push('⏳ ' + pending.join(', '));
  }
  lines.push(t('san_total_line', { amount: fmtMoney(orgTotalReunido()) }));
  lines.push(t('org_antifraud'));
  return lines;
}
function onShareSanOrg() {
  if (!db.sanOrg) return;
  const lines = orgShareLines();
  if (lines.length) shareText(db.sanOrg.name, lines.join('\n'));
}
/* Imagen del estado del grupo, con la misma marca que el informe
   mensual (lienzo puro, sin librerías). Devuelve null sin contexto 2d. */
function buildSanOrgCanvas() {
  const org = db.sanOrg;
  if (!org) return null;
  const lines = orgShareLines().slice(1);
  const n = org.participants.length;
  for (const p of org.participants) {
    lines.push(p + ': ' + t('org_paid_rounds', { paid: orgParticipantPaidRounds(org, p), n: n }) +
      ' · ' + fmtMoney(orgParticipantPaidRounds(org, p) * org.aporteCents));
  }
  const height = 150 + lines.length * 46 + 30;
  const canvas = document.createElement('canvas');
  canvas.width = 800; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const P = canvasPalette();
  ctx.fillStyle = P.bg; ctx.fillRect(0, 0, 800, height);
  ctx.fillStyle = P.header; ctx.fillRect(0, 0, 800, 96);
  ctx.fillStyle = P.headerText; ctx.font = 'bold 34px sans-serif';
  ctx.fillText(t('app_title'), 40, 58);
  ctx.fillStyle = P.ink; ctx.font = 'bold 28px sans-serif';
  ctx.fillText(org.name, 40, 148);
  ctx.font = '24px sans-serif';
  let y = 200;
  for (const line of lines) {
    ctx.fillStyle = P.ink; ctx.fillText(line, 40, y);
    y += 46;
  }
  return canvas;
}
/* Comparte el estado como IMAGEN: Web Share con archivos cuando el
   sistema lo permite; si no, la imagen se descarga (mismo patrón que
   el informe mensual). */
async function shareSanOrgPng() {
  const canvas = buildSanOrgCanvas();
  if (!canvas) return;
  try {
    const blob = await new Promise((resolve) => {
      if (canvas.toBlob) canvas.toBlob(resolve, 'image/png');
      else resolve(null);
    });
    if (blob && typeof File !== 'undefined' && navigator.share && navigator.canShare) {
      const file = new File([blob], 'san-organizador.png', { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: t('org_share_title') });
          return;
        } catch (e) {
          if (e && e.name === 'AbortError') return;
        }
      }
    }
  } catch (e) { /* sin lienzo/blob disponible: se cae a la descarga */ }
  try {
    const url = canvas.toDataURL ? canvas.toDataURL('image/png') : null;
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = 'san-organizador.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e) { /* sin lienzo disponible: no pasa nada */ }
}



/* --- Visor público de solo lectura (#san=TOKEN) ---
   Sin sesión: usa el cliente anónimo de Supabase y la función
   get_san_public, que devuelve solo la foto sin comprobantes. */
/* Compilación 32: modo visor público del san (#san=<token>). Con la
   bandera activa, el arranque NO reconcilia la nube ni refresca la
   facturación: la reconciliación podría redibujar la app (o abrir el
   diálogo de conflicto) por encima del visor de un participante que
   abrió el enlace en un navegador nuevo. */
let SAN_PUBLIC_MODE = false;
/* Compilación 35: el visor público es PARTICIPATIVO. El token, la
   foto del san y el aviso tras reportar viven en estas variables para
   poder redibujar el visor (renderSanPublic) tras cada reporte sin
   volver a pedir la foto al servidor. */
let sanPublicToken = null;
let sanPublicData = null;
let sanPublicFlash = '';
async function initSanPublic(token) {
  /* token === undefined → se extrae del hash con la regex estricta
     (compatibilidad); token === null → la URL traía #san= pero el
     token no es válido: se muestra el visor con «no disponible». */
  if (token === undefined) {
    const m = /^#san=([A-Za-z0-9]+)$/.exec(location.hash || '');
    token = m ? m[1] : null;
  }
  SAN_PUBLIC_MODE = true;
  sanPublicToken = token;
  /* Compilación 35 (Bloque 2.3): el visor se presenta SIEMPRE con el
     tema oscuro de la app (acento verde), sin depender de los ajustes
     locales del visitante: se fijan los atributos que pinta
     applyTheme() sin tocar la base local (que aquí ni siquiera es la
     del visitante). */
  const de = document.documentElement;
  if (de.setAttribute) { de.setAttribute('data-theme', 'oscuro'); de.setAttribute('data-accent', 'verde'); }
  if (de.dataset) { de.dataset.theme = 'oscuro'; de.dataset.accent = 'verde'; }
  const pub = document.getElementById('san-public');
  const box = document.getElementById('san-public-body');
  const shell = document.getElementById('app-shell');
  const onb = document.getElementById('view-onboarding');
  const lock = document.getElementById('view-lock');
  if (shell) shell.hidden = true;
  if (onb) onb.hidden = true;
  if (lock) lock.hidden = true;
  if (pub) pub.hidden = false;
  if (!box) return true;
  let data = null;
  const sb = supa();
  if (sb && token) {
    try {
      const res = await sb.rpc('get_san_public', { p_token: token });
      if (res && !res.error) data = res.data;
    } catch (e) { /* sin red o sin función: se muestra «no disponible» */ }
  }
  sanPublicData = (data && typeof data === 'object' && !Array.isArray(data)) ? data : null;
  /* Compilación 37: la mini barra de marca pegajosa se vigila con un
     único oyente de scroll (pasivo) por página; el oyente no hace
     nada fuera del modo público. */
  if (!window.__pubTopbarBound) {
    window.__pubTopbarBound = true;
    window.addEventListener('scroll', sanPublicTopbarUpdate, { passive: true });
  }
  renderSanPublic();
  return true;
}
/* Compilación 37: mini barra de marca pegajosa del visor público.
   Se muestra solo cuando el hero de marca ya salió de la vista (la
   persona bajó por el san): franja fina con el icono, «PETO
   Finanzas» y el enlace «Probar». La sección compensa su alto con
   la clase pub-top-on para que la franja nunca tape el contenido.
   Fuera del modo público, sin datos o con la sección oculta, la
   barra queda oculta y sin clases: en la app normal no existe. */
function sanPublicTopbarUpdate() {
  const top = document.getElementById('san-public-topbar');
  const pub = document.getElementById('san-public');
  if (!top || !pub) return;
  let show = false;
  if (SAN_PUBLIC_MODE && sanPublicData && !pub.hidden) {
    const hero = document.querySelector('#san-public-body .pub-hero');
    const limit = hero ? Math.max(0, hero.offsetTop + hero.offsetHeight - 44) : 96;
    show = (window.scrollY || 0) > limit;
  }
  top.classList.toggle('pub-top-show', show);
  pub.classList.toggle('pub-top-on', show);
}
/* Dibuja el visor desde sanPublicData.
   Compilación 35 (Bloque 2.1): el texto de org_public_title («El
   enlace está listo para compartir.») es el estado del enlace en la
   pantalla del ORGANIZADOR y aquí no se pinta ninguna vez.
   Compilación 36: el visor es la VITRINA de la app (el enlace se
   comparte por WhatsApp y se abre en teléfonos, mobile-first):
   cabecera de marca con degradado esmeralda y el logo, tarjeta del
   san elevada con su avance (pagos confirmados / total, calculado
   SOLO desde la foto pública), la línea antifraude como sello de
   confianza, estados con pastillas de color, tarjeta final de
   llamado a la acción y barra fija inferior en pantallas estrechas
   (en anchas manda la tarjeta final). Nada de esto expone datos
   nuevos: todo sale de la misma foto pública de siempre, y el flujo
   «Ya pagué» de la 35 queda intacto. La barra vive fuera del cuerpo
   (en el esqueleto) para que clearNode no la borre al redibujar;
   solo se muestra cuando hay san que mostrar. */
const PUB_APP_URL = 'https://petofinanzas.com/app/';
const PUB_SITE_URL = 'https://petofinanzas.com/';
function sanPublicLinkEl(label, href, className) {
  const a = el('a', className, label);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}
function sanPublicPayRow(nm, st) {
  /* Fila de estado SIN acción (Reportado o Confirmado): el nombre y
     la pastilla de color con el estado. El nombre lleva el « · » de
     siempre para que el texto completo se lea «Nombre · Estado». */
  const row = el('div', 'toggle-row pub-pay-row');
  row.appendChild(el('span', 'pub-pay-name', nm + ' · '));
  const key = st === 'reported' ? 'org_pub_reported_note' : ('org_pay_' + st);
  row.appendChild(el('span', 'pub-pill pub-pill-' + st, t(key)));
  return row;
}
function renderSanPublic() {
  const box = document.getElementById('san-public-body');
  if (!box) return;
  clearNode(box);
  const bar = document.getElementById('san-public-bar');
  const barBtn = document.getElementById('san-public-bar-btn');
  if (barBtn) barBtn.textContent = t('pub_bar_try');
  const topbar = document.getElementById('san-public-topbar');
  const topBtn = document.getElementById('san-public-topbar-btn');
  if (topBtn) topBtn.textContent = t('pub_bar_try');
  /* Cabecera de marca (hero): degradado esmeralda, logo y frase. */
  const hero = el('div', 'pub-hero');
  const logo = el('img', 'pub-hero-logo');
  logo.src = 'icons/icon-512.png';
  logo.alt = t('app_title');
  hero.appendChild(logo);
  const heroText = el('div', 'pub-hero-text');
  heroText.appendChild(el('h2', 'pub-hero-brand', t('app_title')));
  heroText.appendChild(el('p', 'pub-tagline', t('pub_tagline')));
  hero.appendChild(heroText);
  box.appendChild(hero);
  const data = sanPublicData;
  if (!data) {
    if (bar) bar.hidden = true;
    /* Sin san que mostrar, la barra de marca tampoco: como la barra
       inferior de la 36, no aparece ni deja clases puestas. */
    if (topbar) {
      topbar.hidden = true;
      topbar.classList.remove('pub-top-show');
      const pubSec = document.getElementById('san-public');
      if (pubSec) pubSec.classList.remove('pub-top-on');
    }
    box.appendChild(el('p', 'muted pub-notfound', t('org_public_notfound')));
    return;
  }
  if (bar) bar.hidden = false;
  if (topbar) {
    topbar.hidden = false;
    sanPublicTopbarUpdate();
  }
  if (sanPublicFlash) {
    box.appendChild(el('p', 'total-line', sanPublicFlash));
    sanPublicFlash = '';
  }
  const names = (Array.isArray(data.participants) ? data.participants : []).map((pp) =>
    (pp && typeof pp === 'object') ? String(pp.name || '') : String(pp || '')).filter((x) => x);
  const zelleMap = {};
  (Array.isArray(data.participants) ? data.participants : []).forEach((pp) => {
    if (pp && typeof pp === 'object' && pp.name && pp.zelle) zelleMap[String(pp.name)] = String(pp.zelle);
  });
  const fakeOrg = {
    startDate: typeof data.startDate === 'string' ? data.startDate : todayStr(),
    frequency: ORG_FREQUENCIES.includes(data.frequency) ? data.frequency : 'semanal',
    participants: names
  };
  const rounds = Array.isArray(data.rounds) ? data.rounds : [];
  /* Tarjeta principal del san: nombre, datos y avance. El avance se
     calcula solo desde la foto: confirmados / total de pagos. */
  const head = el('div', 'pub-head pub-anim');
  head.appendChild(el('h3', 'pub-san-name', String(data.name || '')));
  const aporte = cleanCents(data.aporteCents, false);
  head.appendChild(el('p', 'muted', t('san_aporte_line', { amount: fmtMoney(aporte) }) + ' · ' + t('org_freq_' + fakeOrg.frequency)));
  if (data.comp && data.comp.mode && data.comp.mode !== 'none') {
    head.appendChild(el('p', 'muted', t('org_comp_line', { mode: orgCompLabel(data.comp.mode) })));
  }
  const penPub = orgPenaltyLine({ penalty: data.penalty });
  if (penPub) head.appendChild(el('p', 'muted', penPub));
  let totalPay = 0;
  let confPay = 0;
  for (const rd0 of rounds) {
    totalPay += names.length;
    const conf0 = (rd0 && Array.isArray(rd0.confirmed)) ? rd0.confirmed : [];
    confPay += conf0.filter((nm) => names.includes(nm)).length;
  }
  if (totalPay > 0) {
    const track = el('div', 'pub-progress');
    const fill = el('div', 'pub-progress-fill');
    fill.style.width = Math.round(confPay / totalPay * 100) + '%';
    track.appendChild(fill);
    head.appendChild(track);
    head.appendChild(el('p', 'pub-progress-text',
      confPay > 0 ? t('pub_progress', { x: confPay, n: totalPay }) : t('pub_progress_start')));
  }
  head.appendChild(el('p', 'pub-seal', t('org_antifraud')));
  box.appendChild(head);
  names.forEach((receiver, i) => {
    const card = el('div', 'card pub-round pub-anim');
    card.style.animationDelay = Math.min((i + 1) * 60, 300) + 'ms';
    card.appendChild(el('h4', null, t('org_round', { x: i + 1, n: names.length }) + ' · ' + prettyDate(orgRoundDate(fakeOrg, i))));
    card.appendChild(el('p', 'total-line', t('org_receiver_line', { name: receiver })));
    if (zelleMap[receiver]) card.appendChild(el('p', 'muted small', t('org_zelle_line', { zelle: zelleMap[receiver] })));
    const rd = rounds[i] && typeof rounds[i] === 'object' ? rounds[i] : {};
    const conf = Array.isArray(rd.confirmed) ? rd.confirmed : [];
    const repo = Array.isArray(rd.reported) ? rd.reported : [];
    for (const nm of names) {
      const st = conf.includes(nm) ? 'confirmed' : (repo.includes(nm) ? 'reported' : 'pending');
      if (st === 'pending') {
        card.appendChild(sanPublicPendingRow(i, nm));
      } else {
        /* Sin botón: el Reportado espera la confirmación del
           organizador y el Confirmado es un sello. */
        card.appendChild(sanPublicPayRow(nm, st));
      }
    }
    box.appendChild(card);
  });
  if (Array.isArray(data.history) && data.history.length) {
    const hb = el('div', null);
    renderOrgHistoryInto(hb, data.history);
    box.appendChild(hb);
  }
  if (data.updatedAt) {
    const dstr = String(data.updatedAt).slice(0, 10);
    box.appendChild(el('p', 'muted small', t('org_public_updated', { date: prettyDate(dstr) })));
  }
  /* Llamado a la acción: la tarjeta que vende la app. */
  const cta = el('div', 'pub-cta pub-anim');
  cta.appendChild(el('h4', 'pub-cta-title', t('pub_cta_title')));
  cta.appendChild(el('p', 'pub-cta-text', t('pub_cta_text')));
  const ctaActions = el('div', 'form-actions');
  ctaActions.appendChild(sanPublicLinkEl(t('pub_cta_try'), PUB_APP_URL, 'btn btn-primary'));
  ctaActions.appendChild(sanPublicLinkEl(t('pub_cta_more'), PUB_SITE_URL, 'btn btn-ghost'));
  cta.appendChild(ctaActions);
  box.appendChild(cta);
  box.appendChild(el('p', 'pub-footer', t('pub_footer')));
}
/* Fila de un participante PENDIENTE en el visor: su estado y la acción
   «Ya pagué». Al tocarla se despliega el panel en línea (confirmación
   breve + foto opcional del comprobante, comprimida con la misma
   processReceiptFile de los recibos del organizador). */
function sanPublicPendingRow(roundIdx, nm) {
  const wrap = el('div', null);
  const panel = el('div', 'san-pub-panel');
  panel.hidden = true;
  panel.appendChild(el('p', 'muted small', t('org_pub_confirm')));
  let pendingPhoto = null;
  const photoLine = el('p', 'muted small', '');
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.hidden = true;
  const attachLabel = el('label', 'btn btn-small btn-ghost', t('org_pub_attach'));
  attachLabel.appendChild(fileInput);
  panel.appendChild(attachLabel);
  panel.appendChild(photoLine);
  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!f) return;
    processReceiptFile(f, (url) => {
      if (url) { pendingPhoto = url; photoLine.textContent = '📎 ' + (f.name || '✓'); }
    });
  });
  const errLine = el('p', 'error', '');
  errLine.hidden = true;
  const sendBtn = actionButton(t('org_pub_send'), 'btn-primary', async () => {
    sendBtn.disabled = true;
    errLine.hidden = true;
    const r = await sanPublicReport(sanPublicToken, nm, roundIdx, pendingPhoto);
    if (r.ok) {
      /* La copia local aprende el reporte y el visor se redibuja: la
         fila pasa a «Reportado · esperando confirmación», sin botón. */
      const data = sanPublicData;
      if (data) {
        if (!Array.isArray(data.rounds)) data.rounds = [];
        if (!data.rounds[roundIdx] || typeof data.rounds[roundIdx] !== 'object') data.rounds[roundIdx] = { confirmed: [], reported: [] };
        if (!Array.isArray(data.rounds[roundIdx].reported)) data.rounds[roundIdx].reported = [];
        if (!data.rounds[roundIdx].reported.includes(nm)) data.rounds[roundIdx].reported.push(nm);
        if (pendingPhoto) {
          if (!data.rounds[roundIdx].photos || typeof data.rounds[roundIdx].photos !== 'object') data.rounds[roundIdx].photos = {};
          data.rounds[roundIdx].photos[nm] = pendingPhoto;
        }
      }
      sanPublicFlash = t('org_pub_sent');
      renderSanPublic();
    } else {
      sendBtn.disabled = false;
      errLine.textContent = r.error === 'already_confirmed' ? t('org_pub_err_confirmed')
        : (r.error === 'photo_too_big' ? t('org_pub_err_photo') : t('org_pub_err'));
      errLine.hidden = false;
    }
  });
  const cancelBtn = actionButton(t('btn_cancel'), 'btn-ghost', () => {
    panel.hidden = true;
    payBtn.disabled = false;
  });
  panel.appendChild(sendBtn);
  panel.appendChild(cancelBtn);
  panel.appendChild(errLine);
  const row = el('div', 'toggle-row pub-pay-row');
  row.appendChild(el('span', 'pub-pay-name', nm + ' · '));
  row.appendChild(el('span', 'pub-pill pub-pill-pending', t('org_pay_pending')));
  const payBtn = actionButton(t('org_pub_pay_btn'), 'btn-primary', () => {
    panel.hidden = false;
    payBtn.disabled = true;
  });
  row.appendChild(payBtn);
  wrap.appendChild(row);
  wrap.appendChild(panel);
  return wrap;
}
/* Único canal de escritura del visor: la RPC san_public_report del
   servidor (migración supabase/san-public-report.sql). Solo permite
   pendiente → reportado con foto opcional; confirmar, desmarcar o
   tocar montos/orden/participantes es imposible con el token. */
async function sanPublicReport(token, participant, round, photo) {
  const sb = supa();
  if (!sb || !token) return { ok: false, error: 'offline' };
  try {
    const res = await sb.rpc('san_public_report', {
      p_token: token, p_participant: participant, p_round: round, p_photo: photo || null
    });
    if (res && res.error) return { ok: false, error: 'rpc' };
    const d = res && res.data;
    if (d && d.ok === true) return { ok: true };
    return { ok: false, error: (d && d.error) || 'unknown' };
  } catch (e) { return { ok: false, error: 'network' }; }
}

/* ---------------- AJUSTES ---------------- */
/* Resumen «{visible} de {total} visibles» de la tarjeta plegable de
   secciones: cuenta con la misma fuente que las casillas
   (SECTION_DEFS + settings.sections; visible = flag !== false). */
function updateSectionsSummary() {
  const summary = document.getElementById('sections-summary');
  if (!summary || !db || !db.settings || !db.settings.sections) return;
  const total = SECTION_DEFS.length;
  const visible = SECTION_DEFS.filter((def) => db.settings.sections[def.id] !== false).length;
  summary.textContent = t('set_sections_summary', { visible: visible, total: total });
}
/* Abre/cierra el cuerpo de la tarjeta de secciones y sincroniza
   aria-expanded y el chevrones (▸ cerrado / ▾ abierto). */
function toggleSectionsBody() {
  const head = document.getElementById('sections-toggle');
  const body = document.getElementById('sections-body');
  if (!head || !body) return;
  const open = body.hidden;
  body.hidden = !open;
  head.setAttribute('aria-expanded', open ? 'true' : 'false');
  const chevron = head.querySelector('.sections-chevron');
  if (chevron) chevron.textContent = open ? '▾' : '▸';
}
function renderSettings() {
  renderCloudCard();
  renderProCard();
  renderSharedCard();
  if (SHARED_LIVE) sharedRefresh();
  const settingsBuildEl = document.getElementById('settings-build-label');
  if (settingsBuildEl) settingsBuildEl.textContent = BUILD_LABEL;
  document.getElementById('set-name').value = db.settings.name;
  document.getElementById('set-textsize').value = db.settings.textSize;
  document.getElementById('set-lang').value = db.settings.lang || 'auto';
  document.getElementById('set-theme').value = db.settings.theme || 'auto';
  document.getElementById('set-accent').value = db.settings.accent || 'verde';
  const paydaySel = document.getElementById('set-payday');
  clearNode(paydaySel);
  const noneOpt = el('option', null, t('wd_none'));
  noneOpt.value = '';
  paydaySel.appendChild(noneOpt);
  for (let d = 0; d <= 6; d++) {
    const opt = el('option', null, t('wd_' + d));
    opt.value = String(d);
    paydaySel.appendChild(opt);
  }
  paydaySel.value = (db.settings.payday === null || db.settings.payday === undefined)
    ? '' : String(db.settings.payday);
  document.getElementById('set-reminders').checked = db.settings.reminders !== false;
  document.getElementById('set-notifications').checked = db.settings.notifications === true;
  document.getElementById('set-autofixed').checked = db.settings.autoFixed !== false;
  const setSummaryEl = document.getElementById('set-summary');
  if (setSummaryEl) setSummaryEl.checked = db.settings.summaryDaily !== false;
  const setSummaryTimeEl = document.getElementById('set-summary-time');
  if (setSummaryTimeEl) setSummaryTimeEl.value = db.settings.summaryTime || '08:00';
  const setSummaryEmailEl = document.getElementById('set-summary-email');
  if (setSummaryEmailEl) setSummaryEmailEl.checked = db.settings.summaryEmail === true;
  const summaryEmailRowEl = document.getElementById('summary-email-row');
  if (summaryEmailRowEl) summaryEmailRowEl.hidden = !cloudUser;
  document.getElementById('set-biometric').checked = db.settings.biometric === true;
  document.getElementById('split-ahorro').value = db.settings.split.ahorro;
  document.getElementById('split-negocio').value = db.settings.split.negocio;
  document.getElementById('split-gastos').value = db.settings.split.gastos;
  document.getElementById('split-familia').value = db.settings.split.familia;
  showError('set-error', '');
  showError('pin-error', '');
  showError('data-error', '');
  document.getElementById('pin-status').textContent = db.settings.pinHash
    ? t('pin_status_on')
    : t('pin_status_off');
  const wrap = document.getElementById('section-toggles');
  clearNode(wrap);
  for (const def of SECTION_DEFS) {
    const row = el('label', 'toggle-row');
    row.appendChild(el('span', null, t('sec_' + def.id)));
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = db.settings.sections[def.id] !== false;
    cb.addEventListener('change', () => {
      db.settings.sections[def.id] = cb.checked;
      save();
      updateSectionsSummary();
    });
    row.appendChild(cb);
    wrap.appendChild(row);
  }
  updateSectionsSummary();
}
function onSettingsSubmit(ev) {
  ev.preventDefault();
  const split = {
    ahorro: cleanPct(document.getElementById('split-ahorro').value),
    negocio: cleanPct(document.getElementById('split-negocio').value),
    gastos: cleanPct(document.getElementById('split-gastos').value),
    familia: cleanPct(document.getElementById('split-familia').value)
  };
  const total = split.ahorro + split.negocio + split.gastos + split.familia;
  if (total !== 100) {
    showError('set-error', t('set_err_sum', { total: total }));
    return;
  }
  db.settings.name = cleanText(document.getElementById('set-name').value, 40);
  db.settings.split = split;
  db.settings.textSize = document.getElementById('set-textsize').value === 'grande' ? 'grande' : 'normal';
  db.settings.lang = validLangSetting(document.getElementById('set-lang').value);
  const paydayRaw = document.getElementById('set-payday').value;
  const paydayNum = Math.trunc(Number(paydayRaw));
  db.settings.payday = (paydayRaw !== '' && Number.isFinite(paydayNum) && paydayNum >= 0 && paydayNum <= 6)
    ? paydayNum : null;
  db.settings.reminders = document.getElementById('set-reminders').checked === true;
  const notifWas = db.settings.notifications === true;
  db.settings.notifications = document.getElementById('set-notifications').checked === true;
  db.settings.autoFixed = document.getElementById('set-autofixed').checked === true;
  const summaryCbEl = document.getElementById('set-summary');
  if (summaryCbEl) db.settings.summaryDaily = summaryCbEl.checked === true;
  const summaryTimeEl = document.getElementById('set-summary-time');
  if (summaryTimeEl) {
    const tv = summaryTimeEl.value;
    const tm = /^(\d{2}):(\d{2})$/.exec(tv || '');
    db.settings.summaryTime = (tm && Number(tm[1]) >= 0 && Number(tm[1]) <= 23 && Number(tm[2]) >= 0 && Number(tm[2]) <= 59) ? tv : '08:00';
  }
  const summaryEmailCbEl = document.getElementById('set-summary-email');
  if (summaryEmailCbEl) db.settings.summaryEmail = summaryEmailCbEl.checked === true;
  try {
    const tzNow = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tzNow) db.settings.summaryTz = tzNow;
  } catch (e) { /* sin zona detectable: se conserva la anterior */ }
  db.settings.biometric = document.getElementById('set-biometric').checked === true;
  if (db.settings.biometric && !db.settings.pinHash) window.alert(t('bio_need_pin'));
  const themeVal = document.getElementById('set-theme').value;
  if (themeVal === 'claro' || themeVal === 'oscuro' || themeVal === 'auto') db.settings.theme = themeVal;
  const accentVal = document.getElementById('set-accent').value;
  if (['verde', 'azul', 'morado', 'naranja'].includes(accentVal)) db.settings.accent = accentVal;
  applyTextSize();
  applyTheme();
  save();
  applyStaticI18n();
  if (db.settings.notifications && !notifWas) {
    ensureNotifPermission().then(() => scheduleNotifications());
  } else {
    scheduleNotifications();
  }
  if (db.settings.summaryDaily !== false) {
    ensureNotifPermission().then(() => scheduleDailySummary());
  } else {
    scheduleDailySummary();
  }
  showError('set-error', '');
  window.alert(t('set_saved'));
}
function applyTextSize() {
  document.documentElement.classList.toggle('text-large', db.settings.textSize === 'grande');
}
/* Ejecuta fn justo después del primer pintado del navegador, para que
   el trabajo no esencial no bloquee la apertura (Compilación 28). */
function afterFirstPaint(fn) {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => setTimeout(fn, 0));
  } else {
    setTimeout(fn, 30);
  }
}
async function onPinSubmit(ev) {
  ev.preventDefault();
  const current = document.getElementById('pin-current').value.trim();
  const next = document.getElementById('pin-new').value.trim();
  if (db.settings.pinHash) {
    if (!validPinFormat(current) || !(await checkPin(current))) {
      showError('pin-error', t('pin_err_current')); return;
    }
  }
  if (next !== '' && !validPinFormat(next)) {
    showError('pin-error', t('pin_err_format')); return;
  }
  await setPin(next === '' ? null : next);
  save();
  document.getElementById('pin-form').reset();
  renderSettings();
  window.alert(next === '' ? t('pin_off') : t('pin_updated'));
  /* PIN recién establecido/actualizado: ofrecer la huella en el momento.
     Si el PIN se quitó, maybeOfferBiometric no muestra nada (sin PIN no
     hay bloqueo) y si la huella ya estaba activa, tampoco pregunta. */
  if (next !== '') maybeOfferBiometric();
}

/* ---------------- Datos: exportar / importar / borrar ---------------- */
function onExport() {
  db.lastExportAt = new Date().toISOString();
  save();
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'control-de-gastos-copia.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function onImportFile(ev) {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showError('data-error', t('data_err_big')); return; }
  try {
    const text = await file.text();
    let parsed = JSON.parse(text);
    if (parsed && parsed.petoBackup === 1) {
      const pass = document.getElementById('backup-pass').value;
      if (!pass) { showError('data-error', t('backup_need_pass')); return; }
      try { parsed = JSON.parse(await decryptBackupPayload(parsed, pass)); }
      catch (e2) { showError('data-error', t('backup_err_pass')); return; }
    }
    const clean = validateData(parsed);
    if (!clean || clean.settings.onboarded !== true) throw new Error('formato');
    if (!window.confirm(t('import_confirm'))) return;
    db = clean;
    save();
    applyTextSize();
    applyTheme();
    applyStaticI18n();
    showView('home');
    window.alert(t('import_done'));
  } catch (e) {
    showError('data-error', t('data_err_invalid'));
  }
}
function onReset() {
  if (!window.confirm(t('reset_confirm1'))) return;
  if (!window.confirm(t('reset_confirm2'))) return;
  try { localStorage.removeItem(DB_KEY); } catch (e) { /* sin acceso: se reinicia en memoria */ }
  db = defaultData();
  save();
  location.reload();
}

/* ---------------- Importar CSV del banco (Fase 3) ----------------
   El CSV del estado de cuenta se parsea EN el dispositivo y se muestra
   una VISTA PREVIA: cada fila trae la categoría sugerida, la marca de
   duplicado y su casilla para incluirla o no. NADA se escribe en db
   hasta que la persona pulsa «Importar seleccionados».
   Duplicado = misma fecha + mismo monto + descripción similar a un
   movimiento ya registrado (gasto o ingreso según el signo); nace
   desmarcado. La categoría sugerida sale primero del historial propio
   (misma descripción anotada antes) y luego de palabras clave de
   comercios y servicios conocidos. */
let csvPending = [];
const CSV_COL_DATE = ['date', 'fecha', 'posting date', 'transaction date', 'trans date', 'posted date',
  'fecha transaccion', 'fecha de transaccion', 'fecha movimiento', 'fecha operacion', 'fecha de operacion',
  'operation date', 'value date', 'fecha valor'];
const CSV_COL_DESC = ['description', 'descripcion', 'concepto', 'detalle', 'detalles', 'details',
  'merchant', 'comercio', 'name', 'nombre', 'memo', 'payee', 'movimiento', 'transaction description',
  'descripcion del movimiento'];
const CSV_COL_AMOUNT = ['amount', 'monto', 'importe', 'valor', 'value', 'cantidad', 'net amount', 'total'];
const CSV_COL_DEBIT = ['debit', 'debito', 'cargo', 'cargos', 'withdrawal', 'retiro', 'money out', 'salida', 'salidas'];
const CSV_COL_CREDIT = ['credit', 'credito', 'abono', 'abonos', 'deposit', 'deposito', 'money in', 'entrada', 'entradas', 'ingreso', 'ingresos'];
const CSV_CAT_KEYWORDS = [
  ['Gasolina', ['shell', 'exxon', 'mobil', 'gulf', 'sunoco', 'texaco', 'chevron', 'gasolin', 'fuel', 'gas station', 'british petroleum']],
  ['Comida', ['walmart', 'target', 'costco', 'supermercado', 'supermarket', 'grocery', 'fine fare', 'cherry valley', 'key food', 'aldi', 'lidl', 'trader joe', 'mercadona', 'soriana']],
  ['Comida fuera', ['mcdonald', 'burger king', 'wendy', 'kfc', 'pizza', 'restaurant', 'restaurante', 'doordash', 'uber eats', 'grubhub', 'deli', 'starbucks', 'dunkin', 'taco', 'sushi', 'bakery', 'panaderia', 'cafe ']],
  ['Transporte', ['uber', 'lyft', 'mta', 'metro', 'taxi', 'toll', 'peaje', 'parking', 'parqueo', 'e zpass', 'ez pass', 'transit']],
  ['Salud', ['cvs', 'walgreens', 'pharmacy', 'farmacia', 'clinic', 'clinica', 'hospital', 'dental', 'medical']],
  ['Ropa', ['nike', 'adidas', 'zara', 'marshalls', 'tj maxx', 'old navy', 'gap', 'clothing', 'ropa']],
  ['Renta', ['rent', 'renta', 'alquiler', 'landlord', 'lease']]
];
function csvTokenize(text, delim) {
  const rows = [];
  let row = [], cell = '', inQ = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; }
        else inQ = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') {
      inQ = true;
    } else if (ch === delim) {
      row.push(cell); cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}
function csvDetectDelim(text) {
  let inQ = false, semi = 0, comma = 0, tab = 0;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') inQ = !inQ;
    else if (!inQ && (ch === '\n' || ch === '\r')) break;
    else if (!inQ && ch === ';') semi++;
    else if (!inQ && ch === ',') comma++;
    else if (!inQ && ch === '\t') tab++;
  }
  if (tab > 0 && tab >= semi && tab >= comma) return '\t';
  return semi > comma ? ';' : ',';
}
function csvNormHeader(h) {
  return String(h == null ? '' : h).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function csvFindCol(headers, names) {
  for (const n of names) {
    const i = headers.indexOf(n);
    if (i >= 0) return i;
  }
  for (const n of names) {
    const i = headers.findIndex((h) => h && (h.includes(n) || n.includes(h)));
    if (i >= 0) return i;
  }
  return -1;
}
function csvDateOk(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (Number.isNaN(dt.getTime()) || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}
function csvParseDateCell(raw, preferDMY) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return csvDateOk(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/.exec(s);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    if (a > 12 && b <= 12) return csvDateOk(y, b, a); /* DD/MM inequívoco */
    if (b > 12 && a <= 12) return csvDateOk(y, a, b); /* MM/DD inequívoco */
    /* Ambiguo (05/10): manda el origen del archivo — encabezado en
       español o delimitador ';' → DD/MM; si no, MM/DD de EE. UU. */
    return preferDMY ? csvDateOk(y, b, a) : csvDateOk(y, a, b);
  }
  const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    ene: 1, abr: 4, ago: 8, dic: 12 };
  m = /^(\d{1,2})\s+([a-z]{3,})\.?\s+(\d{4})/i.exec(s);
  if (m && months[m[2].toLowerCase().slice(0, 3)]) return csvDateOk(Number(m[3]), months[m[2].toLowerCase().slice(0, 3)], Number(m[1]));
  m = /^([a-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})/i.exec(s);
  if (m && months[m[1].toLowerCase().slice(0, 3)]) return csvDateOk(Number(m[3]), months[m[1].toLowerCase().slice(0, 3)], Number(m[2]));
  return null;
}
function csvParseAmountCell(raw) {
  let s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
  s = s.replace(/[^0-9.,-]/g, '');
  if (s.charAt(0) === '-') { neg = true; s = s.slice(1); }
  s = s.replace(/-/g, '');
  if (!/[0-9]/.test(s)) return null;
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  let decimalComma = false;
  if (lastDot >= 0 && lastComma >= 0) decimalComma = lastComma > lastDot;
  else if (lastComma >= 0) decimalComma = /,\d{1,2}$/.test(s);
  if (decimalComma) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  return neg ? -cents : cents;
}
function csvNormDesc(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function csvDescSimilar(a, b) {
  const x = csvNormDesc(a), y = csvNormDesc(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 6 && y.includes(x)) return true;
  if (y.length >= 6 && x.includes(y)) return true;
  const tx = new Set(x.split(' ')), ty = new Set(y.split(' '));
  let inter = 0;
  for (const w of tx) if (ty.has(w)) inter++;
  const union = tx.size + ty.size - inter;
  return union > 0 && inter / union >= 0.75;
}
function csvGuessCategory(descRaw) {
  const norm = csvNormDesc(descRaw);
  if (norm) {
    for (const e of db.expenses) {
      if (e.note && csvNormDesc(e.note) === norm) return e.category;
    }
  }
  const low = ' ' + String(descRaw == null ? '' : descRaw).toLowerCase() + ' ';
  for (const pair of CSV_CAT_KEYWORDS) {
    for (const kw of pair[1]) if (low.includes(kw)) return pair[0];
  }
  for (const c of db.customCategories) {
    if (c && low.includes(' ' + c.toLowerCase() + ' ')) return c;
  }
  return 'Otros';
}
function csvFindDuplicate(row) {
  const list = row.kind === 'gasto' ? db.expenses : db.incomes;
  return list.some((x) => x.date === row.date && x.amountCents === row.amountCents &&
    csvDescSimilar(row.description, x.note || ''));
}
/* Paso compartido CSV/PDF: categoría sugerida + duplicado + inclusión.
   Es el mismo paso que usaba csvBuildRows por dentro; se extrajo para
   que las filas del PDF pasen por la idéntica categorización/dedupe. */
function csvEnrichRows(rows) {
  for (const row of rows) {
    if (row.kind === 'gasto') {
      try { row.category = csvGuessCategory(row.description); } catch (e) { row.category = 'Otros'; }
      if (!row.category) row.category = 'Otros';
    } else {
      row.category = '';
    }
    try { row.duplicate = csvFindDuplicate(row); } catch (e) { row.duplicate = false; }
    row.include = !row.duplicate;
  }
  return rows;
}
function csvBuildRows(text) {
  const delim = csvDetectDelim(text);
  const table = csvTokenize(text, delim);
  if (table.length < 2) return { error: 'csv_err_parse' };
  const headers = table[0].map(csvNormHeader);
  const ci = {
    date: csvFindCol(headers, CSV_COL_DATE),
    desc: csvFindCol(headers, CSV_COL_DESC),
    amount: csvFindCol(headers, CSV_COL_AMOUNT),
    debit: csvFindCol(headers, CSV_COL_DEBIT),
    credit: csvFindCol(headers, CSV_COL_CREDIT)
  };
  if (ci.date < 0 || (ci.amount < 0 && ci.debit < 0 && ci.credit < 0)) return { error: 'csv_err_headers' };
  const CSV_DATE_ES = ['fecha', 'fecha transaccion', 'fecha de transaccion', 'fecha movimiento',
    'fecha operacion', 'fecha de operacion', 'fecha valor'];
  const preferDMY = delim === ';' || CSV_DATE_ES.includes(headers[ci.date]);
  const rows = [];
  for (let i = 1; i < table.length; i++) {
    const cells = table[i];
    const date = csvParseDateCell(cells[ci.date], preferDMY);
    if (!date) continue;
    let cents = null;
    if (ci.amount >= 0) {
      cents = csvParseAmountCell(cells[ci.amount]);
    } else {
      const d = ci.debit >= 0 ? csvParseAmountCell(cells[ci.debit]) : null;
      const c = ci.credit >= 0 ? csvParseAmountCell(cells[ci.credit]) : null;
      if (d) cents = -Math.abs(d);
      else if (c) cents = Math.abs(c);
    }
    if (!cents) continue;
    const amountCents = Math.abs(cents);
    if (amountCents > MAX_MONEY_CENTS) continue;
    const desc = cleanText(ci.desc >= 0 ? String(cells[ci.desc] == null ? '' : cells[ci.desc]) : '', 120) || '—';
    const kind = cents < 0 ? 'gasto' : 'ingreso';
    const row = {
      date: date, description: desc, kind: kind, amountCents: amountCents,
      category: '', duplicate: false, include: true
    };
    rows.push(row);
    if (rows.length >= 1000) break;
  }
  csvEnrichRows(rows);
  if (!rows.length) return { error: 'csv_err_empty' };
  return { rows: rows };
}
function renderCsvSummary() {
  const dups = csvPending.filter((r) => r.duplicate).length;
  const sel = csvPending.filter((r) => r.include).length;
  document.getElementById('csv-summary').textContent =
    t('csv_summary', { total: csvPending.length, dups: dups, sel: sel });
}
function renderCsvPreview() {
  const wrap = document.getElementById('csv-preview');
  const ul = document.getElementById('csv-rows');
  clearNode(ul);
  showError('csv-error', '');
  for (const row of csvPending) {
    const li = el('li', 'item');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = row.include;
    cb.setAttribute('aria-label', row.description);
    cb.addEventListener('change', () => { row.include = cb.checked; renderCsvSummary(); });
    li.appendChild(cb);
    const main = el('div', 'item-main');
    main.appendChild(el('div', 'item-title', row.description));
    const badges = [prettyDate(row.date), row.kind === 'ingreso' ? t('csv_income_badge') : t('csv_expense_badge')];
    if (row.duplicate) badges.push(t('csv_dup_badge'));
    main.appendChild(el('div', 'item-sub', badges.join(' · ')));
    li.appendChild(main);
    if (row.kind === 'gasto') {
      const sel = document.createElement('select');
      for (const c of allCategories()) {
        const o = el('option', null, catName(c));
        o.value = c;
        if (c === row.category) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => { row.category = sel.value; });
      li.appendChild(sel);
    }
    li.appendChild(el('span', 'item-amount', (row.kind === 'ingreso' ? '+' : '−') + fmt(row.amountCents)));
    ul.appendChild(li);
  }
  wrap.hidden = false;
  renderCsvSummary();
}
/* ---------------- Importar PDF del banco (Compilación 29) ----------------
   El PDF se lee con pdf.js (vendor/pdfjs/) en el propio dispositivo y
   sus líneas pasan a la MISMA vista previa que el CSV: parseStatementLines
   devuelve filas con la forma exacta de csvBuildRows y csvEnrichRows les
   aplica la misma categoría sugerida y la misma deduplicación.
   Heurísticas de parseStatementLines:
   - Fechas: MM/DD/YYYY y MM/DD/YY (si el primer número >12 y el segundo
     <=12 se interpreta DD/MM), DD/MM inequívoco, «Oct 12, 2026»,
     «12 Oct 2026» y «Oct 12 2026» con meses en inglés y español, y
     MM/DD sin año usando el año más frecuente del documento (o el
     año en curso si no hay ninguna fecha completa). Fechas inválidas
     (mes >12 tras el intercambio, día >31 o fecha inexistente) se saltan.
   - Montos: el PRIMER token de monto de la línea es el movimiento y el
     segundo (saldo) se ignora. Tokens: $1,234.56, 1,234.56, (1,234.56),
     -1,234.56, 1,234.56- y +1,234.56. La fecha se extrae antes de buscar
     montos para que sus cifras no se confundan con un monto.
   - Signo/tipo: paréntesis o «-» = gasto; «+» = ingreso; sin signo
     explícito mandan primero las FRASES de dirección de la descripción
     (Compilación 35: «payment to»/«pago a»/«zelle to» = gasto;
     «payment from»/«pago de»/«zelle from» = ingreso; «card payment» =
     gasto), luego el encabezado de sección vigente (withdrawal/
     retiro/cargo/débito/debit = gasto; deposit/depósito/abono/crédito/
     credit = ingreso, detectado en líneas sin monto) y por último la
     heurística por descripción (deposit, payroll, interest, refund,
     direct dep y equivalentes en español = ingreso; resto = gasto).
     amountCents siempre es positivo.
   - Descripción: la línea sin el token de fecha ni los de monto,
     espacios colapsados, sin puntuación colgando en los extremos,
     máximo 120 caracteres.
   - Se saltan: líneas sin monto o sin fecha, saldos inicial/final,
     totales, número de cuenta, «página N» y el periodo del estado. */
let pdfJsPromise = null;
function loadPdfJs() {
  if (pdfJsPromise) return pdfJsPromise;
  pdfJsPromise = new Promise((resolve, reject) => {
    const finish = () => {
      try {
        if (typeof window === 'undefined' || !window.pdfjsLib) { reject(new Error('pdfjs no disponible')); return; }
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
        resolve(window.pdfjsLib);
      } catch (e) { reject(e); }
    };
    if (typeof window !== 'undefined' && window.pdfjsLib) { finish(); return; }
    const script = document.createElement('script');
    script.src = 'vendor/pdfjs/pdf.min.js';
    script.onload = finish;
    script.onerror = () => reject(new Error('pdfjs no disponible'));
    document.head.appendChild(script);
  });
  return pdfJsPromise;
}
async function extractPdfLines(arrayBuffer) {
  const lib = (typeof window !== 'undefined' && window.pdfjsLib) || null;
  if (!lib) throw new Error('pdfjs no disponible');
  const pdf = await lib.getDocument({ data: arrayBuffer }).promise;
  const out = [];
  for (let pgn = 1; pgn <= pdf.numPages; pgn++) {
    const page = await pdf.getPage(pgn);
    const tc = await page.getTextContent();
    const groups = [];
    for (const item of (tc.items || [])) {
      if (!item || typeof item.str !== 'string') continue;
      const y = item.transform ? item.transform[5] : 0;
      const x = item.transform ? item.transform[4] : 0;
      let g = groups.find((gg) => Math.abs(gg.y - y) <= 2);
      if (!g) { g = { y: y, items: [] }; groups.push(g); }
      g.items.push({ x: x, str: item.str });
    }
    groups.sort((a, b) => b.y - a.y);
    for (const g of groups) {
      g.items.sort((a, b) => a.x - b.x);
      const txt = g.items.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim();
      if (txt) out.push(txt);
    }
  }
  return out;
}
function pdfNormText(s) {
  return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
function pdfMonthNumber(name) {
  const key = pdfNormText(name).slice(0, 3);
  const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12, ene: 1, abr: 4, ago: 8, dic: 12 };
  return months[key] || 0;
}
function pdfMostFrequentYear(lines) {
  const tally = {};
  const add = (y) => { const yy = y < 100 ? y + 2000 : y; tally[yy] = (tally[yy] || 0) + 1; };
  for (const line of (lines || [])) {
    const s = String(line == null ? '' : line);
    let m;
    const reNum = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/g;
    while ((m = reNum.exec(s)) !== null) add(Number(m[3]));
    const reMonA = /\b([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s+(\d{4})\b/g;
    while ((m = reMonA.exec(s)) !== null) { if (pdfMonthNumber(m[1])) add(Number(m[3])); }
    const reMonB = /\b(\d{1,2})\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,})\.?\s*,?\s+(\d{4})\b/g;
    while ((m = reMonB.exec(s)) !== null) { if (pdfMonthNumber(m[2])) add(Number(m[3])); }
  }
  let best = null, bestN = 0;
  for (const y of Object.keys(tally)) { if (tally[y] > bestN) { bestN = tally[y]; best = Number(y); } }
  return best || new Date().getFullYear();
}
function pdfFindDate(line, fallbackYear) {
  const s = String(line == null ? '' : line);
  let m = /\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/.exec(s);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    const mo = (a > 12 && b <= 12) ? b : a;
    const d = (a > 12 && b <= 12) ? a : b;
    const iso = csvDateOk(y, mo, d);
    return iso ? { date: iso, text: m[0], index: m.index } : null;
  }
  const candidates = [];
  const ma = /\b([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s+(\d{4})\b/.exec(s);
  if (ma && pdfMonthNumber(ma[1])) candidates.push({ m: ma, mo: pdfMonthNumber(ma[1]), d: Number(ma[2]), y: Number(ma[3]) });
  const mb = /\b(\d{1,2})\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,})\.?\s*,?\s+(\d{4})\b/.exec(s);
  if (mb && pdfMonthNumber(mb[2])) candidates.push({ m: mb, mo: pdfMonthNumber(mb[2]), d: Number(mb[1]), y: Number(mb[3]) });
  if (candidates.length) {
    candidates.sort((x, z) => x.m.index - z.m.index);
    const c = candidates[0];
    const iso = csvDateOk(c.y, c.mo, c.d);
    return iso ? { date: iso, text: c.m[0], index: c.m.index } : null;
  }
  m = /\b(\d{1,2})\/(\d{1,2})(?![\/\d])/.exec(s);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    const mo = (a > 12 && b <= 12) ? b : a;
    const d = (a > 12 && b <= 12) ? a : b;
    const iso = csvDateOk(fallbackYear, mo, d);
    return iso ? { date: iso, text: m[0], index: m.index } : null;
  }
  return null;
}
function pdfAmountRegex() {
  return /\(\s*\$?\s*[+-]?\d[\d,]*(?:\.\d{1,2})?\s*\)|\$\s*[+-]?\d[\d,]*(?:\.\d{1,2})?|[+-]\s?\d[\d,]*(?:\.\d{1,2})|\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d[\d]*\.\d{2}/g;
}
function pdfSectionOf(norm) {
  if (/\b(withdrawal|withdrawals|retiro|retiros|cargo|cargos|debito|debitos|debit|debits)\b/.test(norm)) return 'gasto';
  if (/\b(deposit|deposits|deposito|depositos|abono|abonos|credito|creditos|credit|credits)\b/.test(norm)) return 'ingreso';
  return null;
}
function parseStatementLines(lines) {
  const input = Array.isArray(lines) ? lines : [];
  const fallbackYear = pdfMostFrequentYear(input);
  const rows = [];
  let section = null;
  const skipPhrases = ['beginning balance', 'ending balance', 'opening balance', 'closing balance',
    'saldo inicial', 'saldo final', 'balance inicial', 'balance final', 'saldo anterior',
    'account number', 'numero de cuenta', 'statement period',
    'total deposits', 'total withdrawals', 'total deposit', 'total withdrawal',
    'total credits', 'total debits', 'total depositos', 'total retiros'];
  for (const rawLine of input) {
    const line = String(rawLine == null ? '' : rawLine).replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const norm = pdfNormText(line);
    if (/^(page|pagina)\s+\d+/.test(norm.trim())) continue;
    if (skipPhrases.some((ph) => norm.includes(ph))) continue;
    const found = pdfFindDate(line, fallbackYear);
    if (!found) {
      if (!pdfAmountRegex().test(line)) {
        const sec = pdfSectionOf(norm);
        if (sec) section = sec;
      }
      continue;
    }
    const rest = (line.slice(0, found.index) + ' ' + line.slice(found.index + found.text.length)).replace(/\s+/g, ' ');
    const amounts = rest.match(pdfAmountRegex());
    if (!amounts || !amounts.length) continue;
    const firstToken = amounts[0];
    const signed = csvParseAmountCell(firstToken);
    if (!signed) continue;
    const amountCents = Math.abs(signed);
    if (!amountCents || amountCents > MAX_MONEY_CENTS) continue;
    let desc = rest.replace(pdfAmountRegex(), ' ').replace(/\s+/g, ' ').trim();
    desc = cleanText(desc, 120);
    desc = desc.replace(/^[\-–—:;,.|/]+|[\-–—:;,.|/]+$/g, '').trim() || '—';
    let kind;
    const hasParen = firstToken.includes('(') && firstToken.includes(')');
    const hasMinus = firstToken.includes('-');
    const hasPlus = firstToken.includes('+');
    if (hasParen || hasMinus || signed < 0) kind = 'gasto';
    else if (hasPlus) kind = 'ingreso';
    else {
      const dnorm = pdfNormText(desc);
      /* Compilación 35: las FRASES de dirección mandan sobre la
         palabra suelta y sobre la sección. En el estado real de SoFi,
         «Direct Payment Zelle® Payment to Mami» entró como INGRESO
         porque la lista de palabras incluía «zelle» a secas: un Zelle
         QUE SALE («payment to», «pago a», «zelle to», «sent to») es un
         GASTO; solo es ingreso si el dinero ENTRA («payment from»,
         «pago de», «zelle from», «received from»). Un «Card Payment»
         (pago con tarjeta) también es gasto: pagar la tarjeta no es
         un depósito. */
      const outPhrases = ['payment to', 'pago a', 'zelle to', 'sent to', 'transfer to', 'enviado a', 'envio a'];
      const inPhrases = ['payment from', 'pago de', 'zelle from', 'received from', 'transfer from', 'recibido de'];
      if (outPhrases.some((w) => dnorm.includes(w))) kind = 'gasto';
      else if (inPhrases.some((w) => dnorm.includes(w))) kind = 'ingreso';
      else if (/\bcard payment\b/.test(dnorm)) kind = 'gasto';
      else if (section) kind = section;
      else {
        const incomeWords = ['deposit', 'deposito', 'payroll', 'interest', 'interes', 'refund', 'reembolso', 'direct dep', 'nomina', 'devolucion', 'abono'];
        kind = incomeWords.some((w) => dnorm.includes(w)) ? 'ingreso' : 'gasto';
      }
    }
    rows.push({ date: found.date, description: desc, kind: kind, amountCents: amountCents, category: '', duplicate: false, include: true });
    if (rows.length >= 1000) break;
  }
  return csvEnrichRows(rows);
}
function onCsvFile(ev) {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  const wrap = document.getElementById('csv-preview');
  const isPdf = /\.pdf$/i.test(file.name || '') || file.type === 'application/pdf';
  if (isPdf) {
    if (file.size > 8000000) {
      csvPending = [];
      clearNode(document.getElementById('csv-rows'));
      document.getElementById('csv-summary').textContent = '';
      wrap.hidden = false;
      showError('csv-error', t('pdf_err_big'));
      return;
    }
    const pdfReader = new FileReader();
    pdfReader.onload = async () => {
      const failPdf = (key) => {
        csvPending = [];
        clearNode(document.getElementById('csv-rows'));
        document.getElementById('csv-summary').textContent = '';
        wrap.hidden = false;
        showError('csv-error', t(key));
      };
      try {
        try { await loadPdfJs(); } catch (e) { failPdf('csv_err_parse'); return; }
        let pdfLines;
        try { pdfLines = await extractPdfLines(pdfReader.result); } catch (e) { failPdf('csv_err_parse'); return; }
        const totalText = (pdfLines || []).join('').replace(/\s+/g, '');
        if (totalText.length < 40) { failPdf('pdf_err_notext'); return; }
        const pdfRows = parseStatementLines(pdfLines);
        if (!pdfRows.length) { failPdf('pdf_err_empty'); return; }
        csvPending = pdfRows;
        renderCsvPreview();
      } catch (e) { failPdf('csv_err_parse'); }
    };
    pdfReader.onerror = () => { showError('csv-error', t('csv_err_parse')); wrap.hidden = false; };
    pdfReader.readAsArrayBuffer(file);
    return;
  }
  if (file.size > 2000000) {
    csvPending = [];
    clearNode(document.getElementById('csv-rows'));
    document.getElementById('csv-summary').textContent = '';
    wrap.hidden = false;
    showError('csv-error', t('csv_err_big'));
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const built = csvBuildRows(String(reader.result || ''));
    if (built.error) {
      csvPending = [];
      clearNode(document.getElementById('csv-rows'));
      document.getElementById('csv-summary').textContent = '';
      wrap.hidden = false;
      showError('csv-error', t(built.error));
      return;
    }
    csvPending = built.rows;
    renderCsvPreview();
  };
  reader.onerror = () => { showError('csv-error', t('csv_err_parse')); wrap.hidden = false; };
  reader.readAsText(file);
}
function onCsvApply() {
  const chosen = csvPending.filter((r) => r.include);
  if (!chosen.length) { showError('csv-error', t('csv_none_selected')); return; }
  beginUndo();
  let n = 0;
  for (const r of chosen) {
    if (r.kind === 'gasto') {
      if (db.expenses.length >= MAX_ITEMS) break;
      db.expenses.push({ id: uid(), amountCents: r.amountCents, category: r.category, date: r.date, note: r.description, photo: null, biz: false });
    } else {
      if (db.incomes.length >= MAX_ITEMS) break;
      /* El ahorro de un ingreso importado nace en 0: el ahorro se anota
         a mano, nunca se calcula solo (regla permanente de la app). */
      db.incomes.push({ id: uid(), amountCents: r.amountCents, savingsCents: 0, date: r.date, note: r.description, biz: false });
    }
    n++;
  }
  save();
  csvPending = [];
  document.getElementById('csv-preview').hidden = true;
  renderExpenses();
  renderIncomes();
  checkBudgetAlerts();
  showUndoToast();
  window.alert(t('csv_done', { n: n }));
}
function onCsvCancel() {
  csvPending = [];
  document.getElementById('csv-preview').hidden = true;
}

/* ---------------- Mejoras: notificaciones, huella, pagos automáticos,
   copia cifrada y compartir ----------------
   Todo lo nativo pasa por los plugins de Capacitor cuando existen;
   en el navegador o sin plugin, cada función se apaga sin romper nada. */
function capPlugin(name) {
  try {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[name]) || null;
  } catch (e) { return null; }
}

/* --- Pagos fijos que se registran solos al vencer --- */
function autoPostFixed() {
  if (!db || db.settings.autoFixed === false) return 0;
  const key = currentMonthKey();
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const due = db.fixed.filter((f) =>
    !f.paidMonths[key] && !(f.autoMonths && f.autoMonths[key]) &&
    Math.min(f.day, lastDay) <= now.getDate());
  if (!due.length || db.expenses.length >= MAX_ITEMS) return 0;
  beginUndo();
  for (const f of due) {
    const dd = Math.min(f.day, lastDay);
    db.expenses.push({
      id: uid(), amountCents: f.amountCents, category: 'Otros',
      date: key + '-' + String(dd).padStart(2, '0'),
      note: (f.name + ' ' + t('fix_auto_suffix')).slice(0, 120), photo: null
    });
    f.paidMonths[key] = true;
    f.autoMonths = f.autoMonths || {};
    f.autoMonths[key] = true;
  }
  save();
  return due.length;
}

/* --- Notificaciones del sistema (con la app cerrada) --- */
function notifId(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h % 2000000000) + 1;
}
let lastNotifSig = '';
async function ensureNotifPermission() {
  const LN = capPlugin('LocalNotifications');
  if (!LN) return false;
  try {
    let p = await LN.checkPermissions();
    if (p.display !== 'granted') p = await LN.requestPermissions();
    return p.display === 'granted';
  } catch (e) { return false; }
}
async function scheduleNotifications() {
  const LN = capPlugin('LocalNotifications');
  if (!LN || !db) return;
  try {
    if (!db.settings.notifications) {
      const pending = await LN.getPending();
      if (pending.notifications.length) await LN.cancel(pending);
      lastNotifSig = '';
      return;
    }
    const sig = JSON.stringify(db.fixed) + '|' + db.settings.lang;
    if (sig === lastNotifSig) return;
    const pending = await LN.getPending();
    if (pending.notifications.length) await LN.cancel(pending);
    const list = [];
    const now = new Date();
    for (const f of db.fixed) {
      for (let off = 0; off <= 2; off++) {
        const base = new Date(now.getFullYear(), now.getMonth() + off, 1);
        const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
        const day = Math.min(f.day, lastDay);
        const key = base.getFullYear() + '-' + String(base.getMonth() + 1).padStart(2, '0');
        if (f.paidMonths[key]) continue;
        const due = new Date(base.getFullYear(), base.getMonth(), day, 9, 0, 0);
        const dayBefore = new Date(due.getTime() - 24 * 3600 * 1000);
        const body = t('notif_fixed_body', { name: f.name, amount: fmt(f.amountCents) });
        if (dayBefore > now) list.push({ id: notifId(f.id + key + 'b'), title: t('notif_fixed_title'), body: body, schedule: { at: dayBefore } });
        if (due > now) list.push({ id: notifId(f.id + key + 'd'), title: t('notif_fixed_today'), body: body, schedule: { at: due } });
      }
    }
    const sun = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0, 0);
    while (sun.getDay() !== 0 || sun <= now) sun.setDate(sun.getDate() + 1);
    list.push({ id: notifId('weekly'), title: t('notif_weekly_title'), body: t('notif_weekly_body'), schedule: { at: sun, every: 'week' } });
    if (list.length) await LN.schedule({ notifications: list });
    lastNotifSig = sig;
  } catch (e) { /* sin notificaciones disponibles: la app sigue igual */ }
}

/* --- Resumen diario (Compilación 29, Bloque 1) ---
   Aviso propio, con su propio interruptor (settings.summaryDaily,
   activo por defecto): NO depende del interruptor general de
   notificaciones. Se programa una sola notificación local para la
   próxima hora elegida, con lo gastado ayer y el diario de ese día. */
function localDateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function dailySummaryData(fireDate) {
  const fire = (fireDate instanceof Date && !Number.isNaN(fireDate.getTime())) ? fireDate : new Date();
  const yest = new Date(fire.getFullYear(), fire.getMonth(), fire.getDate() - 1);
  const yesterdayStr = localDateStr(yest);
  if (!db) return { spentCents: 0, dailyCents: null, yesterdayStr: yesterdayStr };
  const spentCents = sumCents(db.expenses.filter((e) => e.date === yesterdayStr));
  const key = fire.getFullYear() + '-' + String(fire.getMonth() + 1).padStart(2, '0');
  const total = monthlyBudgetTotalCents(key);
  let dailyCents = null;
  if (total > 0) {
    const fireStr = localDateStr(fire);
    const spentMonth = sumCents(monthExpenses(key).filter((e) => e.date <= fireStr));
    const left = total - spentMonth;
    const daysLeft = daysInMonth(key) - fire.getDate() + 1;
    dailyCents = left > 0 ? Math.floor(left / daysLeft) : 0;
  }
  return { spentCents: spentCents, dailyCents: dailyCents, yesterdayStr: yesterdayStr };
}
function nextSummaryFire(timeStr) {
  const m = /^(\d{2}):(\d{2})$/.exec(typeof timeStr === 'string' ? timeStr : '');
  let hh = 8; let mm = 0;
  if (m) {
    const h = Number(m[1]); const n = Number(m[2]);
    if (h >= 0 && h <= 23 && n >= 0 && n <= 59) { hh = h; mm = n; }
  }
  const now = new Date();
  const fire = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
  if (fire <= now) fire.setDate(fire.getDate() + 1);
  return fire;
}
let lastSummarySig = '';
async function scheduleDailySummary() {
  const LN = capPlugin('LocalNotifications');
  if (!LN || !db) return;
  const id = notifId('daily-summary');
  try {
    if (db.settings.summaryDaily === false) {
      try { await LN.cancel({ notifications: [{ id: id }] }); } catch (e) { /* sin pendientes: nada que cancelar */ }
      lastSummarySig = '';
      return;
    }
    const fire = nextSummaryFire(db.settings.summaryTime || '08:00');
    const data = dailySummaryData(fire);
    const fireDateStr = localDateStr(fire);
    const sig = [db.settings.summaryTime || '08:00', db.settings.lang, fireDateStr, data.spentCents, data.dailyCents].join('|');
    if (sig === lastSummarySig) return;
    try { await LN.cancel({ notifications: [{ id: id }] }); } catch (e) { /* sin pendientes: nada que cancelar */ }
    const body = data.dailyCents == null
      ? t('notif_summary_body_nodaily', { spent: fmt(data.spentCents) })
      : t('notif_summary_body', { spent: fmt(data.spentCents), daily: fmt(data.dailyCents) });
    await LN.schedule({ notifications: [{ id: id, title: t('notif_summary_title'), body: body, schedule: { at: fire } }] });
    lastSummarySig = sig;
  } catch (e) { /* sin notificaciones disponibles: la app sigue igual */ }
}

/* --- Desbloqueo con huella ---
   Diagnóstico del fallo en el teléfono real (23-oct-2026: Sterlin SÍ
   tiene PIN creado y aun así la huella nunca aparecía ni se pedía):
   1) El plugin @aparajita/capacitor-biometric-auth v10 se registra en
      Capacitor como "BiometricAuthNative", NO como "BiometricAuth":
      así lo declara su JS (registerPlugin('BiometricAuthNative')) y su
      clase Android (@CapacitorPlugin(name = "BiometricAuthNative")).
      El puente nativo crea Capacitor.Plugins con ese nombre exacto, así
      que capPlugin('BiometricAuth') devolvía SIEMPRE null en el
      teléfono y la huella moría en silencio. (Las pruebas locales no lo
      veían porque montaban el doble bajo el nombre equivocado.)
   2) En el puente nativo el plugin solo expone checkBiometry() e
      internalAuthenticate() (sus dos @PluginMethod). authenticate() es
      un envoltorio que vive en el JS del plugin, que esta app — sin
      empaquetador — nunca carga: hay que caer a internalAuthenticate.
   3) Las claves del diálogo son androidTitle/androidSubtitle, no
      title/subtitle; con las viejas el diálogo salía genérico. */
let bioPromptOpen = false;
let bioAutoTimer = null;
function bioPlugin() {
  /* Ambos nombres, por compatibilidad si algún día se carga el JS del
     plugin (que también se registra como BiometricAuthNative). */
  return capPlugin('BiometricAuthNative') || capPlugin('BiometricAuth');
}
function bioIsNative() {
  try {
    const C = window.Capacitor;
    if (!C) return false;
    if (typeof C.isNativePlatform === 'function') return C.isNativePlatform();
    if (typeof C.getPlatform === 'function') return C.getPlatform() !== 'web';
  } catch (e) { /* sin Capacitor: es la versión web */ }
  return false;
}
async function bioAuthenticate(BA) {
  const opts = {
    reason: t('bio_reason'),
    androidTitle: 'PETO Finanzas',
    androidSubtitle: t('bio_btn'),
    cancelTitle: t('btn_cancel'),
    /* Respaldo del plugin: si la huella falla o queda bloqueada, el
       mismo diálogo ofrece el PIN/patrón del propio teléfono. */
    allowDeviceCredential: true
  };
  if (typeof BA.authenticate === 'function') return BA.authenticate(opts);
  if (typeof BA.internalAuthenticate === 'function') return BA.internalAuthenticate(opts);
  const err = new Error('biometryNotAvailable');
  err.code = 'biometryNotAvailable';
  throw err;
}
/* Comprobación de biometría con tiempo límite (~4 s): si el puente
   nativo se cuelga y checkBiometry() nunca responde, sin esto la app
   se quedaba esperando en silencio para siempre. Al vencer devuelve
   null y quien llama lo trata como «no disponible» mostrando el aviso.
   Si el plugin rechaza, el rechazo se propaga a quien llama. */
async function bioCheckWithTimeout(BA) {
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), 4000);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => BA.checkBiometry()),
      timeout
    ]);
  } finally {
    if (timer) { clearTimeout(timer); timer = null; }
  }
}
async function refreshBioButton() {
  const btn = document.getElementById('btn-biometric');
  if (!btn) return;
  btn.hidden = true;
  if (bioAutoTimer) { clearTimeout(bioAutoTimer); bioAutoTimer = null; }
  if (!db || !db.settings.biometric || !db.settings.pinHash) return;
  const BA = bioPlugin();
  if (!BA) {
    /* En la app nativa esto es un fallo real y se dice en pantalla; en
       el navegador es lo normal y no se molesta a nadie. */
    if (bioIsNative()) showError('lock-error', t('bio_unavailable'));
    return;
  }
  try {
    const r = await bioCheckWithTimeout(BA);
    if (r === null) {
      /* Venció el tiempo límite: como si no hubiera biometría. */
      showError('lock-error', t('bio_unavailable'));
      return;
    }
    /* Vale la biometría enrolada O, como respaldo, un teléfono seguro
       (con PIN/patrón), porque el diálogo admite la credencial del
       dispositivo. */
    if (r && (r.isAvailable || r.deviceIsSecure)) {
      btn.hidden = false;
      /* La huella se pide sola al mostrar el bloqueo: un toque menos. */
      bioAutoTimer = setTimeout(() => { tryBiometric(); }, 350);
    } else if (r && r.code === 'biometryNotEnrolled') {
      showError('lock-error', t('bio_not_enrolled'));
    } else {
      showError('lock-error', t('bio_unavailable'));
    }
  } catch (e) {
    /* Antes este fallo se tragaba: ahora se ve, para poder diagnosticar. */
    showError('lock-error', t('bio_unavailable'));
  }
}
async function tryBiometric() {
  if (bioPromptOpen) return;
  /* Sin pantalla de bloqueo visible no se pide nada: evita que el
     aviso automático salte encima de la app si ya entró con el PIN. */
  const lockView = document.getElementById('view-lock');
  if (!lockView || lockView.hidden) return;
  const BA = bioPlugin();
  if (!BA) {
    if (bioIsNative()) showError('lock-error', t('bio_unavailable'));
    return;
  }
  bioPromptOpen = true;
  try {
    await bioAuthenticate(BA);
    enterApp();
  } catch (e) {
    /* Cancelar es normal y no se reporta; cualquier OTRO fallo sí se
       muestra, para que "no funciona" nunca sea invisible. Los códigos
       de cancelación del plugin son userCancel / systemCancel /
       appCancel (el botón negativo también llega como userCancel). */
    const code = String((e && (e.code || e.message)) || '');
    if (!/cancel/i.test(code)) showError('lock-error', t('bio_failed'));
  } finally {
    bioPromptOpen = false;
  }
}

/* --- Oferta guiada de huella al crear el PIN ---
   Pedido de Sterlin (23-oct-2026): activar la huella no debe depender
   de encontrar la casilla de Ajustes. Al crear el PIN (bienvenida) o
   al establecer/actualizarlo (Ajustes), si la huella está apagada, la
   app pregunta «¿Desbloquear con tu huella?» (Sí / Ahora no). El Sí
   solo activa tras comprobar de verdad que hay huella disponible y
   registrada: nunca se guarda true sin esa comprobación aprobada.
   «Ahora no» no guarda nada y no se vuelve a preguntar en ese mismo
   guardado: la pregunta solo nace de crear/actualizar el PIN. */
function maybeOfferBiometric() {
  if (!db || !db.settings.pinHash) return false;
  if (db.settings.biometric === true) return false;
  const offer = document.getElementById('bio-offer');
  if (!offer) return false;
  showError('bio-offer-error', '');
  offer.hidden = false;
  return true;
}
function hideBioOffer() {
  const offer = document.getElementById('bio-offer');
  if (offer) offer.hidden = true;
}
async function onBioOfferYes() {
  const BA = bioPlugin();
  if (!BA) { showError('bio-offer-error', t('bio_unavailable')); return; }
  let r = null;
  let err = null;
  try { r = await bioCheckWithTimeout(BA); } catch (e) { err = e; }
  if (r && r.isAvailable) {
    db.settings.biometric = true;
    save();
    hideBioOffer();
    const cb = document.getElementById('set-biometric');
    if (cb) cb.checked = true;
    window.alert(t('bio_activated'));
    return;
  }
  const code = String((r && r.code) || (err && (err.code || err.message)) || '');
  if (code === 'biometryNotEnrolled') {
    showError('bio-offer-error', t('bio_not_enrolled'));
  } else {
    /* Incluye el tiempo límite agotado (r === null): no disponible. */
    showError('bio-offer-error', t('bio_unavailable'));
  }
}
function onBioOfferNo() {
  /* No se guarda nada: la huella queda como estaba (apagada). */
  showError('bio-offer-error', '');
  hideBioOffer();
}

/* --- Copia de seguridad cifrada con contraseña (AES-GCM) --- */
function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  const CH = 32768;
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(s);
}
function b64ToBuf(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}
async function petoKeyFromPass(pass, saltBytes) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), { name: 'PBKDF2' }, false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: 150000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
function downloadJsonFile(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function onExportEncrypted() {
  const pass = document.getElementById('backup-pass').value;
  if (!pass || pass.length < 4) { showError('data-error', t('backup_err_short')); return; }
  try {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await petoKeyFromPass(pass, salt);
    const enc = new TextEncoder();
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, enc.encode(JSON.stringify(db)));
    db.lastExportAt = new Date().toISOString();
    save();
    downloadJsonFile({ petoBackup: 1, salt: bufToB64(salt), iv: bufToB64(iv), data: bufToB64(ct) }, 'peto-copia-cifrada.json');
    showError('data-error', '');
  } catch (e) {
    showError('data-error', t('backup_err_pass'));
  }
}
async function decryptBackupPayload(obj, pass) {
  const key = await petoKeyFromPass(pass, b64ToBuf(obj.salt));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBuf(obj.iv) }, key, b64ToBuf(obj.data));
  return new TextDecoder().decode(pt);
}

/* --- Compartir resúmenes (WhatsApp y demás) --- */
async function shareText(title, text) {
  const Share = capPlugin('Share');
  if (Share) { try { await Share.share({ title: title, text: text }); return; } catch (e) { /* sigue */ } }
  if (navigator.share) { try { await navigator.share({ title: title, text: text }); return; } catch (e) { /* sigue */ } }
  try {
    await navigator.clipboard.writeText(text);
    window.alert(t('share_copied'));
  } catch (e) { window.alert(text); }
}
function onShareReport() {
  const d = reportData(chartMonth);
  const lines = ['📋 PETO Finanzas — ' + d.month,
    t('rep_income') + ': ' + fmtMoney(d.income),
    t('rep_expenses') + ': ' + fmtMoney(d.expenses),
    t('rep_savings') + ': ' + fmtMoney(d.savings)];
  if (d.topCat) lines.push(t('rep_top_cat') + ': ' + catName(d.topCat) + ' · ' + fmtMoney(d.topAmt));
  if (d.goal) lines.push(t('rep_goal') + ' · ' + d.goal.name + ': ' + d.goal.pct + '%');
  shareText(t('share_report_title'), lines.join('\n'));
  maybeAskReview();
}
function onShareSan() {
  if (!db.san) return;
  const s = db.san;
  const lines = ['🤝 ' + s.name];
  if (sanFinished()) {
    lines.push(t('san_finished'));
  } else {
    const week = s.weeks[s.currentWeek];
    const paidNames = s.participants.filter((p) => week.paid[p]);
    const pendingNames = s.participants.filter((p) => !week.paid[p]);
    lines.push(t('san_week', { x: s.currentWeek + 1, n: s.participants.length }));
    lines.push(t('san_receiver_line', { name: s.participants[s.currentWeek] }));
    lines.push(t('san_aporte_line', { amount: fmtMoney(s.aporteCents) }));
    lines.push(t('san_week_collected', { amount: fmtMoney(paidNames.length * s.aporteCents), target: fmtMoney(s.participants.length * s.aporteCents) }));
    if (pendingNames.length) lines.push('⏳ ' + pendingNames.join(', '));
  }
  lines.push(t('san_total_line', { amount: fmtMoney(sanTotalReunido()) }));
  shareText(s.name, lines.join('\n'));
}

/* ---------------- PAQUETE 2: remesas, ideas, alertas, metas,
   negocio, voz y recibos que se leen solos ---------------- */

/* --- Remesas ---
   Desde la Fase 3 la remesa guarda la moneda destino (currency) además
   de la tasa aplicada (rateCents = tasa × 100, en unidades destino por
   $1). Lo que llegó se calcula siempre con la tasa GUARDADA en el
   registro: si mañana cambia el tipo de cambio, el historial no se
   mueve. Las remesas viejas sin currency valen como DOP. */
function monthRemittances(key) { return db.remittances.filter((r) => monthKeyOf(r.date) === key); }
function remDestCents(r) { return Math.round(r.usdCents * r.rateCents / 100); }
const REM_SYMBOLS = { DOP: 'RD$', MXN: 'MX$', EUR: '€', BRL: 'R$', CLP: 'CLP$', ARS: 'AR$' };
function fmtForeign(cents, currency) {
  const sym = REM_SYMBOLS[currency] || (currency + ' ');
  return sym + (cents / 100).toLocaleString(localeTag(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDop(cents) { return fmtForeign(cents, 'DOP'); }
/* La remesa más reciente (por fecha; a igual fecha, la última anotada). */
function lastRemittance(pred) {
  let best = null;
  for (const r of db.remittances) {
    if (pred && !pred(r)) continue;
    if (!best || r.date >= best.date) best = r;
  }
  return best;
}
/* Tasa sugerida: la de la remesa más reciente en esa misma moneda. */
function lastRateCentsFor(currency) {
  const r = lastRemittance((x) => (x.currency || 'DOP') === currency);
  return r ? r.rateCents : null;
}
function updateRemRateUI(applySuggestion) {
  const sel = document.getElementById('rem-currency');
  const cur = sel && sel.value ? sel.value : 'DOP';
  document.getElementById('rem-rate-label').textContent = t('rem_rate_label', { cur: cur });
  const sug = lastRateCentsFor(cur);
  const hint = document.getElementById('rem-rate-hint');
  if (sug) {
    hint.textContent = t('rem_rate_suggested', { cur: cur, rate: (sug / 100).toFixed(2) });
    if (applySuggestion) document.getElementById('rem-rate').value = (sug / 100).toFixed(2);
  } else {
    hint.textContent = '';
  }
}
function onRemCurrencyChange() { updateRemRateUI(true); }
function resetRemittanceForm() {
  document.getElementById('remittance-form').reset();
  document.getElementById('rem-id').value = '';
  document.getElementById('rem-date').value = todayStr();
  const last = lastRemittance(null);
  document.getElementById('rem-currency').value = last ? (last.currency || 'DOP') : 'DOP';
  updateRemRateUI(true);
  document.getElementById('remittance-form-title').textContent = t('rem_save');
  showError('rem-error', '');
}
function renderRemittances() {
  resetRemittanceForm();
  const key = currentMonthKey();
  const mine = monthRemittances(key);
  const totUsd = mine.reduce((t2, r) => t2 + r.usdCents, 0);
  const byCur = {};
  for (const r of mine) {
    const c = r.currency || 'DOP';
    byCur[c] = (byCur[c] || 0) + remDestCents(r);
  }
  document.getElementById('rem-total').textContent = mine.length
    ? t('rem_month_sent', { usd: fmt(totUsd) }) +
      Object.keys(byCur).sort().map((c) => ' → ' + fmtForeign(byCur[c], c)).join(' · ')
    : '';
  const ul = document.getElementById('remittance-list');
  clearNode(ul);
  const all = db.remittances.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  document.getElementById('remittance-empty').hidden = all.length > 0;
  for (const r of all) {
    const cur = r.currency || 'DOP';
    const li = el('li', 'item');
    const main = el('div', 'item-main');
    main.appendChild(el('div', 'item-title', r.recipient || '—'));
    main.appendChild(el('div', 'item-sub',
      prettyDate(r.date) + ' · ' + t('rem_arrives_label') + ' ' + fmtForeign(remDestCents(r), cur) +
      ' @ ' + (r.rateCents / 100).toFixed(2) + ' ' + cur + (r.note ? ' · ' + r.note : '')));
    li.appendChild(main);
    li.appendChild(el('span', 'item-amount', fmt(r.usdCents)));
    const acts = el('div', 'item-actions');
    acts.appendChild(actionButton(t('btn_edit'), 'btn-ghost', () => {
      document.getElementById('rem-id').value = r.id;
      document.getElementById('rem-amount').value = (r.usdCents / 100).toFixed(2);
      document.getElementById('rem-currency').value = cur;
      updateRemRateUI(false);
      document.getElementById('rem-rate').value = (r.rateCents / 100).toFixed(2);
      document.getElementById('rem-recipient').value = r.recipient;
      document.getElementById('rem-date').value = r.date;
      document.getElementById('rem-note').value = r.note;
      document.getElementById('remittance-form-title').textContent = t('btn_edit');
      window.scrollTo(0, 0);
    }));
    acts.appendChild(actionButton(t('btn_delete'), 'btn-ghost', () => {
      if (!window.confirm(t('rem_delete_confirm', { name: r.recipient || '—' }))) return;
      beginUndo();
      db.remittances = db.remittances.filter((x) => x.id !== r.id);
      save(); renderRemittances(); showUndoToast();
    }));
    li.appendChild(acts);
    ul.appendChild(li);
  }
  /* Totales de todo el historial, agrupados por moneda destino. */
  const totalsBox = document.getElementById('rem-totals');
  clearNode(totalsBox);
  totalsBox.hidden = all.length === 0;
  if (all.length) {
    totalsBox.appendChild(el('h3', null, t('rem_totals_title')));
    const agg = {};
    for (const r of all) {
      const c = r.currency || 'DOP';
      if (!agg[c]) agg[c] = { usd: 0, dest: 0, n: 0 };
      agg[c].usd += r.usdCents; agg[c].dest += remDestCents(r); agg[c].n += 1;
    }
    for (const c of Object.keys(agg).sort((a, b) => agg[b].usd - agg[a].usd)) {
      totalsBox.appendChild(el('p', 'total-line',
        c + ' · ' + t('rem_total_row', { usd: fmt(agg[c].usd), amount: fmtForeign(agg[c].dest, c), n: agg[c].n })));
    }
  }
}
function onRemittanceSubmit(ev) {
  ev.preventDefault();
  const usd = parseAmount(document.getElementById('rem-amount').value, false);
  const rate = Number(document.getElementById('rem-rate').value);
  const currency = cleanCurrency(document.getElementById('rem-currency').value);
  const recipient = cleanText(document.getElementById('rem-recipient').value, 60);
  const date = cleanDate(document.getElementById('rem-date').value);
  const note = cleanText(document.getElementById('rem-note').value, 120);
  if (usd === null) { showError('rem-error', t('err_amount')); return; }
  if (!Number.isFinite(rate) || rate <= 0 || rate > 10000) { showError('rem-error', t('err_amount')); return; }
  const id = document.getElementById('rem-id').value;
  beginUndo();
  if (id) {
    const f = db.remittances.find((x) => x.id === id);
    if (f) { f.usdCents = usd; f.rateCents = Math.round(rate * 100); f.currency = currency; f.recipient = recipient; f.date = date; f.note = note; }
  } else {
    db.remittances.push({ id: uid(), date: date, usdCents: usd, rateCents: Math.round(rate * 100), currency: currency, recipient: recipient, note: note });
  }
  save();
  renderRemittances();
  showUndoToast();
}

/* --- Ideas automáticas (Inicio) --- */
function renderInsights() {
  const box = document.getElementById('home-insights');
  if (!box) return;
  clearNode(box);
  const lines = [];
  const key = currentMonthKey();
  const prev = shiftMonth(key, -1);
  const thisExp = monthExpenses(key);
  const prevExp = monthExpenses(prev);
  if (prevExp.length && thisExp.length) {
    const byCat = (list) => { const m = {}; for (const e of list) m[e.category] = (m[e.category] || 0) + e.amountCents; return m; };
    const a = byCat(thisExp);
    const b = byCat(prevExp);
    let best = null;
    for (const c of Object.keys(a)) {
      if (b[c] >= 1000 && a[c] > b[c]) {
        const pct = Math.round((a[c] - b[c]) / b[c] * 100);
        if (pct >= 10 && (!best || pct > best.pct)) best = { cat: c, pct: pct, from: b[c], to: a[c] };
      }
    }
    if (best) lines.push(['📈', t('ins_cat_up', { cat: catName(best.cat), pct: best.pct, from: fmt(best.from), to: fmt(best.to) })]);
    const dayOfMonth = Number(todayStr().slice(8, 10));
    const paceThis = sumCents(thisExp) / Math.max(1, dayOfMonth);
    const pacePrev = sumCents(prevExp) / daysInMonth(prev);
    if (pacePrev > 0) {
      const pct = Math.round((paceThis - pacePrev) / pacePrev * 100);
      if (pct <= -10) lines.push(['🐢', t('ins_pace_down', { pct: -pct })]);
      else if (pct >= 15) lines.push(['🏃', t('ins_pace_up', { pct: pct })]);
    }
  }
  if (thisExp.length) {
    const big = thisExp.slice().sort((x, y) => y.amountCents - x.amountCents)[0];
    lines.push(['🏆', t('ins_biggest', { note: big.note || catName(big.category), amount: fmt(big.amountCents) })]);
  }
  const savThis = monthSavings(key);
  if (savThis > 0) lines.push(['🐷', t('ins_saved', { amount: fmt(savThis) })]);
  box.hidden = lines.length === 0;
  if (!lines.length) return;
  box.appendChild(el('h3', null, t('ins_title')));
  for (const pair of lines.slice(0, 3)) {
    const p = el('p', 'insight-line');
    p.appendChild(el('span', 'menu-icon', pair[0]));
    p.appendChild(el('span', null, pair[1]));
    box.appendChild(p);
  }
}

/* --- Alertas de presupuesto --- */
function budgetAlerts() {
  const key = currentMonthKey();
  const spent = {};
  for (const e of monthExpenses(key)) spent[e.category] = (spent[e.category] || 0) + e.amountCents;
  const out = [];
  for (const cat of Object.keys(db.budgets)) {
    const b = db.budgets[cat];
    if (!b) continue;
    const s = spent[cat] || 0;
    const pct = Math.floor(s / b * 100);
    if (pct >= 80) out.push({ cat: cat, pct: pct, over: s > b });
  }
  return out.sort((x, y) => y.pct - x.pct);
}
function checkBudgetAlerts() {
  if (!db) return;
  const key = currentMonthKey();
  const fresh = [];
  for (const a of budgetAlerts()) {
    const k = key + '|' + a.cat + '|' + (a.over ? 100 : 80);
    if (!db.alertsSent[k]) { db.alertsSent[k] = true; fresh.push(a); }
  }
  if (!fresh.length) return;
  save();
  const LN = capPlugin('LocalNotifications');
  if (LN && db.settings.notifications) {
    try {
      LN.schedule({
        notifications: fresh.map((a) => ({
          id: notifId('budget' + key + a.cat + (a.over ? 'o' : 'w')),
          title: t('bud_alert_title'),
          body: t(a.over ? 'bud_alert_over' : 'bud_alert_warn', { cat: catName(a.cat), pct: a.pct }),
          schedule: { at: new Date(Date.now() + 4000) }
        }))
      }).catch(() => {});
    } catch (e) { /* sin notificaciones: el aviso queda en Inicio */ }
  }
}

/* --- Metas múltiples (sobres con aporte manual) --- */
/* Lo acumulado en una meta = lo apartado en su sobre (savedCents, con
   los botones de agregar/quitar de la tarjeta) MÁS los ahorros sueltos
   que la persona asignó a la meta al anotarlos (Paquete 3). Son dos
   fuentes que nunca se solapan: un ahorro asignado sigue contando en
   el total de ahorros de la app, y el sobre es solo una etiqueta de
   apartado; aquí solo se SUMAN para mostrar el progreso. */
function goalAccumulated(g) {
  let total = g.savedCents || 0;
  for (const s of db.savings) if (s.goalId === g.id) total += s.amountCents;
  return total;
}
let goal2EditingId = null;
function resetGoal2Form() {
  const form = document.getElementById('goal2-form');
  if (form) form.reset();
  goal2EditingId = null;
  const submit = document.getElementById('goal2-submit');
  if (submit) submit.textContent = t('goal2_create');
  const cancel = document.getElementById('goal2-cancel-edit');
  if (cancel) cancel.hidden = true;
  showError('goal2-error', '');
}
function renderGoals() {
  const list = document.getElementById('goals-list');
  if (!list) return;
  clearNode(list);
  document.getElementById('goals-empty').hidden = db.goals.length > 0;
  for (const g of db.goals) {
    const acc = goalAccumulated(g);
    const card = el('div', 'card goal-extra');
    const pct = Math.min(100, Math.floor(acc / g.targetCents * 100));
    card.appendChild(el('h4', null, g.name));
    card.appendChild(el('p', 'total-line', fmt(acc) + ' / ' + fmt(g.targetCents) + ' · ' + pct + '%'));
    const bar = el('div', 'budget-bar goal-bar');
    const fill = el('div', 'budget-fill');
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    card.appendChild(bar);
    if (acc >= g.targetCents) card.appendChild(el('p', 'goal-done', t('goal_done')));
    const row = el('div', 'form-actions');
    const amt = document.createElement('input');
    amt.type = 'number'; amt.min = '0.01'; amt.step = '0.01'; amt.placeholder = '0.00';
    amt.className = 'goal-move-amt';
    amt.setAttribute('aria-label', t('goal_move_label'));
    row.appendChild(amt);
    row.appendChild(actionButton(t('goal_add'), 'btn-secondary', () => moveGoalMoney(g.id, amt, 1)));
    row.appendChild(actionButton(t('goal_take'), 'btn-ghost', () => moveGoalMoney(g.id, amt, -1)));
    row.appendChild(actionButton(t('goal_edit'), 'btn-ghost', () => {
      goal2EditingId = g.id;
      document.getElementById('goal2-name').value = g.name;
      document.getElementById('goal2-target').value = (g.targetCents / 100).toFixed(2);
      document.getElementById('goal2-submit').textContent = t('goal_save_btn');
      document.getElementById('goal2-cancel-edit').hidden = false;
      showError('goal2-error', '');
      document.getElementById('goal2-name').focus();
    }));
    row.appendChild(actionButton(t('btn_delete'), 'btn-ghost', () => {
      if (!window.confirm(t('goal_delete_confirm', { name: g.name }))) return;
      beginUndo();
      db.goals = db.goals.filter((x) => x.id !== g.id);
      save(); renderSavings(); showUndoToast();
    }));
    card.appendChild(row);
    list.appendChild(card);
  }
}
function moveGoalMoney(id, input, dir) {
  const cents = parseAmount(input.value, false);
  if (cents === null) { window.alert(t('err_amount')); return; }
  const g = db.goals.find((x) => x.id === id);
  if (!g) return;
  beginUndo();
  g.savedCents = Math.max(0, g.savedCents + dir * cents);
  save(); renderSavings(); showUndoToast();
}
function onGoal2Submit(ev) {
  ev.preventDefault();
  const name = cleanText(document.getElementById('goal2-name').value, 60);
  const target = parseAmount(document.getElementById('goal2-target').value, false);
  if (!name) { showError('goal2-error', t('err_name')); return; }
  if (target === null) { showError('goal2-error', t('err_amount')); return; }
  /* Editar una meta conserva su id y lo acumulado: los ahorros
     asignados la siguen por id, no por nombre. */
  if (goal2EditingId) {
    const g = db.goals.find((x) => x.id === goal2EditingId);
    if (g) { beginUndo(); g.name = name; g.targetCents = target; save(); showUndoToast(); }
    resetGoal2Form();
    renderSavings();
    return;
  }
  if (db.goals.length >= 20) { showError('goal2-error', t('err_limit_goals')); return; }
  db.goals.push({ id: uid(), name: name, targetCents: target, savedCents: 0 });
  save();
  resetGoal2Form();
  renderSavings();
}

/* --- Negocio: resumen en la vista Resumen --- */
function renderBizCard(key) {
  const card = document.getElementById('biz-card');
  if (!card) return;
  const inc = monthIncomes(key).filter((i) => i.biz).reduce((t2, i) => t2 + i.amountCents, 0);
  const exp = monthExpenses(key).filter((e) => e.biz).reduce((t2, e) => t2 + e.amountCents, 0);
  card.hidden = inc === 0 && exp === 0;
  if (card.hidden) return;
  clearNode(card);
  card.appendChild(el('h3', null, '💼 ' + t('biz_title')));
  card.appendChild(reportRow(t('biz_income'), fmt(inc)));
  card.appendChild(reportRow(t('biz_expenses'), fmt(exp)));
  card.appendChild(reportRow(t('biz_profit'), fmt(inc - exp)));
}

/* --- Registro por voz --- */
const VOICE_WORDS = { cero: 0, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, veinte: 20, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500, mil: 1000 };
function voiceAmount(text) {
  const m = text.replace(',', '.').match(/\$\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)/);
  if (m) {
    const v = parseFloat(m[1] || m[2]);
    if (Number.isFinite(v) && v > 0) return Math.round(v * 100);
  }
  const words = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-zñ]+/);
  let total = 0;
  let found = false;
  for (const w of words) {
    if (w === 'y' || !w) continue;
    if (Object.prototype.hasOwnProperty.call(VOICE_WORDS, w)) { total += VOICE_WORDS[w]; found = true; }
  }
  if (found && total > 0) return total * 100;
  return null;
}
const VOICE_CATS = [['gasolina', 'Gasolina'], ['combustible', 'Gasolina'], ['mercado', 'Comida'], ['supermercado', 'Comida'], ['comida', 'Comida'], ['restaurante', 'Comida fuera'], ['renta', 'Renta'], ['alquiler', 'Renta'], ['ropa', 'Ropa'], ['farmacia', 'Salud'], ['medico', 'Salud'], ['salud', 'Salud'], ['taxi', 'Transporte'], ['uber', 'Transporte'], ['transporte', 'Transporte']];
function voiceCategory(text) {
  const low = ' ' + text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') + ' ';
  for (const pair of VOICE_CATS) { if (low.includes(pair[0])) return pair[1]; }
  for (const c of db.customCategories) { if (low.includes(c.toLowerCase())) return c; }
  return null;
}
async function startVoice(kind) {
  const status = document.getElementById(kind === 'income' ? 'inc-voice-status' : 'exp-voice-status');
  const SR = capPlugin('SpeechRecognition');
  if (!SR) { if (status) status.textContent = t('voice_unavailable'); return; }
  try {
    const av = await SR.available();
    if (!av || !av.available) { if (status) status.textContent = t('voice_unavailable'); return; }
    let perm = await SR.checkPermissions();
    if (perm && perm.speechRecognition !== 'granted') perm = await SR.requestPermissions();
    if (status) status.textContent = t('voice_listening');
    const res = await SR.start({ language: lang() === 'es' ? 'es-US' : localeTag(), maxResults: 1, partialResults: false });
    const text = res && res.matches && res.matches[0];
    if (!text) { if (status) status.textContent = ''; return; }
    const cents = voiceAmount(text);
    if (kind === 'income') {
      if (cents) document.getElementById('inc-amount').value = (cents / 100).toFixed(2);
      if (!document.getElementById('inc-note').value) document.getElementById('inc-note').value = cleanText(text, 120);
    } else {
      if (cents) document.getElementById('exp-amount').value = (cents / 100).toFixed(2);
      const cat = voiceCategory(text);
      if (cat && allCategories(db).includes(cat)) document.getElementById('exp-category').value = cat;
      if (!document.getElementById('exp-note').value) document.getElementById('exp-note').value = cleanText(text, 120);
    }
    if (status) status.textContent = cents ? t('voice_heard', { text: text }) : t('voice_no_amount', { text: text });
  } catch (e) {
    if (status) status.textContent = t('voice_unavailable');
  }
}

/* --- Recibos que se leen solos (OCR en el dispositivo) --- */
function extractReceiptAmount(text) {
  if (!text) return null;
  const lines = String(text).split(/\r?\n/);
  const money = (s) => {
    const m = s.replace(/,/g, '').match(/\$?\s*(\d+\.\d{2})\b/);
    return m ? Math.round(parseFloat(m[1]) * 100) : null;
  };
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/total/i.test(lines[i]) && !/sub\s*total/i.test(lines[i])) {
      const v = money(lines[i]);
      if (v) return v;
    }
  }
  let best = null;
  for (const line of lines) {
    const v = money(line);
    if (v && (best === null || v > best)) best = v;
  }
  return best;
}
async function tryReceiptOCR(dataUrl) {
  const TR = capPlugin('TextRecognition');
  const FS = capPlugin('Filesystem');
  if (!TR || !FS || !dataUrl || dataUrl.indexOf('data:') !== 0) return;
  const status = document.getElementById('exp-voice-status');
  try {
    const base64 = dataUrl.split(',')[1];
    if (!base64) return;
    const saved = await FS.writeFile({ path: 'peto-recibo.jpg', data: base64, directory: 'CACHE' });
    const res = await TR.processImage({ path: saved.uri });
    try { await FS.deleteFile({ path: 'peto-recibo.jpg', directory: 'CACHE' }); } catch (e) { /* temporal */ }
    const cents = extractReceiptAmount(res && res.text);
    if (cents && !document.getElementById('exp-amount').value) {
      document.getElementById('exp-amount').value = (cents / 100).toFixed(2);
      if (status) status.textContent = t('ocr_found', { amount: fmtMoney(cents) });
    }
  } catch (e) { /* sin OCR disponible: la foto queda guardada igual */ }
}

/* ---------------- Cuenta en la nube (Supabase) ----------------
   Opcional: sin cuenta, PETO funciona solo en el teléfono, como
   siempre. Con cuenta, el estado completo (el mismo JSON local) se
   guarda en la tabla user_data del servidor, una fila por usuario
   protegida por RLS: nadie puede ver la fila de otro. El estado de
   sincronización vive FUERA de los datos (cgastos.cloud.v1) para no
   ensuciar el respaldo. Al aplicar datos remotos se suprime el hook
   de cambios (cloudApplying) para no re-subirlos en círculo. */
const PETO_SUPABASE_URL = 'https://sboldltkywwjnslairlg.supabase.co';
const PETO_SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNib2xkbHRreXd3am5zbGFpcmxnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3MTk1NzEsImV4cCI6MjEwODI5NTU3MX0.MuG3mn6X_GY0Q6YzI14VfWjrxKySjapH7GA5u2DPPe4';
const CLOUD_KEY = 'cgastos.cloud.v1';
let sbClient = null;
let cloudUser = null;
let cloudApplying = false;
let cloudTimer = null;
let cloudState = { email: '', lastSyncAt: 0, lastRemoteAt: '', dirty: false };
function loadCloudState() {
  try {
    const r = JSON.parse(localStorage.getItem(CLOUD_KEY) || 'null');
    if (r && typeof r === 'object') {
      cloudState = {
        email: String(r.email || ''), lastSyncAt: Number(r.lastSyncAt) || 0,
        lastRemoteAt: String(r.lastRemoteAt || ''), dirty: r.dirty === true
      };
    }
  } catch (e) { /* estado dañado: se ignora */ }
}
function saveCloudState() {
  try { localStorage.setItem(CLOUD_KEY, JSON.stringify(cloudState)); } catch (e) { /* sin espacio */ }
}
function supa() {
  if (sbClient) return sbClient;
  if (!window.supabase || PETO_SUPABASE_ANON === 'PENDIENTE' || PETO_SUPABASE_URL.indexOf('PENDIENTE') >= 0) return null;
  try {
    sbClient = window.supabase.createClient(PETO_SUPABASE_URL, PETO_SUPABASE_ANON, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
  } catch (e) { return null; }
  return sbClient;
}
function localHasData() {
  return db.expenses.length > 0 || db.incomes.length > 0 || db.savings.length > 0 || db.goals.length > 0;
}
function noteLocalChange() {
  if (!cloudUser || cloudApplying) return;
  cloudState.dirty = true;
  saveCloudState();
  if (cloudTimer) clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => { cloudPush(); }, 3500);
}
function cloudStatus(msg) {
  const s = document.getElementById('cloud-status');
  if (s) s.textContent = msg || '';
}
function renderCloudCard() {
  const summaryRowCloud = document.getElementById('summary-email-row');
  if (summaryRowCloud) summaryRowCloud.hidden = !cloudUser;
  const out = document.getElementById('cloud-signedout');
  const inn = document.getElementById('cloud-signedin');
  if (!out || !inn) return;
  if (!supa()) {
    out.hidden = true;
    inn.hidden = true;
    cloudStatus(t('cloud_unavailable'));
    return;
  }
  out.hidden = !!cloudUser;
  inn.hidden = !cloudUser;
  if (cloudUser) {
    document.getElementById('cloud-who').textContent = t('cloud_who', { email: cloudUser.email });
    document.getElementById('cloud-sync-status').textContent = cloudState.lastSyncAt
      ? t('cloud_synced', { time: new Date(cloudState.lastSyncAt).toLocaleString(localeTag()) })
      : t('cloud_never');
  } else {
    const em = document.getElementById('cloud-email');
    if (em && cloudState.email && !em.value) em.value = cloudState.email;
  }
}
async function cloudPush() {
  const sb = supa();
  if (!sb || !cloudUser) return false;
  try {
    const { data, error } = await sb.from('user_data')
      .upsert({ user_id: cloudUser.id, data: db, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
      .select('updated_at').single();
    if (error) return false;
    cloudState.lastRemoteAt = data.updated_at;
    cloudState.lastSyncAt = Date.now();
    cloudState.dirty = false;
    saveCloudState();
    renderCloudCard();
    return true;
  } catch (e) { return false; }
}
function cloudApplyRemote(row) {
  const clean = validateData(row.data);
  if (!clean) return false;
  cloudApplying = true;
  db = clean;
  save();
  cloudApplying = false;
  cloudState.lastRemoteAt = row.updated_at;
  cloudState.lastSyncAt = Date.now();
  cloudState.dirty = false;
  saveCloudState();
  renderSettings();
  showView(currentView);
  renderCloudCard();
  return true;
}
async function cloudReconcile(interactive) {
  const sb = supa();
  if (!sb || !cloudUser) return;
  let row = null;
  try {
    const { data, error } = await sb.from('user_data')
      .select('data, updated_at').eq('user_id', cloudUser.id).maybeSingle();
    if (error) { if (interactive) showError('cloud-error', t('cloud_err_generic')); return; }
    row = data;
  } catch (e) { if (interactive) showError('cloud-error', t('cloud_err_generic')); return; }
  if (!row) { await cloudPush(); return; }
  if (cloudState.lastRemoteAt && row.updated_at === cloudState.lastRemoteAt) {
    if (cloudState.dirty) await cloudPush();
    return;
  }
  if (!cloudState.lastRemoteAt) {
    /* Primera vez en este teléfono: si aquí no hay nada, baja la nube;
       si hay datos locales, ELLOS mandan (la cuenta suele crearse en el
       teléfono que ya tiene todo). */
    if (!localHasData()) cloudApplyRemote(row);
    else await cloudPush();
    return;
  }
  if (!cloudState.dirty) { cloudApplyRemote(row); return; }
  /* Cambiaron los dos lados: decide la persona. */
  if (window.confirm(t('cloud_conflict'))) cloudApplyRemote(row);
  else await cloudPush();
}
async function cloudBoot() {
  loadCloudState();
  const sb = supa();
  if (!sb) { renderCloudCard(); return; }
  try {
    const { data } = await sb.auth.getSession();
    if (data && data.session && data.session.user) {
      cloudUser = { id: data.session.user.id, email: data.session.user.email || cloudState.email };
      cloudState.email = cloudUser.email;
      saveCloudState();
      await cloudReconcile(false);
      sharedRefresh();
    }
  } catch (e) { /* sin red: la app sigue local */ }
  renderCloudCard();
}
function cloudCreds() {
  const email = String(document.getElementById('cloud-email').value || '').trim().toLowerCase();
  const pass = String(document.getElementById('cloud-pass').value || '');
  if (!email || email.indexOf('@') < 1 || pass.length < 6) return null;
  return { email: email, pass: pass };
}
async function onCloudSignUp() {
  const sb = supa();
  if (!sb) return;
  const c = cloudCreds();
  if (!c) { showError('cloud-error', t('cloud_err_fields')); return; }
  showError('cloud-error', '');
  cloudStatus(t('cloud_working'));
  try {
    const { data, error } = await sb.auth.signUp({ email: c.email, password: c.pass });
    if (error) {
      cloudStatus('');
      showError('cloud-error', /already registered/i.test(error.message || '') ? t('cloud_err_exists') : t('cloud_err_generic'));
      return;
    }
    cloudStatus('');
    if (data && data.session && data.user) {
      cloudUser = { id: data.user.id, email: data.user.email || c.email };
      cloudState.email = cloudUser.email;
      saveCloudState();
      await cloudPush();
      sharedRefresh();
      cloudStatus(t('cloud_ok_up'));
    } else {
      showError('cloud-error', t('cloud_err_confirm'));
    }
  } catch (e) { cloudStatus(''); showError('cloud-error', t('cloud_err_generic')); }
  renderCloudCard();
}
async function onCloudSignIn() {
  const sb = supa();
  if (!sb) return;
  const c = cloudCreds();
  if (!c) { showError('cloud-error', t('cloud_err_fields')); return; }
  showError('cloud-error', '');
  cloudStatus(t('cloud_working'));
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email: c.email, password: c.pass });
    if (error || !data || !data.user) {
      cloudStatus('');
      showError('cloud-error', t('cloud_err_login'));
      return;
    }
    cloudUser = { id: data.user.id, email: data.user.email || c.email };
    cloudState.email = cloudUser.email;
    saveCloudState();
    await cloudReconcile(true);
    sharedRefresh();
    cloudStatus(t('cloud_ok_in'));
  } catch (e) { cloudStatus(''); showError('cloud-error', t('cloud_err_generic')); }
  renderCloudCard();
}
async function onCloudSignOut() {
  const sb = supa();
  if (sb) { try { await sb.auth.signOut(); } catch (e) { /* la sesión local se limpia igual */ } }
  cloudUser = null;
  cloudState = { email: '', lastSyncAt: 0, lastRemoteAt: '', dirty: false };
  saveCloudState();
  cloudStatus('');
  renderCloudCard();
  sharedState = { household: null, members: [] };
  householdBook = null;
  sharedSave();
  renderSharedCard();
}
async function onCloudSyncNow() {
  showError('cloud-error', '');
  cloudStatus(t('cloud_working'));
  await cloudReconcile(true);
  if (cloudState.dirty) await cloudPush();
  cloudStatus('');
  renderCloudCard();
}
async function onCloudWipe() {
  const sb = supa();
  if (!sb || !cloudUser) return;
  if (!window.confirm(t('cloud_wipe_confirm'))) return;
  try {
    await sb.from('user_data').delete().eq('user_id', cloudUser.id);
  } catch (e) { /* si falla la red, se intenta de nuevo luego */ }
  await onCloudSignOut();
}
/* Borrar la CUENTA (requisito de Play para apps con registro): la RPC
   delete_my_account() del servidor borra la fila de auth.users del
   propio usuario y la cascada limpia su user_data, los hogares donde
   es dueño y sus membresías (compartido/borrado-cuenta.sql). Aquí:
   doble confirmación (el patrón fuerte de onReset); si el servidor
   responde error, se muestra traducido y NO se cierra sesión ni se
   toca nada; si sale bien, la sesión local se cierra por el mismo
   camino del logout (que también limpia el estado del hogar) y se
   avisa. Los datos locales de ESTE teléfono NO se borran. */
function cloudDeleteError(error) {
  const msg = String((error && error.message) || '');
  if (/no autenticado/i.test(msg)) return t('cloud_delete_err_auth');
  return t('cloud_err_generic');
}
async function onCloudDeleteAccount() {
  const sb = supa();
  if (!sb || !cloudUser) return;
  if (!window.confirm(t('cloud_delete_confirm1'))) return;
  if (!window.confirm(t('cloud_delete_confirm2'))) return;
  showError('cloud-error', '');
  cloudStatus(t('cloud_working'));
  try {
    const { error } = await sb.rpc('delete_my_account');
    if (error) {
      cloudStatus('');
      showError('cloud-error', cloudDeleteError(error));
      return;
    }
  } catch (e) {
    cloudStatus('');
    showError('cloud-error', t('cloud_err_generic'));
    return;
  }
  await onCloudSignOut();
  cloudStatus(t('cloud_deleted'));
}

/* ---------------- Presupuesto compartido (Fase 3 → cableado real) -----
   La migración compartido/migracion.sql YA está aplicada en el
   proyecto Supabase en vivo — verificado el 24-oct-2026 con la llave
   anónima por la API pública: las tablas households,
   household_members y household_data existen (un GET anónimo recibe
   401 «permission denied»: hay RLS y ningún grant para anon, tal como
   deja la migración) y las RPC create_household, join_household,
   leave_household, is_household_member y household_role existen con
   las firmas del SQL (responden con sus propios errores de
   autenticación/membresía, p. ej. «no autenticado»). Por eso
   SHARED_LIVE = true y la tarjeta trabaja contra las llamadas REALES
   de abajo, con el mismo cliente sb que la sync personal (user_data).
   ⚠️ Defecto detectado en esa verificación (lado servidor, NO en
   esta app): en el SQL aplicado, rotate_invite_code,
   delete_household y set_member_role comprueban el rol con
   «household_role(...) <> 'dueno'»; cuando el rol es NULL (quien
   llama no es miembro) la comparación no bloquea y la RPC sigue
   (devolver un código nuevo / no fallar), aunque sin filas que tocar
   si el hogar no existe. Esas tres RPC NO las llama esta app en v1 y
   el id de un hogar solo lo conocen sus miembros, pero la migración
   debería corregirse en el servidor a «is distinct from 'dueno'»
   antes del lanzamiento público. Queda anotado en DISENO.md §8.
   Modelo (DISENO.md): la membresía es de la CUENTA, no del respaldo.
   El estado local cgastos.shared.v1 es solo una caché de pantalla de
   {household, members}; la verdad vive en household_members. El
   libro del hogar (household_data) baja y sube como un db parcial
   {expenses, incomes, budgets, fixed, customCategories} validado con
   validateData, con su propio estado de sync cgastos.household.v1
   {householdId, lastRemoteAt, dirty} y el mismo debounce de la sync
   personal. Cada movimiento del libro lleva author_id/author_name
   (ver householdAddMovement). El ahorro compartido sigue siendo
   manual: entra en el propio ingreso, nunca se calcula solo.
   Crear/unirse es función de PETO Pro (PLAN-IDEAS): pasa por
   requirePro(). Si SHARED_LIVE volviera a false, la tarjeta regresa
   a la vista previa local de la Fase 3 (sharedMock*) sin tocar la
   nube — las funciones reales no se llaman. */
const SHARED_KEY = 'cgastos.shared.v1';
const SHARED_LIVE = true; /* verificado en vivo (ver la nota de arriba) */
const HOUSEHOLD_KEY = 'cgastos.household.v1';
let sharedState = null; /* { household: {id, name, code, role} | null, members: [{name, role, me}] } */
let householdBook = null; /* db parcial del hogar, en memoria */
let householdSync = { householdId: '', lastRemoteAt: '', dirty: false };
let householdSyncLoaded = false;
let householdTimer = null;
function sharedLoad() {
  if (sharedState) return sharedState;
  sharedState = { household: null, members: [] };
  try {
    const r = JSON.parse(localStorage.getItem(SHARED_KEY) || 'null');
    if (r && typeof r === 'object' && r.household && typeof r.household === 'object') {
      sharedState.household = {
        id: cleanText(r.household.id, 50), name: cleanText(r.household.name, 60),
        code: cleanText(r.household.code, 6).toUpperCase(),
        role: ['dueno', 'admin', 'miembro', 'lector'].includes(r.household.role) ? r.household.role : 'miembro'
      };
      sharedState.members = (Array.isArray(r.members) ? r.members : []).slice(0, 30)
        .map((mm) => ({
          name: cleanText(mm && mm.name, 60) || '—',
          role: ['dueno', 'admin', 'miembro', 'lector'].includes(mm && mm.role) ? mm.role : 'miembro',
          me: !!(mm && mm.me === true)
        })).filter((mm) => mm.name);
    }
  } catch (e) { /* estado dañado: se ignora, la tarjeta arranca vacía */ }
  return sharedState;
}
function sharedSave() {
  try { localStorage.setItem(SHARED_KEY, JSON.stringify(sharedState)); } catch (e) { /* sin espacio: se ignora */ }
}
function sharedGenCode() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; /* sin 0/O/1/I/L: se dictan por teléfono */
  let code = '';
  for (let i = 0; i < 6; i++) code += abc.charAt(Math.floor(Math.random() * abc.length));
  return code;
}
function sharedMeName() {
  return (db && db.settings && db.settings.name) ? db.settings.name : t('shared_you');
}
function householdSyncLoad() {
  if (householdSyncLoaded) return;
  householdSyncLoaded = true;
  try {
    const r = JSON.parse(localStorage.getItem(HOUSEHOLD_KEY) || 'null');
    if (r && typeof r === 'object') {
      householdSync = {
        householdId: String(r.householdId || ''),
        lastRemoteAt: String(r.lastRemoteAt || ''),
        dirty: r.dirty === true
      };
    }
  } catch (e) { /* estado dañado: se ignora */ }
}
function householdSyncSave() {
  try { localStorage.setItem(HOUSEHOLD_KEY, JSON.stringify(householdSync)); } catch (e) { /* sin espacio */ }
}
/* Valida un libro de hogar bajado de la nube con la MISMA validación
   de la app (diseño §3): se monta un db completo con los ajustes
   locales y las llaves compartidas remotas, se pasa por validateData
   y se extraen solo las llaves del hogar. */
function sharedBookClean(raw) {
  const empty = { expenses: [], incomes: [], budgets: {}, fixed: [], customCategories: [] };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty;
  const tmp = defaultData();
  tmp.settings = db.settings;
  for (const k of Object.keys(empty)) if (raw[k] !== undefined) tmp[k] = raw[k];
  const clean = validateData(tmp);
  if (!clean) return empty;
  return {
    expenses: clean.expenses, incomes: clean.incomes, budgets: clean.budgets,
    fixed: clean.fixed, customCategories: clean.customCategories
  };
}
async function householdPull() {
  householdSyncLoad();
  const sb = supa();
  if (!sb || !cloudUser || !sharedState || !sharedState.household) { householdBook = null; return; }
  const hid = sharedState.household.id;
  try {
    const { data, error } = await sb.from('household_data')
      .select('data, updated_at').eq('household_id', hid).maybeSingle();
    if (error) return;
    if (data) {
      householdBook = sharedBookClean(data.data);
      householdSync = { householdId: hid, lastRemoteAt: data.updated_at || '', dirty: false };
    } else {
      householdBook = sharedBookClean(null);
      householdSync = { householdId: hid, lastRemoteAt: '', dirty: true };
    }
    householdSyncSave();
  } catch (e) { /* sin red: el libro queda como estaba */ }
}
async function householdPush() {
  if (!SHARED_LIVE || !householdBook) return false;
  householdSyncLoad();
  const sb = supa();
  if (!sb || !cloudUser || !sharedState || !sharedState.household) return false;
  if (sharedState.household.role === 'lector') return false; /* solo lectura: no escribe */
  try {
    const { data, error } = await sb.from('household_data')
      .upsert({
        household_id: sharedState.household.id, data: householdBook,
        updated_at: new Date().toISOString(), updated_by: cloudUser.id
      }, { onConflict: 'household_id' })
      .select('updated_at').single();
    if (error) return false;
    householdSync.householdId = sharedState.household.id;
    householdSync.lastRemoteAt = data.updated_at;
    householdSync.dirty = false;
    householdSyncSave();
    return true;
  } catch (e) { return false; }
}
function householdMarkDirty() {
  if (!sharedState || !sharedState.household) return;
  householdSyncLoad();
  householdSync.householdId = sharedState.household.id;
  householdSync.dirty = true;
  householdSyncSave();
  if (householdTimer) clearTimeout(householdTimer);
  householdTimer = setTimeout(() => { householdPush(); }, 3500);
}
/* Agrega un movimiento al LIBRO del hogar con su autor (diseño §3:
   author_id + author_name van dentro del propio movimiento). Es la
   vía por la que cualquier pantalla futura anota en el hogar; marca
   el libro sucio y la subida sale con el debounce de la sync. */
function householdAddMovement(kind, item) {
  if (!householdBook || (kind !== 'expenses' && kind !== 'incomes')) return null;
  const stamped = Object.assign({}, item, {
    author_id: cloudUser ? cloudUser.id : '',
    author_name: sharedMeName()
  });
  householdBook[kind].push(stamped);
  householdMarkDirty();
  return stamped;
}
/* Refresca la membresía desde el servidor: mi fila de
   household_members manda; de ahí salen el hogar (con su código, que
   los miembros sí pueden leer) y la lista completa de miembros.
   Termina bajando el libro del hogar y repintando la tarjeta. */
async function sharedRefresh() {
  if (!SHARED_LIVE) { sharedLoad(); renderSharedCard(); return; }
  const sb = supa();
  if (!sb || !cloudUser) {
    sharedState = { household: null, members: [] };
    householdBook = null;
    renderSharedCard();
    return;
  }
  try {
    const mine = await sb.from('household_members')
      .select('household_id, role, display_name').eq('user_id', cloudUser.id).limit(1);
    if (mine.error) return;
    const rows = mine.data || [];
    if (!rows.length) {
      sharedState = { household: null, members: [] };
      householdBook = null;
      sharedSave();
      renderSharedCard();
      return;
    }
    const hid = rows[0].household_id;
    const hh = await sb.from('households')
      .select('id, name, invite_code').eq('id', hid).maybeSingle();
    const mem = await sb.from('household_members')
      .select('user_id, role, display_name').eq('household_id', hid);
    sharedState = {
      household: {
        id: hid,
        name: (hh.data && hh.data.name) || t('shared_household_fallback'),
        code: (hh.data && hh.data.invite_code) || '',
        role: ['dueno', 'admin', 'miembro', 'lector'].includes(rows[0].role) ? rows[0].role : 'miembro'
      },
      members: (mem.data || []).map((mm) => ({
        name: cleanText(mm.display_name, 60) || '—',
        role: ['dueno', 'admin', 'miembro', 'lector'].includes(mm.role) ? mm.role : 'miembro',
        me: mm.user_id === cloudUser.id
      }))
    };
    sharedSave();
    await householdPull();
  } catch (e) { /* sin red: se queda la caché de pantalla */ }
  renderSharedCard();
}
function sharedRpcError(error) {
  const msg = (error && error.message) || '';
  if (/codigo invalido/i.test(msg)) return t('shared_err_code_live');
  if (/ya eres miembro/i.test(msg)) return t('shared_err_member');
  if (/dueno no puede salir/i.test(msg)) return t('shared_err_owner_leave');
  return t('shared_err_generic');
}
/* --- Crear hogar: RPC create_household(p_name, p_display_name) →
   devuelve (household_id, invite_code). Función Pro (requirePro). --- */
async function sharedCreate(name) {
  if (!requirePro()) return;
  if (!SHARED_LIVE) { sharedMockCreate(name); window.alert(t('shared_created')); renderSharedCard(); return; }
  const sb = supa();
  if (!sb || !cloudUser) { showError('shared-error', t('shared_err_login')); return; }
  try {
    const { error } = await sb.rpc('create_household', { p_name: name, p_display_name: sharedMeName() });
    if (error) { showError('shared-error', sharedRpcError(error)); return; }
    await sharedRefresh();
    window.alert(t('shared_created_live'));
  } catch (e) { showError('shared-error', t('shared_err_generic')); }
}
/* --- Unirse: RPC join_household(p_code, p_display_name) → devuelve
   (household_id, household_name, role). El código se valida en el
   servidor; la app nunca lo consulta directo. Función Pro. --- */
async function sharedJoin(code) {
  if (!requirePro()) return;
  if (!SHARED_LIVE) { sharedMockJoin(code); window.alert(t('shared_joined')); renderSharedCard(); return; }
  const sb = supa();
  if (!sb || !cloudUser) { showError('shared-error', t('shared_err_login')); return; }
  try {
    const { error } = await sb.rpc('join_household', { p_code: code, p_display_name: sharedMeName() });
    if (error) { showError('shared-error', sharedRpcError(error)); return; }
    await sharedRefresh();
    window.alert(t('shared_joined_live'));
  } catch (e) { showError('shared-error', t('shared_err_generic')); }
}
/* --- Salir: RPC leave_household(p_household). El dueño no puede
   salir (el servidor lo rechaza y el mensaje se traduce). --- */
async function sharedLeave() {
  if (!SHARED_LIVE) { sharedMockLeave(); renderSharedCard(); return; }
  const sb = supa();
  const st = sharedLoad();
  if (!sb || !cloudUser || !st.household) { renderSharedCard(); return; }
  try {
    const { error } = await sb.rpc('leave_household', { p_household: st.household.id });
    if (error) { showError('shared-error', sharedRpcError(error)); return; }
    sharedState = { household: null, members: [] };
    householdBook = null;
    householdSync = { householdId: '', lastRemoteAt: '', dirty: false };
    householdSyncSave();
    sharedSave();
  } catch (e) { showError('shared-error', t('shared_err_generic')); }
  renderSharedCard();
}
/* --- [VISTA PREVIA · solo si SHARED_LIVE = false] Las funciones de
   la Fase 3 contra datos locales de mentira. Con SHARED_LIVE = true
   no se llaman: quedan como el modo demo sin servidor. --- */
function sharedMockCreate(name) {
  const me = sharedMeName();
  sharedState.household = { id: 'local-' + uid(), name: name, code: sharedGenCode(), role: 'dueno' };
  sharedState.members = [{ name: me, role: 'dueno', me: true }];
  sharedSave();
}
function sharedMockJoin(code) {
  const me = sharedMeName();
  sharedState.household = { id: 'local-' + uid(), name: t('shared_household_fallback'), code: code, role: 'miembro' };
  sharedState.members = [
    { name: t('shared_host'), role: 'dueno', me: false },
    { name: me, role: 'miembro', me: true }
  ];
  sharedSave();
}
function sharedMockLeave() {
  sharedState.household = null;
  sharedState.members = [];
  sharedSave();
}
function renderSharedCard() {
  const note = document.getElementById('shared-note');
  if (note) note.textContent = t(SHARED_LIVE ? 'shared_live_note' : 'shared_preview_note');
  /* Sin sesión en la nube no se pinta ninguna caché: la membresía es
     de la cuenta y una caché de otra cuenta no debe ni asomarse. */
  const st = (SHARED_LIVE && !cloudUser) ? { household: null, members: [] } : sharedLoad();
  const none = document.getElementById('shared-none');
  const inn = document.getElementById('shared-in');
  if (!none || !inn) return;
  none.hidden = !!st.household;
  inn.hidden = !st.household;
  if (!st.household) return;
  document.getElementById('shared-household-name').textContent = st.household.name;
  document.getElementById('shared-household-code').textContent =
    t('shared_code_label', { code: st.household.code });
  const ul = document.getElementById('shared-members');
  clearNode(ul);
  for (const mm of st.members) {
    const li = el('li', 'item');
    const main = el('div', 'item-main');
    main.appendChild(el('div', 'item-title', mm.name + (mm.me ? ' (' + t('shared_you') + ')' : '')));
    main.appendChild(el('div', 'item-sub', t('shared_role_' + mm.role)));
    li.appendChild(main);
    ul.appendChild(li);
  }
}
function onSharedCreate() {
  const name = cleanText(document.getElementById('shared-name').value, 60);
  if (!name) { showError('shared-error', t('shared_err_name')); return; }
  showError('shared-error', '');
  document.getElementById('shared-name').value = '';
  sharedCreate(name);
}
function onSharedJoin() {
  const code = cleanText(document.getElementById('shared-code').value, 6).toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) { showError('shared-error', t('shared_err_code')); return; }
  showError('shared-error', '');
  document.getElementById('shared-code').value = '';
  sharedJoin(code);
}
function onSharedLeave() {
  if (!window.confirm(t(SHARED_LIVE ? 'shared_leave_live' : 'shared_leave_confirm'))) return;
  sharedLeave();
}

/* ---------------- Tema (claro / oscuro / automático + color) ----------
   El tema se aplica con atributos data-theme / data-accent en <html> y
   variables CSS: claro, oscuro o automático (prefers-color-scheme).
   El valor por defecto es «auto»: la app sigue el modo claro/oscuro
   del dispositivo sin que la persona toque nada. */
function applyTheme() {
  const de = document.documentElement;
  const theme = (db && db.settings && db.settings.theme) || 'auto';
  const accent = (db && db.settings && db.settings.accent) || 'verde';
  if (de.dataset) { de.dataset.theme = theme; de.dataset.accent = accent; }
  if (de.setAttribute) { de.setAttribute('data-theme', theme); de.setAttribute('data-accent', accent); }
}
/* Si el sistema cambia entre claro y oscuro con la app abierta, la CSS
   reacciona sola por la media query; este listener reaplica el tema
   para que todo lo calculado por código siga al nuevo esquema sin
   recargar la app. */
try {
  if (typeof window !== 'undefined' && window.matchMedia) {
    const schemeMql = window.matchMedia('(prefers-color-scheme: dark)');
    const onSchemeChange = () => { applyTheme(); };
    if (schemeMql.addEventListener) schemeMql.addEventListener('change', onSchemeChange);
    else if (schemeMql.addListener) schemeMql.addListener(onSchemeChange);
  }
} catch (e) { /* sin matchMedia: el tema automático se aplica al abrir la app */ }
/* Paleta para dibujar por código (lienzo del informe mensual y del
   organizador de san): sale de las variables CSS del tema ACTIVO en
   ese momento —esquema claro/oscuro y color de acento elegidos— para
   que la imagen compartida se vea como la app. Si las variables no se
   pueden leer, respalda con la paleta clara de siempre. */
function canvasPalette() {
  const p = { bg: '#ffffff', header: '#0b6e4f', headerText: '#ffffff', ink: '#1c2733', muted: '#5d6b7a' };
  try {
    const cs = window.getComputedStyle(document.documentElement);
    const read = (name) => (cs.getPropertyValue(name) || '').trim();
    if (read('--card')) p.bg = read('--card');
    if (read('--accent')) p.header = read('--accent');
    if (read('--ink')) p.ink = read('--ink');
    if (read('--muted')) p.muted = read('--muted');
  } catch (e) { /* sin CSS disponible: paleta clara de respaldo */ }
  return p;
}

/* ---------------- Deshacer (una sola acción) ----------------
   Antes de cada guardado o borrado se guarda una copia (JSON) de los
   datos; el aviso «Hecho — Deshacer» dura ~8 segundos y la restaura. */
let undoSnapshot = null;
let undoTimer = null;
function beginUndo() { undoSnapshot = JSON.stringify(db); }
function showUndoToast() {
  const toast = document.getElementById('undo-toast');
  if (!toast) return;
  toast.hidden = false;
  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = setTimeout(hideUndoToast, 8000);
}
function hideUndoToast() {
  const toast = document.getElementById('undo-toast');
  if (toast) toast.hidden = true;
  if (undoTimer) { clearTimeout(undoTimer); undoTimer = null; }
}
/* Aviso breve genérico (mismo patrón visual que el de deshacer, pero
   sin botón ni snapshot): lo usa, p. ej., el guardado nativo del
   informe. Vive en su propio elemento (#msg-toast) para no tocar
   showUndoToast ni su temporizador. */
let msgToastTimer = null;
function showToastMsg(msg) {
  const toast = document.getElementById('msg-toast');
  if (!toast) return;
  const text = document.getElementById('msg-toast-text');
  if (text) text.textContent = msg;
  toast.hidden = false;
  if (msgToastTimer) clearTimeout(msgToastTimer);
  msgToastTimer = setTimeout(() => { toast.hidden = true; msgToastTimer = null; }, 4000);
}
function onUndo() {
  if (!undoSnapshot) return;
  const clean = validateData(JSON.parse(undoSnapshot));
  undoSnapshot = null;
  hideUndoToast();
  if (!clean) return;
  db = clean;
  save();
  applyTheme();
  applyTextSize();
  resetExpenseForm(); resetIncomeForm(); resetSavingsForm(); resetGoalForm();
  resetGoal2Form();
  resetFixedForm(); resetAccountForm(); resetDebtForm();
  showView(currentView);
}

/* ---------------- Semanas y reto de ahorro ----------------
   La semana empieza el lunes. El reto solo guarda la meta en Ajustes
   (settings.challengeTargetCents): el progreso y la racha se calculan
   del historial de ahorros (de ingresos + sueltos, por fecha). */
function addDaysStr(dateStr, days) {
  const p = String(dateStr).split('-');
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + days);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function weekStartOf(dateStr) {
  const p = String(dateStr).split('-');
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  return addDaysStr(dateStr, -((d.getDay() + 6) % 7));
}
function savingsBetween(fromStr, toStr) {
  let total = 0;
  for (const i of db.incomes) if (i.date >= fromStr && i.date <= toStr) total += (i.savingsCents || 0);
  for (const s of db.savings) if (s.date >= fromStr && s.date <= toStr) total += s.amountCents;
  return total;
}
function challengeTarget() {
  const v = db.settings.challengeTargetCents;
  return (typeof v === 'number' && v > 0) ? v : 2000;
}
function challengeStats() {
  const target = challengeTarget();
  const start = weekStartOf(todayStr());
  const thisWeek = savingsBetween(start, addDaysStr(start, 6));
  let streak = 0;
  let cursor = thisWeek >= target ? start : addDaysStr(start, -7);
  while (savingsBetween(cursor, addDaysStr(cursor, 6)) >= target) {
    streak++;
    cursor = addDaysStr(cursor, -7);
  }
  return { target: target, thisWeek: thisWeek, done: thisWeek >= target, streak: streak };
}
function renderChallenge() {
  const card = document.getElementById('challenge-card');
  if (!card) return;
  clearNode(card);
  const st = challengeStats();
  card.appendChild(el('h3', null, t('chal_title')));
  if (st.done) card.appendChild(el('p', 'goal-done', t('chal_done')));
  card.appendChild(el('p', 'total-line', t('chal_progress', { have: fmt(st.thisWeek), target: fmt(st.target) })));
  const bar = el('div', 'budget-bar goal-bar');
  const fill = el('div', 'budget-fill');
  fill.style.width = Math.min(100, Math.floor(st.thisWeek / st.target * 100)) + '%';
  bar.appendChild(fill);
  card.appendChild(bar);
  card.appendChild(el('p', 'muted',
    st.streak === 1 ? t('chal_streak_one')
      : st.streak > 1 ? t('chal_streak_many', { n: st.streak })
      : t('chal_streak_zero')));
  card.appendChild(actionButton(t('chal_share'), 'btn-secondary', () => {
    const lines = ['🔥 PETO Finanzas', t('chal_progress', { have: fmtMoney(st.thisWeek), target: fmtMoney(st.target) })];
    lines.push(st.streak === 1 ? t('chal_streak_one')
      : st.streak > 1 ? t('chal_streak_many', { n: st.streak })
      : t('chal_streak_zero'));
    shareText(t('chal_title'), lines.join('\n'));
  }));
  const input = document.getElementById('chal-target');
  if (input) input.value = (st.target / 100).toFixed(2);
}
function onChallengeSubmit(ev) {
  ev.preventDefault();
  const cents = parseAmount(document.getElementById('chal-target').value, false);
  if (cents === null) { showError('chal-error', t('err_amount')); return; }
  db.settings.challengeTargetCents = cents;
  showError('chal-error', '');
  save(); renderSavings();
}

/* ---------------- Buscar movimientos ---------------- */
function searchMovements(query, monthKey, type) {
  const q = String(query || '').trim().toLowerCase();
  const out = [];
  const matches = (text, cents) => {
    if (!q) return true;
    return (text + ' ' + (cents / 100).toFixed(2)).toLowerCase().indexOf(q) >= 0;
  };
  if (type === 'todos' || type === 'gastos') {
    for (const e of db.expenses) {
      if (monthKey && monthKeyOf(e.date) !== monthKey) continue;
      if (matches(e.note + ' ' + e.category + ' ' + catName(e.category), e.amountCents)) {
        out.push({ type: 'gastos', date: e.date, title: catName(e.category), sub: e.note, amountCents: e.amountCents });
      }
    }
  }
  if (type === 'todos' || type === 'ingresos') {
    for (const i of db.incomes) {
      if (monthKey && monthKeyOf(i.date) !== monthKey) continue;
      if (matches(i.note + ' ' + t('search_type_income'), i.amountCents)) {
        out.push({ type: 'ingresos', date: i.date, title: t('search_type_income'), sub: i.note, amountCents: i.amountCents });
      }
    }
  }
  if (type === 'todos' || type === 'ahorros') {
    for (const i of db.incomes) {
      if ((i.savingsCents || 0) <= 0) continue;
      if (monthKey && monthKeyOf(i.date) !== monthKey) continue;
      if (matches(i.note + ' ' + t('search_type_saving'), i.savingsCents)) {
        out.push({ type: 'ahorros', date: i.date, title: t('sav_from_title', { date: prettyDate(i.date) }), sub: i.note, amountCents: i.savingsCents });
      }
    }
    for (const s of db.savings) {
      if (monthKey && monthKeyOf(s.date) !== monthKey) continue;
      if (matches(s.note + ' ' + t('search_type_saving'), s.amountCents)) {
        out.push({ type: 'ahorros', date: s.date, title: s.note ? s.note : t('sav_manual_title'), sub: t('search_type_saving'), amountCents: s.amountCents });
      }
    }
  }
  out.sort((a, b) => (a.date < b.date ? 1 : -1));
  return out;
}
function renderSearch() {
  const q = document.getElementById('search-text').value || '';
  const month = document.getElementById('search-month').value || '';
  const type = document.getElementById('search-type').value || 'todos';
  const results = searchMovements(q, month, type);
  const ul = document.getElementById('search-results');
  clearNode(ul);
  document.getElementById('search-empty').hidden = results.length > 0;
  for (const r of results) {
    const li = el('li', 'item');
    const main = el('div', 'item-main');
    main.appendChild(el('div', 'item-title', r.title));
    main.appendChild(el('div', 'item-sub', prettyDate(r.date) + (r.sub ? ' · ' + r.sub : '')));
    li.appendChild(main);
    li.appendChild(el('span', 'item-amount', fmt(r.amountCents)));
    li.addEventListener('click', () => showView(r.type));
    ul.appendChild(li);
  }
}

/* ---------------- Informe del mes ---------------- */
function reportData(key) {
  const exps = monthExpenses(key);
  const byCat = {};
  for (const e of exps) byCat[e.category] = (byCat[e.category] || 0) + e.amountCents;
  let topCat = null, topAmt = 0;
  for (const c of Object.keys(byCat)) if (byCat[c] > topAmt) { topAmt = byCat[c]; topCat = c; }
  /* Top 3 categorías del mes, de mayor a menor gasto (Fase 1: van en la
     imagen compartible del informe). */
  const topCats = Object.keys(byCat)
    .map((c) => ({ cat: c, amt: byCat[c] }))
    .filter((x) => x.amt > 0)
    .sort((a, b) => b.amt - a.amt)
    .slice(0, 3);
  return {
    month: monthLabel(key),
    income: sumCents(monthIncomes(key)),
    expenses: sumCents(exps),
    savings: monthSavings(key),
    topCat: topCat, topAmt: topAmt, topCats: topCats,
    goal: db.savingsGoal ? { name: db.savingsGoal.name, pct: goalPct() } : null
  };
}
function reportRow(label, value) {
  const row = el('div', 'report-row');
  row.appendChild(el('span', null, label));
  row.appendChild(el('strong', null, value));
  return row;
}
function renderReport() {
  const card = document.getElementById('report-card');
  if (!card) return;
  clearNode(card);
  const d = reportData(chartMonth);
  card.appendChild(el('h3', null, '📋 ' + d.month));
  card.appendChild(reportRow(t('rep_income'), fmt(d.income)));
  card.appendChild(reportRow(t('rep_expenses'), fmt(d.expenses)));
  card.appendChild(reportRow(t('rep_savings'), fmt(d.savings)));
  card.appendChild(reportRow(t('rep_top_cat'), d.topCat ? catName(d.topCat) + ' · ' + fmt(d.topAmt) : t('rep_none')));
  if (d.goal) card.appendChild(reportRow(t('rep_goal') + ' · ' + d.goal.name, d.goal.pct + '%'));
}
/* Dibuja el informe del mes en un lienzo (Canvas puro, sin librerías,
   con la marca PETO): mes, ingresos, gastos, el ahorro REAL anotado por
   la persona (nunca calculado) y el top 3 de categorías. Lo comparten
   la descarga y el compartir en imagen. Devuelve null sin contexto 2d. */
function buildReportCanvas() {
  const d = reportData(chartMonth);
  const mainLines = [
    [t('rep_income'), fmtMoney(d.income)],
    [t('rep_expenses'), fmtMoney(d.expenses)],
    [t('rep_savings'), fmtMoney(d.savings)]
  ];
  if (d.goal) mainLines.push([t('rep_goal') + ' · ' + d.goal.name, d.goal.pct + '%']);
  const top = d.topCats || [];
  const height = 190 + mainLines.length * 52 + (top.length ? 80 + top.length * 46 : 0) + 24 + 88;
  const canvas = document.createElement('canvas');
  canvas.width = 800; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const P = canvasPalette();
  const BRAND_GREEN = '#0b6e4f';
  ctx.fillStyle = P.bg; ctx.fillRect(0, 0, 800, height);
  ctx.fillStyle = BRAND_GREEN; ctx.fillRect(0, 0, 800, 96);
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 34px sans-serif';
  ctx.fillText(t('app_title'), 40, 58);
  ctx.fillStyle = P.ink; ctx.font = 'bold 30px sans-serif';
  ctx.fillText(d.month, 40, 150);
  ctx.font = '26px sans-serif';
  let y = 210;
  for (const line of mainLines) {
    ctx.fillStyle = P.muted; ctx.fillText(line[0], 40, y);
    ctx.fillStyle = P.ink; ctx.fillText(line[1], 420, y);
    y += 52;
  }
  if (top.length) {
    y += 28;
    ctx.fillStyle = P.ink; ctx.font = 'bold 25px sans-serif';
    ctx.fillText(t('rep_top3'), 40, y);
    ctx.font = '25px sans-serif';
    y += 48;
    top.forEach((c, i) => {
      ctx.fillStyle = P.muted; ctx.fillText((i + 1) + '. ' + catName(c.cat), 40, y);
      ctx.fillStyle = P.ink; ctx.fillText(fmtMoney(c.amt), 420, y);
      y += 46;
    });
  }
  ctx.fillStyle = BRAND_GREEN; ctx.fillRect(0, height - 64, 800, 64);
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(t('rep_promo_footer'), 400, height - 24);
  ctx.textAlign = 'left';
  return canvas;
}
/* Descarga el informe como imagen PNG. En la app nativa guarda el
   archivo con el plugin Filesystem (en DOCUMENTS): el <a download>
   web no hace nada en Android. Sin plugin, o si el guardado nativo
   falla, se usa la descarga web de siempre como respaldo. */
async function downloadReportPng() {
  const canvas = buildReportCanvas();
  if (!canvas) return;
  const FS = capPlugin('Filesystem');
  if (FS && canvas.toDataURL) {
    try {
      const data = canvas.toDataURL('image/png').split(',')[1];
      if (data) {
        await FS.writeFile({ path: 'informe-' + chartMonth + '.png', data: data, directory: 'DOCUMENTS' });
        showToastMsg(t('rep_saved'));
        maybeAskReview();
        return;
      }
    } catch (e) { /* guardado nativo falló: se cae a la descarga web */ }
  }
  try {
    const finish = (url) => {
      if (!url) return;
      const a = document.createElement('a');
      a.href = url;
      a.download = 'informe-' + chartMonth + '.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToastMsg(t('rep_saved'));
    };
    if (canvas.toBlob) canvas.toBlob((blob) => { if (blob) finish(URL.createObjectURL(blob)); });
    else if (canvas.toDataURL) finish(canvas.toDataURL('image/png'));
  } catch (e) { /* sin lienzo disponible: no pasa nada */ }
  maybeAskReview();
}
/* Comparte el informe como IMAGEN (Fase 1): Web Share con archivos
   cuando el sistema lo permite (WhatsApp y demás); si compartir
   archivos no está disponible, la imagen se descarga. Si la persona
   cancela el compartir, no se fuerza la descarga. */
async function shareReportPng() {
  const canvas = buildReportCanvas();
  if (!canvas) return;
  const FS = capPlugin('Filesystem');
  const SH = capPlugin('Share');
  if (FS && SH && canvas.toDataURL) {
    try {
      const data = canvas.toDataURL('image/png').split(',')[1];
      if (data) {
        const path = 'informe-' + chartMonth + '.png';
        await FS.writeFile({ path: path, data: data, directory: 'CACHE' });
        const uriRes = await FS.getUri({ directory: 'CACHE', path: path });
        const uri = uriRes && uriRes.uri ? uriRes.uri : uriRes;
        await SH.share({ title: t('share_report_title'), url: uri });
        maybeAskReview();
        return;
      }
    } catch (e) { return; /* compartir nativo cancelado/falló: no forzar la descarga */ }
  }
  try {
    const blob = await new Promise((resolve) => {
      if (canvas.toBlob) canvas.toBlob(resolve, 'image/png');
      else resolve(null);
    });
    if (blob && typeof File !== 'undefined' && navigator.share && navigator.canShare) {
      const file = new File([blob], 'informe-' + chartMonth + '.png', { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: t('share_report_title') });
          maybeAskReview();
          return;
        } catch (e) {
          if (e && e.name === 'AbortError') return; /* canceló: nada más */
          /* otro fallo: se cae a la descarga */
        }
      }
    }
  } catch (e) { /* sin lienzo/blob disponible: se cae a la descarga */ }
  downloadReportPng();
}

/* ---------------- Invitación a reseñar (Paquete 3) ----------------
   Tras generar el informe mensual (compartirlo o descargarlo), UNA
   sola vez en la vida de la app sale una tarjeta amable en Resumen
   invitando a calificar en Google Play. Aceptar o descartar apaga la
   invitación para siempre (settings.reviewPromptDone, persistido):
   nada de ventanas repetidas ni de insistir. */
const REVIEW_URL = 'https://play.google.com/store/apps/details?id=app.peto';
function maybeAskReview() {
  if (!db || db.settings.reviewPromptDone) return;
  renderReviewCard();
}
function renderReviewCard() {
  const card = document.getElementById('review-card');
  if (!card) return;
  clearNode(card);
  card.hidden = false;
  card.appendChild(el('h3', null, t('review_title')));
  card.appendChild(el('p', 'muted', t('review_text')));
  const row = el('div', 'form-actions');
  const yes = el('a', 'btn btn-primary', t('review_yes'));
  yes.href = REVIEW_URL;
  yes.target = '_blank';
  yes.rel = 'noopener';
  yes.addEventListener('click', answerReview);
  row.appendChild(yes);
  row.appendChild(actionButton(t('review_no'), 'btn-ghost', answerReview));
  card.appendChild(row);
}
function answerReview() {
  if (!db) return;
  db.settings.reviewPromptDone = true;
  save();
  const card = document.getElementById('review-card');
  if (card) { card.hidden = true; clearNode(card); }
}

/* ---------------- PETO PRO (Fase 4) ----------------------------------
   Qué incluye Pro (PLAN-IDEAS, Fase 4): nube sin límites, informe
   avanzado, presupuesto compartido y modo organizador de san. Lo
   básico sigue gratis. Precio fijado por Sterlin (23-oct-2026):
   $1.99/mes.
   ESTADO DE LA FACTURACIÓN (actualizado 24-oct-2026): el plugin de
   Google Play Billing YA está integrado en el proyecto y cableado
   en la capa PetoBilling (ver abajo): capacitor-plugin-cdv-purchase
   13.19.1, con Billing Library 9. Lo que falta es de tienda, no de
   código: crear la suscripción PRO_PRODUCT_ID a $1.99/mes en Play
   Console y verificar el cobro en una pista de prueba con una
   compilación que lleve el plugin (pasos en pro-billing/NOTAS.md).
   Hasta esa verificación, la pantalla de Pro se sigue presentando
   como «muy pronto» con su lista de espera LOCAL
   (settings.proWaitlist) y NADA se simula como si fuera una compra
   real: sin puente nativo, PetoBilling.available queda en false.
   El estado Pro vive en settings.pro y SOLO lo enciende la capa de
   facturación (PetoBilling) cuando Play confirme la suscripción.
   EXCEPCIÓN DE PRUEBA CERRADA (decisión de Sterlin, 23-oct-2026):
   mientras PETO_PRO_OPEN_TEST sea true, isPro() devuelve true para
   todos y el muro no aparece, para que Sterlin y los testers puedan
   usar el compartido, el organizador y el informe avanzado antes de
   que exista el cobro. La tarjeta de Ajustes lo muestra tal cual
   (pro_status_test). Al activar Play Billing: bandera en false. */
const PRO_PRICE_TEXT = '$1.99';
const PRO_PRODUCT_ID = 'peto_pro_mensual';
/* PRUEBA CERRADA: Pro abierto para Sterlin y los testers; poner en
   false al activar Play Billing. No escribe settings.pro: solo hace
   que isPro() devuelva true mientras dure la prueba. */
const PETO_PRO_OPEN_TEST = true;
function isPro() {
  return PETO_PRO_OPEN_TEST || !!(db && db.settings && db.settings.pro === true);
}
/* === CAPA DE FACTURACIÓN — único punto de integración con la tienda ==
   Ninguna otra parte de la app habla con la tienda: todo pasa por
   este objeto. Plugin: capacitor-plugin-cdv-purchase 13.19.1
   (puente nativo propio de Capacitor, sin capa Cordova; en Android
   usa Google Play Billing Library 9.0.0 y su manifiesto aporta el
   permiso com.android.vending.BILLING). Su núcleo JS va vendored en
   vendor/cdv-purchase.js y expone el global CdvPurchase; el puente
   nativo se registra como Capacitor.Plugins.PurchasePlugin, el mismo
   patrón capPlugin() del resto de plugins de la app.
   Inicialización PEREZOSA: la tienda solo se abre cuando algo la
   necesita (purchase(), restore(), productInfo() o el refresco de
   arranque, que a su vez no hace nada si el puente no está).
   Sin validador de servidor: verify() confirma con los recibos
   LOCALES del dispositivo (sin validator, el plugin usa los recibos
   locales), coherente con que PETO no manda datos a terceros. El
   estado Pro SOLO lo escribe _sync(), desde el owned confirmado por
   la tienda tras el ciclo approved → verify → finish (finish es lo
   que reconoce la suscripción ante Play: sin él, Play la reembolsa
   a los 3 días). Un pago diferido (pending) NO concede Pro.
   En web y en la versión de prueba el puente no existe: available
   queda en false y purchase()/restore() devuelven
   billing_no_disponible sin tocar el estado. */
const PetoBilling = {
  available: false, /* true solo si el puente respondió y la tienda abrió */
  _initPromise: null,

  /* Plataforma de tienda según la plataforma Capacitor actual. */
  _platform(C) {
    const p = (window.Capacitor && typeof window.Capacitor.getPlatform === 'function')
      ? window.Capacitor.getPlatform() : 'web';
    if (p === 'android') return C.Platform.GOOGLE_PLAY;
    if (p === 'ios') return C.Platform.APPLE_APPSTORE;
    return null;
  },

  /* El núcleo JS + el puente nativo, o null si no están (web/prueba). */
  _bridge() {
    try {
      const C = window.CdvPurchase;
      if (!C || !C.store) return null;
      if (!capPlugin('PurchasePlugin')) return null;
      if (!this._platform(C)) return null;
      return C;
    } catch (e) { return null; }
  },

  /* Escribe settings.pro SOLO desde el estado confirmado por la tienda. */
  _sync() {
    const C = window.CdvPurchase;
    if (!C || !db) return false;
    const product = C.store.get(PRO_PRODUCT_ID, this._platform(C));
    const ownedNow = product ? !!C.store.owned(product) : false;
    if (!!db.settings.pro !== ownedNow) {
      db.settings.pro = ownedNow;
      save();
    }
    renderProCard();
    return ownedNow;
  },

  _listen(C) {
    C.store.when()
      .approved((transaction) => { transaction.verify(); })
      .verified((receipt) => { receipt.finish(); })
      .finished(() => { this._sync(); })
      .receiptUpdated(() => { this._sync(); })
      .pending(() => { /* pago diferido: no conceder hasta approved */ });
    C.store.error(() => { /* errores de tienda: no tocar el estado Pro */ });
  },

  /* Abre la tienda una sola vez; true si quedó operativa. */
  _ensureInit() {
    if (!this._initPromise) {
      this._initPromise = (async () => {
        const C = this._bridge();
        if (!C) { this.available = false; return false; }
        try {
          const platform = this._platform(C);
          this._listen(C);
          C.store.register([{
            id: PRO_PRODUCT_ID,
            type: C.ProductType.PAID_SUBSCRIPTION,
            platform
          }]);
          const errors = await C.store.initialize([platform]);
          if (errors && errors.length) { this.available = false; return false; }
          this.available = true;
          this._sync();
          return true;
        } catch (e) {
          this.available = false;
          return false;
        }
      })();
    }
    return this._initPromise;
  },

  /* Refresco de estado (arranque nativo); sin puente no hace nada. */
  async refresh() {
    if (!this._bridge()) return false;
    return this._ensureInit();
  },

  /* Consulta del producto en la tienda (título y precio localizados). */
  async productInfo() {
    if (!(await this._ensureInit())) return null;
    const C = window.CdvPurchase;
    const product = C.store.get(PRO_PRODUCT_ID, this._platform(C));
    if (!product) return null;
    const phases = product.pricing && product.pricing.phases;
    const phase = phases && phases.length ? phases[0] : null;
    return {
      id: product.id,
      title: product.title || '',
      priceText: phase ? (phase.price || '') : '',
      currency: phase ? (phase.currency || '') : ''
    };
  },

  async purchase() {
    if (!(await this._ensureInit())) return { ok: false, reason: 'billing_no_disponible' };
    const C = window.CdvPurchase;
    const store = C.store;
    const product = store.get(PRO_PRODUCT_ID, this._platform(C));
    if (!product) return { ok: false, reason: 'producto_no_disponible' };
    if (store.owned(product)) { this._sync(); return { ok: true, already: true }; }
    const offer = product.getOffer();
    if (!offer) return { ok: false, reason: 'producto_no_disponible' };
    let err = null;
    try { err = await offer.order(); } catch (e) { err = e; }
    if (err) return { ok: false, reason: 'compra_no_completada', code: err.code || null };
    /* approved → verify → finish corre en los listeners; el estado
       final llega por finished/receiptUpdated. Se sincroniza ya lo
       que la tienda confirme en este momento. */
    return this._sync() ? { ok: true } : { ok: true, pending: true };
  },

  async restore() {
    if (!(await this._ensureInit())) return { ok: false, reason: 'billing_no_disponible' };
    const store = window.CdvPurchase.store;
    let err = null;
    try { err = await store.restorePurchases(); } catch (e) { err = e; }
    if (err) return { ok: false, reason: 'restore_error', code: err.code || null };
    const ownedNow = this._sync();
    return { ok: ownedNow, restored: ownedNow };
  }
};
/* Muro de pago: las funciones Pro llaman requirePro() antes de abrir;
   sin Pro se muestra la pantalla de venta y no se ejecuta nada más. */
function requirePro() {
  if (isPro()) return true;
  showProPaywall();
  return false;
}
function renderProCard() {
  const status = document.getElementById('pro-status');
  if (!status) return;
  /* Con Pro abierto por la prueba, el botón que abre el muro no aplica. */
  const openBtn = document.getElementById('btn-pro-open');
  if (openBtn) openBtn.hidden = PETO_PRO_OPEN_TEST;
  if (!db) return;
  status.textContent = PETO_PRO_OPEN_TEST ? t('pro_status_test')
    : isPro() ? t('pro_status_active')
    : (db.settings.proWaitlist ? t('pro_status_waitlist') : t('pro_status_free'));
}
function renderProPaywall() {
  const price = document.getElementById('pro-price-line');
  if (price) price.textContent = t('pro_price_line');
  const ul = document.getElementById('pro-benefits');
  if (ul) {
    clearNode(ul);
    for (const k of ['pro_benefit_cloud', 'pro_benefit_report', 'pro_benefit_shared', 'pro_benefit_org']) {
      ul.appendChild(el('li', 'item', t(k)));
    }
  }
  const onList = !!(db && db.settings && db.settings.proWaitlist);
  const btn = document.getElementById('pro-waitlist-btn');
  if (btn) btn.hidden = onList;
  const done = document.getElementById('pro-waitlist-done');
  if (done) done.hidden = !onList;
}
function showProPaywall() {
  renderProPaywall();
  const o = document.getElementById('pro-paywall');
  if (o) o.hidden = false;
}
function hideProPaywall() {
  const o = document.getElementById('pro-paywall');
  if (o) o.hidden = true;
}
function onProWaitlist() {
  db.settings.proWaitlist = true;
  save();
  renderProPaywall();
  renderProCard();
}
/* Botón de compra — la UI lo mostrará cuando la facturación esté
   verificada en Play (ver pro-billing/NOTAS.md). No finge resultados:
   purchase() inicializa la tienda de forma perezosa y, si la
   facturación no está disponible, no toca el estado Pro. */
async function onProBuy() {
  const r = await PetoBilling.purchase();
  if (r && r.ok) { renderProCard(); hideProPaywall(); }
  return r;
}

/* ---------------- Informe avanzado (Fase 4 · Pro) ---------------------
   En Resumen: el mes elegido contra el anterior (ingresos, gastos y
   ahorro real con su cambio), TODAS las categorías con su porcentaje
   y la exportación del mes en CSV. Detrás del muro de Pro. */
function advDeltaText(nowCents, prevCents) {
  const d = nowCents - prevCents;
  if (d === 0) return '= ' + fmtMoney(0);
  let s = (d > 0 ? '+' : '−') + fmtMoney(Math.abs(d));
  if (prevCents > 0) s += ' (' + Math.round(Math.abs(d) / prevCents * 100) + '%)';
  return s;
}
function renderAdvReport() {
  const card = document.getElementById('adv-card');
  const csvBtn = document.getElementById('btn-adv-csv');
  if (!card) return;
  const key = chartMonth;
  const cur = reportData(key);
  const prev = reportData(shiftMonth(key, -1));
  clearNode(card);
  card.hidden = false;
  card.appendChild(el('h3', null, '📊 ' + t('adv_title') + ' · ' + cur.month));
  if (!cur.income && !cur.expenses && !prev.income && !prev.expenses) {
    card.appendChild(el('p', 'muted', t('adv_empty')));
    if (csvBtn) csvBtn.hidden = true;
    return;
  }
  const pairs = [
    [t('rep_income'), cur.income, prev.income],
    [t('rep_expenses'), cur.expenses, prev.expenses],
    [t('rep_savings'), cur.savings, prev.savings]
  ];
  for (const [label, nowV, prevV] of pairs) {
    card.appendChild(reportRow(label + ' · ' + t('adv_this_month'), fmt(nowV)));
    card.appendChild(reportRow(label + ' · ' + t('adv_prev_month'), fmt(prevV)));
    card.appendChild(reportRow(label + ' · ' + t('adv_change'), advDeltaText(nowV, prevV)));
  }
  card.appendChild(el('h4', null, t('adv_all_cats')));
  const exps = monthExpenses(key);
  const byCat = {};
  let total = 0;
  for (const e of exps) { byCat[e.category] = (byCat[e.category] || 0) + e.amountCents; total += e.amountCents; }
  const entries = Object.keys(byCat)
    .map((c) => ({ cat: c, amt: byCat[c] }))
    .filter((x) => x.amt > 0)
    .sort((a, b) => b.amt - a.amt);
  for (const entry of entries) {
    const pct = total > 0 ? Math.round(entry.amt / total * 100) : 0;
    card.appendChild(reportRow(catName(entry.cat) + ' · ' + pct + '%', fmt(entry.amt)));
  }
  if (csvBtn) csvBtn.hidden = false;
}
function onAdvOpen() {
  if (!requirePro()) return; /* sin Pro: muro, y la tarjeta queda oculta */
  renderAdvReport();
}
/* CSV del mes (fecha, tipo, categoría, nota, cantidad): lo generan los
   datos ya validados de la app, ordenado por fecha. */
function advBuildCsv(key) {
  const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const items = [];
  for (const e of monthExpenses(key)) {
    items.push({ date: e.date, tipo: 'gasto', categoria: e.category, nota: e.note, cantidad: (e.amountCents / 100).toFixed(2) });
  }
  for (const i of monthIncomes(key)) {
    items.push({ date: i.date, tipo: 'ingreso', categoria: '', nota: i.note, cantidad: (i.amountCents / 100).toFixed(2) });
  }
  items.sort((a, b) => (a.date < b.date ? -1 : (a.date > b.date ? 1 : 0)));
  const lines = ['fecha,tipo,categoria,nota,cantidad'];
  for (const it of items) lines.push([it.date, it.tipo, it.categoria, it.nota, it.cantidad].map(esc).join(','));
  return lines.join('\n');
}
function onAdvCsv() {
  if (!requirePro()) return;
  const blob = new Blob([advBuildCsv(chartMonth)], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'peto-' + chartMonth + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}


/* ---------------- Calculadora de deudas ----------------
   Simulación mensual: primero se devenga el interés del mes en cada
   deuda, luego se pagan los mínimos de todas y el resto del presupuesto
   va a la deuda objetivo (bola de nieve: menor saldo; avalancha: mayor
   interés), con traspaso si la objetivo se paga. Si el total no baja en
   un mes completo, el plan nunca termina (ok = false). */
function simulatePayoff(debts, budgetCents, strategy) {
  const act = (debts || []).filter((d) => d.status === 'pendiente' && d.amountCents > 0)
    .map((d) => ({
      name: d.name, balance: d.amountCents,
      rate: (d.interesPct || 0) / 1200, minPay: d.pagoMinCents || 0, paidMonth: 0
    }));
  if (act.length === 0) return { ok: true, months: 0, totalInterestCents: 0, order: [] };
  if (!(budgetCents > 0)) return { ok: false, months: 0, totalInterestCents: 0, order: [] };
  let totalInterest = 0;
  const order = [];
  for (let month = 1; month <= 1200; month++) {
    const open = act.filter((d) => d.balance > 0);
    if (open.length === 0) return { ok: true, months: month - 1, totalInterestCents: totalInterest, order: order };
    const sumBefore = open.reduce((total, d) => total + d.balance, 0);
    for (const d of open) {
      const interest = Math.round(d.balance * d.rate);
      d.balance += interest;
      totalInterest += interest;
    }
    let left = budgetCents;
    for (const d of open) {
      if (left <= 0) break;
      const pay = Math.min(d.minPay, d.balance, left);
      d.balance -= pay; left -= pay;
    }
    while (left > 0) {
      const alive = act.filter((d) => d.balance > 0);
      if (alive.length === 0) break;
      alive.sort(strategy === 'nieve'
        ? (a, b) => a.balance - b.balance
        : (a, b) => (b.rate - a.rate) || (a.balance - b.balance));
      const target = alive[0];
      const pay = Math.min(left, target.balance);
      if (pay <= 0) break;
      target.balance -= pay; left -= pay;
    }
    let sumAfter = 0;
    for (const d of open) {
      if (d.balance <= 0 && !d.paidMonth) { d.paidMonth = month; order.push(d.name); }
      if (d.balance > 0) sumAfter += d.balance;
    }
    if (sumAfter > 0 && sumAfter >= sumBefore) {
      return { ok: false, months: month, totalInterestCents: totalInterest, order: order };
    }
  }
  return { ok: false, months: 1200, totalInterestCents: totalInterest, order: order };
}
function renderCalc() {
  const budget = parseAmount(document.getElementById('calc-budget').value, false);
  const note = document.getElementById('calc-note');
  const box = document.getElementById('calc-results');
  clearNode(box);
  showError('calc-error', '');
  note.hidden = true;
  if (budget === null) { showError('calc-error', t('calc_err_budget')); return; }
  const pending = db.debts.filter((d) => d.status === 'pendiente' && d.amountCents > 0);
  if (pending.length === 0) { box.appendChild(el('p', 'muted', t('calc_free'))); return; }
  if (pending.some((d) => !(d.pagoMinCents > 0))) {
    note.textContent = t('calc_note_zero');
    note.hidden = false;
  }
  const plans = [
    { key: 'calc_snowball', res: simulatePayoff(db.debts, budget, 'nieve') },
    { key: 'calc_avalanche', res: simulatePayoff(db.debts, budget, 'avalancha') }
  ];
  for (const plan of plans) {
    const block = el('div', 'calc-block');
    block.appendChild(el('h4', null, t(plan.key)));
    if (!plan.res.ok) {
      block.appendChild(el('p', 'error', t('calc_warn')));
    } else {
      block.appendChild(el('p', null, plan.res.months === 1
        ? t('calc_months_one', { interest: fmt(plan.res.totalInterestCents) })
        : t('calc_result', { months: plan.res.months, interest: fmt(plan.res.totalInterestCents) })));
      block.appendChild(el('p', 'muted small', t('calc_order')));
      const ol = el('ol', 'calc-order');
      for (const name of plan.res.order) ol.appendChild(el('li', null, name));
      block.appendChild(ol);
    }
    box.appendChild(block);
  }
}

/* ---------------- Foto de recibo ----------------
   La foto se comprime en el teléfono (lienzo, máx. 1200px, JPEG 0.8) y
   se guarda como dataURL junto al gasto; viaja también en la copia JSON.
   expPhotoData es la foto pendiente del formulario (al editar, la que
   ya tenía el gasto). */
let expPhotoData = null;
function setExpensePhoto(dataUrl) {
  expPhotoData = dataUrl || null;
  const img = document.getElementById('exp-photo-preview');
  const rm = document.getElementById('exp-photo-remove');
  img.src = expPhotoData || '';
  img.hidden = !expPhotoData;
  if (rm) rm.hidden = !expPhotoData;
  if (!expPhotoData) document.getElementById('exp-photo').value = '';
}
function processReceiptFile(file, done) {
  if (!file) { done(null); return; }
  try {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, 1200 / Math.max(img.width || 1, img.height || 1));
          const w = Math.max(1, Math.round((img.width || 1) * scale));
          const h = Math.max(1, Math.round((img.height || 1) * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) { done(null); return; }
          ctx.drawImage(img, 0, 0, w, h);
          done(canvas.toDataURL('image/jpeg', 0.8));
        } catch (e) { done(null); }
      };
      img.onerror = () => done(null);
      img.src = reader.result;
    };
    reader.onerror = () => done(null);
    reader.readAsDataURL(file);
  } catch (e) { done(null); }
}
function openPhoto(src) {
  document.getElementById('photo-overlay-img').src = src;
  document.getElementById('photo-overlay').hidden = false;
}

/* ---------------- Bloqueo ---------------- */
function showLock() {
  document.getElementById('app-shell').hidden = true;
  document.getElementById('view-onboarding').hidden = true;
  document.getElementById('view-lock').hidden = false;
  const lockBuildEl = document.getElementById('lock-build-label');
  if (lockBuildEl) lockBuildEl.textContent = BUILD_LABEL;
  document.getElementById('lock-pin').value = '';
  showError('lock-error', '');
  refreshBioButton();
  setTimeout(() => document.getElementById('lock-pin').focus(), 50);
}
function enterApp() {
  /* Compilación 36: al salir de la bienvenida, el temporizador de
     rotación del recorrido se detiene y se limpia (sin fugas). */
  obTourAutoStop();
  document.getElementById('view-lock').hidden = true;
  document.getElementById('view-onboarding').hidden = true;
  document.getElementById('app-shell').hidden = false;
  applyTextSize();
  applyTheme();
  applyStaticI18n();
  const posted = autoPostFixed();
  showView('home');
  if (posted > 0) showUndoToast();
  /* Compilación 28 (apertura más rápida): programar notificaciones y
     revisar las alertas de presupuesto no hacen falta para pintar
     Inicio; van justo después del primer pintado. */
  afterFirstPaint(() => {
    scheduleNotifications();
    checkBudgetAlerts();
    if (db && db.settings.summaryDaily !== false) {
      ensureNotifPermission().then(() => scheduleDailySummary());
    } else {
      scheduleDailySummary();
    }
  });
  checkWidgetPendingAction();
}
async function onLockSubmit(ev) {
  ev.preventDefault();
  const pin = document.getElementById('lock-pin').value.trim();
  if (validPinFormat(pin) && (await checkPin(pin))) { enterApp(); return; }
  showError('lock-error', t('lock_err'));
  document.getElementById('lock-pin').value = '';
}

/* ---------------- Bienvenida ---------------- */
/* Recorrido de 3 pasos sobre el formulario de bienvenida (Paquete 3):
   se ve una sola vez en la vida de la app, porque la bienvenida misma
   solo aparece cuando settings.onboarded es false. Es saltable en
   cualquier paso y no guarda estado propio: al terminar (o saltar),
   el formulario queda a la vista como siempre. */
let obTourStep = 1;
function renderObTour() {
  const tour = document.getElementById('ob-tour');
  if (!tour || tour.hidden) return;
  tour.querySelectorAll('.ob-step').forEach((n) => {
    n.hidden = Number(n.getAttribute('data-ob-step')) !== obTourStep;
  });
  const dots = document.getElementById('ob-tour-dots');
  if (dots) dots.textContent = [1, 2, 3].map((i) => (i === obTourStep ? '●' : '○')).join(' ');
  const next = document.getElementById('ob-tour-next');
  if (next) next.textContent = t(obTourStep >= 3 ? 'ob_tour_go' : 'ob_tour_next');
  const skip = document.getElementById('ob-tour-skip');
  if (skip) skip.hidden = obTourStep >= 3;
}
function obTourSkip() {
  obTourUserTouch();
  const tour = document.getElementById('ob-tour');
  if (tour) tour.hidden = true;
  const name = document.getElementById('ob-name');
  if (name) name.focus();
}
function obTourNext() {
  obTourUserTouch();
  if (obTourStep >= 3) { obTourSkip(); return; }
  obTourStep++;
  renderObTour();
}

/* Rotación automática del recorrido (Compilación 36, pedido de
   Sterlin: «que no haya que darle atrás o adelante»). Las láminas
   avanzan solas cada ~4 s en bucle (de la 3 vuelve a la 1) usando el
   mismo renderObTour() de los botones, así los puntos se actualizan
   igual. Reglas:
   - Cualquier interacción manual (botones o toque sobre el
     recorrido) la APAGA por el resto de la sesión de bienvenida:
     el carrusel nunca le pelea al usuario.
   - Cada tick se salta si la bienvenida o el recorrido no están
     visibles (document.hidden o vista oculta) o si la persona está
     en el formulario (un campo con el foco o texto ya escrito en
     nombre/PIN): la lámina no se mueve mientras escribe.
   - Con prefers-reduced-motion NO arranca: queda manual como antes.
   - Al salir de la bienvenida (enterApp) el temporizador se limpia:
     nada sigue corriendo dentro de la app. */
const OB_TOUR_INTERVAL_MS = 4000;
let obTourTimer = null;
let obTourAutoOff = false;
function obTourReducedMotion() {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { return false; }
}
function obTourFormBusy() {
  const form = document.getElementById('onboarding-form');
  const ae = document.activeElement;
  if (form && ae && form.contains(ae) &&
      (ae.tagName === 'INPUT' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA')) return true;
  for (const id of ['ob-name', 'ob-pin', 'ob-pin2']) {
    const n = document.getElementById(id);
    if (n && n.value) return true;
  }
  return false;
}
function obTourAutoTick() {
  if (obTourAutoOff || obTourTimer === null) return;
  const onb = document.getElementById('view-onboarding');
  const tour = document.getElementById('ob-tour');
  if (!onb || onb.hidden || !tour || tour.hidden || document.hidden) return;
  if (obTourFormBusy()) return;
  obTourStep = obTourStep >= 3 ? 1 : obTourStep + 1;
  renderObTour();
}
function obTourAutoStart() {
  if (obTourTimer !== null || obTourAutoOff) return;
  if (obTourReducedMotion()) return;
  obTourTimer = setInterval(obTourAutoTick, OB_TOUR_INTERVAL_MS);
}
function obTourAutoStop() {
  if (obTourTimer !== null) { clearInterval(obTourTimer); obTourTimer = null; }
}
function obTourUserTouch() {
  obTourAutoOff = true;
  obTourAutoStop();
}

async function onOnboardingSubmit(ev) {
  ev.preventDefault();
  const name = cleanText(document.getElementById('ob-name').value, 40);
  const pin = document.getElementById('ob-pin').value.trim();
  const pin2 = document.getElementById('ob-pin2').value.trim();
  if (!name) { showError('ob-error', t('ob_err_name')); return; }
  if (pin !== '' || pin2 !== '') {
    if (!validPinFormat(pin)) { showError('ob-error', t('ob_err_pin_format')); return; }
    if (pin !== pin2) { showError('ob-error', t('ob_err_pin_mismatch')); return; }
  }
  db.settings.name = name;
  const obLangEl = document.getElementById('ob-lang');
  if (obLangEl) db.settings.lang = validLangSetting(obLangEl.value);
  db.settings.onboarded = true;
  if (pin) await setPin(pin);
  save();
  enterApp();
  /* Recién creado el PIN: ofrecer la huella en el momento (flujo guiado). */
  if (pin) maybeOfferBiometric();
}

/* ---------------- Inicio ---------------- */
/* ---------------- Deslizar para refrescar (Compilación 35) ----------
   Pull-to-refresh SIN plugin nuevo y SIN recargar la página (recargar
   mandaría a la pantalla de bloqueo con PIN y perdería la navegación).
   Enfoque: gesto JS sobre el WebView — arrastre hacia abajo con la
   vista arriba del todo, solo dentro de las vistas principales
   (main.view), con indicador circular de aspecto nativo. Al soltar
   pasado el umbral se ejecuta el refresco REAL de la app:
   pullToRefresh() redibuja la vista actual y, si hay sesión en la
   nube, baja los datos nuevos (sin bloquear si no hay internet y sin
   pisar cambios locales sin subir: solo aplica lo remoto si el local
   no está sucio). No compite con el scroll normal (solo actúa en el
   tope, dy>0) ni con el gesto de atrás de la Compilación 31 (botón/
   gesto del sistema, otro canal). En modo público (#san=) no se
   conecta: wireEvents nunca corre allí, y el guard lo refuerza. */
let ptrRefreshing = false;
async function pullToRefresh() {
  if (ptrRefreshing) return false;
  ptrRefreshing = true;
  try {
    showView(currentView);
    const sb = supa();
    if (sb && cloudUser) {
      try {
        const res = await sb.from('user_data')
          .select('data, updated_at').eq('user_id', cloudUser.id).maybeSingle();
        const row = res && !res.error ? res.data : null;
        if (row && !cloudState.dirty &&
            (!cloudState.lastRemoteAt || row.updated_at !== cloudState.lastRemoteAt)) {
          cloudApplyRemote(row); /* ya guarda y redibuja todo */
        }
      } catch (e) { /* sin internet: vale el refresco local */ }
    }
  } finally { ptrRefreshing = false; }
  return true;
}
function initPullToRefresh() {
  const ind = document.getElementById('ptr-indicator');
  const arrow = ind ? ind.querySelector('.ptr-arrow') : null;
  if (!ind || !arrow) return;
  const THRESHOLD = 70;
  let startY = null;
  let pullDy = 0;
  let tracking = false;
  const pointY = (ev) => {
    const src = (ev.touches && ev.touches.length) ? ev.touches[0]
      : (ev.changedTouches && ev.changedTouches.length) ? ev.changedTouches[0] : ev;
    return src && typeof src.clientY === 'number' ? src.clientY : null;
  };
  const eligible = (ev) => {
    if (SAN_PUBLIC_MODE || ptrRefreshing) return false;
    const shell = document.getElementById('app-shell');
    if (!shell || shell.hidden) return false;
    const drawer = document.getElementById('menu-drawer-wrap');
    if (drawer && !drawer.hidden) return false;
    const photo = document.getElementById('photo-overlay');
    if (photo && !photo.hidden) return false;
    if ((window.scrollY || 0) > 0) return false;
    const tgt = ev.target;
    if (tgt && tgt.closest) {
      if (!tgt.closest('main.view')) return false;
      if (tgt.closest('input, select, textarea')) return false;
    }
    return true;
  };
  const paint = (dy, spinning) => {
    const shown = spinning ? 96 : Math.min(Math.max(dy, 0) * 0.7, 96);
    ind.style.transform = 'translate(-50%, ' + Math.round(shown - 84) + 'px)';
    ind.style.opacity = (dy > 4 || spinning) ? '1' : '0';
    arrow.style.transform = spinning ? '' : 'rotate(' + Math.round(Math.max(dy, 0) * 2.2) + 'deg)';
    ind.classList.toggle('ptr-spinning', !!spinning);
  };
  document.addEventListener('touchstart', (ev) => {
    tracking = false;
    pullDy = 0;
    if (!eligible(ev)) { startY = null; return; }
    startY = pointY(ev);
    tracking = startY !== null;
    if (tracking) ind.classList.remove('ptr-anim');
  }, { passive: true });
  document.addEventListener('touchmove', (ev) => {
    if (!tracking || startY === null) return;
    if ((window.scrollY || 0) > 0) { tracking = false; paint(0, false); return; }
    const y = pointY(ev);
    if (y === null) return;
    pullDy = y - startY;
    if (pullDy <= 0) { paint(0, false); return; }
    if (ev.cancelable && ev.preventDefault) ev.preventDefault();
    paint(pullDy, false);
  }, { passive: false });
  const endPull = async () => {
    if (!tracking) return;
    tracking = false;
    const dy = pullDy;
    pullDy = 0;
    startY = null;
    ind.classList.add('ptr-anim');
    if (dy >= THRESHOLD) {
      paint(THRESHOLD, true);
      const t0 = Date.now();
      try { await pullToRefresh(); } catch (e) { /* el refresco nunca rompe la app */ }
      const wait = 550 - (Date.now() - t0);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    paint(0, false);
  };
  document.addEventListener('touchend', endPull);
  document.addEventListener('touchcancel', endPull);
}

/* ---------------- Podcast (Compilación 36) ----------------
   Sección nueva pedida por Sterlin: la ficha del programa oficial
   «Finanzas Personales» (con Lucía y Marco), la lista de episodios
   desde su feed RSS público y un reproductor integrado.
   Decisiones:
   - Offline-first: la sección SOLO trabaja al abrir su vista (nada
     en el arranque ni en segundo plano). La última lista buena se
     cachea en localStorage; sin conexión se muestra el caché con
     aviso, y sin caché se muestra un mensaje amable.
   - Todo texto del feed entra por textContent (el parser devuelve
     datos, la vista los pinta con el()): el feed nunca se inyecta
     como HTML.
   - Un solo <audio> para todo. Al salir de la vista la reproducción
     se PAUSA (lo hace showView): no sigue sonando sobre las demás
     secciones ni hace falta cazar un botón flotante.
   - Convivencia: el gesto de atrás (C31) no cambia (salir de la
     vista vuelve a Inicio y pausa), y el pull-to-refresh (C35)
     redibuja la vista, lo que aquí significa volver a pedir el feed.
   - La CSP gana connect-src/media-src SOLO para https://muse.ai
     (el feed y sus audios); nada más se abre. */
const PODCAST_FEED_URL = 'https://muse.ai/podcasts/feed/1246339358572522/912278e9-dcd4-40f6-8fd0-ddc078d02c04';
const PODCAST_CACHE_KEY = 'cgastos.podcast.v1';
let podcastEpisodes = null;
let podcastLoadPromise = null;
let podcastCurrentUrl = '';
let podcastCurrentTitle = '';
function podcastAudio() { return document.getElementById('podcast-audio'); }
function podcastFmtClock(sec) {
  const total = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return (h > 0 ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
}
function podcastDurationLabel(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^\d+$/.test(s)) return podcastFmtClock(Number(s));
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return s;
  return '';
}
function podcastDateLabel(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    try { return d.toLocaleDateString(localeTag(), { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch (e) { /* sin Intl no pasa nada: se muestra la fecha cruda */ }
  }
  return s.slice(0, 32);
}
/* Parser PURO del feed RSS (probable sin red): devuelve episodios
   {title, date, duration, url} en el orden del feed (del más
   reciente al más viejo). Solo entran ítems con enclosure https. */
function podcastParseFeed(xmlText) {
  let doc = null;
  try { doc = new DOMParser().parseFromString(String(xmlText || ''), 'text/xml'); }
  catch (e) { return []; }
  if (!doc || doc.getElementsByTagName('parsererror').length) return [];
  const out = [];
  const items = doc.getElementsByTagName('item');
  for (const item of items) {
    const childText = (tag) => {
      const n = item.getElementsByTagName(tag)[0];
      return n ? String(n.textContent || '').trim() : '';
    };
    const enc = item.getElementsByTagName('enclosure')[0];
    const url = enc ? String(enc.getAttribute('url') || '').trim() : '';
    if (!/^https:\/\//i.test(url)) continue;
    const title = childText('title').slice(0, 200);
    if (!title) continue;
    const durRaw = childText('itunes:duration') || childText('duration');
    out.push({ title: title, date: childText('pubDate').slice(0, 64), duration: podcastDurationLabel(durRaw), url: url });
    if (out.length >= 100) break;
  }
  return out;
}
function podcastSanitizeEpisodes(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const url = String(e.url || '');
    if (!/^https:\/\//i.test(url)) continue;
    out.push({
      title: String(e.title || '').slice(0, 200) || '—',
      date: String(e.date || '').slice(0, 64),
      duration: String(e.duration || '').slice(0, 16),
      url: url
    });
    if (out.length >= 100) break;
  }
  return out;
}
function podcastCacheRead() {
  try {
    const raw = JSON.parse(localStorage.getItem(PODCAST_CACHE_KEY) || 'null');
    return raw ? podcastSanitizeEpisodes(raw.episodes) : null;
  } catch (e) { return null; }
}
function podcastCacheWrite(eps) {
  try {
    localStorage.setItem(PODCAST_CACHE_KEY, JSON.stringify({ at: Date.now(), episodes: podcastSanitizeEpisodes(eps) || [] }));
  } catch (e) { /* sin espacio o sin localStorage: la lista vive en memoria */ }
}
function renderPodcast() {
  podcastPaintPlayer();
  if (podcastEpisodes && podcastEpisodes.length) podcastRenderList(podcastEpisodes);
  podcastLoad();
}
async function podcastLoad() {
  if (podcastLoadPromise) return podcastLoadPromise;
  const status = document.getElementById('podcast-status');
  const list = document.getElementById('podcast-list');
  if (!status || !list) return false;
  if (!podcastEpisodes) { status.hidden = false; status.textContent = t('pod_loading'); }
  podcastLoadPromise = (async () => {
    let eps = null;
    try {
      const res = await fetch(PODCAST_FEED_URL, { cache: 'no-store' });
      if (res && res.ok) eps = podcastParseFeed(await res.text());
    } catch (e) { eps = null; }
    if (eps) {
      if (eps.length) {
        podcastEpisodes = eps;
        podcastCacheWrite(eps);
        status.hidden = true;
        podcastRenderList(eps);
      } else {
        podcastEpisodes = [];
        clearNode(list);
        status.hidden = false;
        status.textContent = t('pod_empty');
      }
      return true;
    }
    const cached = podcastCacheRead();
    if (cached && cached.length) {
      podcastEpisodes = cached;
      status.hidden = false;
      status.textContent = t('pod_offline');
      podcastRenderList(cached);
      return true;
    }
    status.hidden = false;
    status.textContent = t('pod_error');
    return false;
  })();
  try { return await podcastLoadPromise; }
  finally { podcastLoadPromise = null; }
}
function podcastRenderList(eps) {
  const list = document.getElementById('podcast-list');
  if (!list) return;
  clearNode(list);
  for (const ep of eps) {
    const row = el('button', 'pod-ep');
    row.type = 'button';
    row.dataset.url = ep.url;
    row.appendChild(el('span', 'pod-ep-ico', '▶'));
    const main = el('span', 'pod-ep-main');
    main.appendChild(el('span', 'pod-ep-title', ep.title));
    const meta = [podcastDateLabel(ep.date), ep.duration].filter(Boolean).join(' · ');
    if (meta) main.appendChild(el('span', 'pod-ep-meta muted small', meta));
    row.appendChild(main);
    row.addEventListener('click', () => podcastPlayEpisode(ep));
    list.appendChild(row);
  }
  podcastMarkRow();
}
function podcastMarkRow() {
  const list = document.getElementById('podcast-list');
  if (!list) return;
  list.querySelectorAll('.pod-ep').forEach((row) => {
    const on = !!podcastCurrentUrl && row.dataset.url === podcastCurrentUrl;
    row.classList.toggle('playing', on);
    const ico = row.querySelector('.pod-ep-ico');
    if (ico) ico.textContent = on ? '♪' : '▶';
  });
}
function podcastShowAudioError() {
  const msg = document.getElementById('podcast-player-msg');
  if (msg) { msg.textContent = t('pod_audio_error'); msg.hidden = false; }
  podcastPaintPlayer();
}
function podcastHideAudioError() {
  const msg = document.getElementById('podcast-player-msg');
  if (msg) msg.hidden = true;
}
function podcastPlayEpisode(ep) {
  const a = podcastAudio();
  if (!a || !ep || !ep.url) return;
  podcastHideAudioError();
  if (podcastCurrentUrl !== ep.url) {
    podcastCurrentUrl = ep.url;
    podcastCurrentTitle = ep.title || '';
    try { a.src = ep.url; } catch (e) { /* URL inválida: lo reporta el evento error */ }
  }
  let p = null;
  try { p = a.play(); } catch (e) { podcastShowAudioError(); }
  if (p && typeof p.catch === 'function') p.catch(() => podcastShowAudioError());
  podcastPaintPlayer();
  podcastMarkRow();
}
function podcastPause() {
  const a = podcastAudio();
  if (a && !a.paused) { try { a.pause(); } catch (e) { /* sin reproductor no pasa nada */ } }
  podcastPaintPlayer();
}
function podcastToggle() {
  const a = podcastAudio();
  if (!a) return;
  if (!podcastCurrentUrl) {
    if (podcastEpisodes && podcastEpisodes.length) podcastPlayEpisode(podcastEpisodes[0]);
    return;
  }
  if (a.paused) {
    const ep = (podcastEpisodes || []).find((e) => e.url === podcastCurrentUrl)
      || { url: podcastCurrentUrl, title: podcastCurrentTitle };
    podcastPlayEpisode(ep);
  } else {
    podcastPause();
  }
}
function podcastPaintPlayer() {
  const a = podcastAudio();
  const btn = document.getElementById('podcast-toggle');
  if (!btn) return;
  const playing = !!a && !a.paused && !a.ended;
  btn.textContent = playing ? '⏸' : '▶';
  btn.setAttribute('aria-label', t(playing ? 'pod_pause_aria' : 'pod_play_aria'));
  const now = document.getElementById('podcast-now');
  if (now) now.textContent = podcastCurrentTitle || '';
  podcastPaintProgress();
}
function podcastPaintProgress() {
  const a = podcastAudio();
  if (!a) return;
  const seek = document.getElementById('podcast-seek');
  const cur = Number(a.currentTime) || 0;
  const dur = Number(a.duration) || 0;
  if (seek) seek.value = dur > 0 ? String(Math.round(cur / dur * 1000)) : '0';
  const elE = document.getElementById('podcast-elapsed');
  const elT = document.getElementById('podcast-total');
  if (elE) elE.textContent = podcastFmtClock(cur);
  if (elT) elT.textContent = dur > 0 ? podcastFmtClock(dur) : '0:00';
}
function podcastWirePlayer() {
  const btn = document.getElementById('podcast-toggle');
  const seek = document.getElementById('podcast-seek');
  const a = podcastAudio();
  if (btn) btn.addEventListener('click', podcastToggle);
  if (seek) seek.addEventListener('input', () => {
    if (!a) return;
    const dur = Number(a.duration) || 0;
    if (dur > 0) {
      try { a.currentTime = (Number(seek.value) / 1000) * dur; } catch (e) { /* sin metadatos aún */ }
      podcastPaintProgress();
    }
  });
  if (a) {
    a.addEventListener('timeupdate', podcastPaintProgress);
    a.addEventListener('loadedmetadata', podcastPaintPlayer);
    a.addEventListener('durationchange', podcastPaintProgress);
    a.addEventListener('play', podcastPaintPlayer);
    a.addEventListener('pause', podcastPaintPlayer);
    a.addEventListener('ended', podcastPaintPlayer);
    a.addEventListener('error', () => { if (podcastCurrentUrl) podcastShowAudioError(); });
  }
}

function wireEvents() {
  initPullToRefresh();
  podcastWirePlayer();
  document.getElementById('lock-form').addEventListener('submit', onLockSubmit);
  document.getElementById('onboarding-form').addEventListener('submit', onOnboardingSubmit);
  const obTourNextBtn = document.getElementById('ob-tour-next');
  if (obTourNextBtn) obTourNextBtn.addEventListener('click', obTourNext);
  const obTourSkipBtn = document.getElementById('ob-tour-skip');
  if (obTourSkipBtn) obTourSkipBtn.addEventListener('click', obTourSkip);
  /* Compilación 36: tocar el recorrido (lámina o puntos) también
     cuenta como interacción manual: pausa la rotación automática. */
  const obTourEl = document.getElementById('ob-tour');
  if (obTourEl) {
    obTourEl.addEventListener('pointerdown', obTourUserTouch);
    obTourEl.addEventListener('touchstart', obTourUserTouch, { passive: true });
  }
  const obLangSel = document.getElementById('ob-lang');
  if (obLangSel) obLangSel.addEventListener('change', (ev) => {
    db.settings.lang = validLangSetting(ev.target.value);
    save();
    applyStaticI18n();
  });
  document.getElementById('expense-form').addEventListener('submit', onExpenseSubmit);
  document.getElementById('income-form').addEventListener('submit', onIncomeSubmit);
  document.getElementById('savings-form').addEventListener('submit', onSavingsSubmit);
  document.getElementById('goal-form').addEventListener('submit', onGoalSubmit);
  document.getElementById('san-form').addEventListener('submit', onSanCreateSubmit);
  document.getElementById('category-form').addEventListener('submit', onCategorySubmit);
  document.getElementById('fixed-form').addEventListener('submit', onFixedSubmit);
  document.getElementById('account-form').addEventListener('submit', onAccountSubmit);
  document.getElementById('debt-form').addEventListener('submit', onDebtSubmit);
  document.getElementById('settings-form').addEventListener('submit', onSettingsSubmit);
  document.getElementById('pin-form').addEventListener('submit', onPinSubmit);
  /* Tarjeta «Secciones visibles» plegable: clic o Enter/espacio en la
     cabecera abre/cierra el cuerpo (cerrado por defecto). */
  const sectionsToggleEl = document.getElementById('sections-toggle');
  if (sectionsToggleEl) {
    sectionsToggleEl.addEventListener('click', toggleSectionsBody);
    sectionsToggleEl.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
        ev.preventDefault();
        toggleSectionsBody();
      }
    });
  }
  /* La casilla de huella vive en la tarjeta de Seguridad, FUERA del
     #settings-form: su valor solo llegaba a db.settings.biometric al
     pulsar «Guardar ajustes» (botón de OTRA tarjeta). Marcarla y pulsar
     «Actualizar PIN» no guardaba nada, renderSettings la volvía a
     mostrar desmarcada y el bloqueo salía en silencio con la huella
     desactivada (así le pasó a Sterlin en su teléfono, 23-oct-2026).
     Ahora se guarda al instante al tocarla, como el tema y el color;
     onSettingsSubmit la sigue leyendo del DOM y no se rompe.
     Activarla sin PIN no tiene sentido (sin PIN no hay bloqueo): se
     avisa con el mismo mensaje de siempre y no se guarda. */
  document.getElementById('set-biometric').addEventListener('change', (ev) => {
    const cb = ev.target;
    if (cb.checked && !db.settings.pinHash) {
      window.alert(t('bio_need_pin'));
      cb.checked = false;
      return;
    }
    db.settings.biometric = cb.checked === true;
    save();
  });
  /* Botones de la oferta guiada de huella (al crear/actualizar el PIN). */
  document.getElementById('bio-offer-yes').addEventListener('click', onBioOfferYes);
  document.getElementById('bio-offer-no').addEventListener('click', onBioOfferNo);
  document.getElementById('challenge-form').addEventListener('submit', onChallengeSubmit);

  /* Tema y color: se aplican al instante al cambiar el selector. */
  document.getElementById('set-theme').addEventListener('change', (ev) => {
    const v = ev.target.value;
    if (v === 'claro' || v === 'oscuro' || v === 'auto') { db.settings.theme = v; save(); applyTheme(); }
  });
  document.getElementById('set-accent').addEventListener('change', (ev) => {
    const v = ev.target.value;
    if (['verde', 'azul', 'morado', 'naranja'].includes(v)) { db.settings.accent = v; save(); applyTheme(); }
  });

  /* Botón flotante + : selector rápido Gasto / Ingreso / Ahorro. */
  const chooser = document.getElementById('quick-chooser');
  const closeChooser = () => { chooser.hidden = true; };
  document.getElementById('fab-add').addEventListener('click', () => { chooser.hidden = false; });
  document.getElementById('quick-cancel').addEventListener('click', closeChooser);
  document.getElementById('quick-expense').addEventListener('click', () => { closeChooser(); showView('gastos'); });
  document.getElementById('quick-income').addEventListener('click', () => { closeChooser(); showView('ingresos'); });
  document.getElementById('quick-savings').addEventListener('click', () => { closeChooser(); showView('ahorros'); });
  chooser.addEventListener('click', (ev) => { if (ev.target === chooser) closeChooser(); });

  document.getElementById('undo-btn').addEventListener('click', onUndo);

  /* Foto de recibo: elegir, quitar y ver en grande. */
  document.getElementById('exp-photo').addEventListener('change', (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    processReceiptFile(file, (url) => { if (url) { setExpensePhoto(url); tryReceiptOCR(url); } });
  });
  document.getElementById('exp-photo-remove').addEventListener('click', () => setExpensePhoto(null));
  document.getElementById('photo-overlay-close').addEventListener('click', () => {
    document.getElementById('photo-overlay').hidden = true;
  });
  document.getElementById('photo-overlay').addEventListener('click', (ev) => {
    if (ev.target === ev.currentTarget) document.getElementById('photo-overlay').hidden = true;
  });

  /* Buscador de movimientos. */
  document.getElementById('search-text').addEventListener('input', renderSearch);
  document.getElementById('search-month').addEventListener('change', renderSearch);
  document.getElementById('search-type').addEventListener('change', renderSearch);

  /* Calculadora de deudas e informe en imagen. */
  document.getElementById('calc-run').addEventListener('click', renderCalc);
  document.getElementById('btn-report-png').addEventListener('click', downloadReportPng);
  document.getElementById('btn-report-share-img').addEventListener('click', shareReportPng);

  document.querySelectorAll('[data-nav="home"]').forEach((b) =>
    b.addEventListener('click', () => showView('home')));
  /* Accesos rápidos de Inicio: tocar un resumen abre su sección. */
  document.getElementById('tile-available').addEventListener('click', () => showView('cuentas'));
  document.getElementById('tile-savings').addEventListener('click', () => showView('ahorros'));
  document.getElementById('tile-debts').addEventListener('click', () => showView('deudas'));
  document.getElementById('tile-incomes').addEventListener('click', () => showView('ingresos'));
  document.getElementById('tile-expenses').addEventListener('click', () => showView('gastos'));
  document.getElementById('btn-lock-now').addEventListener('click', showLock);
  document.getElementById('btn-menu').addEventListener('click', openMenu);
  document.getElementById('btn-cloud-signin').addEventListener('click', onCloudSignIn);
  document.getElementById('btn-cloud-signup').addEventListener('click', onCloudSignUp);
  document.getElementById('btn-cloud-signout').addEventListener('click', onCloudSignOut);
  document.getElementById('btn-cloud-sync').addEventListener('click', onCloudSyncNow);
  document.getElementById('btn-cloud-wipe').addEventListener('click', onCloudWipe);
  document.getElementById('btn-cloud-delete').addEventListener('click', onCloudDeleteAccount);
  document.getElementById('btn-privacy').addEventListener('click', togglePrivacy);
  document.getElementById('exp-voice').addEventListener('click', () => startVoice('expense'));
  document.getElementById('inc-voice').addEventListener('click', () => startVoice('income'));
  document.getElementById('remittance-form').addEventListener('submit', onRemittanceSubmit);
  document.getElementById('rem-currency').addEventListener('change', onRemCurrencyChange);
  /* Importar CSV del banco: elegir archivo, marcar/desmarcar, aplicar. */
  document.getElementById('csv-file').addEventListener('change', onCsvFile);
  document.getElementById('csv-all').addEventListener('click', () => { for (const r of csvPending) r.include = true; renderCsvPreview(); });
  document.getElementById('csv-none').addEventListener('click', () => { for (const r of csvPending) r.include = false; renderCsvPreview(); });
  document.getElementById('csv-apply').addEventListener('click', onCsvApply);
  document.getElementById('csv-cancel').addEventListener('click', onCsvCancel);
  /* Presupuesto compartido (vista previa con capa simulada). */
  document.getElementById('btn-shared-create').addEventListener('click', onSharedCreate);
  document.getElementById('btn-shared-join').addEventListener('click', onSharedJoin);
  document.getElementById('btn-shared-leave').addEventListener('click', onSharedLeave);
  document.getElementById('btn-pro-open').addEventListener('click', showProPaywall);
  document.getElementById('pro-close').addEventListener('click', hideProPaywall);
  document.getElementById('pro-waitlist-btn').addEventListener('click', onProWaitlist);
  document.getElementById('pro-paywall').addEventListener('click', (ev) => { if (ev.target === ev.currentTarget) hideProPaywall(); });
  document.getElementById('btn-org-pro').addEventListener('click', showProPaywall);
  document.getElementById('btn-adv-open').addEventListener('click', onAdvOpen);
  document.getElementById('btn-adv-csv').addEventListener('click', onAdvCsv);
  document.getElementById('org-form').addEventListener('submit', onSanOrgCreateSubmit);
  document.getElementById('org-add-participant').addEventListener('click', onSanOrgAddParticipant);
  document.getElementById('org-delete').addEventListener('click', onSanOrgDelete);
  const orgShuffleBtn = document.getElementById('org-shuffle');
  if (orgShuffleBtn) orgShuffleBtn.addEventListener('click', onOrgShuffleDraft);
  const orgShuffleActiveBtn = document.getElementById('org-shuffle-active');
  if (orgShuffleActiveBtn) orgShuffleActiveBtn.addEventListener('click', onOrgShuffleActive);
  const orgStartBtn = document.getElementById('org-start-btn');
  if (orgStartBtn) orgStartBtn.addEventListener('click', onSanOrgStart);
  const orgReminderBtn = document.getElementById('org-reminder');
  if (orgReminderBtn) orgReminderBtn.addEventListener('click', onOrgReminder);
  const orgLinkPubBtn = document.getElementById('org-link-publish');
  if (orgLinkPubBtn) orgLinkPubBtn.addEventListener('click', onOrgLinkPublish);
  const orgLinkCopyBtn = document.getElementById('org-link-copy');
  if (orgLinkCopyBtn) orgLinkCopyBtn.addEventListener('click', onOrgLinkCopy);
  const orgCompSel = document.getElementById('org-comp');
  if (orgCompSel) orgCompSel.addEventListener('change', updateOrgSim);
  const orgPenSel = document.getElementById('org-penalty');
  if (orgPenSel) orgPenSel.addEventListener('change', updateOrgSim);
  const orgAmtInput = document.getElementById('org-amount');
  if (orgAmtInput) orgAmtInput.addEventListener('input', updateOrgSim);
  const orgCompAmtInput = document.getElementById('org-comp-amount');
  if (orgCompAmtInput) orgCompAmtInput.addEventListener('input', updateOrgSim);
  const orgReceiptFile = document.getElementById('org-receipt-file');
  if (orgReceiptFile) orgReceiptFile.addEventListener('change', (ev) => {
    const file = ev.target.files && ev.target.files[0];
    const tgt = orgReceiptTarget;
    orgReceiptTarget = null;
    ev.target.value = '';
    if (!file || !tgt || !db.sanOrg) return;
    processReceiptFile(file, (url) => {
      if (!url || !db.sanOrg || !db.sanOrg.rounds[tgt.round]) return;
      const org = db.sanOrg;
      const cur = orgPayStatus(org, tgt.round, tgt.name);
      const keep = cur === 'confirmed' ? 'confirmed' : 'reported';
      if (!org.rounds[tgt.round].info) org.rounds[tgt.round].info = {};
      org.rounds[tgt.round].info[tgt.name] = { st: keep, photo: url };
      if (keep === 'confirmed') org.rounds[tgt.round].paid[tgt.name] = true;
      else delete org.rounds[tgt.round].paid[tgt.name];
      save(); renderSanOrg(); orgMaybeRepublish();
    });
  });
  document.getElementById('btn-share-org').addEventListener('click', onShareSanOrg);
  document.getElementById('btn-share-org-img').addEventListener('click', shareSanOrgPng);
  document.getElementById('goal2-form').addEventListener('submit', onGoal2Submit);
  document.getElementById('goal2-cancel-edit').addEventListener('click', () => { resetGoal2Form(); });
  document.getElementById('btn-menu-close').addEventListener('click', closeMenu);
  document.getElementById('menu-backdrop').addEventListener('click', closeMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  document.getElementById('btn-export').addEventListener('click', onExport);
  document.getElementById('btn-export-enc').addEventListener('click', onExportEncrypted);
  document.getElementById('btn-biometric').addEventListener('click', tryBiometric);
  document.getElementById('btn-share-report').addEventListener('click', onShareReport);
  document.getElementById('btn-share-san').addEventListener('click', onShareSan);
  document.getElementById('btn-reset').addEventListener('click', onReset);
  document.getElementById('file-import').addEventListener('change', onImportFile);

  document.getElementById('exp-prev').addEventListener('click', () => { expMonth = shiftMonth(expMonth, -1); renderExpenses(); });
  document.getElementById('exp-next').addEventListener('click', () => { expMonth = shiftMonth(expMonth, 1); renderExpenses(); });
  document.getElementById('exp-cancel-edit').addEventListener('click', resetExpenseForm);
  document.getElementById('inc-cancel-edit').addEventListener('click', resetIncomeForm);
  document.getElementById('goal-cancel-edit').addEventListener('click', () => { resetGoalForm(); renderGoal(); });
  document.getElementById('res-prev').addEventListener('click', () => { chartMonth = shiftMonth(chartMonth, -1); renderResumen(); });
  document.getElementById('res-next').addEventListener('click', () => { chartMonth = shiftMonth(chartMonth, 1); renderResumen(); });
  document.getElementById('san-add-participant').addEventListener('click', onSanAddParticipant);
  document.getElementById('san-advance').addEventListener('click', onSanAdvance);
  document.getElementById('san-delete').addEventListener('click', onSanDelete);
  document.getElementById('san-new').addEventListener('click', onSanNew);
  /* Cambio de idioma en vivo: guarda, traduce lo estático y re-renderiza
     la vista actual sin perder datos. */
  document.getElementById('set-lang').addEventListener('change', (ev) => {
    db.settings.lang = validLangSetting(ev.target.value);
    save();
    applyStaticI18n();
    showView(currentView);
  });
  document.getElementById('fix-cancel-edit').addEventListener('click', resetFixedForm);
  document.getElementById('acc-cancel-edit').addEventListener('click', resetAccountForm);
  document.getElementById('debt-cancel-edit').addEventListener('click', resetDebtForm);
  document.getElementById('inc-amount').addEventListener('input', updateSplitPreview);
  document.getElementById('inc-savings').addEventListener('input', () => { incSavingsTouched = true; });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (db && db.settings.pinHash && hiddenAt && Date.now() - hiddenAt > 60000 &&
        !document.getElementById('app-shell').hidden) {
      showLock();
    }
    hiddenAt = 0;
    /* Si se volvió a la app desde el botón «+» de un widget, aquí se
       abre el formulario de gasto (si hay bloqueo, lo hará enterApp). */
    checkWidgetPendingAction();
  });
}

function init() {
  load();
  /* Compilación 32: precedencia total del enlace público del san.
     Si la URL trae #san= (aunque el token venga truncado o con
     caracteres de más), el arranque va DIRECTO al visor público de
     solo lectura: sin bienvenida, sin nombre, sin PIN y sin exigir
     datos locales. Un token inválido muestra el mensaje amable del
     visor («no disponible»), nunca la bienvenida. */
  if ((location.hash || '').indexOf('#san=') === 0) {
    const mSan = /^#san=([A-Za-z0-9]+)$/.exec(location.hash || '');
    applyTextSize();
    applyStaticI18n();
    initSanPublic(mSan ? mSan[1] : null);
    return;
  }
  if (db && db.settings && !db.settings.summaryTz) {
    try { db.settings.summaryTz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* sin zona detectable */ }
  }
  applyTheme();
  /* Compilación 28: el tamaño del texto se aplica desde el arranque,
     también en la pantalla de bloqueo y la bienvenida (antes solo se
     aplicaba al entrar). El tamaño no revela ningún dato. */
  applyTextSize();
  wireEvents();
  resetExpenseForm();
  resetIncomeForm();
  resetSavingsForm();
  resetGoalForm();
  resetSanForm();
  resetSanOrgForm();
  applyStaticI18n();
  resetFixedForm();
  resetAccountForm();
  resetDebtForm();
  if (!db.settings.onboarded) {
    document.getElementById('app-shell').hidden = true;
    document.getElementById('view-lock').hidden = true;
    document.getElementById('view-onboarding').hidden = false;
    renderObTour();
    obTourAutoStart();
    const obLangBoot = document.getElementById('ob-lang');
    if (obLangBoot) obLangBoot.value = db.settings.lang || 'auto';
    return;
  }
  if (db.settings.pinHash) { showLock(); return; }
  enterApp();
}

init();
/* Compilación 31: el botón/gesto de atrás navega dentro de la app
   (sin plugin, en web, no hace nada). */
initHardwareBack();
/* La nube se reconcilia justo después del primer pintado, para no
   competir con la apertura (Compilación 28); mientras tanto la app
   funciona local, como siempre. */
afterFirstPaint(() => { if (!SAN_PUBLIC_MODE) cloudBoot(); });

/* PETO Pro: refresco perezoso del estado de facturación al arrancar.
   PetoBilling.refresh() no hace nada si el puente nativo de compras
   no está presente (web, prueba o compilaciones sin el plugin), y si
   la tienda no responde deja intacto el estado Pro guardado. */
if (!SAN_PUBLIC_MODE) PetoBilling.refresh().catch(() => { /* sin tienda, la app sigue igual */ });

/* PWA: el service worker solo cachea los archivos de la propia app. */
/* --- Service worker SOLO en web; en la app nativa es un peligro ---
   Diagnóstico (23-oct-2026): el APK con el arreglo de la huella (corrida
   #14) llegó bien a Sterlin y él reportó «sigue sin funcionar». Dentro
   del WebView de Capacitor este bloque registraba el SW SIN condición y
   www/sw.js servía cache-first (caches.match antes que la red) con el
   CACHE_NAME sin cambiar desde el paquete 1. Resultado: el SW instalado
   por versiones anteriores podía seguir sirviendo el app.js VIEJO (con
   el nombre de plugin equivocado) aunque el APK nuevo ya trajera el
   arreglo — el código nuevo ni siquiera llegaba a correr.
   Corrección: en plataforma nativa NO se registra el SW (los archivos
   ya vienen dentro del APK; no hace falta caché web) y al arrancar se
   limpia lo viejo: se desregistra cualquier SW existente y se borran
   TODAS las cachés. Es best-effort (try/catch, sin await que bloquee el
   arranque) y no toca los datos de la app: localStorage queda intacto.
   En web (no nativo) se registra como siempre. */
async function cleanupNativeServiceWorker() {
  try {
    if ('serviceWorker' in navigator && navigator.serviceWorker.getRegistrations) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => {
        try { return Promise.resolve(r.unregister()).catch(() => false); }
        catch (e) { return false; }
      }));
    }
  } catch (e) { /* limpieza best-effort: si falla, la app sigue igual */ }
  try {
    if (window.caches && caches.keys) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => {
        try { return Promise.resolve(caches.delete(k)).catch(() => false); }
        catch (e) { return false; }
      }));
    }
  } catch (e) { /* limpieza best-effort: si falla, la app sigue igual */ }
}
if (bioIsNative()) {
  cleanupNativeServiceWorker();
} else if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* sin SW la app igual funciona */ });
  });
}
