// Populates the database with sample data for demos: `npm run seed`.
const { openDatabase } = require('./db');

const db = openDatabase();

if (db.prepare('SELECT COUNT(*) AS n FROM produtos').get().n > 0) {
  console.log('O banco já possui dados — seed ignorado.');
  process.exit(0);
}

const clientes = [
  ['Ana Souza', 'ana@exemplo.com', '(11) 98888-1111', '123.456.789-00', 'Rua das Flores, 10 - São Paulo/SP'],
  ['Carlos Lima', 'carlos@exemplo.com', '(21) 97777-2222', '987.654.321-00', 'Av. Atlântica, 200 - Rio de Janeiro/RJ'],
  ['Mercado Bom Preço LTDA', 'compras@bompreco.com', '(31) 3333-4444', '12.345.678/0001-90', 'Rua Central, 55 - Belo Horizonte/MG'],
];
const produtos = [
  ['Camiseta Básica', 'CAM-001', 49.9, 22, 40, 10],
  ['Calça Jeans', 'CAL-001', 139.9, 70, 15, 5],
  ['Tênis Casual', 'TEN-001', 249.9, 130, 4, 5],
  ['Boné', 'BON-001', 39.9, 15, 25, 8],
];

const insC = db.prepare('INSERT INTO clientes (nome, email, telefone, documento, endereco) VALUES (?, ?, ?, ?, ?)');
const insP = db.prepare('INSERT INTO produtos (nome, sku, preco, custo, estoque, estoque_minimo) VALUES (?, ?, ?, ?, ?, ?)');
clientes.forEach((c) => insC.run(...c));
produtos.forEach((p) => insP.run(...p));

const insL = db.prepare('INSERT INTO lancamentos (tipo, descricao, categoria, valor) VALUES (?, ?, ?, ?)');
insL.run('despesa', 'Aluguel da loja', 'Aluguel', 2500);
insL.run('despesa', 'Conta de energia', 'Utilidades', 380.5);

console.log('Dados de exemplo inseridos com sucesso.');
