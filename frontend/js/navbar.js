/* navbar.js — incluir en todas las páginas con <script src="../js/navbar.js"></script> */

(async function () {
    const API    = "https://fifa-chat-dr6w.onrender.com";
    const userId = sessionStorage.getItem("user_id");
    if (!userId) return;

    const ICON_CATALOG = [
        { id: "icon1", img: "../imagenes/icon1.png" },
        { id: "icon2", img: "../imagenes/icon2.png" },
        { id: "icon3", img: "../imagenes/icon3.png" },
        { id: "icon4", img: "../imagenes/icon4.png" },
        { id: "icon5", img: "../imagenes/icon5.png" },
        { id: "star1", img: "../imagenes/star1.png" },
        { id: "star2", img: "../imagenes/star2.png" },
        { id: "star3", img: "../imagenes/star3.png" },
        { id: "star4", img: "../imagenes/star4.png" },
        { id: "star5", img: "../imagenes/star5.png" },
    ];

    const avatarEl = document.querySelector(".profile-trigger .avatar, a[href='profile.html'] .avatar");
    const nameEls  = document.querySelectorAll(
        "#navbar-user, #userHeaderName, #user-name-display, .user-profile > span"
    );

    /* ── PRESENCE ── */
    async function setOnline() {
        await fetch(`${API}/users/${userId}/online`, { method: "POST" }).catch(() => {});
    }

    function setOffline() {
        navigator.sendBeacon(`${API}/users/${userId}/offline`);
    }

    // Online al cargar cualquier página autenticada
    setOnline();

    // Offline al cerrar pestaña/navegador
    window.addEventListener("beforeunload", setOffline);

    // Offline al hacer logout (cualquier botón con id logoutBtn)
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            setOffline();
            sessionStorage.clear();
        });
    }

    /* ── NAVBAR UI ── */
    try {
        const res  = await fetch(`${API}/users/${userId}`);
        if (!res.ok) return;
        const user = await res.json();

        // Nombre
        nameEls.forEach(el => { if (el) el.textContent = user.full_name; });

        if (!avatarEl) return;

        // Contenedor fijo
        avatarEl.style.cssText = `
            width:36px; height:36px; border-radius:50%;
            overflow:visible; position:relative; flex-shrink:0;
            display:flex; align-items:center; justify-content:center;
        `;

        // Foto
        if (user.profile_photo) {
            avatarEl.textContent = "";
            const img = document.createElement("img");
            img.src = user.profile_photo;
            img.style.cssText = `
                width:36px; height:36px;
                border-radius:50%; object-fit:cover; display:block;
            `;
            avatarEl.appendChild(img);
        }

        // Marco de color (solo si no hay ícono equipado)
        if (user.profile_frame && !user.equipped_icon) {
            avatarEl.style.padding    = "2px";
            avatarEl.style.background = user.profile_frame;
        }

        // Ícono equipado como marco
        if (user.equipped_icon) {
            const iconData = ICON_CATALOG.find(i => i.id === user.equipped_icon);
            if (iconData) {
                const frame = document.createElement("img");
                frame.src = iconData.img;
                frame.style.cssText = `
                    position:absolute; top:0; left:0;
                    width:100%; height:100%;
                    object-fit:cover; pointer-events:none;
                    z-index:10; border-radius:50%;
                `;
                avatarEl.appendChild(frame);
            }
        }

        // Indicador online (punto verde en esquina del avatar)
        if (user.is_online) {
            const dot = document.createElement("div");
            dot.style.cssText = `
                position:absolute; bottom:0; right:0;
                width:10px; height:10px; border-radius:50%;
                background:#2ed573; border:2px solid #fff;
                z-index:20;
            `;
            avatarEl.appendChild(dot);
        }

    } catch (err) {
        console.error("navbar.js error:", err);
    }
})();