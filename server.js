const path = require("path");
const http = require("http");
const express = require("express");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const { initDatabase } = require("./db/init");
const { JWT_SECRET } = require("./middleware/auth");
const authRoutes = require("./routes/auth");
const notificationRoutes = require("./routes/notifications");
const onlineUserRoutes = require("./routes/online-users");
const requestRoutes = require("./routes/requests");
const systemLogRoutes = require("./routes/system-logs");
const userRoutes = require("./routes/users");
const {
  listOnlineUsers,
  connectOnlineUser,
  disconnectOnlineUser,
} = require("./utils/online-users");

const app = express();
const PORT = process.env.PORT || 27463;
const server = http.createServer(app);
const io = new Server(server);
const ONLINE_WATCHERS_ROOM = "online_watchers";

function canWatchOnlineUsers(user) {
  if (!user) return false;
  return user.role === "admin" || user.role === "manager";
}

function extractSocketToken(socket) {
  const authToken =
    socket &&
    socket.handshake &&
    socket.handshake.auth &&
    typeof socket.handshake.auth.token === "string"
      ? socket.handshake.auth.token.trim()
      : "";

  if (authToken) {
    return authToken;
  }

  const headerAuth =
    socket &&
    socket.handshake &&
    socket.handshake.headers &&
    typeof socket.handshake.headers.authorization === "string"
      ? socket.handshake.headers.authorization.trim()
      : "";

  if (headerAuth.startsWith("Bearer ")) {
    return headerAuth.slice(7).trim();
  }

  return "";
}

function emitOnlineEvent(eventName, user) {
  io.to(ONLINE_WATCHERS_ROOM).emit(eventName, {
    user,
    onlineUsers: listOnlineUsers(),
    created_at: new Date().toISOString(),
  });
}

io.use((socket, next) => {
  const token = extractSocketToken(socket);
  if (!token) {
    next(new Error("Token gerekli."));
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (error) {
    next(new Error("Geçersiz token."));
  }
});

io.on("connection", (socket) => {
  const connected = connectOnlineUser(socket.user, socket.id);
  const canWatch = canWatchOnlineUsers(socket.user);

  if (canWatch) {
    socket.join(ONLINE_WATCHERS_ROOM);
    if (!connected.wasOffline) {
      socket.emit("user_connected", {
        user: connected.user,
        onlineUsers: listOnlineUsers(),
        created_at: new Date().toISOString(),
      });
    }
  }

  if (connected.wasOffline && connected.user) {
    emitOnlineEvent("user_connected", connected.user);
  }

  socket.on("disconnect", () => {
    const disconnected = disconnectOnlineUser(socket.user && socket.user.id, socket.id);
    if (disconnected.wentOffline && disconnected.user) {
      emitOnlineEvent("user_disconnected", disconnected.user);
    }
  });
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use("/api/auth", authRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/online-users", onlineUserRoutes);
app.use("/api/requests", requestRoutes);
app.use("/api/system-logs", systemLogRoutes);
app.use("/api/users", userRoutes);

app.get("/", (req, res) => {
  res
    .status(200)
    .type("html")
    .send(`<!doctype html>
<html lang="tr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Yönlendiriliyor</title>
  </head>
  <body>
    <script>
      (function () {
        const token = String(localStorage.getItem("demo_token") || "").trim();
        const rawUser = localStorage.getItem("demo_user");

        if (!token || !rawUser) {
          window.location.replace("/login");
          return;
        }

        try {
          const user = JSON.parse(rawUser);
          if (!user || typeof user !== "object" || !user.id || !user.role) {
            throw new Error("invalid-user");
          }
          window.location.replace("/dashboard");
        } catch (error) {
          localStorage.removeItem("demo_token");
          localStorage.removeItem("demo_user");
          window.location.replace("/login");
        }
      })();
    </script>
  </body>
</html>`);
});

const pageMap = {
  "/login": "login.html",
  "/dashboard": "dashboard.html",
  "/create-request": "create-request.html",
  "/my-requests": "my-requests.html",
  "/request-detail": "request-detail.html",
  "/admin-panel": "admin-panel.html",
  "/users": "users.html",
};

for (const [route, file] of Object.entries(pageMap)) {
  app.get(route, (req, res) => {
    res.sendFile(path.join(__dirname, "public", file));
  });
}

app.use((req, res) => {
  res.status(404).json({ message: "Uç nokta bulunamadı." });
});

app.use((err, req, res, next) => {
  res.status(500).json({ message: "Sunucu hatası." });
});

initDatabase()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Server çalışıyor: http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Veritabanı başlatılamadı:", error);
    process.exit(1);
  });
