/* ═══════════════════════════════════════════════════════
   DeBudget — app.js
   Single table (expenses). No car_expenses.
   ═══════════════════════════════════════════════════════ */

const config = window.APP_CONFIG || {};
const SUPABASE_URL = config.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = config.SUPABASE_ANON_KEY || "";

let supabaseClient = null;
let expenses = [];

/* ── Date Utilities ── */

const FIXED_YEAR = "2026";

const getMoscowDate = () =>
  new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Moscow" }));

const getMoscowDateString = () => {
  const now = getMoscowDate();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${FIXED_YEAR}-${month}-${day}`;
};

const normalizeDateToFixedYear = (dateStr) => {
  if (!dateStr) return "";
  return `${FIXED_YEAR}-${dateStr.slice(5)}`;
};

const formatDateDisplay = (dateStr) => {
  if (!dateStr) return "";
  return `${dateStr.slice(8, 10)}.${dateStr.slice(5, 7)}`;
};

const formatAmount = (value) => {
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  return new Intl.NumberFormat("ru-RU").format(n);
};

/* ── DOM References ── */

const generalForm = document.getElementById("generalForm");
const generalDate = document.getElementById("generalDate");
const generalAmount = document.getElementById("generalAmount");
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

let statsMonth = getMoscowDate().getMonth();
let statsYear = Number(FIXED_YEAR);

/* ── Helpers ── */

const setStatus = (element, message, isError = false) => {
  if (!element) return;
  element.textContent = message;
  element.dataset.state = isError ? "error" : "ok";
  element.classList.toggle("visible", Boolean(message));
  if (message && !isError) {
    setTimeout(() => element.classList.remove("visible"), 2500);
  }
};

const syncDateInputState = (input) => {
  if (!input) return;
  input.classList.toggle("has-value", Boolean(input.value));
};

const refreshDateInputs = () => {
  document.querySelectorAll('input[type="date"]').forEach(syncDateInputState);
};

const setDefaultDates = () => {
  const today = getMoscowDateString();
  if (generalDate) generalDate.value = today;
  refreshDateInputs();
};

document.addEventListener("input", (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type === "date") {
    syncDateInputState(e.target);
  }
});

/* ── Telegram Theme (optional) ── */

const applyThemeParams = (tp = {}) => {
  const root = document.documentElement;
  const map = {
    "--bg": tp.bg_color, "--ink": tp.text_color, "--muted": tp.hint_color,
    "--accent": tp.button_color, "--accent-soft": tp.button_text_color,
    "--card": tp.secondary_bg_color,
  };
  Object.entries(map).forEach(([k, v]) => { if (v) root.style.setProperty(k, v); });
};

const applySafeArea = () => {
  const root = document.documentElement;
  const sa = window.Telegram?.WebApp?.safeAreaInset;
  if (!sa) return;
  root.style.setProperty("--safe-top", `${sa.top || 0}px`);
  root.style.setProperty("--safe-bottom", `${sa.bottom || 0}px`);
};

const initTelegramOptional = () => {
  if (window.Telegram?.WebApp) {
    Telegram.WebApp.ready();
    Telegram.WebApp.expand();
    applyThemeParams(Telegram.WebApp.themeParams);
    applySafeArea();
    Telegram.WebApp.onEvent("themeChanged", () => applyThemeParams(Telegram.WebApp.themeParams));
  }
};

/* ═══════════════════════════════════════════════════════
   TAB NAVIGATION
   ═══════════════════════════════════════════════════════ */

const initTabs = () => {
  const tabs = document.querySelectorAll(".nav-tab");
  const contents = document.querySelectorAll(".tab-content");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tab;
      tabs.forEach((t) => t.classList.remove("active"));
      contents.forEach((c) => c.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(`tab-${target}`).classList.add("active");
      localStorage.setItem("active-tab", target);
      if (target === "history") renderHistory();
      if (target === "stats") renderStats();
    });
  });

  const saved = localStorage.getItem("active-tab");
  if (saved) {
    const tab = document.querySelector(`.nav-tab[data-tab="${saved}"]`);
    if (tab) tab.click();
  }
};

/* ═══════════════════════════════════════════════════════
   SUPABASE
   ═══════════════════════════════════════════════════════ */

const initSupabase = () => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    setStatus(generalStatus, "Заполните config.js", true);
    return false;
  }
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return true;
};

const loadExpenses = async () => {
  if (!supabaseClient) return;
  const { data, error } = await supabaseClient
    .from("expenses")
    .select("id, expense_date, amount, category, note, created_at")
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Load error:", error.message);
    return;
  }

  expenses = (data || []).map((item) => ({
    ...item,
    expense_date: normalizeDateToFixedYear(item.expense_date),
  }));
};

const deleteExpense = async (id) => {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.from("expenses").delete().eq("id", id);
  if (error) {
    console.error("Delete error:", error.message);
    return;
  }
  await loadExpenses();
  renderHistory();
  renderStats();
};

/* ═══════════════════════════════════════════════════════
   FORM
   ═══════════════════════════════════════════════════════ */

generalForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabaseClient) {
    setStatus(generalStatus, "Нет подключения к БД", true);
    return;
  }

  const expense_date = normalizeDateToFixedYear(generalDate.value);
  const amount = Math.round(Number(generalAmount.value));
  const category = generalCategory.value.trim();
  const note = generalNote.value.trim();

  if (!expense_date || Number.isNaN(amount) || amount <= 0 || !category) {
    setStatus(generalStatus, "Заполните дату, сумму и категорию", true);
    return;
  }

  const { error } = await supabaseClient.from("expenses").insert({
    expense_date, amount, category, note: note || null,
  });

  if (error) {
    setStatus(generalStatus, `Ошибка: ${error.message}`, true);
    return;
  }

  generalForm.reset();
  setDefaultDates();
  setStatus(generalStatus, "Добавлено!");
  await loadExpenses();
});

/* ── Quick Amounts ── */

const initQuickAmounts = () => {
  document.querySelectorAll(".quick-amount").forEach((group) => {
    const input = document.getElementById(group.dataset.target);
    group.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const step = Number(btn.dataset.amount) || 0;
        input.value = String((Number(input.value) || 0) + step);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });
  });
};

/* ── Export ── */

const monthNames = {
  "01": "Январь", "02": "Февраль", "03": "Март", "04": "Апрель",
  "05": "Май", "06": "Июнь", "07": "Июль", "08": "Август",
  "09": "Сентябрь", "10": "Октябрь", "11": "Ноябрь", "12": "Декабрь",
};

const exportAll = () => {
  if (!expenses.length) {
    setStatus(generalStatus, "Нет данных для экспорта", true);
    return;
  }

  const cols = ["Дата", "Сумма", "Категория", "Комментарий"];
  const rows = [];
  let curMonth = null;

  expenses.forEach((e) => {
    const month = e.expense_date.slice(5, 7);
    if (month !== curMonth) {
      curMonth = month;
      rows.push({ Дата: monthNames[month] || month, Сумма: "", Категория: "", Комментарий: "" });
    }
    rows.push({
      Дата: formatDateDisplay(e.expense_date),
      Сумма: Math.round(Number(e.amount)),
      Категория: e.category,
      Комментарий: e.note || "",
    });
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows, { header: cols });
  ws["!cols"] = [{ wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(wb, ws, "Расходы");

  const today = getMoscowDateString();
  XLSX.writeFile(wb, `Расходы_до_${formatDateDisplay(today)}.xlsx`);
};

exportBtn.addEventListener("click", () => {
  if (!supabaseClient) return;
  exportAll();
});

/* ═══════════════════════════════════════════════════════
   HISTORY
   ═══════════════════════════════════════════════════════ */

const CAR_CATEGORIES = new Set([
  "Топливо", "ТО", "Ремонт", "Запчасти", "Страховка",
  "Мойка", "Диагностика", "Расходники", "Штрафы",
]);

const getCategoryBadge = (category) => {
  if (CAR_CATEGORIES.has(category)) return "car";
  const map = {
    "Продукты": "green", "Еда": "green",
    "Транспорт": "blue", "Дом": "blue",
    "Подарки": "pink", "Здоровье": "red",
    "Развлечения": "purple", "Подписки": "gray",
    "Другое": "gray", "Авто": "car",
  };
  return map[category] || "gray";
};

const renderHistory = () => {
  if (expenses.length === 0) {
    historyList.innerHTML = '<div class="empty-state"><p>Расходов пока нет</p></div>';
    return;
  }

  let curDate = null;
  let html = "";

  expenses.forEach((item) => {
    if (item.expense_date !== curDate) {
      curDate = item.expense_date;
      html += `<div class="history-date">${formatDateDisplay(curDate)}</div>`;
    }

    const badge = getCategoryBadge(item.category);
    const amount = formatAmount(Math.round(Number(item.amount)));

    html += `
      <div class="history-item">
        <div class="history-item-left">
          <span class="history-badge badge-${badge}">${item.category}</span>
          ${item.note ? `<span class="history-note">${item.note}</span>` : ""}
        </div>
        <div class="history-item-right">
          <span class="history-amount">${amount} &#8381;</span>
          <button class="history-delete" data-id="${item.id}">&#10005;</button>
        </div>
      </div>
    `;
  });

  historyList.innerHTML = html;

  historyList.querySelectorAll(".history-delete").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Удалить эту запись?")) return;
      await deleteExpense(btn.dataset.id);
    });
  });
};

/* ═══════════════════════════════════════════════════════
   STATISTICS
   ═══════════════════════════════════════════════════════ */

const monthNamesFull = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

const updateMonthLabel = () => {
  currentMonthEl.textContent = `${monthNamesFull[statsMonth]} ${statsYear}`;
};

prevMonthBtn.addEventListener("click", () => {
  statsMonth--;
  if (statsMonth < 0) { statsMonth = 11; statsYear--; }
  updateMonthLabel();
  renderStats();
});

nextMonthBtn.addEventListener("click", () => {
  statsMonth++;
  if (statsMonth > 11) { statsMonth = 0; statsYear++; }
  updateMonthLabel();
  renderStats();
});

const renderStats = () => {
  updateMonthLabel();

  const monthStr = String(statsMonth + 1).padStart(2, "0");
  const prefix = `${statsYear}-${monthStr}`;

  const monthExpenses = expenses.filter((e) => e.expense_date.startsWith(prefix));

  const total = monthExpenses.reduce((s, e) => s + Number(e.amount), 0);
  const count = monthExpenses.length;

  const now = getMoscowDate();
  const isCurrentMonth = statsMonth === now.getMonth() && statsYear === Number(FIXED_YEAR);
  const daysInMonth = new Date(statsYear, statsMonth + 1, 0).getDate();
  const daysSoFar = isCurrentMonth ? now.getDate() : daysInMonth;
  const avgPerDay = daysSoFar > 0 ? Math.round(total / daysSoFar) : 0;

  statTotal.textContent = formatAmount(Math.round(total));
  statCount.textContent = count;
  statAvgDay.textContent = formatAmount(avgPerDay);

  // Categories breakdown
  const catMap = {};
  monthExpenses.forEach((e) => {
    catMap[e.category] = (catMap[e.category] || 0) + Number(e.amount);
  });

  const sorted = Object.entries(catMap).sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) {
    categoriesList.innerHTML = '<div class="empty-state"><p>Нет данных за этот месяц</p></div>';
    return;
  }

  const maxVal = sorted[0][1];
  let html = "";

  sorted.forEach(([cat, sum]) => {
    const pct = maxVal > 0 ? (sum / maxVal) * 100 : 0;
    const badge = getCategoryBadge(cat);
    html += `
      <div class="cat-row">
        <div class="cat-info">
          <span class="cat-name">${cat}</span>
          <span class="cat-sum">${formatAmount(Math.round(sum))} &#8381;</span>
        </div>
        <div class="cat-bar">
          <div class="cat-bar-fill bar-${badge}" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  });

  categoriesList.innerHTML = html;
};

/* ═══════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════ */

const init = async () => {
  setDefaultDates();
  initQuickAmounts();
  initTabs();
  initTelegramOptional();

  if (!initSupabase()) return;
  await loadExpenses();

  const activeTab = localStorage.getItem("active-tab");
  if (activeTab === "history") renderHistory();
  if (activeTab === "stats") renderStats();
};

init();
