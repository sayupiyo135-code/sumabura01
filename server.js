const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const ADMIN_CODE = "3487";

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

function createPlayer(socketId, slot, character) {
  return {
    socketId,
    slot,
    character,
    x: slot === 0 ? 360 : 690,
    y: 250,
    vx: 0,
    vy: 0,
    damage: 0,
    stocks: 3,
    invincible: 90,
    attackCooldown: 0,
    lastHitTime: 0,
    connected: true
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
  p.lastHitTime = 0;
}

function publicState(room) {
  return {
    roomId: room.id,
    phase: room.phase,
    stage: room.stage,
    adminUnlocked: room.adminUnlocked,
    winner: room.winner,
    players: room.players.map(p => ({
      slot: p.slot,
      character: p.character,
      x: p.x,
      y: p.y,
      damage: Math.floor(p.damage),
      stocks: p.stocks,
      invincible: p.invincible > 0,
      connected: p.connected
    }))
  };
}

function attack(room, player, type) {
  if (room.phase !== "battle") return;
  if (player.attackCooldown > 0) return;

  const target = room.players.find(
    p => p !== player && p.connected
  );

  if (!target || target.invincible > 0) return;

  let damage = 7;
  let range = 72;
  let knockback = 7;

  if (type === "special1") {
    damage = 10;
    range = 105;
    knockback = 8;
  }

  if (type === "special2") {
    damage = 12;
    range = 90;
    knockback = 9;
  }

  if (type === "special3") {
    damage = 16;
    range = 125;
    knockback = 11;
  }

  if (CHARACTERS[player.character].admin) {
    damage *= 1.12;
  }

  player.attackCooldown =
    type === "attack" ? 220 : 420;

  if (
    Math.abs(target.x - player.x) <= range &&
    Math.abs(target.y - player.y) <= 90 &&
    Date.now() - target.lastHitTime > 180
  ) {
    const direction =
      target.x >= player.x ? 1 : -1;

    target.damage += damage;

    const kb =
      knockback + target.damage * 0.055;

    target.vx = direction * kb;
    target.vy = -(6 + target.damage * 0.018);

    target.lastHitTime = Date.now();
  }
}

function updateRoom(room) {
  if (room.phase !== "battle") return;

  for (const p of room.players) {
    if (!p.connected) continue;

    p.attackCooldown =
      Math.max(0, p.attackCooldown - 33);

    p.invincible =
      Math.max(0, p.invincible - 1);

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

    if (
      p.x < -120 ||
      p.x > 1120 ||
      p.y > 730
    ) {
      p.stocks--;

      if (p.stocks <= 0) {
        room.phase = "result";

        const winner =
          room.players.find(
            other => other !== p
          );

        room.winner =
          winner ? winner.slot : 0;
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
  for (const room of rooms.values()) {
    updateRoom(room);
  }
}, 33);

io.on("connection", socket => {

  socket.on("createRoom", data => {

    const id =
      Math.random()
        .toString(36)
        .slice(2, 8)
        .toUpperCase();

    const unlocked =
      data.adminCode === ADMIN_CODE;

    const character =
      validCharacter(
        data.character,
        unlocked
      )
        ? data.character
        : "Blaze";

    const room = {
      id,
      stage: data.stage || "Sky Island",
      adminUnlocked: unlocked,
      phase: "lobby",
      players: [],
      winner: null
    };

    room.players.push(
      createPlayer(
        socket.id,
        0,
        character
      )
    );

    rooms.set(id, room);

    socket.join(id);

    socket.emit(
      "roomCreated",
      {
        id,
        adminUnlocked: unlocked
      }
    );

    io.to(id).emit(
      "state",
      publicState(room)
    );
  });

  socket.on("joinRoom", data => {

    const id =
      String(data.id || "")
        .toUpperCase();

    const room = rooms.get(id);

    if (!room) {
      socket.emit(
        "errorMsg",
        "そのルームはありません"
      );
      return;
    }

    if (room.players.length >= 2) {
      socket.emit(
        "errorMsg",
        "ルームは満員です"
      );
      return;
    }

    const character =
      validCharacter(
        data.character,
        room.adminUnlocked
      )
        ? data.character
        : "Blaze";

    room.players.push(
      createPlayer(
        socket.id,
        1,
        character
      )
    );

    socket.join(id);

    room.phase = "battle";

    io.to(id).emit(
      "state",
      publicState(room)
    );
  });

  socket.on("input", data => {

    for (const room of rooms.values()) {

      const player =
        room.players.find(
          p => p.socketId === socket.id
        );

      if (!player) continue;
      if (room.phase !== "battle") continue;

      if (data.action === "left") {
        player.vx =
          Math.max(
            -7,
            player.vx - 0.9
          );
      }

      if (data.action === "right") {
        player.vx =
          Math.min(
            7,
            player.vx + 0.9
          );
      }

      if (
        data.action === "jump" &&
        player.y >= 390
      ) {
        player.vy = -13;
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
          player,
          data.action
        );
      }

      break;
    }
  });

  socket.on("restart", () => {

    for (const room of rooms.values()) {

      const found =
        room.players.some(
          p => p.socketId === socket.id
        );

      if (!found) continue;

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

  socket.on("disconnect", () => {

    for (const room of rooms.values()) {

      const player =
        room.players.find(
          p => p.socketId === socket.id
        );

      if (!player) continue;

      player.connected = false;

      io.to(room.id).emit(
        "state",
        publicState(room)
      );

      break;
    }
  });
});

server.listen(PORT, () => {
  console.log(
    `Arena server running on port ${PORT}`
  );
});
