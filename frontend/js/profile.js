document.addEventListener("DOMContentLoaded", async () => {

    const API = "https://fifa-chat-dr6w.onrender.com";
    const userId = sessionStorage.getItem("user_id");

    if (!userId) {
        window.location.href = "login.html";
        return;
    }

    const navbarUser = document.getElementById("navbar-user");
    const fullName = document.getElementById("fullName");
    const email = document.getElementById("email");

    const profileAvatar = document.getElementById("profileAvatar");
    const miniAvatar = document.getElementById("miniAvatar");
    const avatarFrame = document.getElementById("avatarFrame");

    const fileInput = document.getElementById("fileInput");
    const changePhotoBtn = document.getElementById("changePhotoBtn");

    let currentPhoto = "";
    let currentFrame = "";

    function renderPhoto(src) {

        profileAvatar.innerHTML = `
            <img src="${src}">
        `;

        miniAvatar.innerHTML = `
            <img src="${src}"
            style="width:100%;height:100%;border-radius:50%;object-fit:cover;">
        `;
    }

    async function saveProfile() {

        try {

            await fetch(`${API}/users/${userId}/photo`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    profile_photo: currentPhoto,
                    profile_frame: currentFrame
                })
            });

        } catch (err) {
            console.log(err);
        }
    }

    async function loadUser() {

        try {

            const res = await fetch(`${API}/users/${userId}`);

            if (!res.ok) throw new Error("Error usuario");

            const user = await res.json();

            navbarUser.textContent = user.full_name;
            fullName.value = user.full_name;
            email.value = user.email;

            currentPhoto = user.profile_photo || "";
            currentFrame = user.profile_frame || "";

            if (currentPhoto) {
                renderPhoto(currentPhoto);
            }

            if (currentFrame) {
                avatarFrame.style.background = currentFrame;

                document.querySelectorAll(".frame-option").forEach(btn => {
                    btn.classList.remove("active");

                    if (btn.dataset.frame === currentFrame) {
                        btn.classList.add("active");
                    }
                });
            }

        } catch (err) {

            console.log(err);
            navbarUser.textContent = "Error";
        }
    }

    changePhotoBtn.addEventListener("click", () => {
        fileInput.click();
    });

    fileInput.addEventListener("change", function () {

        const file = this.files[0];

        if (!file) return;

        const reader = new FileReader();

        reader.onload = async function (e) {

            currentPhoto = e.target.result;

            renderPhoto(currentPhoto);

            await saveProfile();
        };

        reader.readAsDataURL(file);
    });

    document.querySelectorAll(".frame-option").forEach(btn => {

        btn.addEventListener("click", async () => {

            document.querySelectorAll(".frame-option")
            .forEach(x => x.classList.remove("active"));

            btn.classList.add("active");

            currentFrame = btn.dataset.frame;

            avatarFrame.style.background = currentFrame;

            await saveProfile();
        });

    });

    document.getElementById("logoutBtn")
    .addEventListener("click", () => {
        sessionStorage.clear();
    });

    loadUser();

});