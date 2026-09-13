Atue como um arquiteto de software sênior e especialista em sistemas multiagentes e Android TV.

Preciso de uma solução completa composta por duas partes integradas:

PARTE 1: APLICATIVO ANDROID TV (KOTLIN)
Crie o projeto completo do app Android para TV Box que consome um arquivo JSON remoto hospedado no GitHub (URL Raw) e reproduz canais de streaming:
1. Arquitetura: Kotlin nativo.
2. Player: AndroidX Media3 (ExoPlayer) com suporte a fluxos HLS (MimeTypes.APPLICATION_M3U8).
3. Interface: Layout fixo em landscape, vídeo ao fundo e lista lateral (RecyclerView) com navegação fluida via controle remoto (D-Pad/foco visual).
4. Configurações: AndroidManifest.xml completo para TV (Leanback, touchscreen false, permissões e usesCleartextTraffic) e build.gradle.kts.
5. Arquivos necessários: build.gradle.kts, AndroidManifest.xml, activity_main.xml, item_channel.xml, Channel.kt, ChannelAdapter.kt e MainActivity.kt.
6. Regra: Não inclua comentários no meio do código.

PARTE 2: ECOSSISTEMA DE AGENTES AUTÔNOMOS
Crie a estrutura de agentes responsáveis por manter a lista de canais do GitHub sempre atualizada e funcional:
1. Agente Validador: Testa se os links .m3u8 estão online, sem atraso excessivo e funcionais.
2. Agente Sanitizador/JSON: Monta o schema exato que o app Android lê, removendo links mortos ou duplicados.
3. Agente Deployer Git: Faz o commit e push automático do arquivo channels.json atualizado no repositório GitHub via API.
4. Forneça o System Prompt de cada agente e um script funcional em Python que execute a validação dos links e envie o channels.json para o GitHub automaticamente (sem comentários no código).