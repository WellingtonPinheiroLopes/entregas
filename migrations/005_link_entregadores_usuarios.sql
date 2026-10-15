-- Add a non-destructive link for existing deliverers. Legacy rows remain unlinked
-- until an administrator supplies a unique email while editing their record.
ALTER TABLE usuarios
    MODIFY COLUMN acesso ENUM('administrador', 'convidado', 'entregador') NOT NULL DEFAULT 'convidado';

ALTER TABLE entregadores
    ADD COLUMN usuario_id BIGINT UNSIGNED NULL AFTER id,
    ADD UNIQUE KEY uk_entregadores_usuario_id (usuario_id),
    ADD CONSTRAINT fk_entregadores_usuario
        FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
        ON UPDATE CASCADE ON DELETE RESTRICT;
