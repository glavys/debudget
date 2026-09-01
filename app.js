/* ═══════════════════════════════════════════════════════
   DeBudget — app.js
   Одна таблица expenses, две валюты (колонка currency).
   Рублёвые и долларовые траты нигде не смешиваются:
   переключатель наверху меняет весь контекст приложения.
   ═══════════════════════════════════════════════════════ */

const config = window.APP_CONFIG || {};
const SUPABASE_URL = config.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = config.SUPABASE_ANON_KEY || "";

let supabaseClient = null;
let expenses = [];

/* Ставится в false, если в базе ещё нет колонки currency
   (миграция не выполнена) — тогда доллары просто выключены,
   а рубли продолжают работать как раньше. */
let hasCurrencyColumn = true;

/* ═══════════════════════════════════════════════════════
   ВАЛЮТЫ И КАТЕГОРИИ — единственный источник правды.
   Отсюда строится <select>, отсюда же берутся цвета
   бейджей и полосок в статистике.

   Доступные цвета: green, blue, car, purple, pink,
                    red, yellow, gray
   ═══════════════════════════════════════════════════════ */

const CURRENCIES = {
  RUB: {
    code: "RUB",
    symbol: "₽",
    label: "Рубли",
    sub: "Рублёвые траты",
    locale: "ru-RU",
    decimals: 0,
    sheet: "Рубли",
    categories: [
      { name: "Продукты",     group: "Основные", color: "green"  },
      { name: "Еда",          group: "Основные", color: "green"  },
      { name: "Транспорт",    group: "Основные", color: "blue"   },
      { name: "Дом",          group: "Основные", color: "blue"   },
      { name: "Подарки",      group: "Основные", color: "pink"   },
      { name: "Здоровье",     group: "Основные", color: "red"    },
      { name: "Развлечения",  group: "Основные", color: "purple" },
      { name: "Путешествия",  group: "Основные", color: "yellow" },
      { name: "Подписки",     group: "Основные", color: "gray"   },
      { name: "Другое",       group: "Основные", color: "gray"   },
      { name: "Топливо",      group: "Авто",     color: "car"    },
      { name: "ТО",           group: "Авто",     color: "car"    },
      { name: "Ремонт",       group: "Авто",     color: "car"    },
      { name: "Запчасти",     group: "Авто",     color: "car"    },
      { name: "Страховка",    group: "Авто",     color: "car"    },
      { name: "Мойка",        group: "Авто",     color: "car"    },
      { name: "Диагностика",  group: "Авто",     color: "car"    },
      { name: "Расходники",   group: "Авто",     color: "car"    },
      { name: "Штрафы",       group: "Авто",     color: "car"    },
      { name: "Авто",         group: "Авто",     color: "car"    },
    ],
  },

  USD: {
    code: "USD",
    symbol: "$",
    label: "Доллары",
    sub: "Траты в USDT",
    locale: "en-US",
    decimals: 2,
    sheet: "Доллары",
    /* ↓↓↓ ЗАГЛУШКА. Переписывай смело: имена и цвета берутся
       отсюда, больше нигде их менять не надо. ↓↓↓ */
    categories: [
      { name: "Друзьям",      group: "Переводы", color: "blue"   },
      { name: "Дал в долг",   group: "Переводы", color: "purple" },
      { name: "Вернул долг",  group: "Переводы", color: "green"  },
      { name: "Скинулись",    group: "Переводы", color: "pink"   },
      { name: "Подписки",     group: "Покупки",  color: "gray"   },
      { name: "Сервисы",      group: "Покупки",  color: "blue"   },
      { name: "Покупки",      group: "Покупки",  color: "yellow" },
      { name: "Комиссия",     group: "Покупки",  color: "car"    },
      { name: "Другое",       group: "Покупки",  color: "gray"   },
    ],
  },
};

const CURRENCY_ORDER = ["RUB", "USD"];
const DEFAULT_CURRENCY = "RUB";

let activeCurrency = localStorage.getItem("currency") || DEFAULT_CURRENCY;
if (!CURRENCIES[activeCurrency]) activeCurrency = DEFAULT_CURRENCY;

/** Текущая валюта целиком */
const cur = () => CURRENCIES[activeCurrency];

const getCategoryColor = (name, code = activeCurrency) => {
  const found = CURRENCIES[code]?.categories.find((c) => c.name === name);
  return found ? found.color : "gray";
};

/* ── Заполняем <select> категориями активной валюты ── */

const buildCategorySelect = (select) => {
  select.innerHTML = "";

  const groups = new Map();
  cur().categories.forEach((c) => {
    if (!groups.has(c.group)) groups.set(c.group, []);
    groups.get(c.group).push(c.name);
  });

  const frag = document.createDocumentFragment();
  frag.append(new Option("Выберите", ""));

  groups.forEach((names, groupName) => {
    const og = document.createElement("optgroup");
    og.label = groupName;
    names.forEach((n) => og.append(new Option(n, n)));
    frag.append(og);
  });

  select.append(frag);
};

/* ═══════════════════════════════════════════════════════
   DATES
   ═══════════════════════════════════════════════════════ */

const TZ = "Europe/Moscow";

const isoFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Сегодняшняя дата в Москве, "YYYY-MM-DD" */
const todayISO = () => isoFormatter.format(new Date());

/** { year, month (0-based), day } на сегодня в Москве */
const todayParts = () => {
  const [y, m, d] = todayISO().split("-").map(Number);
  return { year: y, month: m - 1, day: d };
};

/** "2026-07-27" → "27.07" */
const formatDateDisplay = (iso) =>
  iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : "";

/* ═══════════════════════════════════════════════════════
   AMOUNTS
   Рубли — целые, доллары — с двумя знаками.
   ═══════════════════════════════════════════════════════ */

const roundAmount = (value, code = activeCurrency) => {
  const factor = 10 ** CURRENCIES[code].decimals;
  return Math.round(Number(value) * factor) / factor;
};

const formatAmount = (value, code = activeCurrency) => {
  const c = CURRENCIES[code];
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return new Intl.NumberFormat(c.locale, {
    minimumFractionDigits: c.decimals,
    maximumFractionDigits: c.decimals,
  }).format(n);
};

/** "1 234,50 $" — сумма со знаком валюты */
const formatMoney = (value, code = activeCurrency) =>
  `${formatAmount(value, code)}\u00A0${CURRENCIES[code].symbol}`;

/* ── Экранирование: всё, что летит в innerHTML, проходит через это ── */

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

/* ── DOM ── */

const generalForm = document.getElementById("generalForm");
const generalDate = document.getElementById("generalDate");
const generalAmount = document.getElementById("generalAmount");
const amountHint = document.getElementById("amountHint");
const amountLabel = document.getElementById("amountLabel");
const generalCategory = document.getElementById("generalCategory");
const generalNote = document.getElementById("generalNote");
const generalStatus = document.getElementById("generalStatus");
const exportBtn = document.getElementById("exportBtn");
const historyList = document.getElementById("historyList");
const statTotal = document.getElementById("statTotal");
const statCount = document.getElementById("statCount");
const statAvgDay = document.getElementById("statAvgDay");
const categoriesList = document.getElementById("categoriesList");
const currentMonthEl = document.getElementById("currentMonth");
const prevMonthBtn = document.getElementById("prevMonth");
const nextMonthBtn = document.getElementById("nextMonth");
const brandSub = document.getElementById("brandSub");
const historyChip = document.getElementById("historyChip");
const statsChip = document.getElementById("statsChip");
const curButtons = [...document.querySelectorAll(".cur-btn")];

/* ── State ── */

let statsMonth = todayParts().month;
let statsYear = todayParts().year;

/* Ключи вида "USD:Друзьям" — состояние валют не пересекается */
const expandedCategories = new Set();
const excludedCategories = new Set();
const catKey = (name) => `${activeCurrency}:${name}`;

/* ═══════════════════════════════════════════════════════
   AMOUNT PARSING
   Принимает "500", "500 250 30", "12,5".
   Возвращает null на любом мусоре — молча ничего не глотаем.
   ═══════════════════════════════════════════════════════ */

const parseAmountInput = (raw) => {
  const parts = String(raw).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;

  let sum = 0;
  for (const part of parts) {
    const n = Number(part.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return null;
    sum += n;
  }
  return sum;
};

const updateAmountHint = () => {
  const parts = generalAmount.value.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    amountHint.textContent = "";
    return;
  }
  const total = parseAmountInput(generalAmount.value);
  amountHint.textContent = total ? `= ${formatMoney(roundAmount(total))}` : "";
};

/* ── Статусы ── */

let statusTimer = null;

const setStatus = (message, isError = false) => {
  clearTimeout(statusTimer);
  generalStatus.textContent = message;
  generalStatus.dataset.state = isError ? "error" : "ok";
  generalStatus.classList.toggle("visible", Boolean(message));
  if (message && !isError) {
    statusTimer = setTimeout(() => generalStatus.classList.remove("visible"), 2500);
  }
};

/* ── Подтверждение: в Telegram нативный confirm() ненадёжен ── */

const confirmDialog = (message) =>
  new Promise((resolve) => {
    const tg = window.Telegram?.WebApp;
    if (tg?.showConfirm) tg.showConfirm(message, resolve);
    else resolve(window.confirm(message));
  });

/* ═══════════════════════════════════════════════════════
   TELEGRAM (опционально)
   ═══════════════════════════════════════════════════════ */

const applyThemeParams = (tp = {}) => {
  const root = document.documentElement;
  const map = {
    "--bg": tp.bg_color,
    "--ink": tp.text_color,
    "--muted": tp.hint_color,
    "--accent": tp.button_color,
    "--accent-soft": tp.secondary_bg_color,
    "--card": tp.secondary_bg_color,
  };
  Object.entries(map).forEach(([key, val]) => {
    if (val) root.style.setProperty(key, val);
  });
};

const initTelegramOptional = () => {
  const tg = window.Telegram?.WebApp;
  if (!tg) return;

  tg.ready();
  tg.expand();
  applyThemeParams(tg.themeParams);
  tg.onEvent("themeChanged", () => applyThemeParams(tg.themeParams));

  const sa = tg.safeAreaInset;
  if (sa) {
    document.documentElement.style.setProperty("--safe-top", `${sa.top || 0}px`);
    document.documentElement.style.setProperty("--safe-bottom", `${sa.bottom || 0}px`);
  }
};

/* ═══════════════════════════════════════════════════════
   CURRENCY SWITCH
   ═══════════════════════════════════════════════════════ */

/** Записи только активной валюты */
const currentExpenses = () =>
  expenses.filter((e) => (e.currency || DEFAULT_CURRENCY) === activeCurrency);

const applyCurrencyChrome = () => {
  const c = cur();

  curButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.currency === activeCurrency);
  });

  document.body.dataset.currency = activeCurrency;
  brandSub.textContent = c.sub;
  amountLabel.textContent = `Сумма, ${c.symbol}`;
  historyChip.textContent = c.symbol;
  statsChip.textContent = c.symbol;
  generalAmount.placeholder = c.decimals ? "0.00" : "0";
};

const setCurrency = (code) => {
  if (!CURRENCIES[code] || code === activeCurrency) return;
  if (code !== DEFAULT_CURRENCY && !hasCurrencyColumn) {
    setStatus("Сначала выполните миграцию currency в Supabase", true);
    return;
  }

  activeCurrency = code;
  localStorage.setItem("currency", code);

  applyCurrencyChrome();
  buildCategorySelect(generalCategory);
  amountHint.textContent = "";
  generalAmount.value = "";
  setStatus("");

  renderHistory();
  renderStats();
};

const initCurrencySwitch = () => {
  curButtons.forEach((btn) => {
    btn.addEventListener("click", () => setCurrency(btn.dataset.currency));
  });
};

/* ═══════════════════════════════════════════════════════
   TABS
   ═══════════════════════════════════════════════════════ */

const showTab = (target) => {
  document.querySelectorAll(".nav-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === target);
  });
  document.querySelectorAll(".tab-content").forEach((c) => {
    c.classList.toggle("active", c.id === `tab-${target}`);
  });
  localStorage.setItem("active-tab", target);

  if (target === "history") renderHistory();
  if (target === "stats") renderStats();
};

const initTabs = () => {
  document.querySelectorAll(".nav-tab").forEach((tab) => {
    tab.addEventListener("click", () => showTab(tab.dataset.tab));
  });
};

/* ═══════════════════════════════════════════════════════
   DATA
   ═══════════════════════════════════════════════════════ */

const initSupabase = () => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    setStatus("Заполните config.js", true);
    return false;
  }
  if (!window.supabase?.createClient) {
    setStatus("Не загрузилась библиотека Supabase. Проверьте сеть.", true);
    return false;
  }
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return true;
};

/** Человеческое объяснение вместо пустого экрана */
const describeDbError = (error) => {
  const msg = String(error?.message || "");
  if (error?.status === 540 || /paused/i.test(msg)) {
    return "База данных на паузе. Разбудите проект в дашборде Supabase.";
  }
  if (/fetch|network/i.test(msg)) return "Нет связи с базой данных.";
  return `Ошибка базы: ${msg}`;
};

const BASE_FIELDS = "id, expense_date, amount, category, note, created_at";

const fetchExpenses = (withCurrency) =>
  supabaseClient
    .from("expenses")
    .select(withCurrency ? `${BASE_FIELDS}, currency` : BASE_FIELDS)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });

const loadExpenses = async () => {
  let { data, error } = await fetchExpenses(hasCurrencyColumn);

  // Колонки нет — работаем в режиме "только рубли", не падаем
  if (error && /currency/i.test(String(error.message || ""))) {
    hasCurrencyColumn = false;
    setCurrencyAvailability(false);
    ({ data, error } = await fetchExpenses(false));
  }

  if (error) {
    console.error("Load error:", error);
    setStatus(describeDbError(error), true);
    return false;
  }

  // Старые записи без валюты считаем рублёвыми
  expenses = (data || []).map((e) => ({
    ...e,
    currency: e.currency || DEFAULT_CURRENCY,
  }));
  return true;
};

const setCurrencyAvailability = (available) => {
  curButtons.forEach((btn) => {
    if (btn.dataset.currency === DEFAULT_CURRENCY) return;
    btn.disabled = !available;
    btn.title = available ? "" : "Нужна миграция currency в Supabase";
  });
  if (!available && activeCurrency !== DEFAULT_CURRENCY) {
    activeCurrency = DEFAULT_CURRENCY;
    localStorage.setItem("currency", DEFAULT_CURRENCY);
    applyCurrencyChrome();
    buildCategorySelect(generalCategory);
  }
};

const refreshAll = async () => {
  await loadExpenses();
  renderHistory();
  renderStats();
};

const deleteExpense = async (id) => {
  const { error } = await supabaseClient.from("expenses").delete().eq("id", id);
  if (error) {
    console.error("Delete error:", error);
    setStatus(describeDbError(error), true);
    return;
  }
  await refreshAll();
};

/* ═══════════════════════════════════════════════════════
   FORM
   ═══════════════════════════════════════════════════════ */

generalForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!supabaseClient) {
    setStatus("Нет подключения к БД", true);
    return;
  }

  const expense_date = generalDate.value;
  const parsed = parseAmountInput(generalAmount.value);
  const category = generalCategory.value.trim();
  const note = generalNote.value.trim();

  if (!expense_date) {
    setStatus("Укажите дату", true);
    return;
  }
  if (parsed === null) {
    setStatus("Сумма введена неверно", true);
    return;
  }
  if (!category) {
    setStatus("Выберите категорию", true);
    return;
  }

  const row = {
    expense_date,
    amount: roundAmount(parsed),
    category,
    note: note || null,
  };
  if (hasCurrencyColumn) row.currency = activeCurrency;

  const { error } = await supabaseClient.from("expenses").insert(row);

  if (error) {
    setStatus(describeDbError(error), true);
    return;
  }

  localStorage.setItem("last-date", expense_date);
  generalForm.reset();
  buildCategorySelect(generalCategory);
  amountHint.textContent = "";
  generalDate.value = expense_date;
  setStatus("Добавлено!");

  await refreshAll();
});

generalAmount.addEventListener("input", updateAmountHint);

/* ═══════════════════════════════════════════════════════
   HISTORY
   ═══════════════════════════════════════════════════════ */

const renderHistory = () => {
  const rows = currentExpenses();

  if (!rows.length) {
    historyList.innerHTML =
      `<div class="empty-state"><p>Расходов в ${esc(cur().symbol)} пока нет</p></div>`;
    return;
  }

  let curDate = null;
  let html = "";

  for (const item of rows) {
    if (item.expense_date !== curDate) {
      curDate = item.expense_date;
      html += `<div class="history-date">${formatDateDisplay(curDate)}</div>`;
    }

    html += `
      <div class="history-item">
        <div class="history-item-left">
          <span class="history-badge badge-${getCategoryColor(item.category)}">${esc(item.category)}</span>
          ${item.note ? `<span class="history-note">${esc(item.note)}</span>` : ""}
        </div>
        <div class="history-item-right">
          <span class="history-amount">${esc(formatMoney(item.amount))}</span>
          <button class="history-delete" data-id="${esc(item.id)}">&#10005;</button>
        </div>
      </div>`;
  }

  historyList.innerHTML = html;
};

// Делегирование — один слушатель вместо одного на каждую кнопку
historyList.addEventListener("click", async (event) => {
  const btn = event.target.closest(".history-delete");
  if (!btn) return;
  if (!(await confirmDialog("Удалить эту запись?"))) return;
  await deleteExpense(btn.dataset.id);
});

/* ═══════════════════════════════════════════════════════
   STATS
   ═══════════════════════════════════════════════════════ */

const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

const shiftMonth = (delta) => {
  statsMonth += delta;
  if (statsMonth < 0) { statsMonth = 11; statsYear--; }
  if (statsMonth > 11) { statsMonth = 0; statsYear++; }
  renderStats();
};

prevMonthBtn.addEventListener("click", () => shiftMonth(-1));
nextMonthBtn.addEventListener("click", () => shiftMonth(1));

const renderCategoryDetails = (rows) =>
  rows
    .map(
      (e) => `
        <div class="cat-detail-row">
          <span class="cat-detail-date">${formatDateDisplay(e.expense_date)}</span>
          <span class="cat-detail-note">${esc(e.note || "")}</span>
          <span class="cat-detail-amount">${esc(formatMoney(e.amount))}</span>
        </div>`
    )
    .join("");

const renderStats = () => {
  currentMonthEl.textContent = `${MONTH_NAMES[statsMonth]} ${statsYear}`;

  const prefix = `${statsYear}-${String(statsMonth + 1).padStart(2, "0")}`;
  const monthExpenses = currentExpenses().filter((e) =>
    e.expense_date.startsWith(prefix)
  );

  const included = monthExpenses.filter((e) => !excludedCategories.has(catKey(e.category)));
  const total = included.reduce((sum, e) => sum + Number(e.amount), 0);

  const today = todayParts();
  const isCurrentMonth = statsMonth === today.month && statsYear === today.year;
  const daysInMonth = new Date(statsYear, statsMonth + 1, 0).getDate();
  const daysSoFar = isCurrentMonth ? today.day : daysInMonth;

  statTotal.textContent = formatMoney(roundAmount(total));
  statCount.textContent = included.length;
  statAvgDay.textContent = formatMoney(
    daysSoFar > 0 ? roundAmount(total / daysSoFar) : 0
  );

  const byCategory = new Map();
  for (const e of monthExpenses) {
    byCategory.set(e.category, (byCategory.get(e.category) || 0) + Number(e.amount));
  }

  const sorted = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);

  if (!sorted.length) {
    categoriesList.innerHTML = '<div class="empty-state"><p>Нет данных за этот месяц</p></div>';
    return;
  }

  const maxVal = sorted[0][1];

  categoriesList.innerHTML = sorted
    .map(([cat, sum]) => {
      const key = catKey(cat);
      const isExpanded = expandedCategories.has(key);
      const isExcluded = excludedCategories.has(key);
      const pct = maxVal > 0 ? (sum / maxVal) * 100 : 0;
      const share = total > 0 && !isExcluded ? Math.round((sum / total) * 100) : null;

      // Детали строим только для раскрытых
      const details = isExpanded
        ? renderCategoryDetails(
            monthExpenses
              .filter((e) => e.category === cat)
              .sort((a, b) => b.expense_date.localeCompare(a.expense_date))
          )
        : "";

      return `
        <div class="cat-row${isExpanded ? " expanded" : ""}${isExcluded ? " excluded" : ""}" data-category="${esc(cat)}">
          <div class="cat-info">
            <span class="cat-name">
              <span class="cat-dot dot-${getCategoryColor(cat)}"></span>${esc(cat)}<span class="cat-chevron">&#9662;</span>
            </span>
            <span class="cat-sum-group">
              ${share !== null ? `<span class="cat-share">${share}%</span>` : ""}
              <span class="cat-sum">${esc(formatMoney(sum))}</span>
              <button class="cat-exclude-btn${isExcluded ? " excluded" : ""}"
                      title="${isExcluded ? "Включить в итого" : "Исключить из итого"}">&#10005;</button>
            </span>
          </div>
          <div class="cat-bar">
            <div class="cat-bar-fill bar-${getCategoryColor(cat)}" style="width: ${pct}%"></div>
          </div>
          <div class="cat-details">
            <div class="cat-details-inner">${details}</div>
          </div>
        </div>`;
    })
    .join("");
};

categoriesList.addEventListener("click", (event) => {
  const row = event.target.closest(".cat-row");
  if (!row) return;
  const key = catKey(row.dataset.category);

  if (event.target.closest(".cat-exclude-btn")) {
    excludedCategories.has(key)
      ? excludedCategories.delete(key)
      : excludedCategories.add(key);
  } else {
    expandedCategories.has(key)
      ? expandedCategories.delete(key)
      : expandedCategories.add(key);
  }

  renderStats();
});

/* ═══════════════════════════════════════════════════════
   EXPORT
   Каждая валюта — отдельный лист книги.
   ═══════════════════════════════════════════════════════ */

const buildSheetRows = (code) => {
  const rows = [];
  let curMonth = null;

  const list = expenses.filter((e) => (e.currency || DEFAULT_CURRENCY) === code);
  if (!list.length) return null;

  for (const e of list) {
    const monthKey = e.expense_date.slice(0, 7); // YYYY-MM
    if (monthKey !== curMonth) {
      curMonth = monthKey;
      const monthName = MONTH_NAMES[Number(monthKey.slice(5, 7)) - 1];
      rows.push({
        Дата: `${monthName} ${monthKey.slice(0, 4)}`,
        Сумма: "", Категория: "", Комментарий: "",
      });
    }
    rows.push({
      Дата: formatDateDisplay(e.expense_date),
      Сумма: roundAmount(Number(e.amount), code),
      Категория: e.category,
      Комментарий: e.note || "",
    });
  }
  return rows;
};

const exportAll = () => {
  if (!expenses.length) {
    setStatus("Нет данных для экспорта", true);
    return;
  }

  const wb = XLSX.utils.book_new();
  let added = 0;

  for (const code of CURRENCY_ORDER) {
    const rows = buildSheetRows(code);
    if (!rows) continue;

    const ws = XLSX.utils.json_to_sheet(rows, {
      header: ["Дата", "Сумма", "Категория", "Комментарий"],
    });
    ws["!cols"] = [{ wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(wb, ws, CURRENCIES[code].sheet);
    added++;
  }

  if (!added) {
    setStatus("Нет данных для экспорта", true);
    return;
  }

  XLSX.writeFile(wb, `Расходы_${todayISO()}.xlsx`);
};

exportBtn.addEventListener("click", exportAll);

/* ═══════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════ */

const init = async () => {
  applyCurrencyChrome();
  buildCategorySelect(generalCategory);
  generalDate.value = localStorage.getItem("last-date") || todayISO();
  initTabs();
  initCurrencySwitch();
  initTelegramOptional();

  if (!initSupabase()) return;

  // Грузим данные ДО первого рендера, иначе на секунду
  // мигает пустое состояние
  await loadExpenses();
  showTab(localStorage.getItem("active-tab") || "add");
};

init();
