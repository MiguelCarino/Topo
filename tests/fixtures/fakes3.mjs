// A small S3-compatible bucket for tests/server-e2e.mjs step 14d (docs/SCOPE.md
// 5c, D111): path-style requests to one bucket on 127.0.0.1, each one's AWS
// Signature V4 checked here with node:crypto (an implementation of its own,
// not the server's), plus the payload hash and Content-MD5. PUT, GET, DELETE
// and ListObjectsV2. Nothing here talks to a real cloud.
//
//   const s3 = await startFakeS3({ keyId, secret, region, bucket });
//   s3.url, s3.objects (Map key -> Buffer), s3.refused (count), s3.close()
import http from 'node:http';
import { createHash, createHmac } from 'node:crypto';

const enc = (s, slash) => [...Buffer.from(s, 'utf8')].map((b) => {
    const c = String.fromCharCode(b);
    return /[A-Za-z0-9\-_.~]/.test(c) || (slash && c === '/') ? c : '%' + b.toString(16).toUpperCase().padStart(2, '0');
}).join('');
const hmac = (k, s) => createHmac('sha256', k).update(s).digest();
const sha = (b) => createHash('sha256').update(b).digest('hex');

export async function startFakeS3({ keyId, secret, region, bucket }) {
    const objects = new Map();
    const state = { refused: 0, requests: 0 };
    const xmlErr = (res, status, code) => {
        state.refused += status === 403 ? 1 : 0;
        res.writeHead(status, { 'Content-Type': 'application/xml' });
        res.end(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code></Error>`);
    };
    const verify = (req, body, u) => {
        const auth = req.headers.authorization || '';
        const m = /^AWS4-HMAC-SHA256 Credential=([^,]+), SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/.exec(auth);
        if (!m) return 'AccessDenied';
        const cred = m[1].split('/');
        if (cred[0] !== keyId) return 'InvalidAccessKeyId';
        if (cred[2] !== region || cred[3] !== 's3' || cred[4] !== 'aws4_request') return 'AuthorizationHeaderMalformed';
        const amz = req.headers['x-amz-date'] || '';
        if (sha(body) !== req.headers['x-amz-content-sha256']) return 'XAmzContentSHA256Mismatch';
        const signed = m[2].split(';');
        if (!['host', 'x-amz-date', 'x-amz-content-sha256'].every((h) => signed.includes(h))) return 'AccessDenied';
        const headers = signed.map((h) => h + ':' + String(req.headers[h] || '').trim().replace(/\s+/g, ' ') + '\n').join('');
        const query = [...u.searchParams].map(([k, v]) => enc(k, false) + '=' + enc(v, false)).sort().join('&');
        const canon = [req.method, enc(decodeURIComponent(u.pathname), true), query, headers, m[2], req.headers['x-amz-content-sha256']].join('\n');
        const sts = ['AWS4-HMAC-SHA256', amz, cred.slice(1).join('/'), sha(canon)].join('\n');
        const key = hmac(hmac(hmac(hmac('AWS4' + secret, cred[1]), cred[2]), 's3'), 'aws4_request');
        return hmac(key, sts).toString('hex') === m[3] ? null : 'SignatureDoesNotMatch';
    };
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            state.requests++;
            const body = Buffer.concat(chunks);
            const u = new URL(req.url, 'http://' + req.headers.host);
            const bad = verify(req, body, u);
            if (bad) return xmlErr(res, bad === 'XAmzContentSHA256Mismatch' || bad === 'AuthorizationHeaderMalformed' ? 400 : 403, bad);
            const parts = decodeURIComponent(u.pathname).replace(/^\//, '').split('/');
            if (parts.shift() !== bucket) return xmlErr(res, 404, 'NoSuchBucket');
            const key = parts.join('/');
            if (req.method === 'GET' && !key && u.searchParams.get('list-type') === '2') {
                const prefix = u.searchParams.get('prefix') || '', delim = u.searchParams.get('delimiter') || '';
                const keys = [...objects.keys()].filter((k) => k.startsWith(prefix) && !(delim && k.slice(prefix.length).includes(delim))).sort();
                const url = u.searchParams.get('encoding-type') === 'url';
                res.writeHead(200, { 'Content-Type': 'application/xml' });
                return res.end(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${bucket}</Name><IsTruncated>false</IsTruncated>${url ? '<EncodingType>url</EncodingType>' : ''}`
                    + keys.map((k) => `<Contents><Key>${url ? encodeURIComponent(k) : k}</Key><Size>${objects.get(k).length}</Size><LastModified>2026-11-10T12:00:00.000Z</LastModified></Contents>`).join('')
                    + '</ListBucketResult>');
            }
            if (req.method === 'PUT' && key) {
                const md5 = createHash('md5').update(body).digest('base64');
                if (req.headers['content-md5'] !== md5) return xmlErr(res, 400, 'BadDigest');
                objects.set(key, body);
                res.writeHead(200);
                return res.end();
            }
            if (req.method === 'GET' && key) {
                if (!objects.has(key)) return xmlErr(res, 404, 'NoSuchKey');
                res.writeHead(200, { 'Content-Length': objects.get(key).length });
                return res.end(objects.get(key));
            }
            if (req.method === 'DELETE' && key) {
                objects.delete(key);
                res.writeHead(204);
                return res.end();
            }
            xmlErr(res, 405, 'MethodNotAllowed');
        });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    return {
        url: 'http://127.0.0.1:' + server.address().port, objects, state,
        close: () => new Promise((r) => server.close(r))
    };
}
