# ===========================================================================
# DataPulse dev targets.
#
# NOTE on demo data: data/ecommerce.db (and data/imported/*.db) is a GENERATED
# artifact, not source — .gitignore excludes data/ and *.db, so it is never
# committed. After a fresh clone run `make init` (or `make seed`) to rebuild it.
# ===========================================================================

.PHONY: install init seed reset db-remove ask dashboard build typecheck test dev desktop-dev clean crm-up crm-down crm-seed crm-ask mysql-up mysql-down mysql-seed mysql-ask csv-import starters help

install:
	npm install

init: ## Fresh-clone bootstrap: install deps + rebuild the demo database
	npm install
	npm run seed

seed: ## (Re)generate the mock e-commerce database
	npm run seed

db-remove: ## Delete the generated demo db (run `make seed` to rebuild)
	rm -f data/ecommerce.db data/ecommerce.db-shm data/ecommerce.db-wal

reset: ## Wipe the demo db then regenerate it (db-remove + seed)
	rm -f data/ecommerce.db data/ecommerce.db-shm data/ecommerce.db-wal
	npm run seed

ask: ## Ask the AI agent a business question (e.g. make ask Q="top products by revenue")
	npm run ask -- $(Q)

dashboard: ## Generate an AI dashboard (e.g. make dashboard Q="monthly revenue, top cities")
	npm run dashboard -- $(Q)

build:
	npm run build

typecheck: ## TypeScript check
	npm run typecheck

test: ## Run the test suite (node:test + tsx)
	npm run test

dev: ## Launch the Electron desktop UI — kills leftover electron/vite first, then rebuilds
	npm run desktop

desktop-dev: ## Launch the Electron desktop UI in dev mode (Vite + Electron HMR, one command)
	npm --prefix desktop run dev:all

crm-up: ## Start the CRM PostgreSQL service (compose crmdb, :5433)
	docker compose -f docker/compose.yml up -d --build crmdb

crm-down: ## Stop the CRM PostgreSQL service (-v to also wipe data: make crm-down V=-v)
	docker compose -f docker/compose.yml down crmdb $(V)

crm-seed: ## Create + fill the CRM database (needs crm-up first)
	npm run crm-seed

crm-ask: ## Ask the AI agent a CRM question against PostgreSQL (e.g. make crm-ask Q="deal amount by industry")
	npm run crm-ask -- $(Q)

mysql-up: ## Start the MySQL demo service (compose mysqldb, mysql:8.4, :3307)
	docker compose -f docker/compose.yml up -d --build mysqldb

mysql-down: ## Stop the MySQL demo service (-v to also wipe data: make mysql-down V=-v)
	docker compose -f docker/compose.yml down mysqldb $(V)

mysql-seed: ## Create + fill the MySQL library database (needs mysql-up first)
	npm run mysql-seed

mysql-ask: ## Ask the AI agent a MySQL library question (e.g. make mysql-ask Q="top borrowed books")
	npm run mysql-ask -- $(Q)

csv-import: ## Import a CSV into a fresh SQLite db under data/imported (make csv-import FILE=path.csv TABLE=name)
	npm run csv-import -- $(FILE) $(TABLE)

starters: ## Preview dynamic starter questions generated from the live schema (make starters DB_PATH=...)
	npm run starters -- --json

clean:
	rm -rf dist data output

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'