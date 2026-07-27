/* ═══════════════════════════════════════════════════════
   DeBudget — app.js
   Single table (expenses).
   ═══════════════════════════════════════════════════════ */

const config = window.APP_CONFIG || {};
const SUPABASE_URL = config.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = config.SUPABASE_ANON_KEY || "";

let supabaseClient = null;
let expenses = [];

/* ═══════════════════════════════════════════════════════
   CATEGORIES — единственный источник правды.
   Отсюда строится <select>, отсюда же берутся цвета бейджей.
   ═══════════════════════════════════════════════════════ */

const CATEGORIES = [
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
];

const CATEGORY_COLORS = new Map(CATEGORIES.map((c) => [c.name, c.color]));
const getCategoryColor = (name) => CATEGORY_COLORS.get(name) || "gray";

/* ── Заполняем <select> из CATEGORIES ── */

const buildCategorySelect = (select) => {
  const groups = new Map();
  CATEGORIES.forEach((c) => {
    if (!groups.has(c.group)) groups.set(c.group, []);
    groups.get(c.group).push(c.name);
  });

  const frag = document.createDocumentFragment();
  const placeholder = new Option("Выберите", "");
  frag.append(placeholder);

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
   Всё считаем по московскому времени, но год больше
   не захардкожен — берётся реальный.
   ═══════════════════════════════════════════════════════ */

const TZ = "Europe/Moscow";

// en-CA даёт сразу YYYY-MM-DD, без ручной сборки из getMonth()/getDate()
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

const formatAmount = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat("ru-RU").format(n) : value;
};

/* ── Экранирование: всё, что летит в innerHTML, проходит через это ── */

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

/* ── DOM ── */

const generalForm = document.getElementById("generalForm");
const generalDate = document.getElementById("generalDate");
const generalAmount = document.getElementById("generalAmount");
const amountHint = document.getElementById("amountHint");
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

/* ── State ── */

let statsMonth = todayParts().month;
let statsYear = todayParts().year;
const expandedCategories = new Set();
const excludedCategories = new Set();

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
  amountHint.textContent = total ? `= ${formatAmount(Math.round(total))}` : "";
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

const loadExpenses = async () => {
  const { data, error } = await supabaseClient
    .from("expenses")
    .select("id, expense_date, amount, category, note, created_at")
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Load error:", error);
    setStatus(describeDbError(error), true);
    return false;
  }

  expenses = data || [];
  return true;
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

  const { error } = await supabaseClient.from("expenses").insert({
    expense_date,
    amount: Math.round(parsed),
    category,
    note: note || null,
  });

  if (error) {
    setStatus(describeDbError(error), true);
    return;
  }

  localStorage.setItem("last-date", expense_date);
  generalForm.reset();
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
  if (!expenses.length) {
    historyList.innerHTML = '<div class="empty-state"><p>Расходов пока нет</p></div>';
    return;
  }

  let curDate = null;
  let html = "";

  for (const item of expenses) {
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
          <span class="history-amount">${formatAmount(Math.round(item.amount))} &#8381;</span>
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
          <span class="cat-detail-amount">${formatAmount(Math.round(e.amount))} &#8381;</span>
        </div>`
    )
    .join("");

const renderStats = () => {
  currentMonthEl.textContent = `${MONTH_NAMES[statsMonth]} ${statsYear}`;

  const prefix = `${statsYear}-${String(statsMonth + 1).padStart(2, "0")}`;
  const monthExpenses = expenses.filter((e) => e.expense_date.startsWith(prefix));

  const included = monthExpenses.filter((e) => !excludedCategories.has(e.category));
  const total = included.reduce((sum, e) => sum + Number(e.amount), 0);

  const today = todayParts();
  const isCurrentMonth = statsMonth === today.month && statsYear === today.year;
  const daysInMonth = new Date(statsYear, statsMonth + 1, 0).getDate();
  const daysSoFar = isCurrentMonth ? today.day : daysInMonth;

  statTotal.textContent = formatAmount(Math.round(total));
  statCount.textContent = included.length;
  statAvgDay.textContent = formatAmount(daysSoFar > 0 ? Math.round(total / daysSoFar) : 0);

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
      const isExpanded = expandedCategories.has(cat);
      const isExcluded = excludedCategories.has(cat);
      const pct = maxVal > 0 ? (sum / maxVal) * 100 : 0;

      // Детали строим только для раскрытых — раньше они генерились
      // для всех категорий и просто прятались через CSS
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
            <span class="cat-name">${esc(cat)} <span class="cat-chevron">&#9662;</span></span>
            <span class="cat-sum-group">
              <span class="cat-sum">${formatAmount(Math.round(sum))} &#8381;</span>
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
  const cat = row.dataset.category;

  if (event.target.closest(".cat-exclude-btn")) {
    excludedCategories.has(cat)
      ? excludedCategories.delete(cat)
      : excludedCategories.add(cat);
  } else {
    expandedCategories.has(cat)
      ? expandedCategories.delete(cat)
      : expandedCategories.add(cat);
  }

  renderStats();
});

/* ═══════════════════════════════════════════════════════
   EXPORT
   ═══════════════════════════════════════════════════════ */

const exportAll = () => {
  if (!expenses.length) {
    setStatus("Нет данных для экспорта", true);
    return;
  }

  const rows = [];
  let curMonth = null;

  for (const e of expenses) {
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
      Сумма: Math.round(Number(e.amount)),
      Категория: e.category,
      Комментарий: e.note || "",
    });
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows, {
    header: ["Дата", "Сумма", "Категория", "Комментарий"],
  });
  ws["!cols"] = [{ wch: 14 }, { wch: 10 }, { wch: 16 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(wb, ws, "Расходы");
  XLSX.writeFile(wb, `Расходы_${todayISO()}.xlsx`);
};

exportBtn.addEventListener("click", exportAll);

/* ═══════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════ */

const init = async () => {
  buildCategorySelect(generalCategory);
  generalDate.value = localStorage.getItem("last-date") || todayISO();
  initTabs();
  initTelegramOptional();

  if (!initSupabase()) return;

  // Грузим данные ДО первого рендера, иначе на секунду
  // мигает пустое состояние
  await loadExpenses();
  showTab(localStorage.getItem("active-tab") || "add");
};

init();
