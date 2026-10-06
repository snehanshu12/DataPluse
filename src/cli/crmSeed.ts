import pg from 'pg'
import 'dotenv/config'
import { CRM_SCHEMA_SQL, CRM_TABLES, CRM_COUNT_SQL } from '../db/crmSchema.js'
import { seedCrm } from '../db/crmSeed.js'

const connectionString = process.env.CRM_DATABASE_URL
if (!connectionString) {
  console.error(
    '未配置 CRM_DATABASE_URL（PostgreSQL 连接串），例如：\n' +
      '  export CRM_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5432/crm"\n' +
      '数据库不存在时本脚本会尝试自动创建。',
  )
  process.exit(1)
}

// Re-bind as a plain string so closures see a narrowed type.
const connStr: string = connectionString

const url = new URL(connStr)
const dbName = url.pathname.slice(1)
if (!dbName) {
  console.error('CRM_DATABASE_URL 的路径里缺少数据库名，例如：postgres://user:pass@host:5432/crm')
  process.exit(1)
}

/** Create the target database if it does not exist (needs a maintenance connection). */
async function ensureDatabase(): Promise<void> {
  const adminUrl = new URL(connStr)
  adminUrl.pathname = '/postgres'
  const admin = new pg.Client({ connectionString: adminUrl.toString() })
  try {
    await admin.connect()
    const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
    if (rows.length === 0) {
      await admin.query(`CREATE DATABASE ${dbName}`)
      console.log(`已创建数据库 ${dbName}`)
    }
  } finally {
    await admin.end()
  }
}

await ensureDatabase()

const pool = new pg.Pool({ connectionString })
try {
  await pool.query(CRM_SCHEMA_SQL)
  const counts = await seedCrm(pool)
  console.log(`Seeded CRM database at ${dbName}`)
  for (const t of CRM_TABLES) {
    const { rows } = await pool.query(CRM_COUNT_SQL + t)
    console.log(`  ${t}: ${rows[0]!.c}`)
  }
} finally {
  await pool.end()
}