CREATE TABLE IF NOT EXISTS entregas (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    cliente_id BIGINT UNSIGNED NOT NULL,
    entregador_id BIGINT UNSIGNED NOT NULL,
    descricao VARCHAR(500) NOT NULL,
    status ENUM('na_farmacia', 'em_transito', 'concluida', 'cancelada') NOT NULL DEFAULT 'na_farmacia',
    cep_destino CHAR(8) NULL,
    endereco_destino VARCHAR(255) NULL,
    quadra_destino VARCHAR(50) NULL,
    lote_destino VARCHAR(50) NULL,
    numero_destino VARCHAR(30) NULL,
    setor_destino VARCHAR(120) NULL,
    cidade_destino VARCHAR(100) NULL,
    estado_destino CHAR(2) NULL,
    observacoes TEXT NULL,
    motivo_cancelamento TEXT NULL,
    cancelada_em TIMESTAMP NULL,
    cancelada_por BIGINT UNSIGNED NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_entregas_cliente (cliente_id),
    KEY idx_entregas_entregador (entregador_id),
    KEY idx_entregas_status_data (status, criado_em),
    KEY idx_entregas_criado_em (criado_em),
    CONSTRAINT fk_entregas_cliente FOREIGN KEY (cliente_id) REFERENCES clientes (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_entregas_entregador FOREIGN KEY (entregador_id) REFERENCES entregadores (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_entregas_cancelada_por FOREIGN KEY (cancelada_por) REFERENCES usuarios (id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS historico_status_entregas (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    entrega_id BIGINT UNSIGNED NOT NULL,
    status_anterior ENUM('na_farmacia', 'em_transito', 'concluida', 'cancelada') NULL,
    status_novo ENUM('na_farmacia', 'em_transito', 'concluida', 'cancelada') NOT NULL,
    motivo TEXT NULL,
    usuario_id BIGINT UNSIGNED NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_historico_entrega_data (entrega_id, criado_em),
    CONSTRAINT fk_historico_entrega FOREIGN KEY (entrega_id) REFERENCES entregas (id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_historico_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
        ON UPDATE CASCADE ON DELETE SET NULL
);
