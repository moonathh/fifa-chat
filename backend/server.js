const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const { Pool } = require("pg");

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
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json({ limit: "5mb" }));

/* ======================
   TEST DB
====================== */
db.query("SELECT NOW()")
    .then(() => console.log("DB conectada"))
    .catch(err => console.error("DB error:", err));

/* ======================
   SOCKET CHAT
====================== */
io.on("connection", (socket) => {
    console.log("🟢 conectado:", socket.id);

    socket.on("join_chat", (chatId) => {
        socket.join(`chat_${chatId}`);
    });

    socket.on("send_message", async (data) => {
        const { chat_id, username, message } = data;
        try {
            await db.query(
                "INSERT INTO messages (chat_id, username, message) VALUES ($1,$2,$3)",
                [chat_id, username, message]
            );
            io.to(`chat_${chat_id}`).emit("new_message", { chat_id, username, message });
        } catch (err) {
            console.error(err);
        }
    });

    // Notificar cuando se crea un grupo (para refrescar en tiempo real)
    socket.on("group_created", (data) => {
        // Emitir a todos los miembros del grupo
        data.member_ids.forEach(memberId => {
            io.emit(`user_${memberId}_new_group`, data.group);
        });
    });

    // Notificar cuando se crea una tarea
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
        await db.query(
            "INSERT INTO users (full_name, email, password) VALUES ($1,$2,$3)",
            [full_name, email, password]
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
            "SELECT * FROM users WHERE email=$1 AND password=$2 LIMIT 1",
            [email, password]
        );
        if (result.rows.length === 0)
            return res.status(401).json({ error: "Login incorrecto" });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json(err);
    }
});

/* ======================
   USER
====================== */
app.get("/users/:id", async (req, res) => {
    try {
        const result = await db.query(
            "SELECT id, full_name, email FROM users WHERE id=$1",
            [req.params.id]
        );
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
             WHERE (f.user1_id=$1 OR f.user2_id=$1) AND u.id != $1`,
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
            "SELECT id FROM users WHERE email=$1",
            [friend_email]
        );
        if (friendResult.rows.length === 0)
            return res.status(404).json({ error: "Usuario no encontrado" });

        const friend_id = friendResult.rows[0].id;
        if (friend_id == user_id)
            return res.status(400).json({ error: "No puedes agregarte a ti mismo" });

        await db.query(
            "INSERT INTO friends (user1_id, user2_id) VALUES ($1,$2)",
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
        const result = await db.query(
            "SELECT * FROM messages WHERE chat_id=$1 ORDER BY created_at ASC",
            [req.params.chat]
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
            "INSERT INTO messages (chat_id, username, message) VALUES ($1,$2,$3)",
            [chat_id, username, message]
        );
        res.sendStatus(200);
    } catch (err) {
        res.status(500).json(err);
    }
});

/* ============================================================
   GRUPOS
   Tablas requeridas en Supabase:
   
   CREATE TABLE groups (
     id SERIAL PRIMARY KEY,
     name TEXT NOT NULL,
     image_url TEXT DEFAULT '👥',
     created_by INTEGER REFERENCES users(id),
     created_at TIMESTAMPTZ DEFAULT NOW()
   );

   CREATE TABLE group_members (
     id SERIAL PRIMARY KEY,
     group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
     user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
     UNIQUE(group_id, user_id)
   );
============================================================ */

/* GET grupos de un usuario */
app.get("/groups/:userId", async (req, res) => {
    try {
        const result = await db.query(
            `SELECT g.id, g.name, g.image_url, g.created_by,
                    COUNT(gm2.user_id) AS member_count
             FROM groups g
             JOIN group_members gm ON gm.group_id = g.id
             LEFT JOIN group_members gm2 ON gm2.group_id = g.id
             WHERE gm.user_id = $1
             GROUP BY g.id, g.name, g.image_url, g.created_by
             ORDER BY g.created_at DESC`,
            [req.params.userId]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json(err);
    }
});

/* GET miembros de un grupo */
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

/* POST crear grupo */
app.post("/groups", async (req, res) => {
    const { name, image_url, created_by, member_ids } = req.body;

    // Validar mínimo 3 integrantes (creador + 2 amigos)
    if (!member_ids || member_ids.length < 2)
        return res.status(400).json({ error: "El grupo debe tener al menos 3 integrantes (tú + 2 amigos)" });

    const client = await db.connect();
    try {
        await client.query("BEGIN");

        const groupResult = await client.query(
            "INSERT INTO groups (name, image_url, created_by) VALUES ($1,$2,$3) RETURNING *",
            [name, image_url || "👥", created_by]
        );
        const group = groupResult.rows[0];

        // Insertar creador + miembros
        const allMembers = [...new Set([parseInt(created_by), ...member_ids.map(Number)])];
        for (const uid of allMembers) {
            await client.query(
                "INSERT INTO group_members (group_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
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

/* PUT editar nombre/imagen de un grupo */
app.put("/groups/:groupId", async (req, res) => {
    const { name, image_url, user_id } = req.body;
    try {
        // Solo el creador puede editar
        const check = await db.query(
            "SELECT created_by FROM groups WHERE id=$1",
            [req.params.groupId]
        );
        if (!check.rows.length) return res.status(404).json({ error: "Grupo no encontrado" });
        if (check.rows[0].created_by != user_id)
            return res.status(403).json({ error: "Solo el creador puede editar el grupo" });

        const result = await db.query(
            "UPDATE groups SET name=$1, image_url=$2 WHERE id=$3 RETURNING *",
            [name, image_url, req.params.groupId]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json(err);
    }
});

/* ============================================================
   TAREAS DE GRUPO
   Tabla requerida en Supabase:

   CREATE TABLE tasks (
     id SERIAL PRIMARY KEY,
     group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
     title TEXT NOT NULL,
     description TEXT,
     points INTEGER DEFAULT 100,
     assigned_to INTEGER REFERENCES users(id),
     completed BOOLEAN DEFAULT FALSE,
     completed_at TIMESTAMPTZ,
     created_by INTEGER REFERENCES users(id),
     created_at TIMESTAMPTZ DEFAULT NOW()
   );
============================================================ */

/* GET tareas de un grupo */
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

/* GET todas las tareas de un usuario (en todos sus grupos) */
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

/* POST crear tarea */
app.post("/tasks", async (req, res) => {
    const { group_id, title, description, points, assigned_to, created_by } = req.body;
    try {
        const result = await db.query(
            `INSERT INTO tasks (group_id, title, description, points, assigned_to, created_by)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [group_id, title, description || "", points || 100, assigned_to || null, created_by]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json(err);
    }
});

/* PATCH completar tarea */
app.patch("/tasks/:taskId/complete", async (req, res) => {
    const { user_id } = req.body;
    try {
        const result = await db.query(
            `UPDATE tasks
             SET completed=TRUE, completed_at=NOW()
             WHERE id=$1 RETURNING *`,
            [req.params.taskId]
        );
        if (!result.rows.length)
            return res.status(404).json({ error: "Tarea no encontrada" });

        const task = result.rows[0];

        // Sumar puntos al usuario que completó
        await db.query(
            `UPDATE users SET points = COALESCE(points, 0) + $1 WHERE id=$2`,
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