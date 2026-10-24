/* === PETO WEB (carpeta web-app/) ===
   Copia de app.js (raíz, Compilación 21) con textos adaptados a la
   web (cuenta en la nube y sincronización en vez de «solo en tu
   teléfono»: claves footer, set_data_help, lock_note, ob_intro_2 y
   ob_intro_3 en ES/EN/IT). La lógica es la misma; lo específico de
   navegador vive en web.js y web.css. Al actualizar la app hay que
   re-copiar y re-aplicar estos textos (ver LEEME.md).
   Sincronizado el 23-oct-2026 con la Compilación 21: Fases 1, 3 y 4,
   presupuesto compartido real (SHARED_LIVE) y borrado de cuenta. */
/* ============================================================
   PETO v0.1
   - 100% local: sin red, sin cuentas, sin rastreadores, sin SDKs.
   - Los datos viven solo en localStorage de este dispositivo.
   - Todo texto del usuario se pinta con textContent (sin innerHTML),
     y toda entrada se valida y se limita antes de guardarse.
   ============================================================ */
'use strict';

/* ---------------- Constantes ---------------- */
const DB_KEY = 'cgastos.db.v1';
const BUILD_LABEL = 'Compilación 21'; // marca visible de diagnóstico (bloqueo y Ajustes): confirma qué código corre el teléfono
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
  { id: 'san',         group: 'accounts', icon: '🤝' }
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
      lang: 'es',
      payday: null,
      reminders: true,
      theme: 'claro',
      accent: 'verde',
      autoFixed: true,
      notifications: false,
      biometric: false,
      pro: false,
      proWaitlist: false,
      challengeTargetCents: 2000,
      split: { ahorro: 25, negocio: 10, gastos: 55, familia: 10 },
      sections: { gastos: true, ingresos: true, ahorros: true, buscar: true, resumen: true, presupuesto: true, pagos: true, cuentas: true, deudas: true, san: true },
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
    const src = srcRounds[i];
    if (src && typeof src === 'object' && src.paid && typeof src.paid === 'object') {
      for (const p of participants) if (src.paid[p] === true) paid[p] = true;
    }
    return { paid: paid };
  });
  return { name: name, aporteCents: aporte, frequency: frequency, startDate: startDate, participants: participants, rounds: rounds };
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
  d.settings.lang = (s.lang === 'en' || s.lang === 'it') ? s.lang : 'es';
  d.settings.payday = (typeof s.payday === 'number' && Number.isFinite(s.payday) &&
    Math.trunc(s.payday) >= 0 && Math.trunc(s.payday) <= 6) ? Math.trunc(s.payday) : null;
  d.settings.reminders = s.reminders !== false;
  d.settings.autoFixed = s.autoFixed !== false;
  d.settings.notifications = s.notifications === true;
  d.settings.biometric = s.biometric === true;
  d.settings.pro = s.pro === true;
  d.settings.proWaitlist = s.proWaitlist === true;
  d.settings.theme = (s.theme === 'oscuro' || s.theme === 'auto') ? s.theme : 'claro';
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
    date: cleanDate(x.date), note: cleanText(x.note, 120)
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
  return d;
}

/* ---------------- Utilidades ---------------- */
/* ---------------- Idioma (ES/EN/IT) ----------------
   Todo texto visible pasa por t() o por data-i18n en el HTML. Los datos
   guardados (categorías, nombres) nunca se traducen: solo la interfaz. */
const I18N = {
es: {
  app_title: 'PETO Finanzas', back: '← Todas las opciones', greeting: 'Hola', lock_btn: 'Bloquear',
  home_menu_heading: '¿Qué quieres ver?',
  group_daily: 'Día a día', group_plan: 'Planificación', group_accounts: 'Cuentas y compromisos', group_yourapp: 'Tu app',
  sec_gastos: 'Gastos del mes', sec_ingresos: 'Ingresos semanales', sec_ahorros: 'Ahorros', sec_resumen: 'Resumen',
  sec_presupuesto: 'Presupuesto por categoría', sec_pagos: 'Pagos fijos', sec_cuentas: 'Mis cuentas',
  sec_deudas: 'Mis deudas', sec_san: 'Mi san', sec_ajustes: 'Ajustes y personalización',
  menu_open_aria: 'Abrir menú', menu_close_aria: 'Cerrar menú', sec_home: 'Inicio', key_home: 'Tu pantalla principal',
  set_notif_label: 'Notificaciones con la app cerrada', set_notif_help: 'Avisos de tus pagos fijos un día antes y el mismo día, aunque PETO esté cerrada.',
  set_autofixed_label: 'Registrar pagos fijos automáticamente', set_autofixed_help: 'Al vencer un pago fijo, el gasto se anota solo. Puedes deshacerlo al momento.',
  set_bio_label: 'Desbloqueo con huella', set_bio_help: 'Entra con tu huella además del PIN (necesitas tener un PIN activo).',
  bio_btn: '👆 Entrar con huella', bio_reason: 'Confirma que eres tú para abrir PETO',
  bio_need_pin: 'La huella necesita un PIN activo: crea tu PIN en Ajustes → Seguridad y luego la huella funcionará al abrir la app.',
  bio_failed: 'La huella no se pudo verificar. Escribe tu PIN.',
  bio_unavailable: 'La huella no está disponible en este teléfono. Escribe tu PIN.',
  bio_not_enrolled: 'Este teléfono no tiene ninguna huella registrada. Regístrala en los ajustes del teléfono o escribe tu PIN.',
  bio_offer_title: '¿Desbloquear con tu huella?',
  bio_offer_text: 'Acabas de crear tu PIN. Si quieres, puedes entrar a PETO con tu huella en vez de escribir el PIN cada vez. ¿Lo activamos ahora?',
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
  share_report_title: 'Mi resumen PETO',
  notif_fixed_title: 'Pago fijo mañana', notif_fixed_today: 'Pago fijo hoy', notif_fixed_body: '{name} · {amount}',
  notif_weekly_title: 'Tu semana en PETO', notif_weekly_body: 'Anota tus gastos e ingresos de la semana para no perder el hilo.',
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
  cloud_delete_confirm1: '¿Eliminar tu cuenta de PETO? Se borra tu cuenta, tu copia de datos en la nube y los hogares compartidos que sean tuyos. Los datos de ESTE teléfono se quedan aquí, sin borrarse (puedes borrarlos en Ajustes). No se puede deshacer.',
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
  textsize_normal: 'Normal', textsize_large: 'Grande', set_lang_label: 'Idioma / Language',
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
  data_err_big: 'Ese archivo es demasiado grande.', data_err_invalid: 'No se pudo importar: el archivo no es una copia válida de PETO.',
  import_confirm: 'Importar reemplazará TODOS los datos actuales de la app. ¿Seguro?', import_done: 'Copia importada. ✅',
  reset_confirm1: 'Esto borra TODOS tus datos de la app en este teléfono. No se puede deshacer. ¿Seguro?',
  reset_confirm2: 'Última confirmación: ¿borrar todo y empezar de cero?',
  lock_prompt: 'Escribe tu PIN para entrar.', lock_pin_label: 'PIN', lock_enter: 'Entrar',
  lock_note: 'Tus datos están protegidos con tu PIN.', lock_err: 'PIN incorrecto. Inténtalo de nuevo.',
  ob_title: '¡Bienvenido a PETO!',
  ob_intro_1: 'Organiza tu dinero en minutos: gastos, ingresos, presupuesto, cuentas y deudas.',
  ob_intro_2: 'Con tu cuenta en la nube.', ob_intro_3: 'Tus datos se sincronizan con tu teléfono.',
  ob_name_label: '¿Cómo te llamas?', ob_name_ph: 'Tu nombre',
  ob_pin_label: 'Crea un PIN de seguridad (opcional)', ob_pin_ph: '4 a 6 números, o déjalo vacío',
  ob_pin2_label: 'Repite el PIN', ob_pin2_ph: 'Repite el PIN', ob_start: 'Empezar',
  ob_note: 'Podrás cambiar el PIN cuando quieras en Ajustes.',
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
  chal_target_label: 'Meta semanal de ahorro ($)', chal_save: 'Guardar meta semanal',
  rep_title: 'Informe del mes', rep_download: 'Descargar imagen', rep_share_image: 'Compartir imagen',
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
  pro_status_active: 'Tienes PETO Pro activo. ¡Gracias por apoyar PETO! ⭐',
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
  shared_joined_live: 'Te uniste al hogar ✅'
},
en: {
  app_title: 'PETO Finanzas', back: '← All options', greeting: 'Hello', lock_btn: 'Lock',
  home_menu_heading: 'What do you want to see?',
  group_daily: 'Day to day', group_plan: 'Planning', group_accounts: 'Accounts & commitments', group_yourapp: 'Your app',
  sec_gastos: 'Monthly expenses', sec_ingresos: 'Weekly income', sec_ahorros: 'Savings', sec_resumen: 'Summary',
  sec_presupuesto: 'Budget by category', sec_pagos: 'Fixed payments', sec_cuentas: 'My accounts',
  sec_deudas: 'My debts', sec_san: 'My san (tanda)', sec_ajustes: 'Settings & personalization',
  menu_open_aria: 'Open menu', menu_close_aria: 'Close menu', sec_home: 'Home', key_home: 'Your main screen',
  set_notif_label: 'Notifications when the app is closed', set_notif_help: 'Alerts for your fixed payments the day before and on the day, even when PETO is closed.',
  set_autofixed_label: 'Record fixed payments automatically', set_autofixed_help: 'When a fixed payment is due, the expense is recorded for you. You can undo it right away.',
  set_bio_label: 'Fingerprint unlock', set_bio_help: 'Unlock with your fingerprint as well as your PIN (an active PIN is required).',
  bio_btn: '👆 Unlock with fingerprint', bio_reason: 'Confirm it is you to open PETO',
  bio_need_pin: 'Fingerprint unlock needs an active PIN: create your PIN in Settings → Security and fingerprint will work when you open the app.',
  bio_failed: 'Fingerprint could not be verified. Type your PIN.',
  bio_unavailable: 'Fingerprint is not available on this phone. Type your PIN.',
  bio_not_enrolled: 'This phone has no fingerprint enrolled. Enroll one in the phone settings or type your PIN.',
  bio_offer_title: 'Unlock with your fingerprint?',
  bio_offer_text: 'You just created your PIN. If you want, you can open PETO with your fingerprint instead of typing your PIN every time. Turn it on now?',
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
  share_report_title: 'My PETO summary',
  notif_fixed_title: 'Fixed payment tomorrow', notif_fixed_today: 'Fixed payment today', notif_fixed_body: '{name} · {amount}',
  notif_weekly_title: 'Your week in PETO', notif_weekly_body: 'Log this week’s expenses and income to stay on track.',
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
  cloud_delete_confirm1: 'Delete your PETO account? This deletes your account, your copy of the data in the cloud and the shared households you own. The data on THIS phone stays here, untouched (you can erase it in Settings). This cannot be undone.',
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
  textsize_normal: 'Normal', textsize_large: 'Large', set_lang_label: 'Language / Idioma',
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
  data_err_big: 'That file is too large.', data_err_invalid: 'Could not import: the file is not a valid PETO backup.',
  import_confirm: 'Importing will replace ALL current app data. Are you sure?', import_done: 'Backup imported. ✅',
  reset_confirm1: 'This deletes ALL your app data on this phone. It cannot be undone. Are you sure?',
  reset_confirm2: 'Final confirmation: delete everything and start over?',
  lock_prompt: 'Enter your PIN to continue.', lock_pin_label: 'PIN', lock_enter: 'Unlock',
  lock_note: 'Your data is protected with your PIN.', lock_err: 'Incorrect PIN. Try again.',
  ob_title: 'Welcome to PETO!',
  ob_intro_1: 'Organize your money in minutes: expenses, income, budget, accounts and debts.',
  ob_intro_2: 'With your cloud account.', ob_intro_3: 'Your data syncs with your phone.',
  ob_name_label: 'What is your name?', ob_name_ph: 'Your name',
  ob_pin_label: 'Create a security PIN (optional)', ob_pin_ph: '4 to 6 digits, or leave it empty',
  ob_pin2_label: 'Repeat the PIN', ob_pin2_ph: 'Repeat the PIN', ob_start: 'Get started',
  ob_note: 'You can change the PIN anytime in Settings.',
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
  chal_target_label: 'Weekly savings target ($)', chal_save: 'Save weekly target',
  rep_title: 'Monthly report', rep_download: 'Download image', rep_share_image: 'Share image',
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
  pro_status_active: 'PETO Pro is active. Thanks for supporting PETO! ⭐',
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
  shared_joined_live: 'You joined the household ✅'
},
it: {
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
  set_notif_help: 'Avvisi dei tuoi pagamenti fissi un giorno prima e lo stesso giorno, anche se PETO è chiusa.',
  set_autofixed_label: 'Registra i pagamenti fissi automaticamente',
  set_autofixed_help: 'Quando un pagamento fisso scade, la spesa si registra da sola. Puoi annullarla subito.',
  set_bio_label: 'Sblocca con l’impronta digitale',
  set_bio_help: 'Entra con la tua impronta digitale oltre al PIN (devi avere un PIN attivo).',
  bio_btn: '👆 Entra con l’impronta digitale',
  bio_reason: 'Conferma che sei tu per aprire PETO',
  bio_need_pin: 'L’impronta ha bisogno di un PIN attivo: crea il tuo PIN in Impostazioni → Sicurezza e poi l’impronta funzionerà all’apertura dell’app.',
  bio_failed: 'Non è stato possibile verificare l’impronta. Inserisci il PIN.',
  bio_unavailable: 'L’impronta non è disponibile su questo telefono. Inserisci il PIN.',
  bio_not_enrolled: 'Questo telefono non ha nessuna impronta registrata. Registrala nelle impostazioni del telefono o inserisci il PIN.',
  bio_offer_title: 'Sbloccare con l’impronta digitale?',
  bio_offer_text: 'Hai appena creato il tuo PIN. Se vuoi, puoi entrare in PETO con l’impronta invece di digitare il PIN ogni volta. Lo attiviamo ora?',
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
  share_report_title: 'Il mio riepilogo PETO',
  notif_fixed_title: 'Pagamento fisso domani',
  notif_fixed_today: 'Pagamento fisso oggi',
  notif_fixed_body: '{name} · {amount}',
  notif_weekly_title: 'La tua settimana su PETO',
  notif_weekly_body: 'Registra le spese e le entrate della settimana per non perdere il filo.',
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
  ins_pace_down: 'Stai andando più tranquillo: il tuo ritmo di spesa è sceso del {pct}% rispetto al mese scorso.',
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
  biz_label: 'È della mia attività',
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
  cloud_never: 'Non è stato ancora sincronizzato.',
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
  cloud_delete_confirm1: 'Eliminare il tuo account PETO? Si eliminano il tuo account, la tua copia dei dati nel cloud e le case condivise create da te. I dati di QUESTO telefono restano qui, senza essere eliminati (puoi cancellarli in Impostazioni). Non si può annullare.',
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
  spend_left: 'Ti restano {amount} per i {days} giorni che mancano del mese.',
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
  sav_empty: 'Non hai ancora risparmi annotati.\nAggiungine uno con il modulo qui sopra, oppure annota il risparmio di un’entrata quando la registri e apparirà qui. 🌱',
  sav_from_title: 'Risparmio del {date}',
  sav_from_sub: 'Da un’entrata di {amount}',
  sav_manual_title: 'Risparmio aggiunto',
  sav_manual_sub: 'Manuale · aggiunto il {date}',
  sav_delete_income_confirm: 'Eliminare questo risparmio di {amount} del {date}? Si elimina solo questo importo di risparmio: l’entrata di {income} resta uguale.',
  sav_delete_manual_confirm: 'Eliminare questo risparmio di {amount} del {date}? È un risparmio che hai aggiunto a mano in Risparmi; si elimina solo questa voce.',
  err_limit_savings: 'Hai raggiunto il limite di risparmi salvati.',
  goal_prompt: 'Per cosa stai risparmiando?',
  goal_prompt_sub: 'Crea un obiettivo e guarda come il tuo risparmio si avvicina a esso.',
  goal_form_create: 'Crea obiettivo',
  goal_form_edit: 'Modifica obiettivo',
  goal_name_label: 'Nome dell’obiettivo',
  goal_name_ph: 'Es.: Fondo di emergenza',
  goal_target_label: 'Importo obiettivo ($)',
  goal_create_btn: 'Crea obiettivo',
  goal_save_btn: 'Salva obiettivo',
  goal_progress: 'Hai {have} di {target}',
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
  fix_mark: 'Segna pagato',
  fix_unmark: 'Togli il segno',
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
  debt_mark_paid: 'Segna pagato',
  debt_mark_pending: 'Segna in sospeso',
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
  san_advance: 'Segna settimana completa',
  san_delete: 'Elimina san',
  san_delete_confirm: 'Eliminare il san "{name}"? Si elimina il suo registro di settimane e pagamenti.',
  san_new_btn: 'Crea un nuovo san',
  san_new_confirm: 'Il san attuale è già terminato. Eliminarlo e crearne uno nuovo?',
  set_profile: 'Il tuo profilo',
  set_name_label: 'Il tuo nome',
  set_textsize_label: 'Dimensione del testo',
  textsize_normal: 'Normale',
  textsize_large: 'Grande',
  set_lang_label: 'Lingua / Language',
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
  set_split_help: 'I quattro numeri devono sommare 100. Queste percentuali sono solo un suggerimento su come ripartire le tue entrate: il risparmio non si salva mai da solo, sei sempre tu a scrivere quanto hai risparmiato davvero da ogni entrata.',
  split_ahorro: 'Risparmio',
  split_negocio: 'Attività',
  split_gastos: 'Spese',
  split_familia: 'Famiglia',
  set_save: 'Salva impostazioni',
  set_err_sum: 'Le percentuali devono sommare 100. Ora sommano {total}.',
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
  pin_err_format: 'Il PIN nuovo deve avere da 4 a 6 numeri.',
  pin_off: 'PIN disattivato.',
  pin_updated: 'PIN aggiornato. ✅',
  set_data_title: 'I tuoi dati',
  set_data_help: 'I tuoi dati si salvano in questo browser e, se accedi con il tuo account, anche nel cloud. Esporta una copia se vuoi conservarla altrove.',
  data_export: 'Esporta copia (JSON)',
  data_import: 'Importa copia',
  data_reset: 'Elimina tutti i dati',
  data_err_big: 'Quel file è troppo grande.',
  data_err_invalid: 'Non è stato possibile importare: il file non è una copia valida di PETO.',
  import_confirm: 'L’importazione sostituirà TUTTI i dati attuali dell’app. Sei sicuro?',
  import_done: 'Copia importata. ✅',
  reset_confirm1: 'Questo elimina TUTTI i tuoi dati dell’app su questo telefono. Non si può annullare. Sei sicuro?',
  reset_confirm2: 'Ultima conferma: eliminare tutto e ricominciare da zero?',
  lock_prompt: 'Inserisci il tuo PIN per entrare.',
  lock_pin_label: 'PIN',
  lock_enter: 'Entra',
  lock_note: 'I tuoi dati sono protetti con il tuo PIN.',
  lock_err: 'PIN errato. Riprova.',
  ob_title: 'Benvenuto in PETO!',
  ob_intro_1: 'Organizza i tuoi soldi in pochi minuti: spese, entrate, budget, conti e debiti.',
  ob_intro_2: 'Con il tuo account nel cloud.',
  ob_intro_3: 'I tuoi dati si sincronizzano con il tuo telefono.',
  ob_name_label: 'Come ti chiami?',
  ob_name_ph: 'Il tuo nome',
  ob_pin_label: 'Crea un PIN di sicurezza (facoltativo)',
  ob_pin_ph: 'Da 4 a 6 numeri, o lascialo vuoto',
  ob_pin2_label: 'Ripeti il PIN',
  ob_pin2_ph: 'Ripeti il PIN',
  ob_start: 'Inizia',
  ob_note: 'Potrai cambiare il PIN quando vuoi nelle Impostazioni.',
  ob_err_name: 'Scrivi il tuo nome per iniziare.',
  ob_err_pin_format: 'Il PIN deve avere da 4 a 6 numeri.',
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
  fab_aria: 'Aggiungi veloce',
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
  chal_target_label: 'Obiettivo settimanale di risparmio ($)',
  chal_save: 'Salva obiettivo settimanale',
  rep_title: 'Resoconto del mese',
  rep_download: 'Scarica immagine',
  rep_share_image: 'Condividi immagine',
  rep_income: 'Entrate',
  rep_expenses: 'Spese',
  rep_savings: 'Risparmi',
  rep_top_cat: 'Categoria maggiore',
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
  pro_status_active: 'Hai PETO Pro attivo. Grazie per sostenere PETO! ⭐',
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
  pro_waitlist_done: 'Sei già in lista ✅ Ti avviseremo quando Pro sarà disponibile.',
  pro_close: 'Non ora',
  pro_tag: 'PRO',
  adv_title: 'Resoconto avanzato',
  adv_note: 'Funzione di PETO Pro: questo mese contro il precedente, tutte le categorie ed esportazione del mese in CSV.',
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
  org_pending_list: 'In attesa: {names}',
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
  shared_created_live: 'Casa creata ✅ Condividi il codice per invitare la tua casa.',
  shared_joined_live: 'Ti sei unito alla casa ✅'
}
};
function lang() { return (db && db.settings && (db.settings.lang === 'en' || db.settings.lang === 'it')) ? db.settings.lang : 'es'; }
function localeTag() { return lang() === 'en' ? 'en-US' : (lang() === 'it' ? 'it-IT' : 'es'); }
function t(key, vars) {
  let s = (I18N[lang()] && I18N[lang()][key]) || I18N.es[key] || key;
  if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(String(vars[k]));
  return s;
}
/* Nombre visible de una categoría: las predefinidas se traducen; las
   personalizadas se muestran tal como la persona las escribió. */
function catName(cat) { return DEFAULT_CATEGORIES.includes(cat) ? t('cat_' + cat) : cat; }
function applyStaticI18n() {
  document.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.getAttribute('data-i18n')); });
  document.querySelectorAll('[data-i18n-ph]').forEach((n) => { n.setAttribute('placeholder', t(n.getAttribute('data-i18n-ph'))); });
  document.querySelectorAll('[data-i18n-aria]').forEach((n) => { n.setAttribute('aria-label', t(n.getAttribute('data-i18n-aria'))); });
  document.documentElement.lang = lang();
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
const VIEW_IDS = ['home', 'gastos', 'ingresos', 'ahorros', 'buscar', 'resumen', 'presupuesto', 'pagos', 'cuentas', 'deudas', 'remesas', 'san', 'ajustes'];
let currentView = 'home';
function showView(name) {
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
  if (name === 'presupuesto') renderBudgets();
  if (name === 'pagos') renderFixed();
  if (name === 'cuentas') renderAccounts();
  if (name === 'deudas') renderDebts();
  if (name === 'remesas') renderRemittances();
  if (name === 'san') { renderSan(); renderSanOrg(); }
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
    if (!db.san) return t('key_san_none');
    if (db.san.currentWeek >= db.san.participants.length) return t('key_san_done');
    return t('key_san', { x: db.san.currentWeek + 1, n: db.san.participants.length, name: db.san.participants[db.san.currentWeek] });
  }
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
  renderInsights();
  document.getElementById('greeting').textContent =
    db.settings.name ? t('greeting') + ', ' + db.settings.name : t('greeting');
  document.getElementById('btn-lock-now').hidden = !db.settings.pinHash;

  const menu = document.getElementById('menu-list');
  clearNode(menu);
  const groups = [];
  for (const def of SECTION_DEFS) {
    if (db.settings.sections[def.id] === false) continue;
    if (!groups.includes(def.group)) groups.push(def.group);
  }
  for (const group of groups) {
    const wrap = el('div');
    wrap.appendChild(el('p', 'menu-group-title', t('group_' + group)));
    const list = el('div', 'menu-group');
    for (const def of SECTION_DEFS) {
      if (def.group !== group || db.settings.sections[def.id] === false) continue;
      const item = el('button', 'menu-item');
      item.type = 'button';
      item.appendChild(el('span', 'menu-icon', def.icon));
      const text = el('span', 'menu-text');
      text.appendChild(el('span', 'menu-name', t('sec_' + def.id)));
      text.appendChild(el('span', 'menu-key', menuKeyText(def.id)));
      item.appendChild(text);
      item.appendChild(el('span', 'menu-arrow', '›'));
      item.addEventListener('click', () => showView(def.id));
      list.appendChild(item);
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
function resetSavingsForm() {
  document.getElementById('savings-form').reset();
  document.getElementById('sav-date').value = todayStr();
  showError('sav-error', '');
}
function renderSavings() {
  renderGoal();
  renderChallenge();
  renderGoals();
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
        db.savings.push({ id: uid(), amountCents: item.savingsCents, date: todayStr(), note: item.note });
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
      li.appendChild(main);
      li.appendChild(el('span', 'item-amount', fmt(item.amountCents)));
      acts.appendChild(actionButton(t('btn_repeat'), 'btn-ghost', () => {
        beginUndo();
        db.savings.push({ id: uid(), amountCents: item.amountCents, date: todayStr(), note: item.note });
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
  beginUndo();
  db.savings.push({ id: uid(), amountCents: cents, date, note });
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
function orgParticipantPaidRounds(org, name) {
  return org.rounds.filter((r) => r.paid[name]).length;
}
function resetSanOrgForm() {
  const form = document.getElementById('org-form');
  if (!form) return;
  form.reset();
  const pname = document.getElementById('org-pname');
  if (pname) pname.value = '';
  const start = document.getElementById('org-start');
  if (start) start.value = todayStr();
  sanOrgDraft = [];
  showError('org-error', '');
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
    const ul = document.getElementById('org-draft-list');
    clearNode(ul);
    for (const name of sanOrgDraft) {
      const li = el('li', 'item');
      const mainLi = el('div', 'item-main');
      mainLi.appendChild(el('div', 'item-title', name));
      li.appendChild(mainLi);
      const acts = el('div', 'item-actions');
      acts.appendChild(actionButton(t('san_remove'), 'btn-ghost', () => {
        sanOrgDraft = sanOrgDraft.filter((x) => x !== name);
        renderSanOrg();
      }));
      li.appendChild(acts);
      ul.appendChild(li);
    }
    document.getElementById('org-draft-empty').hidden = sanOrgDraft.length > 0;
    return;
  }
  const org = db.sanOrg;
  const n = org.participants.length;
  document.getElementById('org-title-line').textContent = org.name;
  document.getElementById('org-meta-line').textContent =
    t('san_aporte_line', { amount: fmt(org.aporteCents) }) + ' · ' + t('org_freq_' + org.frequency);
  document.getElementById('org-total-line').textContent =
    t('san_total_line', { amount: fmt(orgTotalReunido()) });
  const roundsBox = document.getElementById('org-rounds');
  clearNode(roundsBox);
  org.participants.forEach((receiver, i) => {
    const card = el('div', 'card');
    const paidCount = orgRoundPaidCount(org, i);
    card.appendChild(el('h4', null, t('org_round', { x: i + 1, n: n }) + ' · ' + prettyDate(orgRoundDate(org, i))));
    card.appendChild(el('p', 'total-line', t('org_receiver_line', { name: receiver })));
    card.appendChild(el('p', 'muted', t('san_week_collected', {
      amount: fmt(paidCount * org.aporteCents), target: fmt(n * org.aporteCents)
    })));
    const pending = org.participants.filter((p) => !org.rounds[i].paid[p]);
    card.appendChild(el('p', 'muted small', pending.length
      ? t('org_pending_list', { names: pending.join(', ') })
      : t('org_pending_none')));
    for (const p of org.participants) {
      const row = el('label', 'toggle-row');
      row.appendChild(el('span', null, p + ' · ' + t('san_paid')));
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = org.rounds[i].paid[p] === true;
      cb.setAttribute('aria-label', p);
      cb.addEventListener('change', () => {
        if (cb.checked) org.rounds[i].paid[p] = true; else delete org.rounds[i].paid[p];
        save(); renderSanOrg();
      });
      row.appendChild(cb);
      card.appendChild(row);
    }
    roundsBox.appendChild(card);
  });
  const totals = document.getElementById('org-totals');
  clearNode(totals);
  for (const p of org.participants) {
    const paidRounds = orgParticipantPaidRounds(org, p);
    const li = el('li', 'item');
    const mainLi = el('div', 'item-main');
    mainLi.appendChild(el('div', 'item-title', p));
    mainLi.appendChild(el('div', 'item-sub', t('org_paid_rounds', { paid: paidRounds, n: n })));
    li.appendChild(mainLi);
    li.appendChild(el('div', 'item-amount', fmt(paidRounds * org.aporteCents)));
    totals.appendChild(li);
  }
}
function onSanOrgAddParticipant() {
  const input = document.getElementById('org-pname');
  const name = cleanText(input.value, 40);
  if (!name) { showError('org-error', t('san_err_pname')); return; }
  if (sanOrgDraft.some((x) => x.toLowerCase() === name.toLowerCase())) {
    showError('org-error', t('san_err_dup')); return;
  }
  sanOrgDraft.push(name);
  input.value = '';
  showError('org-error', '');
  renderSanOrg();
}
function onSanOrgCreateSubmit(ev) {
  ev.preventDefault();
  if (!requirePro()) return; /* función Pro: sin Pro, muro y no se crea nada */
  const name = cleanText(document.getElementById('org-name').value, 60);
  if (!name) { showError('org-error', t('err_name')); return; }
  const cents = parseAmount(document.getElementById('org-amount').value, false);
  if (cents === null) { showError('org-error', t('err_amount')); return; }
  if (sanOrgDraft.length < 2) { showError('org-error', t('san_err_participants')); return; }
  const freqSel = document.getElementById('org-freq').value;
  const startRaw = document.getElementById('org-start').value;
  db.sanOrg = {
    name: name,
    aporteCents: cents,
    frequency: ORG_FREQUENCIES.includes(freqSel) ? freqSel : 'semanal',
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(startRaw || '') ? startRaw : todayStr(),
    participants: sanOrgDraft.slice(),
    rounds: sanOrgDraft.map(() => ({ paid: {} }))
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
  const cur = orgCurrentRound(org);
  if (cur >= n) {
    lines.push(t('san_finished'));
  } else {
    lines.push(t('org_round', { x: cur + 1, n: n }) + ' · ' + prettyDate(orgRoundDate(org, cur)));
    lines.push(t('org_receiver_line', { name: org.participants[cur] }));
    lines.push(t('san_week_collected', {
      amount: fmtMoney(orgRoundPaidCount(org, cur) * org.aporteCents),
      target: fmtMoney(n * org.aporteCents)
    }));
    const pending = org.participants.filter((p) => !org.rounds[cur].paid[p]);
    if (pending.length) lines.push('⏳ ' + pending.join(', '));
  }
  lines.push(t('san_total_line', { amount: fmtMoney(orgTotalReunido()) }));
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
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 800, height);
  ctx.fillStyle = '#0b6e4f'; ctx.fillRect(0, 0, 800, 96);
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 34px sans-serif';
  ctx.fillText(t('app_title'), 40, 58);
  ctx.fillStyle = '#1c2733'; ctx.font = 'bold 28px sans-serif';
  ctx.fillText(org.name, 40, 148);
  ctx.font = '24px sans-serif';
  let y = 200;
  for (const line of lines) {
    ctx.fillStyle = '#1c2733'; ctx.fillText(line, 40, y);
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


/* ---------------- AJUSTES ---------------- */
function renderSettings() {
  renderCloudCard();
  renderProCard();
  renderSharedCard();
  if (SHARED_LIVE) sharedRefresh();
  const settingsBuildEl = document.getElementById('settings-build-label');
  if (settingsBuildEl) settingsBuildEl.textContent = BUILD_LABEL;
  document.getElementById('set-name').value = db.settings.name;
  document.getElementById('set-textsize').value = db.settings.textSize;
  document.getElementById('set-lang').value = lang();
  document.getElementById('set-theme').value = db.settings.theme || 'claro';
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
    });
    row.appendChild(cb);
    wrap.appendChild(row);
  }
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
  db.settings.lang = ['es', 'en', 'it'].includes(document.getElementById('set-lang').value) ? document.getElementById('set-lang').value : 'es';
  const paydayRaw = document.getElementById('set-payday').value;
  const paydayNum = Math.trunc(Number(paydayRaw));
  db.settings.payday = (paydayRaw !== '' && Number.isFinite(paydayNum) && paydayNum >= 0 && paydayNum <= 6)
    ? paydayNum : null;
  db.settings.reminders = document.getElementById('set-reminders').checked === true;
  const notifWas = db.settings.notifications === true;
  db.settings.notifications = document.getElementById('set-notifications').checked === true;
  db.settings.autoFixed = document.getElementById('set-autofixed').checked === true;
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
  showError('set-error', '');
  window.alert(t('set_saved'));
}
function applyTextSize() {
  document.documentElement.classList.toggle('text-large', db.settings.textSize === 'grande');
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
      category: kind === 'gasto' ? csvGuessCategory(desc) : '',
      duplicate: false, include: true
    };
    row.duplicate = csvFindDuplicate(row);
    row.include = !row.duplicate;
    rows.push(row);
    if (rows.length >= 1000) break;
  }
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
function onCsvFile(ev) {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  const wrap = document.getElementById('csv-preview');
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
    androidTitle: 'PETO',
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
  const lines = ['📋 PETO — ' + d.month,
    t('rep_income') + ': ' + fmtMoney(d.income),
    t('rep_expenses') + ': ' + fmtMoney(d.expenses),
    t('rep_savings') + ': ' + fmtMoney(d.savings)];
  if (d.topCat) lines.push(t('rep_top_cat') + ': ' + catName(d.topCat) + ' · ' + fmtMoney(d.topAmt));
  if (d.goal) lines.push(t('rep_goal') + ' · ' + d.goal.name + ': ' + d.goal.pct + '%');
  shareText(t('share_report_title'), lines.join('\n'));
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
function renderGoals() {
  const list = document.getElementById('goals-list');
  if (!list) return;
  clearNode(list);
  document.getElementById('goals-empty').hidden = db.goals.length > 0;
  for (const g of db.goals) {
    const card = el('div', 'card goal-extra');
    const pct = Math.min(100, Math.floor(g.savedCents / g.targetCents * 100));
    card.appendChild(el('h4', null, g.name));
    card.appendChild(el('p', 'total-line', fmt(g.savedCents) + ' / ' + fmt(g.targetCents) + ' · ' + pct + '%'));
    const bar = el('div', 'budget-bar goal-bar');
    const fill = el('div', 'budget-fill');
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    card.appendChild(bar);
    if (g.savedCents >= g.targetCents) card.appendChild(el('p', 'goal-done', t('goal_done')));
    const row = el('div', 'form-actions');
    const amt = document.createElement('input');
    amt.type = 'number'; amt.min = '0.01'; amt.step = '0.01'; amt.placeholder = '0.00';
    amt.className = 'goal-move-amt';
    amt.setAttribute('aria-label', t('goal_move_label'));
    row.appendChild(amt);
    row.appendChild(actionButton(t('goal_add'), 'btn-secondary', () => moveGoalMoney(g.id, amt, 1)));
    row.appendChild(actionButton(t('goal_take'), 'btn-ghost', () => moveGoalMoney(g.id, amt, -1)));
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
  if (db.goals.length >= 20) { showError('goal2-error', t('err_limit_goals')); return; }
  db.goals.push({ id: uid(), name: name, targetCents: target, savedCents: 0 });
  save();
  document.getElementById('goal2-form').reset();
  showError('goal2-error', '');
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
    const res = await SR.start({ language: lang() === 'en' ? 'en-US' : (lang() === 'it' ? 'it-IT' : 'es-US'), maxResults: 1, partialResults: false });
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
   variables CSS: claro, oscuro o automático (prefers-color-scheme). */
function applyTheme() {
  const de = document.documentElement;
  const theme = (db && db.settings && db.settings.theme) || 'claro';
  const accent = (db && db.settings && db.settings.accent) || 'verde';
  if (de.dataset) { de.dataset.theme = theme; de.dataset.accent = accent; }
  if (de.setAttribute) { de.setAttribute('data-theme', theme); de.setAttribute('data-accent', accent); }
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
    const lines = ['🔥 PETO', t('chal_progress', { have: fmtMoney(st.thisWeek), target: fmtMoney(st.target) })];
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
  const height = 190 + mainLines.length * 52 + (top.length ? 80 + top.length * 46 : 0) + 24;
  const canvas = document.createElement('canvas');
  canvas.width = 800; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 800, height);
  ctx.fillStyle = '#0b6e4f'; ctx.fillRect(0, 0, 800, 96);
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 34px sans-serif';
  ctx.fillText(t('app_title'), 40, 58);
  ctx.fillStyle = '#1c2733'; ctx.font = 'bold 30px sans-serif';
  ctx.fillText(d.month, 40, 150);
  ctx.font = '26px sans-serif';
  let y = 210;
  for (const line of mainLines) {
    ctx.fillStyle = '#5d6b7a'; ctx.fillText(line[0], 40, y);
    ctx.fillStyle = '#1c2733'; ctx.fillText(line[1], 420, y);
    y += 52;
  }
  if (top.length) {
    y += 28;
    ctx.fillStyle = '#1c2733'; ctx.font = 'bold 25px sans-serif';
    ctx.fillText(t('rep_top3'), 40, y);
    ctx.font = '25px sans-serif';
    y += 48;
    top.forEach((c, i) => {
      ctx.fillStyle = '#5d6b7a'; ctx.fillText((i + 1) + '. ' + catName(c.cat), 40, y);
      ctx.fillStyle = '#1c2733'; ctx.fillText(fmtMoney(c.amt), 420, y);
      y += 46;
    });
  }
  return canvas;
}
/* Descarga el informe como imagen PNG. */
function downloadReportPng() {
  try {
    const canvas = buildReportCanvas();
    if (!canvas) return;
    const finish = (url) => {
      if (!url) return;
      const a = document.createElement('a');
      a.href = url;
      a.download = 'informe-' + chartMonth + '.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
    };
    if (canvas.toBlob) canvas.toBlob((blob) => { if (blob) finish(URL.createObjectURL(blob)); });
    else if (canvas.toDataURL) finish(canvas.toDataURL('image/png'));
  } catch (e) { /* sin lienzo disponible: no pasa nada */ }
}
/* Comparte el informe como IMAGEN (Fase 1): Web Share con archivos
   cuando el sistema lo permite (WhatsApp y demás); si compartir
   archivos no está disponible, la imagen se descarga. Si la persona
   cancela el compartir, no se fuerza la descarga. */
async function shareReportPng() {
  const canvas = buildReportCanvas();
  if (!canvas) return;
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

/* ---------------- PETO PRO (Fase 4) ----------------------------------
   Qué incluye Pro (PLAN-IDEAS, Fase 4): nube sin límites, informe
   avanzado, presupuesto compartido y modo organizador de san. Lo
   básico sigue gratis. Precio fijado por Sterlin (23-oct-2026):
   $1.99/mes.
   ESTADO DE LA FACTURACIÓN EN ESTA COMPILACIÓN: todavía NO hay
   plugin de Google Play Billing. La compra real requiere que la app
   esté publicada en una pista de Play Console con la suscripción
   PRO_PRODUCT_ID creada a $1.99/mes (paso de tienda, aparte). Por
   eso la pantalla de Pro se presenta como «muy pronto» y ofrece una
   lista de espera LOCAL (settings.proWaitlist): nadie puede pagar
   todavía y NADA se simula como si fuera una compra real.
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
   Para activar la compra real hay que: (1) publicar la app en Play
   Console y crear la suscripción PRO_PRODUCT_ID a $1.99/mes;
   (2) integrar el plugin de facturación en el proyecto nativo;
   (3) implementar purchase()/restore() aquí con ese plugin y, tras la
   confirmación de Play, poner settings.pro = true + save() y
   renderProCard(). Ninguna otra parte de la app habla con la tienda. */
const PetoBilling = {
  available: false, /* ← true solo cuando Play Billing esté integrado */
  async purchase() { return { ok: false, reason: 'billing_no_disponible' }; },
  async restore() { return { ok: false, reason: 'billing_no_disponible' }; }
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
/* Botón de compra — SOLO existirá cuando PetoBilling.available sea
   true (la UI de esta compilación no lo muestra). No finge resultados:
   si la facturación no está disponible, no toca el estado Pro. */
async function onProBuy() {
  if (!PetoBilling.available) return { ok: false, reason: 'billing_no_disponible' };
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
  document.getElementById('view-lock').hidden = true;
  document.getElementById('view-onboarding').hidden = true;
  document.getElementById('app-shell').hidden = false;
  applyTextSize();
  applyTheme();
  applyStaticI18n();
  const posted = autoPostFixed();
  showView('home');
  if (posted > 0) showUndoToast();
  scheduleNotifications();
  checkBudgetAlerts();
}
async function onLockSubmit(ev) {
  ev.preventDefault();
  const pin = document.getElementById('lock-pin').value.trim();
  if (validPinFormat(pin) && (await checkPin(pin))) { enterApp(); return; }
  showError('lock-error', t('lock_err'));
  document.getElementById('lock-pin').value = '';
}

/* ---------------- Bienvenida ---------------- */
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
  if (obLangEl) db.settings.lang = ['es', 'en', 'it'].includes(obLangEl.value) ? obLangEl.value : 'es';
  db.settings.onboarded = true;
  if (pin) await setPin(pin);
  save();
  enterApp();
  /* Recién creado el PIN: ofrecer la huella en el momento (flujo guiado). */
  if (pin) maybeOfferBiometric();
}

/* ---------------- Inicio ---------------- */
function wireEvents() {
  document.getElementById('lock-form').addEventListener('submit', onLockSubmit);
  document.getElementById('onboarding-form').addEventListener('submit', onOnboardingSubmit);
  const obLangSel = document.getElementById('ob-lang');
  if (obLangSel) obLangSel.addEventListener('change', (ev) => {
    db.settings.lang = ['es', 'en', 'it'].includes(ev.target.value) ? ev.target.value : 'es';
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
  document.getElementById('btn-share-org').addEventListener('click', onShareSanOrg);
  document.getElementById('btn-share-org-img').addEventListener('click', shareSanOrgPng);
  document.getElementById('goal2-form').addEventListener('submit', onGoal2Submit);
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
    db.settings.lang = ['es', 'en', 'it'].includes(ev.target.value) ? ev.target.value : 'es';
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
  });
}

function init() {
  load();
  applyTheme();
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
    const obLangBoot = document.getElementById('ob-lang');
    if (obLangBoot) obLangBoot.value = lang();
    return;
  }
  if (db.settings.pinHash) { showLock(); return; }
  enterApp();
}

init();
cloudBoot();

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
