-- Campos opcionais para manter compatibilidade com cadastros já existentes.
ALTER TABLE entregadores
    ADD COLUMN cidade VARCHAR(100) NULL AFTER setor,
    ADD COLUMN estado CHAR(2) NULL AFTER cidade;
