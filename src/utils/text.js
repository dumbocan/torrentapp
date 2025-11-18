// Utilidades de texto y detección de audio
export const AUDIO_EXTENSIONS = ['mp3', 'flac', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'alac', 'wma'];
export const AUDIO_KEYWORDS = ['mp3', 'flac', 'aac', 'alac', 'lossless', 'discografia', 'discography', 'album', 'soundtrack', 'ost', '320', '256', '192', '128', 'remastered', 'bonus', 'deluxe', 'ep', 'lp', 'mixtape'];
export const VIDEO_KEYWORDS = ['1080', '720', '2160', '4k', 'hdrip', 'webrip', 'bluray', 'dvdrip', 'hdtv', 'x265', 'x264', 'cam', 'xxx', 'porn', 'porno', 'adult', 'sex'];

export function normalizeText(value = '') {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

export function condensedText(value = '') {
    return normalizeText(value).replace(/[^a-z0-9]/g, '');
}

export function levenshtein(a = '', b = '') {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;

    const matrix = Array.from({ length: b.length + 1 }, () => new Array(a.length + 1).fill(0));
    for (let i = 0; i <= b.length; i += 1) matrix[i][0] = i;
    for (let j = 0; j <= a.length; j += 1) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i += 1) {
        for (let j = 1; j <= a.length; j += 1) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j - 1] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

export function isFuzzyMatch(text = '', query = '') {
    if (!text || !query) return false;
    const normalizedText = normalizeText(text);
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return true;
    if (normalizedText.includes(normalizedQuery)) return true;
    const condensedName = condensedText(text);
    const condensedQuery = condensedText(query);
    if (!condensedName || !condensedQuery) return false;
    if (condensedName.includes(condensedQuery)) return true;

    const distance = levenshtein(condensedName, condensedQuery);
    const threshold = Math.ceil(Math.max(condensedName.length, condensedQuery.length) * 0.2);
    return distance <= threshold;
}

export function tokenizeQuery(query) {
    return normalizeText(query)
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}

export function buildFilterTokens(query) {
    const baseTokens = tokenizeQuery(query);
    const strongTokens = baseTokens.filter(token => token.length >= 4);
    return strongTokens.length ? strongTokens : baseTokens;
}

export function calculateRelevancyScore(title, tokens, seeds = 0) {
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

export function inferAudioQuality(text = '') {
    const normalized = normalizeText(text);
    if (normalized.includes('flac')) return 'FLAC';
    if (normalized.includes('320')) return '320 kbps';
    if (normalized.includes('256')) return '256 kbps';
    if (normalized.includes('192')) return '192 kbps';
    if (normalized.includes('128')) return '128 kbps';
    return 'Audio';
}

export function isLikelyAudioRelease(name = '') {
    if (!name) return false;
    const normalized = normalizeText(name);
    if (VIDEO_KEYWORDS.some(keyword => normalized.includes(keyword))) {
        return false;
    }
    return AUDIO_KEYWORDS.some(keyword => normalized.includes(keyword));
}
