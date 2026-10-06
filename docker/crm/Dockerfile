# CRM demo Postgres: official image + auto schema on first boot.
FROM postgres:17-alpine

COPY init/01-schema.sql /docker-entrypoint-initdb.d/01-schema.sql