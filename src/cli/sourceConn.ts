import 'dotenv/config'
import pg from 'pg'
import mysql from 'mysql2/promise'
import { DB_PATH } from '../config.js'
import { createSqliteSource, openSqliteDatabase } from '../agent/text2sql/sqlite.js'
import { createPostgresSource } from '../agent/text2sql/postgres.js'
import { createMysqlSource } from '../agent/text2sql/mysql.js'
import type { DataSource } from '../agent/text2sql/datasource.js'
import type { MySqlClient } from '../agent/text2sql/mysql.js'

export interface CliSource {
  source: DataSource
  close: () => Promise<void>
  driver: 'sqlite' | 'postgres' | 'mysql'
}

/** Connect to whatever data source the (blanked) process env points at. */
export function buildSource(): CliSource {
  const crmUrl = process.env.CRM_DATABASE_URL
  const mysqlUrl = process.env.MYSQL_DATABASE_URL
  if (crmUrl) {
    const pool = new pg.Pool({ connectionString: crmUrl, connectionTimeoutMillis: 8000 })
    return { source: createPostgresSource(pool), close: () => pool.end(), driver: 'postgres' }
  }
  if (mysqlUrl) {
    const pool = mysql.createPool({ uri: mysqlUrl, connectTimeout: 8000 })
    const client: MySqlClient = {
      async query(sql, params) {
        const [rows] = await pool.query(sql, params)
        return { rows: rows as Record<string, unknown>[] }
      },
    }
    return { source: createMysqlSource(client), close: () => pool.end(), driver: 'mysql' }
  }
  const db = openSqliteDatabase(DB_PATH)
  return {
    source: createSqliteSource(db),
    close: () => {
      db.close()
      return Promise.resolve()
    },
    driver: 'sqlite',
  }
}

export function quoteIdent(driver: string, name: string): string {
  if (driver === 'mysql') return `\`${name.replace(/`/g, '``')}\``
  return `"${name.replace(/"/g, '""')}"`
}

export function previewCell(v: unknown): string | number | boolean | null {
  if (v === undefined || v === null) return null
  if (v instanceof Date) {
    const t = v.getTime()
    return Number.isNaN(t) ? null : v.toISOString()
  }
  if (typeof v === 'object') {
    try {
      const s = JSON.stringify(v)
      return s && s !== '{}' ? s : '[object]'
    } catch {
      return '[object]'
    }
  }
  return v as string | number | boolean
}