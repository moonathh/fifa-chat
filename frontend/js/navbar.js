/* navbar.js — incluir en todas las páginas con <script src="../js/navbar.js"></script> */

(async function () {
    const API    = "https://fifa-chat-dr6w.onrender.com";
    const userId = sessionStorage.getItem("user_id");

    if (!userId) return;

    const avatarEl = document.querySelector(".profile-trigger .avatar, a[href='profile.html'] .avatar");
    const nameEls  = document.querySelectorAll(
        "#navbar-user, #userHeaderName, #user-name-display, .user-profile > span"
    );

    try {
        const res  = await fetch(`${API}/users/${userId}`);
        if (!res.ok) return;
        const user = await res.json();

        // Nombre
        nameEls.forEach(el => { if (el) el.textContent = user.full_name; });

        if (!avatarEl) return;

        // Tamaño fijo siempre, tenga foto o no
        avatarEl.style.cssText = `
            width:36px; height:36px; border-radius:50%;
            overflow:hidden; position:relative; flex-shrink:0;
            display:flex; align-items:center; justify-content:center;
        `;

        // Foto
        if (user.profile_photo) {
            avatarEl.textContent = "";
            const img = document.createElement("img");
            img.src = user.profile_photo;
            img.style.cssText = `
                position:absolute; top:0; left:0;
                width:100%; height:100%;
                border-radius:50%; object-fit:cover; display:block;
            `;
            avatarEl.appendChild(img);
        }

        // Marco — se aplica al propio avatarEl con outline, no al <a>
        if (user.profile_frame) {
            avatarEl.style.outline       = "2.5px solid transparent";
            avatarEl.style.boxShadow     = `0 0 0 2.5px transparent`;
            avatarEl.style.background    = user.profile_frame;
            // Wrapeamos la imagen para que el marco no tape la foto
            avatarEl.style.padding       = "2px";
            avatarEl.style.backgroundClip = "padding-box";
        }

    } catch (err) {
        console.error("navbar.js error:", err);
    }
})();