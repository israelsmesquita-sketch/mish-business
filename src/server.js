const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 3000;

createApp().listen(PORT, () => {
  console.log(`Mish Business 1.0 rodando em http://localhost:${PORT}`);
});
