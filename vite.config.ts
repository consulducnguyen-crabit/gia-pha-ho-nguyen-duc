import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    // SDK Firebase (~560 kB) không tách an toàn được; ngưỡng đặt trên kích thước đó có chủ đích.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Tách React khỏi chunk ứng dụng. Firebase giữ nguyên MỘT chunk: tách @firebase/firestore riêng
        // gây phụ thuộc vòng giữa hai chunk và lỗi "Cannot access ... before initialization" khi chạy.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (/node_modules\/(@firebase|firebase)\//.test(id))
            return "firebase";
          if (
            /node_modules\/(react|react-dom|react-router|react-router-dom|scheduler|@remix-run)\//.test(
              id,
            )
          )
            return "react";
        },
      },
    },
  },
});
