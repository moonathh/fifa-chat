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
    // Forzar IPv4
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
app.use(express.json());

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
        socket.join(`chat_${chatId}`);
    });

    socket.on("send_message", async (data) => {
        const { chat_id, username, message } = data;

        try {
            await db.query(
                "INSERT INTO messages (chat_id, username, message) VALUES ($1,$2,$3)",
                [chat_id, username, message]
            );

            io.to(`chat_${chat_id}`).emit("new_message", {
                chat_id,
                username,
                message
            });

        } catch (err) {
            console.error(err);
        }
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
             JOIN friends f
             ON (u.id = f.user1_id OR u.id = f.user2_id)
             WHERE (f.user1_id=$1 OR f.user2_id=$1)
             AND u.id != $1`,
            [req.params.userId]
        );

        res.json(result.rows);
    } catch (err) {
        res.status(500).json(err);
    }
});


/* ======================
   FRIENDS POST
====================== */
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
   MESSAGES GET
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

/* ======================
   MESSAGES POST
====================== */
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

/* ======================
   SERVER
====================== */
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log("🚀 running on", PORT);
});