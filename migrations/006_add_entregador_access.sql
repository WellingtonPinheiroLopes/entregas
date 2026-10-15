-- Ampliar o ENUM sem reescrever valores existentes nem trocar o default.
-- Pode ser reaplicada com segurança: MODIFY COLUMN mantém os dados atuais.
ALTER TABLE usuarios
    MODIFY COLUMN acesso ENUM('administrador', 'convidado', 'entregador') NOT NULL DEFAULT 'convidado';
