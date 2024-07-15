import { Stats, STATS_SERVER_PORT } from "@/core/common";

const STATS_HISTORY_LEN = 50;

const source = new EventSource(
    `http://${window.location.hostname}:${STATS_SERVER_PORT}`,
);

const statsAgg: Stats[] = []
function pushStats(s:Stats) {
    if(statsAgg.push(s) > STATS_HISTORY_LEN) {
        statsAgg.shift();
    }
}

function average(xs: number[]): number {
    return xs.reduce((acc, x) => acc + x, 0) / xs.length;
}

export function StatsCharts() {
    return <div>Hello</div>
}
