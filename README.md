# Link3 · Sistema de Conteúdo

Painel + motor de edição da Link3. Arquitetura completa no doc "Arquitetura · Sistema de Conteúdo Link3".

| Pasta | O que é | Onde roda |
|---|---|---|
| `supabase/migrations` | Banco (10 tabelas + convites), RLS, Storage, Realtime | Supabase da Link3 |
| `painel` | Painel web (HTML + JS puro, sem build) | Cloudflare (Workers, assets estáticos) |
| `worker` | Fila de pedidos, Drive, FFmpeg | Servidor da Link3 (Hostinger) |

## Banco
No **Supabase → SQL Editor**, rodar em ordem: `001_base.sql`, `002_supabase.sql`. As duas podem rodar de novo sem quebrar nada.

Usuários: a pessoa é liberada no painel (aba Equipe) ou na tabela `convites`, e o login é criado em **Supabase → Authentication → Add user** com o mesmo e-mail. O perfil é criado sozinho.

## Painel
Preencher `painel/config.js` com a URL do projeto e a chave publishable. Deploy: Cloudflare → Workers → conectar o repositório (sem build command; o `wrangler.jsonc` publica a pasta `painel`).

## Worker
```
cd worker && npm ci
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… GOOGLE_SERVICE_ACCOUNT_JSON=/caminho/conta.json npm start
```
Precisa de `ffmpeg` e `ffprobe` no PATH. Testes: `npm test` (gera um vídeo sintético e roda o ciclo inteiro com Drive e banco simulados).

### Ciclo de um pedido
`na_fila → baixando → preparando → planejando → renderizando → previa_pronta → (ajuste_pedido →) aprovado → entregando → entregue`

Etapa 0 (Base): baixa o bruto do Drive, monta em 1080×1920 com o logo da marca e grava na pasta de finalizados do cliente. O Módulo 1 troca o `planejarBase` pela transcrição + roteiro do Claude, sem mudar o resto.

Testes do banco: `node tests/base.test.mjs` (na raiz, usa PGlite).
