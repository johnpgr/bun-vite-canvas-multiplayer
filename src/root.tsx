import React from "react";
import ReactDOM from "react-dom/client";
import { StatsCharts } from "@/components/stats";
import "./globals.css";
// import { ChartsTestComponent } from "./components/charts-test";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <StatsCharts />
        {/* <ChartsTestComponent /> */}
    </React.StrictMode>,
);
