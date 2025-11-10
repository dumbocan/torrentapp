import express from 'express';
import cors from 'cors';
import WebTorrent from 'webtorrent';
import axios from 'axios';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import * as cheerio from 'cheerio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const client = new WebTorrent();

const BASE_URL = 'https://thepibay.site';
const SCRAPER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    'Referer': `${BASE_URL}/`
};
const SCRAPER_AGENT = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
const PIRATE_BAY_CATEGORY = 101; // Audio > Music
const MAX_PAGES = 2;
const PIRATE_BAY_API = 'https://apibay.org/q.php';
const DEFAULT_TRACKERS = [
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://tracker.openbittorrent.com:6969/announce',
    'udp://tracker.coppersurfer.tk:6969/announce',
    'udp://tracker.leechers-paradise.org:6969/announce'
];
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');

if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Ruta raíz
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ==================== BUSCADOR DE MÚSICA MP3 EN THE PIRATE BAY ====================

function normalizeText(value = '') {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function tokenizeQuery(query) {
    return normalizeText(query)
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}

function calculateRelevancyScore(title, tokens, seeds = 0) {
    if (!tokens.length) {
        return seeds;
    }

    let score = 0;
    tokens.forEach(token => {
        if (title.includes(token)) {
            score += 5;
        }
    });

    if (tokens.length && title.includes(tokens.join(' '))) {
        score += 5;
    }

    return score + Math.log10(seeds + 1);
}

function inferAudioQuality(text = '') {
    const normalized = normalizeText(text);
    if (normalized.includes('flac')) return 'FLAC';
    if (normalized.includes('320')) return '320 kbps';
    if (normalized.includes('256')) return '256 kbps';
    if (normalized.includes('192')) return '192 kbps';
    if (normalized.includes('128')) return '128 kbps';
    return 'Audio';
}

// Helpers específicos para Pirate Bay

function extractInfoHash(magnet = '') {
    const match = magnet.match(/xt=urn:btih:([^&]+)/i);
    return match ? match[1] : null;
}

function formatPirateDescription(text = '') {
    return text.replace(/\s+/g, ' ').trim();
}

function buildSearchUrl(query, page = 1, category = PIRATE_BAY_CATEGORY) {
    return `${BASE_URL}/search/${encodeURIComponent(query)}/${page}/99/${category}`;
}

function parseDetDesc(description = '') {
    const uploadedMatch = description.match(/Uploaded\s([^,]+)/i);
    const sizeMatch = description.match(/Size\s([^,]+)/i);
    const uploaderMatch = description.match(/ULed by\s(.+)/i);
    return {
        uploaded: uploadedMatch ? uploadedMatch[1] : '',
        size: sizeMatch ? sizeMatch[1] : '',
        uploader: uploaderMatch ? uploaderMatch[1].trim() : ''
    };
}

function formatDescription({ size, uploaded, uploader }) {
    const parts = [];
    if (size) parts.push(`Tamaño ${size}`);
    if (uploaded) parts.push(`Subido ${uploaded}`);
    if (uploader) parts.push(`Por ${uploader}`);
    return parts.join(' · ');
}

function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
    return `${(bytes / Math.pow(1024, index)).toFixed(2)} ${sizes[index]}`;
}

const MIME_TYPES = {
    mp3: 'audio/mpeg',
    flac: 'audio/flac',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
    opus: 'audio/ogg',
    alac: 'audio/mp4',
    wma: 'audio/x-ms-wma',
    mp4: 'video/mp4',
    mkv: 'video/x-matroska',
    webm: 'video/webm',
    avi: 'video/x-msvideo'
};

function getMimeType(filename = '') {
    const ext = filename.split('.').pop()?.toLowerCase();
    return MIME_TYPES[ext] || 'application/octet-stream';
}

function formatUnixDate(timestamp) {
    if (!timestamp) return '';
    const date = new Date(Number(timestamp) * 1000);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('es-ES');
}

function buildMagnetLink(name, infoHash) {
    if (!infoHash) return '';
    const encodedName = encodeURIComponent(name || '');
    const trackers = DEFAULT_TRACKERS.map(tr => `&tr=${encodeURIComponent(tr)}`).join('');
    return `magnet:?xt=urn:btih:${infoHash}&dn=${encodedName}${trackers}`;
}

function magnetToId(magnet) {
    return Buffer.from(magnet).toString('base64');
}

function buildFileMetadata(torrent, file, index) {
    const ext = path.extname(file.name).replace('.', '').toLowerCase();
    const isAudio = ['mp3', 'flac', 'aac', 'm4a', 'wav', 'ogg', 'opus', 'alac', 'wma'].includes(ext);
    const absolutePath = path.join(torrent.path, file.path);
    const relativePath = path.relative(__dirname, absolutePath).replace(/\\/g, '/');
    const downloadUrl = relativePath.startsWith('downloads/') ? `/${relativePath}` : null;
    return {
        index,
        name: file.name,
        length: file.length,
        size: formatBytes(file.length),
        isAudio,
        mimeType: getMimeType(file.name),
        downloadUrl
    };
}

function determineStreamableFile(filesMeta = []) {
    const audioFile = filesMeta.find(file => file.isAudio);
    if (audioFile) {
        return audioFile.index;
    }
    return filesMeta.length ? filesMeta[0].index : null;
}

async function fetchDocument(pathname) {
    const url = pathname.startsWith('http') ? pathname : `${BASE_URL}${pathname}`;
    const response = await axios.get(url, {
        headers: SCRAPER_HEADERS,
        httpsAgent: SCRAPER_AGENT,
        timeout: 15000
    });
    return cheerio.load(response.data);
}

async function searchPirateBayMusic(query, limit = 15) {
    try {
        const trimmedQuery = query.trim();
        if (!trimmedQuery) return [];

        const tokens = tokenizeQuery(trimmedQuery);
        const strongTokens = tokens.filter(token => token.length >= 4);
        const filterTokens = strongTokens.length ? strongTokens : tokens;

        let results = await searchPirateBayViaApi(trimmedQuery, filterTokens, limit);
        if (!results.length) {
            results = await searchPirateBayViaHtml(trimmedQuery, filterTokens, limit);
        }

        console.log(`✅ Pirate Bay encontró ${results.length} resultados de música`);
        return results;

    } catch (error) {
        console.error('❌ Pirate Bay Error:', error.message);
        return [];
    }
}

async function searchPirateBayViaApi(query, filterTokens, limit) {
    try {
        const response = await axios.get(PIRATE_BAY_API, {
            params: { q: query, cat: PIRATE_BAY_CATEGORY },
            headers: {
                'User-Agent': SCRAPER_HEADERS['User-Agent'],
                'Accept': 'application/json'
            },
            timeout: 15000
        });

        const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
        if (!Array.isArray(data)) {
            return [];
        }

        const mapped = data
            .filter(item => item && item.info_hash && item.name)
            .map(item => {
                const name = item.name.trim();
                const normalizedTitle = normalizeText(name);
                const matchedTokens = filterTokens.filter(token => normalizedTitle.includes(token));
                if (filterTokens.length && matchedTokens.length === 0) {
                    return null;
                }

                const seeds = parseInt(item.seeders, 10) || 0;
                const leechs = parseInt(item.leechers, 10) || 0;
                const sizeBytes = Number(item.size) || 0;
                const sizeLabel = sizeBytes ? formatBytes(sizeBytes) : '';

                return {
                    name,
                    size: sizeLabel || 'Desconocido',
                    seeds,
                    leechs,
                    category: 'music',
                    type: 'audio',
                    quality: inferAudioQuality(name),
                    url: item.id ? `${BASE_URL}/torrent/${item.id}` : BASE_URL,
                    magnet: buildMagnetLink(name, item.info_hash),
                    infoHash: item.info_hash,
                    files: [],
                    description: formatDescription({
                        size: sizeLabel,
                        uploaded: formatUnixDate(item.added),
                        uploader: item.username || ''
                    }) || 'Lanzamiento de audio',
                    score: calculateRelevancyScore(normalizedTitle, filterTokens, seeds) + matchedTokens.length
                };
            })
            .filter(Boolean);

        return mapped
            .sort((a, b) => b.score - a.score || b.seeds - a.seeds)
            .slice(0, limit)
            .map(({ score, ...rest }) => rest);

    } catch (error) {
        console.warn(`⚠️ Pirate Bay API error: ${error.message}`);
        return [];
    }
}

async function searchPirateBayViaHtml(query, filterTokens, limit) {
    const collected = [];

    for (let page = 1; page <= MAX_PAGES && collected.length < limit; page++) {
        try {
            const searchUrl = buildSearchUrl(query, page);
            console.log(`🔍 Pirate Bay (HTML) búsqueda (p${page}): ${searchUrl}`);

            const $ = await fetchDocument(searchUrl);
            $('#searchResult tr').each((_, element) => {
                if (collected.length >= limit * 2) return false;

                const detailLink = $(element).find('.detName a.detLink');
                const magnetLink = $(element).find('a[href^="magnet:?"]').first().attr('href');
                if (!detailLink.length || !magnetLink) return;

                const name = detailLink.text().trim();
                const href = detailLink.attr('href');
                const descriptionText = formatPirateDescription($(element).find('font.detDesc').text());
                const parsedDesc = parseDetDesc(descriptionText);

                const normalizedTitle = normalizeText(name);
                const matchedTokens = filterTokens.filter(token => normalizedTitle.includes(token));
                if (filterTokens.length && matchedTokens.length === 0) {
                    return;
                }

                const seeds = parseInt($(element).find('td').eq(2).text().replace(/,/g, ''), 10) || 0;
                const leechs = parseInt($(element).find('td').eq(3).text().replace(/,/g, ''), 10) || 0;
                const infoHash = extractInfoHash(magnetLink);
                const detailUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;

                const score = calculateRelevancyScore(normalizedTitle, filterTokens, seeds) + matchedTokens.length;

                collected.push({
                    name,
                    size: parsedDesc.size || descriptionText,
                    seeds,
                    leechs,
                    category: 'music',
                    type: 'audio',
                    quality: inferAudioQuality(name),
                    url: detailUrl,
                    magnet: magnetLink,
                    infoHash,
                    files: [],
                    description: formatPirateDescription(
                        formatDescription(parsedDesc) || descriptionText || 'Lanzamiento de audio'
                    ),
                    score
                });
            });
        } catch (error) {
            console.warn(`⚠️ Pirate Bay HTML error (page ${page}): ${error.message}`);
        }
    }

    return collected
        .sort((a, b) => b.score - a.score || b.seeds - a.seeds)
        .slice(0, limit)
        .map(({ score, ...rest }) => rest);
}

// Endpoint de búsqueda para música
app.get('/api/search', async (req, res) => {
    try {
        const query = req.query.q || req.query.query || '';
        if (!query) {
            return res.status(400).json({ error: 'Query parameter required' });
        }
        const limit = Math.min(parseInt(req.query.limit, 10) || 15, 30);

        // Buscar MP3 en The Pirate Bay
        const results = await searchPirateBayMusic(query, limit);
        res.json(results);
        
    } catch (error) {
        console.error('Search error:', error.message);
        res.status(500).json({ error: 'Search failed', details: error.message });
    }
});

// ==================== SISTEMA DE STREAMING (sin cambios) ====================

let activeTorrents = new Map();

function ensureTorrentMetadata(torrentId) {
    const data = activeTorrents.get(torrentId);
    if (!data) return null;
    const { torrent } = data;
    if (torrent.ready) {
        const files = torrent.files.map((file, index) => buildFileMetadata(torrent, file, index));
        data.files = files;
        data.streamableFileIndex = determineStreamableFile(files);
        data.name = torrent.name || data.name;
        activeTorrents.set(torrentId, data);
    }
    return data;
}

app.post('/api/stream', (req, res) => {
    try {
        const magnet = req.body.magnet || req.body.magnetURI || req.body.link;
        if (!magnet) {
            return res.status(400).json({ error: 'Magnet link required' });
        }

        const torrentId = magnetToId(magnet);

        if (activeTorrents.has(torrentId)) {
            const existing = ensureTorrentMetadata(torrentId);
            return res.json({
                torrentId,
                status: existing?.torrent?.ready ? 'ready' : 'adding',
                name: existing?.name || 'Unknown',
                files: existing?.files || [],
                streamableFileIndex: existing?.streamableFileIndex ?? null
            });
        }

        console.log(`🎵 Añadiendo torrent: ${magnet.substring(0, 80)}...`);

        const torrent = client.add(magnet, {
            path: DOWNLOADS_DIR
        });

        const torrentData = {
            torrent,
            added: Date.now(),
            name: 'Cargando...',
            files: [],
            streamableFileIndex: null
        };

        activeTorrents.set(torrentId, torrentData);

        torrent.on('error', (err) => {
            console.error('Torrent error:', err.message);
            activeTorrents.delete(torrentId);
        });

        torrent.on('metadata', () => {
            torrentData.name = torrent.name || torrentData.name;
        });

        torrent.on('ready', () => {
            ensureTorrentMetadata(torrentId);
        });

        torrent.on('done', () => {
            console.log('✅ Torrent descargado:', torrent.name);
            ensureTorrentMetadata(torrentId);
        });

        res.json({ torrentId, status: 'adding', name: torrentData.name });

    } catch (error) {
        console.error('Streaming error:', error);
        res.status(500).json({ error: 'Failed to add torrent' });
    }
});

app.get('/api/torrent/:id/status', (req, res) => {
    try {
        const torrentId = req.params.id;
        const torrentData = activeTorrents.get(torrentId);
        
        if (!torrentData) {
            return res.status(404).json({ error: 'Torrent not found' });
        }

        const torrent = torrentData.torrent;
        
        if (!torrent) {
            return res.status(404).json({ error: 'Torrent not available' });
        }

        ensureTorrentMetadata(torrentId);

        const status = {
            torrentId,
            name: torrent.name,
            progress: torrent.progress,
            downloaded: torrent.downloaded,
            uploaded: torrent.uploaded,
            downloadSpeed: torrent.downloadSpeed,
            uploadSpeed: torrent.uploadSpeed,
            timeRemaining: torrent.timeRemaining,
            numPeers: torrent.numPeers,
            done: torrent.done,
            ready: torrent.ready,
            files: torrentData.files || [],
            streamableFileIndex: torrentData.streamableFileIndex ?? null
        };

        res.json(status);

    } catch (error) {
        console.error('Status error:', error);
        res.status(500).json({ error: 'Failed to get status' });
    }
});

// ==================== DESCARGAS (sin cambios) ====================

app.get('/api/downloads', (req, res) => {
    try {
        if (!fs.existsSync(DOWNLOADS_DIR)) {
            fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
        }

        const files = fs.readdirSync(DOWNLOADS_DIR)
            .filter(file => !file.startsWith('.'))
            .map(file => {
                const stats = fs.statSync(path.join(DOWNLOADS_DIR, file));
                return {
                    name: file,
                    size: stats.size,
                    date: stats.mtime
                };
            })
            .sort((a, b) => b.date - a.date);

        res.json({ downloads: files });
    } catch (error) {
        console.error('Downloads list error:', error);
        res.status(500).json({ error: 'Failed to list downloads' });
    }
});

app.delete('/api/downloads/:filename', (req, res) => {
    try {
        const filePath = path.join(DOWNLOADS_DIR, req.params.filename);
        
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'File not found' });
        }
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ error: 'Failed to delete file' });
    }
});

app.delete('/api/torrent/:id', (req, res) => {
    try {
        const torrentId = req.params.id;
        const torrentData = activeTorrents.get(torrentId);

        if (!torrentData) {
            return res.status(404).json({ error: 'Torrent not found' });
        }

        torrentData.torrent.destroy(() => {
            activeTorrents.delete(torrentId);
            res.json({ success: true });
        });
    } catch (error) {
        console.error('Failed to remove torrent:', error.message);
        res.status(500).json({ error: 'Failed to remove torrent' });
    }
});

app.get('/api/stream/:id/:fileIndex', (req, res) => {
    try {
        const torrentId = req.params.id;
        const fileIndex = parseInt(req.params.fileIndex, 10);
        const torrentData = ensureTorrentMetadata(torrentId);

        if (!torrentData) {
            return res.status(404).json({ error: 'Torrent not found' });
        }

        const torrent = torrentData.torrent;
        const file = torrent.files[fileIndex];

        if (!file) {
            return res.status(404).json({ error: 'File not found in torrent' });
        }

        const total = file.length;
        const range = req.headers.range;
        const mimeType = getMimeType(file.name);

        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
            const chunkSize = (end - start) + 1;
            const stream = file.createReadStream({ start, end });

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${total}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': mimeType
            });

            stream.on('error', err => {
                console.error('Stream chunk error:', err.message);
                res.end();
            });
            stream.pipe(res);
        } else {
            res.writeHead(200, {
                'Content-Length': total,
                'Content-Type': mimeType
            });
            const stream = file.createReadStream();
            stream.on('error', err => {
                console.error('Stream error:', err.message);
                res.end();
            });
            stream.pipe(res);
        }
    } catch (error) {
        console.error('Stream route error:', error.message);
        res.status(500).json({ error: 'Failed to stream file' });
    }
});

// ==================== SERVIDOR ====================

// Start server
const PORT = process.env.PORT || 3000;

if (process.argv[1] === __filename) {
    app.listen(PORT, () => {
        console.log(`🎵 TorrentStream server running on port ${PORT}`);
        console.log(`🎵 WebTorrent client ready for P2P connections`);
        console.log(`🎵 Buscando música MP3 en The Pirate Bay`);
    });
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    client.destroy();
    process.exit(0);
});

export { searchPirateBayMusic };
