module.exports = {
  apps: [
    {
      name: "canais-next",
      cwd: __dirname,
      script: "server.cjs",
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "4555",
        CANAIS_API_URL: "http://127.0.0.1:4055",
      },
    },
  ],
};
