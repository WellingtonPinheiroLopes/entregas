CREATE TABLE IF NOT EXISTS notificacoes (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    usuario_id BIGINT UNSIGNED NOT NULL,
    tipo VARCHAR(40) NOT NULL,
    mensagem VARCHAR(255) NOT NULL,
    entrega_id BIGINT UNSIGNED NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lida_em TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_notificacoes_usuario_tipo_entrega (usuario_id, tipo, entrega_id),
    KEY idx_notificacoes_usuario_leitura_data (usuario_id, lida_em, criado_em),
    CONSTRAINT fk_notificacoes_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_notificacoes_entrega FOREIGN KEY (entrega_id) REFERENCES entregas (id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
