'use strict';

require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env') });

const db = require('./src/db');
const { createApp } = require('./app');
const app = createApp({ db });
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const server = app.listen(PORT, HOST, () => console.log(`Servidor iniciado em http://${HOST}:${PORT}`));

server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? `A porta ${PORT} já está em uso.` : 'Erro ao iniciar o servidor.');
  process.exitCode = 1;
});

async function shutdown() {
  server.close(async () => {
    try {
      await db.end();
      console.log('Conexões encerradas.');
    } catch {
      console.error('Erro ao encerrar conexões.');
      process.exitCode = 1;
    }
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
