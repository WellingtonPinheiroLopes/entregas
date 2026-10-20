# CLAUDE.md – Fluxo Permanente de Desenvolvimento

## 1️⃣ Visão Geral
Este documento descreve o fluxo recomendado para:
- **Investigação** de requisitos e código existente.  
- **Implementação** de novas funcionalidades ou correções.  
- **Testes Automatizados** (unitários e E2E).  
- **Revisão de Segurança** (Claude Security).  
- **Persistência de Configurações** via Basic Memory MCP.  

## 2️⃣ Passos do Fluxo

| Etapa | Herramienta(s) | Descrição | Saída Esperada |
|------|----------------|-----------|----------------|
| **A. Preparação** | `Superpowers:using-superpowers`, `Basic Memory MCP` | Verificar ferramentas disponíveis e atualizar memória de contexto. | Lista de ferramentas operacionais e estado da memória. |
| **B. Inspeção** | `Read`, `Superpowers:diagnosing-superpowers` | Analisar arquivos de configuração, testes, scripts. | Relatório de estrutura e conteúdo. |
| **C. Planejamento** | `Superpowers:brainstorming` | Definir tarefas a implementar (ex.: novos testes, cobertura). | Checklist de tarefas e prioridades. |
| **D. Implementação** | `Edit`, `Write`, `Agent` (se necessário) | Realizar alterações de código ou arquivos de teste. | Arquivos modificados salvos. |
| **E. Execução de Testes** | `npm test`, `npx playwright test` | Rodar unitários e E2E separadamente. | Relatório de passagens/falhas. |
| **F. Revisão de Segurança** | `Claude Security` | Executar scan de vulnerabilidades nas áreas alteradas. | Resultado de vulnerabilidades encontradas. |
| **G. Commit & Persistência** | `Git` (via CLI) + `Basic Memory MCP:create_memory_project` | Persistir mudanças e registrar no projeto. | Commit realizado; memória atualizada. |
| **H. Documentação** | `Write` (atualizar CLAUDE.md) | Registrar decisões, mudanças e próximos passos. | Documento atualizado. |

## 3️⃣ Configurações Relevantes

### 3.1 `package.json` – Scripts de Teste
```json
{
  "scripts": {
    "test": "jest --watchAll",
    "test:e2e": "npx playwright test",
    "test:security": "claude-security scan --scope src"
  }
}
```

### 3.2 `playwright.config.ts`
```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
```

### 3.3 Diretório de Testes
- `tests/unit/` – testes unitários (Jest).  
- `tests/e2e/` – testes end‑to‑end (Playwright).  

## 4️⃣ Segurança (Claude Security)
- comando padrão: `claude-security scan --scope <pasta>`.  
- resultados são gravados em `security-report.json`.  

## 5️⃣ Memory Management (Basic Memory MCP)
- `basic-memory:create_memory_project` – cria registro persistente.  
- `basic-memory:write_note` – adiciona notas ao projeto.  
- Use `[[relevant_memory]]` para referenciar memórias relacionadas.

## 6️⃣ Próximos Passos (Checklist)
- [ ] Atualizar CLAUDE.md com este fluxo.  
- [ ] Inspecionar arquivos de teste existentes.  
- [ ] Mapear cobertura atual.  
- [ ] Implementar testes faltantes (conforme etapa 5).  
- [ ] Executar scans de segurança.  
- [ ] Registrar mudanças no memory MCP.  
- [ ] Executar testes E2E apenas com MySQL/disponível (docker compose up).  

---  

*Este fluxo será revisado a cada iteração para garantir aderência às boas práticas de desenvolvimento e segurança.* 