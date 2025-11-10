// TorrentStream - Main JavaScript File
class TorrentStream {
    constructor() {
        this.client = null;
        this.currentTorrent = null;
        this.activeDownloads = new Map();
        this.videoPlayer = document.getElementById('videoPlayer');
        this.playerPlaceholder = document.getElementById('playerPlaceholder');
        this.webRtcTrackers = [
            'wss://tracker.openwebtorrent.com',
            'wss://tracker.btorrent.xyz',
            'wss://tracker.files.fm:7073/announce',
            'wss://tracker.webtorrent.dev'
        ];
        this.torrentStatusTimers = new Map();
        this.currentBackendTorrentId = null;
        this.initializeApp();
    }

    async startBackendTorrent(magnetURI) {
        const response = await fetch('/api/stream', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ magnet: magnetURI })
        });

        if (!response.ok) {
            throw new Error('No se pudo iniciar el torrent en el servidor');
        }

        return response.json();
    }

    monitorTorrentStatus(torrentId, displayName) {
        const encodedId = encodeURIComponent(torrentId);

        const poll = async () => {
            try {
                const response = await fetch(`/api/torrent/${encodedId}/status`);
                if (!response.ok) {
                    throw new Error('Estado no disponible');
                }

                const status = await response.json();
                this.updateProgressFromBackend(status);

                if (status.ready && status.files && status.files.length) {
                    const fileIndex = typeof status.streamableFileIndex === 'number'
                        ? status.streamableFileIndex
                        : (status.files.find(file => file.isAudio)?.index ?? status.files[0].index);

                    this.streamFromBackend(torrentId, fileIndex, displayName || status.name, status.files[fileIndex]);
                    return;
                }

                const handle = setTimeout(poll, 1500);
                this.torrentStatusTimers.set(torrentId, handle);
            } catch (error) {
                console.error('Error monitorizando torrent:', error);
                this.showError('No se pudo iniciar la reproducción desde el servidor');
                this.showLoading(false);
            }
        };

        poll();
    }

    streamFromBackend(torrentId, fileIndex, displayName = '', fileMeta = null) {
        this.stopMonitoringTorrent(torrentId);
        this.playerPlaceholder.style.display = 'none';
        this.videoPlayer.style.display = 'block';

        if (displayName) {
            const titleElement = document.getElementById('playerTitle');
            if (titleElement) {
                titleElement.textContent = displayName;
            }
        }

        const videoSrc = `/api/stream/${encodeURIComponent(torrentId)}/${fileIndex}`;
        this.videoPlayer.src = videoSrc;
        this.videoPlayer.load();

        const autoplay = () => {
            this.videoPlayer.play().catch(() => {
                console.warn('Autoplay bloqueado por el navegador');
            });
        };

        this.videoPlayer.addEventListener('loadeddata', autoplay, { once: true });
        this.showLoading(false);
    }

    stopMonitoringTorrent(torrentId) {
        if (this.torrentStatusTimers.has(torrentId)) {
            clearTimeout(this.torrentStatusTimers.get(torrentId));
            this.torrentStatusTimers.delete(torrentId);
        }
    }

    initializeApp() {
        this.setupEventListeners();
        this.initializeWebTorrent();
        this.loadPopularTorrents();
    }

    setupEventListeners() {
        // Search functionality
        document.getElementById('searchBtn').addEventListener('click', () => this.performSearch());
        document.getElementById('searchInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.performSearch();
        });

        // Player controls
        document.getElementById('playPauseBtn').addEventListener('click', () => this.togglePlayPause());
        document.getElementById('closePlayer').addEventListener('click', () => this.closePlayer());

        // Video player events
        this.videoPlayer.addEventListener('timeupdate', () => this.updateTimeDisplay());
        this.videoPlayer.addEventListener('loadedmetadata', () => this.updateDurationDisplay());

        // Filter and sort events
        document.getElementById('sortSelect').addEventListener('change', () => this.performSearch());
        document.getElementById('qualitySelect').addEventListener('change', () => this.performSearch());
        document.getElementById('categorySelect').addEventListener('change', () => this.performSearch());
    }

    initializeWebTorrent() {
        try {
            if (!WebTorrent.WEBRTC_SUPPORT) {
                throw new Error('Este navegador no soporta WebRTC');
            }
            // Initialize WebTorrent client
            this.client = new WebTorrent();
            console.log('WebTorrent client initialized successfully');
        } catch (error) {
            console.error('Error initializing WebTorrent:', error);
            this.showError('Error al inicializar el cliente de torrents');
        }
    }

    async performSearch() {
        const query = document.getElementById('searchInput').value.trim();
        if (!query) {
            this.showError('Por favor ingresa un término de búsqueda');
            return;
        }

        this.showLoading(true);
        this.hideError();

        try {
            // Simulate torrent search (in real implementation, this would call actual torrent APIs)
            const results = await this.searchTorrents(query);
            this.displayResults(results);
        } catch (error) {
            console.error('Search error:', error);
            this.showError('Error al buscar torrents. Intenta nuevamente.');
        } finally {
            this.showLoading(false);
        }
    }

    async searchTorrents(query) {
        try {
            const response = await fetch(`/api/search?query=${encodeURIComponent(query)}&category=${document.getElementById('categorySelect').value}&sort=${document.getElementById('sortSelect').value}&limit=20`);
            
            if (!response.ok) {
                throw new Error('Search failed');
            }
            
            const results = await response.json();
            return results.map((result) => ({
                ...result,
                leechs: result.leechs ?? result.peers ?? 0,
                category: result.category || 'music',
                quality: result.quality || 'Audio',
                description: result.description || this.buildDescriptionFromFiles(result.files),
                files: result.files || []
            }));
        } catch (error) {
            console.error('Search error:', error);
            this.showError('No se pudo obtener resultados en este momento');
            return [];
        }
    }

    getMockResults(query) {
        return [
            {
                name: `${query} (2024) [1080p] [BluRay] [5.1]`,
                size: '2.4 GB',
                seeds: 1247,
                leechs: 89,
                category: 'movies',
                quality: '1080p',
                magnet: `magnet:?xt=urn:btih:1234567890abcdef&dn=${encodeURIComponent(query)}&tr=udp://tracker.opentrackr.org:1337/announce`,
                description: `Película ${query} en alta calidad 1080p con audio 5.1`
            },
            {
                name: `${query} (2024) [720p] [WEBRip] [YTS]`,
                size: '1.1 GB',
                seeds: 892,
                leechs: 156,
                category: 'movies',
                quality: '720p',
                magnet: `magnet:?xt=urn:btih:abcdef1234567890&dn=${encodeURIComponent(query)}&tr=udp://tracker.opentrackr.org:1337/announce`,
                description: `Versión 720p optimizada para descarga rápida`
            }
        ];
    }

    displayResults(results) {
        const resultsSection = document.getElementById('resultsSection');
        const torrentResults = document.getElementById('torrentResults');
        
        // Clear previous results
        torrentResults.innerHTML = '';

        if (!results.length) {
            resultsSection.classList.remove('hidden');
            torrentResults.innerHTML = '<p class="text-slate-400 text-center py-10">No se encontraron torrents que coincidan con tu búsqueda.</p>';
            return;
        }
        
        // Apply filters and sorting
        const sortBy = document.getElementById('sortSelect').value;
        const minQuality = parseInt(document.getElementById('qualitySelect').value);
        const category = document.getElementById('categorySelect').value;

        let filteredResults = results.filter(torrent => {
            if (category !== 'all' && torrent.category !== category) return false;
            if ((torrent.seeds || 0) < minQuality) return false;
            return true;
        });

        // Sort results
        filteredResults.sort((a, b) => {
            switch (sortBy) {
                case 'seeds': return b.seeds - a.seeds;
                case 'size': return this.parseSize(b.size) - this.parseSize(a.size);
                case 'date': return Math.random() - 0.5; // Random for demo
                case 'peers': return (b.seeds + b.leechs) - (a.seeds + a.leechs);
                default: return b.seeds - a.seeds;
            }
        });

        if (!filteredResults.length) {
            torrentResults.innerHTML = '<p class="text-slate-400 text-center py-10">No hay resultados en esta categoría con los filtros aplicados.</p>';
        } else {
            filteredResults.forEach((torrent, index) => {
                const torrentCard = this.createTorrentCard(torrent, index);
                torrentResults.appendChild(torrentCard);
            });
        }

        resultsSection.classList.remove('hidden');
        resultsSection.scrollIntoView({ behavior: 'smooth' });
    }

    createTorrentCard(torrent, index) {
        const card = document.createElement('div');
        card.className = 'torrent-card bg-slate-800/50 backdrop-blur-sm rounded-xl p-6 border border-slate-700 hover:border-slate-600 transition-all cursor-pointer fade-in';
        card.style.animationDelay = `${index * 0.1}s`;
        
        const categoryColors = {
            movies: 'bg-blue-600',
            tv: 'bg-green-600',
            music: 'bg-purple-600',
            games: 'bg-red-600',
            software: 'bg-yellow-600',
            books: 'bg-indigo-600'
        };

        const categoryNames = {
            movies: 'Película',
            tv: 'Serie TV',
            music: 'Música',
            games: 'Juegos',
            software: 'Software',
            books: 'Libros'
        };

        const description = torrent.description || this.buildDescriptionFromFiles(torrent.files);
        const seeds = Number(torrent.seeds) || 0;
        const leechs = Number(torrent.leechs) || 0;
        const safeName = this.escapeHtml(torrent.name || 'Audio sin título');
        const safeDescription = this.escapeHtml(description || 'Contenido de audio');
        const safeSize = this.escapeHtml(torrent.size || 'Tamaño desconocido');

        card.innerHTML = `
            <div class="flex items-start justify-between mb-4">
                <div class="flex-1">
                    <div class="flex items-center space-x-2 mb-2">
                        <span class="text-xs ${categoryColors[torrent.category] || 'bg-gray-600'} px-2 py-1 rounded-full">
                            ${categoryNames[torrent.category] || 'Otro'}
                        </span>
                        <span class="text-xs bg-slate-600 px-2 py-1 rounded-full">${this.escapeHtml(torrent.quality || 'Audio')}</span>
                    </div>
                    <h4 class="font-semibold text-lg mb-2 text-white hover:text-blue-400 transition-colors">
                        ${safeName}
                    </h4>
                    <p class="text-sm text-slate-400 mb-3">${safeDescription}</p>
                </div>
                <div class="text-right ml-4">
                    <div class="text-lg font-bold text-white">${safeSize}</div>
                </div>
            </div>
            
            <div class="flex items-center justify-between">
                <div class="flex items-center space-x-4">
                    <div class="flex items-center space-x-1">
                        <i class="fas fa-arrow-up seed text-xs"></i>
                        <span class="seed text-sm font-medium">${seeds}</span>
                    </div>
                    <div class="flex items-center space-x-1">
                        <i class="fas fa-arrow-down leech text-xs"></i>
                        <span class="leech text-sm font-medium">${leechs}</span>
                    </div>
                </div>
                <div class="flex items-center space-x-2">
                    <button data-action="play"
                            class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center space-x-2">
                        <i class="fas fa-play text-xs"></i>
                        <span>Reproducir</span>
                    </button>
                    <button data-action="download"
                            class="bg-slate-600 hover:bg-slate-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center space-x-2">
                        <i class="fas fa-download text-xs"></i>
                        <span>Descargar</span>
                    </button>
                </div>
            </div>
        `;

        const playButton = card.querySelector('[data-action="play"]');
        const downloadButton = card.querySelector('[data-action="download"]');

        if (playButton) {
            if (!torrent.magnet) {
                playButton.disabled = true;
                playButton.classList.add('opacity-50', 'cursor-not-allowed');
            } else {
                playButton.addEventListener('click', (event) => {
                    event.stopPropagation();
                    this.playTorrent(torrent.magnet, torrent.name);
                });
            }
        }

        if (downloadButton) {
            if (!torrent.magnet) {
                downloadButton.disabled = true;
                downloadButton.classList.add('opacity-50', 'cursor-not-allowed');
            } else {
                downloadButton.addEventListener('click', (event) => {
                    event.stopPropagation();
                    this.downloadTorrent(torrent.magnet, torrent.name);
                });
            }
        }

        return card;
    }

    async playTorrent(magnetURI, name) {
        if (!magnetURI) {
            this.showError('No se encontró un enlace magnet válido para este torrent');
            return;
        }

        try {
            this.showPlayer();
            this.showLoading(true);
            const torrentInfo = await this.startBackendTorrent(magnetURI);
            this.currentBackendTorrentId = torrentInfo.torrentId;
            this.monitorTorrentStatus(torrentInfo.torrentId, name);
        } catch (error) {
            console.error('Error playing torrent:', error);
            this.showError('Error al reproducir el torrent');
            this.showLoading(false);
            
            // Fallback to client-side streaming
            try {
                await this.playTorrentClientSide(magnetURI, name);
            } catch (fallbackError) {
                console.error('Client-side fallback failed:', fallbackError);
            }
        }
    }

    playTorrentClientSide(magnetURI, name) {
        return new Promise((resolve, reject) => {
            if (!this.client) {
                reject(new Error('Cliente WebTorrent no inicializado'));
                return;
            }

            const startPlayback = (torrent) => {
                if (this.currentTorrent && this.currentTorrent !== torrent && !this.isTorrentInDownloads(this.currentTorrent)) {
                    this.currentTorrent.destroy();
                }

                this.currentTorrent = torrent;
                this.setupTorrentEvents(torrent, name);

                if (torrent.ready) {
                    this.findAndPlayMediaFile(torrent, name);
                } else {
                    torrent.once('ready', () => this.findAndPlayMediaFile(torrent, name));
                }

                resolve();
            };

            const existingTorrent = this.client.get(magnetURI);
            if (existingTorrent) {
                if (existingTorrent.ready) {
                    startPlayback(existingTorrent);
                } else {
                    existingTorrent.once('ready', () => startPlayback(existingTorrent));
                }
                return;
            }

            if (this.currentTorrent && !this.isTorrentInDownloads(this.currentTorrent)) {
                this.currentTorrent.destroy();
                this.currentTorrent = null;
            }

            let torrentInstance;
            try {
                torrentInstance = this.client.add(magnetURI, this.getTorrentOptions());
            } catch (error) {
                reject(error);
                return;
            }

            const onError = (error) => {
                torrentInstance.removeListener('ready', onReady);
                reject(error);
            };

            const onReady = () => {
                torrentInstance.removeListener('error', onError);
                startPlayback(torrentInstance);
            };

            torrentInstance.once('error', onError);
            torrentInstance.once('ready', onReady);
        });
    }

    setupTorrentEvents(torrent, name) {
        if (torrent.__streamEventsAttached) {
            return;
        }
        torrent.__streamEventsAttached = true;

        torrent.on('download', () => {
            this.updateProgress(torrent);
            this.updateSpeeds(torrent);
        });

        torrent.on('done', () => {
            console.log('Torrent download completed:', name);
            this.showLoading(false);
        });

        torrent.on('error', (error) => {
            console.error('Torrent error:', error);
            this.showError('Error en el torrent');
            this.showLoading(false);
        });
    }

    async downloadTorrent(magnetURI, name) {
        try {
            if (!magnetURI) {
                this.showError('No se puede descargar sin enlace magnet');
                return;
            }

            const torrentInfo = await this.startBackendTorrent(magnetURI);
            const torrentId = torrentInfo.torrentId;

            if (this.activeDownloads.has(torrentId)) {
                this.showError('Este torrent ya está en descarga');
                return;
            }

            this.activeDownloads.set(torrentId, {
                torrentId,
                name: name || torrentInfo.name || 'Descarga sin título',
                status: 'downloading',
                progress: 0,
                downloadSpeed: 0,
                downloadUrl: null,
                fileName: null
            });

            this.updateDownloadsList();
            this.pollDownloadStatus(torrentId);

        } catch (error) {
            console.error('Error downloading torrent:', error);
            this.showError('Error al descargar el torrent');
        }
    }

    findAndPlayMediaFile(torrent, displayName = '') {
        if (!torrent.files || !torrent.files.length) {
            this.showError('El torrent no contiene archivos reproducibles');
            this.showLoading(false);
            return;
        }

        const audioExtensions = ['mp3', 'flac', 'aac', 'm4a', 'wav', 'ogg', 'opus'];
        const videoExtensions = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'webm'];

        const audioFiles = torrent.files.filter(file => audioExtensions.includes(this.getFileExtension(file.name)));
        const videoFiles = torrent.files.filter(file => videoExtensions.includes(this.getFileExtension(file.name)));
        const preferredFiles = audioFiles.length ? audioFiles : videoFiles;

        if (!preferredFiles.length) {
            this.showError('No se encontraron archivos de audio compatibles en este torrent');
            this.showLoading(false);
            return;
        }

        const selectedFile = preferredFiles.reduce((prev, current) => (current.length > prev.length ? current : prev));
        this.playerPlaceholder.style.display = 'none';
        this.videoPlayer.style.display = 'block';
        this.videoPlayer.removeAttribute('src');
        this.videoPlayer.load();

        selectedFile.renderTo(this.videoPlayer, { autoplay: true }, (error) => {
            if (error) {
                console.error('Render error:', error);
                this.showError('No se pudo iniciar la reproducción');
            }
            this.showLoading(false);
        });

        const titleElement = document.getElementById('playerTitle');
        if (titleElement) {
            titleElement.textContent = displayName || selectedFile.name;
        }

        this.videoPlayer.play().catch(() => {
            // Ignorar autoplay bloqueado; usuario puede presionar play manualmente
        });
    }

    pollDownloadStatus(torrentId) {
        const pollKey = `download-${torrentId}`;
        const encodedId = encodeURIComponent(torrentId);

        const poll = async () => {
            try {
                const response = await fetch(`/api/torrent/${encodedId}/status`);
                if (!response.ok) {
                    throw new Error('Estado de descarga no disponible');
                }

                const status = await response.json();
                const download = this.activeDownloads.get(torrentId);
                if (!download) {
                    return;
                }

                download.progress = Math.round((status.progress || 0) * 100);
                download.downloadSpeed = status.downloadSpeed || 0;
                download.status = status.done ? 'completed' : 'downloading';

                if (status.files && status.files.length) {
                    const fileMeta = status.files.find(file => file.isAudio) || status.files[0];
                    if (fileMeta) {
                        download.downloadUrl = fileMeta.downloadUrl;
                        download.fileName = fileMeta.name;
                    }
                }

                this.activeDownloads.set(torrentId, download);
                this.updateDownloadsList();

                if (!status.done) {
                    const handle = setTimeout(poll, 2000);
                    this.torrentStatusTimers.set(pollKey, handle);
                } else {
                    this.torrentStatusTimers.delete(pollKey);
                }
            } catch (error) {
                console.error('Error actualizando descarga:', error);
                this.torrentStatusTimers.delete(pollKey);
            }
        };

        poll();
    }

    updateProgress(torrent) {
        const progress = Math.round(torrent.progress * 100);
        document.getElementById('progressBar').style.width = `${progress}%`;
        document.getElementById('progressPercent').textContent = `${progress}%`;
    }

    updateProgressFromBackend(status) {
        const progressPercent = Math.round((status.progress || 0) * 100);
        document.getElementById('progressBar').style.width = `${progressPercent}%`;
        document.getElementById('progressPercent').textContent = `${progressPercent}%`;

        const downloadSpeed = this.formatSpeed(status.downloadSpeed || 0);
        const uploadSpeed = this.formatSpeed(status.uploadSpeed || 0);

        document.getElementById('downloadSpeed').textContent = downloadSpeed;
        document.getElementById('uploadSpeed').textContent = uploadSpeed;
    }

    updateSpeeds(torrent) {
        const downloadSpeed = (torrent.downloadSpeed / 1024 / 1024).toFixed(2);
        const uploadSpeed = (torrent.uploadSpeed / 1024 / 1024).toFixed(2);
        
        document.getElementById('downloadSpeed').textContent = `${downloadSpeed} MB/s`;
        document.getElementById('uploadSpeed').textContent = `${uploadSpeed} MB/s`;
    }

    updateTimeDisplay() {
        const currentTime = this.formatTime(this.videoPlayer.currentTime);
        document.getElementById('currentTime').textContent = currentTime;
    }

    updateDurationDisplay() {
        const duration = this.formatTime(this.videoPlayer.duration);
        document.getElementById('duration').textContent = duration;
    }

    formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    updateDownloadsList() {
        const downloadsContainer = document.getElementById('activeDownloads');
        downloadsContainer.innerHTML = '';

        if (this.activeDownloads.size === 0) {
            downloadsContainer.innerHTML = '<p class="text-slate-400 text-center py-8">No hay descargas activas</p>';
            return;
        }

        this.activeDownloads.forEach((download, torrentId) => {
            const { name, status, progress = 0, downloadSpeed = 0, downloadUrl } = download;
            const speedFormatted = this.formatSpeed(downloadSpeed);

            const downloadElement = document.createElement('div');
            downloadElement.className = 'bg-slate-800/50 backdrop-blur-sm rounded-xl p-4 border border-slate-700';
            downloadElement.innerHTML = `
                <div class="flex items-center justify-between mb-2">
                    <h4 class="font-semibold text-white truncate">${name}</h4>
                    <span class="text-xs px-2 py-1 rounded-full ${status === 'completed' ? 'bg-green-600' : 'bg-blue-600'}">
                        ${status === 'completed' ? 'Completado' : 'Descargando'}
                    </span>
                </div>
                <div class="flex items-center justify-between text-sm">
                    <div class="flex items-center space-x-4">
                        <span class="text-slate-400">Progreso: ${progress}%</span>
                        <span class="download-speed">${speedFormatted}</span>
                    </div>
                    <div class="flex items-center space-x-3">
                        ${downloadUrl && status === 'completed'
                            ? `<a href="${downloadUrl}" target="_blank" class="text-green-400 hover:text-green-200 transition-colors">
                                    <i class="fas fa-download text-sm"></i>
                               </a>`
                            : ''
                        }
                        <button onclick="torrentStream.removeDownload('${torrentId}')" 
                                class="text-red-400 hover:text-red-300 transition-colors">
                            <i class="fas fa-times text-sm"></i>
                        </button>
                    </div>
                </div>
                <div class="w-full bg-slate-700 rounded-full h-2 mt-2">
                    <div class="bg-blue-600 h-2 rounded-full transition-all" style="width: ${progress}%"></div>
                </div>
            `;
            
            downloadsContainer.appendChild(downloadElement);
        });
    }

    removeDownload(torrentId) {
        const download = this.activeDownloads.get(torrentId);
        if (download) {
            this.stopMonitoringTorrent(`download-${torrentId}`);
            this.activeDownloads.delete(torrentId);
            this.updateDownloadsList();
            fetch(`/api/torrent/${encodeURIComponent(torrentId)}`, { method: 'DELETE' }).catch(() => {});
        }
    }

    togglePlayPause() {
        if (this.videoPlayer.paused) {
            this.videoPlayer.play();
            document.getElementById('playPauseBtn').innerHTML = '<i class="fas fa-pause text-white"></i>';
        } else {
            this.videoPlayer.pause();
            document.getElementById('playPauseBtn').innerHTML = '<i class="fas fa-play text-white"></i>';
        }
    }

    showPlayer() {
        document.getElementById('playerSection').classList.remove('hidden');
        document.getElementById('playerSection').scrollIntoView({ behavior: 'smooth' });
    }

    closePlayer() {
        document.getElementById('playerSection').classList.add('hidden');
        if (this.currentBackendTorrentId) {
            this.stopMonitoringTorrent(this.currentBackendTorrentId);
            this.currentBackendTorrentId = null;
        }
        if (this.currentTorrent) {
            this.currentTorrent.destroy();
            this.currentTorrent = null;
        }
        this.videoPlayer.pause();
        this.videoPlayer.src = '';
        this.playerPlaceholder.style.display = 'block';
        this.videoPlayer.style.display = 'none';
    }

    showLoading(show) {
        const loadingState = document.getElementById('loadingState');
        if (show) {
            loadingState.classList.remove('hidden');
        } else {
            loadingState.classList.add('hidden');
        }
    }

    showError(message) {
        // Create or update error message
        let errorElement = document.getElementById('errorMessage');
        if (!errorElement) {
            errorElement = document.createElement('div');
            errorElement.id = 'errorMessage';
            errorElement.className = 'fixed top-20 right-4 bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg z-50';
            document.body.appendChild(errorElement);
        }
        
        errorElement.textContent = message;
        errorElement.classList.remove('hidden');
        
        setTimeout(() => {
            errorElement.classList.add('hidden');
        }, 5000);
    }

    hideError() {
        const errorElement = document.getElementById('errorMessage');
        if (errorElement) {
            errorElement.classList.add('hidden');
        }
    }

    buildDescriptionFromFiles(files = []) {
        if (!files || !files.length) {
            return '';
        }
        const preview = files.slice(0, 3).map(file => file.name).filter(Boolean);
        if (!preview.length) {
            return '';
        }
        const remaining = files.length - preview.length;
        return `Incluye: ${preview.join(', ')}${remaining > 0 ? ` y ${remaining} más` : ''}`;
    }

    escapeHtml(value = '') {
        return value
            .toString()
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    getFileExtension(filename = '') {
        const parts = filename.toLowerCase().split('.');
        return parts.length > 1 ? parts.pop() : '';
    }

    getTorrentOptions() {
        return {
            announce: [...this.webRtcTrackers]
        };
    }

    isTorrentInDownloads(torrent) {
        for (const download of this.activeDownloads.values()) {
            if (download.torrent && download.torrent === torrent) {
                return true;
            }
        }
        return false;
    }

    parseSize(sizeStr) {
        const units = { 'GB': 1024, 'MB': 1, 'KB': 1/1024 };
        const match = sizeStr.match(/([\d.]+)\s*(GB|MB|KB)/);
        if (match) {
            const [, size, unit] = match;
            return parseFloat(size) * (units[unit] || 1);
        }
        return 0;
    }

    formatSpeed(bytesPerSecond) {
        if (!bytesPerSecond) return '0 MB/s';
        return `${(bytesPerSecond / 1024 / 1024).toFixed(2)} MB/s`;
    }

    loadPopularTorrents() {
        // This would load popular torrents from APIs
        console.log('Loading popular torrents...');
    }
}

// Global functions for onclick handlers
function searchPopular(query) {
    document.getElementById('searchInput').value = query;
    torrentStream.performSearch();
}

// Initialize the app
let torrentStream;
document.addEventListener('DOMContentLoaded', () => {
    torrentStream = new TorrentStream();
});

// Handle page visibility changes to pause/resume downloads
document.addEventListener('visibilitychange', () => {
    if (torrentStream && torrentStream.client) {
        if (document.hidden) {
            // Pause non-essential operations when tab is hidden
            console.log('Tab hidden - optimizing performance');
        } else {
            // Resume operations when tab is visible
            console.log('Tab visible - resuming operations');
        }
    }
});
