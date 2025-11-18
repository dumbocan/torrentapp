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

    /**
     * Añade una pista (o todas las pistas de un álbum) a la cola de reproducción.
     */
    addToQueue(torrent) {
        if (!torrent) return;
        const queueEntry = {
            id: `queue-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            title: torrent.name || torrent.originalName || 'Elemento sin título',
            isLocal: Boolean(torrent.isLocal),
            magnet: torrent.magnet || null,
            streamUrl: torrent.streamUrl || null,
            source: torrent.source || (torrent.isLocal ? 'Biblioteca' : 'Tracker'),
            size: torrent.size || '',
            quality: torrent.quality || ''
        };

        if (!queueEntry.isLocal && !queueEntry.magnet) {
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
            this.playTorrent(nextItem.magnet, nextItem.title, { fromQueue: true });
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

    /**
     * Solicita al backend el streaming HTTP de un archivo del torrent.
     */
    streamFromBackend(torrentId, fileIndex, displayName = '', fileMeta = null) {
        this.stopMonitoringTorrent(torrentId);
        this.audioPlayer.style.display = 'block';
        this.updateNowPlaying(displayName || (fileMeta?.name ?? 'Reproduciendo torrent'), 'Streaming desde tracker');

        const audioSrc = `/api/stream/${encodeURIComponent(torrentId)}/${fileIndex}`;
        this.audioPlayer.src = audioSrc;
        this.audioPlayer.load();
        this.audioPlayer.play().catch(() => {
            console.warn('Autoplay bloqueado por el navegador');
        });
        this.showLoading(false);
    }

    stopMonitoringTorrent(torrentId) {
        if (this.torrentStatusTimers.has(torrentId)) {
            clearTimeout(this.torrentStatusTimers.get(torrentId));
            this.torrentStatusTimers.delete(torrentId);
        }
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

    /**
     * Consulta el backend y adapta el resultado al formato usado por la UI.
     */
    async searchTorrents(query) {
        try {
            const params = new URLSearchParams({
                query,
                limit: '30',
                mode: this.searchMode
            });
            const sortValue = document.getElementById('sortSelect').value;
            params.set('sort', sortValue);

            const response = await fetch(`/api/search?${params.toString()}`);
            
            if (!response.ok) {
                throw new Error('Search failed');
            }
            
            let results = await response.json();
            results = results.map((result) => {
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
            });

            if (this.filterLosslessOnly) {
                results = results.filter(item => {
                    const quality = (item.quality || '').toLowerCase();
                    return quality.includes('flac') || quality.includes('lossless') || /flac|alac|lossless/i.test(item.name || '');
                });
            }

            if (!this.localFirst) {
                results = results.sort((a, b) => Number(a.isLocal) - Number(b.isLocal));
            } else {
                results = results.sort((a, b) => Number(b.isLocal) - Number(a.isLocal));
            }

            return results;
        } catch (error) {
            console.error('Search error:', error);
            this.showError('No se pudo obtener resultados en este momento');
            return [];
        }
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
        this.updateMetadataSuggestions(query);
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
            const canQueue = isLocal ? Boolean(torrent.streamUrl) : Boolean(torrent.magnet);
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
                        window.open(downloadTarget, '_blank');
                    });
                }
            }
        } else {
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
            this.updateNowPlaying(name || 'Reproduciendo torrent', 'Conectando a peers...');
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
                if (fromQueue) {
                    this.isQueueProcessing = false;
                    this.playNextInQueue();
                }
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
        if (isAlbum && Array.isArray(torrent.tracks)) {
            playAlbumTrackButtons.forEach(button => {
                button.addEventListener('click', (event) => {
                    event.stopPropagation();
                    const index = Number(event.currentTarget.getAttribute('data-track-index'));
                    const track = torrent.tracks[index];
                    if (track) {
                        this.playLocalTrack(track);
                    }
                });
            });
            queueAlbumTrackButtons.forEach(button => {
                button.addEventListener('click', (event) => {
                    event.stopPropagation();
                    const index = Number(event.currentTarget.getAttribute('data-track-index'));
                    const track = torrent.tracks[index];
                    if (track) {
                        this.addToQueue(track);
                    }
                });
            });
        }

        if (toggleTracksButton && trackContainer) {
            toggleTracksButton.addEventListener('click', (event) => {
                event.stopPropagation();
                trackContainer.classList.toggle('hidden');
                const icon = toggleTracksButton.querySelector('.fa-chevron-down');
                if (icon) {
                    icon.classList.toggle('rotate-180');
                }
            });
        }
