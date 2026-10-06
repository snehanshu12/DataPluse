import { initDatabase } from '../db/database.js'
import { seedFromEnv } from '../db/seed.js'
import { countTables } from '../agent/sqlTool.js'
import { DB_PATH } from '../config.js'

const db = initDatabase(DB_PATH)
seedFromEnv(db)
const counts = countTables(db)
console.log(`Seeded database at ${DB_PATH}`)
for (const [table, n] of Object.entries(counts)) console.log(`  ${table}: ${n}`)
db.close()