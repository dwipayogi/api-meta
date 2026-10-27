(function () {
  let conversations = [];
  let activeContactId = null;
  let activeMessages = [];
  let searchQuery = "";
  let lastMessageId = null;
  let manualUnreadContactId = null;

  // Elemen DOM
  const appWrapper = document.getElementById("app-wrapper");
  const conversationListEl = document.getElementById("conversation-list");
  const searchInputEl = document.getElementById("search-input");
  const emptyStateEl = document.getElementById("empty-state");
  const activeChatContentEl = document.getElementById("active-chat-content");
  const activeChatNameEl = document.getElementById("active-chat-name");
  const activeChatSubEl = document.getElementById("active-chat-sub");
  const activeChatAvatarEl = document.getElementById("active-chat-avatar");
  const messagesContainerEl = document.getElementById("messages-container");
  const btnBackEl = document.getElementById("btn-back");
  const btnViewContactDetails = document.getElementById("btn-view-contact-details");
  const currentUserAvatarEl = document.getElementById("current-user-avatar");
  const currentUsernameEl = document.getElementById("current-username");

  // Input Chat & File Elemen
  const chatInputFormEl = document.getElementById("chat-input-form");
  const chatMessageInputEl = document.getElementById("chat-message-input");
  const chatFileInputEl = document.getElementById("chat-file-input");
  const btnSendMessageEl = document.getElementById("btn-send-message");
  const filePreviewBarEl = document.getElementById("file-preview-bar");
  const filePreviewNameEl = document.getElementById("file-preview-name");
  const filePreviewIconEl = document.getElementById("file-preview-icon");
  const filePreviewSizeEl = document.getElementById("file-preview-size");
  const btnRemoveFileEl = document.getElementById("btn-remove-file");

  let selectedFile = null;

  // Modal Detail Payload Elemen
  const payloadModalEl = document.getElementById("payload-modal");
  const btnModalCloseX = document.getElementById("btn-modal-close-x");
  const btnModalClose = document.getElementById("btn-modal-close");
  const btnCopyJson = document.getElementById("btn-copy-json");
  const modalMsgId = document.getElementById("modal-msg-id");
  const modalFromNumber = document.getElementById("modal-from-number");
  const modalContactInfo = document.getElementById("modal-contact-info");
  const modalBusinessNumber = document.getElementById("modal-business-number");
  const modalTypeStatus = document.getElementById("modal-type-status");
  const modalTimestamp = document.getElementById("modal-timestamp");
  const modalJsonContent = document.getElementById("modal-json-content");

  // Helper Initials
  function getInitials(name) {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  }

  // Format Waktu
  function formatTime(isoString) {
    if (!isoString) return "";
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return "";
    const now = new Date();
    const isToday =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear();

    if (isToday) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleDateString([], { day: "2-digit", month: "2-digit" });
  }

  // Format Waktu Lengkap
  function formatFullDateTime(isoString) {
    if (!isoString) return "-";
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return "-";
    return date.toLocaleString();
  }

  // Update Status Koneksi di UI Sidebar
  function updateConnectionStatus(isOnline) {
    const statusDot = document.querySelector(".sidebar-header .status-dot");
    const statusText = document.querySelector(".sidebar-header .status-pill span:last-child");
    if (statusDot && statusText) {
      statusDot.classList.toggle("status-offline", !isOnline);
      if (isOnline) {
        statusText.textContent = "Live (3s)";
        statusText.style.color = "#008069";
      } else {
        statusText.textContent = "Terputus";
        statusText.style.color = "#dc2626";
      }
    }
  }

  // Ambil Data Profil Pengguna
  async function loadMe() {
    try {
      const res = await fetch("/api/me");
      if (res.status === 401) {
        window.location.href = "/login?error=session_expired";
        return;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.username) {
        currentUsernameEl.textContent = data.username;
        currentUserAvatarEl.textContent = data.username.slice(0, 1).toUpperCase();
      }
    } catch (err) {
      console.warn("Gagal memuat profil admin:", err);
    }
  }

  // Ambil Daftar Percakapan
  async function loadConversations(isManual = false) {
    try {
      const res = await fetch("/api/conversations");
      if (res.status === 401) {
        window.location.href = "/login?error=session_expired";
        return;
      }
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${res.status}`);
      }

      conversations = await res.json();
      updateConnectionStatus(true);
      renderConversationList();
    } catch (err) {
      console.error("Gagal mengambil percakapan:", err);
      updateConnectionStatus(false);

      if (conversations.length === 0) {
        conversationListEl.innerHTML = `
          <div class="list-error-banner">
            <div>⚠️ <strong>Gagal memuat percakapan</strong></div>
            <div style="font-size: 12px; margin-top: 4px; color: #7f1d1d;">${escapeHtml(err.message || "Koneksi terputus ke server")}</div>
            <button class="btn-retry" id="btn-retry-conv">
              🔄 Coba Lagi
            </button>
          </div>
        `;
        const retryBtn = document.getElementById("btn-retry-conv");
        if (retryBtn) {
          retryBtn.addEventListener("click", () => loadConversations(true));
        }
      }

      if (isManual && window.showErrorModal) {
        window.showErrorModal(
          `Tidak dapat terhubung ke server untuk memuat percakapan WhatsApp: ${err.message}`,
          { title: "Koneksi Gagal" }
        );
      }
    }
  }

  // Render Daftar Percakapan di Sidebar
  function renderConversationList() {
    const query = searchQuery.trim().toLowerCase();
    const filtered = conversations.filter((item) => {
      const name = (item.contact_name || "").toLowerCase();
      const phone = (item.from_number || "").toLowerCase();
      const id = (item.contact_identifier || "").toLowerCase();
      const lastMsg = (item.last_message || "").toLowerCase();
      return (
        name.includes(query) ||
        phone.includes(query) ||
        id.includes(query) ||
        lastMsg.includes(query)
      );
    });

    if (filtered.length === 0) {
      conversationListEl.innerHTML = `
        <div class="empty-conversations">
          ${query ? "Tidak ada percakapan yang cocok dengan pencarian." : "Belum ada pesan webhook yang diterima."}
        </div>
      `;
      return;
    }

    conversationListEl.innerHTML = filtered
      .map((item) => {
        const isActive = item.contact_identifier === activeContactId;
        const initials = getInitials(item.contact_name || item.from_number);
        const timeStr = formatTime(item.last_timestamp);
        const hasUnread = Boolean(item.unread_count && item.unread_count > 0);

        return `
          <div class="conversation-item ${isActive ? "active" : ""} ${hasUnread ? "has-unread" : ""}" data-id="${escapeHtml(item.contact_identifier)}">
            <div class="contact-avatar">${escapeHtml(initials)}</div>
            <div class="conversation-details">
              <div class="contact-header">
                <span class="contact-name">${escapeHtml(item.contact_name || item.from_number)}</span>
                <span class="last-time">${escapeHtml(timeStr)}</span>
              </div>
              <div class="contact-preview">
                <span class="last-message">${escapeHtml(item.last_message || "Pesan")}</span>
                <div style="display: flex; align-items: center;">
                  ${hasUnread ? `<span class="unread-badge" title="${item.unread_count} pesan belum dibaca">${item.unread_count}</span>` : ""}
                  <div class="conv-actions">
                    ${
                      hasUnread
                        ? `<button class="btn-conv-action btn-item-read" data-id="${escapeHtml(item.contact_identifier)}" title="Tandai Sudah Dibaca">✓ Dibaca</button>`
                        : `<button class="btn-conv-action btn-item-unread" data-id="${escapeHtml(item.contact_identifier)}" title="Tandai Belum Dibaca">✉️ Belum</button>`
                    }
                  </div>
                </div>
              </div>
            </div>
          </div>
        `;
      })
      .join("");

    // Event listener per item
    conversationListEl.querySelectorAll(".conversation-item").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.getAttribute("data-id");
        if (id) selectConversation(id);
      });
    });

    // Event listener tombol aksi cepat di item list
    conversationListEl.querySelectorAll(".btn-item-read").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.getAttribute("data-id");
        if (id) markAsRead(id);
      });
    });

    conversationListEl.querySelectorAll(".btn-item-unread").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.getAttribute("data-id");
        if (id) markAsUnread(id);
      });
    });
  }

  // Helper Tandai Sudah Dibaca (Internal + Meta Graph API)
  async function markAsRead(contactId) {
    if (!contactId) return;
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(contactId)}/read`, { method: "POST" });
      if (res.status === 401) {
        window.location.href = "/login?error=session_expired";
        return;
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const conv = conversations.find((c) => c.contact_identifier === contactId);
      if (conv) conv.unread_count = 0;
      renderConversationList();
    } catch (err) {
      console.error("Gagal menandai sudah dibaca:", err);
      if (window.showErrorModal) {
        window.showErrorModal(
          `Gagal memperbarui status baca percakapan: ${err.message || "Koneksi terputus"}`,
          { title: "Gagal Mengubah Status" }
        );
      }
    }
  }

  // Helper Tandai Belum Dibaca
  async function markAsUnread(contactId) {
    if (!contactId) return;
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(contactId)}/unread`, { method: "POST" });
      if (res.status === 401) {
        window.location.href = "/login?error=session_expired";
        return;
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const conv = conversations.find((c) => c.contact_identifier === contactId);
      if (conv) conv.unread_count = Math.max(1, (conv.unread_count || 0) + 1);
      renderConversationList();
    } catch (err) {
      console.error("Gagal menandai belum dibaca:", err);
      if (window.showErrorModal) {
        window.showErrorModal(
          `Gagal menandai percakapan sebagai belum dibaca: ${err.message || "Koneksi terputus"}`,
          { title: "Gagal Mengubah Status" }
        );
      }
    }
  }

  // Pilih Percakapan
  async function selectConversation(contactId) {
    manualUnreadContactId = null;
    activeContactId = contactId;

    const conv = conversations.find((c) => c.contact_identifier === contactId);
    if (conv) {
      activeChatNameEl.textContent = conv.contact_name || conv.from_number;
      activeChatSubEl.textContent = `WA ID: ${conv.contact_identifier} | No: ${conv.from_number}`;
      activeChatAvatarEl.textContent = getInitials(conv.contact_name || conv.from_number);

      // Jika ada unread, otomatis tandai sudah dibaca
      if (conv.unread_count > 0) {
        conv.unread_count = 0;
        markAsRead(contactId);
      }
    }

    renderConversationList();

    emptyStateEl.style.display = "none";
    activeChatContentEl.style.display = "flex";
    appWrapper.classList.add("chat-open");

    await loadMessages(true);
  }

  // Ambil Pesan untuk Kontak Aktif
  async function loadMessages(scrollToBottom = false) {
    if (!activeContactId) return;

    try {
      const res = await fetch(`/api/messages?contact=${encodeURIComponent(activeContactId)}`);
      if (res.status === 401) {
        window.location.href = "/login?error=session_expired";
        return;
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const messages = await res.json();
      activeMessages = messages;

      const currentLatestId = messages.length > 0 ? messages[messages.length - 1].id : null;
      if (currentLatestId !== lastMessageId) {
        manualUnreadContactId = null;
      }

      // Jika ada pesan yang masih unread saat chat dibuka (dan bukan baru saja ditandai belum dibaca secara manual)
      if (activeContactId !== manualUnreadContactId && messages.some((m) => m.is_read === false)) {
        markAsRead(activeContactId);
      }

      const shouldScroll = scrollToBottom || currentLatestId !== lastMessageId;
      lastMessageId = currentLatestId;

      renderMessages();

      if (shouldScroll) {
        messagesContainerEl.scrollTop = messagesContainerEl.scrollHeight;
      }
    } catch (err) {
      console.error("Gagal mengambil pesan:", err);
      if (activeMessages.length === 0) {
        messagesContainerEl.innerHTML = `
          <div class="list-error-banner" style="margin: 32px auto; max-width: 360px;">
            <div>⚠️ <strong>Gagal memuat pesan</strong></div>
            <div style="font-size: 12px; margin: 4px 0 8px; color: #7f1d1d;">${escapeHtml(err.message || "Server tidak merespons")}</div>
            <button class="btn-retry" id="btn-retry-messages">
              🔄 Coba Lagi
            </button>
          </div>
        `;
        const retryBtn = document.getElementById("btn-retry-messages");
        if (retryBtn) {
          retryBtn.addEventListener("click", () => loadMessages(true));
        }
      }
    }
  }

  // Render Balon Chat
  function renderMessages() {
    if (activeMessages.length === 0) {
      messagesContainerEl.innerHTML = `
        <div class="date-divider">Tidak ada riwayat pesan</div>
      `;
      return;
    }

    let lastDate = "";
    let hasRenderedUnreadDivider = false;
    const htmlParts = [];

    activeMessages.forEach((msg, idx) => {
      const msgDate = new Date(msg.timestamp);
      const dateString = isNaN(msgDate.getTime())
        ? ""
        : msgDate.toLocaleDateString([], {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          });

      if (dateString && dateString !== lastDate) {
        lastDate = dateString;
        htmlParts.push(`<div class="date-divider">${escapeHtml(dateString)}</div>`);
      }

      // Pembatas Pesan Baru
      if (!hasRenderedUnreadDivider && msg.is_read === false) {
        hasRenderedUnreadDivider = true;
        htmlParts.push(`<div class="unread-divider"><span>PESAN BELUM DIBACA</span></div>`);
      }

      const timeStr = isNaN(msgDate.getTime())
        ? ""
        : msgDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const isOutbound = msg.direction === "outbound" || msg.from_number === "me";
      const senderName = isOutbound ? "Anda" : (msg.contact_name || msg.from_number);

      // Status centang pesan WhatsApp
      let tickHtml = "";
      if (msg.status === "read" || msg.is_read) {
        tickHtml = `<span class="msg-status-tick tick-read" title="Sudah Dibaca (Read)">✓✓</span>`;
      } else if (msg.status === "delivered") {
        tickHtml = `<span class="msg-status-tick tick-delivered" title="Tersampaikan (Delivered)">✓✓</span>`;
      } else if (msg.status === "sent") {
        tickHtml = `<span class="msg-status-tick tick-sent" title="Terkirim (Sent)">✓</span>`;
      } else if (msg.status === "failed") {
        tickHtml = `<span class="msg-status-tick" style="color: #ea0038;" title="Gagal Terkirim">!</span>`;
      }

      // Render media
      let mediaHtml = "";
      if (msg.media_url) {
        const isImage = msg.message_type === "image" || /\.(png|jpe?g|gif|webp)$/i.test(msg.media_url);
        if (isImage) {
          mediaHtml = `
            <a href="${escapeHtml(msg.media_url)}" target="_blank" rel="noopener noreferrer">
              <img src="${escapeHtml(msg.media_url)}" class="message-media-img" alt="Foto">
            </a>
          `;
        } else {
          mediaHtml = `
            <a href="${escapeHtml(msg.media_url)}" target="_blank" download class="message-media-doc" rel="noopener noreferrer">
              <span class="doc-icon">📄</span>
              <div class="doc-info">
                <div class="doc-name">${escapeHtml(msg.body || "Lampiran")}</div>
                <div class="doc-action">Unduh File ⭳</div>
              </div>
            </a>
          `;
        }
      }

      htmlParts.push(`
        <div class="message-row ${isOutbound ? "outbound" : ""}">
          <div class="message-bubble">
            <div class="message-sender">${escapeHtml(senderName)}</div>
            ${mediaHtml}
            ${msg.body && (!msg.media_url || msg.message_type === "image") ? `<div class="message-text">${escapeHtml(msg.body)}</div>` : ""}
            <div class="message-meta">
              <span class="message-time">
                ${escapeHtml(timeStr)}
                ${tickHtml}
              </span>
              <button class="btn-inspect" data-idx="${idx}" title="Lihat Raw JSON Payload">🔍 Payload</button>
            </div>
          </div>
        </div>
      `);
    });

    messagesContainerEl.innerHTML = htmlParts.join("");

    // Attach click events to inspect buttons
    messagesContainerEl.querySelectorAll(".btn-inspect").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = Number(btn.getAttribute("data-idx"));
        if (activeMessages[idx]) {
          openPayloadModal(activeMessages[idx]);
        }
      });
    });
  }

  // Buka Modal Payload
  function openPayloadModal(msg) {
    if (!msg) {
      if (window.showWarningModal) {
        window.showWarningModal("Data pesan tidak valid atau belum tersedia.", {
          title: "Payload Tidak Ditemukan",
        });
      }
      return;
    }

    modalMsgId.textContent = msg.id || "-";
    modalFromNumber.textContent = msg.from_number || "-";
    modalContactInfo.textContent = `${msg.contact_name || "-"} (WA ID: ${msg.contact_wa_id || msg.from_number})`;
    modalBusinessNumber.textContent = `${msg.to_number || "-"} (ID: ${msg.phone_number_id || "-"})`;
    modalTypeStatus.textContent = `${msg.message_type || "text"} (${msg.status || "received"})`;
    modalTimestamp.textContent = formatFullDateTime(msg.timestamp);

    const jsonStr = JSON.stringify(msg.raw_payload || msg, null, 2);
    modalJsonContent.textContent = jsonStr;

    payloadModalEl.style.display = "flex";
  }

  function closePayloadModal() {
    payloadModalEl.style.display = "none";
  }

  // Copy JSON ke Clipboard
  btnCopyJson.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(modalJsonContent.textContent);
      const originalText = btnCopyJson.textContent;
      btnCopyJson.textContent = "✓ Tersalin!";
      setTimeout(() => {
        btnCopyJson.textContent = originalText;
      }, 2000);
    } catch (err) {
      if (window.showErrorModal) {
        window.showErrorModal(
          "Gagal menyalin format JSON ke clipboard browser. Pastikan izin akses clipboard telah diizinkan.",
          { title: "Gagal Menyalin" }
        );
      }
    }
  });

  // Event Listeners Modal Payload
  btnModalCloseX.addEventListener("click", closePayloadModal);
  btnModalClose.addEventListener("click", closePayloadModal);
  payloadModalEl.addEventListener("click", (e) => {
    if (e.target === payloadModalEl) closePayloadModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && payloadModalEl.style.display === "flex") {
      closePayloadModal();
    }
  });

  // Tombol Header: Tandai Percakapan Belum Dibaca
  const btnToggleUnreadEl = document.getElementById("btn-toggle-unread");
  if (btnToggleUnreadEl) {
    btnToggleUnreadEl.addEventListener("click", async () => {
      if (!activeContactId) {
        if (window.showWarningModal) {
          window.showWarningModal(
            "Silakan pilih salah satu percakapan di sebelah kiri terlebih dahulu sebelum menandai belum dibaca.",
            { title: "Percakapan Belum Dipilih" }
          );
        }
        return;
      }
      manualUnreadContactId = activeContactId;
      await markAsUnread(activeContactId);
      await loadConversations();
    });
  }

  // Format Ukuran File
  function formatFileSize(bytes) {
    if (!bytes) return "0 B";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  // Event Listener Pemilihan File
  const MAX_FILE_SIZE = 30 * 1024 * 1024; // 30 MB

  if (chatFileInputEl && filePreviewBarEl) {
    chatFileInputEl.addEventListener("change", () => {
      if (chatFileInputEl.files && chatFileInputEl.files[0]) {
        const file = chatFileInputEl.files[0];

        // Validasi ukuran file di sisi klien
        if (file.size > MAX_FILE_SIZE) {
          chatFileInputEl.value = "";
          selectedFile = null;
          filePreviewBarEl.style.display = "none";

          if (window.showErrorModal) {
            window.showErrorModal(
              `Ukuran file "${file.name}" (${formatFileSize(file.size)}) melebihi batas upload maksimal 30 MB. Silakan pilih berkas yang lebih kecil atau kompres terlebih dahulu.`,
              { title: "Ukuran File Terlalu Besar" }
            );
          }
          return;
        }

        selectedFile = file;
        filePreviewNameEl.textContent = selectedFile.name;
        filePreviewSizeEl.textContent = formatFileSize(selectedFile.size);
        filePreviewIconEl.textContent = selectedFile.type.startsWith("image/") ? "📷" : "📄";
        filePreviewBarEl.style.display = "flex";
        if (chatMessageInputEl) chatMessageInputEl.focus();
      }
    });

    if (btnRemoveFileEl) {
      btnRemoveFileEl.addEventListener("click", () => {
        selectedFile = null;
        chatFileInputEl.value = "";
        filePreviewBarEl.style.display = "none";
      });
    }
  }

  // Submit Kirim Pesan & File
  if (chatInputFormEl && chatMessageInputEl) {
    chatMessageInputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        chatInputFormEl.requestSubmit
          ? chatInputFormEl.requestSubmit()
          : chatInputFormEl.dispatchEvent(new Event("submit", { cancelable: true }));
      }
    });

    chatInputFormEl.addEventListener("submit", async (e) => {
      e.preventDefault();

      if (!activeContactId) {
        if (window.showWarningModal) {
          window.showWarningModal(
            "Silakan pilih salah satu percakapan di panel sebelah kiri terlebih dahulu sebelum mengirim pesan.",
            { title: "Pilih Percakapan" }
          );
        }
        return;
      }

      const text = chatMessageInputEl.value.trim();
      if (!text && !selectedFile) {
        if (window.showWarningModal) {
          window.showWarningModal(
            "Ketik pesan teks atau lampirkan berkas terlebih dahulu sebelum menekan tombol kirim.",
            { title: "Pesan Masih Kosong" }
          );
        }
        return;
      }

      if (btnSendMessageEl) {
        btnSendMessageEl.disabled = true;
        btnSendMessageEl.style.opacity = "0.6";
      }

      try {
        const formData = new FormData();
        formData.append("contact", activeContactId);
        if (text) formData.append("message", text);
        if (selectedFile) formData.append("file", selectedFile);

        const res = await fetch("/api/messages/send", {
          method: "POST",
          body: formData,
        });

        if (res.status === 401) {
          window.location.href = "/login?error=session_expired";
          return;
        }

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          let errorMsg = data.error;
          if (!errorMsg) {
            if (res.status === 413) {
              errorMsg = "Ukuran file terlalu besar untuk diproses server.";
            } else if (res.status === 400) {
              errorMsg = "Data pesan atau kontak yang dikirim tidak valid.";
            } else if (res.status === 500) {
              errorMsg = "Terjadi kegagalan pada server saat memproses pengiriman pesan.";
            } else {
              errorMsg = `Gagal mengirim pesan (HTTP ${res.status} ${res.statusText})`;
            }
          }

          if (window.showErrorModal) {
            window.showErrorModal(errorMsg, {
              title: "Gagal Mengirim Pesan",
              details: data,
            });
          }
          return;
        }

        // Reset input form
        chatMessageInputEl.value = "";
        selectedFile = null;
        if (chatFileInputEl) chatFileInputEl.value = "";
        if (filePreviewBarEl) filePreviewBarEl.style.display = "none";

        // Refresh pesan dan daftar kontak
        await loadMessages(true);
        await loadConversations();
      } catch (err) {
        console.error("Gagal mengirim pesan:", err);
        if (window.showErrorModal) {
          window.showErrorModal(
            "Terjadi gangguan jaringan atau server saat mencoba mengirim pesan. Silakan periksa koneksi internet Anda dan coba lagi.",
            {
              title: "Kesalahan Jaringan",
              details: err.stack || err.toString(),
            }
          );
        }
      } finally {
        if (btnSendMessageEl) {
          btnSendMessageEl.disabled = false;
          btnSendMessageEl.style.opacity = "1";
        }
        chatMessageInputEl.focus();
      }
    });
  }

  // Tombol Header: Lihat detail pesan terakhir
  btnViewContactDetails.addEventListener("click", () => {
    if (activeMessages.length > 0) {
      openPayloadModal(activeMessages[activeMessages.length - 1]);
    } else {
      if (window.showInfoModal) {
        window.showInfoModal(
          "Belum ada riwayat pesan dalam percakapan ini untuk melihat detail raw JSON payload.",
          { title: "Tidak Ada Data Pesan" }
        );
      }
    }
  });

  // Tombol Back di Mobile
  btnBackEl.addEventListener("click", () => {
    appWrapper.classList.remove("chat-open");
  });

  // Filter Search
  searchInputEl.addEventListener("input", (e) => {
    searchQuery = e.target.value;
    renderConversationList();
  });

  // Escape HTML string untuk keamanan XSS
  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Ganti Password Modal
  const passwordModalEl = document.getElementById("password-modal");
  const btnOpenChangePassword = document.getElementById("btn-open-change-password");
  const btnClosePwd = document.getElementById("btn-close-pwd");
  const btnClosePwdX = document.getElementById("btn-close-pwd-x");
  const formChangePassword = document.getElementById("form-change-password");
  const inputCurrPwd = document.getElementById("input-curr-pwd");
  const inputNewPwd = document.getElementById("input-new-pwd");
  const pwdAlert = document.getElementById("pwd-alert");

  if (btnOpenChangePassword && passwordModalEl) {
    btnOpenChangePassword.addEventListener("click", () => {
      pwdAlert.style.display = "none";
      formChangePassword.reset();
      passwordModalEl.style.display = "flex";
      inputCurrPwd.focus();
    });

    const closePwdModal = () => {
      passwordModalEl.style.display = "none";
    };

    if (btnClosePwd) btnClosePwd.addEventListener("click", closePwdModal);
    if (btnClosePwdX) btnClosePwdX.addEventListener("click", closePwdModal);
    passwordModalEl.addEventListener("click", (e) => {
      if (e.target === passwordModalEl) closePwdModal();
    });

    formChangePassword.addEventListener("submit", async (e) => {
      e.preventDefault();
      pwdAlert.style.display = "none";

      const currPwd = inputCurrPwd.value;
      const newPwd = inputNewPwd.value;

      if (!currPwd) {
        pwdAlert.style.backgroundColor = "#fee2e2";
        pwdAlert.style.color = "#991b1b";
        pwdAlert.textContent = "Password saat ini wajib diisi";
        pwdAlert.style.display = "block";
        inputCurrPwd.focus();
        return;
      }

      if (!newPwd || newPwd.length < 6) {
        pwdAlert.style.backgroundColor = "#fee2e2";
        pwdAlert.style.color = "#991b1b";
        pwdAlert.textContent = "Password baru minimal harus 6 karakter";
        pwdAlert.style.display = "block";
        inputNewPwd.focus();
        return;
      }

      if (currPwd === newPwd) {
        pwdAlert.style.backgroundColor = "#fee2e2";
        pwdAlert.style.color = "#991b1b";
        pwdAlert.textContent = "Password baru tidak boleh sama dengan password saat ini";
        pwdAlert.style.display = "block";
        inputNewPwd.focus();
        return;
      }

      try {
        const res = await fetch("/api/change-password", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            currentPassword: currPwd,
            newPassword: newPwd,
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          pwdAlert.style.backgroundColor = "#dcf8c6";
          pwdAlert.style.color = "#075e54";
          pwdAlert.textContent = "✓ Password berhasil diperbarui di database!";
          pwdAlert.style.display = "block";
          setTimeout(closePwdModal, 1500);
        } else {
          pwdAlert.style.backgroundColor = "#fee2e2";
          pwdAlert.style.color = "#991b1b";
          pwdAlert.textContent = data.error || "Gagal mengubah password akun";
          pwdAlert.style.display = "block";
        }
      } catch (err) {
        pwdAlert.style.backgroundColor = "#fee2e2";
        pwdAlert.style.color = "#991b1b";
        pwdAlert.textContent = "Terjadi gangguan jaringan atau server. Silakan coba lagi.";
        pwdAlert.style.display = "block";
      }
    });
  }

  // Inisialisasi
  loadMe();
  loadConversations();

  // Polling data otomatis setiap 3 detik
  setInterval(() => {
    loadConversations();
    if (activeContactId) {
      loadMessages(false);
    }
  }, 3000);
})();
