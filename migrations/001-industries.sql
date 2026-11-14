-- Additive only. Do not run before approval and a fresh backup.
-- Existing salary_data and salary_dart_sources are not altered or cleared.
CREATE TABLE IF NOT EXISTS industry_categories (
  code VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  slug VARCHAR(60) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  parent_code VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  description TEXT NOT NULL,
  sort_order SMALLINT NOT NULL,
  page_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  FOREIGN KEY (parent_code) REFERENCES industry_categories(code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS industry_companies (
  corp_code CHAR(8) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  stock_code CHAR(6) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL UNIQUE,
  display_name VARCHAR(255) NOT NULL,
  legal_name VARCHAR(255) NOT NULL,
  ksic_code VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  source_url VARCHAR(1000) NOT NULL,
  verified_on DATE NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS company_industries (
  corp_code CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  industry_code VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  valid_from_year SMALLINT NOT NULL,
  valid_to_year SMALLINT DEFAULT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT TRUE,
  review_status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  evidence_json JSON NOT NULL,
  reviewed_on DATE DEFAULT NULL,
  PRIMARY KEY (corp_code,industry_code,valid_from_year),
  KEY idx_industry_review (industry_code,review_status,valid_from_year,valid_to_year),
  FOREIGN KEY (corp_code) REFERENCES industry_companies(corp_code),
  FOREIGN KEY (industry_code) REFERENCES industry_categories(code),
  CHECK (valid_to_year IS NULL OR valid_to_year >= valid_from_year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS salary_company_links (
  salary_id BIGINT UNSIGNED PRIMARY KEY,
  corp_code CHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  review_status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  match_method ENUM('dart_source','disclosure_record','manual_review') NOT NULL,
  evidence_json JSON NOT NULL,
  reviewed_on DATE DEFAULT NULL,
  KEY idx_salary_company (corp_code,review_status,salary_id),
  FOREIGN KEY (salary_id) REFERENCES salary_data(id),
  FOREIGN KEY (corp_code) REFERENCES industry_companies(corp_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
