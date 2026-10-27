/**
 * WhatsApp Webhook Dashboard - Custom Modal Dialog
 * Pengganti window.alert dengan modal dialog kustom yang modern, jelas, dan aksesibel.
 */
(function () {
  let modalOverlay = null;
  let modalTitle = null;
  let modalMessage = null;
  let modalIcon = null;
  let modalDetailsContainer = null;
  let modalDetails = null;
  let modalDetailsToggle = null;
  let modalConfirmBtn = null;
  let modalCancelBtn = null;
  let modalCloseX = null;
  let activeResolve = null;
  let lastActiveElement = null;

  const ICONS = {
    error: `
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
    `,
    warning: `
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        <line x1="12" y1="9" x2="12" y2="13"></line>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>
    `,
    info: `
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="16" x2="12" y2="12"></line>
        <line x1="12" y1="8" x2="12.01" y2="8"></line>
      </svg>
    `,
    success: `
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
        <polyline points="22 4 12 14.01 9 11.01"></polyline>
      </svg>
    `,
  };

  function initModalDOM() {
    if (modalOverlay) return;

    modalOverlay = document.createElement("div");
    modalOverlay.id = "custom-app-modal-overlay";
    modalOverlay.className = "custom-modal-overlay";
    modalOverlay.style.display = "none";
    modalOverlay.setAttribute("role", "dialog");
    modalOverlay.setAttribute("aria-modal", "true");
    modalOverlay.setAttribute("aria-labelledby", "custom-modal-title");

    modalOverlay.innerHTML = `
      <div class="custom-modal-box">
        <button class="custom-modal-close" id="custom-modal-close-x" aria-label="Tutup dialog">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
        <div class="custom-modal-icon-wrapper" id="custom-modal-icon"></div>
        <div class="custom-modal-content">
          <h3 class="custom-modal-title" id="custom-modal-title">Pemberitahuan</h3>
          <div class="custom-modal-message" id="custom-modal-message"></div>
          <div class="custom-modal-details-container" id="custom-modal-details-container" style="display: none;">
            <button type="button" class="custom-modal-details-toggle" id="custom-modal-details-toggle">
              <span>Detail Teknis</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>
            <pre class="custom-modal-details" id="custom-modal-details"></pre>
          </div>
        </div>
        <div class="custom-modal-actions" id="custom-modal-actions">
          <button type="button" class="custom-modal-btn custom-modal-btn-cancel" id="custom-modal-cancel" style="display: none;">Batal</button>
          <button type="button" class="custom-modal-btn custom-modal-btn-primary" id="custom-modal-confirm">Mengerti</button>
        </div>
      </div>
    `;

    document.body.appendChild(modalOverlay);

    modalTitle = document.getElementById("custom-modal-title");
    modalMessage = document.getElementById("custom-modal-message");
    modalIcon = document.getElementById("custom-modal-icon");
    modalDetailsContainer = document.getElementById("custom-modal-details-container");
    modalDetails = document.getElementById("custom-modal-details");
    modalDetailsToggle = document.getElementById("custom-modal-details-toggle");
    modalConfirmBtn = document.getElementById("custom-modal-confirm");
    modalCancelBtn = document.getElementById("custom-modal-cancel");
    modalCloseX = document.getElementById("custom-modal-close-x");

    modalCloseX.addEventListener("click", () => closeModal(false));
    modalCancelBtn.addEventListener("click", () => closeModal(false));
    modalConfirmBtn.addEventListener("click", () => closeModal(true));

    modalOverlay.addEventListener("click", (e) => {
      if (e.target === modalOverlay) {
        closeModal(false);
      }
    });

    modalDetailsToggle.addEventListener("click", () => {
      const isVisible = modalDetails.style.display === "block";
      modalDetails.style.display = isVisible ? "none" : "block";
      modalDetailsToggle.classList.toggle("open", !isVisible);
    });

    document.addEventListener("keydown", (e) => {
      if (modalOverlay && modalOverlay.style.display === "flex") {
        if (e.key === "Escape") {
          e.preventDefault();
          closeModal(false);
        } else if (e.key === "Enter" && !e.shiftKey) {
          // Hanya enter di luar textarea/pre
          if (document.activeElement !== modalDetails) {
            e.preventDefault();
            closeModal(true);
          }
        }
      }
    });
  }

  function closeModal(result) {
    if (!modalOverlay || modalOverlay.style.display === "none") return;
    modalOverlay.style.display = "none";
    if (lastActiveElement && typeof lastActiveElement.focus === "function") {
      try {
        lastActiveElement.focus();
      } catch (e) {}
    }
    if (activeResolve) {
      const resolve = activeResolve;
      activeResolve = null;
      resolve(result);
    }
  }

  /**
   * Tampilkan Modal Dialog Kustom
   * @param {Object} options
   * @param {string} options.title Judul modal
   * @param {string} options.message Pesan utama yang jelas
   * @param {'error'|'warning'|'info'|'success'} [options.type='error'] Tipe modal
   * @param {string|Object} [options.details] Detail teknis tambahan (opsional)
   * @param {string} [options.confirmText='Mengerti'] Teks tombol konfirmasi
   * @param {string} [options.cancelText] Teks tombol batal (jika ada, menampilkan 2 tombol)
   * @returns {Promise<boolean>} Resolves true jika confirm, false jika cancel/close
   */
  function showCustomModal(options = {}) {
    initModalDOM();
    lastActiveElement = document.activeElement;

    const {
      title = "Pemberitahuan",
      message = "",
      type = "info",
      details = null,
      confirmText = "Mengerti",
      cancelText = null,
    } = typeof options === "string" ? { message: options, type: "error" } : options;

    modalTitle.textContent = title;
    modalMessage.textContent = message;

    // Set Icon & Theme class
    const safeType = ["error", "warning", "info", "success"].includes(type) ? type : "info";
    modalIcon.innerHTML = ICONS[safeType];
    modalIcon.className = `custom-modal-icon-wrapper type-${safeType}`;

    // Set Button Styling
    modalConfirmBtn.textContent = confirmText;
    modalConfirmBtn.className = `custom-modal-btn custom-modal-btn-primary btn-type-${safeType}`;

    if (cancelText) {
      modalCancelBtn.textContent = cancelText;
      modalCancelBtn.style.display = "inline-flex";
    } else {
      modalCancelBtn.style.display = "none";
    }

    // Set Technical Details jika ada
    if (details) {
      modalDetailsContainer.style.display = "block";
      modalDetails.style.display = "none";
      modalDetailsToggle.classList.remove("open");
      const detailsText = typeof details === "object" ? JSON.stringify(details, null, 2) : String(details);
      modalDetails.textContent = detailsText;
    } else {
      modalDetailsContainer.style.display = "none";
      modalDetails.textContent = "";
    }

    modalOverlay.style.display = "flex";
    setTimeout(() => {
      modalConfirmBtn.focus();
    }, 50);

    return new Promise((resolve) => {
      activeResolve = resolve;
    });
  }

  function showErrorModal(message, options = {}) {
    const opts = typeof options === "string" ? { title: options } : options;
    return showCustomModal({
      title: opts.title || "Terjadi Kesalahan",
      message,
      type: "error",
      confirmText: opts.confirmText || "Tutup",
      ...opts,
    });
  }

  function showWarningModal(message, options = {}) {
    const opts = typeof options === "string" ? { title: options } : options;
    return showCustomModal({
      title: opts.title || "Peringatan",
      message,
      type: "warning",
      confirmText: opts.confirmText || "Mengerti",
      ...opts,
    });
  }

  function showSuccessModal(message, options = {}) {
    const opts = typeof options === "string" ? { title: options } : options;
    return showCustomModal({
      title: opts.title || "Berhasil",
      message,
      type: "success",
      confirmText: opts.confirmText || "Selesai",
      ...opts,
    });
  }

  function showInfoModal(message, options = {}) {
    const opts = typeof options === "string" ? { title: options } : options;
    return showCustomModal({
      title: opts.title || "Informasi",
      message,
      type: "info",
      confirmText: opts.confirmText || "Mengerti",
      ...opts,
    });
  }

  // Expose ke global scope
  window.showCustomModal = showCustomModal;
  window.showErrorModal = showErrorModal;
  window.showWarningModal = showWarningModal;
  window.showSuccessModal = showSuccessModal;
  window.showInfoModal = showInfoModal;

  // Gantikan window.alert bawaan browser dengan modal kustom yang jelas
  window.alert = function (message) {
    showErrorModal(String(message));
  };
})();
