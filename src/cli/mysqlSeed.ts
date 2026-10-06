import mysql from 'mysql2/promise'
import 'dotenv/config'
import { MYSQL_SCHEMA_SQL, MYSQL_TABLES, MYSQL_COUNT_SQL } from '../db/mysqlSchema.js'
import { seedMysql } from '../db/mysqlSeed.js'
import type { MySqlClient } from '../agent/text2sql/mysql.js'

const dbUrl = process.env.MYSQL_DATABASE_URL
if (!dbUrl) {
  console.error(
    '未配置 MYSQL_DATABASE_URL（MySQL 连接串），例如：\n' +
      '  export MYSQL_DATABASE_URL="mysql://root:root@127.0.0.1:3306/library"\n' +
      '数据库不存在时本脚本会尝试自动创建。',
  )
  process.exit(1)
}

const connStr: string = dbUrl

const url = new URL(connStr)
const dbName = url.pathname.slice(1)
if (!dbName) {
  console.error('MYSQL_DATABASE_URL 的路径里缺少数据库名，例如：mysql://user:pass@host:3306/library')
  process.exit(1)
}

/** Connect once without a database and create the target DB if needed. */
async function ensureDatabase(): Promise<void> {
  const adminUrl = new URL(connStr)
  adminUrl.pathname = ''
  const admin = await mysql.createConnection(adminUrl.toString())
  try {
    await admin.query(`CREATE DATABASE IF NOT EXISTS \`${dbName.replace(/`/g, '')}\``)
    console.log(`已就绪数据库 ${dbName}`)
  } finally {
    await admin.end()
  }
}

await ensureDatabase()

const pool = mysql.createPool(connStr)
const client: MySqlClient = {
  async query(sql, params) {
    const [rows] = await pool.query(sql, params)
    return { rows: rows as Record<string, unknown>[] }
  },
}

try {
  // run the multi-statement DDL one statement at a time (mysql2 needs no flag then)
  const statements = MYSQL_SCHEMA_SQL.split(';').map((s) => s.trim()).filter(Boolean)
  for (const stmt of statements) await pool.query(stmt)

  const counts = await seedMysql(client)
  console.log(`Seeded MySQL database at ${dbName}`)
  for (const t of MYSQL_TABLES) {
    const [rows] = await pool.query(MYSQL_COUNT_SQL + t)
    const c = (rows as Record<string, unknown>[])[0]!.c
    console.log(`  ${t}: ${c}`)
  }
} finally {
  await pool.end()
}