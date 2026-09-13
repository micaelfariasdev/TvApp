# Catálogo M3U com SQLite

Requisitos: Node 22.5 ou superior.

```powershell
cd F:\tvbox\m3u-sqlite-catalog
npm install
npm run import -- "F:\tvbox\tv_channels_7999833244_plus.m3u"
npm start
```

Abra `http://localhost:3000`. Para importar outra lista, repita o comando `npm run import`; ele substitui o catálogo atual.

Também aceita URL:

```powershell
npm run import -- "https://exemplo.com/lista.m3u"
```
