import type pg from 'pg'

/** Same deterministic PRNG as the e-commerce seed, so re-seeding is reproducible. */
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const COMPANIES = [
  'Acme', 'Globex', 'Initech', 'Hooli', 'Wayne', 'Cyberdyne',
  'Soylent', 'Wonka', 'Stark', 'Weyland', 'Tyrell', 'Vought',
]
const INDUSTRIES = ['SaaS', 'Manufacturing', 'Retail', 'Finance', 'Healthcare', 'Logistics']
const CITIES = ['Beijing', 'Shanghai', 'Shenzhen', 'Hangzhou', 'Chengdu', 'Guangzhou']
const FIRST = ['Lin', 'Mei', 'Han', 'Zhao', 'Chen', 'Yang', 'Huang', 'Wu', 'Xu', 'Zhu']
const GIVEN = ['Wei', 'Xin', 'Yu', 'Jing', 'Lei', 'Fang', 'Qiang', 'Na', 'Jun', 'Ping']
const EMAIL_DOMAINS = ['acme.io', 'globex.com', 'gmail.com', 'outlook.com', 'example.com']
const TITLES = ['CEO', 'CTO', 'VP Sales', 'Procurement Lead', 'Operations Manager', 'CFO']
const STAGES = ['open', 'open', 'open', 'won', 'won', 'lost']
const ACTIVITY_TYPES = ['call', 'email', 'meeting', 'demo']

export interface CrmSeedOptions {
  companies?: number
  contactsPerCompany?: number
  deals?: number
  activities?: number
  seed?: number
  /** inclusive range for close_date / happened_at */
  from?: Date
  to?: Date
}

function randInt(rnd: () => number, min: number, max: number): number {
  return min + Math.floor(rnd() * (max - min + 1))
}

function randItem<T>(rnd: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rnd() * arr.length)]!
}

function randDate(rnd: () => number, from: Date, to: Date): Date {
  return new Date(from.getTime() + rnd() * (to.getTime() - from.getTime()))
}

function iso(d: Date): string {
  return d.toISOString()
}

/** Insert deterministic mock CRM data. Idempotent-ish: truncates then re-inserts. */
export async function seedCrm(client: pg.Client | pg.Pool, opts: CrmSeedOptions = {}): Promise<Record<string, number>> {
  const nCompanies = opts.companies ?? 12
  const contactsPerCompany = opts.contactsPerCompany ?? 4
  const nDeals = opts.deals ?? 160
  const nActivities = opts.activities ?? 240
  const rnd = mulberry32(opts.seed ?? 42)
  const from = opts.from ?? new Date(Date.UTC(2025, 6, 1))
  const to = opts.to ?? new Date(Date.UTC(2026, 7, 1))

  await client.query('BEGIN')
  try {
    for (const t of ['activities', 'deals', 'contacts', 'companies']) {
      await client.query(`TRUNCATE ${t} RESTART IDENTITY CASCADE`)
    }

    const companyNames = COMPANIES.slice(0, Math.min(nCompanies, COMPANIES.length))
    const companyIds: number[] = []
    for (const name of companyNames) {
      const { rows } = await client.query(
        'INSERT INTO companies(name, industry, employees, city, created_at) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [name, randItem(rnd, INDUSTRIES), randInt(rnd, 20, 5000), randItem(rnd, CITIES), iso(randDate(rnd, from, to))],
      )
      companyIds.push(Number(rows[0]!.id))
    }

    const contactIds: number[] = []
    for (const companyId of companyIds) {
      for (let c = 0; c < contactsPerCompany; c++) {
        const name = `${randItem(rnd, FIRST)} ${randItem(rnd, GIVEN)}`
        const { rows } = await client.query(
          'INSERT INTO contacts(company_id, name, email, phone, title) VALUES ($1,$2,$3,$4,$5) RETURNING id',
          [
            companyId,
            name,
            `c${Math.floor(rnd() * 1e9)}@${randItem(rnd, EMAIL_DOMAINS)}`,
            `+86-13${randInt(rnd, 0, 9)}-${String(randInt(rnd, 0, 9999)).padStart(4, '0')}-${String(randInt(rnd, 0, 9999)).padStart(4, '0')}`,
            randItem(rnd, TITLES),
          ],
        )
        contactIds.push(Number(rows[0]!.id))
      }
    }

    const dealRows: unknown[][] = []
    for (let i = 0; i < nDeals; i++) {
      const companyId = randItem(rnd, companyIds)
      const contactIdsOfCompany = contactIds.filter(
        (_, idx) => Math.floor(idx / contactsPerCompany) === companyIds.indexOf(companyId),
      )
      dealRows.push([
        companyId,
        randItem(rnd, contactIdsOfCompany.length ? contactIdsOfCompany : contactIds),
        // employees scale the deal size; won deals skew higher
        Number(((rnd() * 10_000 + 2_000) * (1 + companyId * 0.1)).toFixed(2)),
        randItem(rnd, STAGES),
        randDate(rnd, from, to).toISOString().slice(0, 10),
      ])
    }
    for (const r of dealRows) {
      await client.query(
        'INSERT INTO deals(company_id, contact_id, amount, stage, close_date) VALUES ($1,$2,$3,$4,$5)',
        r,
      )
    }

    const actRows: unknown[][] = []
    for (let i = 0; i < nActivities; i++) {
      actRows.push([
        randItem(rnd, contactIds),
        randItem(rnd, ACTIVITY_TYPES),
        `Notes #${Math.floor(rnd() * 1000)}`,
        iso(randDate(rnd, from, to)),
      ])
    }
    for (const r of actRows) {
      await client.query(
        'INSERT INTO activities(contact_id, activity_type, note, happened_at) VALUES ($1,$2,$3,$4)',
        r,
      )
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  }

  const counts: Record<string, number> = {}
  for (const t of ['companies', 'contacts', 'deals', 'activities']) {
    const { rows } = await client.query(`SELECT COUNT(*) AS c FROM ${t}`)
    counts[t] = Number(rows[0]!.c)
  }
  return counts
}