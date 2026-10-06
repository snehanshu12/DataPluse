import path from 'node:path'
import { fileURLToPath } from 'node:url'
import 'dotenv/config'

const here = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(here, '..')

export const DB_PATH = path.resolve(ROOT, process.env.DB_PATH ?? 'data/ecommerce.db')

export const LLM = {
  baseURL: process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1',
  apiKey: process.env.LLM_API_KEY ?? '',
  model: process.env.LLM_MODEL ?? 'gpt-4o-mini',
}

export function requireApiKey(): string {
  if (!LLM.apiKey) {
    throw new Error(
      'LLM_API_KEY is not set. Copy .env.example to .env and fill in your key.'
    )
  }
  return LLM.apiKey
}