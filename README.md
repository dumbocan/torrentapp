# 🎬 TorrentStream

Una aplicación web completa para buscar, reproducir y descargar torrents de musica .mp3 con streaming en tiempo real.

## ✨ Características

### Funcionalidades Principales
- 🔍 **Búsqueda de torrents** - Integra resultados de The Pirate Bay, LimeTorrents, TorrentDownload, Torlock y 1337x
- 🎧 **Reproductor compacto** - Muestra carátula, metadatos y controles para audio con soporte de streaming
- 📥 **Gestión de descargas** - Cola, pausa, reanuda descargas
- 📚 **Biblioteca personal** - Gestiona tu contenido descargado
- 🗂️ **Biblioteca inteligente** - Indexa tus MP3/FLAC locales y los prioriza en las búsquedas
- ▶️ **Cola de reproducción** - Añade pistas o álbumes a una cola y deja que el reproductor las ejecute en secuencia
- ⚙️ **Configuración avanzada** - Personaliza tu experiencia

### Técnicas
- 🌐 **Frontend**: HTML5, CSS3, JavaScript ES6+, Tailwind CSS
- ⚡ **Backend**: Node.js, Express, WebTorrent
- 🔄 **P2P**: WebRTC, BitTorrent protocol
- 📡 **APIs**: Integración con YTS y otros trackers
- 🎨 **Diseño**: Interfaz moderna con glass morphism

## 🚀 Instalación

### Requisitos Previos
- Node.js 16+ y npm
- Git (opcional)

### Método 1: Script de Instalación Automática
```bash
# Linux/macOS
chmod +x install.sh
./install.sh

# Windows (PowerShell)
.\install.ps1
```

### Método 2: Instalación Manual
```bash
# Clonar el repositorio
git clone https://github.com/tu-usuario/torrentstream.git
cd torrentstream

# Instalar dependencias
npm install

# Crear archivo de configuración
cp .env.example .env

# Crear directorio de descargas
mkdir downloads
```

### Método 3: Docker o Docker Compose
```bash
# Build de la imagen
docker build -t torrentstream .

# Ejecutar el contenedor con los volúmenes locales
docker run -it --rm \
  -p 3000:3000 \
  -v "$(pwd)/downloads:/app/downloads" \
  -v "$(pwd)/config:/app/config" \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e MAX_DOWNLOADS=5 \
  torrentstream
```

Para levantar todo el stack definido en `docker-compose.yml` (app + servicios futuros):
```bash
docker compose up --build
```

Esto expone la app en `http://localhost:3000` y persistirá las descargas en `./downloads`.

## 📋 Uso

### Iniciar el Servidor
```bash
# Modo producción
npm start

# Modo desarrollo (con auto-reload)
npm run dev
```

### Acceder a la Aplicación
- **URL**: http://localhost:3000
- **Interfaz web**: Abre tu navegador y ve a la URL anterior

### Funcionalidades
1. **Buscar Torrents**: Usa el campo de búsqueda principal
2. **Filtrar**: Aplica filtros por categoría, calidad, etc.
3. **Reproducir**: Click en "Reproducir" para streaming
4. **Descargar**: Click en "Descargar" para guardar
5. **Biblioteca**: Gestiona tu contenido descargado

## 🛠️ Configuración

### Variables de Entorno (.env)
```env
PORT=3000
NODE_ENV=development
MAX_DOWNLOADS=5
DOWNLOAD_PATH=./downloads
# Proxy opcional para scraping (HTTP o SOCKS a través de surfshark, etc.)
# TORRENT_PROXY_URL=http://usuario:password@127.0.0.1:1080
```

### Configuración del Servidor
- **Puerto**: Por defecto 3000
- **Directorio de descargas**: `./downloads/`
- **Límites**: Configurable en la interfaz de usuario

#### Uso con VPN/Proxy
Si usas una VPN que expone un proxy local (Surfshark, Mullvad, etc.), define `TORRENT_PROXY_URL`, `HTTPS_PROXY` o `HTTP_PROXY` antes de arrancar el servidor. Todas las peticiones HTTP/HTTPS (Pirate Bay, LimeTorrents, MusicBrainz, etc.) saldrán por ese proxy y aceptarán certificados autofirmados para evitar bloqueos de inspección TLS.

## 🔧 API Endpoints

### Búsqueda de Torrents
```http
GET /api/search?query=termino&category=movies&limit=20
```

Este endpoint consulta primero tu biblioteca local, y si no encuentra coincidencias agrega resultados remotos de The Pirate Bay, LimeTorrents y TorrentDownload. Normaliza los datos y elimina duplicados priorizando las semillas más activas.

### Streaming de Archivo Local
```http
GET /api/library/stream?file=downloads/Album/tema.mp3
```

### Streaming de Torrents
```http
POST /api/stream
Content-Type: application/json

{
  "magnetURI": "magnet:?xt=urn:btih:...",
  "id": "unique-id"
}
```

### Estado del Torrent
```http
GET /api/torrent/{id}
```

### Descargas Activas
```http
GET /api/downloads
```

### Metadatos (MusicBrainz)
```http
GET /api/metadata/artist?q=dr%20dre
```

Devuelve artistas y lanzamientos relacionados para enriquecer la búsqueda, corregir errores ortográficos y mostrar sugerencias.

### Biblioteca Local
- `GET /api/library`: devuelve todos los archivos indexados en `./downloads`.
- `GET /api/library/search?query=cancion&limit=20`: busca únicamente en tu biblioteca.
- `POST /api/library/rescan`: fuerza un reescaneo del directorio de descargas.

## 🗺️ Próximos Pasos
- 🎚️ **Previews y buffers**: generar automáticamente los primeros segundos de cada pista para reproducir en cuanto el usuario pulse play, mientras WebTorrent conecta los peers.
- 🧠 **Metadatos avanzados**: almacenar artista → álbum → pista en PostgreSQL y enriquecerlos con Spotify/MusicBrainz (carátulas, géneros, créditos).
- 📱 **Modo offline móvil**: exponer endpoints para sincronizar canciones/álbumes al teléfono y reproducirlas sin conexión.
- 🎵 **Importación de playlists**: permitir login con Spotify (OAuth) para traer playlists y mapear cada tema a los hashes disponibles en la red P2P.
- 🧩 **Arquitectura modular**: dividir el backend en controllers/services/repos y ofrecer un SDK/API pública para futuros frontends (web, móvil, escritorio).

## 🎨 Estructura del Proyecto

```
torrentstream/
├── public/                 # Archivos estáticos del frontend
│   ├── index.html         # Página principal
│   ├── library.html       # Biblioteca
│   ├── main.js           # Lógica principal
│   └── resources/        # Recursos multimedia
├── downloads/            # Archivos descargados
├── server.js            # Servidor backend
├── package.json         # Dependencias
├── .env.example        # Ejemplo de configuración
├── install.sh          # Script de instalación
└── README.md           # Este archivo
```

## 🔒 Seguridad y Privacidad

### Características de Seguridad
- ✅ **Cifrado de protocolo** - Evita throttling de ISP
- ✅ **Modo anónimo** - Oculta metadatos del cliente
- ✅ **Lista de bloqueo de IP** - Filtra peers maliciosos
- ✅ **CORS habilitado** - Seguridad entre dominios

### Uso Responsable
- ⚠️ **Respetar derechos de autor** - Solo contenido legal
- ⚠️ **Usar VPN si es necesario** - Protege tu privacidad
- ⚠️ **Verificar fuentes** - Evita malware

## 🚀 Próximas Características

### Fase 2 - Sistema de Usuarios
- 🔐 **Sistema de login/registro**
- 👤 **Perfiles de usuario**
- 📊 **Estadísticas personales**
- ☁️ **Sincronización en la nube**

### Fase 3 - Integración con Spotify
- 🎵 **Importar listas de Spotify**
- 🔄 **Sincronización de biblioteca**
- 📱 **App móvil**
- 🎧 **Modo offline**

### Fase 4 - Características Avanzadas
- 🤖 **Recomendaciones IA**
- 📺 **Chromecast/AirPlay**
- 🌐 **Streaming remoto**
- 📱 **Apps nativas**

## 🐛 Solución de Problemas

### Problemas Comunes

1. **No puede encontrar torrents**
   - Verifica la conexión a internet
   - Intenta diferentes términos de búsqueda
   - Comprueba que los trackers no estén bloqueados

2. **Streaming lento**
   - Verifica tu conexión a internet
   - Ajusta los límites de velocidad
   - Intenta torrents con más seeds

3. **Error de CORS**
   - Asegúrate de usar el servidor correctamente
   - Verifica la configuración del proxy

### Soporte
- 📧 **Email**: support@torrentstream.com
- 🐛 **Issues**: Reporta problemas en GitHub
- 💬 **Discord**: Únete a nuestra comunidad

## 📄 Licencia

Este proyecto está licenciado bajo la Licencia MIT - ver el archivo [LICENSE](LICENSE) para más detalles.

## ⚠️ Descargo de Responsabilidad

Este software es para fines educativos. Los usuarios son responsables de cumplir con las leyes de derechos de autor locales. El desarrollador no se hace responsable del uso indebido de esta herramienta.

## 🤝 Contribuir

¡Las contribuciones son bienvenidas! Por favor:

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 🙏 Agradecimientos

- [WebTorrent](https://webtorrent.io/) - Por la librería P2P
- [YTS](https://yts.mx/) - Por la API de películas
- [Tailwind CSS](https://tailwindcss.com/) - Por el framework CSS
- [Express](https://expressjs.com/) - Por el servidor backend

---

**⚡ Hecho con ❤️ por la comunidad de TorrentStream**
