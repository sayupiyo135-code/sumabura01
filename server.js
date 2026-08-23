const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

// 🔐 GitHubには秘密コードを書かない
// RenderのEnvironment Variablesに ADMIN_CODE=3487 を設定する
const ADMIN_CODE = process.env.ADMIN_CODE || "";

const rooms = new Map();

const CHARACTERS = {
  Blaze: { name: "🔥 ブレイズ", admin: false },
  Storm: { name: "⚡ ストーム", admin: false },
  Rock: { name: "🪨 ロック", admin: false },
  Shadow: { name: "🌑 シャドウ", admin: false },
  Wing: { name: "🪽 ウィング", admin: false },

  Neon: { name: "👑 ネオン", admin: true },
  Destroyer: { name: "💀 デストロイヤー", admin: true },
  Zero: { name: "🌌 ゼロ", admin: true },
  Glitch: { name: "☠️ グリッチ", admin: true },
  Dragon: { name: "🐉 ドラゴン", admin: true }
};

function validCharacter(id, unlocked) {
  const c = CHARACTERS[id];
  return c && (!c.admin || unlocked);
}

function makePlayer(socketId, slot, char) {
  return {
    socketId,
    slot,
    char,
    x: slot === 0 ? 360 : 690,
    y: 250,
    vx: 0,
    vy: 0,
    damage: 0,
    stocks: 3,
    invincible: 90,
    attackCooldown: 0,
    lastHitAt: 0,
    connected: true
  };
}

function publicState(room) {
  return {
    phase: room.phase,
    stage: room.stage,
    adminUnlocked: room.adminUnlocked,
    roomId: room.id,
    winner: room.winner,

    players: room.players.map(p => ({
      slot: p.slot,
      char: p.char,
      x: p.x,
      y: p.y,
      damage: Math.floor(p.damage),
      stocks: p.stocks,
      invincible: p.invincible > 0,
      connected: p.connected
    }))
  };
}

function resetPlayer(p) {
  p.x = p.slot === 0 ? 360 : 690;
  p.y = 250;
  p.vx = 0;
  p.vy = 0;
  p.damage = 0;
  p.invincible = 90;
  p.attackCooldown = 0;
  p.lastHitAt = 0;
}

function attack(room, p, type) {
  if (room.phase !== "battle" || p.attackCooldown > 0) return;

  p.attackCooldown = type === "attack" ? 220 : 420;

  const target = room.players.find(
    q => q !== p && q.connected
  );

  if (!target || target.invincible > 0) return;

  const admin = CHARACTERS[p.char].admin;

  const baseDamage = {
    attack: 7,
    special1: 10,
    special2: 12,
    special3: 16
  }[type] || 7;

  const range = {
    attack: 72,
    special1: 105,
    special2: 90,
    special3: 125
  }[type] || 72;

  if (
    Math.abs(target.x - p.x) <= range &&
    Math.abs(target.y - p.y) <= 90 &&
    Date.now() - target.lastHitAt > 180
  ) {
    const direction = target.x >= p.x ? 1 : -1;

    target.damage = Math.min(
      999,
      target.damage + baseDamage * (admin ? 1.12 : 1)
    );

    const knockback =
      (type === "attack"
        ? 7
        : type === "special1"
        ? 8
        : type === "special2"
        ? 9
        : 11) +
      target.damage * 0.055;

    target.vx = direction * knockback;
    target.vy = -(6 + target.damage * 0.018);
    target.lastHitAt = Date.now();
  }
}

function tick(room) {
  if (room.phase !== "battle") return;

  for (const p of room.players) {
    if (!p.connected) continue;

    p.attackCooldown = Math.max(
      0,
      p.attackCooldown - 33
    );

    p.invincible = Math.max(
      0,
      p.invincible - 1
    );

    p.vy += 0.62;
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.88;

    if (
      p.y + 70 >= 500 &&
      p.y + 70 <= 540 &&
      p.vy >= 0
    ) {
      p.y = 430;
      p.vy = 0;
    }

    // 場外
    if (
      p.x < -120 ||
      p.x > 1120 ||
      p.y > 730
    ) {
      p.stocks--;

      if (p.stocks <= 0) {
        room.phase = "result";

        const winner =
          room.players.find(q => q !== p);

        room.winner = winner
          ? winner.slot
          : 0;
      } else {
        resetPlayer(p);
      }
    }
  }

  io.to(room.id).emit(
    "state",
    publicState(room)
  );
}

setInterval(() => {
  rooms.forEach(tick);
}, 33);

io.on("connection", socket => {

  // 🔐 管理者コード確認
  // 本当の3487はRenderの環境変数にだけ存在
  socket.on("adminUnlock", data => {

    const entered =
      String(data?.code || "");

    const success =
      Boolean(ADMIN_CODE) &&
      entered === ADMIN_CODE;

    socket.emit("adminResult", {
      ok: success
    });
  });

  // ルーム作成
  socket.on("createRoom", data => {

    const id =
      Math.random()
        .toString(36)
        .slice(2, 8)
        .toUpperCase();

    const adminUnlocked =
      data.adminCode === ADMIN_CODE;

    const char =
      validCharacter(
        data.character,
        adminUnlocked
      )
        ? data.character
        : "Blaze";

    const room = {
      id,
      stage: data.stage || "Sky Island",
      adminUnlocked,
      phase: "lobby",
      players: [],
      winner: null
    };

    room.players.push(
      makePlayer(
        socket.id,
        0,
        char
      )
    );

    rooms.set(id, room);

    socket.join(id);

    socket.emit("roomCreated", {
      id,
      adminUnlocked
    });

    io.to(id).emit(
      "state",
      publicState(room)
    );
  });

  // ルーム参加
  socket.on("joinRoom", data => {

    const room =
      rooms.get(
        String(data.id || "")
          .toUpperCase()
      );

    if (!room) {
      return socket.emit(
        "errorMsg",
        "そのルームはありません"
      );
    }

    if (room.players.length >= 2) {
      return socket.emit(
        "errorMsg",
        "ルームは満員です"
      );
    }

    const char =
      validCharacter(
        data.character,
        room.adminUnlocked
      )
        ? data.character
        : "Blaze";

    room.players.push(
      makePlayer(
        socket.id,
        1,
        char
      )
    );

    socket.join(room.id);

    room.phase = "battle";

    io.to(room.id).emit(
      "state",
      publicState(room)
    );
  });

  // 操作
  socket.on("input", data => {

    for (const room of rooms.values()) {

      const p =
        room.players.find(
          q => q.socketId === socket.id
        );

      if (!p || room.phase !== "battle") {
        continue;
      }

      if (data.action === "left") {
        p.vx = Math.max(
          -7,
          p.vx - 0.9
        );
      }

      if (data.action === "right") {
        p.vx = Math.min(
          7,
          p.vx + 0.9
        );
      }

      if (
        data.action === "jump" &&
        p.y >= 390
      ) {
        p.vy = -13;
      }

      if (
        [
          "attack",
          "special1",
          "special2",
          "special3"
        ].includes(data.action)
      ) {
        attack(
          room,
          p,
          data.action
        );
      }

      break;
    }
  });

  // 再戦
  socket.on("restart", () => {

    for (const room of rooms.values()) {

      if (
        !room.players.some(
          p => p.socketId === socket.id
        )
      ) {
        continue;
      }

      room.phase =
        room.players.length === 2
          ? "battle"
          : "lobby";

      room.winner = null;

      room.players.forEach(p => {
        p.stocks = 3;
        resetPlayer(p);
      });

      io.to(room.id).emit(
        "state",
        publicState(room)
      );

      break;
    }
  });

  // 切断
  socket.on("disconnect", () => {

    for (const [id, room] of rooms) {

      const p =
        room.players.find(
          q => q.socketId === socket.id
        );

      if (p) {
        p.connected = false;

        io.to(id).emit(
          "state",
          publicState(room)
        );

        break;
      }
    }
  });
});

server.listen(
  PORT,
  () => {
    console.log(
      `Arena server listening on ${PORT}`
    );
  }
);
