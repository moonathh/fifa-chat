// ==============================
// backend/server.js (COMPLETO)
// ==============================
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const { Pool } = require("pg");

const app = express();
const server = http.createServer(app);

const db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    family: 4
});

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "PATCH"]
    }
});

app.use(cors());
app.use(express.json({ limit: "5mb" }));

db.query("SELECT NOW()")
.then(() => console.log("✅ DB conectada"))
.catch(err => console.log(err));

/* ======================================
   SOCKET.IO
====================================== */
io.on("connection", (socket) => {
    console.log("🟢 conectado:", socket.id);

    socket.on("join_chat", (chatId) => {
        socket.join(`chat_${String(chatId).trim()}`);
        console.log("joined:", `chat_${chatId}`);
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

            await db.query(
                `INSERT INTO messages (chat_id, username, message)
                 VALUES ($1,$2,$3)`,
                [chat_id, username, message]
            );

            io.to(`chat_${chat_id}`).emit("new_message", {
                chat_id,
                username,
                message
            });

        } catch (err) {
            console.log(err);
        }
    });

    socket.on("task_created", (data) => {
        io.to(`chat_${data.group_id}`).emit("new_task", data.task);
    });

    socket.on("disconnect", () => {
        console.log("🔴 desconectado");
    });
});

/* ======================================
   LOGIN
====================================== */
app.post("/login", async (req, res) => {
    const { email, password } = req.body;

    try {
        const result = await db.query(
            `SELECT * FROM users
             WHERE email=$1 AND password=$2
             LIMIT 1`,
            [email, password]
        );

        if (!result.rows.length) {
            return res.status(401).json({ error: "Login incorrecto" });
        }

        res.json(result.rows[0]);

    } catch (err) {
        res.status(500).json(err);
    }
});

/* ======================================
   FRIENDS
====================================== */
app.get("/friends/:userId", async (req, res) => {
    try {
        const result = await db.query(`
            SELECT u.id, u.full_name
            FROM users u
            JOIN friends f
              ON (u.id = f.user1_id OR u.id = f.user2_id)
            WHERE (f.user1_id=$1 OR f.user2_id=$1)
              AND u.id != $1
        `, [req.params.userId]);

        res.json(result.rows);

    } catch (err) {
        res.status(500).json(err);
    }
});

/* ======================================
   MENSAJES
====================================== */
app.get("/messages/:chat", async (req, res) => {
    try {
        const chat = String(req.params.chat).trim();

        const result = await db.query(
            `SELECT *
             FROM messages
             WHERE TRIM(chat_id) = $1
             ORDER BY created_at ASC`,
            [chat]
        );

        res.json(result.rows);

    } catch (err) {
        res.status(500).json(err);
    }
});

/* ======================================
   GROUPS
====================================== */
app.get("/groups/:userId", async (req, res) => {
    try {
        const result = await db.query(`
            SELECT g.id, g.name, g.image_url, g.created_by,
                   COUNT(gm2.user_id) AS member_count
            FROM groups g
            JOIN group_members gm ON gm.group_id = g.id
            LEFT JOIN group_members gm2 ON gm2.group_id = g.id
            WHERE gm.user_id = $1
            GROUP BY g.id
            ORDER BY g.created_at DESC
        `, [req.params.userId]);

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
            `INSERT INTO groups(name,image_url,created_by)
             VALUES($1,$2,$3)
             RETURNING *`,
            [name, image_url, created_by]
        );

        const group = groupResult.rows[0];

        const allMembers = [
            ...new Set([
                Number(created_by),
                ...member_ids.map(Number)
            ])
        ];

        for (const uid of allMembers) {
            await client.query(
                `INSERT INTO group_members(group_id,user_id)
                 VALUES($1,$2)
                 ON CONFLICT DO NOTHING`,
                [group.id, uid]
            );
        }

        await client.query("COMMIT");

        res.json({
            ...group,
            member_ids: allMembers
        });

    } catch (err) {
        await client.query("ROLLBACK");
        res.status(500).json(err);
    } finally {
        client.release();
    }
});

/* ======================================
   TASKS
====================================== */
app.get("/tasks/:groupId", async (req, res) => {
    try {
        const result = await db.query(`
            SELECT t.*, u.full_name AS assigned_name
            FROM tasks t
            LEFT JOIN users u ON u.id=t.assigned_to
            WHERE t.group_id=$1
            ORDER BY t.created_at DESC
        `, [req.params.groupId]);

        res.json(result.rows);

    } catch (err) {
        res.status(500).json(err);
    }
});

app.post("/tasks", async (req, res) => {
    const {
        group_id,
        title,
        description,
        points,
        assigned_to,
        created_by
    } = req.body;

    try {
        const result = await db.query(`
            INSERT INTO tasks
            (group_id,title,description,points,assigned_to,created_by)
            VALUES($1,$2,$3,$4,$5,$6)
            RETURNING *
        `, [
            group_id,
            title,
            description,
            points,
            assigned_to || null,
            created_by
        ]);

        res.json(result.rows[0]);

    } catch (err) {
        res.status(500).json(err);
    }
});

/* ======================================
   START
====================================== */
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log("🚀 running on", PORT);
});