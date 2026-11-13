const mysql = require('mysql2/promise');
function dbConfig() {
  return {host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME, supportBigNumbers: true, bigNumberStrings: true,
    ...(process.env.DB_SSL_CA_BASE64 ? {ssl: {ca: Buffer.from(process.env.DB_SSL_CA_BASE64, 'base64').toString('utf8'), rejectUnauthorized: true}} : {})};
}
let pool;
function database() { return pool ||= mysql.createPool({...dbConfig(), connectionLimit: 5, waitForConnections: true, queueLimit: 100, connectTimeout: 10000}); }
module.exports = {dbConfig, database};
