/* ═══════════════════════════════════════════════════════
   DeBudget — app.js
   No auth required. Direct Supabase connection.
   ═══════════════════════════════════════════════════════ */

const config = window.APP_CONFIG || {};
const SUPABASE_URL = config.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = config.SUPABASE_ANON_KEY || "";

let supabaseClient = null;
let generalExpenses = [];
let carExpenses = [];

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
  const day = dateStr.slice(8, 10);
  const month = dateStr.slice(5, 7);
  return `${day}.${month}`;
};

const formatAmount = (value) => {
  const number = Number(value);
  if (Number.isNaN(number)) return value;
  return new Intl.NumberFormat("ru-RU").format(number);
};

/* ── DOM References ── */

const generalForm = document.getElementById("generalForm");
const generalDate = document.getElementById("generalDate");
const generalAmount = document.getElementById("generalAmount");
const generalCategory = document.getElementById("generalCategory");
const generalNote = document.getElementById("generalNote");
const generalStatus = document.getElementById("generalStatus");
const exportBtn = document.getElementById("exportBtn");

const carForm = document.getElementById("carForm");
const carDate = document.getElementById("carDate");
const carCategory = document.getElementById("carCategory");
const carDescription = document.getElementById("carDescription");
const carAmount = document.getElementById("carAmount");
const carStatus = document.getElementById("carStatus");

const historyFilter = document.getElementById("historyFilter");
const historyList = document.getElementById("historyList");

const statTotal = document.getElementById("statTotal");
const statGeneral = document.getElementById("statGeneral");
const statCar = document.getElementById("statCar");
const statCount = document.getElementById("statCount");
const statAvgDay = document.getElementById("statAvgDay");
const categoriesList = document.getElementById("categoriesList");
const currentMonthEl = document.getElementById("currentMonth");
const prevMonthBtn = document.getElementById("prevMonth");
const nextMonthBtn = document.getElementById("nextMonth");

/* ── State ── */

let statsMonth = getMoscowDate().getMonth(); // 0-indexed
let statsYear = Number(FIXED_YEAR);

/* ── Helpers ── */

const setStatus = (element, message, isError = false) => {
  if (!element) return;
  element.textContent = message;
  element.dataset.state = isError ? "error" : "ok";
  element.classList.toggle("visible", Boolean(message));
  if (message && !isError) {
    setTimeout(() => {
      element.classList.remove("visible");
    }, 2500);
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
  if (carDate) carDate.value = today;
  refreshDateInputs();
};

document.addEventListener("input", (event) => {
  if (event.target instanceof HTMLInputElement && event.target.type === "date") {
    syncDateInputState(event.target);
  }
});

/* ── Telegram Theme (optional, non-blocking) ── */

const applyThemeParams = (themeParams = {}) => {
  const root = document.documentElement;
  const map = {
    "--bg": themeParams.bg_color,
    "--ink": themeParams.text_color,
    "--muted": themeParams.hint_color,
    "--accent": themeParams.button_color,
    "--accent-soft": themeParams.button_text_color,
    "--card": themeParams.secondary_bg_color,
  };
  Object.entries(map).forEach(([key, value]) => {
    if (value) root.style.setProperty(key, value);
  });
};

const applySafeArea = () => {
  const root = document.documentElement;
  const safeArea = window.Telegram?.WebApp?.safeAreaInset;
  if (!safeArea) return;
  root.style.setProperty("--safe-top", `${safeArea.top || 0}px`);
  root.style.setProperty("--safe-bottom", `${safeArea.bottom || 0}px`);
};

const initTelegramOptional = () => {
  if (window.Telegram?.WebApp) {
    Telegram.WebApp.ready();
    Telegram.WebApp.expand();
    applyThemeParams(Telegram.WebApp.themeParams);
    applySafeArea();
    Telegram.WebApp.onEvent("themeChanged", () => {
      applyThemeParams(Telegram.WebApp.themeParams);
    });
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

  // Restore last active tab
  const saved = localStorage.getItem("active-tab");
  if (saved) {
    const tab = document.querySelector(`.nav-tab[data-tab="${saved}"]`);
    if (tab) tab.click();
  }
};

/* ═══════════════════════════════════════════════════════
   SUPABASE (no auth)
   ═══════════════════════════════════════════════════════ */

const initSupabase = () => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    setStatus(generalStatus, "Заполните config.js", true);
    return false;
  }
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return true;
};

/* ── Load Data ── */

const loadGeneralExpenses = async () => {
  if (!supabaseClient) return;
  const { data, error } = await supabaseClient
    .from("expenses")
    .select("id, expense_date, amount, category, note, created_at")
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Load general error:", error.message);
    return;
  }

  generalExpenses = (data || []).map((item) => ({
    ...item,
    expense_date: normalizeDateToFixedYear(item.expense_date),
  }));
};

const loadCarExpenses = async () => {
  if (!supabaseClient) return;
  const { data, error } = await supabaseClient
    .from("car_expenses")
    .select("id, expense_date, amount, category, description, created_at")
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Load car error:", error.message);
    return;
  }

  carExpenses = (data || []).map((item) => ({
    ...item,
    expense_date: normalizeDateToFixedYear(item.expense_date),
  }));
};

const loadAllData = async () => {
  await Promise.all([loadGeneralExpenses(), loadCarExpenses()]);
};

/* ── Delete ── */

const deleteGeneralExpense = async (id) => {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.from("expenses").delete().eq("id", id);
  if (error) {
    console.error("Delete error:", error.message);
    return;
  }
  await loadAllData();
  renderHistory();
  renderStats();
};

const deleteCarExpense = async (id, category, amount, expenseDate) => {
  if (!supabaseClient) return;
  // Delete from car_expenses
  const { error } = await supabaseClient.from("car_expenses").delete().eq("id", id);
  if (error) {
    console.error("Delete car error:", error.message);
    return;
  }
  // Also delete the mirrored entry in expenses
  await supabaseClient
    .from("expenses")
    .delete()
    .eq("category", "Машина")
    .eq("note", category)
    .eq("amount", amount)
    .eq("expense_date", expenseDate)
    .limit(1);

  await loadAllData();
  renderHistory();
  renderStats();
};

/* ═══════════════════════════════════════════════════════
   FORM HANDLERS
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
    expense_date,
    amount,
    category,
    note: note || null,
  });

  if (error) {
    setStatus(generalStatus, `Ошибка: ${error.message}`, true);
    return;
  }

  generalForm.reset();
  setDefaultDates();
  setStatus(generalStatus, "Добавлено!");
  await loadAllData();
});

carForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabaseClient) {
    setStatus(carStatus, "Нет подключения к БД", true);
    return;
  }

  const expense_date = normalizeDateToFixedYear(carDate.value);
  const amount = Math.round(Number(carAmount.value));
  const category = carCategory.value.trim();
  const description = carDescription.value.trim();

  if (!expense_date || Number.isNaN(amount) || amount <= 0 || !category) {
    setStatus(carStatus, "Заполните дату, сумму и категорию", true);
    return;
  }

  const { error } = await supabaseClient.from("car_expenses").insert({
    expense_date,
    amount,
    category,
    description: description || null,
  });

  if (error) {
    setStatus(carStatus, `Ошибка: ${error.message}`, true);
    return;
  }

  // Mirror to general expenses
  const { error: mirrorError } = await supabaseClient.from("expenses").insert({
    expense_date,
    amount,
    category: "Машина",
    note: category,
  });

  if (mirrorError) {
    setStatus(carStatus, `Ошибка записи в общие: ${mirrorError.message}`, true);
    return;
  }

  carForm.reset();
  setDefaultDates();
  setStatus(carStatus, "Добавлено!");
  await loadAllData();
});

/* ── Quick Amounts ── */

const initQuickAmounts = () => {
  document.querySelectorAll(".quick-amount").forEach((group) => {
    const targetId = group.dataset.target;
    const targetInput = document.getElementById(targetId);
    group.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        const step = Number(button.dataset.amount) || 0;
        const current = Number(targetInput.value) || 0;
        targetInput.value = String(current + step);
        targetInput.dispatchEvent(new Event("input", { bubbles: true }));
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

const buildMonthlyRows = (items, columns, mapRow) => {
  const rows = [];
  let currentMonth = null;
  items.forEach((item) => {
    const month = item.expense_date.slice(5, 7);
    if (month !== currentMonth) {
      currentMonth = month;
      const header = {};
      columns.forEach((col, i) => {
        header[col] = i === 0 ? (monthNames[month] || month) : "";
      });
      rows.push(header);
    }
    rows.push(mapRow(item));
  });
  return rows;
};

const exportAll = () => {
  if (!generalExpenses.length && !carExpenses.length) {
    setStatus(generalStatus, "Нет данных для экспорта", true);
    return;
  }

  const gCols = ["Дата", "Сумма", "Категория", "Комментарий"];
  const cCols = ["Дата", "Категория", "Комментарий", "Сумма"];

  const gRows = buildMonthlyRows(generalExpenses, gCols, (item) => ({
    Дата: formatDateDisplay(item.expense_date),
    Сумма: Math.round(Number(item.amount)),
    Категория: item.category,
    Комментарий: item.note || "",
  }));

  const cRows = buildMonthlyRows(carExpenses, cCols, (item) => ({
    Дата: formatDateDisplay(item.expense_date),
    Категория: item.category,
    Комментарий: item.description || "",
    Сумма: Math.round(Number(item.amount)),
  }));

  const wb = XLSX.utils.book_new();
  const gs = XLSX.utils.json_to_sheet(gRows, { header: gCols });
  const cs = XLSX.utils.json_to_sheet(cRows, { header: cCols });
  gs["!cols"] = [{ wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 24 }];
  cs["!cols"] = [{ wch: 12 }, { wch: 14 }, { wch: 18 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, gs, "Общие расходы");
  XLSX.utils.book_append_sheet(wb, cs, "Расходы авто");

  const today = getMoscowDateString();
  XLSX.writeFile(wb, `Расходы_до_${formatDateDisplay(today)}.xlsx`);
};

exportBtn.addEventListener("click", () => {
  if (!supabaseClient) return;
  exportAll();
});

/* ═══════════════════════════════════════════════════════
   HISTORY TAB
   ═══════════════════════════════════════════════════════ */

const renderHistory = () => {
  const filter = historyFilter.value;

  let items = [];

  if (filter === "all" || filter === "general") {
    items = items.concat(
      generalExpenses
        .filter((e) => e.category !== "Машина") // avoid duplicates from car mirror
        .map((e) => ({ ...e, type: "general" }))
    );
  }

  if (filter === "all" || filter === "car") {
    items = items.concat(
      carExpenses.map((e) => ({ ...e, type: "car" }))
    );
  }

  // If showing all, also include non-car-mirrored "Машина" expenses for completeness
  if (filter === "all") {
    // Car expenses already added above, just add general "Машина" entries that were mirrored
    // Actually let's keep it simple: show car_expenses as "Авто" and general expenses excluding "Машина"
  }

  // Sort by date descending, then created_at descending
  items.sort((a, b) => {
    const dateCompare = b.expense_date.localeCompare(a.expense_date);
    if (dateCompare !== 0) return dateCompare;
    return (b.created_at || "").localeCompare(a.created_at || "");
  });

  if (items.length === 0) {
    historyList.innerHTML = '<div class="empty-state"><p>Расходов пока нет</p></div>';
    return;
  }

  let currentDate = null;
  let html = "";

  items.forEach((item) => {
    const date = item.expense_date;
    if (date !== currentDate) {
      currentDate = date;
      html += `<div class="history-date">${formatDateDisplay(date)}</div>`;
    }

    const isCarType = item.type === "car";
    const badge = isCarType ? "car" : getCategoryBadge(item.category);
    const name = isCarType ? item.category : item.category;
    const note = isCarType ? (item.description || "") : (item.note || "");
    const amount = formatAmount(Math.round(Number(item.amount)));

    html += `
      <div class="history-item">
        <div class="history-item-left">
          <span class="history-badge badge-${badge}">${isCarType ? "Авто" : item.category}</span>
          ${note ? `<span class="history-note">${note}</span>` : ""}
        </div>
        <div class="history-item-right">
          <span class="history-amount">${amount} &#8381;</span>
          <button class="history-delete" data-id="${item.id}" data-type="${item.type}"
            ${isCarType ? `data-category="${item.category}" data-amount="${item.amount}" data-date="${item.expense_date}"` : ""}>
            &#10005;
          </button>
        </div>
      </div>
    `;
  });

  historyList.innerHTML = html;

  // Attach delete handlers
  historyList.querySelectorAll(".history-delete").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const type = btn.dataset.type;
      if (!confirm("Удалить эту запись?")) return;

      if (type === "car") {
        await deleteCarExpense(id, btn.dataset.category, Number(btn.dataset.amount), btn.dataset.date);
      } else {
        await deleteGeneralExpense(id);
      }
    });
  });
};

const getCategoryBadge = (category) => {
  const map = {
    "Продукты": "green", "Еда": "green",
    "Транспорт": "blue", "Машина": "car",
    "Дом": "purple", "Подарки": "pink",
    "Здоровье": "red", "Развлечения": "orange",
    "Подписки": "gray", "Другое": "gray",
  };
  return map[category] || "gray";
};

historyFilter.addEventListener("change", renderHistory);

/* ═══════════════════════════════════════════════════════
   STATISTICS TAB
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

  // Filter general expenses (excluding "Машина" to avoid double counting car)
  const monthGeneral = generalExpenses.filter(
    (e) => e.expense_date.startsWith(prefix) && e.category !== "Машина"
  );
  const monthCar = carExpenses.filter((e) => e.expense_date.startsWith(prefix));

  // Also include "Машина" category entries from general expenses for total
  const monthMachina = generalExpenses.filter(
    (e) => e.expense_date.startsWith(prefix) && e.category === "Машина"
  );

  const sumGeneral = monthGeneral.reduce((s, e) => s + Number(e.amount), 0);
  const sumCar = monthCar.reduce((s, e) => s + Number(e.amount), 0);
  const total = sumGeneral + sumCar;
  const count = monthGeneral.length + monthCar.length;

  // Calculate average per day
  const now = getMoscowDate();
  const isCurrentMonth = statsMonth === now.getMonth() && statsYear === Number(FIXED_YEAR);
  const daysInMonth = new Date(statsYear, statsMonth + 1, 0).getDate();
  const daysSoFar = isCurrentMonth ? now.getDate() : daysInMonth;
  const avgPerDay = daysSoFar > 0 ? Math.round(total / daysSoFar) : 0;

  statTotal.textContent = formatAmount(Math.round(total));
  statGeneral.textContent = formatAmount(Math.round(sumGeneral));
  statCar.textContent = formatAmount(Math.round(sumCar));
  statCount.textContent = count;
  statAvgDay.textContent = formatAmount(avgPerDay);

  // Categories breakdown (general only, car shown as one category)
  const catMap = {};

  monthGeneral.forEach((e) => {
    const cat = e.category;
    catMap[cat] = (catMap[cat] || 0) + Number(e.amount);
  });

  if (sumCar > 0) {
    catMap["Авто"] = sumCar;
  }

  const sorted = Object.entries(catMap).sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) {
    categoriesList.innerHTML = '<div class="empty-state"><p>Нет данных за этот месяц</p></div>';
    return;
  }

  const maxVal = sorted[0][1];

  let html = "";
  sorted.forEach(([cat, sum]) => {
    const pct = maxVal > 0 ? (sum / maxVal) * 100 : 0;
    const badge = cat === "Авто" ? "car" : getCategoryBadge(cat);
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
  await loadAllData();

  // Render current tab if it was restored
  const activeTab = localStorage.getItem("active-tab");
  if (activeTab === "history") renderHistory();
  if (activeTab === "stats") renderStats();
};

init();
