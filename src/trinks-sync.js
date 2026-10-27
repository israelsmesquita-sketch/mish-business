// Coleta manual do Trinks pelo terminal: `npm run trinks`. Use TRINKS_HEADLESS=0 para ver o navegador.
const { openDatabase } = require('./db');
const { sincronizarTrinks } = require('./lib/trinks-robo');

sincronizarTrinks(openDatabase())
  .then((r) => process.exit(r.some((x) => x.status === 'erro') ? 1 : 0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
