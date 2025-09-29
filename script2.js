// script.js — complete Smart Study Planner (multi-task timeline + notifications)
(() => {
  // --- Load & normalize tasks ---
  let tasks = JSON.parse(localStorage.getItem("tasks") || "[]");
  tasks = tasks.map((t) => ({
    id: t.id ?? (Date.now() + Math.floor(Math.random() * 10000)),
    title: t.title ?? "",
    desc: t.desc ?? "",
    start: t.start ?? "",
    due: t.due ?? "",
    hours: Number(t.hours ?? 1),
    priority: t.priority ?? "med",
    done: !!t.done,
    notifiedSoon: !!t.notifiedSoon,
    notifiedToday: !!t.notifiedToday,
    notifiedOverdue: !!t.notifiedOverdue,
  }));

  // --- DOM refs (match your HTML) ---
  const titleEl = document.getElementById("title");
  const descEl = document.getElementById("desc");
  const startEl = document.getElementById("start");
  const dueEl = document.getElementById("due");
  const hoursEl = document.getElementById("hours");
  const priorityEl = document.getElementById("priority");

  const addBtn = document.getElementById("addBtn");
  const clearBtn = document.getElementById("clearBtn");
  const tasksList = document.getElementById("tasksList");

  const countEl = document.getElementById("count");
  const completedEl = document.getElementById("completedCount");
  const pendingEl = document.getElementById("pendingCount");
  const totalHoursEl = document.getElementById("totalHours");
  const progressBar = document.getElementById("progressBar");

  const completeAllBtn = document.getElementById("completeAll");
  const clearAllBtn = document.getElementById("clearAll");

  const exportBtn = document.getElementById("exportBtn");
  const importBtn = document.getElementById("importBtn");
  const importFile = document.getElementById("importFile");

  const todayEl = document.getElementById("today");
  const timelineGrid = document.getElementById("timelineGrid");
  const legendEl = document.getElementById("legend");
  const rangeLabel = document.getElementById("rangeLabel");
  const notifyPermBtn = document.getElementById("notifyPerm");

  if (todayEl) todayEl.textContent = new Date().toLocaleDateString();

  // ensure timelineGrid positioned relatively (fixes CSS omissions)
  if (timelineGrid) {
    timelineGrid.style.position = timelineGrid.style.position || "relative";
    timelineGrid.style.overflow = timelineGrid.style.overflow || "hidden";
  }

  // --- Toast (in-app fallback for notifications) ---
  let toastContainer = document.getElementById("toastContainer");
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.id = "toastContainer";
    Object.assign(toastContainer.style, {
      position: "fixed",
      right: "20px",
      bottom: "20px",
      width: "320px",
      zIndex: 9999,
      pointerEvents: "none",
    });
    document.body.appendChild(toastContainer);
  }
  function showToast(text, ttl = 5000) {
    const t = document.createElement("div");
    t.textContent = text;
    Object.assign(t.style, {
      background: "rgba(2,6,23,0.95)",
      color: "#e6eef8",
      padding: "10px 12px",
      marginTop: "8px",
      borderRadius: "8px",
      boxShadow: "0 6px 18px rgba(2,6,23,0.6)",
      fontSize: "13px",
      pointerEvents: "auto",
      opacity: "1",
      transition: "opacity 300ms",
    });
    toastContainer.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; setTimeout(()=>t.remove(), 350); }, ttl);
  }

  // --- Persistence ---
  function saveTasks() {
    localStorage.setItem("tasks", JSON.stringify(tasks));
  }

  // --- Date helpers (use date-only in UTC to avoid TZ issues) ---
  function parseDateOnly(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split("-");
    if (parts.length !== 3) return null;
    const [y, m, d] = parts.map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  function todayDateOnly() {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
  function dateDiffDays(a, b) {
    // returns integer days (b - a)
    const utcA = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
    const utcB = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
    return Math.round((utcB - utcA) / (1000 * 60 * 60 * 24));
  }

  // --- Rendering: list + stats + progress ---
  function renderTasks() {
    // Task list
    tasksList.innerHTML = "";
    if (!tasks.length) {
      tasksList.innerHTML = `<div style="color:var(--muted);font-size:13px;margin-top:8px">No tasks yet</div>`;
    } else {
      tasks.forEach((task, idx) => {
        const div = document.createElement("div");
        div.className = "task-item";
        div.innerHTML = `
          <div class="meta">
            <div class="task-title">${escapeHtml(task.title)} ${task.done ? "✅" : ""}</div>
            <div class="task-dates">${task.start || "—"} → ${task.due || "—"} • ${task.hours}h • ${task.priority}</div>
          </div>
          <button class="btn-ghost small" data-idx="${idx}" data-action="toggle">${task.done ? "Undo" : "Done"}</button>
          <button class="btn-ghost small" data-idx="${idx}" data-action="edit">✎</button>
          <button class="btn-ghost small" data-idx="${idx}" data-action="delete">✕</button>
        `;
        tasksList.appendChild(div);
      });
    }

    // stats
    countEl.textContent = tasks.length;
    const completed = tasks.filter(t => t.done).length;
    const pending = tasks.length - completed;
    const hours = tasks.reduce((s, t) => s + Number(t.hours || 0), 0);

    completedEl.textContent = completed;
    pendingEl.textContent = pending;
    totalHoursEl.textContent = hours;

    const pct = tasks.length === 0 ? 0 : Math.round((completed / tasks.length) * 100);
    progressBar.style.width = pct + "%";

    // timeline
    renderTimeline();
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" })[c]);
  }

  // --- Timeline rendering (multi-task) ---
  function renderTimeline() {
    if (!timelineGrid) return;
    timelineGrid.innerHTML = "";
    legendEl.innerHTML = "";

    // only tasks that have valid start & due
    const validTasks = tasks.filter(t => parseDateOnly(t.start) && parseDateOnly(t.due));
    if (validTasks.length === 0) {
      rangeLabel.textContent = "No tasks yet";
      timelineGrid.style.height = "120px";
      return;
    }

    // sort by start date (ascending)
    validTasks.sort((a, b) => parseDateOnly(a.start) - parseDateOnly(b.start));

    // global range (inclusive)
    const startDates = validTasks.map(t => parseDateOnly(t.start).getTime());
    const endDates = validTasks.map(t => parseDateOnly(t.due).getTime());
    const minDate = new Date(Math.min(...startDates));
    const maxDate = new Date(Math.max(...endDates));
    let totalDays = dateDiffDays(minDate, maxDate) + 1;
    if (totalDays <= 0) totalDays = 1;

    rangeLabel.textContent = `${minDate.toLocaleDateString()} → ${maxDate.toLocaleDateString()}`;

    // get grid width (fallbacks)
    let gridWidth = timelineGrid.clientWidth || Math.floor(timelineGrid.getBoundingClientRect().width) || 800;
    // row height / spacing
    const rowHeight = 42;
    validTasks.forEach((task, i) => {
      const s = parseDateOnly(task.start);
      const e = parseDateOnly(task.due);
      const startOffset = Math.max(0, dateDiffDays(minDate, s));
      const duration = Math.max(1, dateDiffDays(s, e) + 1);

      const leftPct = (startOffset / totalDays) * 100;
      const widthPct = (duration / totalDays) * 100;

      const bar = document.createElement("div");
      bar.className = "bar";
      bar.textContent = task.title;
      bar.title = `${task.title}\n${task.start} → ${task.due}\n${task.hours}h • ${task.priority}${task.done ? " • Completed" : ""}`;
      bar.dataset.id = task.id;

      // style — prefer CSS class but set key inline styles to ensure correct placement
      bar.style.position = "absolute";
      bar.style.left = leftPct + "%";
      bar.style.width = widthPct + "%";
      bar.style.top = (i * rowHeight) + "px";
      bar.style.height = "34px";
      bar.style.display = "flex";
      bar.style.alignItems = "center";
      bar.style.padding = "0 10px";
      bar.style.borderRadius = "8px";
      bar.style.cursor = "pointer";
      bar.style.whiteSpace = "nowrap";
      bar.style.overflow = "hidden";
      bar.style.textOverflow = "ellipsis";

      // color by priority + done override
      if (task.done) {
        bar.style.background = "linear-gradient(90deg,#9ca3af,#6b7280)";
        bar.style.color = "#021525";
      } else {
        if (task.priority === "high") bar.style.background = "linear-gradient(90deg,#f97316,#ef4444)";
        else if (task.priority === "low") bar.style.background = "linear-gradient(90deg,#34d399,#10b981)";
        else bar.style.background = "linear-gradient(90deg,var(--accent),var(--accent-2))";
        bar.style.color = "#021525";
      }

      // click -> edit / toggle options
      bar.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const id = bar.dataset.id;
        const idx = tasks.findIndex(t => String(t.id) === String(id));
        if (idx === -1) return;
        timelineBarClick(idx);
      });

      timelineGrid.appendChild(bar);

      // legend chip
      const chip = document.createElement("div");
      chip.className = "chip";
      chip.textContent = `${task.title} (${task.start} → ${task.due})`;
      legendEl.appendChild(chip);
    });

    // adjust height
    timelineGrid.style.height = Math.max(120, validTasks.length * rowHeight) + "px";
  }

  function timelineBarClick(idx) {
    const t = tasks[idx];
    if (!t) return;
    const choice = prompt(`Edit task title (enter new title), or type "toggle" to toggle done, "delete" to remove:\nCurrent: ${t.title}`, t.title);
    if (choice === null) return;
    if (choice.toLowerCase() === "toggle") {
      t.done = !t.done;
      if (t.done) { t.notifiedSoon = t.notifiedToday = t.notifiedOverdue = true; }
      saveTasks(); renderTasks(); return;
    }
    if (choice.toLowerCase() === "delete") {
      if (confirm(`Delete "${t.title}"?`)) {
        tasks.splice(idx, 1);
        saveTasks(); renderTasks();
      }
      return;
    }
    // treat as updated title when non-empty
    if (choice.trim().length > 0) {
      t.title = choice.trim();
      saveTasks(); renderTasks();
    }
  }

  // --- Add / clear form handlers ---
  addBtn.addEventListener("click", () => {
    if (!titleEl.value || !startEl.value || !dueEl.value) {
      alert("Please fill title, start date and due date.");
      return;
    }
    const newTask = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      title: titleEl.value.trim(),
      desc: descEl.value.trim(),
      start: startEl.value,
      due: dueEl.value,
      hours: Number(hoursEl.value) || 1,
      priority: priorityEl.value || "med",
      done: false,
      notifiedSoon: false,
      notifiedToday: false,
      notifiedOverdue: false
    };
    tasks.push(newTask);
    saveTasks();
    renderTasks();
    clearForm();
    checkRemindersForTask(newTask);
  });

  clearBtn.addEventListener("click", clearForm);
  function clearForm() {
    titleEl.value = "";
    descEl.value = "";
    startEl.value = "";
    dueEl.value = "";
    hoursEl.value = 1;
    priorityEl.value = "med";
  }

  // --- Task list delegation (toggle/edit/delete) ---
  tasksList.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const idx = Number(btn.dataset.idx);
    const action = btn.dataset.action;
    if (action === "toggle") {
      tasks[idx].done = !tasks[idx].done;
      if (tasks[idx].done) tasks[idx].notifiedSoon = tasks[idx].notifiedToday = tasks[idx].notifiedOverdue = true;
      saveTasks(); renderTasks();
    } else if (action === "delete") {
      if (confirm("Delete task?")) {
        tasks.splice(idx, 1);
        saveTasks(); renderTasks();
      }
    } else if (action === "edit") {
      editTaskPrompt(idx);
    }
  });

  function editTaskPrompt(idx) {
    const t = tasks[idx];
    const newTitle = prompt("Edit title:", t.title);
    if (newTitle === null) return;
    t.title = newTitle.trim();
    const newStart = prompt("Edit start date (YYYY-MM-DD):", t.start);
    if (newStart !== null && /^\d{4}-\d{2}-\d{2}$/.test(newStart)) t.start = newStart;
    const newDue = prompt("Edit due date (YYYY-MM-DD):", t.due);
    if (newDue !== null && /^\d{4}-\d{2}-\d{2}$/.test(newDue)) t.due = newDue;
    saveTasks(); renderTasks();
  }

  // --- Mark all / Clear all ---
  completeAllBtn.addEventListener("click", () => {
    tasks.forEach(t => { t.done = true; t.notifiedSoon = t.notifiedToday = t.notifiedOverdue = true; });
    saveTasks(); renderTasks();
  });

  clearAllBtn.addEventListener("click", () => {
    if (confirm("Clear all tasks?")) {
      tasks = []; saveTasks(); renderTasks();
    }
  });

  // --- Export / Import ---
  exportBtn.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(tasks, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "tasks.json";
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 5000);
  });

  importBtn.addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target.result);
        tasks = (imported || []).map((t) => ({
          id: t.id ?? (Date.now() + Math.floor(Math.random()*10000)),
          title: t.title || "",
          desc: t.desc || "",
          start: t.start || "",
          due: t.due || "",
          hours: Number(t.hours || 1),
          priority: t.priority || "med",
          done: !!t.done,
          notifiedSoon: !!t.notifiedSoon,
          notifiedToday: !!t.notifiedToday,
          notifiedOverdue: !!t.notifiedOverdue
        }));
        saveTasks(); renderTasks();
        tasks.forEach(checkRemindersForTask);
      } catch (err) {
        alert("Invalid JSON file.");
      }
    };
    reader.readAsText(file);
    // reset file input so same file can be re-imported later
    importFile.value = "";
  });

  // --- Notifications utilities ---
  function notificationsSupported() {
    return ("Notification" in window);
  }
  async function requestNotificationPermission() {
    if (!notificationsSupported()) { showToast("Notifications not supported."); return; }
    try {
      const p = await Notification.requestPermission();
      showToast(p === "granted" ? "Notifications enabled." : "Notifications not granted.");
    } catch {
      showToast("Notifications request failed.");
    }
  }
  if (notifyPermBtn) notifyPermBtn.addEventListener("click", requestNotificationPermission);

  function sendNotification(title, body) {
    if (notificationsSupported() && Notification.permission === "granted") {
      try { new Notification(title, { body, silent: false }); }
      catch { showToast(`${title}: ${body}`, 6000); }
    } else {
      showToast(`${title}: ${body}`, 6000);
    }
  }

  // --- Reminders checking (per-task) ---
  function checkRemindersForTask(task) {
    if (!task || task.done) return;
    const due = parseDateOnly(task.due);
    if (!due) return;
    const today = todayDateOnly();
    const daysUntil = dateDiffDays(today, due); // positive -> due in future, 0 -> today, <0 overdue

    if (daysUntil < 0 && !task.notifiedOverdue) {
      sendNotification("Task overdue", `${task.title} was due on ${task.due}`);
      task.notifiedOverdue = task.notifiedToday = task.notifiedSoon = true;
      saveTasks();
      return;
    }
    if (daysUntil === 0 && !task.notifiedToday) {
      sendNotification("Task due today", `${task.title} is due today (${task.due})`);
      task.notifiedToday = task.notifiedSoon = true;
      saveTasks();
      return;
    }
    if (daysUntil === 1 && !task.notifiedSoon) {
      sendNotification("Task due tomorrow", `${task.title} is due tomorrow (${task.due})`);
      task.notifiedSoon = true;
      saveTasks();
      return;
    }
  }

  function runRemindersCheck() {
    tasks.forEach(t => checkRemindersForTask(t));
  }

  // run once
  runRemindersCheck();

  // periodic check while page is open
  const REMINDER_INTERVAL_MS = 60 * 1000; // every minute
  setInterval(runRemindersCheck, REMINDER_INTERVAL_MS);

  // also check when tab becomes active
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) runRemindersCheck();
  });

  // --- Init render ---
  renderTasks();

  // expose for debug (optional)
  window.__planner_tasks = tasks;
  window.__planner_save = saveTasks;
})();
