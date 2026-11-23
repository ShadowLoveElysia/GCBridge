const $ = (id) => document.getElementById(id);
const token = location.hash.slice(1);
history.replaceState(null, "", location.pathname);
let selected = null,
  settings = null;
const notify = (message, error = false) => {
  const t = $("toast");
  t.textContent = message;
  t.classList.remove("hidden");
  t.classList.toggle("error", error);
  setTimeout(() => t.classList.add("hidden"), 6500);
};
async function api(path, body) {
  const r = await fetch(`/api/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error?.message ?? "操作失败");
  return data.result;
}
async function busy(button, fn) {
  button.disabled = true;
  try {
    await fn();
  } catch (e) {
    notify(e.message, true);
  } finally {
    button.disabled = false;
  }
}
const action = (operation, extra = {}) => api("action", { operation, ...extra });
async function refreshStatus() {
  try {
    const s = await api("status");
    $("runtime-status").textContent = s.running ? "Bridge 正在运行" : "Bridge 已关闭";
    $("runtime-dot").classList.toggle("on", s.running);
    $("runtime-detail").textContent = s.running
      ? `协作模型：${s.model} · 后台 PID ${s.pid} · 无头 Oh My Pi`
      : "打开控制台不会自动启动 Bridge，也不会请求模型。";
    $("start").disabled = s.running;
    $("stop").disabled = !s.running;
    $("save").disabled = s.running;
  } catch (e) {
    notify(e.message, true);
  }
}
async function loadSettings() {
  const s = await api("settings");
  settings = s.config;
  $("discussion-role").value = s.config.discussion.role;
  $("task-instructions").value = s.config.discussion.taskInstructions;
  const d = s.config.director,
    l = s.config.limits;
  for (const k of ["model", "api", "baseUrl", "reasoning", "contextWindow", "maxOutputTokens"])
    $(k).value = d[k];
  for (const k of ["maxTurns", "maxSessionTokens", "maxConcurrent", "maxInputChars"])
    $(k).value = l[k];
  $("timeout").value = l.timeoutMs / 1000;
  $("key-state").textContent = s.credentialPresent ? "已安全保存 · 不回显" : "尚未配置";
  for (const k of ["input", "output", "cacheRead", "cacheWrite"])
    $(`price-${k}`).value = d.pricing?.[k] ?? "";
  window.dispatchEvent(new CustomEvent("gc-settings", { detail: s.config }));
}
$("config-form").addEventListener("submit", (e) => {
  e.preventDefault();
  busy($("save"), async () => {
    const director = { ...settings.director };
    for (const k of ["model", "api", "baseUrl", "reasoning"]) director[k] = $(k).value.trim();
    for (const k of ["contextWindow", "maxOutputTokens"]) director[k] = Number($(k).value);
    const prices = ["input", "output", "cacheRead", "cacheWrite"];
    if (prices.every((k) => $(`price-${k}`).value !== ""))
      director.pricing = Object.fromEntries(prices.map((k) => [k, Number($(`price-${k}`).value)]));
    else if (prices.some((k) => $(`price-${k}`).value !== ""))
      throw new Error("计费估算请填写全部四项，或全部留空");
    else delete director.pricing;
    const limits = { ...settings.limits, timeoutMs: Number($("timeout").value) * 1000 };
    for (const k of ["maxTurns", "maxSessionTokens", "maxConcurrent", "maxInputChars"])
      limits[k] = Number($(k).value);
    await api("settings", {
      config: {
        version: 1,
        director,
        discussion: {
          role: $("discussion-role").value.trim(),
          taskInstructions: $("task-instructions").value,
        },
        limits,
        profiles: window.gcProfiles?.values() ?? settings.profiles,
        presets: window.gcPresets ?? settings.presets,
      },
      profileSecrets: window.gcProfiles?.secrets() ?? {},
      secret: $("secret").value || undefined,
      clearSecret: $("clearSecret").checked,
    });
    $("secret").value = "";
    $("clearSecret").checked = false;
    await loadSettings();
    notify("配置已保存，Bridge 保持关闭。");
  });
});
$("start").onclick = () =>
  busy($("start"), async () => {
    await action("start");
    await refreshStatus();
    notify("Bridge 已启动；有具体议题时才会请求模型。");
  });
$("stop").onclick = () =>
  busy($("stop"), async () => {
    await action("stop");
    await refreshStatus();
    notify("后台已停止。");
  });
for (const button of document.querySelectorAll(".tab"))
  button.onclick = () => {
    for (const t of document.querySelectorAll(".tab")) t.classList.toggle("active", t === button);
    for (const view of document.querySelectorAll(".view"))
      view.classList.toggle("hidden", view.id !== button.dataset.view);
    if (button.dataset.view === "history") loadHistory().catch((e) => notify(e.message, true));
  };
async function loadHistory() {
  const data = await action("list");
  $("session-count").textContent = `${data.sessions.length}`;
  $("session-list").replaceChildren();
  if (!data.sessions.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "还没有讨论。启动 Bridge 后，在 Codex 中开始你的第一个议题。";
    $("session-list").append(p);
  }
  for (const s of data.sessions) {
    const b = document.createElement("button");
    b.className = "session";
    b.classList.toggle("selected", selected === s.id);
    const strong = document.createElement("strong");
    strong.textContent = s.title;
    const small = document.createElement("small");
    small.textContent = `${s.turns} 轮 · ${s.totalTokens} tokens · ${new Date(s.updatedAt).toLocaleString()}`;
    b.append(strong, small);
    b.onclick = () => read(s.id).catch((e) => notify(e.message, true));
    $("session-list").append(b);
  }
}
async function read(id) {
  const s = await action("read", { sessionId: id });
  selected = id;
  $("chat-title").textContent = s.title;
  for (const k of ["resume", "export", "delete"]) $(k).disabled = false;
  $("messages").replaceChildren();
  for (const turn of s.turns) {
    const role = document.createElement("p");
    role.className = "message-role";
    role.textContent = `CODEX · ${turn.mode.toUpperCase()}`;
    const p = document.createElement("pre");
    p.textContent = turn.prompt;
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = `${turn.collaborator?.model ?? "协作模型"} · 查看完整回复`;
    const reply = document.createElement("pre");
    reply.textContent = turn.text;
    details.append(summary, reply);
    $("messages").append(role, p, details);
  }
  if (!s.turns.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "这段讨论尚无模型回复。";
    $("messages").append(p);
  }
  await loadHistory();
  window.dispatchEvent(new CustomEvent("gc-discussion", { detail: s }));
}
$("refresh").onclick = () => busy($("refresh"), loadHistory);
$("resume").onclick = () =>
  busy($("resume"), async () => {
    await action("resume", { sessionId: selected });
    notify("已选定讨论。回到 Codex 时传入这个 sessionId，即可继续。");
  });
$("export").onclick = () =>
  busy($("export"), async () => {
    const result = await action("export", { sessionId: selected });
    const url = URL.createObjectURL(
      new Blob([result.markdown], { type: "text/markdown;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `gc-discussion-${selected}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
$("delete").onclick = () =>
  busy($("delete"), async () => {
    const preview = await action("delete_preview", { sessionId: selected });
    $("delete-scope").textContent = `「${preview.title}」 · ${preview.turns} 轮讨论`;
    $("delete-dialog").showModal();
    const answer = await new Promise((resolve) =>
      $("delete-dialog").addEventListener("close", () => resolve($("delete-dialog").returnValue), {
        once: true,
      }),
    );
    if (answer !== "confirm") return;
    await action("delete", {
      sessionId: preview.sessionId,
      confirmationId: preview.confirmationId,
    });
    selected = null;
    window.dispatchEvent(new CustomEvent("gc-cleared"));
    $("messages").replaceChildren();
    $("chat-title").textContent = "选择一段讨论";
    for (const k of ["resume", "export", "delete"]) $(k).disabled = true;
    await loadHistory();
    notify("已删除选中的讨论。");
  });
$("install").onclick=()=>busy($("install"),async()=>{
 const detected=await api("detect-codex");
 const panel=$("codex-targets");panel.replaceChildren();
 for(const warning of detected.warnings){const p=document.createElement("p");p.className="hint";p.textContent=warning;panel.append(p);}
 for(const target of detected.targets){
  const card=document.createElement("section");card.className="record";
  const title=document.createElement("h3");title.textContent=`${target.label} · ${target.detected?"已检测":"未确认安装"}`;
  const location=document.createElement("p");location.className="hint";location.textContent=`安装位置：${target.executable??"未确认，可在目标客户端确认配置路径后接入"}`;
  const input=document.createElement("input");input.value=target.configRoot;input.autocomplete="off";input.setAttribute("aria-label",`${target.label} 配置目录`);
  const note=document.createElement("p");note.className="hint";note.textContent=[target.sharedConfig?"共享配置：若 CLI/Desktop 使用此目录，注入会影响所有读取者。":"",target.detail??""].filter(Boolean).join(" ");
  const inject=document.createElement("button");inject.className="secondary";inject.textContent=`注入 ${target.kind==="cli"?"CLI":"Desktop"}`;
  inject.onclick=()=>busy(inject,async()=>{
   const result=await api("install",{targetId:target.id,configRoot:input.value.trim()});
   $("install-result").textContent=JSON.stringify(result,null,2);$("install-result").classList.remove("hidden");notify("所选环境已接入，请重启对应 Codex 客户端。Bridge 未自动启动。");
  });
  card.append(title,location,input,note,inject);panel.append(card);
 }
});

Promise.all([loadSettings(), refreshStatus()]).catch((e) => notify(e.message, true));
setInterval(refreshStatus, 5000);

window.gcUi = { action, notify, busy, read, loadHistory };

api("components").then(c=>{$("component-state").textContent=c.ready?`Oh My Pi ${c.ohMyPi.version} · ${c.platform}/${c.architecture} · ${c.ohMyPi.bundled?"内置组件已就绪，无需安装 Node/Bun/WSL":"源码运行时已就绪"}`:"Oh My Pi 组件未就绪，请重新获取当前平台构建";}).catch(()=>{$("component-state").textContent="组件检查未完成，请检查当前平台构建。";});
