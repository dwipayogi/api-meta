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

  // Modal Elemen
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

  // Ambil Data Profil Pengguna
  async function loadMe() {
    try {
      const res = await fetch("/api/me");
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const data = await res.json();
      if (data.username) {
        currentUsernameEl.textContent = data.username;
        currentUserAvatarEl.textContent = data.username.slice(0, 1).toUpperCase();
      }
    } catch (err) {
      console.error("Gagal load profile:", err);
    }
  }

  // Ambil Daftar Percakapan
  async function loadConversations() {
    try {
      const res = await fetch("/api/conversations");
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      conversations = await res.json();
      renderConversationList();
    } catch (err) {
      console.error("Gagal mengambil percakapan:", err);
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
          <div class="conversation-item ${isActive ? "active" : ""} ${hasUnread ? "has-unread" : ""}" data-id="${item.contact_identifier}">
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
                        ? `<button class="btn-conv-action btn-item-read" data-id="${item.contact_identifier}" title="Tandai Sudah Dibaca">✓ Dibaca</button>`
                        : `<button class="btn-conv-action btn-item-unread" data-id="${item.contact_identifier}" title="Tandai Belum Dibaca">✉️ Belum</button>`
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
      await fetch(`/api/conversations/${encodeURIComponent(contactId)}/read`, { method: "POST" });
      const conv = conversations.find((c) => c.contact_identifier === contactId);
      if (conv) conv.unread_count = 0;
      renderConversationList();
    } catch (err) {
      console.error("Gagal menandai sudah dibaca:", err);
    }
  }

  // Helper Tandai Belum Dibaca
  async function markAsUnread(contactId) {
    if (!contactId) return;
    try {
      await fetch(`/api/conversations/${encodeURIComponent(contactId)}/unread`, { method: "POST" });
      const conv = conversations.find((c) => c.contact_identifier === contactId);
      if (conv) conv.unread_count = Math.max(1, (conv.unread_count || 0) + 1);
      renderConversationList();
    } catch (err) {
      console.error("Gagal menandai belum dibaca:", err);
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
        window.location.href = "/login";
        return;
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
    }
  }

  // Render Balon Chat
  function renderMessages() {
    if (activeMessages.length === 0) {
      messagesContainerEl.innerHTML = `
        <div class="date-divider">Tidak ada pesan</div>
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

      const timeStr = msgDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const senderName = msg.contact_name || msg.from_number;

      // Status centang pesan WhatsApp (✓, ✓✓ abu, ✓✓ biru)
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

      htmlParts.push(`
        <div class="message-row">
          <div class="message-bubble">
            <div class="message-sender">${escapeHtml(senderName)}</div>
            <div class="message-text">${escapeHtml(msg.body)}</div>
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
      alert("Gagal menyalin ke clipboard");
    }
  });

  // Event Listeners Modal
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
        alert("Belum ada chat yang dipilih");
        return;
      }
      manualUnreadContactId = activeContactId;
      await markAsUnread(activeContactId);
      await loadConversations();
    });
  }

  // Tombol Header: Lihat detail pesan terakhir
  btnViewContactDetails.addEventListener("click", () => {
    if (activeMessages.length > 0) {
      openPayloadModal(activeMessages[activeMessages.length - 1]);
    } else {
      alert("Belum ada pesan yang dipilih.");
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

      try {
        const res = await fetch("/api/change-password", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            currentPassword: inputCurrPwd.value,
            newPassword: inputNewPwd.value,
          }),
        });

        const data = await res.json();
        if (res.ok) {
          pwdAlert.style.backgroundColor = "#dcf8c6";
          pwdAlert.style.color = "#075e54";
          pwdAlert.textContent = "✓ Password berhasil diperbarui di database!";
          pwdAlert.style.display = "block";
          setTimeout(closePwdModal, 1500);
        } else {
          pwdAlert.style.backgroundColor = "#fee2e2";
          pwdAlert.style.color = "#991b1b";
          pwdAlert.textContent = data.error || "Gagal mengubah password";
          pwdAlert.style.display = "block";
        }
      } catch (err) {
        pwdAlert.style.backgroundColor = "#fee2e2";
        pwdAlert.style.color = "#991b1b";
        pwdAlert.textContent = "Terjadi kesalahan server";
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
