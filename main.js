// TorrentStream - Main JavaScript File
class TorrentStream {
    constructor() {
        this.client = null;
        this.currentTorrent = null;
        this.activeDownloads = new Map();
        this.videoPlayer = document.getElementById('videoPlayer');
        this.playerPlaceholder = document.getElementById('playerPlaceholder');
        this.initializeApp();
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
            
            // Transform results to match our format
            return results.map((result, index) => ({
                name: result.name,
                size: result.size,
                seeds: result.seeds,
                leechs: result.leechs,
                category: result.category,
                quality: result.quality,
                description: result.description || `Película ${result.name}`,
                magnet: result.magnet,
                cover: result.cover,
                rating: result.rating,
                year: result.year,
                torrents: result.torrents
            }));
        } catch (error) {
            console.error('Search error:', error);
            // Fallback to mock data if API fails
            return this.getMockResults(query);
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
        
        // Apply filters and sorting
        const sortBy = document.getElementById('sortSelect').value;
        const minQuality = parseInt(document.getElementById('qualitySelect').value);
        const category = document.getElementById('categorySelect').value;

        let filteredResults = results.filter(torrent => {
            if (category !== 'all' && torrent.category !== category) return false;
            if (torrent.seeds < minQuality) return false;
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

        // Display results
        filteredResults.forEach((torrent, index) => {
            const torrentCard = this.createTorrentCard(torrent, index);
            torrentResults.appendChild(torrentCard);
        });

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

        card.innerHTML = `
            <div class="flex items-start justify-between mb-4">
                <div class="flex-1">
                    <div class="flex items-center space-x-2 mb-2">
                        <span class="text-xs ${categoryColors[torrent.category] || 'bg-gray-600'} px-2 py-1 rounded-full">
                            ${categoryNames[torrent.category] || 'Otro'}
                        </span>
                        <span class="text-xs bg-slate-600 px-2 py-1 rounded-full">${torrent.quality}</span>
                    </div>
                    <h4 class="font-semibold text-lg mb-2 text-white hover:text-blue-400 transition-colors">
                        ${torrent.name}
                    </h4>
                    <p class="text-sm text-slate-400 mb-3">${torrent.description}</p>
                </div>
                <div class="text-right ml-4">
                    <div class="text-lg font-bold text-white">${torrent.size}</div>
                </div>
            </div>
            
            <div class="flex items-center justify-between">
                <div class="flex items-center space-x-4">
                    <div class="flex items-center space-x-1">
                        <i class="fas fa-arrow-up seed text-xs"></i>
                        <span class="seed text-sm font-medium">${torrent.seeds}</span>
                    </div>
                    <div class="flex items-center space-x-1">
                        <i class="fas fa-arrow-down leech text-xs"></i>
                        <span class="leech text-sm font-medium">${torrent.leechs}</span>
                    </div>
                </div>
                <div class="flex items-center space-x-2">
                    <button onclick="torrentStream.playTorrent('${torrent.magnet}', '${torrent.name}')" 
                            class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center space-x-2">
                        <i class="fas fa-play text-xs"></i>
                        <span>Reproducir</span>
                    </button>
                    <button onclick="torrentStream.downloadTorrent('${torrent.magnet}', '${torrent.name}')" 
                            class="bg-slate-600 hover:bg-slate-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center space-x-2">
                        <i class="fas fa-download text-xs"></i>
                        <span>Descargar</span>
                    </button>
                </div>
            </div>
        `;

        return card;
    }

    async playTorrent(magnetURI, name) {
        try {
            this.showPlayer();
            this.showLoading(true);
            
            // Generate a unique ID for this torrent
            const torrentId = this.generateTorrentId(magnetURI);
            
            // Add torrent to backend for streaming
            const response = await fetch('/api/stream', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    magnetURI: magnetURI,
                    id: torrentId
                })
            });

            if (!response.ok) {
                throw new Error('Failed to add torrent for streaming');
            }

            const result = await response.json();
            console.log('Torrent added for streaming:', result);
            
            // Start monitoring the torrent status
            this.monitorTorrentStatus(torrentId, name);

        } catch (error) {
            console.error('Error playing torrent:', error);
            this.showError('Error al reproducir el torrent');
            this.showLoading(false);
            
            // Fallback to client-side streaming
            this.playTorrentClientSide(magnetURI, name);
        }
    }

    async playTorrentClientSide(magnetURI, name) {
        try {
            if (this.currentTorrent) {
                this.currentTorrent.destroy();
            }

            // Add torrent to client
            this.client.add(magnetURI, (torrent) => {
                this.currentTorrent = torrent;
                this.setupTorrentEvents(torrent, name);
                this.findAndPlayVideoFile(torrent);
            });
        } catch (error) {
            console.error('Client-side streaming error:', error);
            this.showError('Error al reproducir el torrent');
            this.showLoading(false);
        }
    }

    generateTorrentId(magnetURI) {
        // Create a simple hash from the magnet URI
        let hash = 0;
        for (let i = 0; i < magnetURI.length; i++) {
            const char = magnetURI.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash).toString(36);
    }

    async monitorTorrentStatus(torrentId, name) {
        const checkStatus = async () => {
            try {
                const response = await fetch(`/api/torrent/${torrentId}`);
                if (!response.ok) {
                    throw new Error('Failed to get torrent status');
                }

                const torrentData = await response.json();
                
                if (torrentData.status === 'ready' && torrentData.files.length > 0) {
                    // Find the largest video file
                    const videoFiles = torrentData.files.filter(file => file.type === 'video');
                    if (videoFiles.length > 0) {
                        const largestVideo = videoFiles.reduce((prev, current) => 
                            (prev.length > current.length) ? prev : current
                        );
                        
                        // Stream from backend
                        this.streamFromBackend(torrentId, torrentData.files.indexOf(largestVideo));
                        return; // Stop monitoring
                    }
                }

                // Update progress
                this.updateProgressFromBackend(torrentData);
                
                // Continue monitoring
                setTimeout(checkStatus, 1000);
                
            } catch (error) {
                console.error('Error monitoring torrent status:', error);
                this.showLoading(false);
            }
        };

        checkStatus();
    }

    streamFromBackend(torrentId, fileIndex) {
        const videoSrc = `/api/stream/${torrentId}/${fileIndex}`;
        this.videoPlayer.src = videoSrc;
        this.playerPlaceholder.style.display = 'none';
        this.videoPlayer.style.display = 'block';
        this.showLoading(false);
        
        // Auto-play the video
        this.videoPlayer.addEventListener('loadedmetadata', () => {
            this.videoPlayer.play();
        }, { once: true });
    }

    updateProgressFromBackend(torrentData) {
        const progress = Math.round(torrentData.progress * 100);
        document.getElementById('progressBar').style.width = `${progress}%`;
        document.getElementById('progressPercent').textContent = `${progress}%`;
        
        const downloadSpeed = (torrentData.downloadSpeed / 1024 / 1024).toFixed(2);
        const uploadSpeed = (torrentData.uploadSpeed / 1024 / 1024).toFixed(2);
        
        document.getElementById('downloadSpeed').textContent = `${downloadSpeed} MB/s`;
        document.getElementById('uploadSpeed').textContent = `${uploadSpeed} MB/s`;
    }

    async downloadTorrent(magnetURI, name) {
        try {
            if (this.activeDownloads.has(magnetURI)) {
                this.showError('Este torrent ya está en descarga');
                return;
            }

            this.client.add(magnetURI, (torrent) => {
                this.activeDownloads.set(magnetURI, { torrent, name, status: 'downloading' });
                this.updateDownloadsList();
                this.setupDownloadEvents(torrent, name);
            });

        } catch (error) {
            console.error('Error downloading torrent:', error);
            this.showError('Error al descargar el torrent');
        }
    }

    setupTorrentEvents(torrent, name) {
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

    setupDownloadEvents(torrent, name) {
        torrent.on('download', () => {
            this.updateDownloadsList();
        });

        torrent.on('done', () => {
            const download = this.activeDownloads.get(torrent.magnetURI);
            if (download) {
                download.status = 'completed';
                this.activeDownloads.set(torrent.magnetURI, download);
                this.updateDownloadsList();
            }
        });
    }

    findAndPlayVideoFile(torrent) {
        // Find the largest video file in the torrent
        const videoFiles = torrent.files.filter(file => {
            const ext = file.name.split('.').pop().toLowerCase();
            return ['mp4', 'mkv', 'avi', 'mov', 'wmv'].includes(ext);
        });

        if (videoFiles.length > 0) {
            // Play the largest video file
            const largestVideo = videoFiles.reduce((prev, current) => 
                (prev.length > current.length) ? prev : current
            );

            // Create a stream URL
            largestVideo.renderTo(this.videoPlayer, { autoplay: true });
            this.playerPlaceholder.style.display = 'none';
            this.videoPlayer.style.display = 'block';
            
        } else {
            this.showError('No se encontraron archivos de video en el torrent');
            this.showLoading(false);
        }
    }

    updateProgress(torrent) {
        const progress = Math.round(torrent.progress * 100);
        document.getElementById('progressBar').style.width = `${progress}%`;
        document.getElementById('progressPercent').textContent = `${progress}%`;
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

        this.activeDownloads.forEach((download, magnetURI) => {
            const { torrent, name, status } = download;
            const progress = Math.round(torrent.progress * 100);
            const downloadSpeed = (torrent.downloadSpeed / 1024 / 1024).toFixed(2);
            
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
                        <span class="download-speed">${downloadSpeed} MB/s</span>
                    </div>
                    <button onclick="torrentStream.removeDownload('${magnetURI}')" 
                            class="text-red-400 hover:text-red-300 transition-colors">
                        <i class="fas fa-times text-sm"></i>
                    </button>
                </div>
                <div class="w-full bg-slate-700 rounded-full h-2 mt-2">
                    <div class="bg-blue-600 h-2 rounded-full transition-all" style="width: ${progress}%"></div>
                </div>
            `;
            
            downloadsContainer.appendChild(downloadElement);
        });
    }

    removeDownload(magnetURI) {
        const download = this.activeDownloads.get(magnetURI);
        if (download) {
            download.torrent.destroy();
            this.activeDownloads.delete(magnetURI);
            this.updateDownloadsList();
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

    parseSize(sizeStr) {
        const units = { 'GB': 1024, 'MB': 1, 'KB': 1/1024 };
        const match = sizeStr.match(/([\d.]+)\s*(GB|MB|KB)/);
        if (match) {
            const [, size, unit] = match;
            return parseFloat(size) * (units[unit] || 1);
        }
        return 0;
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