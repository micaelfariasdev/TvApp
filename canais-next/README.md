# CineDark Channels

Painel de administração em Next.js App Router, TypeScript e Tailwind CSS.

## Desenvolvimento local

Requer Node.js 20.9 ou superior.

```powershell
npm install
npm run dev
```

Abra `http://localhost:3000`.

## Verificações

```powershell
npm run lint
npm run build
npm start
```

## Rotas de interface

- `/login`: autenticação administrativa;
- `/`: visão geral do catálogo;
- `/filmes`: catálogo de filmes;
- `/series`: catálogo de séries agrupadas, sem listar episódios como itens independentes;
- `/series/[id]`: temporadas, episódios e links de cada série;
- `/ao-vivo`: canais de televisão ao vivo;
- `/kick`: streamers e canais Kick;
- `/categorias`: visão por categoria;
- `/configuracoes`: área reservada para configurações do servidor.

Todas as rotas de interface, exceto `/login`, exigem sessão administrativa válida no Express e redirecionam para o login quando não houver acesso. As APIs do catálogo também exigem sessão; somente a verificação, login e encerramento de sessão ficam disponíveis sem autenticação. A busca global do cabeçalho consulta o catálogo autorizado e leva ao tipo de conteúdo correspondente. Os cadastros e edições são persistidos no servidor.

## Conectar ao servidor Express

O Express expõe `GET /tvbox/api/v2/catalog`, que agrupa filmes, séries (sem contar episódios como itens), canais ao vivo e canais Kick. O Next encaminha essa chamada por `GET /api/catalog`, sem expor o endereço do Express no navegador.

O editor usa `POST /tvbox/api/v2/session`, `GET /tvbox/api/v2/session`, `POST /tvbox/api/v2/catalog/items`, `PATCH /tvbox/api/v2/catalog/items/:id` e `PATCH /tvbox/api/v2/catalog/categories`. A busca automática de capas para filmes e séries usa os provedores TMDb/IMDb; na página Kick, a foto de perfil é obtida pelo usuário do canal na Kick. Ambas usam `POST /tvbox/api/v2/catalog/posters/search`, protegida pela sessão administrativa. Os episódios de cada série são lidos por `GET /tvbox/api/v2/catalog/series/:id`; temporadas e episódios são criados e editados pelas rotas v2 de catálogo sob `/series/:id/seasons` e `/series/:id/episodes`.

A configuração PM2 de produção usa o Express local na porta 4055. Para execução local, se o Express estiver em outro endereço (por exemplo, uma cópia em `http://127.0.0.1:4000`), defina a variável de ambiente no ambiente do Next antes de iniciar:

```dotenv
CANAIS_API_URL=http://127.0.0.1:4000
```

Use apenas a origem do servidor, sem acrescentar `/tvbox/api/v2/catalog`. Reinicie o Next após alterar a variável. Se a API estiver indisponível, o painel mostra o erro e oferece uma opção para tentar novamente.

O login usa a mesma senha administrativa do Express. Para escrita, configure `CANAIS_API_URL` com HTTPS ou com o endereço de loopback (`127.0.0.1`/`localhost`); credenciais não são encaminhadas por HTTP público. A API v2 de escrita precisa estar implantada no Express para adicionar e editar itens.

Em produção, o painel Next é servido em `/cinedark` pelo encaminhamento Nginx existente e executado pelo PM2 em `127.0.0.1:4555`. `npm run canais` envia o runtime do Express e somente os arquivos de runtime do Next (código, assets públicos, manifests e configurações), instala as dependências, compila o painel no servidor e atualiza o processo PM2 `canais-next`. O deploy não envia `.env`, bancos, catálogo HLS, `node_modules`, builds locais, testes nem arquivos do app Android/extensão, e não altera a configuração do Nginx.
