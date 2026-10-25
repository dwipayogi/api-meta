module.exports = {
    apps: [
      {
        name: "api-meta",
        script: "dist/server.js",
        node_args: "--env-file=.env", // WAJIB: baca .env (lihat bagian 6)
        cwd: __dirname,
  
        // Fork 1 instance. JANGAN pakai cluster (lihat bagian 7).
        instances: 1,
        exec_mode: "fork",
  
        autorestart: true,
        max_memory_restart: "300M",
        min_uptime: "10s",
        max_restarts: 10,
  
        // Graceful shutdown (server.ts sudah menangani SIGTERM/SIGINT)
        kill_timeout: 12_000,
        listen_timeout: 10_000,
  
        // Logging
        error_file: "logs/error.log",
        out_file: "logs/out.log",
        merge_logs: true,
        time: true,
  
        env: {
          NODE_ENV: "production"
        }
      }
    ]
  };