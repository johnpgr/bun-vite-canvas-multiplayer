import { Stat, Stats, STATS_SERVER_PORT } from "@/core/common";
import { exhaustive } from "@/lib/utils";
import React from "react";
import {
    ChartConfig,
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
} from "./ui/chart";
import {
    BarChart,
    Bar,
    CartesianGrid,
    YAxis,
    XAxis,
    LabelList,
} from "recharts";

const STATS_HISTORY_LEN = 50;

function pushWithLength<T>(xs: T[], s: T, length = STATS_HISTORY_LEN) {
    if (xs.push(s) > length) {
        xs.shift();
    }

    return [...xs];
}

function average(xs: number[]): number {
    return xs.reduce((acc, x) => acc + x, 0) / xs.length;
}

function getChartsConfig(
    stats: Stats,
): [ChartConfig, ChartConfig, ChartConfig] {
    const counterChartConfig: ChartConfig = {};
    const timerChartConfig: ChartConfig = {};
    const averageChartConfig: ChartConfig = {};

    Object.keys(stats).forEach((k) => {
        const v = stats[k];
        switch (v.kind) {
            case "counter": {
                counterChartConfig[k] = {
                    label: v.description,
                    color: "red",
                };
                break;
            }
            case "timer": {
                timerChartConfig[k] = {
                    label: v.description,
                    color: "blue",
                };
                break;
            }
            case "average": {
                averageChartConfig[k] = {
                    label: v.description,
                    color: "green",
                };
                break;
            }
        }
    });

    return [counterChartConfig, timerChartConfig, averageChartConfig];
}

type ChartData = {
    value: number;
    timestamp: number;
};
type Key = string;
type ChartDataMap = Record<Key, ChartData[]>;
type StatsDescriptions = Record<Key, string>;
type ChartDataArray = Array<{[key:string]: number} & { timestamp: number }>;

export function StatsCharts() {
    const [stats, setStats] = React.useState<ChartDataMap>({});
    const [statsDescriptions, setStatsDescriptions] =
        React.useState<StatsDescriptions>({});
    const [chartDataArray, setChartDataArray] = React.useState<ChartDataArray>(
        [],
    );
    const [counterChartConfig, setCounterChartConfig] = React.useState<
        ChartConfig | undefined
    >(undefined);
    const [timerChartConfig, setTimerChartConfig] = React.useState<
        ChartConfig | undefined
    >(undefined);
    const [averageChartConfig, setAverageChartConfig] = React.useState<
        ChartConfig | undefined
    >(undefined);

    React.useEffect(() => {
        const source = new EventSource(
            `http://${window.location.hostname}:${STATS_SERVER_PORT}`,
        );
        source.onopen = () => console.log("DATA SOURCE: connected");
        source.onerror = (e) => console.log("DATA SOURCE: error", e);
        source.onmessage = (e) => {
            const data = Stats.fromJson(e.data);
            const dataEntries = Object.entries(data);
            if (
                counterChartConfig === undefined ||
                timerChartConfig === undefined ||
                averageChartConfig === undefined
            ) {
                const chartsConfig = getChartsConfig(data);
                setCounterChartConfig(chartsConfig[0]);
                setTimerChartConfig(chartsConfig[1]);
                setAverageChartConfig(chartsConfig[2]);
            }
            if (dataEntries.length > Object.values(statsDescriptions).length) {
                dataEntries.map(([k, v]) => {
                    statsDescriptions[k] = v.description;
                });
                setStatsDescriptions((prev) => ({ ...prev }));
            }
            dataEntries.map(([k, v]) => {
                if (stats[k] === undefined) {
                    stats[k] = [];
                }
                const stArr = stats[k];
                const value =
                    v.kind === "timer"
                        ? performance.now() - v.startedAt
                        : v.kind === "counter"
                          ? v.counter
                          : average(v.samples);
                pushWithLength(stArr, {
                    value,
                    timestamp: Date.now(),
                });
            });
            setStats((prev) => ({ ...prev }));
            setChartDataArray(() => {
                return Object.entries(stats).flatMap(([k, v]) => {
                    return v.map((data) => ({
                        timestamp: data.timestamp,
                        [k]: data.value,
                    }));
                });
            });
        };
        return () => source.close();
    }, [
        averageChartConfig,
        counterChartConfig,
        stats,
        statsDescriptions,
        timerChartConfig,
    ]);

    return (
        <div>
            <button
                onClick={() =>
                    console.log({
                        stats,
                        chartDataArray,
                        statsDescriptions,
                        counterChartConfig,
                        timerChartConfig,
                        averageChartConfig,
                    })
                }
            >
                Debug
            </button>
        </div>
    );
}
