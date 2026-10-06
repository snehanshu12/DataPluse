import Database from 'better-sqlite3'
import { initDatabase } from './database.js'
import { BRANDS, CITIES, CATEGORIES, ORDER_STATUSES, PAYMENT_METHODS, PRODUCT_NAMES } from './schema.js'

const FIRST = ['Lin', 'Mei', 'Han', 'Zhao', 'Chen', 'Yang', 'Huang', 'Wu', 'Xu', 'Zhu', 'Sun', 'Ma', 'Gao', 'Guo']
const GIVEN = ['Wei', 'Xin', 'Yu', 'Jing', 'Lei', 'Fang', 'Qiang', 'Na', 'Jun', 'Ping', 'Fan', 'Tao', 'Yan', 'Hua']
const EMAIL_DOMAINS = ['gmail.com', 'outlook.com', 'qq.com', '163.com', 'example.com']

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ')
}

function randomDate(rnd: () => number, from: Date, to: Date): Date {
  return new Date(from.getTime() + rnd() * (to.getTime() - from.getTime()))
}

export interface SeedOptions {
  customers?: number
  productsPerCategory?: number
  orders?: number
  maxItemsPerOrder?: number
  seed?: number
}

export function seedDatabase(db: Database.Database, opts: SeedOptions = {}): void {
  const customers = opts.customers ?? 800
  const productsPerCategory = opts.productsPerCategory ?? 10
  const orders = opts.orders ?? 6000
  const maxItems = opts.maxItemsPerOrder ?? 5
  const rnd = mulberry32(opts.seed ?? 42)

  const now = Date.now()
  const from = now - 365 * 24 * 60 * 60 * 1000 // last 12 months

  const run = db.transaction(() => {
    db.exec(`
      DELETE FROM order_items;
      DELETE FROM orders;
      DELETE FROM products;
      DELETE FROM customers;
      DELETE FROM categories;
    `)

    const insCat = db.prepare('INSERT INTO categories (name) VALUES (?)')
    const cats = CATEGORIES.map((name, i) => {
      insCat.run(name)
      return { id: i + 1, name }
    })

    const insProduct = db.prepare(
      'INSERT INTO products (name, category_id, brand, price, cost, stock, rating) VALUES (?,?,?,?,?,?,?)'
    )
    const products: { id: number; name: string; category_id: number; price: number; cost: number }[] = []
    for (const cat of cats) {
      const names = PRODUCT_NAMES[cat.name]!
      for (let i = 0; i < productsPerCategory; i++) {
        const price = Math.round((5 + rnd() * 245) * 100) / 100
        const cost = Math.round(price * (0.45 + rnd() * 0.35) * 100) / 100
        const info = insProduct.run(
          names[i % names.length]!,
          cat.id,
          BRANDS[Math.floor(rnd() * BRANDS.length)]!,
          price,
          cost,
          Math.floor(rnd() * 500),
          Math.round((3.5 + rnd() * 1.5) * 10) / 10
        )
        products.push({ id: Number(info.lastInsertRowid), name: names[i % names.length]!, category_id: cat.id, price, cost })
      }
    }

    const insCustomer = db.prepare(
      'INSERT INTO customers (name, email, city, age, gender, registered_at, is_vip) VALUES (?,?,?,?,?,?,?)'
    )
    const customerIds: number[] = []
    for (let i = 0; i < customers; i++) {
      const first = FIRST[Math.floor(rnd() * FIRST.length)]!
      const given = GIVEN[Math.floor(rnd() * GIVEN.length)]!
      const name = `${first} ${given}`
      const email = `${first.toLowerCase()}.${given.toLowerCase()}.${i}@${EMAIL_DOMAINS[Math.floor(rnd() * EMAIL_DOMAINS.length)]}`
      const reg = randomDate(rnd, new Date(from), new Date(now))
      const info = insCustomer.run(
        name,
        email,
        CITIES[Math.floor(rnd() * CITIES.length)]!,
        Math.floor(18 + rnd() * 45),
        rnd() > 0.5 ? 'M' : 'F',
        fmtDate(reg),
        rnd() > 0.8 ? 1 : 0
      )
      customerIds.push(Number(info.lastInsertRowid))
    }

    const insOrder = db.prepare(
      'INSERT INTO orders (customer_id, placed_at, status, payment, total, discount) VALUES (?,?,?,?,?,?)'
    )
    const insItem = db.prepare(
      'INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?,?,?,?)'
    )

    for (let o = 0; o < orders; o++) {
      const customerId = customerIds[Math.floor(rnd() * customerIds.length)]!
      const placed = randomDate(rnd, new Date(from), new Date(now))
      const nItems = 1 + Math.floor(rnd() * maxItems)
      const chosen = new Set<number>()
      while (chosen.size < nItems) chosen.add(Math.floor(rnd() * products.length))

      let subtotal = 0
      const items: { productId: number; qty: number; price: number }[] = []
      for (const idx of chosen) {
        const p = products[idx]!
        const qty = 1 + Math.floor(rnd() * 4)
        items.push({ productId: p.id, qty, price: p.price })
        subtotal += p.price * qty
      }
      const discount = rnd() < 0.25 ? Math.round(subtotal * (0.05 + rnd() * 0.15) * 100) / 100 : 0
      const total = Math.round((subtotal - discount) * 100) / 100

      const info = insOrder.run(
        customerId,
        fmtDate(placed),
        ORDER_STATUSES[Math.floor(rnd() * ORDER_STATUSES.length)]!,
        PAYMENT_METHODS[Math.floor(rnd() * PAYMENT_METHODS.length)]!,
        total,
        discount
      )
      const orderId = Number(info.lastInsertRowid)
      for (const it of items) {
        insItem.run(orderId, it.productId, it.qty, it.price)
      }
    }
  })

  run()
}

export function seedFromEnv(db: Database.Database): void {
  const num = (v: string | undefined, d: number) => (v ? parseInt(v, 10) : d)
  seedDatabase(db, {
    customers: num(process.env.SEED_CUSTOMERS, 800),
    productsPerCategory: num(process.env.SEED_PRODUCTS_PER_CATEGORY, 10),
    orders: num(process.env.SEED_ORDERS, 6000),
    maxItemsPerOrder: num(process.env.SEED_MAX_ITEMS, 5),
    seed: num(process.env.SEED_VALUE, 42),
  })
}

export { initDatabase }