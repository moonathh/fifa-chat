const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const { Pool } = require("pg");

const app = express();
const server = http.createServer(app);

/* ======================
   🔌 POSTGRES (SUPABASE)
====================== */
const db = new Pool({
    connectionString: "postgresql://postgres:moonsunny2213@db.ktfojwoghksilundhyuh.supabase.co:5432/postgres",
    ssl: { rejectUnauthorized: false }
});

/* ======================
   🔌 SOCKET.IO
====================== */
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

db.connect()
    .then(() => console.log("✅ Conectado a Supabase (Postgres)"))
    .catch(err => console.error("❌ Error DB:", err));

/* ======================
   🧠 SOCKET REAL TIME
====================== */
io.on("connection", (socket) => {
    console.log("🟢 Usuario conectado:", socket.id);

    socket.on("join_chat", (chatId) => {
        socket.join(`chat_${chatId}`);
    });

    socket.on("send_message", async (data) => {
        const { chat_id, username, message } = data;

        try {
            await db.query(
                "INSERT INTO messages (chat_id, username, message) VALUES ($1, $2, $3)",
                [chat_id, username, message]
            );

            io.to(`chat_${chat_id}`).emit("new_message", {
                chat_id,
                username,
                message
            });

        } catch (err) {
            console.error("❌ Error guardando mensaje:", err);
        }
    });

    socket.on("disconnect", () => {
        console.log("🔴 Usuario desconectado:", socket.id);
    });
});

/* ======================
   🧾 REGISTER
====================== */
app.post("/register", async (req, res) => {
    const { full_name, email, password } = req.body;

    try {
        await db.query(
            "INSERT INTO users (full_name, email, password) VALUES ($1, $2, $3)",
            [full_name, email, password]
        );

        res.sendStatus(200);
    } catch (err) {
        res.status(500).json(err);
    }
});

/* ======================
   🔐 LOGIN
====================== */
app.post("/login", async (req, res) => {
    const { email, password } = req.body;

    try {
        const result = await db.query(
            "SELECT * FROM users WHERE email = $1 AND password = $2 LIMIT 1",
            [email, password]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: "Login incorrecto" });
        }

        res.json(result.rows[0]);

    } catch (err) {
        res.status(500).json(err);
    }
});

/* ======================
   👤 USER INFO
====================== */
app.get("/users/:id", async (req, res) => {
    try {
        const result = await db.query(
            "SELECT id, full_name, email FROM users WHERE id = $1",
            [req.params.id]
        );

        res.json(result.rows[0]);

    } catch (err) {
        res.status(500).json(err);
    }
});

/* ======================
   👬 FRIENDS
====================== */
app.get("/friends/:userId", async (req, res) => {
    const userId = req.params.userId;

    try {
        const result = await db.query(
            `SELECT u.id, u.full_name
             FROM users u
             JOIN friends f
             ON (u.id = f.user1_id OR u.id = f.user2_id)
             WHERE (f.user1_id = $1 OR f.user2_id = $1)
             AND u.id != $1`,
            [userId]
        );

        res.json(result.rows);

    } catch (err) {
        res.status(500).json(err);
    }
});

/* ======================
   💬 MESSAGES HISTORY
====================== */
app.get("/messages/:chat", async (req, res) => {
    try {
        const result = await db.query(
            "SELECT * FROM messages WHERE chat_id = $1 ORDER BY created_at ASC",
            [req.params.chat]
        );

        res.json(result.rows);

    } catch (err) {
        res.status(500).json(err);
    }
});

/* ======================
   🚀 START SERVER
====================== */
const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
    console.log("🚀 Servidor corriendo en puerto", PORT);
});