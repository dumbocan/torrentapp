/**
 * TorrentStream Frontend Controller
 *
 * Este archivo mantiene un único objeto de alto nivel para agrupar
 * toda la lógica de la interfaz. Aunque no usamos un framework,
 * separamos responsabilidades (API, reproductor, UI) mediante métodos
 * bien documentados para facilitar el mantenimiento desde un enfoque MVC.
 */
class TorrentStream {
    /**
     * Constructor: inicializa dependencias y referencias a elementos del DOM.
     */
    constructor() {
        this.client = null;
        this.currentTorrent = null;
        this.activeDownloads = new Map();
        this.audioPlayer = document.getElementById('audioPlayer');
        this.playerTitleElement = document.getElementById('nowPlayingTitle');
        this.playerMetaElement = document.getElementById('nowPlayingMeta');
        this.playerCoverElement = document.getElementById('nowPlayingCover');
        this.heroBackdrop = document.getElementById('heroBackdrop');
        this.playQueue = [];
        this.currentQueueItem = null;
        this.isQueueProcessing = false;
        this.queueListElement = document.getElementById('playQueueList');
        this.localFirst = true;
        this.filterLosslessOnly = false;
        this.searchMode = 'tracks';
        this.lastQuery = '';
        this.currentResults = [];
        this.resultIndex = new Map();
        this.playbackStatusLimit = 12;
        this.backendStreams = new Set();
        this.coverCache = new Map();
        this.webRtcTrackers = [
            'wss://tracker.openwebtorrent.com',
            'wss://tracker.btorrent.xyz',
            'wss://tracker.files.fm:7073/announce',
            'wss://tracker.webtorrent.dev'
        ];
        this.torrentStatusTimers = new Map();
        this.currentBackendTorrentId = null;
        this.albumDetailSection = document.getElementById('albumDetailSection');
        this.albumDetailHero = document.getElementById('albumDetailHero');
        this.albumDetailCover = document.getElementById('albumDetailCover');
        this.albumDetailTitle = document.getElementById('albumDetailTitle');
        this.albumDetailArtist = document.getElementById('albumDetailArtist');
        this.albumDetailMetaTracks = document.getElementById('albumDetailMetaTracks');
        this.albumDetailMetaSize = document.getElementById('albumDetailMetaSize');
        this.albumDetailMetaSource = document.getElementById('albumDetailMetaSource');
        this.albumDetailDescription = document.getElementById('albumDetailDescription');
        this.albumDetailTracklist = document.getElementById('albumDetailTracklist');
        this.currentAlbumDetail = null;
        this.artistSpotlightSection = document.getElementById('artistSpotlight');
        this.artistSpotlightHero = document.getElementById('artistSpotlightHero');
        this.artistSpotlightCover = document.getElementById('artistSpotlightCover');
        this.artistSpotlightTitle = document.getElementById('artistSpotlightTitle');
        this.artistSpotlightArtist = document.getElementById('artistSpotlightArtist');
        this.artistSpotlightSummary = document.getElementById('artistSpotlightSummary');
        this.artistSpotlightPlay = document.getElementById('artistSpotlightPlay');
        this.artistSpotlightQueue = document.getElementById('artistSpotlightQueue');
        this.currentSpotlightAlbum = null;
        this.albumGallerySection = document.getElementById('albumGallerySection');
        this.albumGalleryGrid = document.getElementById('albumGalleryGrid');
        this.albumGalleryClose = document.getElementById('albumGalleryClose');
        this.initializeApp();
    }

    /**
     * Añade una pista (o todas las pistas de un álbum) a la cola de reproducción.
     */
    addToQueue(torrent) {
        if (!torrent) return;
        const isTrackResolved = Boolean(torrent.best?.magnet || torrent.magnet);
        const chosenMagnet = torrent.best?.magnet || torrent.magnet || null;
        const alternatives = Array.isArray(torrent.alternatives)
            ? torrent.alternatives.map(alt => alt.magnet).filter(Boolean)
            : [];
        const queueEntry = {
            id: `queue-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            title: torrent.name || torrent.originalName || 'Elemento sin título',
            isLocal: Boolean(torrent.isLocal),
            magnet: chosenMagnet,
            alternatives,
            streamUrl: torrent.streamUrl || null,
            source: torrent.source || (torrent.isLocal ? 'Biblioteca' : 'Tracker'),
            size: torrent.size || '',
            quality: torrent.quality || '',
            trackKey: torrent.key || null
        };

            if (!queueEntry.isLocal && !queueEntry.magnet && !isTrackResolved) {
                this.showError('No se puede añadir a la cola sin enlace magnet');
                return;
            }
            if (queueEntry.isLocal && !queueEntry.streamUrl) {
            this.showError('Este archivo local no tiene streaming disponible');
            return;
        }

        this.playQueue.push(queueEntry);
        this.updateQueueUI();

        if (!this.isQueueProcessing && this.audioPlayer.paused) {
            this.playNextInQueue();
        }
    }

    /**
     * Reproduce la siguiente entrada de la cola.
     */
    playNextInQueue() {
        if (!this.playQueue.length) {
            this.currentQueueItem = null;
            this.isQueueProcessing = false;
            this.updateQueueUI();
            this.updateNowPlaying('Selecciona una canción', 'Tu cola está vacía.');
            return;
        }

        const nextItem = this.playQueue.shift();
        this.currentQueueItem = nextItem;
        this.isQueueProcessing = true;
        this.updateQueueUI();

        if (nextItem.isLocal && nextItem.streamUrl) {
            this.playLocalTrack(nextItem, { fromQueue: true });
            return;
        }

        if (nextItem.magnet) {
            this.playTorrent(nextItem.magnet, nextItem.title, {
                fromQueue: true,
                alternatives: nextItem.alternatives || [],
                trackKey: nextItem.trackKey || null
            });
            return;
        }

        this.isQueueProcessing = false;
        this.currentQueueItem = null;
        this.updateQueueUI();
        this.updateNowPlaying('Selecciona una canción', 'Tu cola está vacía.');
        this.playNextInQueue();
    }

    removeFromQueue(id) {
        this.playQueue = this.playQueue.filter(item => item.id !== id);
        this.updateQueueUI();
    }

    clearQueue() {
        this.playQueue = [];
        this.updateQueueUI();
    }

    updateQueueUI() {
        if (!this.queueListElement) return;
        this.queueListElement.innerHTML = '';

        if (!this.currentQueueItem && !this.playQueue.length) {
            this.queueListElement.innerHTML = '<p class="text-slate-500 text-sm">Tu cola está vacía.</p>';
            return;
        }

        if (this.currentQueueItem) {
            this.queueListElement.appendChild(this.createQueueItemElement(this.currentQueueItem, true));
        }

        this.playQueue.forEach(item => {
            this.queueListElement.appendChild(this.createQueueItemElement(item, false));
        });
    }

    createQueueItemElement(item, isPlaying) {
        const container = document.createElement('div');
        container.className = `queue-item bg-slate-800/50 rounded-xl p-4 border border-slate-700 flex items-center justify-between ${isPlaying ? 'playing' : ''}`;
        container.innerHTML = `
            <div>
                <p class="font-semibold text-white">${this.escapeHtml(item.title)}</p>
                <p class="text-xs text-slate-400">${this.escapeHtml(item.source || '')} · ${this.escapeHtml(item.quality || '')}</p>
            </div>
            <div class="flex items-center space-x-3 text-sm">
                ${isPlaying ? '<span class="text-emerald-400 flex items-center space-x-1"><i class="fas fa-equalizer text-xs"></i><span>Reproduciendo</span></span>' : `
                <button data-remove="${item.id}" class="text-slate-400 hover:text-white transition-colors">
                    <i class="fas fa-times text-xs"></i>
                </button>`}
            </div>
        `;

        if (!isPlaying) {
            container.querySelector('[data-remove]').addEventListener('click', () => this.removeFromQueue(item.id));
        }

        return container;
    }

    handleTrackEnded() {
        if (this.isQueueProcessing) {
            this.playNextInQueue();
        }
    }

    updateNowPlaying(title, meta, coverUrl = null) {
        if (this.playerTitleElement) {
            this.playerTitleElement.textContent = title || 'Reproduciendo';
        }
        if (this.playerMetaElement) {
            this.playerMetaElement.textContent = meta || '';
        }
        if (this.playerCoverElement) {
            if (coverUrl) {
                this.playerCoverElement.style.backgroundImage = `url('${coverUrl}')`;
                this.playerCoverElement.classList.add('bg-cover', 'bg-center');
                this.playerCoverElement.innerHTML = '';
            } else {
                this.playerCoverElement.style.backgroundImage = '';
                this.playerCoverElement.classList.remove('bg-cover', 'bg-center');
                this.playerCoverElement.innerHTML = '<i class="fas fa-music text-2xl"></i>';
            }
        }
    }

    /**
     * Consulta periódicamente el backend hasta que el torrent esté listo.
     */
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
                const progressPercent = Math.round((status.progress || 0) * 100);
                const summaryParts = [
                    `Progreso ${progressPercent}%`,
                    `${this.formatSpeed(status.downloadSpeed || 0)} ↓`,
                    `${this.formatSpeed(status.uploadSpeed || 0)} ↑`,
                    `${status.numPeers || 0} peers`
                ];
                this.setPlaybackSummary(summaryParts.join(' • '));

                if (!this.backendStreams.has(torrentId) && status.ready && status.files && status.files.length) {
                    const fileIndex = typeof status.streamableFileIndex === 'number'
                        ? status.streamableFileIndex
                        : (status.files.find(file => file.isAudio)?.index ?? status.files[0].index);
                    this.appendPlaybackStatus('Torrent listo. Iniciando streaming HTTP…');
                    this.backendStreams.add(torrentId);
                    this.streamFromBackend(torrentId, fileIndex, displayName || status.name, status.files[fileIndex]);
                }

                if (status.done) {
                    this.appendPlaybackStatus('Descarga completada. Continuando reproducción.');
                    this.setPlaybackSummary('Reproducción en curso (descarga completa).');
                    this.stopMonitoringTorrent(torrentId);
                } else {
                    const handle = setTimeout(poll, 1500);
                    this.torrentStatusTimers.set(torrentId, handle);
                }
            } catch (error) {
                console.error('Error monitorizando torrent:', error);
                this.appendPlaybackStatus(`Error monitorizando torrent: ${error.message}`);
                this.showError('No se pudo iniciar la reproducción desde el servidor');
                this.showLoading(false);
            }
        };

        poll();
    }

    /**
     * Solicita al backend el streaming HTTP de un archivo del torrent.
     */
    streamFromBackend(torrentId, fileIndex, displayName = '', fileMeta = null) {
        this.audioPlayer.style.display = 'block';
        this.updateNowPlaying(displayName || (fileMeta?.name ?? 'Reproduciendo torrent'), 'Streaming desde tracker');
        this.appendPlaybackStatus('Transmisión iniciada. Preparando audio...');
        this.setPlaybackSummary('Iniciando transmisión…');

        const audioSrc = `/api/stream/${encodeURIComponent(torrentId)}/${fileIndex}`;
        this.audioPlayer.src = audioSrc;
        this.audioPlayer.load();
        this.audioPlayer.play().catch(() => {
            console.warn('Autoplay bloqueado por el navegador');
            this.appendPlaybackStatus('Autoplay bloqueado. Pulsa Play para continuar.');
        });
        this.appendPlaybackStatus('Audio listo. Reproduciendo.');
        this.showLoading(false);
    }

    stopMonitoringTorrent(torrentId) {
        if (this.torrentStatusTimers.has(torrentId)) {
            clearTimeout(this.torrentStatusTimers.get(torrentId));
            this.torrentStatusTimers.delete(torrentId);
        }
        this.backendStreams.delete(torrentId);
    }

    /**
     * Arranca la aplicación enganchando eventos y preparando WebTorrent.
     */
    initializeApp() {
        this.setupEventListeners();
        this.initializeWebTorrent();
        this.loadPopularTorrents();
        this.updateHeroBackdrop('music');
    }

    /**
     * Registra todos los listeners de la interfaz.
     */
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
        this.audioPlayer.addEventListener('timeupdate', () => this.updateTimeDisplay());
        this.audioPlayer.addEventListener('loadedmetadata', () => this.updateDurationDisplay());
        this.audioPlayer.addEventListener('ended', () => this.handleTrackEnded());

        // Filter and sort events
        document.getElementById('sortSelect').addEventListener('change', () => this.performSearch());
        const localFirstCheckbox = document.getElementById('filterLocalFirst');
        if (localFirstCheckbox) {
            localFirstCheckbox.addEventListener('change', (event) => {
                this.localFirst = event.target.checked;
                this.performSearch();
            });
        }
        const losslessCheckbox = document.getElementById('filterLossless');
        if (losslessCheckbox) {
            losslessCheckbox.addEventListener('change', (event) => {
                this.filterLosslessOnly = event.target.checked;
                this.performSearch();
            });
        }
        const clearStatusBtn = document.getElementById('clearStatusBtn');
        if (clearStatusBtn) {
            clearStatusBtn.addEventListener('click', () => this.clearStatusLog());
        }
        document.querySelectorAll('[data-search-mode]').forEach(button => {
            button.addEventListener('click', (event) => {
                const mode = event.currentTarget.getAttribute('data-search-mode');
                if (mode) {
                    this.searchMode = mode;
                    document.querySelectorAll('[data-search-mode]').forEach(btn => {
                        btn.classList.remove('bg-blue-600');
                        btn.classList.add('bg-slate-700');
                    });
                    event.currentTarget.classList.remove('bg-slate-700');
                    event.currentTarget.classList.add('bg-blue-600');
                    this.performSearch();
                }
            });
        });

        const clearQueueBtn = document.getElementById('clearQueueBtn');
        if (clearQueueBtn) {
            clearQueueBtn.addEventListener('click', () => this.clearQueue());
        }
        const albumDetailBack = document.getElementById('albumDetailBack');
        if (albumDetailBack) {
            albumDetailBack.addEventListener('click', () => this.hideAlbumDetail());
        }
        const albumDetailPlay = document.getElementById('albumDetailPlay');
        if (albumDetailPlay) {
            albumDetailPlay.addEventListener('click', () => {
                if (this.currentAlbumDetail?.tracks?.length) {
                    this.playAlbumTracks(this.currentAlbumDetail.tracks);
                }
            });
        }
        const albumDetailQueue = document.getElementById('albumDetailQueue');
        if (albumDetailQueue) {
            albumDetailQueue.addEventListener('click', () => {
                if (this.currentAlbumDetail?.tracks?.length) {
                    this.currentAlbumDetail.tracks.forEach(track => this.addToQueue(track));
                }
            });
        }
        if (this.artistSpotlightPlay) {
            this.artistSpotlightPlay.addEventListener('click', () => {
                if (this.currentSpotlightAlbum) {
                    if (Array.isArray(this.currentSpotlightAlbum.tracks) && this.currentSpotlightAlbum.tracks.length) {
                        this.playAlbumTracks(this.currentSpotlightAlbum.tracks);
                    } else if (this.currentSpotlightAlbum.magnet) {
                        this.playTorrent(this.currentSpotlightAlbum.magnet, this.currentSpotlightAlbum.name);
                    }
                }
            });
        }
        if (this.artistSpotlightQueue) {
            this.artistSpotlightQueue.addEventListener('click', () => {
                if (this.currentSpotlightAlbum?.tracks?.length) {
                    this.currentSpotlightAlbum.tracks.forEach(track => this.addToQueue(track));
                }
            });
        }
        document.querySelectorAll('button[data-section]').forEach(button => {
            button.addEventListener('click', (event) => {
                const target = event.currentTarget.getAttribute('data-section');
                this.scrollToSection(target);
            });
        });
        if (this.albumGalleryClose) {
            this.albumGalleryClose.addEventListener('click', () => {
                this.albumGallerySection.classList.add('hidden');
            });
        }
    }

    initializeWebTorrent() {
    }

    /**
     * Ejecuta una búsqueda usando los parámetros actuales y refresca la UI.
     */
    async performSearch() {
        const query = document.getElementById('searchInput').value.trim();
        if (!query) {
            this.showError('Por favor ingresa un término de búsqueda');
            return;
        }

        this.lastQuery = query;
        this.showLoading(true);
        this.hideError();
        this.updateHeroBackdrop(query);

        this.resetResults();
        this.clearStatusLog();
        this.pushStatusMessage('Buscando en tu biblioteca local…');

        try {
            const localResults = await this.fetchLocalResults(query);
            if (localResults.length) {
                this.pushStatusMessage(`Biblioteca: ${localResults.length} coincidencias`);
                this.addResults(localResults);
            } else {
                this.pushStatusMessage('Biblioteca: sin coincidencias');
            }
        } catch (error) {
            console.error('Local search error:', error);
            this.pushStatusMessage('Biblioteca: error al buscar');
        }

        try {
            this.pushStatusMessage('Consultando historial en base de datos…');
            const cachedResults = await this.fetchCachedResults(query);
            if (cachedResults.length) {
                this.pushStatusMessage(`Cache local: ${cachedResults.length} resultados`);
                this.addResults(cachedResults);
            } else {
                this.pushStatusMessage('Cache local: sin coincidencias recientes');
            }
        } catch (error) {
            console.error('Cache search error:', error);
            this.pushStatusMessage('Cache local: error al buscar');
        }

        try {
            this.pushStatusMessage('Consultando trackers públicos…');
            const remoteResults = await this.fetchRemoteResults(query);
            if (remoteResults.length) {
                this.pushStatusMessage(`Trackers: ${remoteResults.length} resultados`);
                this.addResults(remoteResults);
            } else {
                this.pushStatusMessage('Trackers: sin resultados');
            }
        } catch (error) {
            console.error('Remote search error:', error);
            this.pushStatusMessage('Trackers: error al buscar');
        } finally {
            this.showLoading(false);
        }

        if (this.currentResults.length) {
            await this.updateMetadataSuggestions(this.lastQuery);
        }
    }

    async fetchLocalResults(query) {
        const params = new URLSearchParams({
            q: query,
            limit: '100',
            mode: this.searchMode
        });
        const response = await fetch(`/api/library/search?${params.toString()}`);
        if (!response.ok) {
            throw new Error('Local search failed');
        }
        const payload = await response.json();
        return (payload?.tracks || []).map(track => ({
            ...track,
            isLocal: true,
            category: track.category || 'library',
            source: 'Biblioteca'
        }));
    }

    async fetchRemoteResults(query) {
        const params = new URLSearchParams({
            query,
            limit: '30',
            mode: this.searchMode,
            includeLocal: 'false'
        });
        const response = await fetch(`/api/search?${params.toString()}`);
        if (!response.ok) {
            throw new Error('Remote search failed');
        }
        const data = await response.json();
        const logs = Array.isArray(data) ? [] : (data.logs || []);
        this.applyServerLogs(logs);
        if (Array.isArray(data)) {
            return data;
        }
        return data.results || [];
    }

    async fetchCachedResults(query) {
        const params = new URLSearchParams({
            query,
            limit: '50'
        });
        const response = await fetch(`/api/search/cache?${params.toString()}`);
        if (!response.ok) {
            throw new Error('Cache search failed');
        }
        const payload = await response.json();
        return payload?.results || [];
    }

    normalizeResult(result) {
        const isLocal = Boolean(result.isLocal);
        return {
            ...result,
            isLocal,
            leechs: isLocal ? 0 : (result.leechs ?? result.peers ?? 0),
            category: result.category || (isLocal ? 'library' : 'music'),
            quality: result.quality || (isLocal ? 'Archivo local' : 'Audio'),
            description: result.description || this.buildDescriptionFromFiles(result.files),
            files: result.files || []
        };
    }

    buildResultKey(result) {
        return result.id ||
            result.infoHash ||
            result.magnet ||
            result.downloadUrl ||
            `${(result.name || '').toLowerCase()}-${result.source || ''}`;
    }

    resetResults() {
        this.resultIndex.clear();
        this.currentResults = [];
        const torrentResults = document.getElementById('torrentResults');
        if (torrentResults) {
            torrentResults.innerHTML = '';
        }
        const resultsSection = document.getElementById('resultsSection');
        if (resultsSection) {
            resultsSection.classList.add('hidden');
        }
        this.updateSuggestions([]);
        this.hideAlbumDetail();
        this.currentSpotlightAlbum = null;
        if (this.artistSpotlightSection) {
            this.artistSpotlightSection.classList.add('hidden');
        }
    }

    addResults(results = []) {
        results.forEach(item => {
            const normalized = this.normalizeResult(item);
            const key = this.buildResultKey(normalized);
            this.resultIndex.set(key, normalized);
        });
        this.currentResults = Array.from(this.resultIndex.values());
        this.renderCurrentResults();
    }

    sortResults(results = []) {
        const sortBy = document.getElementById('sortSelect')?.value || 'relevance';
        return [...results].sort((a, b) => {
            switch (sortBy) {
                case 'seeds':
                    return (b.seeds || 0) - (a.seeds || 0);
                case 'size':
                    return this.parseSize(b.size || '') - this.parseSize(a.size || '');
                case 'date':
                    return (b.addedAt || 0) - (a.addedAt || 0);
                default:
                    return 0;
            }
        });
    }

    renderCurrentResults() {
        const resultsSection = document.getElementById('resultsSection');
        const torrentResults = document.getElementById('torrentResults');
        if (!resultsSection || !torrentResults) return;

        const filtered = this.filterLosslessOnly
            ? this.currentResults.filter(item => {
                const quality = (item.quality || '').toLowerCase();
                return quality.includes('flac') || quality.includes('lossless') || /flac|alac|lossless/i.test(item.name || '');
            })
            : [...this.currentResults];

        torrentResults.innerHTML = '';

        if (!filtered.length) {
            torrentResults.innerHTML = '<p class="text-slate-400 text-center py-10">No se encontraron resultados para esta búsqueda.</p>';
            resultsSection.classList.remove('hidden');
            this.updateSuggestions([]);
            return;
        }

        const localResults = filtered.filter(item => item.isLocal);
        const remoteResults = filtered.filter(item => !item.isLocal);
        const groups = this.localFirst
            ? [
                { title: 'Tu biblioteca', items: localResults },
                { title: 'Trackers públicos', items: remoteResults }
            ]
            : [
                { title: 'Trackers públicos', items: remoteResults },
                { title: 'Tu biblioteca', items: localResults }
            ];

        groups.forEach(group => {
            if (!group.items.length) return;
            const wrapper = document.createElement('div');
            wrapper.className = 'space-y-3';
            wrapper.innerHTML = `<h4 class="text-lg font-semibold text-slate-200">${group.title}</h4>`;
            const cardsContainer = document.createElement('div');
            cardsContainer.className = 'grid gap-4';
            this.sortResults(group.items).forEach((torrent, index) => {
                const card = this.createTorrentCard(torrent, index);
                cardsContainer.appendChild(card);
            });
            wrapper.appendChild(cardsContainer);
            torrentResults.appendChild(wrapper);
        });

        this.updateSuggestions(filtered);
        this.updateArtistSpotlight(filtered);
        this.renderAlbumGallery(filtered);
        resultsSection.classList.remove('hidden');
        resultsSection.scrollIntoView({ behavior: 'smooth' });
    }

    getFirstAlbumResult() {
        const albums = this.currentResults.filter(item => item.type === 'album' || item.category === 'library-album');
        if (!albums.length) return null;
        const local = albums.find(item => item.isLocal);
        return local || albums[0];
    }

    scrollToSection(section) {
        if (!section) return;
        if (section === 'results' && this.albumDetailSection) {
            this.hideAlbumDetail();
            const resultsSection = document.getElementById('resultsSection');
            if (resultsSection) {
                resultsSection.scrollIntoView({ behavior: 'smooth' });
            }
            return;
        }
        const map = {
            albumDetail: this.albumDetailSection,
            queue: document.getElementById('queueSection'),
            downloads: document.getElementById('downloadsSection')
        };
        if (section === 'albumDetail') {
            if (!this.currentAlbumDetail) {
                const album = this.getFirstAlbumResult();
                if (album) {
                    this.showAlbumDetail(album);
                } else {
                    this.performSearch();
                    return;
                }
            }
            if (this.albumDetailSection) {
                this.albumDetailSection.classList.remove('hidden');
                this.albumDetailSection.scrollIntoView({ behavior: 'smooth' });
            }
            return;
        }
        const target = map[section];
        if (target) {
            target.classList.remove('hidden');
            target.scrollIntoView({ behavior: 'smooth' });
            return;
        }
        if (section === 'albums' && this.albumGallerySection) {
            this.albumGallerySection.classList.remove('hidden');
            this.albumGallerySection.scrollIntoView({ behavior: 'smooth' });
        }
    }

    getCoverImage(torrent) {
        const key = this.buildCoverCacheKey(torrent);
        if (key && this.coverCache.has(key)) {
            return this.coverCache.get(key);
        }
        const trackCover = torrent.tracks?.[0]?.coverUrl || torrent.tracks?.[0]?.artworkUrl;
        const candidates = [
            torrent.coverUrl,
            torrent.artworkUrl,
            trackCover,
            torrent.imageUrl
        ].filter(Boolean);
        if (candidates.length) {
            if (key) this.coverCache.set(key, candidates[0]);
            return candidates[0];
        }
        return null;
    }

    buildCoverCacheKey(torrent) {
        const name = torrent.album || torrent.name || '';
        const artist = torrent.artist || torrent.tracks?.[0]?.artist || '';
        if (!name && !artist) return null;
        return `${artist.toLowerCase()}::${name.toLowerCase()}`;
    }

    async ensureAlbumCover(torrent, targetElement) {
        if (!targetElement || torrent.coverUrl) return;
        const cacheKey = this.buildCoverCacheKey(torrent);
        if (cacheKey && this.coverCache.has(cacheKey)) {
            this.applyCoverToElement(targetElement, this.coverCache.get(cacheKey));
            torrent.coverUrl = this.coverCache.get(cacheKey);
            return;
        }
        const name = torrent.album || torrent.name || '';
        const artist = torrent.artist || torrent.tracks?.[0]?.artist || '';
        if (!name) return;
        try {
            const params = new URLSearchParams({
                name,
                artist
            });
            const response = await fetch(`/api/metadata/cover?${params.toString()}`);
            if (!response.ok) return;
            const payload = await response.json();
            if (payload.coverUrl) {
                torrent.coverUrl = payload.coverUrl;
                if (cacheKey) {
                    this.coverCache.set(cacheKey, payload.coverUrl);
                }
                this.applyCoverToElement(targetElement, payload.coverUrl);
            }
        } catch (error) {
            console.warn('Cover fetch failed:', error.message);
        }
    }

    applyCoverToElement(targetElement, coverUrl) {
        if (!coverUrl || !targetElement) return;
        targetElement.innerHTML = `<img src="${this.escapeHtml(coverUrl)}" class="w-full h-full object-cover" alt="Cover art">`;
    }

    triggerFileDownload(url) {
        if (!url) return;
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', '');
        link.target = '_self';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    updateArtistSpotlight(results = []) {
        if (!this.artistSpotlightSection) return;
        const albumRanker = (items) => items.filter(item => item.type === 'album' || item.category === 'library-album');
        const localAlbums = albumRanker(results.filter(item => item.isLocal));
        const remoteAlbums = albumRanker(results.filter(item => !item.isLocal));
        const album = localAlbums[0] || remoteAlbums[0];
        if (!album) {
            this.artistSpotlightSection.classList.add('hidden');
            this.currentSpotlightAlbum = null;
            return;
        }
        this.currentSpotlightAlbum = album;
        if (this.artistSpotlightTitle) {
            this.artistSpotlightTitle.textContent = album.name || album.album || 'Álbum destacado';
        }
        const artist = album.artist || album.tracks?.[0]?.artist || 'Artista desconocido';
        if (this.artistSpotlightArtist) {
            this.artistSpotlightArtist.textContent = artist;
        }
        if (this.artistSpotlightSummary) {
            this.artistSpotlightSummary.textContent = album.description || 'Disfruta de tus álbumes favoritos desde tu biblioteca o la red P2P.';
        }
        const coverUrl = this.getCoverImage(album);
        if (this.artistSpotlightCover) {
            if (coverUrl) {
                this.applyCoverToElement(this.artistSpotlightCover, coverUrl);
            } else {
                this.artistSpotlightCover.innerHTML = '<i class="fas fa-compact-disc text-3xl text-slate-500"></i>';
                this.ensureAlbumCover(album, this.artistSpotlightCover);
            }
        }
        if (this.artistSpotlightHero) {
            if (coverUrl) {
                this.artistSpotlightHero.style.backgroundImage = `linear-gradient(120deg, rgba(15,23,42,0.92), rgba(15,23,42,0.75)), url('${coverUrl}')`;
                this.artistSpotlightHero.style.backgroundSize = 'cover';
                this.artistSpotlightHero.style.backgroundPosition = 'center';
            } else {
                this.artistSpotlightHero.style.backgroundImage = '';
            }
        }
        this.artistSpotlightSection.classList.remove('hidden');
    }

    renderAlbumGallery(results = []) {
        if (!this.albumGallerySection || !this.albumGalleryGrid) return;
        const albums = results.filter(item => item.type === 'album' || item.category === 'library-album');
        if (!albums.length) {
            this.albumGallerySection.classList.add('hidden');
            return;
        }
        this.albumGalleryGrid.innerHTML = '';
        albums.slice(0, 8).forEach(album => {
            const card = document.createElement('button');
            card.className = 'text-left bg-slate-900/60 border border-slate-800 rounded-2xl p-4 hover:border-blue-500 transition flex flex-col space-y-4';
            const coverUrl = this.getCoverImage(album);
            const coverId = `gallery-cover-${Math.random().toString(36).slice(2, 8)}`;
            card.innerHTML = `
                <div class="w-full aspect-square rounded-xl overflow-hidden bg-slate-800 flex items-center justify-center" data-cover-id="${coverId}">
                    ${coverUrl
                        ? `<img src="${this.escapeHtml(coverUrl)}" class="w-full h-full object-cover" alt="${this.escapeHtml(album.name || '')}">`
                        : '<i class="fas fa-compact-disc text-slate-500 text-2xl"></i>'}
                </div>
                <div>
                    <p class="font-semibold text-white truncate">${this.escapeHtml(album.name || album.album || 'Álbum sin título')}</p>
                    <p class="text-sm text-slate-400 truncate">${this.escapeHtml(album.artist || album.tracks?.[0]?.artist || 'Artista desconocido')}</p>
                </div>
            `;
            card.addEventListener('click', () => this.showAlbumDetail(album));
            this.albumGalleryGrid.appendChild(card);
            if (!coverUrl) {
                const target = card.querySelector(`[data-cover-id="${coverId}"]`);
                this.ensureAlbumCover(album, target);
            }
        });
        this.albumGallerySection.classList.remove('hidden');
        if (this.albumGalleryClose) {
            this.albumGalleryClose.classList.remove('hidden');
        }
    }

    showAlbumDetail(torrent) {
        if (!torrent) return;
        this.currentAlbumDetail = torrent;
        if (this.albumDetailSection) {
            this.renderAlbumDetail(torrent);
            this.albumDetailSection.classList.remove('hidden');
            const resultsSection = document.getElementById('resultsSection');
            if (resultsSection) {
                resultsSection.classList.add('hidden');
            }
            this.albumDetailSection.scrollIntoView({ behavior: 'smooth' });
        }
    }

    hideAlbumDetail() {
        this.currentAlbumDetail = null;
        if (this.albumDetailSection) {
            this.albumDetailSection.classList.add('hidden');
        }
        const resultsSection = document.getElementById('resultsSection');
        if (resultsSection) {
            resultsSection.classList.remove('hidden');
        }
    }

    renderAlbumDetail(torrent) {
        if (!this.albumDetailSection || !torrent) return;
        const artist = torrent.artist || torrent.tracks?.[0]?.artist || 'Artista desconocido';
        const coverUrl = this.getCoverImage(torrent);
        const trackCount = torrent.trackCount || torrent.tracks?.length || 0;
        if (this.albumDetailTitle) {
            this.albumDetailTitle.textContent = torrent.name || torrent.album || 'Álbum sin título';
        }
        if (this.albumDetailArtist) {
            this.albumDetailArtist.textContent = artist;
        }
        if (this.albumDetailMetaTracks) {
            this.albumDetailMetaTracks.innerHTML = `<i class=\"fas fa-music mr-1\"></i>${trackCount} pistas`;
        }
        if (this.albumDetailMetaSize) {
            this.albumDetailMetaSize.innerHTML = `<i class=\"fas fa-database mr-1\"></i>${torrent.size || 'Tamaño desconocido'}`;
        }
        if (this.albumDetailMetaSource) {
            this.albumDetailMetaSource.innerHTML = `<i class=\"fas fa-folder-open mr-1\"></i>${torrent.source || 'Desconocido'}`;
        }
        if (this.albumDetailDescription) {
            this.albumDetailDescription.textContent = torrent.description || '';
        }
        if (this.albumDetailCover) {
            if (coverUrl) {
                this.applyCoverToElement(this.albumDetailCover, coverUrl);
            } else {
                this.ensureAlbumCover(torrent, this.albumDetailCover);
            }
        }
        if (this.albumDetailHero && coverUrl) {
            this.albumDetailHero.style.backgroundImage = `linear-gradient(135deg, rgba(15,23,42,0.95), rgba(30,41,59,0.9)), url('${coverUrl}')`;
            this.albumDetailHero.style.backgroundSize = 'cover';
            this.albumDetailHero.style.backgroundPosition = 'center';
        }
        if (this.albumDetailTracklist) {
            this.albumDetailTracklist.innerHTML = '';
            if (Array.isArray(torrent.tracks)) {
                torrent.tracks.forEach((track, index) => {
                    const row = document.createElement('tr');
                    row.className = 'hover:bg-slate-900/80';
                    row.innerHTML = `
                        <td class=\"px-4 py-3 text-slate-500\">${index + 1}</td>
                        <td class=\"px-4 py-3\">
                            <p class=\"font-semibold text-white\">${this.escapeHtml(track.name || track.title || `Pista ${index + 1}`)}</p>
                            <p class=\"text-xs text-slate-400\">${this.escapeHtml(track.artist || artist || '')}</p>
                        </td>
                        <td class=\"px-4 py-3 text-slate-400\">${this.escapeHtml(track.duration || '')}</td>
                        <td class=\"px-4 py-3 text-right\">
                            <div class=\"flex items-center justify-end space-x-3 text-slate-400\">
                                <button class=\"hover:text-white\" data-action=\"play-album-track\" data-track-index=\"${index}\"><i class=\"fas fa-play\"></i></button>
                                <button class=\"hover:text-white\" data-action=\"queue-album-track\" data-track-index=\"${index}\"><i class=\"fas fa-plus\"></i></button>
                            </div>
                        </td>
                    `;
                    this.albumDetailTracklist.appendChild(row);
                });
            }
        }
    }

    playAlbumTracks(tracks = []) {
        if (!Array.isArray(tracks) || !tracks.length) return;
        const first = tracks[0];
        if (first.isLocal && first.streamUrl) {
            this.playLocalTrack(first);
        } else if (first.magnet) {
            this.playTorrent(first.magnet, first.name);
        }
        tracks.slice(1).forEach(track => this.addToQueue(track));
    }

    clearStatusLog() {
        const statusContainer = document.getElementById('searchStatus');
        const statusLog = document.getElementById('searchStatusLog');
        if (statusLog) {
            statusLog.innerHTML = '';
        }
        if (statusContainer) {
            statusContainer.classList.add('hidden');
        }
    }

    formatTimestampLabel(timestamp) {
        try {
            return new Date(timestamp).toLocaleTimeString();
        } catch {
            return new Date().toLocaleTimeString();
        }
    }

    pushStatusMessage(entry) {
        const statusContainer = document.getElementById('searchStatus');
        const statusLog = document.getElementById('searchStatusLog');
        if (!statusContainer || !statusLog) return;
        const payload = typeof entry === 'string' ? { message: entry } : (entry || {});
        if (!payload.message) return;
        const row = document.createElement('div');
        row.className = 'flex items-start space-x-2 text-xs text-slate-300';
        const timeLabel = this.formatTimestampLabel(payload.timestamp || Date.now());
        row.innerHTML = `
            <span class="text-slate-500">${this.escapeHtml(timeLabel)}</span>
            <span>${this.escapeHtml(payload.message)}</span>
        `;
        statusLog.appendChild(row);
        while (statusLog.children.length > 40) {
            statusLog.removeChild(statusLog.firstChild);
        }
        statusContainer.classList.remove('hidden');
        statusLog.scrollTop = statusLog.scrollHeight;
    }

    applyServerLogs(logs = []) {
        logs.forEach(log => this.pushStatusMessage(log));
    }

    /**
     * Dibuja los resultados en la cuadrícula principal.
     */
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
        
        // Apply sorting
        const sortBy = document.getElementById('sortSelect').value;
        const filteredResults = [...results];
        filteredResults.sort((a, b) => {
            switch (sortBy) {
                case 'seeds': return (b.seeds || 0) - (a.seeds || 0);
                case 'size': return this.parseSize(b.size) - this.parseSize(a.size);
                case 'date': return (b.addedAt || 0) - (a.addedAt || 0);
                default: return 0;
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

        this.updateSuggestions(filteredResults);
        this.updateMetadataSuggestions(this.lastQuery);
        resultsSection.classList.remove('hidden');
        resultsSection.scrollIntoView({ behavior: 'smooth' });
    }

    /**
     * Construye una tarjeta de resultado (canción o álbum).
     */
    createTorrentCard(torrent, index) {
        const card = document.createElement('div');
        card.className = 'torrent-card bg-slate-800/50 backdrop-blur-sm rounded-xl p-6 border border-slate-700 hover:border-slate-600 transition-all cursor-pointer fade-in';
        card.style.animationDelay = `${index * 0.1}s`;
        
        const categoryColors = {
            music: 'bg-purple-600',
            podcast: 'bg-blue-600',
            library: 'bg-emerald-600',
            'library-album': 'bg-emerald-600'
        };

        const categoryNames = {
            music: 'Música',
            podcast: 'Podcast',
            library: 'Biblioteca',
            'library-album': 'Biblioteca'
        };

        const description = torrent.description || this.buildDescriptionFromFiles(torrent.files);
        const isLocal = Boolean(torrent.isLocal);
        const isAlbum = torrent.type === 'album';
        const seeds = Number(torrent.seeds) || 0;
        const leechs = Number(torrent.leechs) || 0;
        const safeName = this.escapeHtml(torrent.name || 'Audio sin título');
        const safeDescription = this.escapeHtml(description || 'Contenido de audio');
        const safeSize = this.escapeHtml(torrent.size || 'Tamaño desconocido');
        const badges = [
            `<span class="text-xs ${categoryColors[torrent.category] || 'bg-gray-600'} px-2 py-1 rounded-full">
                ${categoryNames[torrent.category] || 'Otro'}
            </span>`,
            `<span class="text-xs bg-slate-600 px-2 py-1 rounded-full">${this.escapeHtml(torrent.quality || 'Audio')}</span>`
        ];
        if (torrent.source) {
            badges.push(
                `<span class="text-xs bg-amber-600 px-2 py-1 rounded-full">${this.escapeHtml(torrent.source)}</span>`
            );
        }
        if (torrent.fromCache) {
            badges.push('<span class="text-xs bg-slate-500 px-2 py-1 rounded-full">Cache</span>');
        }
        const statsSection = isLocal
            ? `<div class="flex items-center space-x-2 text-emerald-400 font-semibold text-sm">
                    <i class="fas fa-folder-open text-xs"></i>
                    <span>En tu biblioteca</span>
               </div>`
            : `<div class="flex items-center space-x-4">
                    <div class="flex items-center space-x-1">
                        <i class="fas fa-arrow-up seed text-xs"></i>
                        <span class="seed text-sm font-medium">${seeds}</span>
                    </div>
                    <div class="flex items-center space-x-1">
                        <i class="fas fa-arrow-down leech text-xs"></i>
                        <span class="leech text-sm font-medium">${leechs}</span>
                    </div>
               </div>`;
        const queueButton = `<button data-action="add-to-queue"
                       class="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center space-x-2">
                    <i class="fas fa-list text-xs"></i>
                    <span>Añadir a cola</span>
               </button>`;
        const actionButtons = isLocal
            ? `<button data-action="play-local"
                       class="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center space-x-2">
                    <i class="fas fa-music text-xs"></i>
                    <span>Reproducir</span>
               </button>
               <button data-action="download-local"
                       class="bg-slate-600 hover:bg-slate-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center space-x-2">
                    <i class="fas fa-folder-open text-xs"></i>
                    <span>Abrir archivo</span>
               </button>
               ${queueButton}`
            : `<button data-action="play"
                       class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center space-x-2">
                    <i class="fas fa-play text-xs"></i>
                    <span>Reproducir</span>
               </button>
               <button data-action="download"
                       class="bg-slate-600 hover:bg-slate-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center space-x-2">
                    <i class="fas fa-download text-xs"></i>
                    <span>Descargar</span>
               </button>
               ${queueButton}`;
        const trackContainerId = `album-${index}-${Math.random().toString(36).slice(2, 8)}`;
        const trackListHtml = isAlbum && Array.isArray(torrent.tracks) && torrent.tracks.length
            ? `
                <div class="mt-4">
                    <button class="flex items-center space-x-2 text-sm text-blue-400 hover:text-blue-200 transition" data-action="toggle-tracks" data-target="${trackContainerId}">
                        <i class="fas fa-list"></i>
                        <span>Ver pistas (${torrent.tracks.length})</span>
                        <i class="fas fa-chevron-down text-xs ml-1 transition-transform"></i>
                    </button>
                    <div id="${trackContainerId}" class="hidden space-y-2 max-h-60 overflow-y-auto mt-3 pr-2">
                        ${torrent.tracks.map((track, trackIndex) => `
                                <div class="flex items-center justify-between bg-slate-900/40 px-3 py-2 rounded-lg text-sm">
                                    <div>
                                        <p class="text-white font-medium">${this.escapeHtml(track.name)}</p>
                                        <p class="text-xs text-slate-500">${this.escapeHtml(track.artist || '')}</p>
                                    </div>
                                    <div class="flex items-center space-x-2">
                                        <button class="text-emerald-400 hover:text-emerald-200 transition" data-action="play-album-track" data-track-index="${trackIndex}">
                                            <i class="fas fa-play text-xs"></i>
                                        </button>
                                        <button class="text-slate-400 hover:text-white transition" data-action="queue-album-track" data-track-index="${trackIndex}">
                                            <i class="fas fa-plus text-xs"></i>
                                        </button>
                                    </div>
                                </div>
                        `).join('')}
                    </div>
                </div>
            ` : '';

        if (isAlbum) {
            const coverUrl = this.getCoverImage(torrent);
            card.classList.add('album-card');
            card.innerHTML = `
                <div class="flex flex-col md:flex-row gap-5" data-album-card>
                    <div class="w-32 h-32 md:w-40 md:h-40 flex-shrink-0">
                        <div class="w-full h-full rounded-2xl overflow-hidden bg-slate-900 flex items-center justify-center text-slate-500" data-cover-id="${coverId}">
                            ${coverUrl
                                ? `<img src="${this.escapeHtml(coverUrl)}" alt="${safeName}" class="w-full h-full object-cover">`
                                : '<i class="fas fa-compact-disc text-3xl"></i>'}
                        </div>
                    </div>
                    <div class="flex-1">
                        <div class="flex items-center flex-wrap gap-2 mb-2">
                            ${badges.join('')}
                        </div>
                        <h4 class="font-semibold text-2xl mb-1 text-white">${safeName}</h4>
                        <p class="text-sm text-slate-400 mb-3">${safeDescription}</p>
                        <div class="flex flex-wrap items-center gap-4 text-xs text-slate-400">
                            <span><i class="fas fa-user mr-1"></i>${this.escapeHtml(torrent.artist || 'Artista desconocido')}</span>
                            <span><i class="fas fa-music mr-1"></i>${torrent.trackCount || torrent.tracks?.length || 0} pistas</span>
                            <span><i class="fas fa-database mr-1"></i>${safeSize}</span>
                        </div>
                        <div class="flex items-center space-x-3 mt-4">
                            ${actionButtons}
                        </div>
                        ${trackListHtml}
                    </div>
                </div>
            `;
            if (!coverUrl) {
                const coverTarget = card.querySelector(`[data-cover-id="${coverId}"]`);
                this.ensureAlbumCover(torrent, coverTarget);
            } else {
                const cacheKey = this.buildCoverCacheKey(torrent);
                if (cacheKey) {
                    this.coverCache.set(cacheKey, coverUrl);
                }
            }
            card.querySelector('[data-album-card]').addEventListener('click', (event) => {
                const action = event.target.closest('[data-action]');
                if (action) return;
                this.showAlbumDetail(torrent);
            });
        } else {
            card.innerHTML = `
                <div class="flex items-start justify-between mb-4">
                    <div class="flex-1">
                        <div class="flex items-center flex-wrap gap-2 mb-2">
                            ${badges.join('')}
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
                    ${statsSection}
                    <div class="flex items-center space-x-2">
                        ${actionButtons}
                    </div>
                </div>
                ${trackListHtml}
            `;
        }

        const playButton = card.querySelector('[data-action="play"]');
        const downloadButton = card.querySelector('[data-action="download"]');
        const localPlayButton = card.querySelector('[data-action="play-local"]');
        const localDownloadButton = card.querySelector('[data-action="download-local"]');
        const queueButtonElement = card.querySelector('[data-action="add-to-queue"]');
        const playAlbumTrackButtons = card.querySelectorAll('[data-action="play-album-track"]');
        const queueAlbumTrackButtons = card.querySelectorAll('[data-action="queue-album-track"]');
        const toggleTracksButton = card.querySelector('[data-action="toggle-tracks"]');
        const trackContainer = trackContainerId ? card.querySelector(`#${trackContainerId}`) : null;

        if (queueButtonElement) {
            const canQueue = isLocal ? Boolean(torrent.streamUrl) : Boolean(torrent.magnet || torrent.best?.magnet || torrent.key);
            if (!canQueue) {
                queueButtonElement.disabled = true;
                queueButtonElement.classList.add('opacity-50', 'cursor-not-allowed');
            } else {
                queueButtonElement.addEventListener('click', (event) => {
                    event.stopPropagation();
                    if (isAlbum && Array.isArray(torrent.tracks) && torrent.tracks.length) {
                        torrent.tracks.forEach(track => this.addToQueue(track));
                    } else {
                        this.addToQueue(torrent);
                    }
                });
            }
        }

        if (isLocal) {
            if (localPlayButton) {
                if (!torrent.streamUrl) {
                    localPlayButton.disabled = true;
                    localPlayButton.classList.add('opacity-50', 'cursor-not-allowed');
                } else {
                    localPlayButton.addEventListener('click', (event) => {
                        event.stopPropagation();
                        this.playLocalTrack(torrent);
                    });
                }
            }
            if (localDownloadButton) {
                const downloadTarget = torrent.downloadUrl || torrent.localDownloadUrl;
                if (!downloadTarget) {
                    localDownloadButton.disabled = true;
                    localDownloadButton.classList.add('opacity-50', 'cursor-not-allowed');
                } else {
                    localDownloadButton.addEventListener('click', (event) => {
                        event.stopPropagation();
                        this.triggerFileDownload(downloadTarget);
                    });
                }
            }
        } else {
            if (playButton) {
                const canPlay = Boolean(torrent.magnet || torrent.best?.magnet || torrent.key);
                if (!canPlay) {
                    playButton.disabled = true;
                    playButton.classList.add('opacity-50', 'cursor-not-allowed');
                } else {
                    playButton.addEventListener('click', (event) => {
                        event.stopPropagation();
                        this.handlePlayClick(torrent);
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
        }

        return card;
    }

    /**
     * Punto de entrada para reproducir un torrent remoto.
     */
    async playTorrent(magnetURI, name, options = {}) {
        const fromQueue = Boolean(options.fromQueue);
        if (!fromQueue) {
            this.isQueueProcessing = false;
            this.currentQueueItem = null;
            this.updateQueueUI();
        }
        if (!magnetURI) {
            this.showError('No se encontró un enlace magnet válido para este torrent');
            return;
        }

        try {
            this.showPlayer();
            this.showLoading(true);
            this.clearPlaybackStatus();
            this.updateNowPlaying(name || 'Reproduciendo torrent', 'Conectando a peers...');
            this.appendPlaybackStatus('Enviando torrent al backend…');
            this.setPlaybackSummary('Esperando respuesta del servidor…');
            const torrentInfo = await this.startBackendTorrent(magnetURI, options);
            this.appendPlaybackStatus('Backend recibió el torrent. Esperando metadatos…');
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
                if (fromQueue) {
                    this.isQueueProcessing = false;
                    this.playNextInQueue();
                }
            }
        }
    }

    /**
     * Envía el magnet al backend para streaming HTTP.
     */
    async startBackendTorrent(magnetURI, options = {}) {
        const payload = {
            magnet: magnetURI,
            alternatives: (options.alternatives || []).filter(Boolean),
            trackKey: options.trackKey || null
        };

        const response = await fetch('/api/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            const message = errorBody.error || 'No se pudo iniciar el torrent en el backend';
            throw new Error(message);
        }

        return response.json();
    }

    /**
     * Maneja el clic de reproducir: si ya tenemos magnet se reproduce, si no, resuelve la pista en backend.
     */
    async handlePlayClick(torrent) {
        try {
            const isResolved = Boolean(torrent.magnet);
            let magnet = torrent.magnet || null;
            let alternatives = torrent.alternatives || [];
            let trackKey = torrent.key || null;

            if (!isResolved) {
                // Resolver pista en backend usando el índice canónico
                const artist = torrent.artist || '';
                const title = torrent.name || torrent.title || '';
                const album = torrent.album || '';
                const resolveResponse = await fetch('/api/resolve/track', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ artist, title, album })
                });
                if (!resolveResponse.ok) {
                    const errorBody = await resolveResponse.json().catch(() => ({}));
                    throw new Error(errorBody.error || 'No se pudo resolver la pista');
                }
                const resolved = await resolveResponse.json();
                magnet = resolved.best?.magnet || null;
                alternatives = (resolved.alternatives || []).map(item => item.magnet).filter(Boolean);
                trackKey = resolved.key || null;
                // Normalizamos el torrent con la info resuelta
                torrent.magnet = magnet;
                torrent.alternatives = alternatives;
                torrent.key = trackKey;
            }

            if (!magnet) {
                this.showError('No se encontró un magnet válido para reproducir');
                return;
            }

            this.playTorrent(magnet, torrent.name, {
                alternatives,
                trackKey
            });
        } catch (error) {
            console.error('Error al preparar reproducción:', error);
            this.showError(error.message || 'No se pudo reproducir esta pista');
        }
    }

    playTorrentClientSide(magnetURI, name) {
        return new Promise((resolve, reject) => {
            if (!this.client) {
                reject(new Error('Cliente WebTorrent no inicializado'));
                return;
            }
            this.appendPlaybackStatus('Usando WebTorrent en el navegador…');

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

    /**
     * Reproduce un archivo existente en la biblioteca local.
     */
    async playLocalTrack(track, options = {}) {
        const fromQueue = Boolean(options.fromQueue);
        if (!fromQueue) {
            this.isQueueProcessing = false;
            this.currentQueueItem = null;
            this.updateQueueUI();
        }
        if (!track || !track.streamUrl) {
            this.showError('No se encontró un enlace válido para este archivo local');
            return;
        }

        try {
            this.showPlayer();
            this.showLoading(true);
            const meta = track.artist ? `${track.artist}${track.album ? ' — ' + track.album : ''}` : (track.album || 'Archivo local');
            this.updateNowPlaying(track.name || track.originalName || 'Reproduciendo archivo local', meta);

            this.audioPlayer.src = track.streamUrl;
            this.audioPlayer.load();
            await this.audioPlayer.play().catch(() => {
                console.warn('Autoplay bloqueado para archivo local');
            });
        } catch (error) {
            console.error('Error reproduciendo archivo local:', error);
            this.showError('No se pudo reproducir este archivo de la biblioteca');
            if (fromQueue) {
                this.isQueueProcessing = false;
                this.playNextInQueue();
            }
        } finally {
            this.showLoading(false);
        }
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

    /**
     * Utiliza WebTorrent para localizar y reproducir el audio más largo del torrent.
     */
    findAndPlayMediaFile(torrent, displayName = '') {
        if (!torrent.files || !torrent.files.length) {
            this.showError('El torrent no contiene archivos reproducibles');
            this.showLoading(false);
            return;
        }

        const audioExtensions = ['mp3', 'flac', 'aac', 'm4a', 'wav', 'ogg', 'opus', 'alac', 'wma'];
        const audioFiles = torrent.files.filter(file => audioExtensions.includes(this.getFileExtension(file.name)));

        if (!audioFiles.length) {
            this.showError('No se encontraron archivos de audio compatibles en este torrent');
            this.showLoading(false);
            return;
        }

        const selectedFile = audioFiles.reduce((prev, current) => (current.length > prev.length ? current : prev));
        this.audioPlayer.style.display = 'block';
        this.audioPlayer.removeAttribute('src');
        this.audioPlayer.load();
        this.updateNowPlaying(displayName || selectedFile.name, torrent.name || 'Streaming desde tracker');

        selectedFile.renderTo(this.audioPlayer, { autoplay: true }, (error) => {
            if (error) {
                console.error('Render error:', error);
                this.showError('No se pudo iniciar la reproducción');
            }
            this.showLoading(false);
        });

        this.audioPlayer.play().catch(() => {
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
        const progressBar = document.getElementById('progressBar');
        const progressPercentLabel = document.getElementById('progressPercent');
        const progress = Math.round((torrent.progress || 0) * 100);
        if (progressBar) {
            progressBar.style.width = `${progress}%`;
        }
        if (progressPercentLabel) {
            progressPercentLabel.textContent = `${progress}%`;
        }
    }

    updateProgressFromBackend(status) {
        const progressPercent = Math.round((status.progress || 0) * 100);
        const progressBar = document.getElementById('progressBar');
        const progressPercentLabel = document.getElementById('progressPercent');
        if (progressBar) {
            progressBar.style.width = `${progressPercent}%`;
        }
        if (progressPercentLabel) {
            progressPercentLabel.textContent = `${progressPercent}%`;
        }

        const downloadSpeed = this.formatSpeed(status.downloadSpeed || 0);
        const uploadSpeed = this.formatSpeed(status.uploadSpeed || 0);

        const downloadSpeedLabel = document.getElementById('downloadSpeed');
        const uploadSpeedLabel = document.getElementById('uploadSpeed');
        if (downloadSpeedLabel) {
            downloadSpeedLabel.textContent = downloadSpeed;
        }
        if (uploadSpeedLabel) {
            uploadSpeedLabel.textContent = uploadSpeed;
        }
    }

    updateSpeeds(torrent) {
        const downloadSpeed = this.formatSpeed(torrent.downloadSpeed || 0);
        const uploadSpeed = this.formatSpeed(torrent.uploadSpeed || 0);
        const downloadSpeedLabel = document.getElementById('downloadSpeed');
        const uploadSpeedLabel = document.getElementById('uploadSpeed');
        if (downloadSpeedLabel) {
            downloadSpeedLabel.textContent = downloadSpeed;
        }
        if (uploadSpeedLabel) {
            uploadSpeedLabel.textContent = uploadSpeed;
        }
    }

    updateTimeDisplay() {
        const currentTime = this.formatTime(this.audioPlayer.currentTime);
        document.getElementById('currentTime').textContent = currentTime;
    }

    updateDurationDisplay() {
        const duration = this.formatTime(this.audioPlayer.duration);
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
        if (this.audioPlayer.paused) {
            this.audioPlayer.play();
            document.getElementById('playPauseBtn').innerHTML = '<i class="fas fa-pause text-white"></i>';
        } else {
            this.audioPlayer.pause();
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
        this.audioPlayer.pause();
        this.audioPlayer.src = '';
        this.updateNowPlaying('Selecciona una canción', 'Tu cola está vacía.');
        this.clearPlaybackStatus();
        this.isQueueProcessing = false;
        this.currentQueueItem = null;
        this.updateQueueUI();
    }

    showLoading(show) {
        const loadingState = document.getElementById('loadingState');
        if (show) {
            loadingState.classList.remove('hidden');
        } else {
            loadingState.classList.add('hidden');
        }
    }

    clearPlaybackStatus() {
        const statusContainer = document.getElementById('playbackStatus');
        const summary = document.getElementById('playbackProgressSummary');
        if (statusContainer) {
            statusContainer.innerHTML = '';
        }
        if (summary) {
            summary.textContent = 'Sin actividad.';
        }
    }

    appendPlaybackStatus(message) {
        const statusContainer = document.getElementById('playbackStatus');
        if (!statusContainer || !message) return;
        const row = document.createElement('div');
        row.className = 'flex items-start space-x-2';
        row.innerHTML = `<span class="text-blue-400 mt-1">●</span><span>${this.escapeHtml(message)}</span>`;
        statusContainer.appendChild(row);
        while (statusContainer.children.length > this.playbackStatusLimit) {
            statusContainer.removeChild(statusContainer.firstChild);
        }
        statusContainer.scrollTop = statusContainer.scrollHeight;
    }

    setPlaybackSummary(text) {
        const summary = document.getElementById('playbackProgressSummary');
        if (!summary) return;
        summary.textContent = text || 'Sin actividad.';
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

    /**
     * Cambia el fondo principal para adaptarse a la búsqueda actual.
     */
    updateHeroBackdrop(query) {
        if (!this.heroBackdrop) return;
        const keyword = encodeURIComponent(query || 'music');
        this.heroBackdrop.style.backgroundImage = `url('https://source.unsplash.com/1600x900/?music,${keyword}')`;
    }

    /**
     * Dibuja sugerencias dinámicas basadas en los resultados obtenidos.
     */
    updateSuggestions(results = []) {
        const section = document.getElementById('suggestionsSection');
        const grid = document.getElementById('suggestionsGrid');
        if (!section || !grid) return;

        const suggestions = this.buildSuggestions(results);
        if (!suggestions.length) {
            section.classList.add('hidden');
            grid.innerHTML = '<p class="text-slate-500 text-sm">No hay sugerencias para esta búsqueda.</p>';
            return;
        }

        grid.innerHTML = suggestions.map((item) => `
            <div class="bg-slate-800/60 rounded-xl p-6 border border-slate-700 hover:border-blue-500 transition cursor-pointer suggestion-card" data-suggestion-query="${this.escapeHtml(item.query)}">
                <div class="flex items-center justify-between mb-3">
                    <span class="text-xs ${item.tagColor} px-2 py-1 rounded-full">${this.escapeHtml(item.tag)}</span>
                    <span class="text-xs text-slate-400">${this.escapeHtml(item.subtitle)}</span>
                </div>
                <h4 class="font-semibold mb-2">${this.escapeHtml(item.title)}</h4>
                <p class="text-sm text-slate-400 mb-3">${this.escapeHtml(item.description)}</p>
                <div class="flex items-center justify-between text-xs text-slate-400">
                    <span>${this.escapeHtml(item.footerLeft)}</span>
                    <span>${this.escapeHtml(item.footerRight)}</span>
                </div>
            </div>
        `).join('');

        grid.querySelectorAll('.suggestion-card').forEach(card => {
            const query = card.getAttribute('data-suggestion-query');
            card.addEventListener('click', () => {
                if (query) {
                    searchPopular(query);
                }
            });
        });

        section.classList.remove('hidden');
    }

    /**
     * Calcula sugerencias relacionadas (artistas parecidos, essentials, etc.).
     */
    buildSuggestions(results = []) {
        const suggestions = [];
        const artistStats = new Map();

        results.forEach(item => {
            const artist = this.cleanArtistName(item.artist || this.deriveArtistFromName(item.name));
            if (!artist) return;
            const key = artist.toLowerCase();
            if (!artistStats.has(key)) {
                artistStats.set(key, { artist, count: 0 });
            }
            artistStats.get(key).count += 1;
        });

        const topArtists = Array.from(artistStats.values())
            .sort((a, b) => b.count - a.count)
            .slice(0, 3);

        topArtists.forEach(({ artist }) => {
            suggestions.push(
                {
                    tag: 'Artista',
                    tagColor: 'bg-emerald-600',
                    title: `Explora a ${artist}`,
                    subtitle: 'Selección personalizada',
                    description: `Discografía y rarezas de ${artist}.`,
                    footerLeft: 'Local + P2P',
                    footerRight: 'MP3 / FLAC',
                    query: artist
                },
                {
                    tag: 'Live',
                    tagColor: 'bg-purple-600',
                    title: `${artist} en vivo`,
                    subtitle: 'Acústicos & directos',
                    description: `Busca actuaciones especiales o sesiones Tiny Desk de ${artist}.`,
                    footerLeft: 'Streams curados',
                    footerRight: 'Audio',
                    query: `${artist} live`
                }
            );
        });

        const cleanQuery = this.cleanArtistName(this.lastQuery);
        if (cleanQuery) {
            suggestions.push(
                {
                    tag: 'Género',
                    tagColor: 'bg-blue-600',
                    title: `${cleanQuery} essentials`,
                    subtitle: 'Recomendado',
                    description: `Colecciones esenciales relacionadas con ${cleanQuery}.`,
                    footerLeft: 'Selección automática',
                    footerRight: 'Lossless',
                    query: `${cleanQuery} essentials`
                },
                {
                    tag: 'Descubrir',
                    tagColor: 'bg-amber-500',
                    title: `Artistas parecidos a ${cleanQuery}`,
                    subtitle: 'Similares',
                    description: 'Encuentra colaboraciones, remixes y proyectos paralelos.',
                    footerLeft: 'Mezclas',
                    footerRight: 'FLAC / MP3',
                    query: `${cleanQuery} similar artists`
                }
            );
        }

        return suggestions.slice(0, 6);
    }

    async updateMetadataSuggestions(query) {
        if (!query) return;
        try {
            const response = await fetch(`/api/metadata/artist?q=${encodeURIComponent(query)}`);
            if (!response.ok) return;
            const payload = await response.json();
            if (!payload?.artists?.length) return;

            const metadataSuggestions = payload.artists.slice(0, 3).map(artist => ({
                tag: 'Discografía',
                tagColor: 'bg-indigo-600',
                title: artist.name,
                subtitle: artist.releases?.[0]?.firstReleaseDate || 'MusicBrainz',
                description: artist.releases && artist.releases.length
                    ? `Incluye ${artist.releases.length} lanzamientos recientes.`
                    : 'Consultar catálogo en MusicBrainz.',
                footerLeft: 'Metadatos',
                footerRight: 'MusicBrainz',
                query: artist.name
            }));

            if (metadataSuggestions.length) {
                const section = document.getElementById('suggestionsSection');
                const grid = document.getElementById('suggestionsGrid');
                if (!section || !grid) return;
                const existing = grid.innerHTML.trim();
                grid.innerHTML = (existing || '') + metadataSuggestions.map(item => `
                    <div class="bg-slate-800/60 rounded-xl p-6 border border-slate-700 hover:border-blue-500 transition cursor-pointer suggestion-card" data-suggestion-query="${this.escapeHtml(item.query)}">
                        <div class="flex items-center justify-between mb-3">
                            <span class="text-xs ${item.tagColor} px-2 py-1 rounded-full">${this.escapeHtml(item.tag)}</span>
                            <span class="text-xs text-slate-400">${this.escapeHtml(item.subtitle || '')}</span>
                        </div>
                        <h4 class="font-semibold mb-2">${this.escapeHtml(item.title)}</h4>
                        <p class="text-sm text-slate-400 mb-3">${this.escapeHtml(item.description)}</p>
                        <div class="flex items-center justify-between text-xs text-slate-400">
                            <span>${this.escapeHtml(item.footerLeft)}</span>
                            <span>${this.escapeHtml(item.footerRight)}</span>
                        </div>
                    </div>
                `).join('');

                grid.querySelectorAll('.suggestion-card').forEach(card => {
                    const suggestionQuery = card.getAttribute('data-suggestion-query');
                    if (suggestionQuery) {
                        card.addEventListener('click', () => searchPopular(suggestionQuery));
                    }
                });
                section.classList.remove('hidden');
            }
        } catch (error) {
            console.warn('Metadata suggestion fetch failed:', error);
        }
    }

    /**
     * Limpia nombres de artistas eliminando adornos (feat., paréntesis, etc.).
     */
    cleanArtistName(name = '') {
        if (!name) return '';
        return name
            .replace(/\b(feat|feat\.|ft|with)\b.*$/i, '')
            .replace(/\[[^\]]+\]/g, '')
            .replace(/\(.*?version.*?\)/i, '')
            .replace(/[^a-z0-9\s]/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Intenta inferir el artista a partir del nombre del torrent.
     */
    deriveArtistFromName(name = '') {
        if (!name) return '';
        const cleaned = name.replace(/\[[^\]]+\]/g, ' ').trim();
        const splitter = cleaned.split(/[-–—]|:\s/);
        if (splitter.length > 1) {
            return this.cleanArtistName(splitter[0]);
        }
        const tokens = cleaned.split(/\s+/).slice(0, 2).join(' ');
        return this.cleanArtistName(tokens);
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
