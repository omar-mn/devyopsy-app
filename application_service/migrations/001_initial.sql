CREATE TABLE applications (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY CHECK (id <= 9007199254740991),
    owner_id INTEGER NOT NULL CHECK (owner_id > 0),
    name VARCHAR(100) NOT NULL CHECK (name ~ '^[A-Za-z0-9_-]{3,100}$'),
    repository_url VARCHAR(500) NOT NULL,
    branch VARCHAR(200) NOT NULL DEFAULT 'main',
    application_type VARCHAR(20) NOT NULL
        CHECK (application_type IN ('django', 'flask', 'node', 'react')),
    source_directory VARCHAR(255),
    requirements_file VARCHAR(255),
    port INTEGER NOT NULL CHECK (port BETWEEN 1024 AND 65535),
    run_command VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT unique_app_name_per_owner UNIQUE (owner_id, name)
);

CREATE INDEX applications_owner_created_idx ON applications (owner_id, created_at DESC, id DESC);

CREATE TABLE build_references (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    request_id UUID NOT NULL UNIQUE,
    build_id UUID UNIQUE,
    application_id BIGINT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'QUEUED'
        CHECK (status IN ('QUEUED', 'BUILDING', 'READY', 'FAILED')),
    delivery_uncertain BOOLEAN NOT NULL DEFAULT FALSE,
    image_repository VARCHAR(255),
    image_tag VARCHAR(100),
    image_digest VARCHAR(100),
    commit_sha VARCHAR(100),
    error_message TEXT CHECK (length(error_message) <= 4000),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at)
);

CREATE INDEX build_history_idx ON build_references (application_id, created_at DESC, id DESC);
CREATE UNIQUE INDEX one_active_build_per_application ON build_references (application_id)
    WHERE status IN ('QUEUED', 'BUILDING');

-- Shared across API instances; this stores rate-limit counters, not Auth Service users.
CREATE TABLE build_throttles (
    owner_id INTEGER PRIMARY KEY,
    hits INTEGER NOT NULL,
    reset_at TIMESTAMPTZ NOT NULL
);
