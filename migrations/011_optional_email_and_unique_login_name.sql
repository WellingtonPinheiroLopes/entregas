-- Keep email uniqueness for populated addresses; MySQL allows multiple NULLs
-- in a UNIQUE index. The production schema inspected before this migration uses
-- utf8mb4_0900_ai_ci for usuarios.nome and usuarios.email.
ALTER TABLE usuarios
    MODIFY COLUMN email VARCHAR(254)
        CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
    ADD UNIQUE KEY uk_usuarios_nome (nome);
