import typia from "typia";
import {
    //@ts-expect-error this is fine
    type Stats,
    type Average,
    type Counter,
    STATS_SERVER_PORT,
    type Stat,
    sendMessage,
    updatePlayer,
    Player,
    Hello,
    type Timer,
    PlayerLeft,
    PlayerJoined,
    PlayerMoving,
    PlayerMoveRequest,
    PLAYER_SIZE,
    SERVER_PORT,
    WORLD_WIDTH,
    WORLD_HEIGHT,
    type Vector2,
    type C2SEvent,
    type MoveDirection,
} from "./common";
import type { ServerWebSocket } from "bun";
import { debug, Try } from "@/lib/utils";
import http from "node:http";

const SERVER_TPS = 30;
const PLAYER_LIMIT = 69;

namespace Stats {
    export const AVERAGE_CAPACITY = 30;
    const STATS_FEED_INTERVAL_MS = 2000;
    const stats: Stats = {};

    export const server = http
        .createServer((req, res) => {
            console.log(
                "New client connected to stats server.",
                req.headers["user-agent"],
            );
            res.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Access-Control-Allow-Origin": "*",
                Connection: "keep-alive",
            });
            const timer = setInterval(() => {
                const msg = `data:${JSON.stringify(stats)} \n\n`;
                res.write(msg);
            }, STATS_FEED_INTERVAL_MS);
            req.on("close", () => clearInterval(timer));
        })
        .listen(STATS_SERVER_PORT, undefined, undefined, () =>
            console.log(
                "Stats feed listening to http://0.0.0.0:" + STATS_SERVER_PORT,
            ),
        );

    function getStat(stat: Stat): number {
        switch (stat.kind) {
            case "counter":
                return stat.counter;
            case "average":
                return average(stat.samples);
            case "timer":
                return performance.now() - stat.startedAt;
        }
    }

    function register<T extends Stat>(name: string, stat: T): T {
        stats[name] = stat;
        return stat;
    }

    export function print() {
        console.log("Stats:");
        for (const key in stats) {
            console.log(`  ${stats[key].description}`, getStat(stats[key]));
        }
    }

    // TODO: keeping the AVERAGE_CAPACITY checked relies on calling Stats.print() periodically.
    //   It would be better to go back to having a custom method for pushing samples
    function average(xs: Array<number>): number {
        while (xs.length > AVERAGE_CAPACITY) xs.shift();
        return xs.reduce((a, b) => a + b, 0) / xs.length;
    }

    export const uptime: Timer = register("uptime", {
        kind: "timer",
        startedAt: 0,
        description: "Uptime (secs)",
    });
    export const ticksCount: Counter = register("ticksCount", {
        kind: "counter",
        counter: 0,
        description: "Ticks count",
    });
    export const tickTimes: Average = register("tickTimes", {
        kind: "average",
        samples: [],
        description: "Average time to process a tick",
    });
    export const messagesSent: Counter = register("messagesSent", {
        kind: "counter",
        counter: 0,
        description: "Total messages sent",
    });
    export const messagesReceived: Counter = register("messagesReceived", {
        kind: "counter",
        counter: 0,
        description: "Total messages received",
    });
    export const tickMessagesSent: Average = register("tickMessagesSent", {
        kind: "average",
        samples: [],
        description: "Average messages sent per tick",
    });
    export const tickMessagesReceived: Average = register(
        "tickMessagesReceived",
        {
            kind: "average",
            samples: [],
            description: "Average messages received per tick",
        },
    );
    export const bytesSent: Counter = register("bytesSent", {
        kind: "counter",
        counter: 0,
        description: "Total bytes sent",
    });
    export const bytesReceived: Counter = register("bytesReceived", {
        kind: "counter",
        counter: 0,
        description: "Total bytes received",
    });
    export const tickByteSent: Average = register("tickByteSent", {
        kind: "average",
        samples: [],
        description: "Average bytes sent per tick",
    });
    export const tickByteReceived: Average = register("tickByteReceived", {
        kind: "average",
        samples: [],
        description: "Average bytes received per tick",
    });
    export const playersCurrently: Counter = register("playersCurrently", {
        kind: "counter",
        counter: 0,
        description: "Currently players",
    });
    export const playersJoined: Counter = register("playersJoined", {
        kind: "counter",
        counter: 0,
        description: "Total players joined",
    });
    export const playersLeft: Counter = register("playersLeft", {
        kind: "counter",
        counter: 0,
        description: "Total players left",
    });
    export const invalidMessages: Counter = register("invalidMessages", {
        kind: "counter",
        counter: 0,
        description: "Total invalid messages",
    });
    export const playersRejected: Counter = register("playersRejected", {
        kind: "counter",
        counter: 0,
        description: "Total players rejected",
    });
}

class ServerPlayer extends Player {
    socket: ServerWebSocket<{ id: number }>;
    constructor(
        id: number,
        pos: Vector2,
        color: string,
        socket: ServerWebSocket<{ id: number }>,
    ) {
        super(id, pos, color);
        this.socket = socket;
    }
}

let idCount = 0;
let bytesReceivedWithinTick = 0;
const players = new Map<number, ServerPlayer>();
const eventQueue = new Set<C2SEvent>();
const joinedIds = new Set<number>();
const leftIds = new Set<number>();

function randomStyle(): string {
    return `hsl(${Math.floor(Math.random() * 360)} 80% 50%)`;
}

const wss = Bun.serve<{ id: number }>({
    port: SERVER_PORT,
    fetch(req, server) {
        const data = {};
        const success = server.upgrade(req, { data });
        if (success) {
            return;
        }

        return new Response();
    },
    websocket: {
        open(socket) {
            if (players.size >= PLAYER_LIMIT) {
                socket.close();
                return;
            }
            const id = idCount++;
            socket.data.id = id;
            const x = Math.random() * (WORLD_WIDTH - PLAYER_SIZE);
            const y = Math.random() * (WORLD_HEIGHT - PLAYER_SIZE);
            const style = randomStyle();
            const player = new ServerPlayer(id, { x, y }, style, socket);
            players.set(id, player);
            debug(`Player ${id} connected`);
            //prettier-ignore
            eventQueue.add({
                kind: "PlayerJoined",
                id, x, y, style
            });
            Stats.playersJoined.counter++;
        },
        message(socket, rawMsg) {
            const msgLength = rawMsg.toString().length;
            Stats.messagesReceived.counter++;
            Stats.bytesReceived.counter += msgLength;
            bytesReceivedWithinTick += msgLength;

            const message = Try(() => JSON.parse(rawMsg.toString()));
            if (!message.ok) {
                Stats.invalidMessages.counter++;
                debug("Invalid message received", message.error);
                socket.close();
                return;
            }
            delete message.ok;

            const player = players.get(socket.data.id);
            if (!player) {
                Stats.invalidMessages.counter++;
                debug(
                    `The player ${socket.data.id} is not found and is being disconnected`,
                );
                socket.close();
                return;
            }

            if (PlayerMoveRequest.is(message)) {
                debug(`Received message from player ${player.id}`, message);
                eventQueue.add({
                    kind: "PlayerMoving",
                    id: player.id,
                    x: player.x,
                    y: player.y,
                    start: message.start,
                    direction: message.direction,
                });
            } else {
                Stats.invalidMessages.counter++;
                debug(
                    `Received invalid message from player ${player.id}`,
                    message,
                );
                socket.close();
                return;
            }
        },
        close(socket) {
            Stats.playersLeft.counter++;
            debug(`Player ${socket.data.id} disconnected`);
            players.delete(socket.data.id);
            eventQueue.add({
                kind: "PlayerLeft",
                id: socket.data.id,
            });
        },
    },
});

console.log("WebSocketServer listening on: ws://localhost:" + wss.port);

let prevTimestamp = performance.now();

function tick(): void {
    const timestamp = performance.now();
    const deltaTime = (timestamp - prevTimestamp) / 1000;
    prevTimestamp = timestamp;
    let messageSentCount = 0;
    let bytesSentCount = 0;

    joinedIds.clear();
    leftIds.clear();

    // This makes sure that if someone joins and leves in the same tick, the player will not be removed
    for (const event of eventQueue) {
        switch (event.kind) {
            case "PlayerJoined": {
                joinedIds.add(event.id);
                break;
            }
            case "PlayerLeft": {
                if (!joinedIds.delete(event.id)) {
                    leftIds.add(event.id);
                }
                break;
            }
        }
    }

    // Greet all the joined players and notify them about other players.
    joinedIds.forEach((joinedId) => {
        const joinedPlayer = players.get(joinedId);
        if (joinedPlayer !== undefined) {
            // This should never happen, but we handling none existing ids for more robustness
            // The greetings
            bytesSentCount += sendMessage<Hello>(joinedPlayer.socket, {
                kind: "Hello",
                id: joinedPlayer.id,
                x: joinedPlayer.x,
                y: joinedPlayer.y,
                style: joinedPlayer.style,
            });
            messageSentCount++;
            // Reconstruct the state of the other players
            players.forEach((otherPlayer) => {
                if (joinedId !== otherPlayer.id) {
                    // Joined player should already know about themselves
                    bytesSentCount += sendMessage<PlayerJoined>(
                        joinedPlayer.socket,
                        {
                            kind: "PlayerJoined",
                            id: otherPlayer.id,
                            x: otherPlayer.x,
                            y: otherPlayer.y,
                            style: otherPlayer.style,
                        },
                    );
                    messageSentCount++;
                    let direction: MoveDirection;
                    for (direction in otherPlayer.moving) {
                        if (otherPlayer.moving[direction]) {
                            bytesSentCount += sendMessage<PlayerMoving>(
                                joinedPlayer.socket,
                                {
                                    kind: "PlayerMoving",
                                    id: otherPlayer.id,
                                    x: otherPlayer.x,
                                    y: otherPlayer.y,
                                    start: true,
                                    direction,
                                },
                            );
                            messageSentCount++;
                        }
                    }
                }
            });
        }
    });

    // Notifying about who joined
    joinedIds.forEach((joinedId) => {
        const joinedPlayer = players.get(joinedId);
        if (joinedPlayer !== undefined) {
            //This should never happen, but we handling none existing ids for more robustness
            players.forEach((otherPlayer) => {
                if (joinedId !== otherPlayer.id) {
                    bytesSentCount += sendMessage<PlayerJoined>(
                        otherPlayer.socket,
                        {
                            kind: "PlayerJoined",
                            id: joinedPlayer.id,
                            x: joinedPlayer.x,
                            y: joinedPlayer.y,
                            style: joinedPlayer.style,
                        },
                    );
                    messageSentCount++;
                }
            });
        }
    });

    // Notify about who left
    leftIds.forEach((leftId) => {
        players.forEach((otherPlayer) => {
            bytesSentCount += sendMessage<PlayerLeft>(otherPlayer.socket, {
                kind: "PlayerLeft",
                id: leftId,
            });
            messageSentCount++;
        });
    });

    // Notify about movement
    for (const event of eventQueue) {
        switch (event.kind) {
            case "PlayerMoving": {
                const player = players.get(event.id);
                if (player === undefined) {
                    // This May happen if somebody joined, moved and left within a single tick. Just skipping.
                    continue;
                }
                player.moving[event.direction] = event.start;
                const eventStr = typia.json.stringify(event);
                players.forEach((otherPlayer) => {
                    otherPlayer.socket.send(eventStr);
                    messageSentCount++;
                    bytesSentCount += eventStr.length;
                });
                break;
            }
        }
    }
    // Simulate the world for one server tick
    players.forEach((player) => updatePlayer(player, deltaTime));

    const tickTime = performance.now() - timestamp;
    Stats.ticksCount.counter++;
    Stats.messagesSent.counter += messageSentCount;
    Stats.bytesSent.counter += bytesSentCount;
    Stats.tickTimes.samples.push(tickTime / 1000);
    Stats.tickMessagesSent.samples.push(messageSentCount);
    Stats.tickMessagesReceived.samples.push(eventQueue.size);
    Stats.tickByteSent.samples.push(bytesSentCount);
    Stats.tickByteReceived.samples.push(bytesReceivedWithinTick);

    eventQueue.clear();
    bytesReceivedWithinTick = 0;

    setTimeout(tick, Math.max(0, 1000 / SERVER_TPS - tickTime));
}

setTimeout(tick, 1000 / SERVER_TPS);
