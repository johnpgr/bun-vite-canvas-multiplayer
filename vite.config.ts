import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import UnpluginTypia from "@ryoppippi/unplugin-typia/vite";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react(), UnpluginTypia()],
    root: "src",
    server: { port: 6969 },
    define: {
        DEBUG: process.env.DEBUG ?? "false",
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
});
