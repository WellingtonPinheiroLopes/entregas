# Projeto Entregas

## Autenticação e desenvolvimento local

O backend usa sessões no servidor persistidas na tabela MySQL `sessoes`. O cookie `entregas.sid` é `HttpOnly`, `SameSite=Lax` e recebe `Secure` quando `NODE_ENV=production`. Requisições que alteram estado exigem origem permitida e token CSRF obtido em `GET /api/auth/csrf`. A API não confia em dados de acesso enviados pelo navegador; `GET /api/usuarios` é restrita a administradores.

### Preparação

1. Copie `.env.example` para `.env` e configure valores locais exclusivos. Gere `SESSION_SECRET` com pelo menos 32 caracteres aleatórios. Não versione `.env`.
2. Inicie o MySQL: `docker compose up -d mysql`.
3. Aplique a migração nova sem recriar banco ou volume. Se `001_create_usuarios.sql` já foi aplicada, aplique somente `002_create_sessoes.sql`, usando uma conta MySQL com permissão para criar tabela:

   ```sh
   docker compose exec -T mysql mysql -u root -p entregas < database/migrations/002_create_sessoes.sql
   ```

   O cliente solicitará a senha do banco. Se o banco não se chamar `entregas`, informe o nome configurado em `MYSQL_DATABASE`.
4. Em um terminal, inicie a API: `cd backend && npm install && npm run dev`.
5. Em outro terminal, inicie o frontend: `cd frontend && npm install && npm run dev` e abra `http://localhost:5173`.

Para bancos existentes, aplique também `migrations/011_optional_email_and_unique_login_name.sql` depois das migrações anteriores. Ela mantém o índice único de e-mail (MySQL permite vários `NULL` em um índice `UNIQUE`) e torna o nome de login único. O schema atual foi verificado sem nomes duplicados antes da criação desta migração.

O proxy de desenvolvimento encaminha `/api` para `http://127.0.0.1:3000`. Defina `VITE_BACKEND_URL` se usar outro endereço. A origem da página precisa corresponder a `FRONTEND_ORIGIN` no `.env`.

### Rotas

- `GET /api/auth/csrf`: cria/recupera token para operações POST.
- `POST /api/auth/login`: recebe `{ "identificador": "...", "senha": "..." }` e o header `X-CSRF-Token`; o identificador aceita e-mail ou nome de usuário. O e-mail é opcional nos cadastros.
- `GET /api/auth/me`: retorna usuário e token CSRF da sessão atual, ou 401.
- `POST /api/auth/logout`: requer cookie de sessão e `X-CSRF-Token`.
- `GET /api/usuarios`: exige sessão de administrador.

Para testar manualmente, use o formulário com um usuário já cadastrado; credenciais incorretas e identificadores inexistentes mostram a mesma mensagem. Usuários sem e-mail entram com o nome de usuário. Após entrar, o nome e nível de acesso aparecem na área de trabalho. Use **Sair** para encerrar a sessão; recarregar a página antes de sair confirma a recuperação da sessão pelo endpoint `/me`.

### Verificações automatizadas

Execute `cd backend && npm test` e `cd frontend && npm run build`. Os testes de API usam um banco e armazenamento de sessão simulados; eles exercitam a lógica HTTP, mas não validam credenciais reais nem a tabela MySQL. A aplicação em produção deve usar HTTPS, `NODE_ENV=production`, um `SESSION_SECRET` forte e `FRONTEND_ORIGIN` correspondente ao domínio servido.
