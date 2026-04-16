const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

/* ======================
   🔌 MYSQL CONNECTION
====================== */
const db = mysql.createConnection({
    host: "localhost",
    user: "chatuser",
    password: "1234",
    database: "fifa_chat"
});

db.connect(err => {
    if (err) {
        console.log("❌ Error conexión DB:", err);
    } else {
        console.log("✅ Conectado a MySQL");
    }
});

/* ======================
   🧠 SOCKET.IO (REAL TIME)
====================== */
io.on("connection", (socket) => {
    console.log("🟢 Usuario conectado:", socket.id);

    socket.on("join_chat", (chatId) => {
        socket.join(`chat_${chatId}`);
        console.log(`📥 Usuario unido al chat ${chatId}`);
    });

    socket.on("send_message", (data) => {
        const { chat_id, username, message } = data;

        // 1. guardar en DB
        db.query(
            "INSERT INTO messages (chat_id, username, message) VALUES (?, ?, ?)",
            [chat_id, username, message],
            (err) => {
                if (err) {
                    console.log("❌ Error guardando mensaje:", err);
                    return;
                }

                const fullMessage = {
                    chat_id,
                    username,
                    message
                };

                // 2. emitir a todos en el chat
                io.to(`chat_${chat_id}`).emit("new_message", fullMessage);
            }
        );
    });

    socket.on("disconnect", () => {
        console.log("🔴 Usuario desconectado:", socket.id);
    });
});

/* ======================
   🧾 REGISTER
====================== */
app.post("/register", (req, res) => {
    const { full_name, email, password } = req.body;

    db.query(
        "INSERT INTO users (full_name, email, password) VALUES (?, ?, ?)",
        [full_name, email, password],
        (err) => {
            if (err) return res.status(500).json(err);
            res.sendStatus(200);
        }
    );
});

/* ======================
   🔐 LOGIN
====================== */
app.post("/login", (req, res) => {
    const { email, password } = req.body;

    db.query(
        "SELECT * FROM users WHERE email = ? AND password = ? LIMIT 1",
        [email, password],
        (err, results) => {
            if (err) return res.status(500).json(err);
            if (results.length === 0) return res.status(401).json({ error: "Login incorrecto" });

            res.json(results[0]);
        }
    );
});

/* ======================
   👥 USERS
====================== */
app.get("/users/:id", (req, res) => {
    db.query(
        "SELECT id, full_name, email FROM users WHERE id = ?",
        [req.params.id],
        (err, results) => {
            if (err) return res.status(500).json(err);
            res.json(results[0]);
        }
    );
});

/* ======================
   👬 FRIENDS
====================== */
app.get("/friends/:userId", (req, res) => {
    const userId = req.params.userId;

    db.query(
        `SELECT u.id, u.full_name
         FROM users u
         JOIN friends f
         ON (u.id = f.user1_id OR u.id = f.user2_id)
         WHERE (f.user1_id = ? OR f.user2_id = ?) AND u.id != ?`,
        [userId, userId, userId],
        (err, results) => {
            if (err) return res.status(500).json(err);
            res.json(results);
        }
    );
});

/* ======================
   💬 LOAD MESSAGES (history)
====================== */
app.get("/messages/:chat", (req, res) => {
    db.query(
        "SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC",
        [req.params.chat],
        (err, results) => {
            if (err) return res.status(500).json(err);
            res.json(results);
        }
    );
});

/* ======================
   🚀 SERVER START
====================== */
server.listen(3000, "0.0.0.0", () => {
    console.log("Servidor activo en red");
});