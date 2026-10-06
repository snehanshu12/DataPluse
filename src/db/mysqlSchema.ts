/** Library demo schema for MySQL — mirrors the curated MYSQL_DEMO_SPEC prompt. */
export const MYSQL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS publishers (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100) NOT NULL UNIQUE,
  city          VARCHAR(50) NOT NULL,
  founded_year  SMALLINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS authors (
  id       INT AUTO_INCREMENT PRIMARY KEY,
  name     VARCHAR(50) NOT NULL UNIQUE,
  country  VARCHAR(50) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS books (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  isbn          VARCHAR(20) NOT NULL UNIQUE,
  title         VARCHAR(200) NOT NULL,
  category      VARCHAR(50) NOT NULL,
  price         DECIMAL(8,2) NOT NULL,
  stock         INT NOT NULL,
  author_id     INT NOT NULL REFERENCES authors(id),
  publisher_id  INT NOT NULL REFERENCES publishers(id),
  published_at  DATE NOT NULL,
  KEY idx_books_author (author_id),
  KEY idx_books_publisher (publisher_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS members (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(50) NOT NULL,
  email      VARCHAR(100) NOT NULL UNIQUE,
  city       VARCHAR(50) NOT NULL,
  level      VARCHAR(20) NOT NULL,
  joined_at  DATE NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS borrows (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  book_id      INT NOT NULL REFERENCES books(id),
  member_id    INT NOT NULL REFERENCES members(id),
  borrowed_at  DATETIME NOT NULL,
  due_date     DATE NOT NULL,
  returned_at  DATETIME NULL,
  KEY idx_borrows_book (book_id),
  KEY idx_borrows_member (member_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`

/** Tables in dependency order for the manager CLI. */
export const MYSQL_TABLES = ['publishers', 'authors', 'books', 'members', 'borrows'] as const

export const MYSQL_COUNT_SQL = 'SELECT COUNT(*) AS c FROM '