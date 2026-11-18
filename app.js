import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (value = "") => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const labels = { member: "УЧАСТНИК", deputy: "ЗАМЕСТИТЕЛЬ", leader: "ЛИДЕР", developer: "РАЗРАБОТЧИК" };
let db = null, user = null, profile = null, role = "guest", roster = [], posts = [], polls = [], myVotes = new Map(), reportRows = [], editingReportId = null, authMode = "login", toastTimer;

function toast(message, bad = false) {
  const t = $("#toast"); t.textContent = message; t.classList.remove("hidden"); t.classList.toggle("bad", bad);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add("hidden"), 4200);
}
function empty(message) { return `<div class="empty">${esc(message)}</div>`; }
function roleLabel(value) { return labels[value] ?? labels.member; }
function kyivDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const v = Object.fromEntries(parts.map(p => [p.type, p.value])); return `${v.year}-${v.month}-${v.day}`;
}
function route(name) {
  if (name === "reports" && !user) { openAuth("login"); toast("Войди, чтобы отправить отчёт", true); return; }
  if (name === "admin" && !["leader", "deputy", "developer"].includes(role)) { toast("Раздел доступен штабу клана", true); return; }
  $$(".page").forEach(p => p.classList.toggle("active", p.dataset.page === name));
  $$(".navlink").forEach(b => b.classList.toggle("active", b.dataset.route === name));
  $(".navlinks").classList.remove("open"); history.replaceState(null, "", `#${name}`); window.scrollTo({ top: 0, behavior: "smooth" });
}
function showAuthMode(mode) {
  authMode = mode; const registering = mode === "register";
  $("#authTitle").textContent = registering ? "СОЗДАТЬ АККАУНТ" : "ВОЙТИ";
  $("#authSubmit").textContent = registering ? "ЗАРЕГИСТРИРОВАТЬСЯ ↗" : "ВОЙТИ ↗";
  $("#nicknameField").classList.toggle("hidden", !registering);
  $("#tabLogin").classList.toggle("active", !registering); $("#tabRegister").classList.toggle("active", registering);
  $("#authForm").elements.nickname.required = registering;
  $("#authForm").elements.password.autocomplete = registering ? "new-password" : "current-password";
}
function openAuth(mode) { showAuthMode(mode); $("#authDialog").showModal(); }
function markSession(session) {
  user = session?.user ?? null; role = user?.app_metadata?.role ?? "member";
  document.body.classList.toggle("signed-in", !!user);
  document.body.classList.remove("role-member", "role-deputy", "role-leader", "role-developer");
  if (user) document.body.classList.add(`role-${role}`);
  $("#openLogin").classList.toggle("hidden", !!user); $("#openRegister").classList.toggle("hidden", !!user); $("#logout").classList.toggle("hidden", !user);
  $("#userBadge").classList.toggle("hidden", !user); $("#userBadge").textContent = user ? `${profile?.nickname ?? user.user_metadata?.player_id ?? "Участник"} · ${roleLabel(role)}` : "";
  $("#bootstrapBox").classList.toggle("hidden", !user || role === "developer");
  $$(".staff-only").forEach(el => el.classList.toggle("hidden", !["leader", "deputy", "developer"].includes(role)));
  $$(".developer-only").forEach(el => el.classList.toggle("hidden", role !== "developer"));
}
async function loadProfile() {
  if (!user) { profile = null; markSession(null); return; }
  const { data, error } = await db.from("profiles").select("user_id,player_id,nickname,role").eq("user_id", user.id).maybeSingle();
  if (error) console.warn("Profile lookup failed", error.message);
  profile = data ?? null;
  if (profile && user.app_metadata?.role !== profile.role) { role = user.app_metadata?.role ?? "member"; }
  markSession({ user });
}
async function loadRoster() {
  const { data, error } = await db.rpc("get_public_roster");
  if (error) throw error; roster = data ?? [];
  $("#memberCount").textContent = roster.length;
  $("#statMembers").textContent = roster.length;
  $("#statWeek").textContent = (roster.reduce((n, p) => n + Number(p.weekly_neurons), 0)).toLocaleString("ru-RU");
  $("#statMonth").textContent = (roster.reduce((n, p) => n + Number(p.monthly_neurons), 0)).toLocaleString("ru-RU");
  $("#statAll").textContent = roster.reduce((n, p) => n + Number(p.total_neurons), 0).toLocaleString("ru-RU");
  renderRoster(); renderTop();
}
function renderTop() {
  const top = roster.slice(0, 5); $("#topRoster").innerHTML = top.length ? top.map((p, i) => `<div class="mini-row"><span class="rank-no">${String(i + 1).padStart(2, "0")}</span><div><strong>${esc(p.nickname)}</strong><small>${roleLabel(p.role)}</small></div><span class="row-value">${Number(p.total_neurons).toLocaleString("ru-RU")} N</span></div>`).join("") : empty("Состав пока пуст. Зарегистрируйся первым!");
}
function renderRoster() {
  const q = $("#rosterSearch").value.trim().toLocaleLowerCase("ru-RU"), key = $("#rosterPeriod").value;
  const rows = roster.filter(p => p.nickname.toLocaleLowerCase("ru-RU").includes(q));
  $("#rosterGrid").innerHTML = rows.length ? rows.map((p, i) => `<article class="member-card"><div class="member-head"><div class="avatar">${esc(p.nickname.slice(0, 2).toLocaleUpperCase("ru-RU"))}</div><div><h3>${esc(p.nickname)}</h3><small>${roleLabel(p.role)} · В КЛАНЕ С ${new Date(`${p.joined_on}T12:00:00`).toLocaleDateString("ru-RU")}</small></div></div><div class="member-score"><span>РЕЙТИНГ</span><strong>${Number(p[key]).toLocaleString("ru-RU")} НЕЙРОНОВ</strong></div></article>`).join("") : empty("Пока никого не нашли.");
}
async function loadPosts() {
  const { data, error } = await db.from("posts").select("id,title,body,author_name,author_role,created_at").order("created_at", { ascending: false }).limit(40);
  if (error) throw error; posts = data ?? [];
  $("#latestPost").textContent = posts[0] ? new Date(posts[0].created_at).toLocaleDateString("ru-RU") : "НЕТ ПОСТОВ";
  const render = list => list.length ? list.map(p => `<article class="post-card"><div class="post-meta">${roleLabel(p.author_role)} · ${esc(p.author_name)} · ${new Date(p.created_at).toLocaleString("ru-RU")}</div><h2>${esc(p.title)}</h2><p>${esc(p.body)}</p>${["leader","deputy","developer"].includes(role) ? `<button class="text-button danger" data-delete-post="${esc(p.id)}">УДАЛИТЬ ПОСТ</button>` : ""}</article>`).join("") : empty("Пока нет публикаций штаба.");
  $("#postsList").innerHTML = render(posts);
  $("#homePosts").innerHTML = posts.length ? posts.slice(0, 2).map(p => `<div class="mini-row"><div><strong>${esc(p.title)}</strong><small>${esc(p.author_name)} · ${new Date(p.created_at).toLocaleDateString("ru-RU")}</small></div></div>`).join("") : empty("Пока нет свежих постов.");
}
async function loadPolls() {
  const { data, error } = await db.rpc("get_public_polls"); if (error) throw error; polls = Array.isArray(data) ? data : [];
  myVotes.clear();
  if (user) { const { data: votes, error: voteError } = await db.from("poll_votes").select("poll_id,option_id").eq("user_id", user.id); if (!voteError) (votes ?? []).forEach(v => myVotes.set(v.poll_id, v.option_id)); }
  renderPolls();
}
function renderPolls() {
  $("#pollsList").innerHTML = polls.length ? polls.map(p => {
    const total = p.options.reduce((n, o) => n + Number(o.votes), 0), selected = myVotes.get(p.id), closed = p.closes_at && new Date(p.closes_at) <= new Date();
    const options = p.options.map(o => { const percent = total ? Math.round(Number(o.votes) / total * 100) : 0; return `<label class="poll-option"><input type="radio" name="vote-${p.id}" value="${esc(o.id)}" ${selected === o.id ? "checked" : ""} ${closed || !user ? "disabled" : ""}><span>${esc(o.label)}</span><span class="bar"><i style="width:${percent}%"></i></span><small>${percent}% · ${Number(o.votes)}</small></label>`; }).join("");
    return `<article class="poll-card"><div class="post-meta">${closed ? "ЗАКРЫТ" : "ОТКРЫТ"}${p.closes_at ? ` · ДО ${new Date(p.closes_at).toLocaleString("ru-RU")}` : " · БЕЗ СРОКА"}</div><h2>${esc(p.question)}</h2>${options}<div class="poll-foot"><span>${total} голосов</span><span>${!closed ? `<button class="btn btn-small btn-ghost" data-vote="${esc(p.id)}" ${!user ? "disabled" : ""}>${selected ? "ИЗМЕНИТЬ ГОЛОС" : "ПРОГОЛОСОВАТЬ"}</button>` : "ГОЛОСОВАНИЕ ЗАКРЫТО"}${!closed && ["leader","deputy","developer"].includes(role) ? ` <button class="text-button danger" data-close-poll="${esc(p.id)}">ЗАКРЫТЬ</button>` : ""}</span></div></article>`;
  }).join("") : empty("Пока нет голосований от штаба.");
}
async function loadReports() {
  if (!user) return;
  const { data, error } = await db.from("daily_reports").select("id,report_date,neurons,note,created_at").eq("user_id", user.id).order("report_date", { ascending: false }).limit(30);
  if (error) throw error;
  reportRows = data ?? [];
  $("#myReports").innerHTML = reportRows.length ? reportRows.map(r => `<div class="report-row"><div><strong>${new Date(`${r.report_date}T12:00:00`).toLocaleDateString("ru-RU")}</strong><small>${esc(r.note || "Без заметки")}</small></div><span class="row-value">+${Number(r.neurons).toLocaleString("ru-RU")} N</span><button class="text-button" data-edit-report="${esc(r.id)}">ИЗМЕНИТЬ</button></div>`).join("") : empty("Отчётов ещё нет. Отправь первый!");
}
function resetReportEditor() {
  editingReportId = null; $("#reportForm").reset();
  $("#reportFormTitle").textContent = "СЕГОДНЯ · КИЕВ";
  $("#reportSubmit").textContent = "ОТПРАВИТЬ ОТЧЁТ ↗";
  $("#cancelReportEdit").classList.add("hidden");
}
async function loadRoleList() {
  if (role !== "developer") return;
  const { data, error } = await db.from("profiles").select("user_id,player_id,nickname,role").is("kicked_at", null).order("nickname");
  if (error) throw error;
  $("#roleList").innerHTML = data?.length ? data.map(p => `<div class="role-row"><strong>${esc(p.nickname)}</strong><small>${esc(p.player_id)}</small><select data-role-user="${esc(p.player_id)}" aria-label="Роль для ${esc(p.nickname)}"><option value="member" ${p.role === "member" ? "selected" : ""}>Участник</option><option value="deputy" ${p.role === "deputy" ? "selected" : ""}>Заместитель</option><option value="leader" ${p.role === "leader" ? "selected" : ""}>Лидер</option><option value="developer" ${p.role === "developer" ? "selected" : ""}>Разработчик</option></select></div>`).join("") : empty("Нет аккаунтов.");
}
async function loadKickList() {
  if (!["leader", "deputy", "developer"].includes(role)) return;
  const { data, error } = await db.from("profiles").select("player_id,nickname,role").is("kicked_at", null).order("nickname");
  if (error) throw error;
  const canKick = targetRole => role === "leader" ? ["member", "deputy"].includes(targetRole)
    : role === "deputy" ? targetRole === "member"
    : role === "developer" ? ["member", "deputy", "leader"].includes(targetRole) : false;
  $("#kickList").innerHTML = data?.length ? data.map(p => {
    const allowed = canKick(p.role) && p.player_id !== user?.user_metadata?.player_id;
    return `<div class="role-row"><div><strong>${esc(p.nickname)}</strong><small>${esc(p.player_id)} · ${roleLabel(p.role)}</small></div><button class="btn btn-small btn-ghost danger" data-kick-user="${esc(p.player_id)}" ${allowed ? "" : "disabled"}>ИСКЛЮЧИТЬ</button></div>`;
  }).join("") : empty("Нет активных аккаунтов.");
}
async function refreshAll() {
  try { await Promise.all([loadRoster(), loadPosts(), loadPolls()]); if (user) await Promise.all([loadReports(), loadRoleList(), loadKickList()]); }
  catch (e) { console.error(e); toast(`Не удалось загрузить данные: ${e.message ?? e}`, true); }
}
function errMessage(error) { return error?.message || error?.context?.error || "Что-то пошло не так."; }

$$("[data-route]").forEach(b => b.addEventListener("click", () => route(b.dataset.route)));
$("#menu").addEventListener("click", () => $(".navlinks").classList.toggle("open"));
$("#openLogin").addEventListener("click", () => openAuth("login")); $("#openRegister").addEventListener("click", () => openAuth("register"));
$("#tabLogin").addEventListener("click", () => showAuthMode("login")); $("#tabRegister").addEventListener("click", () => showAuthMode("register"));
$$("[data-close-dialog]").forEach(b => b.addEventListener("click", () => $("#authDialog").close()));
$("#authDialog").addEventListener("click", e => { if (e.target === $("#authDialog")) $("#authDialog").close(); });
$("#rosterSearch").addEventListener("input", renderRoster); $("#rosterPeriod").addEventListener("change", renderRoster);
function applyAccent(color, save = true) {
  const hex = /^#[\da-f]{6}$/i.test(color) ? color : "#b6f34a";
  const rgb = hex.match(/[\da-f]{2}/gi).map(part => parseInt(part, 16)).join(",");
  document.documentElement.style.setProperty("--accent", hex);
  document.documentElement.style.setProperty("--accent-rgb", rgb);
  $("#accentPicker").value = hex;
  $$(".swatch").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.color.toLowerCase() === hex.toLowerCase())));
  if (save) { try { localStorage.setItem("askorbinki-accent", hex); } catch {} }
}
function applyTheme(theme, save = true) {
  const value = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = value;
  $("#themeToggle").textContent = value === "dark" ? "ВКЛЮЧИТЬ ДНЕВНУЮ" : "ВКЛЮЧИТЬ НОЧНУЮ";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", value === "dark" ? "#0b100d" : "#edf3e9");
  if (save) { try { localStorage.setItem("askorbinki-theme", value); } catch {} }
}
try {
  applyAccent(localStorage.getItem("askorbinki-accent") || "#b6f34a", false);
  applyTheme(localStorage.getItem("askorbinki-theme") || "dark", false);
} catch { applyAccent("#b6f34a", false); applyTheme("dark", false); }
$("#themeToggle").addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
$(".swatches").addEventListener("click", event => {
  const button = event.target.closest(".swatch"); if (button) applyAccent(button.dataset.color);
});
$("#accentPicker").addEventListener("input", event => applyAccent(event.currentTarget.value));
$("#year").textContent = new Date().getFullYear();

const cfg = window.ASKORBINKI_CONFIG ?? {};
if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
  const n = $("#backendNotice"); n.textContent = "Backend пока не подключён. Заполни supabaseUrl и supabaseAnonKey в config.js, затем выполни настройку по README. Сайт не хранит аккаунты локально."; n.classList.remove("hidden");
  ["#memberCount", "#statMembers", "#statWeek", "#statMonth", "#statAll"].forEach(s => $(s).textContent = "—");
  $("#homePosts").innerHTML = empty("Данные появятся после подключения базы."); $("#topRoster").innerHTML = empty("Данные появятся после подключения базы.");
  $("#postsList").innerHTML = empty("Подключи Supabase, чтобы читать посты."); $("#pollsList").innerHTML = empty("Подключи Supabase, чтобы читать голосования."); $("#rosterGrid").innerHTML = empty("Подключи Supabase, чтобы увидеть состав.");
  ["#openLogin", "#openRegister"].forEach(s => $(s).addEventListener("click", () => toast("Сначала подключи Supabase по инструкции README", true)));
} else {
  db = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  const { data: sessionData } = await db.auth.getSession(); user = sessionData.session?.user ?? null;
  if (user) await loadProfile();
  await refreshAll();
  db.auth.onAuthStateChange(async (_event, session) => { user = session?.user ?? null; await loadProfile(); await refreshAll(); });

  $("#authForm").addEventListener("submit", async e => {
    e.preventDefault(); const f = new FormData(e.currentTarget), playerId = String(f.get("playerId")).trim().toLowerCase(), password = String(f.get("password"));
    const button = $("#authSubmit"); button.disabled = true;
    try {
      if (authMode === "register") {
        const nickname = String(f.get("nickname")).trim();
        const { error } = await db.functions.invoke("register", { body: { playerId, nickname, password } }); if (error) throw error;
        const { data, error: loginError } = await db.functions.invoke("login", { body: { playerId, password } }); if (loginError) throw loginError;
        const { error: sessionError } = await db.auth.setSession(data.session); if (sessionError) throw sessionError;
        toast("Аккаунт создан. Добро пожаловать в стаю!");
      } else {
        const { data, error } = await db.functions.invoke("login", { body: { playerId, password } }); if (error) throw error;
        const { error: sessionError } = await db.auth.setSession(data.session); if (sessionError) throw sessionError;
        toast("Вход выполнен");
      }
      $("#authDialog").close(); e.currentTarget.reset();
    } catch (error) { toast(errMessage(error), true); }
    finally { button.disabled = false; }
  });

  $("#logout").addEventListener("click", async () => { await db.auth.signOut(); profile = null; markSession(null); toast("Ты вышел из аккаунта"); });
  $("#myReports").addEventListener("click", e => {
    const button = e.target.closest("[data-edit-report]"); if (!button) return;
    const report = reportRows.find(row => row.id === button.dataset.editReport); if (!report) return;
    editingReportId = report.id;
    $("#reportForm").elements.neurons.value = report.neurons;
    $("#reportForm").elements.note.value = report.note ?? "";
    $("#reportFormTitle").textContent = `ИЗМЕНИТЬ ОТЧЁТ · ${new Date(`${report.report_date}T12:00:00`).toLocaleDateString("ru-RU")}`;
    $("#reportSubmit").textContent = "СОХРАНИТЬ ИЗМЕНЕНИЯ";
    $("#cancelReportEdit").classList.remove("hidden");
    $("#reportForm").scrollIntoView({ behavior: "smooth", block: "center" });
  });
  $("#cancelReportEdit").addEventListener("click", resetReportEditor);
  $("#reportForm").addEventListener("submit", async e => {
    e.preventDefault(); if (!user) return openAuth("login"); const f = new FormData(e.currentTarget);
    const values = { neurons: Number(f.get("neurons")), note: String(f.get("note") ?? "").trim() };
    const result = editingReportId
      ? await db.from("daily_reports").update(values).eq("id", editingReportId).eq("user_id", user.id)
      : await db.from("daily_reports").insert({ ...values, user_id: user.id, report_date: kyivDate() });
    if (result.error) { toast(!editingReportId && result.error.code === "23505" ? "За сегодня отчёт уже отправлен." : errMessage(result.error), true); return; }
    const wasEdit = Boolean(editingReportId); resetReportEditor();
    toast(wasEdit ? "Отчёт обновлён." : "Нейроны начислены и добавлены в рейтинг."); await Promise.all([loadReports(), loadRoster()]);
  });
  $("#postForm").addEventListener("submit", async e => {
    e.preventDefault(); if (!profile || !["leader", "deputy", "developer"].includes(role)) return;
    const f = new FormData(e.currentTarget), { error } = await db.from("posts").insert({ author_id: user.id, author_name: profile.nickname, author_role: role, title: String(f.get("title")).trim(), body: String(f.get("body")).trim() });
    if (error) { toast(errMessage(error), true); return; } e.currentTarget.reset(); toast("Пост опубликован"); await loadPosts();
  });
  $("#pollForm").addEventListener("submit", async e => {
    e.preventDefault(); if (!user || !["leader", "deputy", "developer"].includes(role)) return;
    const f = new FormData(e.currentTarget), options = String(f.get("options")).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (options.length < 2 || options.length > 8 || options.some(s => s.length > 120)) { toast("Нужно 2–8 вариантов, каждый до 120 символов", true); return; }
    const duration = Number(f.get("duration")), closes_at = duration ? new Date(Date.now() + duration * 3600000).toISOString() : null;
    const { data: poll, error } = await db.from("polls").insert({ author_id: user.id, question: String(f.get("question")).trim(), closes_at }).select("id").single();
    if (error) { toast(errMessage(error), true); return; }
    const { error: optionError } = await db.from("poll_options").insert(options.map(label => ({ poll_id: poll.id, label })));
    if (optionError) { await db.from("polls").delete().eq("id", poll.id); toast(errMessage(optionError), true); return; }
    e.currentTarget.reset(); toast("Голосование опубликовано"); await loadPolls();
  });
  $("#pollsList").addEventListener("click", async e => {
    const close = e.target.closest("[data-close-poll]");
    if (close) { if (!confirm("Закрыть голосование сейчас?")) return; const { error } = await db.from("polls").update({ closes_at: new Date().toISOString() }).eq("id", close.dataset.closePoll); if (error) toast(errMessage(error), true); else { toast("Голосование закрыто"); await loadPolls(); } return; }
    const btn = e.target.closest("[data-vote]"); if (!btn) return;
    if (!user) return openAuth("login"); const pollId = btn.dataset.vote, optionId = $(`input[name="vote-${CSS.escape(pollId)}"]:checked`)?.value;
    if (!optionId) { toast("Выбери вариант ответа", true); return; }
    const existing = myVotes.get(pollId);
    const result = existing ? await db.from("poll_votes").update({ option_id: optionId }).eq("poll_id", pollId).eq("user_id", user.id) : await db.from("poll_votes").insert({ poll_id: pollId, option_id: optionId, user_id: user.id });
    if (result.error) toast(errMessage(result.error), true); else { toast("Голос учтён"); await loadPolls(); }
  });
  $("#postsList").addEventListener("click", async e => { const b = e.target.closest("[data-delete-post]"); if (!b || !confirm("Удалить этот пост?")) return; const { error } = await db.from("posts").delete().eq("id", b.dataset.deletePost); if (error) toast(errMessage(error), true); else { toast("Пост удалён"); await loadPosts(); } });
  $("#roleList").addEventListener("change", async e => {
    const sel = e.target.closest("[data-role-user]"); if (!sel) return;
    const { error } = await db.functions.invoke("manage-role", { body: { playerId: sel.dataset.roleUser, role: sel.value } });
    if (error) { toast(errMessage(error), true); await loadRoleList(); return; } toast("Роль обновлена. Новый доступ появится после следующего входа."); await loadRoleList();
  });
  $("#kickList").addEventListener("click", async e => {
    const button = e.target.closest("[data-kick-user]"); if (!button) return;
    const playerId = button.dataset.kickUser;
    if (!confirm(`Исключить аккаунт ${playerId} из клана? Его отчёты и публикации останутся в истории.`)) return;
    button.disabled = true;
    const { error } = await db.functions.invoke("kick-member", { body: { playerId } });
    if (error) { toast(errMessage(error), true); await loadKickList(); return; }
    toast("Аккаунт исключён из клана."); await Promise.all([loadKickList(), loadRoster(), loadRoleList()]);
  });
  $("#bootstrapForm").addEventListener("submit", async e => {
    e.preventDefault(); const f = new FormData(e.currentTarget), playerId = String(f.get("playerId")).trim().toLowerCase(), secret = String(f.get("secret"));
    const { error } = await db.functions.invoke("bootstrap-developer", { body: { playerId }, headers: { "x-bootstrap-secret": secret } });
    e.currentTarget.reset();
    if (error) { toast(errMessage(error), true); return; }
    toast("Ты назначен разработчиком. Войди снова, чтобы обновились права."); await db.auth.signOut(); profile = null; markSession(null); setTimeout(() => openAuth("login"), 900);
  });
  if (location.hash.startsWith("#")) { const desired = location.hash.slice(1); if ($(`[data-page="${CSS.escape(desired)}"]`)) route(desired); }
}
