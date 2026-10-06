/** CRM customer-management schema — mirrors the curated CRM_SCHEMA_SPEC prompt. */
export const CRM_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS companies (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  industry    TEXT NOT NULL,
  employees   INTEGER NOT NULL,
  city        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id),
  name        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  phone       TEXT NOT NULL,
  title       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deals (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id),
  contact_id  INTEGER NOT NULL REFERENCES contacts(id),
  amount      NUMERIC(12,2) NOT NULL,
  stage       TEXT NOT NULL,
  close_date  DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS activities (
  id            SERIAL PRIMARY KEY,
  contact_id    INTEGER NOT NULL REFERENCES contacts(id),
  activity_type TEXT NOT NULL,
  note          TEXT NOT NULL,
  happened_at   TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_deals_company     ON deals(company_id);
CREATE INDEX IF NOT EXISTS idx_deals_stage       ON deals(stage);
CREATE INDEX IF NOT EXISTS idx_activities_contact ON activities(contact_id);
`

/** List of tables, in dependency order, used by the manager CLI. */
export const CRM_TABLES = ['companies', 'contacts', 'deals', 'activities'] as const

export const CRM_COUNT_SQL = `SELECT COUNT(*) AS c FROM `