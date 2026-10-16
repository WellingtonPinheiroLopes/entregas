-- Existing accounts remain active. Blocking is an access state and does not
-- change the account role, password, or related records.
ALTER TABLE usuarios
    ADD COLUMN ativo TINYINT(1) NOT NULL DEFAULT 1 AFTER acesso;

-- Keep immutable account identifiers in the audit trail even if an account is
-- later removed from the application.
CREATE TABLE IF NOT EXISTS auditoria_acesso_usuarios (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    administrador_id BIGINT UNSIGNED NOT NULL,
    usuario_id BIGINT UNSIGNED NOT NULL,
    acao ENUM('bloqueio', 'desbloqueio') NOT NULL,
    resultado ENUM('sucesso', 'falha') NOT NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_auditoria_acesso_usuario_data (usuario_id, criado_em),
    KEY idx_auditoria_acesso_admin_data (administrador_id, criado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
