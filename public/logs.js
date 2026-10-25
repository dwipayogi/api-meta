(function () {
  let logs = [];
  let selectedLogId = null;
  let searchFilter = "";

  // DOM Elements
  const logsListContainer = document.getElementById("logs-list-container");
  const logSearchInput = document.getElementById("log-search-input");
  const btnManualRefresh = document.getElementById("btn-manual-refresh");
  const statTotalLogs = document.getElementById("stat-total-logs");
  const logEmptyView = document.getElementById("log-empty-view");
  const logSelectedView = document.getElementById("log-selected-view");

  const selectedLogTitle = document.getElementById("selected-log-title");
  const selectedLogSubtitle = document.getElementById("selected-log-subtitle");
  const detailStatus = document.getElementById("detail-status");
  const detailIp = document.getElementById("detail-ip");
  const detailObject = document.getElementById("detail-object");
  const detailTime = document.getElementById("detail-time");
  const detailJsonPre = document.getElementById("detail-json-pre");
  const btnCopyLogJson = document.getElementById("btn-copy-log-json");
  const btnDownloadLogJson = document.getElementById("btn-download-log-json");

  // Format Waktu
  function formatDateTime(isoString) {
    if (!isoString) return "-";
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "-";
    return d.toLocaleString("id-ID", {
      dateStyle: "medium",
      timeStyle: "medium",
    });
  }

  // Escape HTML
  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Ringkasan Isi Payload
  function getPayloadSummary(log) {
    try {
      const p = log.payload;
      if (!p || typeof p !== "object") return "Payload tidak valid";
      const entries = p.entry || [];
      if (entries.length === 0) return p.object || "Meta Event";
      
      const firstEntry = entries[0];
      const changes = firstEntry.changes || [];
      if (changes.length > 0) {
        const val = changes[0].value || {};
        if (val.messages && val.messages.length > 0) {
          const msg = val.messages[0];
          return `Pesan masuk: "${msg.text?.body || msg.type || 'Pesan'}" dari ${msg.from}`;
        }
        if (val.statuses && val.statuses.length > 0) {
          const st = val.statuses[0];
          return `Status pesan: ${st.status} (ID: ${st.id.slice(0, 16)}...)`;
        }
      }
      return `${p.object} (${entries.length} entry)`;
    } catch (e) {
      return "Payload WhatsApp Event";
    }
  }

  // Fetch Logs dari API
  async function fetchLogs() {
    try {
      const res = await fetch("/api/webhook-logs?limit=100");
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      logs = await res.json();
      statTotalLogs.textContent = logs.length;
      renderLogsList();

      if (selectedLogId) {
        const stillExists = logs.find((l) => String(l.id) === String(selectedLogId));
        if (stillExists) {
          showLogDetail(stillExists);
        }
      } else if (logs.length > 0) {
        // Auto select first log if none selected
        selectLog(logs[0].id);
      }
    } catch (err) {
      console.error("Gagal mengambil log payload:", err);
    }
  }

  // Render Daftar Log
  function renderLogsList() {
    const query = searchFilter.trim().toLowerCase();
    const filtered = logs.filter((log) => {
      const summary = getPayloadSummary(log).toLowerCase();
      const ip = (log.ip_address || "").toLowerCase();
      const id = String(log.id).toLowerCase();
      const obj = (log.object_type || "").toLowerCase();
      const raw = JSON.stringify(log.payload || {}).toLowerCase();
      return (
        summary.includes(query) ||
        ip.includes(query) ||
        id.includes(query) ||
        obj.includes(query) ||
        raw.includes(query)
      );
    });

    if (filtered.length === 0) {
      logsListContainer.innerHTML = `
        <div class="empty-logs-placeholder">
          ${query ? "Tidak ada log yang cocok dengan pencarian." : "Belum ada log payload webhook yang tercatat."}
        </div>
      `;
      return;
    }

    logsListContainer.innerHTML = filtered
      .map((log) => {
        const isActive = String(log.id) === String(selectedLogId);
        const summary = getPayloadSummary(log);
        const timeStr = formatDateTime(log.created_at);

        return `
          <div class="log-item ${isActive ? "active" : ""}" data-id="${log.id}">
            <div class="log-item-header">
              <span class="status-badge-ok">HTTP ${log.status_code || 200} OK</span>
              <span class="log-time">${escapeHtml(timeStr)}</span>
            </div>
            <div class="log-object">Log #${log.id} — ${escapeHtml(log.object_type || "whatsapp")}</div>
            <div class="log-meta-sub">
              <span>${escapeHtml(summary)}</span>
            </div>
            <div class="log-meta-sub" style="margin-top: 4px;">
              <span>IP: ${escapeHtml(log.ip_address || "local")}</span>
              <span>${log.entry_count || 1} update</span>
            </div>
          </div>
        `;
      })
      .join("");

    logsListContainer.querySelectorAll(".log-item").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.getAttribute("data-id");
        if (id) selectLog(id);
      });
    });
  }

  // Pilih Log
  function selectLog(id) {
    selectedLogId = id;
    renderLogsList();
    const log = logs.find((l) => String(l.id) === String(id));
    if (log) {
      showLogDetail(log);
    }
  }

  // Tampilkan Detail Log & Raw JSON
  function showLogDetail(log) {
    logEmptyView.style.display = "none";
    logSelectedView.style.display = "flex";

    selectedLogTitle.textContent = `Log #${log.id}`;
    selectedLogSubtitle.textContent = `Diterima pada ${formatDateTime(log.created_at)} dari ${log.ip_address || "IP lokal"}`;

    detailStatus.textContent = `${log.status_code || 200} OK`;
    detailIp.textContent = log.ip_address || "unknown";
    detailObject.textContent = log.object_type || "whatsapp_business_account";
    detailTime.textContent = formatDateTime(log.created_at);

    const jsonStr = JSON.stringify(log.payload, null, 2);
    detailJsonPre.textContent = jsonStr;
  }

  // Copy JSON ke Clipboard
  btnCopyLogJson.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(detailJsonPre.textContent);
      const prev = btnCopyLogJson.textContent;
      btnCopyLogJson.textContent = "✓ Tersalin!";
      setTimeout(() => (btnCopyLogJson.textContent = prev), 2000);
    } catch (e) {
      alert("Gagal menyalin JSON");
    }
  });

  // Download File JSON
  btnDownloadLogJson.addEventListener("click", () => {
    if (!selectedLogId) return;
    const blob = new Blob([detailJsonPre.textContent], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `webhook-payload-log-${selectedLogId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // Search Filter
  logSearchInput.addEventListener("input", (e) => {
    searchFilter = e.target.value;
    renderLogsList();
  });

  // Manual Refresh
  btnManualRefresh.addEventListener("click", () => {
    fetchLogs();
  });

  // Initial Load
  fetchLogs();

  // Polling Real-time setiap 3 detik
  setInterval(fetchLogs, 3000);
})();
