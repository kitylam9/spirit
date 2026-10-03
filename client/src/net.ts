import type { ClientMessage, ServerMessage } from "@spirit/shared";

const PLAYER_KEY = "spirit.playerId";

/** WebSocket connection to the game server with automatic reconnect. */
export class Net {
  private ws: WebSocket | null = null;
  private retry = 0;
  connected = false;

  constructor(
    private onMessage: (m: ServerMessage) => void,
    private onConnection: (connected: boolean) => void,
  ) {}

  connect(): void {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.connected = true;
      this.onConnection(true);
      this.send({ type: "hello", playerId: localStorage.getItem(PLAYER_KEY) ?? undefined });
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data as string) as ServerMessage;
      if (m.type === "welcome") localStorage.setItem(PLAYER_KEY, m.player.id);
      this.onMessage(m);
    };
    ws.onclose = () => {
      this.connected = false;
      this.onConnection(false);
      setTimeout(() => this.connect(), Math.min(5000, 500 * 2 ** this.retry++));
    };
  }

  send(m: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
}
