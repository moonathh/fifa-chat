const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const SALT_ROUNDS = 10;

const app = express();
const server = http.createServer(app);

const db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    family: 4
});

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST", "PUT", "PATCH"] }
});

app.use(cors());
app.use(express.json({ limit: "5mb" }));

db.query("SELECT NOW()")
    .then(() => console.log("✅ DB conectada"))
    .catch(err => console.error("❌ DB error:", err));

/* ======================
   TAREAS PREDEFINIDAS
====================== */
const DEFAULT_TASKS = [
    {
        title: "Escritores del grupo",
        description: "Entre todos envíen 10 mensajes en el grupo",
        task_type: "messages",
        target_value: 10,
        points: 100
    },
    {
        title: "Compartir momento",
        description: "Comparte una foto o video en el grupo",
        task_type: "media",
        target_value: 1,
        points: 250
    },
    {
        title: "Dónde están",
        description: "Compartan su ubicación en el grupo",
        task_type: "location",
        target_value: 1,
        points: 150
    },
    {
        title: "Invita a alguien",
        description: "Agrega 1 nuevo amigo al grupo",
        task_type: "friends",
        target_value: 1,
        points: 200
    },
    {
        title: "Cara a cara",
        description: "Realiza una videollamada grupal",
        task_type: "call",
        target_value: 1,
        points: 500
    }
];

async function createDefaultTasks(groupId, createdBy) {
    for (const task of DEFAULT_TASKS) {
        await db.query(
            `INSERT INTO tasks
             (group_id, title, description, task_type, target_value, current_value, points, created_by)
             VALUES ($1, $2, $3, $4, $5, 0, $6, $7)`,
            [groupId, task.title, task.description, task.task_type, task.target_value, task.points, createdBy]
        );
    }
}

/* ======================
   HELPER: mapear task_type → message_type real en la tabla messages
   task_type "messages" → message_type "text" en DB
   task_type "media"    → message_type "media"
   task_type "location" → message_type "location"
   task_type "call"     → message_type "call"
====================== */
const TASK_TYPE_TO_MSG_TYPE = {
    messages: "text",
    media:    "media",
    location: "location",
    call:     "call"
};

/* ======================
   HELPER: actualizar progreso de tareas
   ▸ Cuenta SOLO eventos ocurridos DESPUÉS de que se creó la tarea (created_at)
   ▸ Así cada tarea siempre parte de 0
====================== */
async function updateTaskProgress(chatId, groupId, taskType) {
    // Traducir task_type al message_type real de la tabla messages
    const dbMsgType = TASK_TYPE_TO_MSG_TYPE[taskType] || taskType;

    // Obtener tareas activas del tipo correspondiente
    const tasks = await db.query(
        `SELECT t.id, t.target_value, t.assigned_to, t.created_at,
                u.full_name AS assigned_name
         FROM tasks t
         LEFT JOIN users u ON u.id = t.assigned_to
         WHERE t.group_id = $1
           AND t.task_type = $2
           AND t.completed = FALSE`,
        [groupId, taskType]
    );

    for (const task of tasks.rows) {
        let countQuery, countParams;

        if (task.assigned_to) {
            // Solo cuenta mensajes del usuario asignado, desde que se creó la tarea
            countQuery = `
                SELECT COUNT(*)::int AS total FROM messages
                WHERE chat_id = $1
                  AND username = $2
                  AND message_type = $3
                  AND created_at > $4`;
            countParams = [chatId, task.assigned_name, dbMsgType, task.created_at];
        } else {
            // Cuenta mensajes de cualquier miembro del grupo, desde que se creó la tarea
            countQuery = `
                SELECT COUNT(*)::int AS total FROM messages
                WHERE chat_id = $1
                  AND message_type = $2
                  AND created_at > $3`;
            countParams = [chatId, dbMsgType, task.created_at];
        }

        const count = await db.query(countQuery, countParams);
        const total = count.rows[0].total;

        await db.query(
            `UPDATE tasks SET current_value = $1 WHERE id = $2`,
            [total, task.id]
        );
    }
}

/* ======================
   HELPER: actualizar progreso de tareas tipo 'friends'
   ▸ Cuenta miembros añadidos al grupo DESPUÉS de que se creó la tarea
====================== */
async function updateFriendsTaskProgress(groupId) {
    const tasks = await db.query(
        `SELECT id, target_value, created_at
         FROM tasks
         WHERE group_id = $1
           AND task_type = 'friends'
           AND completed = FALSE`,
        [groupId]
    );

    for (const task of tasks.rows) {
        // Contar miembros añadidos después de que se creó esta tarea
        const count = await db.query(
            `SELECT COUNT(*)::int AS total
             FROM group_members
             WHERE group_id = $1
               AND added_at > $2`,
            [groupId, task.created_at]
        );
        const total = count.rows[0].total;
        await db.query(
            `UPDATE tasks SET current_value = $1 WHERE id = $2`,
            [total, task.id]
        );
    }
}

/* ======================
   HELPER: marcar tareas completadas (SIN dar puntos todavia)
   Los puntos solo se entregan cuando el usuario los reclama desde task.html
====================== */
async function rewardCompletedTasks(groupId, taskType, chatId) {
    try {
        const completed = await db.query(`
            UPDATE tasks
            SET completed = TRUE,
                completed_at = NOW()
            WHERE group_id = $1
              AND task_type = $2
              AND completed = FALSE
              AND claimed = FALSE
              AND current_value >= target_value
            RETURNING *
        `, [groupId, taskType]);

        for (const task of completed.rows) {
            // Solo notificar — puntos se entregan al reclamar desde task.html
            io.to(`chat_${chatId}`).emit("task_completed", {
                title: task.title,
                points: task.points
            });
        }
    } catch (err) {
        console.error("ERROR rewardCompletedTasks:", err);
    }
}

/* ======================
   SOCKET CHAT
====================== */
io.on("connection", (socket) => {
    console.log("🟢 conectado:", socket.id);

    socket.on("join_chat", (chatId) => {
        socket.join(`chat_${String(chatId).trim()}`);
    });

    socket.on("leave_chat", (chatId) => {
        socket.leave(`chat_${String(chatId).trim()}`);
    });

    /* ── PRESENCIA ── */
    socket.on("user_online", async (userId) => {
        if (!userId) return;
        socket.userId = userId;
        await db.query(`UPDATE users SET is_online = TRUE WHERE id = $1`, [userId]);
        io.emit("presence_update", { userId, online: true });
    });

    socket.on("user_offline", async (userId) => {
        if (!userId) return;
        await db.query(`UPDATE users SET is_online = FALSE WHERE id = $1`, [userId]);
        io.emit("presence_update", { userId, online: false });
    });

    socket.on("send_message", async (data) => {
        try {
            const chat_id      = String(data.chat_id).trim();
            const username     = String(data.username).trim();
            const message      = String(data.message).trim();
            const message_type = data.message_type || "text";
            const encrypted    = data.encrypted || false;

            if (!chat_id || !message) return;

            await db.query(`
                INSERT INTO messages (chat_id, username, message, message_type, encrypted)
                VALUES ($1, $2, $3, $4, $5)
            `, [chat_id, username, message, message_type, encrypted]);

            io.to(`chat_${chat_id}`).emit("new_message", {
                chat_id,
                username,
                message,
                message_type,
                encrypted
            });

            // Solo actualizar tareas en chats de grupo
            if (chat_id.startsWith("group_")) {
                const groupId = parseInt(chat_id.replace("group_", ""));

                // Actualizar progreso según el tipo de mensaje
                if (["text", "media", "location"].includes(message_type)) {
                    // Mapear message_type al task_type correcto
                    const taskType = message_type === "text" ? "messages" : message_type;
                    await updateTaskProgress(chat_id, groupId, taskType);
                    await rewardCompletedTasks(groupId, taskType, chat_id);
                }

                if (message_type === "call") {
                    await updateTaskProgress(chat_id, groupId, "call");
                    await rewardCompletedTasks(groupId, "call", chat_id);
                }

                io.to(`chat_${chat_id}`).emit("task_progress");
            }

        } catch (err) {
            console.error("ERROR SOCKET:", err);
        }
    });

    socket.on("disconnect", async () => {
        console.log("🔴 desconectado");
        if (socket.userId) {
            await db.query(`UPDATE users SET is_online = FALSE WHERE id = $1`, [socket.userId]);
            io.emit("presence_update", { userId: socket.userId, online: false });
        }
    });
});

/* ======================
   REGISTER
====================== */
app.post("/register", async (req, res) => {
    const { full_name, email, password } = req.body;
    try {
        const hash = await bcrypt.hash(password, SALT_ROUNDS);
        await db.query(
            `INSERT INTO users (full_name, email, password) VALUES ($1, $2, $3)`,
            [full_name, email, hash]
        );
        res.sendStatus(200);
    } catch (err) {
        res.status(500).json(err);
    }
});

/* ======================
   LOGIN
====================== */
app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await db.query(
            `SELECT * FROM users WHERE email = $1 LIMIT 1`,
            [email]
        );
        if (!result.rows.length) return res.status(401).json({ error: "Login incorrecto" });

        const user = result.rows[0];
        const savedPassword = user.password;
        let valid = false;

        if (
            savedPassword.startsWith("$2a$") ||
            savedPassword.startsWith("$2b$") ||
            savedPassword.startsWith("$2y$")
        ) {
            valid = await bcrypt.compare(password, savedPassword);
        } else {
            valid = password === savedPassword;
            if (valid) {
                const newHash = await bcrypt.hash(password, SALT_ROUNDS);
                await db.query(`UPDATE users SET password = $1 WHERE id = $2`, [newHash, user.id]);
            }
        }

        if (!valid) return res.status(401).json({ error: "Login incorrecto" });

        delete user.password;
        res.json(user);
    } catch (err) {
        res.status(500).json(err);
    }
});

/* ======================
   USERS
====================== */
app.get("/users/:id", async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id, full_name, email, COALESCE(points, 0) AS points,
                    profile_photo, profile_frame, equipped_icon,
                    COALESCE(owned_icons, '[]'::jsonb) AS owned_icons,
                    COALESCE(is_online, FALSE) AS is_online
             FROM users WHERE id = $1 LIMIT 1`,
            [req.params.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: "Usuario no encontrado" });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json(err);
    }
});

app.put("/users/:id", async (req, res) => {
    const { full_name, email } = req.body;
    try {
        const result = await db.query(
            `UPDATE users SET full_name = $1, email = $2
             WHERE id = $3
             RETURNING id, full_name, email, COALESCE(points, 0) AS points`,
            [full_name, email, req.params.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: "Usuario no encontrado" });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json(err);
    }
});

app.put("/users/:id/photo", async (req, res) => {
    const { profile_photo, profile_frame } = req.body;
    try {
        const result = await db.query(`
            UPDATE users
            SET profile_photo = $1,
                profile_frame = $2
            WHERE id = $3
            RETURNING profile_photo, profile_frame
        `, [profile_photo, profile_frame, req.params.id]);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json(err);
    }
});

/* ======================
   ICONS
====================== */
app.get("/users/:id/icons", async (req, res) => {
    try {
        const result = await db.query(
            `SELECT COALESCE(owned_icons, '[]'::jsonb) AS icons,
                    equipped_icon
             FROM users WHERE id = $1 LIMIT 1`,
            [req.params.id]
        );
        if (!result.rows.length) return res.status(404).json({ error: "Usuario no encontrado" });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json(err);
    }
});

app.post("/users/:id/buy-icon", async (req, res) => {
    const { icon_id, cost } = req.body;
    const client = await db.connect();
    try {
        await client.query("BEGIN");

        const userRes = await client.query(
            `SELECT points, owned_icons FROM users WHERE id = $1 FOR UPDATE`,
            [req.params.id]
        );
        if (!userRes.rows.length) throw new Error("Usuario no encontrado");

        const user  = userRes.rows[0];
        const owned = user.owned_icons || [];

        if (owned.includes(icon_id)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "Ya tienes este ícono" });
        }
        if ((user.points || 0) < cost) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "Puntos insuficientes" });
        }

        const newOwned = [...owned, icon_id];
        await client.query(
            `UPDATE users SET points = points - $1, owned_icons = $2 WHERE id = $3`,
            [cost, JSON.stringify(newOwned), req.params.id]
        );

        await client.query("COMMIT");
        res.json({ owned_icons: newOwned, points: (user.points || 0) - cost });
    } catch (err) {
        await client.query("ROLLBACK");
        res.status(500).json(err);
    } finally {
        client.release();
    }
});

app.put("/users/:id/equip-icon", async (req, res) => {
    const { icon_id } = req.body;
    try {
        const result = await db.query(
            `UPDATE users SET equipped_icon = $1 WHERE id = $2
             RETURNING equipped_icon`,
            [icon_id || null, req.params.id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json(err);
    }
});

/* ======================
   PRESENCE
====================== */
app.post("/users/:id/online", async (req, res) => {
    try {
        await db.query(`UPDATE users SET is_online = TRUE WHERE id = $1`, [req.params.id]);
        res.sendStatus(200);
    } catch (err) { res.status(500).json(err); }
});

app.post("/users/:id/offline", async (req, res) => {
    try {
        await db.query(`UPDATE users SET is_online = FALSE WHERE id = $1`, [req.params.id]);
        res.sendStatus(200);
    } catch (err) { res.status(500).json(err); }
});

/* ======================
   FRIENDS
====================== */
app.get("/friends/:userId", async (req, res) => {
    try {
        const result = await db.query(
            `SELECT u.id, u.full_name, u.profile_photo, u.profile_frame,
                    u.equipped_icon, COALESCE(u.points, 0) AS points,
                    COALESCE(u.is_online, FALSE) AS is_online
             FROM users u
             JOIN friends f ON (u.id = f.user1_id OR u.id = f.user2_id)
             WHERE (f.user1_id = $1 OR f.user2_id = $1) AND u.id != $1`,
            [req.params.userId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json(err);
    }
});

app.post("/friends", async (req, res) => {
    const { user_id, friend_email } = req.body;
    try {
        const friendResult = await db.query(`SELECT id FROM users WHERE email = $1`, [friend_email]);
        if (!friendResult.rows.length) return res.status(404).json({ error: "Usuario no encontrado" });

        const friend_id = friendResult.rows[0].id;
        if (Number(friend_id) === Number(user_id)) {
            return res.status(400).json({ error: "No puedes agregarte a ti mismo" });
        }

        await db.query(`INSERT INTO friends (user1_id, user2_id) VALUES ($1, $2)`, [user_id, friend_id]);
        res.sendStatus(200);
    } catch (err) {
        res.status(500).json(err);
    }
});

/* ======================
   MESSAGES
====================== */
app.get("/messages/:chat", async (req, res) => {
    try {
        const chat = String(req.params.chat).trim();
        const result = await db.query(
            `SELECT * FROM messages WHERE TRIM(chat_id) = $1 ORDER BY created_at ASC`,
            [chat]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json(err);
    }
});

/* ======================
   GROUPS
====================== */
app.get("/groups/:userId", async (req, res) => {
    try {
        const result = await db.query(
            `SELECT g.id, g.name, g.image_url, g.created_by,
                    COUNT(gm2.user_id) AS member_count
             FROM groups g
             JOIN group_members gm ON gm.group_id = g.id
             LEFT JOIN group_members gm2 ON gm2.group_id = g.id
             WHERE gm.user_id = $1
             GROUP BY g.id, g.name, g.image_url, g.created_by, g.created_at
             ORDER BY g.created_at DESC`,
            [req.params.userId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json(err);
    }
});

app.get("/groups/:groupId/members", async (req, res) => {
    try {
        const result = await db.query(
            `SELECT u.id, u.full_name
             FROM users u
             JOIN group_members gm ON gm.user_id = u.id
             WHERE gm.group_id = $1`,
            [req.params.groupId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json(err);
    }
});

app.post("/groups", async (req, res) => {
    const { name, image_url, created_by, member_ids } = req.body;
    const client = await db.connect();
    try {
        await client.query("BEGIN");

        const groupResult = await client.query(
            `INSERT INTO groups (name, image_url, created_by) VALUES ($1, $2, $3) RETURNING *`,
            [name, image_url || "👥", created_by]
        );
        const group = groupResult.rows[0];

        const allMembers = [...new Set([Number(created_by), ...(member_ids || []).map(Number)])];
        for (const uid of allMembers) {
            await client.query(
                `INSERT INTO group_members (group_id, user_id, added_at)
                 VALUES ($1, $2, NOW())
                 ON CONFLICT (group_id, user_id) DO NOTHING`,
                [group.id, uid]
            );
        }

        await client.query("COMMIT");
        await createDefaultTasks(group.id, created_by);

        res.json({ ...group, member_ids: allMembers });
    } catch (err) {
        await client.query("ROLLBACK");
        res.status(500).json(err);
    } finally {
        client.release();
    }
});

app.put("/groups/:id", async (req, res) => {
    const { name, image_url, user_id } = req.body;
    try {
        const result = await db.query(
            `UPDATE groups SET name = $1, image_url = $2
             WHERE id = $3 AND created_by = $4 RETURNING *`,
            [name, image_url, req.params.id, user_id]
        );
        if (!result.rows.length) return res.status(403).json({ error: "No autorizado" });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json(err);
    }
});

/* ── AGREGAR MIEMBRO AL GRUPO ── */
app.post("/groups/:groupId/members", async (req, res) => {
    const { user_id } = req.body;
    const groupId = parseInt(req.params.groupId);
    try {
        // Insertar miembro con timestamp actual
        const result = await db.query(
            `INSERT INTO group_members (group_id, user_id, added_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (group_id, user_id) DO NOTHING
             RETURNING *`,
            [groupId, user_id]
        );

        if (result.rowCount > 0) {
            // Actualizar progreso de tareas tipo 'friends'
            await updateFriendsTaskProgress(groupId);
            await rewardCompletedTasks(groupId, "friends", `group_${groupId}`);
            // Notificar al grupo del progreso
            io.to(`chat_group_${groupId}`).emit("task_progress");
        }

        res.json({ ok: true });
    } catch (err) {
        res.status(500).json(err);
    }
});

/* ======================
   TASKS
====================== */
app.get("/tasks/:groupId", async (req, res) => {
    try {
        const result = await db.query(
            `SELECT t.*, u.full_name AS assigned_name
             FROM tasks t
             LEFT JOIN users u ON u.id = t.assigned_to
             WHERE t.group_id = $1
             ORDER BY t.completed ASC, t.created_at ASC`,
            [req.params.groupId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json(err);
    }
});

app.get("/tasks/user/:userId", async (req, res) => {
    try {
        const result = await db.query(
            `SELECT t.*, g.name AS group_name, u.full_name AS assigned_name
             FROM tasks t
             JOIN groups g ON g.id = t.group_id
             JOIN group_members gm ON gm.group_id = t.group_id AND gm.user_id = $1
             LEFT JOIN users u ON u.id = t.assigned_to
             ORDER BY t.completed ASC, t.created_at DESC`,
            [req.params.userId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json(err);
    }
});

app.post("/tasks", async (req, res) => {
    const {
        group_id, title, description, points,
        assigned_to, created_by, task_type, target_value
    } = req.body;

    const safePoints = Math.min(parseInt(points) || 100, 1000);

    try {
        const result = await db.query(
            `INSERT INTO tasks
             (group_id, title, description, points, assigned_to, created_by,
              task_type, target_value, current_value)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0)
             RETURNING *`,
            [
                group_id,
                title,
                description || "",
                safePoints,
                assigned_to || null,
                created_by,
                task_type || "messages",
                target_value || 10
            ]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error("❌ crear tarea error:", err);
        res.status(500).json(err);
    }
});

/* ── RECLAMAR RECOMPENSA (solo desde task.html) ──
   Marca la tarea como reclamada Y da los puntos a todos los miembros.
   Solo funciona si: completed=TRUE y claimed=FALSE
*/
app.patch("/tasks/:taskId/claim", async (req, res) => {
    const { user_id } = req.body;
    try {
        const check = await db.query(
            `SELECT * FROM tasks WHERE id = $1`,
            [req.params.taskId]
        );
        if (!check.rows.length) return res.status(404).json({ error: "Tarea no encontrada" });

        const task = check.rows[0];

        if (!task.completed) {
            return res.status(400).json({ error: "La tarea aún no está completada" });
        }
        if (task.claimed) {
            return res.status(400).json({ error: "Esta recompensa ya fue reclamada" });
        }

        // Marcar como reclamada
        const result = await db.query(
            `UPDATE tasks SET claimed = TRUE, claimed_at = NOW()
             WHERE id = $1 RETURNING *`,
            [req.params.taskId]
        );

        // Dar puntos a todos los miembros del grupo
        await db.query(
            `UPDATE users SET points = COALESCE(points, 0) + $1
             WHERE id IN (
                 SELECT user_id FROM group_members WHERE group_id = $2
             )`,
            [task.points, task.group_id]
        );

        res.json({ ok: true, points: task.points, task: result.rows[0] });
    } catch (err) {
        res.status(500).json(err);
    }
});

/* ======================
   SERVER
====================== */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("🚀 running on", PORT));