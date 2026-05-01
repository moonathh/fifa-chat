const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const SALT_ROUNDS = 10;

const app = express();
const server = http.createServer(app);

/* ======================
   DB SUPABASE
====================== */
const db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    family: 4
});

/* ======================
   SOCKET.IO
====================== */
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "PATCH"]
    }
});

app.use(cors());
app.use(express.json({ limit: "5mb" }));

/* ======================
   TEST DB
====================== */
db.query("SELECT NOW()")
    .then(() => console.log("✅ DB conectada"))
    .catch(err => console.error("❌ DB error:", err));

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

    socket.on("send_message", async (data) => {
        try {
            const chat_id = String(data.chat_id).trim();
            const username = String(data.username).trim();
            const message = String(data.message).trim();

            if (!chat_id || !message) return;

            /* guardar mensaje */
            await db.query(
                `INSERT INTO messages (chat_id, username, message) VALUES ($1, $2, $3)`,
                [chat_id, username, message]
            );

            /* reenviar mensaje a todos en el chat */
            io.to(`chat_${chat_id}`).emit("new_message", {
                chat_id,
                username,
                message
            });

            /* SOLO SI ES GRUPO */
            if (chat_id.startsWith("group_")) {
                const groupId = parseInt(chat_id.replace("group_", ""));

                /* contar total de mensajes del grupo */
                const activeTasks = await db.query(
    `SELECT id, target_value, created_at FROM tasks
     WHERE group_id = $1 AND task_type = 'messages' AND completed = FALSE`,
    [groupId]
);

for (const task of activeTasks.rows) {
    const count = await db.query(
        `SELECT COUNT(*)::int AS total FROM messages
         WHERE chat_id = $1 AND created_at >= $2`,
        [chat_id, task.created_at]
    );
    const total = count.rows[0].total;

    await db.query(
        `UPDATE tasks SET current_value = $1 WHERE id = $2`,
        [total, task.id]
    );
}

await db.query(
    `UPDATE tasks
     SET completed = TRUE, completed_at = NOW()
     WHERE group_id = $1
       AND task_type = 'messages'
       AND completed = FALSE
       AND current_value >= target_value`,
    [groupId]
);

io.to(`chat_${chat_id}`).emit("task_progress");
}

} catch (err) {
    console.error("❌ send_message error:", err);
}
});

    socket.on("group_created", (data) => {
        if (data.member_ids) {
            data.member_ids.forEach(memberId => {
                io.emit(`user_${memberId}_new_group`, data.group);
            });
        }
    });

    socket.on("task_created", (data) => {
        io.to(`chat_${data.group_id}`).emit("new_task", data.task);
    });

    socket.on("disconnect", () => {
        console.log("🔴 desconectado");
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

        if (!result.rows.length) {
            return res.status(401).json({ error: "Login incorrecto" });
        }

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
                await db.query(
                    `UPDATE users SET password = $1 WHERE id = $2`,
                    [newHash, user.id]
                );
            }
        }

        if (!valid) {
            return res.status(401).json({ error: "Login incorrecto" });
        }

        delete user.password;
        res.json(user);

    } catch (err) {
        res.status(500).json(err);
    }
});

/* ======================
   USER PROFILE
====================== */
app.get("/users/:id", async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id, full_name, email, COALESCE(points, 0) AS points
             FROM users WHERE id = $1 LIMIT 1`,
            [req.params.id]
        );

        if (!result.rows.length) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

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

        if (!result.rows.length) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json(err);
    }
});

/* ======================
   FRIENDS
====================== */
app.get("/friends/:userId", async (req, res) => {
    try {
        const result = await db.query(
            `SELECT u.id, u.full_name
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
        const friendResult = await db.query(
            `SELECT id FROM users WHERE email = $1`,
            [friend_email]
        );

        if (!friendResult.rows.length) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }

        const friend_id = friendResult.rows[0].id;

        if (Number(friend_id) === Number(user_id)) {
            return res.status(400).json({ error: "No puedes agregarte a ti mismo" });
        }

        await db.query(
            `INSERT INTO friends (user1_id, user2_id) VALUES ($1, $2)`,
            [user_id, friend_id]
        );

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

app.post("/messages", async (req, res) => {
    const { chat_id, username, message } = req.body;

    try {
        await db.query(
            `INSERT INTO messages (chat_id, username, message) VALUES ($1, $2, $3)`,
            [chat_id, username, message]
        );

        res.sendStatus(200);
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
            `INSERT INTO groups (name, image_url, created_by)
             VALUES ($1, $2, $3) RETURNING *`,
            [name, image_url || "👥", created_by]
        );

        const group = groupResult.rows[0];

        const allMembers = [
            ...new Set([
                Number(created_by),
                ...(member_ids || []).map(Number)
            ])
        ];

        for (const uid of allMembers) {
            await client.query(
                `INSERT INTO group_members (group_id, user_id)
                 VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                [group.id, uid]
            );
        }

        await client.query("COMMIT");
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
             WHERE id = $3 AND created_by = $4
             RETURNING *`,
            [name, image_url, req.params.id, user_id]
        );

        if (!result.rows.length) {
            return res.status(403).json({ error: "No autorizado o grupo no encontrado" });
        }

        res.json(result.rows[0]);
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
             ORDER BY t.created_at DESC`,
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

/* ✅ CORREGIDO: ahora guarda task_type, target_value y current_value */
app.post("/tasks", async (req, res) => {
    const {
        group_id,
        title,
        description,
        points,
        assigned_to,
        created_by,
        task_type,
        target_value
    } = req.body;

    try {
        const result = await db.query(
            `INSERT INTO tasks
             (group_id, title, description, points, assigned_to, created_by, task_type, target_value, current_value)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0)
             RETURNING *`,
            [
                group_id,
                title,
                description || "",
                points || 100,
                assigned_to || null,
                created_by,
                task_type || "messages",
                target_value || 50
            ]
        );

        res.json(result.rows[0]);
    } catch (err) {
        console.error("❌ crear tarea error:", err);
        res.status(500).json(err);
    }
});

app.patch("/tasks/:taskId/complete", async (req, res) => {
    const { user_id } = req.body;

    try {
        const result = await db.query(
            `UPDATE tasks SET completed = TRUE, completed_at = NOW()
             WHERE id = $1 RETURNING *`,
            [req.params.taskId]
        );

        if (!result.rows.length) {
            return res.status(404).json({ error: "Tarea no encontrada" });
        }

        const task = result.rows[0];

        await db.query(
            `UPDATE users SET points = COALESCE(points, 0) + $1 WHERE id = $2`,
            [task.points, user_id]
        );

        res.json(task);
    } catch (err) {
        res.status(500).json(err);
    }
});

/* ======================
   SERVER
====================== */
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log("🚀 running on", PORT);
});