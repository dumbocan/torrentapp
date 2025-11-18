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
import {
    AUDIO_EXTENSIONS,
    normalizeText,
    isFuzzyMatch,
    tokenizeQuery,
    buildFilterTokens,
    calculateRelevancyScore,
    inferAudioQuality,
    isLikelyAudioRelease
} from './src/utils/text.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const client = new WebTorrent();

const BASE_URL = 'https://thepibay.site';
const LIMETORRENTS_BASE = 'https://www.limetorrents.lol';
const TORRENTDOWNLOAD_BASE = 'https://www.torrentdownload.info';
const TORLOCK_BASE = 'https://www.torlock.com';
const X1337_BASE = 'https://www.1337x.to';
const AUDIO_EXTENSION_SET = new Set(AUDIO_EXTENSIONS);
const LIBRARY_CACHE = { entries: [], lastScan: 0, version: 0 };
const LIBRARY_SCAN_INTERVAL = 60 * 1000;
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

/**
 * ===================
 *  TORRENTSTREAM API
 * ===================
 *
 * Este archivo concentra toda la lógica backend de la aplicación.
 * Para facilitar su lectura añadimos docstrings en las funciones principales.
 * El enfoque está dividido en:
 *  - Normalización de texto y detección de audio.
 *  - Índice de biblioteca local (scanLibrary + endpoints `/api/library`).
 *  - Agregadores de fuentes públicas (Pirate Bay, LimeTorrents, TorrentDownload).
 *  - Endpoints REST que exponen búsquedas, streaming y cola de descargas.
 */

// ==================== BUSCADOR DE MÚSICA MP3 EN THE PIRATE BAY ====================

// Helpers específicos para Pirate Bay

function extractInfoHash(magnet = '') {
    const match = magnet.match(/xt=urn:btih:([^&]+)/i);
    return match ? match[1] : null;
}

function extractHashFromString(value = '') {
    const match = value.match(/([A-F0-9]{40})/i);
    return match ? match[1] : null;
}

function resolveUrl(href = '', baseUrl = '') {
    if (!href) return '';
    try {
        return new URL(href, baseUrl || undefined).toString();
    } catch {
        return href;
    }
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

function parseNumeric(value) {
    if (!value) return 0;
    const parsed = parseInt(String(value).replace(/,/g, ''), 10);
    return Number.isFinite(parsed) ? parsed : 0;
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
    wma: 'audio/x-ms-wma'
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

function isAudioFilename(filename = '') {
    const ext = path.extname(filename).replace('.', '').toLowerCase();
    return AUDIO_EXTENSION_SET.has(ext);
}

function parseAudioFileName(filename = '') {
    const base = filename.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
    const parts = base.split(' - ').map(part => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
        return {
            artist: parts[0],
            title: parts.slice(1).join(' - ')
        };
    }
    return { artist: null, title: base };
}

function collectAudioFiles(dirPath) {
    const results = [];
    if (!fs.existsSync(dirPath)) {
        return results;
    }

    const stack = [dirPath];
    while (stack.length) {
        const current = stack.pop();
        const entries = fs.readdirSync(current, { withFileTypes: true });
        entries.forEach(entry => {
            const entryPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (!entry.name.startsWith('.')) {
                    stack.push(entryPath);
                }
                return;
            }
            if (!entry.isFile() || !isAudioFilename(entry.name)) {
                return;
            }
            results.push(entryPath);
        });
    }

    return results;
}

function buildLibraryEntry(filePath) {
    const relativePath = path.relative(DOWNLOADS_DIR, filePath).replace(/\\/g, '/');
    const stats = fs.statSync(filePath);
    const fileName = path.basename(filePath);
    const { artist, title } = parseAudioFileName(fileName);
    const normalizedName = normalizeText(fileName);
    const directoryTokens = path.dirname(relativePath)
        .split(/[\\/]/)
        .map(part => normalizeText(part))
        .filter(Boolean);
    const keywords = Array.from(new Set([...buildFilterTokens(fileName), ...directoryTokens]));
    const downloadUrl = `/${relativePath}`;
    const streamUrl = `/api/library/stream?file=${encodeURIComponent(relativePath)}`;
    const descriptionParts = [];
    if (artist) descriptionParts.push(`Artista: ${artist}`);
    if (path.dirname(relativePath) && path.dirname(relativePath) !== '.') {
        descriptionParts.push(`Carpeta: ${path.dirname(relativePath)}`);
    }

    return {
        id: relativePath,
        name: title || fileName,
        originalName: fileName,
        artist,
        album: path.basename(path.dirname(filePath)),
        size: formatBytes(stats.size),
        bytes: stats.size,
        addedAt: stats.mtimeMs,
        category: 'library',
        type: 'audio',
        quality: inferAudioQuality(fileName),
        source: 'Biblioteca',
        description: descriptionParts.join(' • ') || 'Archivo local en tu biblioteca',
        isLocal: true,
        files: [
            {
                name: fileName,
                size: formatBytes(stats.size),
                isAudio: true
            }
        ],
        seeds: 0,
        leechs: 0,
        magnet: null,
        infoHash: relativePath,
        localPath: relativePath,
        downloadUrl,
        streamUrl,
        normalizedName,
        keywords
    };
}

function scanLibrary(force = false) {
    const now = Date.now();
    if (!force && (now - LIBRARY_CACHE.lastScan) < LIBRARY_SCAN_INTERVAL) {
        return LIBRARY_CACHE;
    }

    if (!fs.existsSync(DOWNLOADS_DIR)) {
        LIBRARY_CACHE.entries = [];
        LIBRARY_CACHE.lastScan = now;
        LIBRARY_CACHE.version = now;
        return LIBRARY_CACHE;
    }

    try {
        const files = collectAudioFiles(DOWNLOADS_DIR);
        const entries = files.map(buildLibraryEntry);
        LIBRARY_CACHE.entries = entries;
        LIBRARY_CACHE.lastScan = now;
        LIBRARY_CACHE.version = now;
    } catch (error) {
        console.warn('⚠️ Error escaneando biblioteca local:', error.message);
    }

    return LIBRARY_CACHE;
}

function searchLibraryTracks(query, limit = 15, mode = 'tracks') {
    const cache = scanLibrary();
    const normalizedQuery = normalizeText(query).replace(/\s+/g, ' ').trim();
    const condensedQuery = normalizedQuery.replace(/\s+/g, '');
    const tokens = buildFilterTokens(query);
    const effectiveLimit = mode === 'albums' ? limit * 4 : limit;

    if (!tokens.length || !normalizedQuery) {
        return cache.entries.slice(0, effectiveLimit);
    }

    const scored = cache.entries
        .map(entry => {
            const normalizedName = entry.normalizedName || normalizeText(entry.name || '');
            const condensedName = normalizedName.replace(/\s+/g, '');
            const containsFullQuery =
                normalizedName.includes(normalizedQuery) ||
                condensedName.includes(condensedQuery) ||
                isFuzzyMatch(entry.name || '', query) ||
                isFuzzyMatch(entry.artist || '', query) ||
                isFuzzyMatch(entry.album || '', query);
            if (!containsFullQuery) {
                return null;
            }

            const matches = tokens.filter(token =>
                normalizedName.includes(token) || entry.keywords.includes(token)
            );
            if (!matches.length) {
                return null;
            }
            const ageDays = (Date.now() - entry.addedAt) / (1000 * 60 * 60 * 24);
            const freshnessBonus = Math.max(0, 30 - ageDays) / 30;
            const score = (matches.length * 6) + (tokens.length === matches.length ? 5 : 0) + (freshnessBonus * 3);
            return { entry, score };
        })
        .filter(Boolean);

    return scored
        .sort((a, b) => b.score - a.score || b.entry.addedAt - a.entry.addedAt)
        .slice(0, effectiveLimit)
        .map(item => item.entry);
}

function groupLibraryTracksByAlbum(tracks, limit = 10) {
    const groups = new Map();

    tracks.forEach(track => {
        const artist = track.artist || 'Desconocido';
        const album = track.album || 'Colección';
        const key = `${artist}::${album}`;
        if (!groups.has(key)) {
            groups.set(key, {
                id: key,
                artist,
                album,
                totalBytes: 0,
                latest: track.addedAt || Date.now(),
                tracks: []
            });
        }
        const group = groups.get(key);
        group.tracks.push(track);
        group.totalBytes += track.bytes || 0;
        group.latest = Math.max(group.latest, track.addedAt || 0);
    });

    return Array.from(groups.values())
        .sort((a, b) => b.latest - a.latest)
        .slice(0, limit)
        .map(group => ({
            id: group.id,
            name: group.album || group.tracks[0]?.name || 'Álbum sin título',
            artist: group.artist,
            category: 'library-album',
            type: 'album',
            isLocal: true,
            trackCount: group.tracks.length,
            tracks: group.tracks,
            size: formatBytes(group.totalBytes),
            bytes: group.totalBytes,
            quality: 'Archivo local',
            description: `Álbum local con ${group.tracks.length} pistas`,
            source: 'Biblioteca'
        }));
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

async function fetchHtmlPage(url) {
    const response = await axios.get(url, {
        headers: SCRAPER_HEADERS,
        httpsAgent: SCRAPER_AGENT,
        timeout: 15000,
        maxRedirects: 3
    });
    const finalUrl = response.request?.res?.responseUrl || url;
    return {
        $: cheerio.load(response.data),
        finalUrl
    };
}

async function fetchMagnetFromDetail(detailUrl) {
    try {
        const { $ } = await fetchHtmlPage(detailUrl);
        return $('a[href^="magnet:?"]').first().attr('href') || '';
    } catch (error) {
        console.warn(`⚠️ Magnet fetch failed (${detailUrl}): ${error.message}`);
        return '';
    }
}

async function searchPirateBayMusic(query, limit = 15, options = {}) {
    try {
        const trimmedQuery = query.trim();
        if (!trimmedQuery) return [];

        const filterTokens = buildFilterTokens(trimmedQuery);

        let results = await searchPirateBayViaApi(trimmedQuery, filterTokens, limit, options);
        if (!results.length) {
            results = await searchPirateBayViaHtml(trimmedQuery, filterTokens, limit, options);
        }

        console.log(`✅ Pirate Bay encontró ${results.length} resultados de música`);
        return results;

    } catch (error) {
        console.error('❌ Pirate Bay Error:', error.message);
        return [];
    }
}

async function searchPirateBayViaApi(query, filterTokens, limit, options = {}) {
    const { originalQuery = query } = options;
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
                const fuzzyMatch = isFuzzyMatch(name, originalQuery);
                if (!fuzzyMatch && filterTokens.length && matchedTokens.length === 0) {
                    return null;
                }

                const seeds = parseInt(item.seeders, 10) || 0;
                const leechs = parseInt(item.leechers, 10) || 0;
                const sizeBytes = Number(item.size) || 0;
                const sizeLabel = sizeBytes ? formatBytes(sizeBytes) : '';
                const fuzzyBonus = fuzzyMatch ? 5 : 0;

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
                    score: calculateRelevancyScore(normalizedTitle, filterTokens, seeds) + matchedTokens.length + fuzzyBonus
                };
            })
            .filter(Boolean)
            .filter(item => isLikelyAudioRelease(item.name));

        return mapped
            .sort((a, b) => b.score - a.score || b.seeds - a.seeds)
            .slice(0, limit)
            .map(({ score, ...rest }) => rest);

    } catch (error) {
        console.warn(`⚠️ Pirate Bay API error: ${error.message}`);
        return [];
    }
}

async function searchPirateBayViaHtml(query, filterTokens, limit, options = {}) {
    const { originalQuery = query } = options;
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
                const fuzzyMatch = isFuzzyMatch(name, originalQuery);
                if (!fuzzyMatch && filterTokens.length && matchedTokens.length === 0) {
                    return;
                }

                const seeds = parseInt($(element).find('td').eq(2).text().replace(/,/g, ''), 10) || 0;
                const leechs = parseInt($(element).find('td').eq(3).text().replace(/,/g, ''), 10) || 0;
                const infoHash = extractInfoHash(magnetLink);
                const detailUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;

                const score = calculateRelevancyScore(normalizedTitle, filterTokens, seeds) + matchedTokens.length + (fuzzyMatch ? 5 : 0);

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
            .filter(item => isLikelyAudioRelease(item.name))
            .sort((a, b) => b.score - a.score || b.seeds - a.seeds)
            .slice(0, limit)
            .map(({ score, ...rest }) => rest);
}

async function searchLimeTorrentsMusic(query, limit = 15, options = {}) {
    try {
        const trimmedQuery = query.trim();
        if (!trimmedQuery) return [];

        const { originalQuery = query } = options;
        const filterTokens = buildFilterTokens(trimmedQuery);
        const searchUrl = `${LIMETORRENTS_BASE}/search/music/${encodeURIComponent(trimmedQuery)}/1/`;
        const { $, finalUrl } = await fetchHtmlPage(searchUrl);
        const rows = $('table.table2 tr').toArray();
        const collected = [];

        rows.forEach((row) => {
            const nameWrapper = $(row).find('.tt-name');
            if (!nameWrapper.length) {
                return;
            }

            const detailLink = nameWrapper.find('a').last();
            const torrentLink = nameWrapper.find('a[href*="itorrents"]').first().attr('href');
            const name = detailLink.text().replace(/\s+/g, ' ').trim();
            if (!name) return;

            const normalizedTitle = normalizeText(name);
            const matchedTokens = filterTokens.filter(token => normalizedTitle.includes(token));
            const fuzzyMatch = isFuzzyMatch(name, originalQuery);
            if (!fuzzyMatch && filterTokens.length && matchedTokens.length === 0) {
                return;
            }

            const cells = $(row).find('td');
            if (cells.length < 5) {
                return;
            }

            const addedText = cells.eq(1).text().trim();
            const sizeText = cells.eq(2).text().trim() || 'Desconocido';
            const seeds = parseNumeric(cells.eq(3).text());
            const leechs = parseNumeric(cells.eq(4).text());
            const infoHash = extractHashFromString(torrentLink);
            const magnet = infoHash ? buildMagnetLink(name, infoHash) : torrentLink || '';
            const score = calculateRelevancyScore(normalizedTitle, filterTokens, seeds) + matchedTokens.length + (fuzzyMatch ? 5 : 0);

            collected.push({
                name,
                size: sizeText,
                seeds,
                leechs,
                category: 'music',
                type: 'audio',
                quality: inferAudioQuality(name),
                url: resolveUrl(detailLink.attr('href'), finalUrl),
                magnet,
                infoHash: infoHash || extractInfoHash(magnet),
                files: [],
                description: addedText || 'Resultado de LimeTorrents',
                source: 'LimeTorrents',
                score
            });
        });

        return collected
            .filter(item => isLikelyAudioRelease(item.name))
            .sort((a, b) => b.score - a.score || b.seeds - a.seeds)
            .slice(0, limit)
            .map(({ score, ...rest }) => rest);
    } catch (error) {
        console.warn(`⚠️ LimeTorrents error: ${error.message}`);
        return [];
    }
}

async function searchTorrentDownloadMusic(query, limit = 15, options = {}) {
    try {
        const trimmedQuery = query.trim();
        if (!trimmedQuery) return [];

        const { originalQuery = query } = options;
        const filterTokens = buildFilterTokens(trimmedQuery);
        const searchUrl = `${TORRENTDOWNLOAD_BASE}/search?q=${encodeURIComponent(trimmedQuery)}`;
        const { $, finalUrl } = await fetchHtmlPage(searchUrl);
        const rows = $('table.table2 tr').toArray();
        const collected = [];

        rows.forEach((row) => {
            const cells = $(row).find('td');
            if (cells.length < 5) return;

            const nameAnchor = cells.eq(0).find('.tt-name a').first();
            const name = nameAnchor.text().replace(/\s+/g, ' ').trim();
            if (!name) return;

            const categoryText = cells.eq(0).find('.smallish').text().toLowerCase();
            if (categoryText && !categoryText.includes('music')) {
                return;
            }

            const normalizedTitle = normalizeText(name);
            const matchedTokens = filterTokens.filter(token => normalizedTitle.includes(token));
            const fuzzyMatch = isFuzzyMatch(name, originalQuery);
            if (!fuzzyMatch && filterTokens.length && matchedTokens.length === 0) {
                return;
            }

            const detailHref = nameAnchor.attr('href');
            const infoHash = extractHashFromString(detailHref);
            const seeds = parseNumeric(cells.eq(3).text());
            const leechs = parseNumeric(cells.eq(4).text());
            const score = calculateRelevancyScore(normalizedTitle, filterTokens, seeds) + matchedTokens.length + (fuzzyMatch ? 5 : 0);

            collected.push({
                name,
                size: cells.eq(2).text().trim() || 'Desconocido',
                seeds,
                leechs,
                category: 'music',
                type: 'audio',
                quality: inferAudioQuality(name),
                url: resolveUrl(detailHref, finalUrl),
                magnet: infoHash ? buildMagnetLink(name, infoHash) : '',
                infoHash,
                files: [],
                description: cells.eq(1).text().trim() || 'Resultado de TorrentDownload',
                source: 'TorrentDownload',
                score
            });
        });

        return collected
            .filter(item => isLikelyAudioRelease(item.name))
            .sort((a, b) => b.score - a.score || b.seeds - a.seeds)
            .slice(0, limit)
            .map(({ score, ...rest }) => rest);
    } catch (error) {
        console.warn(`⚠️ TorrentDownload error: ${error.message}`);
        return [];
    }
}

async function searchTorlockMusic(query, limit = 15, options = {}) {
    try {
        const { originalQuery = query } = options;
        const trimmedQuery = query.trim();
        if (!trimmedQuery) return [];

        const filterTokens = buildFilterTokens(trimmedQuery);
        const searchUrl = `${TORLOCK_BASE}/all/torrents/${encodeURIComponent(trimmedQuery)}.html`;
        const { $, finalUrl } = await fetchHtmlPage(searchUrl);
        const rows = $('table#tableDetails tr').toArray();
        const collected = [];

        rows.forEach(row => {
            const nameLink = $(row).find('td:nth-child(1) a').first();
            const name = nameLink.text().trim();
            if (!name) return;

            const normalizedTitle = normalizeText(name);
            const matchedTokens = filterTokens.filter(token => normalizedTitle.includes(token));
            const fuzzyMatch = isFuzzyMatch(name, originalQuery);
            if (!fuzzyMatch && filterTokens.length && matchedTokens.length === 0) {
                return;
            }

            const detailHref = nameLink.attr('href');
            const detailUrl = detailHref?.startsWith('http') ? detailHref : `${TORLOCK_BASE}${detailHref}`;
            const seeds = parseNumeric($(row).find('td:nth-child(6)').text());
            const leechs = parseNumeric($(row).find('td:nth-child(7)').text());
            const sizeText = $(row).find('td:nth-child(5)').text().trim();

            collected.push({
                name,
                seeds,
                leechs,
                size: sizeText || 'Desconocido',
                url: detailUrl,
                detailUrl,
                quality: inferAudioQuality(name),
                source: 'Torlock',
                fuzzy: fuzzyMatch,
                matchedTokens,
                score: calculateRelevancyScore(normalizedTitle, filterTokens, seeds) + matchedTokens.length + (fuzzyMatch ? 5 : 0)
            });
        });

        const enriched = [];
        for (const item of collected.sort((a, b) => b.score - a.score || b.seeds - a.seeds)) {
            if (enriched.length >= limit) break;
            if (!isLikelyAudioRelease(item.name)) continue;
            const magnet = item.detailUrl ? await fetchMagnetFromDetail(item.detailUrl) : '';
            if (!magnet) continue;
            enriched.push({
                name: item.name,
                seeds: item.seeds,
                leechs: item.leechs,
                size: item.size,
                magnet,
                infoHash: extractInfoHash(magnet),
                source: item.source,
                quality: item.quality,
                category: 'music',
                type: 'audio',
                description: `Resultado de ${item.source}`,
                files: []
            });
        }

        return enriched;
    } catch (error) {
        console.warn(`⚠️ Torlock error: ${error.message}`);
        return [];
    }
}

async function search1337xMusic(query, limit = 15, options = {}) {
    try {
        const { originalQuery = query } = options;
        const trimmedQuery = query.trim();
        if (!trimmedQuery) return [];

        const filterTokens = buildFilterTokens(trimmedQuery);
        const searchUrl = `${X1337_BASE}/category-search/${encodeURIComponent(trimmedQuery)}/Music/1/`;
        const { $, finalUrl } = await fetchHtmlPage(searchUrl);
        const rows = $('table.table-list tbody tr').toArray();
        const collected = [];

        rows.forEach(row => {
            const nameLink = $(row).find('td.name a').last();
            const name = nameLink.text().trim();
            if (!name) return;

            const normalizedTitle = normalizeText(name);
            const matchedTokens = filterTokens.filter(token => normalizedTitle.includes(token));
            const fuzzyMatch = isFuzzyMatch(name, originalQuery);
            if (!fuzzyMatch && filterTokens.length && matchedTokens.length === 0) {
                return;
            }

            const detailHref = nameLink.attr('href');
            const detailUrl = detailHref?.startsWith('http') ? detailHref : `${X1337_BASE}${detailHref}`;
            const seeds = parseNumeric($(row).find('td.seeds').text());
            const leechs = parseNumeric($(row).find('td.leeches').text());
            const sizeText = $(row).find('td.size').text().trim();

            collected.push({
                name,
                seeds,
                leechs,
                size: sizeText || 'Desconocido',
                detailUrl,
                quality: inferAudioQuality(name),
                source: '1337x',
                score: calculateRelevancyScore(normalizedTitle, filterTokens, seeds) + matchedTokens.length + (fuzzyMatch ? 5 : 0)
            });
        });

        const enriched = [];
        for (const item of collected.sort((a, b) => b.score - a.score || b.seeds - a.seeds)) {
            if (enriched.length >= limit) break;
            if (!isLikelyAudioRelease(item.name)) continue;
            const magnet = item.detailUrl ? await fetchMagnetFromDetail(item.detailUrl) : '';
            if (!magnet) continue;
            enriched.push({
                name: item.name,
                seeds: item.seeds,
                leechs: item.leechs,
                size: item.size,
                magnet,
                infoHash: extractInfoHash(magnet),
                source: item.source,
                quality: item.quality,
                category: 'music',
                type: 'audio',
                description: `Resultado de ${item.source}`,
                files: []
            });
        }

        return enriched;
    } catch (error) {
        console.warn(`⚠️ 1337x error: ${error.message}`);
        return [];
    }
}

const MUSIC_PROVIDERS = [
    { name: 'The Pirate Bay', handler: searchPirateBayMusic },
    { name: 'LimeTorrents', handler: searchLimeTorrentsMusic },
    { name: 'TorrentDownload', handler: searchTorrentDownloadMusic },
    { name: 'Torlock', handler: searchTorlockMusic },
    { name: '1337x', handler: search1337xMusic }
];

async function fetchMusicBrainzArtists(query, limit = 3) {
    try {
        const response = await axios.get('https://musicbrainz.org/ws/2/artist', {
            params: {
                query: `artist:${query}`,
                limit,
                fmt: 'json'
            },
            headers: {
                'User-Agent': 'TorrentStream/1.0 (https://example.com)'
            }
        });

        if (!response.data?.artists) return [];

        return response.data.artists.map(artist => ({
            id: artist.id,
            name: artist.name,
            disambiguation: artist.disambiguation || '',
            score: artist.score || 0
        }));
    } catch (error) {
        console.warn('⚠️ MusicBrainz artist lookup failed:', error.message);
        return [];
    }
}

async function fetchMusicBrainzReleases(artistId, limit = 5) {
    try {
        const response = await axios.get('https://musicbrainz.org/ws/2/release-group', {
            params: {
                artist: artistId,
                type: 'album|ep',
                fmt: 'json',
                limit
            },
            headers: {
                'User-Agent': 'TorrentStream/1.0 (https://example.com)'
            }
        });

        if (!response.data?.['release-groups']) return [];

        return response.data['release-groups'].map(group => ({
            id: group.id,
            title: group.title,
            firstReleaseDate: group['first-release-date'],
            primaryType: group['primary-type']
        }));
    } catch (error) {
        console.warn('⚠️ MusicBrainz releases lookup failed:', error.message);
        return [];
    }
}

async function searchAllMusicSources(query, limit = 15, options = {}) {
    const { mode = 'tracks' } = options;
    const providerPromises = MUSIC_PROVIDERS.map(async ({ name, handler }) => {
        try {
            const providerResults = await handler(query, limit, { mode, originalQuery: query });
            return providerResults.map(result => ({
                ...result,
                source: result.source || name
            }));
        } catch (error) {
            console.warn(`⚠️ ${name} búsqueda falló: ${error.message}`);
            return [];
        }
    });

    const combined = (await Promise.all(providerPromises)).flat();
    if (!combined.length) {
        return [];
    }

    const deduped = new Map();
    combined.forEach(result => {
        const keyBase = result.infoHash || normalizeText(result.name || '');
        if (!keyBase) return;
        const key = keyBase.toLowerCase();
        const current = deduped.get(key);
        if (!current || (current.seeds || 0) < (result.seeds || 0)) {
            deduped.set(key, result);
        }
    });

    const filtered = Array.from(deduped.values())
        .filter(result => {
            if (result.isLocal) {
                return true;
            }
            if (!isLikelyAudioRelease(result.name)) {
                return false;
            }
            return (result.seeds || 0) > 0;
        });

    return filtered
        .sort((a, b) => (b.seeds || 0) - (a.seeds || 0))
        .slice(0, limit);
}

async function expandQueriesWithMetadata(query) {
    const artists = await fetchMusicBrainzArtists(query, 3);
    const canonicalNames = artists
        .filter(artist => artist.score >= 60)
        .map(artist => artist.name)
        .filter(name => normalizeText(name) !== normalizeText(query));
    return Array.from(new Set(canonicalNames));
}

// ==================== BIBLIOTECA LOCAL ====================

app.get('/api/library', (req, res) => {
    const cache = scanLibrary();
    res.json({
        tracks: cache.entries,
        lastScan: cache.lastScan,
        version: cache.version
    });
});

app.post('/api/library/rescan', (req, res) => {
    const cache = scanLibrary(true);
    res.json({
        success: true,
        total: cache.entries.length,
        lastScan: cache.lastScan
    });
});

app.get('/api/library/search', (req, res) => {
    const query = req.query.q || req.query.query || '';
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const matches = query ? searchLibraryTracks(query, limit) : scanLibrary().entries.slice(0, limit);
    res.json({
        tracks: matches,
        total: matches.length
    });
});

app.get('/api/library/stream', (req, res) => {
    try {
        const relative = req.query.file;
        if (!relative || typeof relative !== 'string') {
            return res.status(400).json({ error: 'File parameter required' });
        }

        const resolvedPath = path.normalize(path.join(DOWNLOADS_DIR, relative));
        if (!resolvedPath.startsWith(DOWNLOADS_DIR)) {
            return res.status(400).json({ error: 'Invalid path' });
        }

        if (!fs.existsSync(resolvedPath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        const stat = fs.statSync(resolvedPath);
        const total = stat.size;
        const range = req.headers.range;
        const mimeType = getMimeType(resolvedPath);

        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
            const chunkSize = (end - start) + 1;
            const stream = fs.createReadStream(resolvedPath, { start, end });

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${total}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': mimeType
            });
            stream.pipe(res);
        } else {
            res.writeHead(200, {
                'Content-Length': total,
                'Content-Type': mimeType
            });
            fs.createReadStream(resolvedPath).pipe(res);
        }
    } catch (error) {
        console.error('Library stream error:', error.message);
        res.status(500).json({ error: 'Failed to stream local file' });
    }
});

app.get('/api/metadata/artist', async (req, res) => {
    try {
        const query = String(req.query.q || req.query.query || '').trim();
        if (!query) {
            return res.status(400).json({ error: 'Query parameter required' });
        }

        const artists = await fetchMusicBrainzArtists(query, 5);
        const enriched = await Promise.all(artists.map(async artist => {
            const releases = await fetchMusicBrainzReleases(artist.id, 5);
            return { ...artist, releases };
        }));

        res.json({ artists: enriched });
    } catch (error) {
        console.error('Metadata lookup failed:', error.message);
        res.status(500).json({ error: 'Failed to fetch metadata' });
    }
});

// Endpoint de búsqueda para música
app.get('/api/search', async (req, res) => {
    try {
        const query = req.query.q || req.query.query || '';
        if (!query) {
            return res.status(400).json({ error: 'Query parameter required' });
        }
        const limit = Math.min(parseInt(req.query.limit, 10) || 15, 30);
        const mode = typeof req.query.mode === 'string' ? req.query.mode : 'tracks';
        const queryCandidates = [query, ...await expandQueriesWithMetadata(query)];
        const seenQueries = new Set();
        const aggregated = new Map();

        for (const candidate of queryCandidates) {
            const normalizedCandidate = normalizeText(candidate);
            if (seenQueries.has(normalizedCandidate)) {
                continue;
            }
            seenQueries.add(normalizedCandidate);

            const localRaw = searchLibraryTracks(candidate, limit, mode);
            const localResults = mode === 'albums'
                ? groupLibraryTracksByAlbum(localRaw, limit)
                : localRaw;

            localResults.forEach(item => {
                const key = item.id || item.infoHash || `${normalizeText(item.name || '')}-${item.source || 'library'}`;
                if (!aggregated.has(key)) {
                    aggregated.set(key, { ...item, matchedQuery: candidate });
                }
            });

            if (aggregated.size >= limit) break;

            const remainingSlots = Math.max(limit - aggregated.size, 0);
            if (remainingSlots > 0) {
                const remoteResults = await searchAllMusicSources(candidate, remainingSlots, { mode, originalQuery: candidate });
                remoteResults.forEach(item => {
                    const key = item.infoHash || `${normalizeText(item.name || '')}-${item.source || 'remote'}`;
                    if (!aggregated.has(key)) {
                        aggregated.set(key, { ...item, matchedQuery: candidate });
                    }
                });
            }

            if (aggregated.size >= limit) break;
        }

        res.json(Array.from(aggregated.values()).slice(0, limit));
        
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
        console.log(`🎵 Buscando música MP3 en biblioteca local y fuentes públicas`);
    });
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    client.destroy();
    process.exit(0);
});

export { searchPirateBayMusic };
