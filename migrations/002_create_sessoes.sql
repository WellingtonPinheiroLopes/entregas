CREATE TABLE IF NOT EXISTS sessoes (
    session_id VARCHAR(128) NOT NULL,
    sess JSON NOT NULL,
    expires_at DATETIME NOT NULL,
    PRIMARY KEY (session_id),
    KEY idx_sessoes_expires_at (expires_at)
);
