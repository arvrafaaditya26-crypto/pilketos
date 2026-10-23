(function () {
    "use strict";

    /* ─────────────────────────────────────────────
       INJECT STYLES (dipanggil sekali saat load)
    ───────────────────────────────────────────── */
    function injectStyles() {
        if (document.getElementById("ui-component-styles")) return;
        const style = document.createElement("style");
        style.id = "ui-component-styles";
        style.textContent = `
/* ── TOAST ── */
#toast-container {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 10px;
    pointer-events: none;
    max-width: 360px;
    width: calc(100% - 48px);
}
.toast {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 16px;
    border-radius: 10px;
    background: #1a2a4a;
    color: #ffffff;
    font-family: 'Inter', sans-serif;
    font-size: 13px;
    font-weight: 500;
    line-height: 1.5;
    pointer-events: auto;
    box-shadow: 0 8px 28px rgba(11,37,84,0.22);
    transform: translateY(12px);
    opacity: 0;
    transition: transform 0.28s cubic-bezier(0.34,1.2,0.64,1), opacity 0.22s ease;
    cursor: pointer;
    min-width: 240px;
}
.toast.toast-show {
    transform: translateY(0);
    opacity: 1;
}
.toast.toast-hide {
    transform: translateY(8px);
    opacity: 0;
}
.toast-icon {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 800;
    margin-top: 1px;
}
.toast-success { background: #0e2a1a; border-left: 3px solid #1F7A3D; }
.toast-success .toast-icon { background: #1F7A3D; }
.toast-error   { background: #2a0e10; border-left: 3px solid #D62839; }
.toast-error   .toast-icon { background: #D62839; }
.toast-info    { background: #0d1e3a; border-left: 3px solid #2E56A6; }
.toast-info    .toast-icon { background: #2E56A6; }
.toast-body { flex: 1; }

/* ── CONFIRM DIALOG ── */
#app-confirm-overlay {
    position: fixed;
    inset: 0;
    background: rgba(11,37,84,0.52);
    backdrop-filter: blur(3px);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.18s ease;
}
#app-confirm-overlay.visible { opacity: 1; pointer-events: auto; }
#app-confirm-box {
    background: #ffffff;
    border-radius: 14px;
    width: min(420px, 100%);
    padding: 28px;
    box-shadow: 0 24px 60px rgba(11,37,84,0.22);
    transform: scale(0.94);
    transition: transform 0.22s cubic-bezier(0.34,1.2,0.64,1);
}
#app-confirm-overlay.visible #app-confirm-box { transform: scale(1); }
#app-confirm-icon {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 16px;
    font-size: 20px;
}
#app-confirm-title {
    font-family: 'Sora', sans-serif;
    font-size: 17px;
    font-weight: 700;
    color: #0B2554;
    margin-bottom: 8px;
    line-height: 1.3;
}
#app-confirm-message {
    font-family: 'Inter', sans-serif;
    font-size: 13px;
    color: #6B6F76;
    line-height: 1.65;
    margin-bottom: 24px;
}
#app-confirm-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
}
#app-confirm-actions button {
    padding: 10px 18px;
    border-radius: 8px;
    font-family: 'Inter', sans-serif;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    border: none;
    transition: background 0.16s, transform 0.12s;
    letter-spacing: 0.3px;
}
#app-confirm-actions button:active { transform: translateY(1px); }
#app-confirm-cancel {
    background: #eaecef;
    color: #0B2554;
}
#app-confirm-cancel:hover { background: #d8dce2; }
#app-confirm-ok {
    background: #12377A;
    color: #ffffff;
}
#app-confirm-ok:hover { background: #2E56A6; }
#app-confirm-ok.danger {
    background: #D62839;
}
#app-confirm-ok.danger:hover { background: #b01f2d; }
        `;
        document.head.appendChild(style);
    }

    /* ─────────────────────────────────────────────
       TOAST
    ───────────────────────────────────────────── */
    function ensureToastContainer() {
        let c = document.getElementById("toast-container");
        if (!c) {
            c = document.createElement("div");
            c.id = "toast-container";
            document.body.appendChild(c);
        }
        return c;
    }

    const TOAST_ICONS = {
        success: "✓",
        error:   "✕",
        info:    "i"
    };

    function toast(message, type) {
        type = type || "info";
        injectStyles();
        const container = ensureToastContainer();

        const el = document.createElement("div");
        el.className = "toast toast-" + type;
        el.setAttribute("role", "alert");
        el.setAttribute("aria-live", "assertive");
        el.innerHTML = `
            <div class="toast-icon">${TOAST_ICONS[type] || "i"}</div>
            <div class="toast-body">${String(message || "")}</div>
        `;

        el.addEventListener("click", function () { dismiss(el); });

        container.appendChild(el);
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                el.classList.add("toast-show");
            });
        });

        const timer = setTimeout(function () { dismiss(el); }, 4000);
        el._dismissTimer = timer;

        function dismiss(node) {
            clearTimeout(node._dismissTimer);
            node.classList.remove("toast-show");
            node.classList.add("toast-hide");
            node.addEventListener("transitionend", function () {
                if (node.parentNode) node.parentNode.removeChild(node);
            }, { once: true });
        }
    }

    /* ─────────────────────────────────────────────
       CONFIRM DIALOG
    ───────────────────────────────────────────── */
    let confirmOverlay = null;

    function buildConfirmDOM() {
        if (confirmOverlay) return;
        injectStyles();

        confirmOverlay = document.createElement("div");
        confirmOverlay.id = "app-confirm-overlay";
        confirmOverlay.setAttribute("role", "dialog");
        confirmOverlay.setAttribute("aria-modal", "true");
        confirmOverlay.innerHTML = `
            <div id="app-confirm-box">
                <div id="app-confirm-icon"></div>
                <div id="app-confirm-title"></div>
                <div id="app-confirm-message"></div>
                <div id="app-confirm-actions">
                    <button id="app-confirm-cancel" type="button">BATAL</button>
                    <button id="app-confirm-ok"     type="button">YA</button>
                </div>
            </div>
        `;
        document.body.appendChild(confirmOverlay);
    }

    function appConfirm(message, options) {
        options = options || {};
        buildConfirmDOM();

        return new Promise(function (resolve) {
            const iconEl   = document.getElementById("app-confirm-icon");
            const titleEl  = document.getElementById("app-confirm-title");
            const msgEl    = document.getElementById("app-confirm-message");
            const okBtn    = document.getElementById("app-confirm-ok");
            const cancelBtn = document.getElementById("app-confirm-cancel");

            const isDanger = options.danger !== false;
            const icon = options.icon || (isDanger ? "⚠" : "?");
            const iconBg = isDanger ? "#FDEAEC" : "#EEF2FB";
            const iconColor = isDanger ? "#D62839" : "#12377A";

            iconEl.textContent = icon;
            iconEl.style.background = iconBg;
            iconEl.style.color = iconColor;

            titleEl.textContent = options.title || "Konfirmasi";

            const lines = String(message || "").split("\n\n");
            msgEl.innerHTML = lines.map(function (l) {
                return "<p>" + String(l).replace(/\n/g, "<br>") + "</p>";
            }).join("");

            okBtn.textContent = options.okLabel || "YA, LANJUTKAN";
            cancelBtn.textContent = options.cancelLabel || "BATAL";
            okBtn.className = isDanger ? "danger" : "";

            confirmOverlay.setAttribute("aria-label", options.title || "Konfirmasi");

            requestAnimationFrame(function () {
                confirmOverlay.classList.add("visible");
                okBtn.focus();
            });

            function close(result) {
                confirmOverlay.classList.remove("visible");
                okBtn.onclick     = null;
                cancelBtn.onclick = null;
                confirmOverlay.onclick   = null;
                confirmOverlay.onkeydown = null;
                resolve(result);
            }

            okBtn.onclick = function () { close(true); };
            cancelBtn.onclick = function () { close(false); };
            confirmOverlay.onclick = function (e) {
                if (e.target === confirmOverlay) close(false);
            };
            confirmOverlay.onkeydown = function (e) {
                if (e.key === "Escape") close(false);
            };
        });
    }

    /* ─────────────────────────────────────────────
       PASSWORD PROMPT (ganti prompt() native)
    ───────────────────────────────────────────── */
    let pwOverlay = null;

    function buildPwDOM() {
        if (pwOverlay) return;
        injectStyles();

        const extraStyle = document.createElement("style");
        extraStyle.textContent = `
#app-pw-overlay {
    position: fixed; inset: 0;
    background: rgba(11,37,84,0.52);
    backdrop-filter: blur(3px);
    z-index: 10001;
    display: flex; align-items: center; justify-content: center;
    padding: 20px;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.18s ease;
}
#app-pw-overlay.visible { opacity: 1; pointer-events: auto; }
#app-pw-box {
    background: #ffffff; border-radius: 14px;
    width: min(380px, 100%); padding: 28px;
    box-shadow: 0 24px 60px rgba(11,37,84,0.22);
    transform: scale(0.94);
    transition: transform 0.22s cubic-bezier(0.34,1.2,0.64,1);
}
#app-pw-overlay.visible #app-pw-box { transform: scale(1); }
#app-pw-title {
    font-family: 'Sora', sans-serif;
    font-size: 17px; font-weight: 700;
    color: #0B2554; margin-bottom: 6px;
}
#app-pw-desc {
    font-family: 'Inter', sans-serif;
    font-size: 13px; color: #6B6F76;
    line-height: 1.55; margin-bottom: 18px;
}
#app-pw-input {
    width: 100%; height: 46px;
    padding: 0 14px;
    border: 1.5px solid #E3E1D8;
    border-radius: 9px;
    font-family: 'Inter', sans-serif;
    font-size: 15px; font-weight: 500;
    color: #0B2554; outline: none;
    transition: border-color 0.18s, box-shadow 0.18s;
    margin-bottom: 8px;
}
#app-pw-input:focus {
    border-color: #12377A;
    box-shadow: 0 0 0 3px rgba(18,55,122,0.09);
}
#app-pw-error {
    min-height: 18px;
    font-family: 'Inter', sans-serif;
    font-size: 12px; font-weight: 600;
    color: #D62839; margin-bottom: 16px;
}
#app-pw-actions {
    display: flex; gap: 10px; justify-content: flex-end;
}
#app-pw-actions button {
    padding: 10px 18px; border-radius: 8px;
    font-family: 'Inter', sans-serif;
    font-size: 12px; font-weight: 700;
    cursor: pointer; border: none;
    transition: background 0.16s;
    letter-spacing: 0.3px;
}
#app-pw-cancel { background: #eaecef; color: #0B2554; }
#app-pw-cancel:hover { background: #d8dce2; }
#app-pw-ok { background: #12377A; color: #fff; }
#app-pw-ok:hover { background: #2E56A6; }
        `;
        document.head.appendChild(extraStyle);

        pwOverlay = document.createElement("div");
        pwOverlay.id = "app-pw-overlay";
        pwOverlay.setAttribute("role", "dialog");
        pwOverlay.setAttribute("aria-modal", "true");
        pwOverlay.setAttribute("aria-label", "Login Administrator");
        pwOverlay.innerHTML = `
            <div id="app-pw-box">
                <div id="app-pw-title">Login Administrator</div>
                <div id="app-pw-desc">Masukkan password untuk melanjutkan.</div>
                <input id="app-pw-input" type="password" autocomplete="current-password"
                    placeholder="Password administrator">
                <div id="app-pw-error"></div>
                <div id="app-pw-actions">
                    <button id="app-pw-cancel" type="button">BATAL</button>
                    <button id="app-pw-ok"     type="button">MASUK</button>
                </div>
            </div>
        `;
        document.body.appendChild(pwOverlay);
    }

    function appPromptPassword() {
        buildPwDOM();

        return new Promise(function (resolve) {
            const input    = document.getElementById("app-pw-input");
            const errEl    = document.getElementById("app-pw-error");
            const okBtn    = document.getElementById("app-pw-ok");
            const cancelBtn = document.getElementById("app-pw-cancel");

            input.value = "";
            errEl.textContent = "";

            requestAnimationFrame(function () {
                pwOverlay.classList.add("visible");
                input.focus();
            });

            function close(val) {
                pwOverlay.classList.remove("visible");
                okBtn.onclick = null;
                cancelBtn.onclick = null;
                pwOverlay.onkeydown = null;
                input.onkeydown = null;
                resolve(val);
            }

            async function trySubmit() {
                const pw = input.value.trim();
                if (!pw) { errEl.textContent = "Password wajib diisi."; input.focus(); return; }

                okBtn.disabled = true;
                okBtn.textContent = "MEMERIKSA...";
                errEl.textContent = "";

                try {
                    const r = await fetch("/api/admin/verify", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ password: pw })
                    });
                    const d = await r.json();
                    if (d.success) {
                        close(pw);
                    } else {
                        errEl.textContent = "Password salah.";
                        input.value = "";
                        input.focus();
                        okBtn.disabled = false;
                        okBtn.textContent = "MASUK";
                    }
                } catch (e) {
                    errEl.textContent = "Gagal menghubungi server.";
                    okBtn.disabled = false;
                    okBtn.textContent = "MASUK";
                }
            }

            okBtn.onclick = trySubmit;
            cancelBtn.onclick = function () { close(null); };
            input.onkeydown = function (e) {
                if (e.key === "Enter") { e.preventDefault(); trySubmit(); }
            };
            pwOverlay.onkeydown = function (e) {
                if (e.key === "Escape") close(null);
            };
        });
    }

    /* ─────────────────────────────────────────────
       TYPED CONFIRM (P2C — ketik frasa untuk konfirmasi)
    ───────────────────────────────────────────── */
    let typedConfirmOverlay = null;

    function buildTypedConfirmDOM() {
        if (typedConfirmOverlay) return;
        injectStyles();

        const style = document.createElement("style");
        style.textContent = `
#app-typed-overlay {
    position: fixed; inset: 0;
    background: rgba(11,37,84,0.6);
    backdrop-filter: blur(4px);
    z-index: 10002;
    display: flex; align-items: center; justify-content: center;
    padding: 20px;
    opacity: 0; pointer-events: none;
    transition: opacity 0.18s ease;
}
#app-typed-overlay.visible { opacity: 1; pointer-events: auto; }
#app-typed-box {
    background: #fff; border-radius: 16px;
    width: min(460px, 100%); padding: 30px;
    box-shadow: 0 28px 70px rgba(11,37,84,0.28);
    transform: scale(0.94);
    transition: transform 0.22s cubic-bezier(0.34,1.2,0.64,1);
    border-top: 4px solid #D62839;
}
#app-typed-overlay.visible #app-typed-box { transform: scale(1); }
#app-typed-icon { font-size: 28px; margin-bottom: 12px; }
#app-typed-title {
    font-family: 'Sora', sans-serif;
    font-size: 18px; font-weight: 800;
    color: #0B2554; margin-bottom: 8px;
}
#app-typed-message {
    font-family: 'Inter', sans-serif;
    font-size: 13px; color: #6B6F76;
    line-height: 1.65; margin-bottom: 20px;
}
#app-typed-message p { margin-bottom: 6px; }
#app-typed-phrase-box {
    background: #FFF3CD; border: 1px solid #E8B923;
    border-radius: 8px; padding: 10px 14px;
    margin-bottom: 12px;
    font-family: 'Courier New', monospace;
    font-size: 14px; font-weight: 800;
    color: #7a5000; letter-spacing: 1px;
    user-select: all;
}
#app-typed-label {
    font-family: 'Inter', sans-serif;
    font-size: 11px; font-weight: 700;
    letter-spacing: 0.8px; color: #6B6F76;
    margin-bottom: 6px; text-transform: uppercase;
}
#app-typed-input {
    width: 100%; height: 44px;
    padding: 0 12px;
    border: 1.5px solid #E3E1D8;
    border-radius: 8px;
    font-family: 'Courier New', monospace;
    font-size: 14px; font-weight: 700;
    color: #0B2554; outline: none;
    margin-bottom: 6px;
    transition: border-color 0.18s, box-shadow 0.18s;
    text-transform: uppercase;
    letter-spacing: 1px;
}
#app-typed-input:focus { border-color: #D62839; box-shadow: 0 0 0 3px rgba(214,40,57,0.10); }
#app-typed-input.match { border-color: #1F7A3D; background: #E6F4EC; }
#app-typed-hint { min-height: 18px; font-family: 'Inter', sans-serif; font-size: 12px; color: #D62839; margin-bottom: 18px; font-weight: 600; }
#app-typed-actions { display: flex; gap: 10px; justify-content: flex-end; }
#app-typed-actions button {
    padding: 10px 20px; border-radius: 8px;
    font-family: 'Inter', sans-serif;
    font-size: 12px; font-weight: 700;
    cursor: pointer; border: none;
    transition: background 0.16s, opacity 0.16s;
    letter-spacing: 0.4px;
}
#app-typed-cancel { background: #eaecef; color: #0B2554; }
#app-typed-cancel:hover { background: #d8dce2; }
#app-typed-ok { background: #D62839; color: #fff; }
#app-typed-ok:hover:not(:disabled) { background: #b01f2d; }
#app-typed-ok:disabled { opacity: 0.4; cursor: not-allowed; }
        `;
        document.head.appendChild(style);

        typedConfirmOverlay = document.createElement("div");
        typedConfirmOverlay.id = "app-typed-overlay";
        typedConfirmOverlay.setAttribute("role", "dialog");
        typedConfirmOverlay.setAttribute("aria-modal", "true");
        typedConfirmOverlay.innerHTML = `
            <div id="app-typed-box">
                <div id="app-typed-icon">⚠️</div>
                <div id="app-typed-title">Konfirmasi Tindakan Berbahaya</div>
                <div id="app-typed-message"></div>
                <div id="app-typed-phrase-box"></div>
                <div id="app-typed-label">Ketik frasa di atas untuk melanjutkan</div>
                <input id="app-typed-input" type="text" autocomplete="off" spellcheck="false">
                <div id="app-typed-hint"></div>
                <div id="app-typed-actions">
                    <button id="app-typed-cancel" type="button">BATAL</button>
                    <button id="app-typed-ok"     type="button" disabled>LANJUTKAN</button>
                </div>
            </div>
        `;
        document.body.appendChild(typedConfirmOverlay);
    }

    function appTypedConfirm(message, options) {
        options = options || {};
        buildTypedConfirmDOM();
        const phrase = String(options.confirmPhrase || "KONFIRMASI");

        return new Promise(function (resolve) {
            const iconEl   = document.getElementById("app-typed-icon");
            const titleEl  = document.getElementById("app-typed-title");
            const msgEl    = document.getElementById("app-typed-message");
            const phraseEl = document.getElementById("app-typed-phrase-box");
            const input    = document.getElementById("app-typed-input");
            const hintEl   = document.getElementById("app-typed-hint");
            const okBtn    = document.getElementById("app-typed-ok");
            const cancelBtn = document.getElementById("app-typed-cancel");

            iconEl.textContent   = options.icon || "⚠️";
            titleEl.textContent  = options.title || "Konfirmasi Tindakan Berbahaya";
            phraseEl.textContent = phrase;
            okBtn.textContent    = options.okLabel || "LANJUTKAN";

            const lines = String(message || "").split("\n\n");
            msgEl.innerHTML = lines.map(function (l) {
                return "<p>" + String(l).replace(/\n/g, "<br>") + "</p>";
            }).join("");

            input.value = "";
            hintEl.textContent = "";
            input.className = "";
            okBtn.disabled = true;

            function onInput() {
                const val = input.value.trim().toUpperCase();
                const match = val === phrase.toUpperCase();
                okBtn.disabled = !match;
                input.className = match ? "match" : "";
                hintEl.textContent = val.length > 0 && !match ? "Frasa belum sesuai." : "";
            }

            input.addEventListener("input", onInput);
            input.addEventListener("keydown", function (e) {
                if (e.key === "Enter" && !okBtn.disabled) { e.preventDefault(); close(true); }
            });

            requestAnimationFrame(function () {
                typedConfirmOverlay.classList.add("visible");
                input.focus();
            });

            function close(result) {
                typedConfirmOverlay.classList.remove("visible");
                input.removeEventListener("input", onInput);
                okBtn.onclick = null;
                cancelBtn.onclick = null;
                typedConfirmOverlay.onkeydown = null;
                resolve(result);
            }

            okBtn.onclick = function () { if (!okBtn.disabled) close(true); };
            cancelBtn.onclick = function () { close(false); };
            typedConfirmOverlay.onkeydown = function (e) {
                if (e.key === "Escape") close(false);
            };
        });
    }

    /* ─────────────────────────────────────────────
       EXPOSE GLOBALS
    ───────────────────────────────────────────── */
    window.toast             = toast;
    window.appConfirm        = appConfirm;
    window.appTypedConfirm   = appTypedConfirm;
    window.appPromptPassword = appPromptPassword;

    /* Auto-inject styles on DOMContentLoaded */
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", injectStyles);
    } else {
        injectStyles();
    }
})();
