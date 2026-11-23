(() => {
  const $ = (id) => document.getElementById(id),
    ui = window.gcUi;
  let discussion = null,
    data = null,
    config = null,
    preview = null;
  const node = (tag, text, className) => {
    const e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (className) e.className = className;
    return e;
  };
  const labels = {
    viewpoint: "观点",
    consensus: "共识",
    disagreement: "分歧",
    question: "待澄清",
    proposed: "待讨论",
    adopted: "采纳",
    adjusted: "调整后采纳",
    deferred: "暂缓",
    rejected: "拒绝",
  };
  const run = (button, fn) => ui.busy(button, fn);
  const call = (operation, extra = {}) =>
    ui.action(operation, { sessionId: discussion?.sessionId, ...extra });
  const option = (value, text) => {
    const e = node("option", text);
    e.value = value;
    return e;
  };
  const button = (text, fn) => {
    const b = node("button", text, "secondary");
    b.type = "button";
    b.onclick = () => run(b, fn);
    return b;
  };
  const checks = (target, items, prefix) => {
    $(target).replaceChildren();
    for (const item of items) {
      const label = node("label", undefined, "selection-item"),
        input = node("input");
      input.type = "checkbox";
      input.value = item.id;
      input.dataset.group = prefix;
      label.append(input, node("span", item.title));
      $(target).append(label);
    }
  };
  const selected = (group) =>
    [...document.querySelectorAll(`input[data-group="${group}"]:checked`)].map((e) => e.value);
  const invalidate = () => {
    preview = null;
    $("preview-send").classList.add("hidden");
    $("send-preview").classList.add("hidden");
  };
  async function refresh() {
    await ui.read(discussion.sessionId);
  }
  function renderWorkspace() {
    $("workspace-panel").classList.remove("hidden");
    $("branch-round").replaceChildren(
      ...Array.from({ length: discussion.turns.length + 1 }, (_, i) =>
        option(String(i), i ? `第 ${i} 轮之后` : "不继承历史"),
      ),
    );
    $("branch-round").value = String(discussion.turns.length);
    $("branch-info").textContent = data.parent
      ? `来自「${data.parent.title}」第 ${data.parent.throughTurn} 轮；历史独立保存。`
      : "";
    $("opinion-source").replaceChildren(
      option("", "用户补充"),
      ...discussion.turns.map((t, i) =>
        option(t.requestId, `第 ${i + 1} 轮 · ${t.collaborator?.model ?? "协作模型"}`),
      ),
    );
    $("opinion-list").replaceChildren();
    for (const kind of ["viewpoint", "consensus", "disagreement", "question"]) {
      const items = data.opinions.filter((o) => o.kind === kind);
      if (!items.length) continue;
      $("opinion-list").append(node("h4", labels[kind]));
      for (const item of items) {
        const card = node("div", undefined, "record");
        card.append(
          node("strong", `${labels[item.status]} · ${item.author}`),
          node("p", item.text),
          node("small", `来源：${item.sourceRequestId ?? "用户补充"}`),
          node("p", item.rationale || "尚未记录理由"),
          button("编辑记录", () => {
            for (const [id, key] of [
              ["opinion-id", "id"],
              ["opinion-text", "text"],
              ["opinion-kind", "kind"],
              ["opinion-status", "status"],
              ["opinion-source", "sourceRequestId"],
              ["opinion-author", "author"],
              ["opinion-reason", "rationale"],
            ])
              $(id).value = item[key] ?? "";
          }),
        );
        $("opinion-list").append(card);
      }
    }
    $("material-list").replaceChildren();
    for (const m of data.contextItems) {
      const details = node("details");
      details.append(node("summary", m.title), node("pre", m.text));
      $("material-list").append(details);
    }
    checks(
      "history-selection",
      discussion.turns.map((t, i) => ({
        id: t.requestId,
        title: `第 ${i + 1} 轮 · ${t.prompt.slice(0, 70)}`,
      })),
      "turn",
    );
    checks("material-selection", data.contextItems, "material");
    $("snapshot-list").replaceChildren();
    $("snapshot-diff").replaceChildren();
    for (const snap of data.snapshots)
      $("snapshot-list").append(
        button(`${snap.title} · ${snap.throughTurn} 轮`, () => {
          const result = call("snapshot_read", { snapshotId: snap.id });
          return result.then((r) => {
            const details = node("details");
            details.open = true;
            details.append(node("summary", snap.title), node("pre", r.snapshot.markdown));
            $("snapshot-list").append(details);
          });
        }),
      );
    for (const id of ["snapshot-base", "snapshot-target"])
      $(id).replaceChildren(...data.snapshots.map((s) => option(s.id, s.title)));
    if (data.snapshots.length) $("snapshot-target").value = data.snapshots.at(-1).id;
    renderTargets();
    invalidate();
  }
  function renderTargets() {
    $("branch-profile").replaceChildren(
      option("", "保留当前讨论模型"),
      ...(config?.profiles ?? []).map((p) => option(p.id, p.label)),
    );
    checks(
      "compare-targets",
      (config?.profiles ?? []).map((p) => ({
        id: p.id,
        title: `${p.label} · ${p.director.model}`,
      })),
      "profile",
    );
  }
  window.addEventListener("gc-discussion", async (event) => {
    const current = event.detail;
    discussion = current;
    try {
      const result = await ui.action("workspace", { sessionId: current.sessionId });
      if (discussion?.sessionId !== current.sessionId) return;
      data = result;
      renderWorkspace();
    } catch (e) {
      ui.notify(e.message, true);
    }
  });
  window.addEventListener("gc-cleared", () => {
    discussion = null;
    data = null;
    $("workspace-panel").classList.add("hidden");
  });
  $("discussion-new").onclick = () =>
    run($("discussion-new"), async () => {
      const title = prompt("讨论名称");
      if (title === null) return;
      const r = await ui.action("new", { title: title.trim() || "新讨论" });
      await ui.read(r.sessionId);
    });
  $("branch-create").onclick = () =>
    run($("branch-create"), async () => {
      const r = await call("branch", {
        throughTurn: Number($("branch-round").value),
        title: $("stage-title").value.trim() || undefined,
        profileId: $("branch-profile").value || undefined,
      });
      await ui.read(r.sessionId);
      ui.notify("分支已建立，原讨论保持不变。");
    });
  $("snapshot-create").onclick = () =>
    run($("snapshot-create"), async () => {
      await call("snapshot", { title: $("stage-title").value.trim() || undefined });
      await refresh();
      ui.notify("阶段快照已保存。");
    });
  $("snapshot-compare").onclick = () =>
    run($("snapshot-compare"), async () => {
      const ids = [$("snapshot-base").value, $("snapshot-target").value];
      if (ids.some((id) => !id)) throw Error("先保存并选择快照");
      const values = await Promise.all(
        ids.map((snapshotId) => call("snapshot_read", { snapshotId })),
      );
      $("snapshot-diff").replaceChildren(
        ...values.map((r) =>
          node("pre", `${r.snapshot.title}\n\n${r.snapshot.markdown}`, "snapshot-pane"),
        ),
      );
    });
  $("opinion-reset").onclick = () => {
    $("opinion-form").reset();
    $("opinion-id").value = "";
  };
  $("opinion-form").onsubmit = (e) => {
    e.preventDefault();
    run(e.submitter, async () => {
      await call("opinion_save", {
        opinion: {
          id: $("opinion-id").value || undefined,
          text: $("opinion-text").value,
          kind: $("opinion-kind").value,
          status: $("opinion-status").value,
          rationale: $("opinion-reason").value,
          sourceRequestId: $("opinion-source").value || undefined,
          author: $("opinion-author").value,
        },
      });
      $("opinion-form").reset();
      $("opinion-id").value = "";
      await refresh();
    });
  };
  $("material-form").onsubmit = (e) => {
    e.preventDefault();
    run(e.submitter, async () => {
      await call("context_save", {
        material: { title: $("material-title").value, text: $("material-text").value },
      });
      $("material-form").reset();
      await refresh();
    });
  };
  $("preview-create").onclick = () =>
    run($("preview-create"), async () => {
      const kind = $("send-kind").value,
        prompt = $("discussion-prompt").value.trim();
      if (!prompt) throw Error("请填写本轮问题");
      const result = await call(kind === "compare" ? "compare_preview" : "context_preview", {
        prompt,
        context: $("discussion-context").value,
        mode: $("discussion-mode").value,
        turnIds: selected("turn"),
        contextItemIds: selected("material"),
        ...(kind === "compare" ? { profileIds: selected("profile") } : {}),
      });
      preview = { id: result.previewId, kind };
      $("preview-content").textContent = JSON.stringify(result, null, 2);
      $("send-preview").classList.remove("hidden");
      $("send-preview").open = true;
      $("preview-send").textContent = `确认发送 · ${result.paidRequestsOnConfirm} 个模型请求`;
      $("preview-send").classList.remove("hidden");
    });
  $("preview-send").onclick = () =>
    run($("preview-send"), async () => {
      if (!preview) throw Error("请先预览");
      const current = preview;
      const result = await call(current.kind === "compare" ? "compare" : "consult", {
        previewId: current.id,
      });
      $("independent-results").replaceChildren();
      if (current.kind === "compare") {
        for (const entry of result.results) {
          const details = node("details");
          details.append(
            node("summary", `${entry.label} · ${entry.error ? "请求失败" : "完整独立意见"}`),
            node("pre", entry.result?.text ?? entry.error?.message ?? ""),
          );
          $("independent-results").append(details);
        }
      } else {
        await refresh();
      }
      invalidate();
      ui.notify("已完成请求；未发起额外综合或自动重试。");
    });
  for (const id of [
    "discussion-prompt",
    "discussion-context",
    "discussion-mode",
    "send-kind",
    "history-selection",
    "material-selection",
    "compare-targets",
  ])
    $(id).addEventListener("input", invalidate);
  const builtins = {
    free: { role: "讨论伙伴", taskInstructions: "" },
    challenge: {
      role: "反方讨论伙伴",
      taskInstructions: "提出有根据的反例、边界和不确定性，不为反对而反对。",
    },
    ideas: {
      role: "产品构思伙伴",
      taskInstructions: "探索不同用户价值与交互方向，说明假设和取舍，不自动执行项目分析。",
    },
  };
  function renderPresets() {
    const select = $("preset-select");
    select.replaceChildren(
      option("", "自由设置"),
      option("free", "自由讨论"),
      option("challenge", "反方质疑"),
      option("ideas", "产品构思"),
      ...(window.gcPresets ?? []).map((p) => option(p.id, p.label)),
    );
  }
  $("preset-select").onchange = () => {
    const value = $("preset-select").value,
      p = builtins[value] ?? window.gcPresets?.find((p) => p.id === value);
    if (p) {
      $("discussion-role").value = p.role;
      $("task-instructions").value = p.taskInstructions;
    }
  };
  $("preset-save").onclick = () => {
    const label = prompt("预设名称");
    if (!label?.trim()) return;
    window.gcPresets.push({
      id: crypto.randomUUID(),
      label: label.trim(),
      role: $("discussion-role").value.trim() || "讨论伙伴",
      taskInstructions: $("task-instructions").value,
    });
    renderPresets();
    ui.notify("已添加预设，点击保存配置后持久化。");
  };
  $("preset-remove").onclick = () => {
    window.gcPresets = (window.gcPresets ?? []).filter((p) => p.id !== $("preset-select").value);
    renderPresets();
  };
  let profiles = [],
    profileSecrets = {};
  function renderProfiles() {
    $("profiles").replaceChildren();
    for (const profile of profiles) {
      const card = node("div", undefined, "profile-card");
      card.append(node("h3", profile.label));
      const fields = [
        ["label", "显示名称", "text"],
        ["model", "正式模型 ID", "text"],
        ["baseUrl", "API 地址", "url"],
        ["api", "协议", "select"],
        ["reasoning", "推理强度", "reasoning"],
        ["contextWindow", "上下文 tokens", "number"],
        ["maxOutputTokens", "输出 tokens", "number"],
        ["secret", "密钥（留空保留）", "password"],
      ];
      const grid = node("div", undefined, "two");
      for (const [key, label, type] of fields) {
        const l = node("label", label);
        let input;
        if (type === "select" || type === "reasoning") {
          input = node("select");
          const options =
            type === "select"
              ? [
                  "openai-completions",
                  "google-generative-ai",
                  "anthropic-messages",
                  "openai-responses",
                ]
              : ["off", "minimal", "low", "medium", "high", "xhigh"];
          for (const value of options) input.append(option(value, value));
        } else {
          input = node("input");
          input.type = type;
          if (type === "password") input.autocomplete = "new-password";
        }
        input.value =
          key === "secret" ? "" : key === "label" ? profile.label : profile.director[key];
        input.oninput = () => {
          if (key === "secret") profileSecrets[profile.id] = input.value;
          else if (key === "label") profile.label = input.value;
          else profile.director[key] = type === "number" ? Number(input.value) : input.value;
        };
        l.append(input);
        grid.append(l);
      }
      card.append(
        grid,
        button("移除此模型配置", () => {
          profiles = profiles.filter((p) => p.id !== profile.id);
          delete profileSecrets[profile.id];
          renderProfiles();
        }),
      );
      $("profiles").append(card);
    }
  }
  window.gcProfiles = {
    values: () => structuredClone(profiles),
    secrets: () => ({ ...profileSecrets }),
  };
  $("profile-add").onclick = () => {
    if (profiles.length >= 8) {
      ui.notify("最多 8 个模型配置", true);
      return;
    }
    const id = crypto.randomUUID();
    profiles.push({
      id,
      label: `协作模型 ${profiles.length + 1}`,
      director: {
        ...structuredClone(config.director),
        apiKeyEnv: `GC_PROFILE_${id.replaceAll("-", "")}`,
      },
    });
    renderProfiles();
  };
  window.addEventListener("gc-settings", (event) => {
    config = event.detail;
    window.gcPresets = structuredClone(config.presets ?? []);
    profiles = structuredClone(config.profiles ?? []);
    profileSecrets = {};
    renderPresets();
    renderProfiles();
    renderTargets();
  });
})();
