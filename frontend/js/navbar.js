/* navbar.js — incluir en todas las páginas con <script src="../js/navbar.js"></script> */

(async function () {
    const API    = "https://fifa-chat-dr6w.onrender.com";
    const userId = sessionStorage.getItem("user_id");

    if (!userId) return; // el redirect lo maneja cada página

    // ── Busca el div.avatar del navbar (el que lleva al perfil) ──
    const avatarEl  = document.querySelector(".profile-trigger .avatar, a[href='profile.html'] .avatar");
    const nameEls   = document.querySelectorAll(
        "#navbar-user, #userHeaderName, #user-name-display, .user-profile > span"
    );

    try {
        const res  = await fetch(`${API}/users/${userId}`);
        if (!res.ok) return;
        const user = await res.json();

        // Nombre en navbar
        nameEls.forEach(el => {
            if (el) el.textContent = user.full_name;
        });

        // Foto de perfil
        if (user.profile_photo && avatarEl) {
            avatarEl.textContent = "";
            avatarEl.style.cssText = `
                width:36px; height:36px; border-radius:50%;
                overflow:hidden; position:relative;
                display:flex; align-items:center; justify-content:center;
            `;
            const img = document.createElement("img");
            img.src = user.profile_photo;
            img.style.cssText = `
                position:absolute; top:0; left:0;
                width:100%; height:100%;
                border-radius:50%; object-fit:cover; display:block;
            `;
            avatarEl.appendChild(img);
        }

        // Marco del avatar si tiene
        if (user.profile_frame && avatarEl) {
            const link = avatarEl.closest("a");
            if (link) {
                link.style.padding      = "2px";
                link.style.borderRadius = "50%";
                link.style.background   = user.profile_frame;
                link.style.display      = "flex";
            }
        }

    } catch (err) {
        console.error("navbar.js error:", err);
    }
})();