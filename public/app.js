/**
 * app.js — 사업계획서 도우미 화면 (빌드 도구 없는 Vanilla JS)
 * ============================================================
 * 7단계: 공고 올리기 → 공고 분석 → 가게 정보 → 자격·질문 → 초안 작성 → 모의 심사 → 완성
 *
 * 상태(state)는 이 브라우저의 localStorage 에만 저장합니다. 서버는 상태를 갖지 않고,
 * 매 요청에 필요한 정보(공고 분석, 가게 정보 등)를 함께 보냅니다 (Vercel 서버리스 구조).
 * ============================================================
 */
(function () {
  "use strict";

  var S = window.SosangShared;
  var STORE_KEY = "sosang-plan-v1";
  var CODE_KEY = "sosang-access-code";
  var MAX_UPLOAD_BYTES = 3.2 * 1024 * 1024; // Vercel 요청 한도(4.5MB) 안에 들어가도록 (base64 변환 시 1.33배)

  var STEPS = ["공고 올리기", "공고 분석", "가게 정보", "자격·질문", "초안 작성", "모의 심사", "완성"];
  var KIND_LABEL = {
    general_info: "일반현황 · 자동 입력",
    summary: "요약",
    narrative: "본문",
    budget: "사업비 · 자동 검증",
    schedule: "추진 일정",
    team: "역량·인력",
  };
  var STATUS_TEXT = { pass: "충족", fail: "미충족", unknown: "확인 필요" };
  var STATUS_ICON = { pass: "✓", fail: "✕", unknown: "?" };

  /* ── 상태 ─────────────────────────────────────────────── */
  function fresh() {
    return {
      v: 1,
      step: 0,
      source: { tab: "upload", text: "", meta: null },
      analysis: null,
      outline: null,
      sources: [],
      notes: [],
      profile: {},
      prep: null,
      answers: {},
      excl: {},
      sections: {},
      sectionInfo: {},
      review: null,
      applied: {},
      docsChecked: {},
      includeNotes: false,
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      return s && s.v === 1 ? Object.assign(fresh(), s) : null;
    } catch (e) {
      return null;
    }
  }

  var state = load() || fresh();
  var files = [];              // 올린 파일 (용량이 커서 저장하지 않음)
  var server = { mode: "live", ready: true, accessCodeRequired: false };
  var busy = { analyze: false, prepare: false, review: false, fetching: {} };
  var writing = {};            // 섹션 id → 스트리밍 중인 글
  var editing = {};            // 섹션 id → 직접 고치는 중
  var writeAllRun = null;      // { stop: bool, done, total }
  var announcements = null;    // data/announcements.json
  var annQuery = "";

  var saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(state));
      } catch (e) {
        toast("브라우저 저장 공간이 부족합니다. '작업 파일로 저장'으로 백업해 주세요.", true);
      }
    }, 250);
  }

  /* ── 도우미 ───────────────────────────────────────────── */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function $(sel) { return document.querySelector(sel); }
  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }
  function won(n) { return n ? Number(n).toLocaleString("ko-KR") + "원" : "공고 확인"; }
  function sizeText(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + "MB" : Math.max(1, Math.round(b / 1024)) + "KB"; }

  var toastTimer = null;
  function toast(msg, isError) {
    var el = $("#toast");
    el.textContent = msg;
    el.className = "toast" + (isError ? " error" : "");
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, isError ? 6000 : 3000);
  }

  function dday(deadline) {
    var m = String(deadline || "").match(/(\d{4})[-.]\s?(\d{1,2})[-.]\s?(\d{1,2})/);
    if (!m) return "";
    var end = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var d = Math.round((end - today) / 86400000);
    return d > 0 ? "D-" + d : d === 0 ? "오늘 마감" : "마감됨";
  }

  function inlineHtml(text) {
    return S.parseInline(text).map(function (seg) {
      if (seg.placeholder) return '<mark class="ph">' + esc(seg.text) + "</mark>";
      if (seg.bold) return "<strong>" + esc(seg.text) + "</strong>";
      return esc(seg.text);
    }).join("");
  }

  /** 개조식 마크다운 → 화면용 HTML */
  function mdToHtml(md) {
    return S.parseMarkdown(md).map(function (b) {
      if (b.type === "table") {
        return '<div class="tw"><table>' + b.rows.map(function (r, i) {
          var tag = i === 0 ? "th" : "td";
          return "<tr>" + r.map(function (c) { return "<" + tag + ">" + inlineHtml(c) + "</" + tag + ">"; }).join("") + "</tr>";
        }).join("") + "</table></div>";
      }
      if (b.type === "heading") {
        var h = b.level <= 2 ? "h4" : "h5";
        return "<" + h + ">" + inlineHtml(b.text) + "</" + h + ">";
      }
      if (b.type === "item") {
        var box = b.marker === "□" || b.marker === "■";
        return '<div class="item lv' + b.level + (box ? " box" : "") + '"><span class="mk">' + esc(b.marker) + "</span><span>" + inlineHtml(b.text) + "</span></div>";
      }
      return "<p>" + inlineHtml(b.text) + "</p>";
    }).join("");
  }

  /** 한글·워드에 붙여넣을 때 표가 유지되도록 인라인 스타일을 넣은 HTML */
  function mdToClipboardHtml(md) {
    return S.parseMarkdown(md).map(function (b) {
      if (b.type === "table") {
        return '<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;width:100%">' + b.rows.map(function (r, i) {
          return "<tr>" + r.map(function (c) {
            return (i === 0 ? '<th style="background:#e8f0ec">' : "<td>") + esc(c.replace(/\*\*/g, "")) + (i === 0 ? "</th>" : "</td>");
          }).join("") + "</tr>";
        }).join("") + "</table>";
      }
      var text = esc(b.text.replace(/\*\*/g, ""));
      if (b.type === "heading") return "<p><b>" + text + "</b></p>";
      if (b.type === "item") return '<p style="margin-left:' + b.level * 12 + 'pt">' + esc(b.marker) + " " + text + "</p>";
      return "<p>" + text + "</p>";
    }).join("");
  }

  function mdToPlain(md) {
    return S.parseMarkdown(md).map(function (b) {
      if (b.type === "table") return b.rows.map(function (r) { return r.join("\t"); }).join("\n");
      var t = b.text.replace(/\*\*/g, "");
      if (b.type === "item") return new Array(b.level + 1).join("  ") + b.marker + " " + t;
      return t;
    }).join("\n");
  }

  function copyRich(md) {
    var plain = mdToPlain(md);
    var html = mdToClipboardHtml(md);
    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      return navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" }),
      })]).catch(function () { return copyPlain(plain); });
    }
    return copyPlain(plain);
  }

  function copyPlain(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    var ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    return Promise.resolve();
  }

  /* ── 서버 호출 ────────────────────────────────────────── */
  function headers() {
    var h = { "Content-Type": "application/json" };
    try {
      var code = localStorage.getItem(CODE_KEY);
      if (code) h["x-access-code"] = code;
    } catch (e) { /* 저장소 사용 불가 */ }
    return h;
  }

  function askAccessCode() {
    var code = window.prompt("운영자에게 받은 이용 코드를 입력해 주세요.");
    if (code === null) return false;
    try { localStorage.setItem(CODE_KEY, code.trim()); } catch (e) { /* 무시 */ }
    return true;
  }

  async function api(path, body, retried) {
    var res;
    try {
      res = await fetch(path, { method: "POST", headers: headers(), body: JSON.stringify(body) });
    } catch (e) {
      throw new Error("서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.");
    }
    if (res.status === 401 && !retried && askAccessCode()) return api(path, body, true);
    var data = null;
    try { data = await res.json(); } catch (e) { /* 아래에서 처리 */ }
    if (!res.ok) {
      if (res.status === 413) throw new Error((data && data.error) || "보낸 내용이 너무 큽니다. 파일 크기를 줄여 주세요.");
      if (res.status === 504) throw new Error("처리 시간이 너무 오래 걸렸습니다. 잠시 후 다시 시도해 주세요.");
      throw new Error((data && data.error) || "요청을 처리하지 못했습니다 (" + res.status + ").");
    }
    return data;
  }

  /** NDJSON 스트리밍 응답 읽기 */
  async function streamApi(path, body, onEvent, retried) {
    var res = await fetch(path, { method: "POST", headers: headers(), body: JSON.stringify(body) });
    if (res.status === 401 && !retried && askAccessCode()) return streamApi(path, body, onEvent, true);
    if (!res.ok) {
      var err = null;
      try { err = await res.json(); } catch (e) { /* 무시 */ }
      throw new Error((err && err.error) || "요청을 처리하지 못했습니다 (" + res.status + ").");
    }
    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buf = "";
    var finished = false;
    for (;;) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      var lines = buf.split("\n");
      buf = lines.pop();
      lines.forEach(function (line) {
        if (!line.trim()) return;
        var ev = JSON.parse(line);
        if (ev.t === "error") throw new Error(ev.message);
        if (ev.t === "done") finished = true;
        onEvent(ev);
      });
    }
    if (buf.trim()) {
      var last = JSON.parse(buf);
      if (last.t === "error") throw new Error(last.message);
      if (last.t === "done") finished = true;
      onEvent(last);
    }
    if (!finished) throw new Error("응답이 중간에 끊겼습니다. 다시 시도해 주세요.");
  }

  function planPayload(extra) {
    return Object.assign({
      analysis: state.analysis,
      outline: state.outline,
      profile: state.profile,
      questions: state.prep ? state.prep.questions : [],
      answers: state.answers,
      strategy: state.prep ? state.prep.strategy : {},
      sections: state.sections,
    }, extra || {});
  }

  /* ── 단계 이동 ────────────────────────────────────────── */
  function hasDraft() {
    return Object.keys(state.sections).some(function (k) { return (state.sections[k] || "").trim(); });
  }

  function canGo(i) {
    if (i === 0) return true;
    if (i <= 2) return !!state.analysis;
    if (i <= 4) return !!state.analysis && !!state.prep;
    return !!state.analysis && hasDraft();
  }

  function go(i) {
    if (!canGo(i)) return;
    state.step = i;
    save();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
    $("#app").focus({ preventScroll: true });
  }

  /* ── 화면 그리기 ──────────────────────────────────────── */
  function renderStepper() {
    $("#stepper").innerHTML = STEPS.map(function (label, i) {
      var cls = i === state.step ? "current" : canGo(i) ? "done" : "";
      return '<button class="step-pill ' + cls + '" data-action="go" data-step="' + i + '"' + (canGo(i) ? "" : " disabled") +
        (i === state.step ? ' aria-current="step"' : "") + '><span class="num">' + (i + 1) + "</span>" + esc(label) + "</button>";
    }).join("");
    var cur = $("#stepper .current");
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest", inline: "center" });
  }

  function render() {
    renderStepper();
    var views = [viewSource, viewAnalysis, viewProfile, viewPrepare, viewDraft, viewReview, viewFinish];
    $("#app").innerHTML = views[state.step]();
    if (state.step === 0 && state.source.tab === "list") loadAnnouncements();
  }

  function navBar(prevLabel, next) {
    return '<div class="nav-bar">' +
      (state.step > 0 ? '<button class="btn btn-ghost" data-action="go" data-step="' + (state.step - 1) + '">← ' + esc(prevLabel || "이전") + "</button>" : "<span></span>") +
      (next || "") + "</div>";
  }

  function working(msg) {
    return '<div class="working"><div class="spinner" aria-hidden="true"></div><div>' + msg + "</div></div>";
  }

  /* 1단계 ─ 공고 올리기 */
  function viewSource() {
    var tab = state.source.tab;
    var tabs = [["upload", "파일 올리기"], ["paste", "공고 내용 붙여넣기"], ["list", "최근 공고에서 고르기"]];
    var body = "";

    if (tab === "upload") {
      body = '<label class="dropzone" id="dropzone"><input type="file" multiple data-action="pick-files" ' +
        'accept=".hwp,.hwpx,.pdf,.docx,.txt,.png,.jpg,.jpeg,.webp" />' +
        '<div class="icon" aria-hidden="true">📄</div><strong>여기를 눌러 파일을 고르거나 끌어다 놓으세요</strong>' +
        '<div class="muted small">한글(HWP·HWPX), PDF, 워드, 사진 · 여러 개 가능 · 합계 3MB까지</div></label>' +
        (files.length ? '<ul class="file-list">' + files.map(function (f, i) {
          return '<li><span aria-hidden="true">📎</span><span class="name">' + esc(f.name) + '</span><span class="muted small">' + sizeText(f.size) +
            '</span><button class="btn btn-ghost btn-sm" data-action="remove-file" data-index="' + i + '">빼기</button></li>';
        }).join("") + "</ul>" : "") +
        '<div class="notice" style="margin-top:12px">💡 공고문과 함께 <strong>사업계획서 양식</strong>과 <strong>평가표</strong> 파일도 올리면 양식 목차와 배점을 정확히 따라 씁니다.</div>';
    } else if (tab === "paste") {
      body = '<textarea data-source-text rows="12" placeholder="기업마당이나 구청 홈페이지의 공고 본문을 복사해서 붙여넣으세요. 평가 기준표와 사업계획서 목차 부분이 꼭 들어가야 정확합니다.">' +
        esc(state.source.text) + "</textarea>";
    } else {
      body = viewAnnouncementList();
    }

    var meta = state.source.meta;
    var metaBox = meta ? '<div class="notice ok"><strong>선택한 공고:</strong> ' + esc(meta.title) +
      (safeUrl(meta.url) ? ' · <a href="' + esc(safeUrl(meta.url)) + '" target="_blank" rel="noopener">공고 페이지 열기</a>' : "") +
      ' <button class="btn-link" data-action="clear-meta">선택 해제</button></div>' : "";

    var serverNotice = !server.ready ? '<div class="notice bad">서버에 AI 키(ANTHROPIC_API_KEY)가 설정되지 않았습니다. 운영자라면 README의 배포 방법을 확인하세요.</div>' : "";

    return '<div class="page-title"><h1>어떤 지원사업에 신청하시나요?</h1>' +
      "<p>공고문을 올리면 신청 자격, 평가 기준, 사업계획서 양식을 정리하고 그 기준에 맞춰 초안을 써 드립니다.</p></div>" +
      serverNotice +
      '<div class="card"><div class="tabs" role="tablist">' + tabs.map(function (t) {
        return '<button class="tab' + (t[0] === tab ? " active" : "") + '" role="tab" aria-selected="' + (t[0] === tab) + '" data-action="source-tab" data-tab="' + t[0] + '">' + t[1] + "</button>";
      }).join("") + "</div>" + body + metaBox +
      (busy.analyze
        ? working("<strong>공고를 읽고 있어요.</strong><br><span class=\"muted small\">평가표에서 배점을 찾고, 사업계획서 양식 목차를 정리하는 중입니다. 문서 양에 따라 1~3분 걸릴 수 있어요.</span>")
        : '<div class="row end" style="margin-top:16px"><button class="btn btn-ghost" data-action="load-sample">예시 공고로 체험하기</button>' +
          '<button class="btn btn-primary btn-lg" data-action="analyze">공고 분석하기 →</button></div>') +
      "</div>" +
      (state.analysis && !busy.analyze ? '<div class="row end"><button class="btn btn-secondary" data-action="go" data-step="1">이전 분석 결과 보기 →</button></div>' : "");
  }

  function viewAnnouncementList() {
    if (!announcements) return working("최근 공고를 불러오는 중…");
    var items = announcements.items || [];
    if (!items.length) {
      return '<div class="hero-empty"><div class="icon" aria-hidden="true">🗂️</div><p>아직 수집된 공고가 없습니다.</p>' +
        '<p class="muted small">운영자가 GitHub Actions(공고 목록 갱신)를 켜면 기업마당 공고가 매일 여기에 올라옵니다.<br>지금은 공고 파일을 직접 올리거나 내용을 붙여넣어 주세요.</p></div>';
    }
    var q = annQuery.trim();
    var shown = items.filter(function (a) {
      return !q || (a.title + " " + a.agency + " " + (a.category || "")).indexOf(q) >= 0;
    }).slice(0, 80);
    var sel = state.source.meta && state.source.meta.id;
    return '<input type="text" data-ann-query placeholder="공고 이름·기관으로 찾기 (예: 소상공인, 마포구)" value="' + esc(annQuery) + '" />' +
      '<p class="muted small" style="margin:8px 0">' + esc(announcements.updated_at || "") + " 기준 · " + items.length + "건</p>" +
      '<div class="ann-list">' + shown.map(function (a) {
        return '<button class="ann' + (a.id === sel ? " selected" : "") + '" data-action="pick-ann" data-id="' + esc(a.id) + '">' +
          '<span class="t">' + (a.sosang ? '<span class="badge">소상공인</span> ' : "") + esc(a.title) + "</span>" +
          '<span class="m">' + esc(a.agency || "") + (a.period ? " · " + esc(a.period) : "") + (a.deadline && dday(a.deadline) ? " · " + dday(a.deadline) : "") + "</span></button>";
      }).join("") + "</div>" + viewAnnFiles();
  }

  function viewAnnFiles() {
    var meta = state.source.meta;
    if (!meta || !meta.files || !meta.files.length) return "";
    return '<div class="card" style="margin-top:12px"><h3>첨부파일 불러오기</h3>' +
      '<p class="muted small">공고문·양식 파일을 불러와 함께 분석합니다. 불러오지 못하면 공고 페이지에서 직접 내려받아 "파일 올리기"로 올려 주세요.</p>' +
      meta.files.map(function (f, i) {
        var already = files.some(function (x) { return x.name === f.name; });
        return '<div class="row" style="margin-bottom:6px"><span class="spacer">📎 ' + esc(f.name) + "</span>" +
          (already ? '<span class="badge badge-ok">추가됨</span>'
            : busy.fetching[i] ? '<span class="muted small">불러오는 중…</span>'
              : '<button class="btn btn-secondary btn-sm" data-action="fetch-ann-file" data-index="' + i + '">불러오기</button>') + "</div>";
      }).join("") + "</div>";
  }

  /* 2단계 ─ 공고 분석 결과 */
  function viewAnalysis() {
    var a = state.analysis;
    var p = a.program || {};
    var ev = a.evaluation || {};
    var t = a.template || {};
    var maxPts = Math.max.apply(null, (ev.criteria || []).map(function (c) { return c.points || 0; }).concat([1]));
    var warnings = [];
    (state.sources || []).forEach(function (s) { (s.warnings || []).forEach(function (w) { warnings.push(s.name + ": " + w); }); });
    (state.notes || []).forEach(function (n) { warnings.push(n); });

    var facts = [
      ["업체당 최대 지원금", won(p.max_support_krw)],
      ["자부담", p.self_pay_ratio_pct ? "총사업비의 " + p.self_pay_ratio_pct + "% 이상" : "공고 확인"],
      ["마감", (p.deadline || "공고 확인") + (dday(p.deadline) ? " (" + dday(p.deadline) + ")" : "")],
      ["선정 규모", p.selection_scale || "공고 확인"],
    ];

    return '<div class="page-title"><h1>' + esc(p.name || "공고 분석 결과") + "</h1><p>" + esc(p.agency || "") + "</p></div>" +
      '<div class="card"><h2>한눈에 보기</h2><p>' + esc(p.summary || p.purpose || "") + '</p><div class="facts">' +
      facts.map(function (f) { return '<div class="fact"><div class="k">' + f[0] + '</div><div class="v">' + esc(f[1]) + "</div></div>"; }).join("") + "</div>" +
      (p.support_content ? '<p class="small"><strong>지원 내용</strong> ' + esc(p.support_content) + "</p>" : "") + "</div>" +

      (warnings.length ? '<div class="notice warn"><strong>확인해 주세요</strong><ul>' + warnings.map(function (w) { return "<li>" + esc(w) + "</li>"; }).join("") + "</ul></div>" : "") +

      '<div class="grid-2">' +
      '<div class="card"><div class="card-head"><h2>평가 기준</h2>' + sourceBadge(ev.source) + "</div>" +
      '<p class="muted small">심사위원이 이 표로 점수를 매깁니다. 배점이 큰 항목에 분량과 근거를 더 배분해 씁니다.</p>' +
      (ev.criteria || []).map(function (c) {
        return '<div class="crit"><div class="crit-head"><span>' + esc(c.name) + "</span><span>" + (c.points != null ? c.points + "점" : "") + "</span></div>" +
          '<div class="bar"><span style="width:' + Math.round(((c.points || 0) / maxPts) * 100) + '%"></span></div>' +
          (c.description ? '<div class="small">' + esc(c.description) + "</div>" : "") +
          ((c.look_for || []).length ? '<div class="small muted">심사 포인트: ' + c.look_for.map(esc).join(" · ") + "</div>" : "") + "</div>";
      }).join("") +
      ((ev.bonus || []).length ? '<h3 style="margin-top:12px">가점</h3><ul class="plain-list small">' + ev.bonus.map(function (b) {
        return "<li>" + esc(b.name) + (b.points != null ? " (+" + b.points + "점)" : "") + "</li>";
      }).join("") + "</ul>" : "") +
      (ev.cutoff ? '<p class="small"><strong>선정 기준</strong> ' + esc(ev.cutoff) + "</p>" : "") + "</div>" +

      '<div class="card"><div class="card-head"><h2>사업계획서 양식</h2>' + sourceBadge(t.source) + "</div>" +
      (t.page_limit ? '<p class="small">전체 <strong>' + t.page_limit + "쪽 이내</strong></p>" : "") +
      state.outline.map(function (s, i) {
        return '<div class="sec-row"><span class="no">' + (i + 1) + "</span><div><strong>" + esc(s.title) + "</strong>" +
          '<div class="chips" style="margin-top:4px"><span class="chip">' + esc(KIND_LABEL[s.kind] || s.kind) + "</span>" +
          s.criteria.map(function (c) { return '<span class="chip">' + esc(c.name) + (c.points != null ? " " + c.points + "점" : "") + "</span>"; }).join("") +
          (s.target_chars ? '<span class="chip">목표 약 ' + s.target_chars + "자</span>" : "") + "</div></div></div>";
      }).join("") +
      ((t.format_rules || []).length ? '<p class="small muted" style="margin-top:8px">작성 유의사항: ' + t.format_rules.map(esc).join(" · ") + "</p>" : "") + "</div>" +
      "</div>" +

      '<div class="card"><h2>신청 자격</h2><ul class="plain-list">' + (a.eligibility || []).map(function (e) { return "<li>" + esc(e.text) + "</li>"; }).join("") + "</ul>" +
      ((a.exclusions || []).length ? '<h3 style="margin-top:12px">지원 제외 대상</h3><ul class="plain-list">' + a.exclusions.map(function (x) { return "<li>" + esc(x.text) + "</li>"; }).join("") + "</ul>" : "") +
      '<p class="muted small" style="margin-top:8px">다음 단계에서 가게 정보를 넣으면 자격을 자동으로 점검합니다.</p></div>' +

      '<div class="card"><details><summary>제출 서류 · 사업비 규정 · 유의사항</summary><div class="grid-2" style="margin-top:12px">' +
      '<div><h3>제출 서류</h3><ul class="plain-list small">' + (a.required_documents || []).map(function (d) { return "<li>" + esc(d) + "</li>"; }).join("") + "</ul></div>" +
      "<div><h3>사업비 규정</h3>" + budgetRulesHtml(a.budget_rules) + "</div></div>" +
      ((a.cautions || []).length ? '<h3>유의사항</h3><ul class="plain-list small">' + a.cautions.map(function (c) { return "<li>" + esc(c) + "</li>"; }).join("") + "</ul>" : "") +
      ((a.missing_info || []).length ? '<h3>공고 원문으로 꼭 확인할 것</h3><ul class="plain-list small">' + a.missing_info.map(function (c) { return "<li>" + esc(c) + "</li>"; }).join("") + "</ul>" : "") +
      "</details></div>" +
      navBar("공고 다시 올리기", '<button class="btn btn-primary btn-lg" data-action="go" data-step="2">우리 가게 정보 입력하기 →</button>');
  }

  function sourceBadge(src) {
    if (src === "추정") return '<span class="badge badge-warn" title="공고에서 찾지 못해 일반 기준으로 추정했습니다">추정 — 공고 확인 필요</span>';
    return '<span class="badge badge-ok">' + esc(src || "공고문") + "에서 확인</span>";
  }

  function budgetRulesHtml(br) {
    br = br || {};
    var out = "";
    if ((br.allowed_items || []).length) out += '<p class="small"><strong>사용 가능</strong> ' + br.allowed_items.map(esc).join(", ") + "</p>";
    if ((br.disallowed_items || []).length) out += '<p class="small"><strong>사용 불가</strong> ' + br.disallowed_items.map(esc).join(", ") + "</p>";
    if ((br.notes || []).length) out += '<ul class="plain-list small">' + br.notes.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") + "</ul>";
    return out || '<p class="small muted">공고에 명시되지 않았습니다.</p>';
  }

  /* 3단계 ─ 가게 정보 */
  function viewProfile() {
    var groups = [];
    S.PROFILE_FIELDS.forEach(function (f) { if (groups.indexOf(f.group) < 0) groups.push(f.group); });
    var filled = S.PROFILE_FIELDS.filter(function (f) {
      var v = state.profile[f.key];
      return f.type !== "checkbox" && v !== undefined && String(v).trim() !== "";
    }).length;
    var total = S.PROFILE_FIELDS.filter(function (f) { return f.type !== "checkbox"; }).length;

    return '<div class="page-title"><h1>우리 가게 이야기를 들려주세요</h1><p>적어 주신 내용만 사실로 씁니다. 모르는 칸은 비워 두셔도 돼요 — AI가 지어내지 않고 <mark class="ph">[확인 필요]</mark>로 표시합니다.</p></div>' +
      '<div class="card"><p class="progress-line" id="profile-progress">입력한 항목 ' + filled + " / " + total + "</p>" +
      groups.map(function (g) {
        return '<div class="form-group"><h3>' + esc(g) + '</h3><div class="fields">' +
          S.PROFILE_FIELDS.filter(function (f) { return f.group === g; }).map(fieldHtml).join("") + "</div></div>";
      }).join("") + "</div>" +
      (busy.prepare ? working("<strong>신청 자격을 점검하고, 평가기준에 비해 부족한 정보를 찾고 있어요.</strong>") :
        navBar("공고 분석", '<button class="btn btn-primary btn-lg" data-action="prepare">자격 확인하고 추가 질문 받기 →</button>'));
  }

  function fieldHtml(f) {
    var v = state.profile[f.key];
    var id = "f-" + f.key;
    if (f.type === "checkbox") {
      return '<div class="field check wide"><label><input type="checkbox" id="' + id + '" data-field="' + f.key + '"' + (v ? " checked" : "") + " /> " + esc(f.label) + "</label></div>";
    }
    var input;
    if (f.type === "textarea") {
      input = '<textarea id="' + id + '" data-field="' + f.key + '" rows="3" placeholder="' + esc(f.hint || "") + '">' + esc(v || "") + "</textarea>";
    } else if (f.type === "select") {
      input = '<select id="' + id + '" data-field="' + f.key + '">' + f.options.map(function (o) {
        return '<option value="' + esc(o) + '"' + (o === (v || "") ? " selected" : "") + ">" + esc(o || "선택하세요") + "</option>";
      }).join("") + "</select>";
    } else {
      input = '<input id="' + id + '" type="' + (f.type === "number" ? "number" : f.type) + '" inputmode="' + (f.type === "number" ? "numeric" : "text") +
        '" data-field="' + f.key + '" value="' + esc(v == null ? "" : v) + '" placeholder="' + esc(f.hint || "") + '" />';
    }
    return '<div class="field' + (f.type === "textarea" ? " wide" : "") + '"><label for="' + id + '">' + esc(f.label) + "</label>" + input + "</div>";
  }

  /* 4단계 ─ 자격·가점·전략·추가 질문 */
  function viewPrepare() {
    var prep = state.prep;
    var elig = prep.eligibility || [];
    var fails = elig.filter(function (e) { return e.status === "fail"; });
    var unknowns = elig.filter(function (e) { return e.status === "unknown"; });
    var st = prep.strategy || {};
    var questions = prep.questions || [];
    var answered = questions.filter(function (q) { return (state.answers[q.id] || "").trim(); }).length;
    var sb = prep.small_business || {};

    return '<div class="page-title"><h1>신청 자격과 작성 전략</h1><p>자격을 먼저 확인하고, 점수에 영향을 주는 질문 몇 가지에 답해 주세요.</p></div>' +
      (fails.length ? '<div class="notice bad"><strong>신청 자격에 맞지 않는 조건이 있어요.</strong> 아래 ✕ 항목을 공고문에서 다시 확인하세요. 조건을 충족하지 못하면 선정되지 않습니다.</div>' : "") +
      '<div class="card"><div class="card-head"><h2>신청 자격 점검</h2><span class="badge ' + (fails.length ? "badge-bad" : unknowns.length ? "badge-warn" : "badge-ok") + '">' +
      (elig.length - fails.length - unknowns.length) + "개 충족 · " + unknowns.length + "개 확인 필요 · " + fails.length + "개 미충족</span></div>" +
      elig.map(function (e) {
        return '<div class="elig"><span class="ico ' + e.status + '" aria-label="' + STATUS_TEXT[e.status] + '">' + STATUS_ICON[e.status] + "</span><div><div>" + esc(e.text) +
          ' <span class="badge badge-muted">' + (e.decided_by === "rule" ? "자동 계산" : "AI 판단") + "</span></div>" +
          '<div class="small muted">' + esc(e.reason || "") + "</div></div></div>";
      }).join("") +
      '<div class="elig"><span class="ico ' + (sb.status || "unknown") + '">' + STATUS_ICON[sb.status || "unknown"] + "</span><div><div>소상공인 기준(상시근로자 수)</div><div class=\"small muted\">" + esc(sb.reason || "") + "</div></div></div>" +
      ((state.analysis.exclusions || []).length ? '<h3 style="margin-top:14px">지원 제외 대상 — 해당하지 않는지 직접 체크해 주세요</h3><div class="checklist">' +
        state.analysis.exclusions.map(function (x) {
          return '<label><input type="checkbox" data-excl="' + esc(x.id) + '"' + (state.excl[x.id] ? " checked" : "") + " /> <span>" + esc(x.text) + " — <strong>해당 없음</strong></span></label>";
        }).join("") + "</div>" : "") + "</div>" +

      ((prep.bonus || []).length ? '<div class="card"><h2>가점 받을 기회</h2>' + prep.bonus.map(function (b) {
        var cls = b.status === "해당" ? "badge-ok" : b.status === "해당 없음" ? "badge-muted" : "badge-warn";
        return '<div class="elig"><span class="badge ' + cls + '">' + esc(b.status) + "</span><div><strong>" + esc(b.name) + '</strong><div class="small muted">' + esc(b.action) + "</div></div></div>";
      }).join("") + "</div>" : "") +

      '<div class="card"><h2>작성 전략</h2>' +
      '<div class="field"><label for="st-title">사업명(과제명)</label><input id="st-title" type="text" data-strategy="concept_title" value="' + esc(st.concept_title || "") + '" /></div>' +
      '<div class="field" style="margin-top:10px"><label for="st-one">한 줄 요약</label><input id="st-one" type="text" data-strategy="one_liner" value="' + esc(st.one_liner || "") + '" /></div>' +
      '<div class="grid-2" style="margin-top:12px">' +
      listBlock("심사위원에게 남길 핵심 메시지", st.key_messages) + listBlock("우리 가게 차별점", st.differentiators) +
      listBlock("약점과 보완 방향", st.weak_points) + listBlock("미리 준비하면 좋은 자료", st.numbers_to_prepare) +
      "</div></div>" +

      '<div class="card"><div class="card-head"><h2>추가 질문 (<span id="q-count">' + answered + "</span>/" + questions.length + ')</h2></div>' +
      '<p class="muted small">평가표 기준으로 점수가 깎일 수 있는 부분입니다. 아는 만큼만 답해 주세요. 답하지 않은 부분은 초안에 [확인 필요]로 남습니다.</p>' +
      questions.map(function (q) {
        var pr = q.priority === "high" ? '<span class="badge badge-bad">중요</span> ' : "";
        return '<div class="question"><div class="q">' + pr + esc(q.question) + '</div><div class="why">' + esc(q.why) + "</div>" +
          '<textarea rows="2" data-answer="' + esc(q.id) + '" placeholder="예) ' + esc(q.example) + '">' + esc(state.answers[q.id] || "") + "</textarea></div>";
      }).join("") + "</div>" +
      navBar("가게 정보 고치기", '<button class="btn btn-primary btn-lg" data-action="go" data-step="4">초안 작성하러 가기 →</button>');
  }

  function listBlock(title, items) {
    if (!items || !items.length) return "";
    return "<div><h3>" + esc(title) + '</h3><ul class="plain-list small">' + items.map(function (i) { return "<li>" + inlineHtml(i) + "</li>"; }).join("") + "</ul></div>";
  }

  /* 5단계 ─ 초안 작성 */
  function viewDraft() {
    var outline = state.outline;
    var done = outline.filter(function (s) { return (state.sections[s.id] || "").trim(); }).length;
    var running = !!writeAllRun;
    return '<div class="page-title"><h1>사업계획서 초안</h1><p>양식 목차 그대로, 각 섹션이 답해야 할 평가항목과 배점에 맞춰 씁니다. 다 쓴 뒤 직접 고칠 수 있어요.</p></div>' +
      '<div class="card"><div class="row"><div class="spacer"><strong>' + done + " / " + outline.length + "개 섹션 작성됨</strong>" +
      (running ? '<div class="muted small">자동 작성 중… (' + writeAllRun.done + "/" + writeAllRun.total + ")</div>" : '<div class="muted small">본문 → 사업비·일정 → 요약 → 일반현황 순서로 씁니다.</div>') + "</div>" +
      (running ? '<button class="btn btn-danger" data-action="stop-all">중지</button>'
        : '<button class="btn btn-primary" data-action="write-all">' + (done ? "비어 있는 섹션 모두 작성" : "AI로 전체 초안 작성") + "</button>") +
      "</div></div>" +
      outline.map(sectionCard).join("") +
      navBar("자격·질문", '<button class="btn btn-primary btn-lg" data-action="go" data-step="5"' + (done ? "" : " disabled") + ">모의 심사 받기 →</button>");
  }

  function sectionCard(s) {
    return '<div class="card section-card ' + sectionState(s.id) + '" id="sec-' + esc(s.id) + '">' + sectionInner(s) + "</div>";
  }

  function sectionState(id) {
    if (writing[id] !== undefined) return "working";
    return (state.sections[id] || "").trim() ? "done" : "";
  }

  function sectionInner(s) {
    var id = s.id;
    var text = state.sections[id] || "";
    var isWriting = writing[id] !== undefined;
    var info = state.sectionInfo[id] || {};
    var chars = S.countChars(text);
    var phs = S.findPlaceholders(text).length;

    var body;
    if (isWriting) {
      body = '<div class="doc"><div class="streaming" id="stream-' + esc(id) + '">' + (writing[id] ? esc(writing[id]) : '<span class="muted">AI가 평가기준을 검토하고 있어요…</span>') + "</div></div>";
    } else if (editing[id]) {
      body = '<div class="editor"><textarea data-editor="' + esc(id) + '">' + esc(text) + '</textarea><p class="muted small">□ 소제목, ○ 항목, - 세부 내용, 표는 | 칸 | 칸 | 형식으로 씁니다.</p></div>';
    } else if (text.trim()) {
      body = '<div class="doc">' + mdToHtml(text) + "</div>";
    } else {
      body = '<p class="muted">아직 작성되지 않았습니다.' + (s.kind === "general_info" ? " 가게 정보로 자동으로 채웁니다." : "") + "</p>";
    }

    var issues = (info.budget && info.budget.issues) || [];
    var meter = text.trim() && !isWriting ? '<div class="meter"><span>' + chars + "자" + (s.target_chars ? " / 목표 약 " + s.target_chars + "자" : "") + "</span>" +
      (phs ? '<span><mark class="ph">[확인 필요] ' + phs + "곳</mark></span>" : '<span class="badge badge-ok">확인 필요 없음</span>') +
      (info.truncated ? '<span class="badge badge-warn">글이 길어 중간에 끊겼어요 — 다시 작성해 보세요</span>' : "") + "</div>" : "";

    var buttons = isWriting ? "" :
      '<button class="btn btn-secondary btn-sm" data-action="write" data-sec="' + esc(id) + '">' + (text.trim() ? "다시 작성" : "AI로 작성") + "</button>" +
      (text.trim() ? '<button class="btn btn-ghost btn-sm" data-action="toggle-edit" data-sec="' + esc(id) + '">' + (editing[id] ? "미리보기" : "직접 고치기") + "</button>" +
        '<button class="btn btn-ghost btn-sm" data-action="copy-section" data-sec="' + esc(id) + '">복사</button>' : "");

    return '<div class="card-head"><h3>' + esc(s.title) + '</h3><div class="row">' + buttons + "</div></div>" +
      '<div class="sec-meta"><span class="chip">' + esc(KIND_LABEL[s.kind] || s.kind) + "</span>" +
      s.criteria.map(function (c) { return '<span class="chip">평가: ' + esc(c.name) + (c.points != null ? " " + c.points + "점" : "") + "</span>"; }).join("") + "</div>" +
      body + meter +
      (issues.length ? '<div class="notice ' + (issues.some(function (i) { return i.level === "error"; }) ? "bad" : "warn") + '" style="margin-top:10px"><strong>사업비 점검</strong><ul>' +
        issues.map(function (i) { return "<li>" + esc(i.message) + "</li>"; }).join("") + "</ul></div>" : "");
  }

  function refreshSection(id) {
    var el = document.getElementById("sec-" + id);
    var s = state.outline.find(function (x) { return x.id === id; });
    if (!el || !s) return;
    el.className = "card section-card " + sectionState(id);
    el.innerHTML = sectionInner(s);
  }

  async function writeSection(id, mode, instruction) {
    if (writing[id] !== undefined) return;
    writing[id] = "";
    editing[id] = false;
    refreshSection(id);
    try {
      await streamApi("/api/write", planPayload({ section_id: id, mode: mode || "write", instruction: instruction || "" }), function (ev) {
        if (ev.t === "delta") {
          writing[id] += ev.v;
          var box = document.getElementById("stream-" + id);
          if (box) box.textContent = writing[id];
        } else if (ev.t === "done") {
          state.sections[id] = ev.text;
          state.sectionInfo[id] = { budget: ev.budget || null, truncated: !!ev.truncated, at: Date.now() };
          state.review = state.review ? Object.assign(state.review, { stale: true }) : null;
        }
      });
      save();
    } finally {
      delete writing[id];
      if (state.step === 4) refreshSection(id);
    }
  }

  async function writeAll() {
    var targets = state.outline.slice().sort(function (a, b) { return a.order - b.order; })
      .filter(function (s) { return !(state.sections[s.id] || "").trim(); });
    if (!targets.length) {
      toast("모든 섹션이 작성되어 있어요. 섹션별 '다시 작성'을 눌러 주세요.");
      return;
    }
    writeAllRun = { stop: false, done: 0, total: targets.length };
    render();
    try {
      for (var i = 0; i < targets.length; i++) {
        if (writeAllRun.stop) break;
        await writeSection(targets[i].id, "write");
        writeAllRun.done++;
      }
      if (!writeAllRun.stop) toast("초안 작성이 끝났어요. 모의 심사를 받아 보세요!");
    } catch (e) {
      toast(e.message, true);
    } finally {
      writeAllRun = null;
      if (state.step === 4) render();
    }
  }

  /* 6단계 ─ 모의 심사 */
  function viewReview() {
    var head = '<div class="page-title"><h1>모의 심사</h1><p>AI 심사위원이 공고의 평가표로 채점하고, 점수를 올릴 방법을 알려 드려요.</p></div>';
    if (busy.review) return head + '<div class="card">' + working("<strong>평가표 항목별로 채점하고 있어요.</strong><br><span class=\"muted small\">1~2분 걸릴 수 있어요.</span>") + "</div>";
    var r = state.review;
    if (!r) {
      return head + '<div class="card hero-empty"><div class="icon" aria-hidden="true">🧑‍⚖️</div><p>초안을 평가표 기준으로 채점해 볼까요?</p>' +
        '<button class="btn btn-primary btn-lg" data-action="review">모의 심사 시작</button></div>' + navBar("초안 작성");
    }
    var rv = r.review;
    var pct = r.score.pct;
    var tone = pct >= 80 ? "" : pct >= 65 ? "warn" : "bad";
    var cutoff = state.analysis.evaluation && state.analysis.evaluation.cutoff;
    var byId = {};
    (state.analysis.evaluation.criteria || []).forEach(function (c) { byId[c.id] = c; });
    var secTitle = function (sid) {
      var s = state.outline.find(function (x) { return x.id === sid; });
      return s ? s.title : sid;
    };

    return head +
      (r.stale ? '<div class="notice warn">심사 후 초안이 바뀌었어요. 바뀐 내용으로 다시 심사받아 보세요. <button class="btn-link" data-action="review">다시 심사받기</button></div>' : "") +
      '<div class="card"><div class="score-hero"><div class="gauge ' + tone + '" style="--pct:' + pct + '"><div><div><strong>' + r.score.total + "</strong><span class=\"muted small\">/ " + r.score.max + "점</span></div></div></div>" +
      '<div style="flex:1;min-width:220px"><div class="row" style="margin-bottom:6px"><span class="badge ' + (rv.pass_likelihood === "높음" ? "badge-ok" : rv.pass_likelihood === "보통" ? "badge-warn" : "badge-bad") + '">선정 가능성 ' + esc(rv.pass_likelihood) + "</span>" +
      (cutoff ? '<span class="muted small">' + esc(cutoff) + "</span>" : "") + "</div><p>" + esc(rv.overall_comment) + '</p><p class="muted small">AI 모의 채점이며 실제 심사 결과와 다를 수 있어요.</p></div></div></div>' +

      ((rv.red_flags || []).length ? '<div class="notice bad"><strong>탈락 위험 요소</strong><ul>' + rv.red_flags.map(function (f) { return "<li>" + esc(f) + "</li>"; }).join("") + "</ul></div>" : "") +

      '<div class="card"><div class="card-head"><h2>점수 올리기 — 우선순위</h2>' +
      ((rv.top_fixes || []).length > 1 ? '<button class="btn btn-secondary btn-sm" data-action="apply-all-fixes">모두 보완하기</button>' : "") + "</div>" +
      (rv.top_fixes || []).map(function (f, i) {
        var st = state.applied[i];
        var isWriting = writing[f.section_id] !== undefined;
        return '<div class="fix"><div class="target">' + esc(secTitle(f.section_id)) + ' <span class="badge ' + (f.priority === "high" ? "badge-bad" : "badge-warn") + '">' + (f.priority === "high" ? "효과 큼" : "보통") + "</span></div>" +
          '<p class="small" style="margin:6px 0">' + esc(f.instruction) + '</p><div class="row">' +
          (isWriting ? '<span class="muted small">보완하는 중…</span>'
            : st ? '<span class="badge badge-ok">보완 완료</span><button class="btn-link" data-action="show-section" data-sec="' + esc(f.section_id) + '">보완된 내용 보기</button>'
              : '<button class="btn btn-primary btn-sm" data-action="apply-fix" data-index="' + i + '">이대로 보완하기</button>') + "</div></div>";
      }).join("") + "</div>" +

      (rv.criteria || []).map(function (c) {
        var cr = byId[c.criterion_id] || { name: c.criterion_id };
        var p = c.max_score ? Math.round((c.score / c.max_score) * 100) : 0;
        return '<div class="card"><div class="crit-head"><span>' + esc(cr.name) + "</span><span>" + c.score + " / " + c.max_score + "점</span></div>" +
          '<div class="bar ' + (p >= 80 ? "" : p >= 65 ? "warn" : "bad") + '"><span style="width:' + p + '%"></span></div>' +
          '<div class="two-col" style="margin-top:10px">' + reviewList("잘된 점", c.strengths) + reviewList("아쉬운 점", c.weaknesses) + reviewList("이렇게 고치세요", c.improvements) + "</div></div>";
      }).join("") +

      '<div class="card"><details><summary>자동 점검 결과 (분량·확인 필요·평가 키워드)</summary>' +
      r.lint.sections.map(function (s) {
        if (!s.issues.length) return "";
        return '<p style="margin-top:10px"><strong>' + esc(s.title) + '</strong></p><ul class="plain-list small">' + s.issues.map(function (i) { return "<li>" + esc(i.message) + "</li>"; }).join("") + "</ul>";
      }).join("") + "</details></div>" +

      '<div class="row end"><button class="btn btn-ghost" data-action="review">다시 심사받기</button></div>' +
      navBar("초안 작성", '<button class="btn btn-primary btn-lg" data-action="go" data-step="6">완성하러 가기 →</button>');
  }

  function reviewList(title, items) {
    return "<div><h4>" + esc(title) + '</h4><ul class="plain-list">' + (items || []).map(function (i) { return "<li>" + esc(i) + "</li>"; }).join("") + "</ul></div>";
  }

  async function applyFix(i) {
    var f = state.review.review.top_fixes[i];
    if (!f || !state.sections[f.section_id]) {
      toast("이 섹션은 아직 작성되지 않았어요. 초안 작성 단계에서 먼저 작성해 주세요.", true);
      return;
    }
    var p = writeSection(f.section_id, "revise", f.instruction);
    render();
    await p;
    state.applied[i] = true;
    save();
    if (state.step === 5) render();
  }

  /* 7단계 ─ 완성 */
  function viewFinish() {
    var a = state.analysis;
    var p = a.program || {};
    var pending = [];
    state.outline.forEach(function (s) {
      S.findPlaceholders(state.sections[s.id]).forEach(function (ph) { pending.push({ sec: s, ph: ph }); });
    });
    var empty = state.outline.filter(function (s) { return !(state.sections[s.id] || "").trim(); });

    return '<div class="page-title"><h1>마지막 점검과 내려받기</h1><p>제출 전에 아래 항목을 확인하세요.</p></div>' +
      (empty.length ? '<div class="notice bad">아직 작성하지 않은 섹션: ' + empty.map(function (s) { return esc(s.title); }).join(", ") + "</div>" : "") +
      '<div class="card"><div class="card-head"><h2>직접 채워야 할 곳</h2><span class="badge ' + (pending.length ? "badge-warn" : "badge-ok") + '">' + pending.length + "곳</span></div>" +
      (pending.length ? '<p class="muted small">AI가 모르는 사실은 지어내지 않고 표시만 해 두었어요. 사실대로 채우거나, 해당 없으면 문장을 지워 주세요.</p><ul class="plain-list">' +
        pending.slice(0, 40).map(function (x) {
          return '<li><button class="btn-link" data-action="show-section" data-sec="' + esc(x.sec.id) + '">' + esc(x.sec.title) + "</button> — <mark class=\"ph\">" + esc(x.ph) + "</mark></li>";
        }).join("") + "</ul>" : "<p>모두 채웠어요. 👍</p>") + "</div>" +

      '<div class="card"><h2>내려받기·복사</h2>' +
      '<p class="muted small">Word 파일(.docx)은 한글 프로그램에서도 열립니다. 공고의 한글 양식에 옮길 때는 섹션별 복사를 이용하세요 — 표 모양 그대로 붙여넣어집니다.</p>' +
      '<label class="row small" style="margin-bottom:10px"><input type="checkbox" data-action="toggle-notes"' + (state.includeNotes ? " checked" : "") + " /> 제출 전 확인 메모(평가항목 연결표·확인 필요 목록·제출 서류) 부록 포함</label>" +
      '<div class="row"><button class="btn btn-primary btn-lg" data-action="download-docx">Word 파일 내려받기</button>' +
      '<button class="btn btn-ghost" data-action="copy-all">전체 복사</button></div>' +
      '<div style="margin-top:14px">' + state.outline.map(function (s) {
        return '<div class="row" style="padding:6px 0;border-top:1px solid var(--border)"><span class="spacer">' + esc(s.title) + '</span><button class="btn btn-ghost btn-sm" data-action="copy-section" data-sec="' + esc(s.id) + '">복사</button></div>';
      }).join("") + "</div></div>" +

      '<div class="card"><h2>제출 서류 체크리스트</h2><div class="checklist">' +
      (a.required_documents || []).map(function (d, i) {
        return '<label><input type="checkbox" data-doc="' + i + '"' + (state.docsChecked[i] ? " checked" : "") + " /> <span>" + esc(d) + "</span></label>";
      }).join("") + "</div>" +
      '<p class="small" style="margin-top:12px"><strong>신청 기간</strong> ' + esc(p.application_period || p.deadline || "공고 확인") +
      (dday(p.deadline) ? " (" + dday(p.deadline) + ")" : "") + "<br><strong>신청 방법</strong> " + esc(p.how_to_apply || "공고 확인") +
      (p.contact ? "<br><strong>문의</strong> " + esc(p.contact) : "") + "</p></div>" +
      '<div class="row end"><button class="btn btn-ghost" data-action="export-project">작업 파일로 저장</button></div>' +
      navBar("모의 심사");
  }

  /* ── 동작 ─────────────────────────────────────────────── */
  function readAsBase64(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(",")[1] || ""); };
      r.onerror = function () { reject(new Error("파일을 읽지 못했습니다: " + file.name)); };
      r.readAsDataURL(file);
    });
  }

  async function addFiles(list) {
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      var total = files.reduce(function (s, x) { return s + x.size; }, 0) + f.size;
      if (total > MAX_UPLOAD_BYTES) {
        toast("파일 합계가 3MB를 넘어요. PDF는 공고 본문·양식·평가표 쪽만 따로 저장해 올려 주세요.", true);
        break;
      }
      if (files.length >= 6) {
        toast("파일은 6개까지 올릴 수 있어요.", true);
        break;
      }
      files.push({ name: f.name, size: f.size, data: await readAsBase64(f) });
    }
    render();
  }

  function resetDownstream() {
    state.prep = null;
    state.answers = {};
    state.excl = {};
    state.sections = {};
    state.sectionInfo = {};
    state.review = null;
    state.applied = {};
    state.docsChecked = {};
  }

  async function analyze() {
    var text = state.source.tab === "paste" ? state.source.text.trim() : "";
    if (!files.length && !text) {
      toast(state.source.tab === "paste" ? "공고 내용을 붙여넣어 주세요." : "공고문 파일을 올려 주세요. (또는 '예시 공고로 체험하기')", true);
      return;
    }
    if (hasDraft() && !window.confirm("새 공고를 분석하면 지금까지 작성한 초안이 지워집니다. 계속할까요?\n(필요하면 먼저 '작업 파일로 저장'을 하세요)")) return;
    busy.analyze = true;
    render();
    try {
      var res = await api("/api/analyze", {
        files: files.map(function (f) { return { name: f.name, data: f.data }; }),
        text: text,
        meta: state.source.meta,
      });
      state.analysis = res.analysis;
      state.outline = res.outline;
      state.sources = res.sources || [];
      state.notes = res.notes || [];
      resetDownstream();
      busy.analyze = false;
      go(1);
    } catch (e) {
      busy.analyze = false;
      render();
      toast(e.message, true);
    }
  }

  async function prepare() {
    busy.prepare = true;
    render();
    try {
      var res = await api("/api/prepare", { analysis: state.analysis, profile: state.profile });
      var oldAnswers = state.answers;
      state.prep = res;
      state.answers = {};
      (res.questions || []).forEach(function (q) { if (oldAnswers[q.id]) state.answers[q.id] = oldAnswers[q.id]; });
      busy.prepare = false;
      go(3);
    } catch (e) {
      busy.prepare = false;
      render();
      toast(e.message, true);
    }
  }

  async function review() {
    busy.review = true;
    render();
    try {
      state.review = await api("/api/review", planPayload());
      state.applied = {};
      save();
    } catch (e) {
      toast(e.message, true);
    } finally {
      busy.review = false;
      if (state.step === 5) render();
    }
  }

  async function downloadDocx() {
    try {
      var res = await fetch("/api/export", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(planPayload({ options: { include_notes: state.includeNotes } })),
      });
      if (!res.ok) throw new Error("문서 파일을 만들지 못했습니다.");
      var blob = await res.blob();
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (state.profile.business_name || "우리가게") + "_사업계획서.docx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    } catch (e) {
      toast(e.message, true);
    }
  }

  function exportProject() {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "사업계획서_작업파일_" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function importProject(file) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var s = JSON.parse(String(r.result));
        if (!s || s.v !== 1) throw new Error();
        state = Object.assign(fresh(), s);
        save();
        render();
        toast("작업 파일을 불러왔어요.");
      } catch (e) {
        toast("작업 파일 형식이 아닙니다.", true);
      }
    };
    r.readAsText(file);
  }

  async function loadAnnouncements() {
    if (announcements) return;
    try {
      var res = await fetch("data/announcements.json", { cache: "no-store" });
      announcements = res.ok ? await res.json() : { items: [] };
    } catch (e) {
      announcements = { items: [] };
    }
    if (state.step === 0 && state.source.tab === "list") render();
  }

  async function fetchAnnFile(i) {
    var f = state.source.meta.files[i];
    busy.fetching[i] = true;
    render();
    try {
      var res = await api("/api/fetch-file", { url: f.url });
      files.push({ name: res.name || f.name, size: res.size, data: res.data });
      toast("첨부파일을 추가했어요: " + (res.name || f.name));
    } catch (e) {
      toast(e.message, true);
    } finally {
      delete busy.fetching[i];
      render();
    }
  }

  var actions = {
    go: function (el) { go(Number(el.dataset.step)); },
    "source-tab": function (el) { state.source.tab = el.dataset.tab; save(); render(); },
    "remove-file": function (el) { files.splice(Number(el.dataset.index), 1); render(); },
    "load-sample": async function () {
      try {
        var res = await fetch("samples/sample-announcement.txt");
        state.source.text = await res.text();
        state.source.tab = "paste";
        state.source.meta = null;
        render();
        toast("예시 공고를 넣었어요. '공고 분석하기'를 눌러 보세요.");
      } catch (e) {
        toast("예시 공고를 불러오지 못했습니다.", true);
      }
    },
    analyze: analyze,
    prepare: prepare,
    review: review,
    "clear-meta": function () { state.source.meta = null; save(); render(); },
    "pick-ann": function (el) {
      var a = (announcements.items || []).find(function (x) { return x.id === el.dataset.id; });
      if (!a) return;
      state.source.meta = { id: a.id, title: a.title, agency: a.agency, url: a.url, period: a.period, files: a.files || [] };
      save();
      render();
    },
    "fetch-ann-file": function (el) { fetchAnnFile(Number(el.dataset.index)); },
    write: function (el) {
      var id = el.dataset.sec;
      if ((state.sections[id] || "").trim() && !window.confirm("지금 내용을 지우고 새로 작성할까요? (직접 고친 내용도 사라집니다)")) return;
      writeSection(id, "write").catch(function (e) { toast(e.message, true); });
    },
    "write-all": writeAll,
    "stop-all": function () { if (writeAllRun) { writeAllRun.stop = true; toast("지금 쓰는 섹션까지만 작성하고 멈춥니다."); } },
    "toggle-edit": function (el) { var id = el.dataset.sec; editing[id] = !editing[id]; refreshSection(id); },
    "copy-section": function (el) {
      var text = state.sections[el.dataset.sec] || "";
      if (!text.trim()) return toast("아직 작성되지 않은 섹션입니다.", true);
      copyRich(text).then(function () { toast("복사했어요. 한글·워드에 붙여넣으세요."); });
    },
    "copy-all": function () {
      var md = state.outline.map(function (s) { return "# " + s.title + "\n\n" + (state.sections[s.id] || ""); }).join("\n\n");
      copyRich(md).then(function () { toast("전체를 복사했어요."); });
    },
    "apply-fix": function (el) { applyFix(Number(el.dataset.index)).catch(function (e) { toast(e.message, true); render(); }); },
    "apply-all-fixes": async function () {
      var fixes = state.review.review.top_fixes || [];
      for (var i = 0; i < fixes.length; i++) {
        if (state.applied[i]) continue;
        try { await applyFix(i); } catch (e) { toast(e.message, true); break; }
      }
    },
    "show-section": function (el) {
      go(4);
      setTimeout(function () {
        var t = document.getElementById("sec-" + el.dataset.sec);
        if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 60);
    },
    "download-docx": downloadDocx,
    "export-project": function () { exportProject(); closeMenu(); },
    "set-access-code": function () { askAccessCode(); closeMenu(); },
    reset: function () {
      closeMenu();
      if (!window.confirm("지금까지 입력한 내용과 초안을 모두 지우고 처음부터 시작할까요?")) return;
      state = fresh();
      files = [];
      save();
      render();
    },
    "open-menu": function (el) {
      var m = $("#menu");
      m.hidden = !m.hidden;
      el.setAttribute("aria-expanded", String(!m.hidden));
    },
  };

  function closeMenu() {
    $("#menu").hidden = true;
    var b = document.querySelector('[data-action="open-menu"]');
    if (b) b.setAttribute("aria-expanded", "false");
  }

  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-action]");
    if (!el || el.tagName === "INPUT") {
      if (!e.target.closest("#menu") && !e.target.closest('[data-action="open-menu"]')) closeMenu();
      return;
    }
    var fn = actions[el.dataset.action];
    if (!fn) return;
    e.preventDefault();
    Promise.resolve(fn(el, e)).catch(function (err) { toast(err.message, true); });
  });

  document.addEventListener("input", function (e) {
    var t = e.target;
    if (t.dataset.field) {
      var f = S.PROFILE_FIELDS.find(function (x) { return x.key === t.dataset.field; });
      state.profile[t.dataset.field] = f && f.type === "checkbox" ? t.checked : t.value;
      save();
      var prog = $("#profile-progress");
      if (prog) {
        var total = S.PROFILE_FIELDS.filter(function (x) { return x.type !== "checkbox"; });
        var filled = total.filter(function (x) { var v = state.profile[x.key]; return v !== undefined && String(v).trim() !== ""; }).length;
        prog.textContent = "입력한 항목 " + filled + " / " + total.length;
      }
    } else if (t.dataset.answer) {
      state.answers[t.dataset.answer] = t.value;
      save();
      var qc = $("#q-count");
      if (qc) qc.textContent = Object.keys(state.answers).filter(function (k) { return String(state.answers[k]).trim(); }).length;
    } else if (t.dataset.strategy) {
      state.prep.strategy[t.dataset.strategy] = t.value;
      save();
    } else if (t.dataset.editor) {
      state.sections[t.dataset.editor] = t.value;
      if (state.review) state.review.stale = true;
      save();
    } else if (t.hasAttribute("data-source-text")) {
      state.source.text = t.value;
      save();
    } else if (t.hasAttribute("data-ann-query")) {
      annQuery = t.value;
      var pos = t.selectionStart;
      render();
      var again = document.querySelector("[data-ann-query]");
      if (again) { again.focus(); again.setSelectionRange(pos, pos); }
    }
  });

  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.dataset.action === "pick-files") addFiles(Array.from(t.files || [])).catch(function (err) { toast(err.message, true); });
    else if (t.dataset.action === "import-project" && t.files[0]) { importProject(t.files[0]); closeMenu(); }
    else if (t.dataset.action === "toggle-notes") { state.includeNotes = t.checked; save(); }
    else if (t.dataset.excl) { state.excl[t.dataset.excl] = t.checked; save(); }
    else if (t.dataset.doc) { state.docsChecked[t.dataset.doc] = t.checked; save(); }
    else if (t.dataset.field && t.type === "checkbox") { state.profile[t.dataset.field] = t.checked; save(); }
  });

  /* 파일 끌어다 놓기 */
  ["dragenter", "dragover"].forEach(function (type) {
    document.addEventListener(type, function (e) {
      var dz = e.target.closest && e.target.closest("#dropzone");
      if (!dz) return;
      e.preventDefault();
      dz.classList.add("drag");
    });
  });
  document.addEventListener("dragleave", function (e) {
    var dz = e.target.closest && e.target.closest("#dropzone");
    if (dz) dz.classList.remove("drag");
  });
  document.addEventListener("drop", function (e) {
    var dz = e.target.closest && e.target.closest("#dropzone");
    if (!dz) return;
    e.preventDefault();
    dz.classList.remove("drag");
    addFiles(Array.from(e.dataTransfer.files || [])).catch(function (err) { toast(err.message, true); });
  });

  /* ── 시작 ─────────────────────────────────────────────── */
  if (!canGo(state.step)) state.step = 0;
  render();
  fetch("/api/health").then(function (r) { return r.json(); }).then(function (h) {
    server = h;
    $("#mode-badge").hidden = h.mode !== "demo";
    if (!h.ready && state.step === 0) render();
  }).catch(function () { /* 정적 미리보기 등 — 무시 */ });
})();
