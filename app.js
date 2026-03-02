import { makeKey, upsertBook, getBook, listBooks, deleteBook, wipeAll } from "./db.js";

const $ = (id) => document.getElementById(id);

const cfg = {
  feeRate: 0.10,
  condFactor: { A: 1.00, B: 0.92, C: 0.85 },
  goProfitMin: 300,
};

let selectedShipping = null;

function yen(n) {
  const v = Number.isFinite(n) ? Math.round(n) : 0;
  return v.toLocaleString("ja-JP");
}

function median3(a, b, c) {
  const xs = [a, b, c].map(x => Number(x)).filter(n => Number.isFinite(n) && n >= 0);
  if (xs.length < 3) return null;
  xs.sort((x,y) => x-y);
  return xs[1];
}

function calc({ medianPrice, cost, condition, shipping }) {
  const cf = cfg.condFactor[condition] ?? 0.92;
  const net = Math.floor(medianPrice * cf * (1 - cfg.feeRate));
  const profit = net - shipping - cost;

  let decision = "NO";
  if (profit >= cfg.goProfitMin) decision = "GO";
  else if (profit >= 0) decision = "HOLD";

  const maxCostForGo = net - shipping - cfg.goProfitMin;

  return { cf, net, profit, decision, maxCostForGo };
}

function setPill(decision) {
  const el = $("decisionPill");
  el.style.display = "inline-flex";
  el.className = "pill";
  if (decision === "GO") { el.classList.add("go"); el.textContent = "🟢 GO"; }
  else if (decision === "HOLD") { el.classList.add("hold"); el.textContent = "🟡 保留"; }
  else { el.classList.add("no"); el.textContent = "🔴 見送り"; }
}

function readInputs() {
  const title = $("title").value.trim();
  const isbn = $("isbn").value.trim();
  const cost = Number($("cost").value || 0);
  const condition = $("condition").value;
  const shipping = selectedShipping ?? 0;

  const p1 = $("p1").value.trim();
  const p2 = $("p2").value.trim();
  const p3 = $("p3").value.trim();

  return { title, isbn, cost, condition, shipping, p1, p2, p3 };
}

async function evaluate() {
  const { title, isbn, cost, condition, shipping, p1, p2, p3 } = readInputs();
  if (!title && !isbn) {
    $("result").textContent = "題名かISBNを入れてください。";
    return;
  }
  if (!Number.isFinite(cost) || cost < 0) {
    $("result").textContent = "仕入れ合計（円）を正しく入れてください。";
    return;
  }

  const key = makeKey({ isbn, title });
  const saved = await getBook(key);

  let med = median3(p1, p2, p3);
  let used = "入力した売値(3件)";

  if (med === null) {
    if (saved?.medianPrice != null) {
      med = saved.medianPrice;
      used = "保存済みの中央値";
    } else {
      $("result").textContent = "初回は売れた価格を3件入れてください（中央値で判定します）。";
      return;
    }
  }

  const r = calc({ medianPrice: med, cost, condition, shipping });
  setPill(r.decision);

  $("result").innerHTML = `
    <div>使用：<span class="mono">${used}</span></div>
    <div>売値中央値：<span class="mono">${yen(med)}円</span></div>
    <div>状態係数：<span class="mono">${r.cf.toFixed(2)}</span></div>
    <div>手数料後の想定売上：<span class="mono">${yen(r.net)}円</span></div>
    <div>送料：<span class="mono">${yen(shipping)}円</span></div>
    <div>仕入れ：<span class="mono">${yen(cost)}円</span></div>
    <div style="margin-top:6px;">推定利益：<span class="mono">${yen(r.profit)}円</span></div>
    <div class="muted">🟢GOライン（利益${cfg.goProfitMin}円以上）での最大仕入れ目安：<span class="mono">${yen(r.maxCostForGo)}円</span></div>
  `;
}

async function saveCurrent() {
  const { title, isbn, p1, p2, p3 } = readInputs();
  if (!title && !isbn) { alert("題名かISBNを入れてください"); return; }

  const key = makeKey({ isbn, title });
  const old = await getBook(key);

  let med = median3(p1, p2, p3);
  if (med === null && old?.medianPrice != null) med = old.medianPrice;

  if (med === null) {
    alert("初回保存は売れた価格を3件入れてください（中央値を保存します）");
    return;
  }

  const now = Date.now();
  const book = {
    key,
    title: title || old?.title || "",
    isbn: isbn || old?.isbn || "",
    titleLower: (title || old?.title || "").toLowerCase(),
    medianPrice: med,
    updatedAt: now,
    createdAt: old?.createdAt ?? now,
  };

  await upsertBook(book);
  await refreshList();
  alert("保存しました！");
}

function clearInputs() {
  $("title").value = "";
  $("isbn").value = "";
  $("cost").value = "";
  $("condition").value = "B";
  $("p1").value = "";
  $("p2").value = "";
  $("p3").value = "";
  selectedShipping = null;
  $("shipLabel").textContent = "未選択";
  $("decisionPill").style.display = "none";
  $("result").textContent = "";
}

async function loadBookToForm(book) {
  $("title").value = book.title || "";
  $("isbn").value = book.isbn || "";
  $("p1").value = "";
  $("p2").value = "";
  $("p3").value = "";
  $("result").textContent = `保存済み中央値（${yen(book.medianPrice)}円）で判定できます。仕入れ/状態/送料を入れて「判定する」へ。`;
  $("decisionPill").style.display = "none";
}

async function refreshList() {
  const q = $("q").value;
  const books = await listBooks({ q });
  const list = $("list");
  list.innerHTML = "";

  if (books.length === 0) {
    list.innerHTML = `<div class="muted">まだ保存データがありません。</div>`;
    return;
  }

  for (const b of books) {
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="itemtop">
        <div class="itemtitle">${(b.title || "(無題)")}</div>
        <div class="mono">${yen(b.medianPrice)}円</div>
      </div>
      <div class="tags">
        ${b.isbn ? `<span class="tag mono">ISBN ${b.isbn}</span>` : `<span class="tag mono">titleキー</span>`}
        <span class="tag mono">更新 ${new Date(b.updatedAt).toLocaleString("ja-JP")}</span>
      </div>
      <div class="btnrow" style="margin-top:10px;">
        <button class="small" data-act="use">使う</button>
        <button class="small ghost" data-act="del"><span class="danger">削除</span></button>
      </div>
    `;

    el.querySelector('[data-act="use"]').onclick = async () => { await loadBookToForm(b); window.scrollTo({ top: 0, behavior: "smooth" }); };
    el.querySelector('[data-act="del"]').onclick = async () => {
      if (!confirm("削除しますか？")) return;
      await deleteBook(b.key);
      await refreshList();
    };

    list.appendChild(el);
  }
}

function setupShippingButtons() {
  document.querySelectorAll("button[data-ship]").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedShipping = Number(btn.dataset.ship);
      $("shipLabel").textContent = `${selectedShipping}`;
    });
  });
  $("shipReset").addEventListener("click", () => {
    selectedShipping = null;
    $("shipLabel").textContent = "未選択";
  });
}

function registerSW() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
      try { await navigator.serviceWorker.register("./sw.js"); }
      catch (e) { /* ignore */ }
    });
  }
}

$("evalBtn").addEventListener("click", evaluate);
$("saveBtn").addEventListener("click", saveCurrent);
$("clearBtn").addEventListener("click", clearInputs);
$("refreshBtn").addEventListener("click", refreshList);
$("q").addEventListener("input", refreshList);
$("wipeBtn").addEventListener("click", async () => {
  if (!confirm("このiPhone内の保存データを全部消します。OK？")) return;
  await wipeAll();
  await refreshList();
  alert("全消去しました");
});

setupShippingButtons();
registerSW();
refreshList();
