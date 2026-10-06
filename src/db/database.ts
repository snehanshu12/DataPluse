import Database from 'better-sqlite3'

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS customers (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  email        TEXT NOT NULL UNIQUE,
  city         TEXT NOT NULL,
  age          INTEGER NOT NULL,
  gender       TEXT NOT NULL,
  registered_at TEXT NOT NULL,
  is_vip       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  brand       TEXT NOT NULL,
  price       REAL NOT NULL,
  cost        REAL NOT NULL,
  stock       INTEGER NOT NULL,
  rating      REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id           INTEGER PRIMARY KEY,
  customer_id  INTEGER NOT NULL REFERENCES customers(id),
  placed_at    TEXT NOT NULL,
  status       TEXT NOT NULL,
  payment      TEXT NOT NULL,
  total        REAL NOT NULL,
  discount     REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS order_items (
  id           INTEGER PRIMARY KEY,
  order_id     INTEGER NOT NULL REFERENCES orders(id),
  product_id   INTEGER NOT NULL REFERENCES products(id),
  quantity     INTEGER NOT NULL,
  unit_price   REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_placed_at ON orders(placed_at);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
`

export function initDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA_SQL)
  return db
}

/** Provide the LLM with the schema so it can write correct SQL.
 *  Introspects the ACTUAL tables in the connected db — the analysis/agent path
 *  also serves user-imported CSVs, where the e-commerce table names are absent. */
export function describeSchema(db: Database.Database): string {
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all() as { name: string }[]
  const parts: string[] = []
  for (const { name } of tables.slice(0, 20)) {
    const cols = db.prepare(`PRAGMA table_info(${JSON.stringify(name)})`).all() as { name: string; type: string }[]
    parts.push(`${name}(${cols.map((c) => `${c.name} ${c.type || 'unknown'}`).join(', ')})`)
  }
  return parts.join('\n')
}