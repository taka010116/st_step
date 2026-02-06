const GOAL = 12;
const CHOICES = [1, 3, 5];
const MAX_PLAYERS = 4;


const MAX_ROUNDS = 3;


export class MyDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;

    this.players = []; // { name, ws, pos, choice, isCPU, rematch }
    this.started = false;
    this.requiredPlayers = null;
  }

  fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("WebSocket only", { status: 400 });
    }

    const url = new URL(request.url);
    const name = url.searchParams.get("name");
    const requested = Number(url.searchParams.get("players") || MAX_PLAYERS);

    if (!name) {
      return new Response("name required", { status: 400 });
    }

    if (!this.requiredPlayers) {
      this.requiredPlayers = requested;
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    const player = {
      name,
      ws: server,
      pos: 0,
      choice: null,
      isCPU: false,
      rematch: false
    };

    this.players.push(player);
    this.broadcastWaiting();

    server.addEventListener("message", e => {
      const msg = JSON.parse(e.data);

      if (msg.type === "choice" && this.started) {
        if (CHOICES.includes(msg.value)) {
          player.choice = msg.value;
          this.resolveTurn();
        }
      }

      if (msg.type === "rematch") {
        player.rematch = true;
        this.checkRematch();
      }
    });

    server.addEventListener("close", () => {
      this.players = this.players.filter(p => p !== player);
      this.started = false;
      this.broadcastWaiting();
    });

    if (!this.started && this.players.length === this.requiredPlayers) {
      this.addCPUs();
      this.startGame();
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  addCPUs() {
    const cpuCount = MAX_PLAYERS - this.players.length;
    for (let i = 0; i < cpuCount; i++) {
      this.players.push({
        name: `CPU${i + 1}`,
        ws: null,
        pos: 0,
        choice: null,
        isCPU: true,
        rematch: true // CPUは常にOK
      });
    }
  }

  startGame() {
    this.started = true;
    this.players.forEach(p => {
      p.pos = 0;
      p.choice = null;
      p.rematch = p.isCPU ? true : false;
    });

    this.broadcast({
      type: "start",
      players: this.players.map(p => ({
        name: p.name,
        isCPU: p.isCPU
      }))
    });
  }

  resolveTurn() {
    // CPUの自動選択
    this.players.forEach(p => {
      if (p.isCPU && p.choice === null) {
        p.choice = CHOICES[Math.floor(Math.random() * CHOICES.length)];
      }
    });

    if (this.players.some(p => p.choice === null)) return;

    const count = {};
    this.players.forEach(p => {
      count[p.choice] = (count[p.choice] || 0) + 1;
    });

    this.players.forEach(p => {
      if (count[p.choice] === 1) {
        p.pos += p.choice;
        if (p.pos > GOAL) p.pos = GOAL;
      }
    });

    // 勝利判定
    const finished = this.players.some(p => p.pos >= GOAL);

    if (finished) {
      this.finishGame();
      return;
    }

    this.broadcastState(false, null);
    this.players.forEach(p => (p.choice = null));
  }

  finishGame() {
    this.started = false;

    const ranking = [...this.players]
      .sort((a, b) => b.pos - a.pos)
      .map((p, i) => ({
        rank: i + 1,
        name: p.name,
        pos: p.pos,
        isCPU: p.isCPU
      }));

    this.broadcast({
      type: "finish",
      ranking
    });
  }

  checkRematch() {
    const humans = this.players.filter(p => !p.isCPU);
    if (humans.every(p => p.rematch)) {
      this.startGame();
    }
  }

  broadcastWaiting() {
    this.broadcast({
      type: "waiting",
      count: this.players.length,
      required: this.requiredPlayers
    });
  }

  broadcastState(finished, ranking) {
    this.broadcast({
      type: "state",
      players: this.players.map(p => ({
        name: p.name,
        pos: p.pos,
        isCPU: p.isCPU
      }))
    });
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    this.players.forEach(p => {
      if (p.ws) p.ws.send(data);
    });
  }
}

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/room/")) {
      const roomId = url.pathname.split("/")[2];
      const id = env.MY_DO.idFromName(roomId);
      return env.MY_DO.get(id).fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};
