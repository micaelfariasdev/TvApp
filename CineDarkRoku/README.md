# CINEDARK Roku

Projeto Roku separado do aplicativo Android. A API e o catálogo continuam sendo os mesmos do servidor TVBOX.

## Instalação no Roku

1. Ative o Developer Mode no Roku (`Home` 3x, `Up` 2x, `Right`, `Left`, `Right`, `Left`, `Right`).
2. Acesse no navegador `http://IP_DO_ROKU` e entre em **Development Application Installer**.
3. Gere um ZIP contendo `manifest`, `source/` e `components/`.
4. Envie o ZIP pelo formulário do Roku.

O endpoint padrão está em `source/api.brs`. Altere `ApiBase()` se o endereço do servidor mudar.

