const config = window.APP_CONFIG || {};
const SUPABASE_URL = config.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = config.SUPABASE_ANON_KEY || "";

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

const FIXED_YEAR = "2026";

let supabaseClient = null;
let currentUserId = null;
let generalExpenses = [];
let carExpenses = [];

const getMoscowDate = () =>
  new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Moscow" }));

const getMoscowDateString = () => {
  const now = getMoscowDate();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${FIXED_YEAR}-${month}-${day}`;
};

const setDefaultDates = () => {
  const today = getMoscowDateString();
  generalDate.value = today;
  carDate.value = today;
};

const setStatus = (element, message, isError = false) => {
  if (!element) return;
  element.textContent = message;
  element.dataset.state = isError ? "error" : "info";
  element.classList.toggle("visible", Boolean(message));
};

const syncDateInputState = (input) => {
  if (!input) return;
  if (input.value) {
    input.classList.add("has-value");
  } else {
    input.classList.remove("has-value");
  }
};

const refreshDateInputs = () => {
  document.querySelectorAll('input[type="date"]').forEach(syncDateInputState);
};

document.addEventListener("input", (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.type === "date") {
    syncDateInputState(target);
  }
});

const normalizeDateToFixedYear = (dateStr) => {
  if (!dateStr) return "";
  return `${FIXED_YEAR}-${dateStr.slice(5)}`;
};

const formatDateDisplay = (dateStr) => {
  if (!dateStr) return "";
  const day = dateStr.slice(8, 10);
  const month = dateStr.slice(5, 7);
  return `${day}.${month}.${FIXED_YEAR}`;
};

const formatAmount = (value) => {
  const number = Number(value);
  if (Number.isNaN(number)) return value;
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(number);
};

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

const ensureConfig = () => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    setStatus(
      generalStatus,
      "Заполните SUPABASE_URL и SUPABASE_ANON_KEY в config.js",
      true
    );
    setStatus(
      carStatus,
      "Заполните SUPABASE_URL и SUPABASE_ANON_KEY в config.js",
      true
    );
    return false;
  }
  return true;
};

const authenticateTelegram = async () => {
  if (!window.Telegram || !Telegram.WebApp) {
    setStatus(generalStatus, "Откройте приложение в Telegram", true);
    setStatus(carStatus, "Откройте приложение в Telegram", true);
    return false;
  }

  Telegram.WebApp.ready();
  Telegram.WebApp.expand();
  applyThemeParams(Telegram.WebApp.themeParams);
  applySafeArea();

  Telegram.WebApp.onEvent("themeChanged", () => {
    applyThemeParams(Telegram.WebApp.themeParams);
  });

  const initData = Telegram.WebApp.initData;
  const initDataUnsafe = Telegram.WebApp.initDataUnsafe;
  currentUserId = initDataUnsafe?.user?.id
    ? String(initDataUnsafe.user.id)
    : null;

  if (!initData) {
    setStatus(generalStatus, "Нет данных Telegram", true);
    setStatus(carStatus, "Нет данных Telegram", true);
    return false;
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/telegram-auth`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ initData }),
    });

    if (!response.ok) {
      const message = await response.text();
      setStatus(generalStatus, `Ошибка авторизации: ${message}`, true);
      setStatus(carStatus, `Ошибка авторизации: ${message}`, true);
      return false;
    }

    const data = await response.json();
    if (!data?.token) {
      setStatus(generalStatus, "Не получен токен", true);
      setStatus(carStatus, "Не получен токен", true);
      return false;
    }

    supabaseClient = window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      {
        global: {
          headers: {
            Authorization: `Bearer ${data.token}`,
          },
        },
      }
    );

    return true;
  } catch (error) {
    setStatus(
      generalStatus,
      `Ошибка авторизации: ${error.message}`,
      true
    );
    setStatus(carStatus, `Ошибка авторизации: ${error.message}`, true);
    return false;
  }
};

const loadGeneralExpenses = async () => {
  if (!supabaseClient) return;
  const { data, error } = await supabaseClient
    .from("expenses")
    .select("id, expense_date, amount, category, note, created_at")
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    setStatus(generalStatus, `Ошибка загрузки: ${error.message}`, true);
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
    setStatus(carStatus, `Ошибка загрузки: ${error.message}`, true);
    return;
  }

  carExpenses = (data || []).map((item) => ({
    ...item,
    expense_date: normalizeDateToFixedYear(item.expense_date),
  }));
};

const monthNames = {
  "01": "Январь",
  "02": "Февраль",
  "03": "Март",
  "04": "Апрель",
  "05": "Май",
  "06": "Июнь",
  "07": "Июль",
  "08": "Август",
  "09": "Сентябрь",
  "10": "Октябрь",
  "11": "Ноябрь",
  "12": "Декабрь",
};

const buildMonthlyRows = (items, columns, mapRow) => {
  const rows = [];
  let currentMonth = null;

  items.forEach((item) => {
    const month = item.expense_date.slice(5, 7);
    if (month !== currentMonth) {
      currentMonth = month;
      const header = {};
      columns.forEach((column, index) => {
        header[column] = index === 0 ? monthNames[month] || month : "";
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

  const generalColumns = ["Дата", "Сумма", "Категория", "Комментарий"];
  const carColumns = ["Дата", "Категория", "Комментарий", "Сумма"];

  const generalRows = buildMonthlyRows(
    generalExpenses,
    generalColumns,
    (item) => ({
      Дата: formatDateDisplay(item.expense_date),
      Сумма: Math.round(Number(item.amount)),
      Категория: item.category,
      Комментарий: item.note || "",
    })
  );

  const carRows = buildMonthlyRows(carExpenses, carColumns, (item) => ({
    Дата: formatDateDisplay(item.expense_date),
    Категория: item.category,
    Комментарий: item.description || "",
    Сумма: Math.round(Number(item.amount)),
  }));

  const workbook = XLSX.utils.book_new();
  const generalSheet = XLSX.utils.json_to_sheet(generalRows, {
    header: generalColumns,
  });
  const carSheet = XLSX.utils.json_to_sheet(carRows, { header: carColumns });

  generalSheet["!cols"] = [{ wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 24 }];
  carSheet["!cols"] = [{ wch: 12 }, { wch: 14 }, { wch: 18 }, { wch: 10 }];

  XLSX.utils.book_append_sheet(workbook, generalSheet, "Общие расходы");
  XLSX.utils.book_append_sheet(workbook, carSheet, "Расходы авто");

  const today = getMoscowDateString();
  XLSX.writeFile(workbook, `Расходы_до_${formatDateDisplay(today)}.xlsx`);
  setStatus(generalStatus, "");
  setStatus(carStatus, "");
};

const incrementAmount = (input, step) => {
  if (!input) return;
  const value = Number(input.value) || 0;
  input.value = String(value + step);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

const initQuickAmounts = () => {
  document.querySelectorAll(".quick-amount").forEach((group) => {
    const targetId = group.dataset.target;
    const targetInput = document.getElementById(targetId);
    group.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        const amount = Number(button.dataset.amount) || 0;
        incrementAmount(targetInput, amount);
      });
    });
  });
};

generalForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabaseClient) {
    setStatus(generalStatus, "Сначала настройте авторизацию", true);
    return;
  }

  const expense_date = normalizeDateToFixedYear(generalDate.value);
  const amount = Math.round(Number(generalAmount.value));
  const category = generalCategory.value.trim();
  const note = generalNote.value.trim();

  if (!expense_date || Number.isNaN(amount) || !category) {
    setStatus(generalStatus, "Заполните дату, сумму и категорию", true);
    return;
  }

  const { error } = await supabaseClient.from("expenses").insert({
    expense_date,
    amount,
    category,
    note: note || null,
    user_id: currentUserId,
  });

  if (error) {
    setStatus(generalStatus, `Ошибка сохранения: ${error.message}`, true);
    return;
  }

  generalForm.reset();
  setDefaultDates();
  refreshDateInputs();
  setStatus(generalStatus, "Готово");
  await loadGeneralExpenses();
});

carForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabaseClient) {
    setStatus(carStatus, "Сначала настройте авторизацию", true);
    return;
  }

  const expense_date = normalizeDateToFixedYear(carDate.value);
  const amount = Math.round(Number(carAmount.value));
  const category = carCategory.value.trim();
  const description = carDescription.value.trim();

  if (!expense_date || Number.isNaN(amount) || !category) {
    setStatus(carStatus, "Заполните дату, сумму и категорию", true);
    return;
  }

  const { error } = await supabaseClient.from("car_expenses").insert({
    expense_date,
    amount,
    category,
    description: description || null,
    user_id: currentUserId,
  });

  if (error) {
    setStatus(carStatus, `Ошибка сохранения: ${error.message}`, true);
    return;
  }

  const { error: generalError } = await supabaseClient.from("expenses").insert({
    expense_date,
    amount,
    category: "Машина",
    note: category,
    user_id: currentUserId,
  });

  if (generalError) {
    setStatus(
      carStatus,
      `Ошибка записи в общие расходы: ${generalError.message}`,
      true
    );
    return;
  }

  carForm.reset();
  setDefaultDates();
  refreshDateInputs();
  setStatus(carStatus, "Готово");
  await Promise.all([loadCarExpenses(), loadGeneralExpenses()]);
});

exportBtn.addEventListener("click", () => {
  if (!supabaseClient) {
    setStatus(generalStatus, "Сначала настройте авторизацию", true);
    setStatus(carStatus, "Сначала настройте авторизацию", true);
    return;
  }
  exportAll();
});

const init = async () => {
  setDefaultDates();
  refreshDateInputs();
  initQuickAmounts();

  if (!ensureConfig()) return;

  const isAuthed = await authenticateTelegram();
  if (!isAuthed) return;

  await Promise.all([loadGeneralExpenses(), loadCarExpenses()]);
};

init();
