document.addEventListener("DOMContentLoaded", async () => {

    const API = "https://fifa-chat-dr6w.onrender.com";
    const userId = sessionStorage.getItem("user_id");

    if (!userId) {
        window.location.href = "login.html";
        return;
    }

    const navbarUser   = document.getElementById("navbar-user");
    const fullName     = document.getElementById("fullName");
    const email        = document.getElementById("email");
    const profileAvatar = document.getElementById("profileAvatar");
    const miniAvatar   = document.getElementById("miniAvatar");
    const avatarFrame  = document.getElementById("avatarFrame");
    const fileInput    = document.getElementById("fileInput");
    const changePhotoBtn = document.getElementById("changePhotoBtn");

    let currentPhoto   = "";
    let currentFrame   = "";
    let equippedIcon   = null;   // id del ícono equipado (o null)
    let ownedIcons     = [];     // array de icon_id comprados

    /* ── CATÁLOGO de íconos (mismo que rewards.html) ── */
    const ICON_CATALOG = [
        { id: "icon1", img: "../imagenes/icon1.png", label: "Ícono Bronce"     },
        { id: "icon2", img: "../imagenes/icon2.png", label: "Ícono Plata"      },
        { id: "icon3", img: "../imagenes/icon3.png", label: "Ícono Oro"        },
        { id: "icon4", img: "../imagenes/icon4.png", label: "Ícono Platino"    },
        { id: "icon5", img: "../imagenes/icon5.png", label: "Ícono Élite"      },
        { id: "star1", img: "../imagenes/star1.png", label: "Estrella Bronce"  },
        { id: "star2", img: "../imagenes/star2.png", label: "Estrella Plata"   },
        { id: "star3", img: "../imagenes/star3.png", label: "Estrella Oro"     },
        { id: "star4", img: "../imagenes/star4.png", label: "Estrella Platino" },
        { id: "star5", img: "../imagenes/star5.png", label: "Estrella Élite"   },
    ];

    /* ── RENDER FOTO ── */
    function renderPhoto(src) {
        const img = `<img src="${src}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
        profileAvatar.innerHTML = img;
        miniAvatar.innerHTML    = img;
    }

    /* ── RENDER ÍCONO EQUIPADO sobre el avatar ── */
    function renderEquippedBadge() {
        const old = document.getElementById("equipped-badge");
        if (old) old.remove();

        if (!equippedIcon) return;

        const iconData = ICON_CATALOG.find(i => i.id === equippedIcon);
        if (!iconData) return;

        const badge = document.createElement("div");
        badge.id = "equipped-badge";
        badge.style.cssText = `
            position:absolute; bottom:-4px; right:-4px;
            width:42px; height:42px; border-radius:50%;
            background:#fff; border:3px solid #0f62fe;
            display:flex; align-items:center; justify-content:center;
            font-size:22px; box-shadow:0 4px 12px rgba(0,0,0,.2);
            z-index:10;
        `;
        badge.innerHTML = `<img src="${iconData.img}" alt="${iconData.label}"
            style="width:28px;height:28px;object-fit:contain;">`;

        // El wrap del avatar necesita position:relative
        const wrap = document.getElementById("avatarFrame");
        wrap.style.position = "relative";
        wrap.appendChild(badge);
    }

    /* ── GUARDAR FOTO + FRAME ── */
    async function saveProfile() {
        try {
            await fetch(`${API}/users/${userId}/photo`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ profile_photo: currentPhoto, profile_frame: currentFrame })
            });
        } catch (err) { console.error(err); }
    }

    /* ── EQUIPAR / DESEQUIPAR ÍCONO ── */
    async function equipIcon(iconId) {
        const newEquip = equippedIcon === iconId ? null : iconId;
        try {
            await fetch(`${API}/users/${userId}/equip-icon`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ icon_id: newEquip })
            });
            equippedIcon = newEquip;
            renderEquippedBadge();
            renderIconGrid();
        } catch (err) { console.error(err); }
    }

    /* ── GRID DE ÍCONOS ADQUIRIDOS ── */
    function renderIconGrid() {
        const container = document.getElementById("owned-icons-grid");
        if (!container) return;

        if (ownedIcons.length === 0) {
            container.innerHTML = `
                <p style="color:#888;font-size:14px;grid-column:1/-1;margin:0;">
                    Aún no tienes íconos. Cómpralos en la 
                    <a href="rewards.html" style="color:#0f62fe;">Tienda</a>.
                </p>`;
            return;
        }

        container.innerHTML = "";
        ownedIcons.forEach(iconId => {
            const data = ICON_CATALOG.find(i => i.id === iconId);
            if (!data) return;

            const isEquipped = equippedIcon === iconId;
            const tile = document.createElement("div");
            tile.style.cssText = `
                display:flex; flex-direction:column; align-items:center; gap:6px;
                cursor:pointer; padding:10px 8px; border-radius:14px;
                border:2.5px solid ${isEquipped ? "#0f62fe" : "#e5e5e5"};
                background:${isEquipped ? "#eff4ff" : "#fafafa"};
                transition:.2s;
            `;
            tile.innerHTML = `
                <img src="${data.img}" alt="${data.label}"
                     style="width:36px;height:36px;object-fit:contain;">
                <span style="font-size:11px;font-weight:600;color:${isEquipped ? "#0f62fe" : "#555"};text-align:center;">${data.label}</span>
                <span style="font-size:10px;color:${isEquipped ? "#0f62fe" : "#aaa"};">${isEquipped ? "✓ Equipado" : "Equipar"}</span>
            `;
            tile.addEventListener("click", () => equipIcon(iconId));
            container.appendChild(tile);
        });
    }

    /* ── CARGAR USUARIO ── */
    async function loadUser() {
        try {
            const [userRes, iconsRes] = await Promise.all([
                fetch(`${API}/users/${userId}`),
                fetch(`${API}/users/${userId}/icons`)
            ]);

            if (!userRes.ok) throw new Error("Error usuario");

            const user  = await userRes.json();
            const icons = iconsRes.ok ? await iconsRes.json() : { icons: [] };

            navbarUser.textContent = user.full_name;
            fullName.value         = user.full_name;
            email.value            = user.email;

            currentPhoto = user.profile_photo || "";
            currentFrame = user.profile_frame || "";
            equippedIcon = user.equipped_icon  || null;
            ownedIcons   = icons.icons || [];

            if (currentPhoto) renderPhoto(currentPhoto);

            if (currentFrame) {
                avatarFrame.style.background = currentFrame;
                document.querySelectorAll(".frame-option").forEach(btn => {
                    btn.classList.toggle("active", btn.dataset.frame === currentFrame);
                });
            }

            renderEquippedBadge();
            renderIconGrid();

        } catch (err) {
            console.error(err);
            navbarUser.textContent = "Error";
        }
    }

    /* ── EVENTOS ── */
    changePhotoBtn.addEventListener("click", () => fileInput.click());

    fileInput.addEventListener("change", function () {
        const file = this.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            currentPhoto = e.target.result;
            renderPhoto(currentPhoto);
            await saveProfile();
        };
        reader.readAsDataURL(file);
    });

    document.querySelectorAll(".frame-option").forEach(btn => {
        btn.addEventListener("click", async () => {
            document.querySelectorAll(".frame-option").forEach(x => x.classList.remove("active"));
            btn.classList.add("active");
            currentFrame = btn.dataset.frame;
            avatarFrame.style.background = currentFrame;
            await saveProfile();
        });
    });

    document.getElementById("logoutBtn").addEventListener("click", () => {
        sessionStorage.clear();
    });

    loadUser();
});