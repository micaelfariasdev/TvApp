# Catálogo M3U com SQLite

Requisitos: Node 22.5 ou superior.

```powershell
cd F:\tvbox\m3u-sqlite-catalog
npm install
npm run import -- "F:\tvbox\tv_channels_7999833244_plus.m3u"
npm start
```

Abra `http://localhost:3001` e use **Importar novo M3U** para selecionar outra lista diretamente na página. Somente canais novos serão adicionados; os já cadastrados são preservados e URLs repetidas são ignoradas. Também é possível importar pelo terminal com `npm run import`.

Também aceita URL:

```powershell
npm run import -- "https://exemplo.com/lista.m3u"
```
