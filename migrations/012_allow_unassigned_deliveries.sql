-- Keep the existing unsigned bigint type, index and foreign key while allowing
-- deliveries to remain unassigned until an administrator selects a deliverer.
ALTER TABLE entregas
    MODIFY COLUMN entregador_id BIGINT UNSIGNED NULL;
